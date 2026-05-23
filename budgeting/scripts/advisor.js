require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');
const { callAI } = require('./ai-provider');

const CACHE_DIR = process.env.BUDGET_CACHE_DIR || path.join(process.cwd(), '.actual-cache');

// Suppress @actual-app/api debug output from stdout
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

const focusMonth = process.argv[2]; // e.g. "2026-03"
const userQuestion = process.argv[3] || '';

if (!focusMonth) {
  process.stderr.write('Usage: node advisor.js <YYYY-MM> [question]\n');
  process.exit(1);
}

// Read conversation history from stdin (JSON array of {role, content} objects)
let conversationHistory = [];
try {
  const stdin = fs.readFileSync('/dev/stdin', 'utf8').trim();
  if (stdin) conversationHistory = JSON.parse(stdin);
} catch { /* no stdin or parse error — proceed without history */ }

function fmt(n) {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(mo) - 1]} ${y}`;
}

function prevMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const result = [];
  for (let i = n; i >= 1; i--) {
    let pm = m - i;
    let py = y;
    while (pm <= 0) { pm += 12; py--; }
    result.push(`${py}-${String(pm).padStart(2, '0')}`);
  }
  return result;
}

function monthStart(m) {
  return `${m}-01`;
}

function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  const em = mo === 12 ? 1 : mo + 1;
  const ey = mo === 12 ? y + 1 : y;
  return `${ey}-${String(em).padStart(2, '0')}-01`;
}

async function run() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  // Build lookups
  const accounts = await api.getAccounts();
  const payees = await api.getPayees();
  const categories = await api.getCategories();

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const categoryMap = Object.fromEntries(categories.filter(c => !c.hidden).map(c => [c.id, c.name]));
  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  const transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));

  function resolvePayee(t) {
    if (!t.payee) return '';
    const p = payeeMap[t.payee];
    if (!p) return '';
    return p.transfer_acct ? (accountMap[p.transfer_acct] || p.name) : p.name;
  }

  // Discover all available months (up to 12)
  const { data: allDates } = await runQuery(
    q('transactions').filter({ is_parent: false }).select(['date'])
  );
  const allMonths = [...new Set(allDates.map(t => t.date.slice(0, 7)))]
    .sort()
    .reverse()
    .slice(0, 12)
    .reverse(); // oldest first for table display

  // Ensure focus month is included
  if (!allMonths.includes(focusMonth)) allMonths.push(focusMonth);
  allMonths.sort();

  // Fetch transactions per month and build summaries
  const summaries = {};

  for (const month of allMonths) {
    const { data } = await runQuery(
      q('transactions')
        .filter({ is_parent: false })
        .filter({ date: { $gte: monthStart(month) } })
        .filter({ date: { $lt: monthEnd(month) } })
        .select(['id', 'account', 'date', 'amount', 'payee', 'category', 'cleared'])
    );

    const txns = data
      .filter(t => !transferPayees.has(t.payee))
      .map(t => ({
        date: t.date,
        payee: resolvePayee(t),
        category: t.category ? (categoryMap[t.category] || '') : '',
        amount: t.amount / 100,
      }));

    const income = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);

    // Category breakdown: algebraic so refunds net against charges
    const catTotals = {};
    for (const t of txns) {
      const cat = t.category || (t.amount < 0 ? 'Uncategorized' : null);
      if (!cat) continue;
      catTotals[cat] = (catTotals[cat] || 0) + t.amount;
    }
    for (const cat of Object.keys(catTotals)) {
      if (catTotals[cat] >= 0) delete catTotals[cat];
    }

    // Top payees overall (expenses only)
    const payeeTotals = {};
    for (const t of txns.filter(t => t.amount < 0 && t.payee)) {
      if (!payeeTotals[t.payee]) payeeTotals[t.payee] = { total: 0, count: 0 };
      payeeTotals[t.payee].total += t.amount;
      payeeTotals[t.payee].count++;
    }
    const topPayees = Object.entries(payeeTotals)
      .sort((a, b) => a[1].total - b[1].total)
      .slice(0, 10);

    // Per-category top payees (focus month: top 5 categories × top 5 payees)
    const catPayees = {};
    for (const t of txns.filter(t => t.amount < 0 && t.payee && t.category)) {
      if (!catPayees[t.category]) catPayees[t.category] = {};
      if (!catPayees[t.category][t.payee]) catPayees[t.category][t.payee] = { total: 0, count: 0 };
      catPayees[t.category][t.payee].total += t.amount;
      catPayees[t.category][t.payee].count++;
    }
    const topCatNames = Object.entries(catTotals).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([cat]) => cat);
    const catPayeeRows = [];
    for (const cat of topCatNames) {
      if (!catPayees[cat]) continue;
      const top = Object.entries(catPayees[cat]).sort((a, b) => a[1].total - b[1].total).slice(0, 5);
      for (const [name, { total, count }] of top) catPayeeRows.push({ cat, name, total, count });
    }

    summaries[month] = { income, expenses, net: income + expenses, count: txns.length, catTotals, topPayees, catPayeeRows };
  }

  await api.shutdown();

  // ── Build prompt ───────────────────────────────────────────────────────

  // Collect all category names across all months
  const allCats = [...new Set(allMonths.flatMap(m => Object.keys(summaries[m].catTotals)))].sort();

  // Monthly overview table
  const overviewHeader = `Month         | Income      | Expenses    | Net         | Txns`;
  const overviewSep    = `--------------|-------------|-------------|-------------|-----`;
  const overviewRows = allMonths.map(m => {
    const s = summaries[m];
    const lbl = monthLabel(m).padEnd(13);
    return `${lbl} | ${fmt(s.income).padStart(11)} | ${fmt(s.expenses).padStart(11)} | ${fmt(s.net).padStart(11)} | ${s.count}`;
  });

  // Category breakdown table (months as columns, last 6 for readability)
  const catMonths = allMonths.slice(-6);
  const catHeader = `Category              | ${catMonths.map(m => monthLabel(m).padStart(10)).join(' | ')}`;
  const catSep    = `----------------------|-${catMonths.map(() => '-'.repeat(11)).join('-|-')}`;
  const catRows = allCats.map(cat => {
    const cells = catMonths.map(m => {
      const v = summaries[m].catTotals[cat];
      return (v ? fmt(v) : '—').padStart(10);
    });
    return `${cat.padEnd(21)} | ${cells.join(' | ')}`;
  });

  // Top payees overall for last 3 months
  const payeeMonths = allMonths.slice(-3);
  const payeeRows = [];
  for (const m of payeeMonths) {
    for (const [name, { total, count }] of summaries[m].topPayees) {
      payeeRows.push(`${monthLabel(m).padEnd(10)} | ${name.padEnd(25)} | ${fmt(total).padStart(9)} | ${count} visit${count === 1 ? '' : 's'}`);
    }
  }

  // Per-category payees for focus month
  const catPayeeRows = summaries[focusMonth].catPayeeRows || [];

  const defaultQuestion = 'Analyze my spending for the most recent month. Give me 5-7 specific, data-backed insights about patterns, notable changes vs prior months, and 1-2 actionable suggestions.';
  const question = userQuestion || defaultQuestion;

  const prompt = `=== FINANCIAL DATA ===
Most recent month: ${monthLabel(focusMonth)}

MONTHLY OVERVIEW
${overviewHeader}
${overviewSep}
${overviewRows.join('\n')}

CATEGORY BREAKDOWN (expenses, last 6 months)
${catHeader}
${catSep}
${catRows.join('\n')}

TOP PAYEES OVERALL (last 3 months, expenses only)
Month      | Payee                     | Amount    | Frequency
-----------|---------------------------|-----------|----------
${payeeRows.join('\n')}

TOP PAYEES BY CATEGORY (${monthLabel(focusMonth)}, top 5 categories × top 5 payees)
Category              | Payee                     | Amount    | Visits
----------------------|---------------------------|-----------|-------
${catPayeeRows.length ? catPayeeRows.map(r => `${r.cat.padEnd(21)} | ${r.name.padEnd(25)} | ${fmt(r.total).padStart(9)} | ${r.count}`).join('\n') : '(no data)'}

${conversationHistory.length > 0 ? `=== CONVERSATION HISTORY ===
${conversationHistory.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}

` : ''}=== USER QUESTION ===
${question}

Answer using only the data above and conversation history if relevant. Be specific — use actual numbers from the data. Format your response as a concise markdown bullet list. No generic advice.`;

  const aiOutput = callAI(prompt);

  process.stdout.write = _origWrite;
  process.stdout.write(aiOutput);
}

run().catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
