const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sessions = require('../src/sessions.cjs');
const browser = require('../src/browser.cjs');
let fixture;
async function stop() {
  await sessions.shutdown();
  await browser.shutdown();
  if (fixture) fixture.close();
}
async function main() {
  let url = process.argv[2];
  if (!url) {
    fixture = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(__dirname, '../test/fixture-responsive.html')));
    });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${fixture.address().port}/`;
  }
  const result = await sessions.open({ url });
  console.log(JSON.stringify(result, null, 2));
  process.on('SIGINT', () => stop().then(() => process.exit()));
  process.on('SIGTERM', () => stop().then(() => process.exit()));
}
main().catch(async err => { console.error(err); await stop(); process.exitCode = 1; });
