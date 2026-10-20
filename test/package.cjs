const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'distribution-check', version: '1' });
  const { name, version } = require('../package.json');
  const pkg = process.argv[2] || path.resolve(__dirname, `../${name}-${version}.tgz`);
  const transport = new StdioClientTransport({ command: 'npx', args: ['-y', `--package=${pkg}`, 'emulator-mcp'], stderr: 'pipe' });
  transport.stderr.on('data', data => process.stderr.write(data));
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 12);
    const result = await client.callTool({ name: 'emulator_status', arguments: {} });
    const status = JSON.parse(result.content[0].text);
    assert.ok(status.captureDir.includes('.emulator-mcp'));
    console.log(JSON.stringify({ distribution: pkg, tools: tools.tools.length, captureDir: status.captureDir }));
  } finally { await client.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
