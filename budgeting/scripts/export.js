require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.actual-cache');

// Suppress @actual-app/api debug output ([Breadcrumb], sync logs) from stdout
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function exportTransactions() {
  // ── 1. Connect to Actual Budget ──────────────────────────
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  console.log('Connecting to Actual Budget...');
  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  console.log('Downloading budget...');
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  // ── 2. Build lookup tables ────────────────────────────────
  const accounts   = await api.getAccounts();
  const payees     = await api.getPayees();
  const categories = await api.getCategories();

  const accountMap  = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const payeeMap    = Object.fromEntries(payees.map(p => [p.id, p]));

  // ── 3. Fetch all transactions ─────────────────────────────
  console.log('Fetching transactions...');
  const { data: transactions } = await runQuery(
    q('transactions')
      .select(['id', 'account', 'date', 'amount', 'payee', 'notes', 'category', 'cleared', 'is_parent', 'is_child'])
  );

  // ── 4. Build CSV rows ─────────────────────────────────────
  const header = ['Account', 'Date', 'Payee', 'Notes', 'Category', 'Amount', 'Split_Amount', 'Cleared'];
  const rows = [header];

  for (const t of transactions) {
    if (t.is_parent) continue; // skip split containers, include the child rows

    const accountName = accountMap[t.account] || '';

    // For transfer payees, use the destination account name
    let payeeName = '';
    if (t.payee) {
      const payee = payeeMap[t.payee];
      if (payee) {
        payeeName = payee.transfer_acct
          ? (accountMap[payee.transfer_acct] || payee.name)
          : payee.name;
      }
    }

    const categoryName = t.category ? (categoryMap[t.category] || '') : '';
    const amount       = t.amount / 100;
    const splitAmount  = t.is_child ? amount : 0;
    const cleared      = t.cleared ? 'Cleared' : 'Not cleared';

    rows.push([accountName, t.date, payeeName, t.notes || '', categoryName, amount, splitAmount, cleared]);
  }

  // ── 5. Convert to CSV string ──────────────────────────────
  const csv = rows.map(row =>
    row.map(cell => {
      const s = String(cell == null ? '' : cell);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',')
  ).join('\n');

  await api.shutdown();

  // Restore stdout now that API noise is done
  process.stdout.write = _origWrite;

  // ── 6. Upload to Google Drive ─────────────────────────────
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const folderId = process.env.GDRIVE_FOLDER_ID;

  // Check if file already exists in the folder
  const existing = await drive.files.list({
    q: `name = 'All-Accounts.csv' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id, name)',
  });

  const { Readable } = require('stream');
  const media = { mimeType: 'text/csv', body: Readable.from([csv]) };

  if (existing.data.files.length > 0) {
    await drive.files.update({
      fileId: existing.data.files[0].id,
      media,
    });
    console.log(`Exported ${rows.length - 1} transactions. Updated All-Accounts.csv in Google Drive.`);
  } else {
    await drive.files.create({
      requestBody: { name: 'All-Accounts.csv', parents: [folderId] },
      media,
    });
    console.log(`Exported ${rows.length - 1} transactions. Created All-Accounts.csv in Google Drive.`);
  }
}

exportTransactions().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
