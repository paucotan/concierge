require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.actual-cache');

async function fetchRules() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  // Fetch rules, payees, categories for readable output
  const rules = await api.getRules();
  const payees = await api.getPayees();
  const categories = await api.getCategories();

  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p.name]));
  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  // Also fetch all payees to find uncategorized recurring ones
  const { data: transactions } = await runQuery(
    q('transactions')
      .select(['payee', 'category', 'date'])
      .filter({ 'category': null })
  );

  console.log('\n=== EXISTING RULES (' + rules.length + ') ===\n');
  for (const rule of rules) {
    const condStr = rule.conditions.map(c => {
      const val = c.field === 'payee' ? (payeeMap[c.value] || c.value) : c.value;
      return `${c.field} ${c.op} "${val}"`;
    }).join(' AND ');

    const actStr = rule.actions.map(a => {
      const val = a.field === 'category' ? (categoryMap[a.value] || a.value) : a.value;
      return `set ${a.field} = "${val}"`;
    }).join(', ');

    console.log(`[${rule.stage || 'default'}] IF ${condStr} → ${actStr}`);
  }

  // Find payees with uncategorized transactions
  const uncatPayees = {};
  for (const t of transactions) {
    if (t.payee) {
      const name = payeeMap[t.payee] || t.payee;
      uncatPayees[name] = (uncatPayees[name] || 0) + 1;
    }
  }

  console.log('\n=== PAYEES WITH UNCATEGORIZED TRANSACTIONS ===');
  const sorted = Object.entries(uncatPayees).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    console.log(`  ${count}x  ${name}`);
  }

  await api.shutdown();
}

fetchRules().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
