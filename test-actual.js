const api = require('@actual-app/api');
async function run() {
  try {
    await api.init({
      dataDir: './tmp-cache',
      serverURL: 'http://localhost:5007',
      password: 'Polo270392',
    });
    const files = await api.getRemoteFiles();
    console.log(JSON.stringify(files, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
run();