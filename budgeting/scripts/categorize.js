require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');
const { callAI } = require('./ai-provider');

const CACHE_DIR = path.join(__dirname, '.actual-cache');

// Suppress @actual-app/api debug output ([Breadcrumb], sync logs) from stdout
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function categorize() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  // Sync bank transactions from SimpleFIN
  await api.runBankSync();

  // Fetch categories and payees
  const categories = await api.getCategories();
  const activeCategories = categories.filter(c => !c.hidden);
  const categoryByName = Object.fromEntries(activeCategories.map(c => [c.name.toLowerCase(), c]));
  const categoryNames = activeCategories.map(c => c.name);

  const payees = await api.getPayees();
  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  const transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));
  const categoryMap = Object.fromEntries(activeCategories.map(c => [c.id, c.name]));

  // Fetch existing rules for Claude context
  const allRules = await api.getRules();
  const rulesContext = allRules
    .filter(r => r.actions.some(a => a.field === 'category'))
    .map(r => {
      const cond = r.conditions.map(c => {
        const val = c.field === 'payee' ? (payeeMap[c.value]?.name || c.value) : c.value;
        return `${c.field} ${c.op} "${val}"`;
      }).join(' AND ');
      const act = r.actions
        .filter(a => a.field === 'category')
        .map(a => categoryMap[a.value] || a.value)
        .join(', ');
      return `- IF ${cond} → ${act}`;
    })
    .join('\n');

  // Fetch uncategorized non-transfer transactions
  const { data } = await runQuery(
    q('transactions')
      .filter({ 'category': null, 'is_parent': false })
      .select(['id', 'payee', 'amount', 'date'])
  );

  await api.shutdown();

  const filtered = data.filter(t => !transferPayees.has(t.payee));

  if (filtered.length === 0) {
    process.stdout.write = _origWrite;
    console.log(JSON.stringify({ suggestions: [], categories: categoryNames }));
    return;
  }

  const transactions = filtered.map(t => ({
    id: t.id,
    payee: payeeMap[t.payee]?.name || 'Unknown',
    amount: parseFloat((t.amount / 100).toFixed(2)),
    date: t.date,
  }));

  // Build prompt — piped via stdin to avoid arg length limits
  const prompt = `You are categorizing personal finance transactions for a budget app. Respond with ONLY valid JSON, no explanation, no markdown fences.

Available categories (use EXACTLY these names, case-sensitive):
${categoryNames.map(n => `- ${n}`).join('\n')}

Existing automatic rules (stay consistent with these — use the same category if you see a matching payee):
${rulesContext || '(none)'}

Transactions to categorize:
${JSON.stringify(transactions)}

Rules:
- Negative amounts are expenses, positive are income/transfers
- If genuinely unsure, use "General"
- Never use a category not in the list above

Output format — a JSON array, nothing else:
[{"id":"<id>","category":"<category_name>"},...]`;

  const aiOutput = callAI(prompt);

  // Extract JSON array from output (model may wrap in markdown fences or emit surrounding text)
  const jsonMatch = aiOutput.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in AI output:\n${aiOutput.slice(0, 500)}`);
  const suggestions = JSON.parse(jsonMatch[0]);

  // Enrich with IDs and display info
  const enriched = suggestions
    .map(s => {
      const tx = transactions.find(t => t.id === s.id);
      const cat = categoryByName[s.category.toLowerCase()];
      if (!tx || !cat) return null;
      return {
        transaction_id: s.id,
        category_id: cat.id,
        category_name: cat.name,
        payee: tx.payee,
        amount: tx.amount,
      };
    })
    .filter(Boolean);

  process.stdout.write = _origWrite;
  console.log(JSON.stringify({ suggestions: enriched, categories: categoryNames }));
}

categorize().catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
