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

function updateEnvFile(envPath, syncId) {
  try {
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      if (content.includes('ACTUAL_SYNC_ID=')) {
        content = content.replace(/ACTUAL_SYNC_ID=.*/, `ACTUAL_SYNC_ID=${syncId}`);
      } else {
        content += `\nACTUAL_SYNC_ID=${syncId}\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
      console.log(`Automatically updated env file at ${envPath} with new sync ID.`);
      return true;
    }
  } catch (err) {
    console.error(`Failed to update env file at ${envPath}:`, err.message);
  }
  return false;
}

async function initActual() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  let syncId = process.env.ACTUAL_SYNC_ID;
  try {
    const budgets = await api.getBudgets();
    const exactMatch = budgets.find(b => b.groupId === syncId);
    if (!exactMatch) {
      console.log(`Sync ID ${syncId} not found on server. Attempting dynamic resolution...`);
      
      // Look up target budget name dynamically from local cache metadata to protect privacy
      let targetName = null;
      try {
        const files = fs.readdirSync(CACHE_DIR);
        for (const file of files) {
          const dirPath = path.join(CACHE_DIR, file);
          if (fs.statSync(dirPath).isDirectory()) {
            const metaPath = path.join(dirPath, 'metadata.json');
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.budgetName) {
                targetName = meta.budgetName;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to read target budget name from cache metadata:', e.message);
      }

      if (targetName) {
        const nameMatches = budgets.filter(b => b.name === targetName);
        if (nameMatches.length > 0) {
          const newMatch = nameMatches.find(b => b.groupId !== syncId && b.state === 'remote') || nameMatches[0];
          if (newMatch) {
            console.log(`Found active sync ID for "${targetName}" on server: ${newMatch.groupId}`);
            syncId = newMatch.groupId;
            process.env.ACTUAL_SYNC_ID = syncId;
            
            // Update the .env file in scripts
            const envPath = path.join(__dirname, '.env');
            updateEnvFile(envPath, syncId);

            // Update the .env file in Concierge directory
            const conciergeEnvPath = path.join(path.dirname(CACHE_DIR), '.env');
            updateEnvFile(conciergeEnvPath, syncId);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to dynamically check sync IDs from server:', err.message);
  }

  await api.downloadBudget(syncId);
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

// GET /api/insights?month=2026-03
app.get('/api/insights', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required' });

  try {
    const { runAnalysis } = require('./insights-engine');
    const data = await runAnalysis(month, true);

    const fmtLocal = (n) => {
      const abs = Math.abs(n).toFixed(2);
      return n < 0 ? `-$${abs}` : `$${abs}`;
    };

    // Construct AI prompt
    const pulse = data.pulseCheck;
    const cc = data.ccMetrics;
    const ratios = data.ratios;
    const leaks = data.leaks;

    const ccTable = cc.cards.map((c, idx) => {
      const winnerMarker = c.isWinner ? '★ WINNER' : ' ';
      const diffStr = c.isCurrent ? 'Current' : (c.diffFromCurrent >= 0 ? `+${fmtLocal(c.diffFromCurrent)}` : fmtLocal(c.diffFromCurrent));
      return `${idx + 1}. ${c.name.padEnd(35)} | Net: ${fmtLocal(c.net).padStart(8)} | Rewards: ${fmtLocal(c.rewards).padStart(8)} | Fee: ${fmtLocal(c.fees).padStart(6)} | vs. Current: ${diffStr.padStart(8)} ${winnerMarker}`;
    }).join('\n');

    const leaksText = leaks.length > 0 
      ? leaks.map(l => `- **${l.payee}**: ${l.count} visits, total spend ${fmtLocal(l.total)} (avg. ${fmtLocal(l.average)} per visit)`).join('\n')
      : 'No creeping leaks detected (high frequency, small transactions).';

    const ratiosText = `Fixed Spending: ${fmtLocal(ratios.fixed)} (${ratios.fixedRatio}%)\nVariable Spending: ${fmtLocal(ratios.variable)} (${ratios.variableRatio}%)`;

    const catBreakdownText = pulse.categoryBreakdown.map(c => `- **${c.name}**: ${fmtLocal(c.total)}`).join('\n');

    const prompt = `You are a financial advisor and coach. Your role is to provide empathetic, non-shaming, and mindful lifestyle observations based on the user's spending data.
    
=== SYSTEM DESIGN CONSTRAINTS ===
- DO NOT perform or modify any calculations yourself. The calculations are exact, deterministic, and provided below.
- Keep your tone completely objective, supportive, and non-judgmental. Do not use shaming or punitive language. Focus on observing habits and reflecting patterns.

=== CALCULATED INSIGHTS DATA ===
Focus Month: ${month}
Simulation Period: ${data.simPeriod.join(', ')}

1. PULSE CHECK
- Focus Month Spending: ${fmtLocal(pulse.actualSpend)}
- Rolling 3-Month Average Baseline: ${fmtLocal(pulse.baselineSpend)}
${pulse.isProrated ? `- Prorated Baseline (up to Day ${pulse.elapsedDays} of ${pulse.totalDays}): ${fmtLocal(pulse.compBaseline)}` : ''}
- Absolute Difference: ${pulse.diff >= 0 ? '+' : ''}${fmtLocal(pulse.diff)}
- Percentage Change vs Baseline: ${pulse.percentage >= 0 ? '+' : ''}${pulse.percentage}%
- Category Breakdown:
${catBreakdownText}

2. FIXED VS VARIABLE RATIO
${ratiosText}

3. CREEPING LEAKS (High frequency, low average cost)
${leaksText}

4. CREDIT CARD REWARD SIMULATION (Rolling 12 Months)
Total Credit Card Transactions: ${cc.ccTransactionsCount}
Total Credit Card Spend: ${fmtLocal(cc.totalCcSpend)}
Card Rankings (highest net benefit first):
${ccTable}

=== YOUR TASK ===
Generate the "Mindful Prompt" observations for the user based strictly on the data above.
Your response should be in clean Markdown and contain two short sections:
1. **Lifestyle Reflections**: Empathetic, data-backed observations about their spending momentum, fixed/variable ratio, or specific category accelerations. Avoid generic advice; refer directly to the numbers.
2. **Creeping Leaks & Commitments**: Point out any creeping small expenses (leaks) and what they add up to, framing it as an invitation to reflect on whether these choices align with their needs.

Do not repeat or recompute the credit card optimizer results in your section since they are shown separately. Focus entirely on behavioral coaching. Keep it concise, high-signal, and supportive.`;

    const aiOutput = callAI(prompt);
    data.aiInsights = aiOutput.trim();

    res.json(data);
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

// Resolvers for categories and payees using exact/fuzzy name matching
async function resolveCategoryUuid(name) {
  if (!name) return null;
  const categories = await api.getCategories();
  const exact = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.id;
  const fuzzy = categories.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
  if (fuzzy) return fuzzy.id;
  return null;
}

async function resolvePayeeUuid(name) {
  if (!name) return null;
  const payees = await api.getPayees();
  const exact = payees.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.id;
  const fuzzy = payees.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
  if (fuzzy) return fuzzy.id;
  return null;
}

// Helper: match transactions for filter preview
async function getMatchingTransactionsForFilter(filters) {
  const { data: allTxns } = await runQuery(
    q('transactions')
      .filter({ is_parent: false })
      .select(['id', 'account', 'date', 'amount', 'payee', 'category', 'notes'])
  );

  const accounts = await api.getAccounts();
  const payees = await api.getPayees();
  const categoriesList = await api.getCategories();
  
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  const catMap = Object.fromEntries(categoriesList.map(c => [c.id, c.name]));

  function resolveTxnPayeeName(t) {
    if (!t.payee) return '';
    const p = payeeMap[t.payee];
    if (!p) return '';
    return p.transfer_acct ? (accountMap[p.transfer_acct] || p.name) : p.name;
  }

  let matchedTxns = allTxns;

  if (filters.payee_name) {
    const matchPayee = filters.payee_name.toLowerCase();
    matchedTxns = matchedTxns.filter(t => {
      const payeeName = resolveTxnPayeeName(t).toLowerCase();
      return payeeName.includes(matchPayee);
    });
  }
  if (filters.category_name) {
    const matchCat = filters.category_name.toLowerCase();
    matchedTxns = matchedTxns.filter(t => {
      const catName = (t.category ? (catMap[t.category] || '') : '').toLowerCase();
      return catName.includes(matchCat);
    });
  }
  if (filters.startDate) {
    matchedTxns = matchedTxns.filter(t => t.date >= filters.startDate);
  }
  if (filters.endDate) {
    matchedTxns = matchedTxns.filter(t => t.date < filters.endDate);
  }

  return matchedTxns.map(t => ({
    id: t.id,
    date: t.date,
    payee: resolveTxnPayeeName(t),
    category: t.category ? (catMap[t.category] || '') : '',
    amount: t.amount / 100,
    account: accountMap[t.account] || '',
    notes: t.notes || ''
  }));
}

// Helper: match transactions for rule preview
async function getMatchingTransactionsForRule(conditions, conditionsOp = 'and') {
  const { data: allTxns } = await runQuery(
    q('transactions')
      .filter({ is_parent: false })
      .select(['id', 'account', 'date', 'amount', 'payee', 'category', 'notes'])
  );

  const accounts = await api.getAccounts();
  const payees = await api.getPayees();
  const categoriesList = await api.getCategories();
  
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  const catMap = Object.fromEntries(categoriesList.map(c => [c.id, c.name]));

  function resolveTxnPayeeName(t) {
    if (!t.payee) return '';
    const p = payeeMap[t.payee];
    if (!p) return '';
    return p.transfer_acct ? (accountMap[p.transfer_acct] || p.name) : p.name;
  }

  const matchesCondition = (t, cond) => {
    let fieldVal = '';
    if (cond.field === 'payee') {
      fieldVal = resolveTxnPayeeName(t);
    } else if (cond.field === 'category') {
      fieldVal = t.category ? (catMap[t.category] || '') : '';
    } else if (cond.field === 'amount') {
      fieldVal = String(t.amount / 100);
    } else if (cond.field === 'notes') {
      fieldVal = t.notes || '';
    }

    const val = String(cond.value).toLowerCase();
    const fVal = String(fieldVal).toLowerCase();

    if (cond.op === 'is') {
      return fVal === val;
    } else if (cond.op === 'contains') {
      return fVal.includes(val);
    }
    return false;
  };

  let matched = allTxns.filter(t => {
    if (conditionsOp === 'or') {
      return conditions.some(c => matchesCondition(t, c));
    } else {
      return conditions.every(c => matchesCondition(t, c));
    }
  });

  return matched.map(t => ({
    id: t.id,
    date: t.date,
    payee: resolveTxnPayeeName(t),
    category: t.category ? (catMap[t.category] || '') : '',
    amount: t.amount / 100,
    account: accountMap[t.account] || '',
    notes: t.notes || ''
  }));
}

// Helper: get correct database directory matching ACTUAL_SYNC_ID dynamically
function getDatabaseDir() {
  const syncId = process.env.ACTUAL_SYNC_ID;
  if (!syncId) return null;

  // Scan all subdirectories in CACHE_DIR
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      const dirPath = path.join(CACHE_DIR, file);
      if (fs.statSync(dirPath).isDirectory()) {
        const metaPath = path.join(dirPath, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (meta.groupId === syncId) {
            return dirPath;
          }
        }
      }
    }
  } catch (e) {
    console.error('Error scanning cache dir:', e.message);
  }
  return null;
}

// Helper: make automated database backup before modifications (as a secondary safety precaution)
function makeBackup() {
  const dbDir = getDatabaseDir();
  if (!dbDir) {
    console.warn('Could not find budget directory matching sync ID');
    return null;
  }
  const dbPath = path.join(dbDir, 'db.sqlite');
  if (!fs.existsSync(dbPath)) {
    console.warn('db.sqlite does not exist at:', dbPath);
    return null;
  }

  const backupDir = path.join(dbDir, 'advisor_backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  
  const backupFilename = `db-${dateStr}.sqlite`;
  const backupPath = path.join(backupDir, backupFilename);
  
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Automatic database backup created at: ${backupPath}`);
  return backupFilename;
}

// Helper: create an undo log for the action
function makeUndoLog(undoData) {
  const dbDir = getDatabaseDir();
  if (!dbDir) {
    console.warn('Could not find budget directory matching sync ID');
    return null;
  }

  const undoDir = path.join(dbDir, 'advisor_undo_logs');
  if (!fs.existsSync(undoDir)) {
    fs.mkdirSync(undoDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  
  const undoFilename = `undo-${dateStr}.json`;
  const undoPath = path.join(undoDir, undoFilename);
  
  fs.writeFileSync(undoPath, JSON.stringify(undoData, null, 2), 'utf8');
  console.log(`Undo log created at: ${undoPath}`);
  return undoFilename;
}

// Helper: apply programmatic undo
async function applyUndo(undoFilename) {
  const dbDir = getDatabaseDir();
  if (!dbDir) throw new Error('Database directory not found for sync ID');
  const undoDir = path.join(dbDir, 'advisor_undo_logs');
  const undoPath = path.join(undoDir, undoFilename);
  if (!fs.existsSync(undoPath)) {
    throw new Error(`Undo log file does not exist: ${undoPath}`);
  }

  const undoData = JSON.parse(fs.readFileSync(undoPath, 'utf8'));

  if (undoData.command === 'update_transactions') {
    console.log(`Undoing update_transactions for ${undoData.transactions.length} transaction(s)...`);
    for (const t of undoData.transactions) {
      await api.updateTransaction(t.id, {
        category: t.category || null,
        payee: t.payee || null,
        notes: t.notes || ''
      });
    }
    await api.sync();
    await buildLookups();
  } else if (undoData.command === 'create_rule') {
    console.log(`Undoing create_rule for rule ID: ${undoData.ruleId}...`);
    await api.deleteRule(undoData.ruleId);
    await api.sync();
    await buildLookups();
  } else {
    throw new Error(`Unknown command in undo log: ${undoData.command}`);
  }

  // Delete the undo log file
  fs.unlinkSync(undoPath);
  console.log(`Successfully completed undo and deleted log: ${undoFilename}`);
}

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

  const rawOutput = result.stdout.trim();
  try {
    const data = JSON.parse(rawOutput);
    res.json(data);
  } catch (err) {
    res.json({ insights: rawOutput, action: null });
  }
});

// POST /api/advisor/preview  { action }
app.post('/api/advisor/preview', async (req, res) => {
  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  try {
    let matched = [];
    if (action.command === 'update_transactions') {
      matched = await getMatchingTransactionsForFilter(action.filters || {});
    } else if (action.command === 'create_rule') {
      matched = await getMatchingTransactionsForRule(action.conditions || [], action.conditionsOp || 'and');
    } else {
      return res.status(400).json({ error: `Unknown command "${action.command}"` });
    }

    res.json({
      success: true,
      count: matched.length,
      transactions: matched.slice(0, 10), // Limit preview data size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/advisor/undo  { backupFile }
app.post('/api/advisor/undo', async (req, res) => {
  const undoFile = req.body.backupFile || req.body.undoFile;
  if (!undoFile) return res.status(400).json({ error: 'undoFile is required' });

  try {
    await applyUndo(undoFile);
    res.json({
      success: true,
      message: 'Database successfully reverted to pre-action state.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/advisor/execute  { action }
app.post('/api/advisor/execute', async (req, res) => {
  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  let backupFile = null;
  try {
    backupFile = makeBackup();
  } catch (backupErr) {
    console.error('Failed to create database backup before execution:', backupErr.message);
  }

  try {
    if (action.command === 'update_transactions') {
      let categoryId = null;
      let payeeId = null;

      if (action.updates.category_name) {
        categoryId = await resolveCategoryUuid(action.updates.category_name);
        if (!categoryId) {
          return res.status(400).json({ error: `Category "${action.updates.category_name}" not found.` });
        }
      }
      if (action.updates.payee_name) {
        payeeId = await resolvePayeeUuid(action.updates.payee_name);
        if (!payeeId) {
          payeeId = await api.createPayee({ name: action.updates.payee_name });
        }
      }

      // Fetch all transactions to filter
      const { data: allTxns } = await runQuery(
        q('transactions')
          .filter({ is_parent: false })
          .select(['id', 'account', 'date', 'amount', 'payee', 'category', 'notes'])
      );

      const accounts = await api.getAccounts();
      const payees = await api.getPayees();
      const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
      const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));

      function resolveTxnPayeeName(t) {
        if (!t.payee) return '';
        const p = payeeMap[t.payee];
        if (!p) return '';
        return p.transfer_acct ? (accountMap[p.transfer_acct] || p.name) : p.name;
      }

      let matchedTxns = allTxns;

      // Apply filters
      if (action.filters.payee_name) {
        const matchPayee = action.filters.payee_name.toLowerCase();
        matchedTxns = matchedTxns.filter(t => {
          const payeeName = resolveTxnPayeeName(t).toLowerCase();
          return payeeName.includes(matchPayee);
        });
      }
      if (action.filters.category_name) {
        const categoriesList = await api.getCategories();
        const catMap = Object.fromEntries(categoriesList.map(c => [c.id, c.name]));
        const matchCat = action.filters.category_name.toLowerCase();
        matchedTxns = matchedTxns.filter(t => {
          const catName = (t.category ? (catMap[t.category] || '') : '').toLowerCase();
          return catName.includes(matchCat);
        });
      }
      if (action.filters.startDate) {
        matchedTxns = matchedTxns.filter(t => t.date >= action.filters.startDate);
      }
      if (action.filters.endDate) {
        matchedTxns = matchedTxns.filter(t => t.date < action.filters.endDate);
      }

      if (matchedTxns.length === 0) {
        return res.json({ success: true, updatedCount: 0, message: 'No transactions matched the filters.', backupFile });
      }

      // Capture original state for undo
      const undoData = {
        command: 'update_transactions',
        transactions: matchedTxns.map(t => ({
          id: t.id,
          category: t.category || null,
          payee: t.payee || null,
          notes: t.notes || ''
        }))
      };
      const undoFile = makeUndoLog(undoData);

      // Update matching transactions
      for (const t of matchedTxns) {
        const updates = {};
        if (categoryId) updates.category = categoryId;
        if (payeeId) updates.payee = payeeId;
        if (action.updates.notes !== undefined) updates.notes = action.updates.notes;
        await api.updateTransaction(t.id, updates);
      }

      await api.sync();
      await buildLookups();

      return res.json({
        success: true,
        updatedCount: matchedTxns.length,
        message: `Successfully updated ${matchedTxns.length} transaction(s).`,
        backupFile: undoFile
      });

    } else if (action.command === 'create_rule') {
      let stage = action.stage;
      if (stage !== 'pre' && stage !== 'post') {
        stage = null;
      }
      const rule = {
        stage: stage,
        conditionsOp: action.conditionsOp || 'and',
        conditions: [],
        actions: []
      };

      // Resolve conditions
      for (const cond of action.conditions) {
        let val = cond.value;
        if (cond.field === 'payee' && (cond.op === 'is' || cond.op === 'contains')) {
          const pId = await resolvePayeeUuid(val);
          if (pId) val = pId;
          else if (cond.op === 'is') {
            val = await api.createPayee({ name: val });
          }
        } else if (cond.field === 'category' && cond.op === 'is') {
          const cId = await resolveCategoryUuid(val);
          if (cId) val = cId;
          else {
            return res.status(400).json({ error: `Category "${val}" not found in condition.` });
          }
        }
        rule.conditions.push({ field: cond.field, op: cond.op, value: val });
      }

      // Resolve actions
      for (const act of action.actions) {
        let val = act.value;
        if (act.field === 'category' && act.op === 'set') {
          const cId = await resolveCategoryUuid(val);
          if (cId) val = cId;
          else {
            return res.status(400).json({ error: `Category "${val}" not found in action.` });
          }
        } else if (act.field === 'payee' && act.op === 'set') {
          const pId = await resolvePayeeUuid(val);
          if (pId) val = pId;
          else {
            val = await api.createPayee({ name: val });
          }
        }
        rule.actions.push({ field: act.field, op: act.op, value: val });
      }

      const createdRule = await api.createRule(rule);
      await api.sync();
      await buildLookups();

      const undoData = {
        command: 'create_rule',
        ruleId: createdRule.id
      };
      const undoFile = makeUndoLog(undoData);

      return res.json({
        success: true,
        ruleId: createdRule.id,
        message: `Successfully created new rule.`,
        backupFile: undoFile
      });

    } else {
      return res.status(400).json({ error: `Unknown command "${action.command}"` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
