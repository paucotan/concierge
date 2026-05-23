require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.BUDGET_CACHE_DIR || path.join(process.cwd(), '.actual-cache');

const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function syncOnly() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
  await api.runBankSync();
  await api.shutdown();

  process.stdout.write = _origWrite;
  console.log('Synced.');
}

syncOnly().catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
