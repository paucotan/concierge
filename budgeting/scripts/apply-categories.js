require('dotenv').config({ quiet: true });
const api = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.actual-cache');

// Suppress @actual-app/api debug output ([Breadcrumb], sync logs) from stdout
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function applyCategories() {
  // Read JSON from stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

  let count = 0;
  for (const { transaction_id, category_id } of input) {
    if (transaction_id && category_id) {
      await api.updateTransaction(transaction_id, { category: category_id });
      count++;
    }
  }

  await api.shutdown();
  process.stdout.write = _origWrite;
  console.log(count);
}

applyCategories().catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
