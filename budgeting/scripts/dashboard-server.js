require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const { callAI, loadConfig } = require('./ai-provider');

const PORT = 5008;
const CACHE_DIR = process.env.BUDGET_CACHE_DIR || path.join(process.cwd(), '.actual-cache');

// Suppress @actual-app/api debug output
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

let accountMap, payeeMap, categoryMap, transferPayees;

async function initActual() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
  await buildLookups();
}

async function buildLookups() {
  const accounts = await api.getAccounts();
  const payees = await api.getPayees();
  const categories = await api.getCategories();

  accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  categoryMap = Object.fromEntries(categories.filter(c => !c.hidden).map(c => [c.id, c.name]));
  payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));
}

function resolvePayeeName(t) {
  if (!t.payee) return '';
  const payee = payeeMap[t.payee];
  if (!payee) return '';
  return payee.transfer_acct ? (accountMap[payee.transfer_acct] || payee.name) : payee.name;
}

function enrichTransaction(t) {
  return {
    id: t.id,
    date: t.date,
    payee: resolvePayeeName(t),
    category: t.category ? (categoryMap[t.category] || '') : '',
    amount: t.amount / 100,
    account: accountMap[t.account] || '',
    notes: t.notes || '',
    cleared: t.cleared,
    isTransfer: transferPayees.has(t.payee),
  };
}

async function fetchTransactions(month) {
  let query = q('transactions')
    .filter({ is_parent: false })
    .select(['id', 'account', 'date', 'amount', 'payee', 'notes', 'category', 'cleared', 'is_parent', 'is_child']);

  if (month) {
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const endMonth = m === 12 ? 1 : m + 1;
    const endYear = m === 12 ? y + 1 : y;
    const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
    // Must chain filters separately — Actual ignores $lt when combined with $gte in one object
    query = q('transactions')
      .filter({ is_parent: false })
      .filter({ date: { $gte: start } })
      .filter({ date: { $lt: end } })
      .select(['id', 'account', 'date', 'amount', 'payee', 'notes', 'category', 'cleared', 'is_parent', 'is_child']);
  }

  const { data } = await runQuery(query);
  return data.map(enrichTransaction);
}

// ── Express app ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// GET /api/months — list available months
app.get('/api/months', async (req, res) => {
  try {
    const { data } = await runQuery(
      q('transactions').filter({ is_parent: false }).select(['date'])
    );
    const months = [...new Set(data.map(t => t.date.slice(0, 7)))].sort().reverse();
    res.json(months);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transactions?month=2026-03&category=Food&payee=Starbucks
app.get('/api/transactions', async (req, res) => {
  try {
    let txns = await fetchTransactions(req.query.month);
    if (req.query.category) txns = txns.filter(t => t.category === req.query.category);
    if (req.query.payee) txns = txns.filter(t => t.payee === req.query.payee);
    if (req.query.excludeTransfers !== 'false') txns = txns.filter(t => !t.isTransfer);
    res.json(txns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/summary?month=2026-03
app.get('/api/summary', async (req, res) => {
  try {
    let txns = await fetchTransactions(req.query.month);
    txns = txns.filter(t => !t.isTransfer);

    const income = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    // Category breakdown: algebraic so refunds (positive amounts in expense categories) net against charges
    const catTotals = {};
    for (const t of txns) {
      const cat = t.category || (t.amount < 0 ? 'Uncategorized' : null);
      if (!cat) continue;
      if (!catTotals[cat]) catTotals[cat] = { name: cat, total: 0, count: 0 };
      catTotals[cat].total += t.amount;
      catTotals[cat].count++;
    }
    const categoryBreakdown = Object.values(catTotals)
      .filter(c => c.total < 0)
      .sort((a, b) => a.total - b.total);
    const expenses = +categoryBreakdown.reduce((s, c) => s + c.total, 0).toFixed(2);

    // Top payees (expenses only)
    const payeeTotals = {};
    for (const t of txns.filter(t => t.amount < 0)) {
      const p = t.payee || 'Unknown';
      if (!payeeTotals[p]) payeeTotals[p] = { name: p, total: 0, count: 0 };
      payeeTotals[p].total += t.amount;
      payeeTotals[p].count++;
    }
    const topPayees = Object.values(payeeTotals).sort((a, b) => a.total - b.total).slice(0, 10);

    res.json({
      income: +income.toFixed(2),
      expenses: +expenses.toFixed(2),
      net: +(income + expenses).toFixed(2),
      transactionCount: txns.length,
      categoryBreakdown,
      topPayees,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compare?months=2026-02,2026-03
app.get('/api/compare', async (req, res) => {
  try {
    const months = (req.query.months || '').split(',').filter(Boolean);
    const results = {};
    for (const month of months) {
      let txns = await fetchTransactions(month);
      txns = txns.filter(t => !t.isTransfer);
      const income = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

      const catTotals = {};
      for (const t of txns) {
        const cat = t.category || (t.amount < 0 ? 'Uncategorized' : null);
        if (!cat) continue;
        if (!catTotals[cat]) catTotals[cat] = { name: cat, total: 0, count: 0 };
        catTotals[cat].total += t.amount;
        catTotals[cat].count++;
      }
      const categoryBreakdown = Object.values(catTotals)
        .filter(c => c.total < 0)
        .sort((a, b) => a.total - b.total);
      const expenses = +categoryBreakdown.reduce((s, c) => s + c.total, 0).toFixed(2);

      results[month] = {
        income: +income.toFixed(2),
        expenses,
        net: +(income + expenses).toFixed(2),
        transactionCount: txns.length,
        categoryBreakdown,
      };
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export?month=2026-03 — CSV download
app.get('/api/export', async (req, res) => {
  try {
    let txns = await fetchTransactions(req.query.month);
    if (req.query.excludeTransfers !== 'false') txns = txns.filter(t => !t.isTransfer);

    const header = 'Date,Payee,Category,Amount,Account,Notes,Cleared';
    const rows = txns.map(t => {
      const cells = [t.date, t.payee, t.category, t.amount, t.account, t.notes, t.cleared ? 'Yes' : 'No'];
      return cells.map(c => {
        const s = String(c == null ? '' : c);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    });

    const filename = req.query.month ? `budget-${req.query.month}.csv` : 'budget-all.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(header + '\n' + rows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/advisor  { month, question, history }
app.post('/api/advisor', (req, res) => {
  const { month, question = '', history = [] } = req.body || {};
  if (!month) return res.status(400).json({ error: 'month required' });

  const { spawnSync } = require('child_process');
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'advisor.js'), month, question],
    {
      input: JSON.stringify(history),
      encoding: 'utf8',
      timeout: 65000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, BUDGET_CACHE_DIR: process.env.BUDGET_CACHE_DIR || CACHE_DIR, HOME: process.env.HOME || require('os').homedir() },
      cwd: __dirname,
    }
  );

  if (result.error || result.status !== 0) {
    return res.status(500).json({ error: (result.stderr || result.error?.message || 'Unknown error').trim() });
  }
  res.json({ insights: result.stdout.trim() });
});

// GET /api/advisor-brief — auto-generated monthly snapshot for advisor opening message
app.get('/api/advisor-brief', (req, res) => {
  const { spawnSync } = require('child_process');

  // Run weekly-brief.js to get structured data
  const briefResult = spawnSync(
    process.execPath,
    [path.join(__dirname, 'weekly-brief.js')],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, BUDGET_CACHE_DIR: process.env.BUDGET_CACHE_DIR || CACHE_DIR, HOME: process.env.HOME || require('os').homedir() }, cwd: __dirname }
  );
  if (briefResult.error || briefResult.status !== 0) {
    return res.status(500).json({ error: 'Brief computation failed' });
  }

  let brief;
  try { brief = JSON.parse(briefResult.stdout.trim()); }
  catch (e) { return res.status(500).json({ error: 'Brief parse failed' }); }

  // Format rows for Claude
  const rows = brief.rows.map(r => {
    const avg = r.isNew ? 'new' : `${r.avgMonths}-mo avg $${r.proratedAvg}`;
    return `${r.emoji} ${r.category}: $${Math.abs(r.amount).toFixed(0)} ${r.delta} (${avg})`;
  }).join('\n');

  const prompt = `You are a financial advisor. Here is the user's spending brief:

${rows}
---
month: ${brief.month}, day ${brief.elapsed} of ${brief.total}

Output EXACTLY this format, nothing else:

⚠️ [Month] snapshot — [N] days left

[one row per category: EMOJI CATEGORY    $AMOUNT  DELTA  (AVG_LABEL) — annotation]

[mood line]

Rules:
- Only annotate 🔴 and 🟡 rows — 🔵/🟢 rows NO annotation (leave the row without a dash)
- Annotations: max 5 words, lowercase
- Delta is signed: negative means over average (e.g. -$120), positive means under (e.g. +$30)
- Mood line: net verdict, specific with numbers, end with 'ask me anything.'
- No preamble, no extra text, no markdown, output starts with ⚠️`;

  let aiOutput;
  try {
    aiOutput = callAI(prompt);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ insights: aiOutput.trim(), month: brief.month });
});

// GET /api/payee-history?name=Popeyes — all-time transactions for a payee, grouped by month
app.get('/api/payee-history', async (req, res) => {
  try {
    let txns = await fetchTransactions(); // no month = all time
    txns = txns.filter(t => t.payee === req.query.name && !t.isTransfer);

    const byMonth = {};
    for (const t of txns) {
      const m = t.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { month: m, total: 0, count: 0 };
      byMonth[m].total += t.amount;
      byMonth[m].count++;
    }
    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    res.json({
      payee: req.query.name,
      months,
      transactions: txns.sort((a, b) => b.date.localeCompare(a.date)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spending-trend?months=12 — monthly expense totals + per-category breakdown
app.get('/api/spending-trend', async (req, res) => {
  try {
    const n = Math.min(parseInt(req.query.months || '12'), 24);
    const { data: allDates } = await runQuery(
      q('transactions').filter({ is_parent: false }).select(['date'])
    );
    const allMonths = [...new Set(allDates.map(t => t.date.slice(0, 7)))].sort();
    const months = allMonths.slice(-n);

    const totals = [];
    const byCategory = {};

    for (let i = 0; i < months.length; i++) {
      let txns = await fetchTransactions(months[i]);
      txns = txns.filter(t => !t.isTransfer && t.amount < 0);

      const monthTotal = txns.reduce((s, t) => s + t.amount, 0);
      totals.push(+Math.abs(monthTotal).toFixed(2));

      const catTotals = {};
      for (const t of txns) {
        const cat = t.category || 'Uncategorized';
        catTotals[cat] = (catTotals[cat] || 0) + t.amount;
      }
      for (const [cat, amt] of Object.entries(catTotals)) {
        if (!byCategory[cat]) byCategory[cat] = new Array(months.length).fill(0);
        byCategory[cat][i] = +Math.abs(amt).toFixed(2);
      }
    }

    res.json({ months, totals, byCategory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config — client config (Actual server URL for deep links)
app.get('/api/config', (req, res) => {
  res.json({ actualServerUrl: process.env.ACTUAL_SERVER_URL || '' });
});

app.get('/api/ai-provider', (req, res) => {
  const config = loadConfig();
  const label = config.provider === 'ollama'
    ? (config.ollama?.model || 'Ollama')
    : 'Claude';
  res.json({ provider: config.provider, label });
});

// ── Start ───────────────────────────────────────────────────────────────

process.stdout.write = _origWrite;

initActual().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dashboard server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to Actual:', err.message);
  process.exit(1);
});
