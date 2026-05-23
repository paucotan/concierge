require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.actual-cache');

// Suppress @actual-app/api debug output
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

function monthStart(m) { return `${m}-01`; }
function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  const em = mo === 12 ? 1 : mo + 1;
  const ey = mo === 12 ? y + 1 : y;
  return `${ey}-${String(em).padStart(2, '0')}-01`;
}
function prevMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  let pm = mo - n, py = y;
  while (pm <= 0) { pm += 12; py--; }
  return `${py}-${String(pm).padStart(2, '0')}`;
}
function daysInMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}
function daysElapsed(m) {
  const today = new Date();
  const [y, mo] = m.split('-').map(Number);
  if (today.getFullYear() === y && today.getMonth() + 1 === mo) return today.getDate();
  return daysInMonth(m);
}

async function run() {
  const today = new Date();
  const focusMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  const accounts  = await api.getAccounts();
  const payees    = await api.getPayees();
  const categories = await api.getCategories();

  const accountMap  = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const categoryMap = Object.fromEntries(categories.filter(c => !c.hidden).map(c => [c.id, c.name]));
  const payeeMap    = Object.fromEntries(payees.map(p => [p.id, p]));
  const transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));

  async function fetchCatTotals(month, includePayees = false) {
    const { data } = await runQuery(
      q('transactions')
        .filter({ is_parent: false })
        .filter({ date: { $gte: monthStart(month) } })
        .filter({ date: { $lt: monthEnd(month) } })
        .select(['amount', 'payee', 'category'])
    );
    const catTotals = {};
    const catPayees = {};
    for (const t of data) {
      if (transferPayees.has(t.payee)) continue;
      const amt = t.amount / 100;
      const cat = t.category ? (categoryMap[t.category] || '') : (amt < 0 ? 'Uncategorized' : null);
      if (!cat) continue;
      catTotals[cat] = (catTotals[cat] || 0) + amt;
      if (includePayees && amt < 0) {
        const payeeName = t.payee ? (payeeMap[t.payee]?.name || 'Unknown') : 'Unknown';
        if (!catPayees[cat]) catPayees[cat] = {};
        catPayees[cat][payeeName] = (catPayees[cat][payeeName] || 0) + amt;
      }
    }
    for (const cat of Object.keys(catTotals)) {
      if (catTotals[cat] >= 0) delete catTotals[cat];
    }
    return includePayees ? { catTotals, catPayees } : catTotals;
  }

  const [m1, m2, m3, currentResult] = await Promise.all([
    fetchCatTotals(prevMonth(focusMonth, 3)),
    fetchCatTotals(prevMonth(focusMonth, 2)),
    fetchCatTotals(prevMonth(focusMonth, 1)),
    fetchCatTotals(focusMonth, true),
  ]);
  const current = currentResult.catTotals;
  const catPayees = currentResult.catPayees;

  await api.shutdown();

  const elapsed = daysElapsed(focusMonth);
  const total   = daysInMonth(focusMonth);
  const ratio   = elapsed / total;

  const allCats = [...new Set([...Object.keys(m1), ...Object.keys(m2), ...Object.keys(m3), ...Object.keys(current)])];

  const rows = [];
  for (const cat of allCats) {
    const currentAmt = current[cat] || 0;
    if (currentAmt === 0) continue; // skip categories with no spend this month

    // Use absolute values; treat missing months as $0 (valid data point)
    const history = [m1[cat], m2[cat], m3[cat]].map(v => Math.abs(v || 0));
    const isNew   = history.every(v => v === 0);

    let emoji, delta, pct = null;
    if (isNew) {
      emoji = '🔵';
      delta = 'NEW';
    } else {
      const absAvg      = history.reduce((s, v) => s + v, 0) / history.length;
      const absProrated = absAvg * ratio;
      const absCurrent  = Math.abs(currentAmt);
      pct = absProrated !== 0 ? ((absCurrent - absProrated) / absProrated) * 100 : 0;

      if      (pct >  20) emoji = '🔴';
      else if (pct >   5) emoji = '🟡';
      else if (pct <  -5) emoji = '🔵';
      else                emoji = '🟢';

      delta = pct >= 0 ? `▲${Math.abs(Math.round(pct))}%` : `▼${Math.abs(Math.round(pct))}%`;
    }

    const proratedAvg = isNew ? null : +(Math.abs(history.reduce((s,v)=>s+v,0)/history.length * ratio).toFixed(0));
    // Label reflects actual months of data available
    const avgMonths = isNew ? 0 : history.filter(v => v > 0).length;

    const topPayees = catPayees[cat]
      ? Object.entries(catPayees[cat])
          .sort((a, b) => a[1] - b[1])
          .slice(0, 5)
          .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }))
      : [];

    rows.push({ emoji, category: cat, amount: +currentAmt.toFixed(2), delta, pct, isNew, proratedAvg, avgMonths, topPayees });
  }

  rows.sort((a, b) => a.amount - b.amount); // most spent first (amounts are negative)

  process.stdout.write = _origWrite;
  process.stdout.write(JSON.stringify({ month: focusMonth, elapsed, total, rows }) + '\n');
}

run().catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
