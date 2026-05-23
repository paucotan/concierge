require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.BUDGET_CACHE_DIR || path.join(process.cwd(), '.actual-cache');

// Suppress @actual-app/api debug output ([Breadcrumb], sync logs) from stdout
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function countUncategorized() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  const payees = await api.getPayees();
  const transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));

  const { data } = await runQuery(
    q('transactions')
      .filter({ 'category': null, 'is_parent': false })
      .select(['id', 'payee'])
  );

  const count = data.filter(t => !transferPayees.has(t.payee)).length;

  await api.shutdown();
  process.stdout.write = _origWrite;
  console.log(count);
}

countUncategorized().catch(() => {
  process.exit(1);
});
