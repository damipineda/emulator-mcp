const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('jsonc-parser');
const { install, PACKAGE_SPEC } = require('../src/install.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-install-'));
let count = 0;
function check(label, condition) { assert.ok(condition, label); count++; console.log('ok ' + label); }

for (const agent of ['opencode', 'cursor', 'claude-code', 'vscode']) {
  const cwd = path.join(root, agent);
  const installed = install(agent, { cwd });
  const data = parse(fs.readFileSync(installed.file, 'utf8'));
  const entry = data[installed.key]['emulator-mcp'];
  const commandArgs = agent === 'opencode' ? entry.command.slice(1) : entry.args;
  check(`${agent}: usa nombre corto del registro npm`, JSON.stringify(commandArgs) === JSON.stringify(['-y', PACKAGE_SPEC]));
  const before = fs.readFileSync(installed.file, 'utf8');
  check(`${agent}: segunda instalacion no modifica`, !install(agent, { cwd }).changed && fs.readFileSync(installed.file, 'utf8') === before);
}
const cwd = path.join(root, 'preserve');
fs.mkdirSync(cwd);
const file = path.join(cwd, 'opencode.jsonc');
const original = '{\n  // Keep my providers\n  "model": "provider/model",\n  "mcp": { "other": { "type": "local", "command": ["other"] } },\n}\n';
fs.writeFileSync(file, original);
install('opencode', { cwd });
const modified = fs.readFileSync(file, 'utf8');
check('preserva comentarios, proveedores y otros MCP', modified.includes('// Keep my providers') && parse(modified).model === 'provider/model' && parse(modified).mcp.other.command[0] === 'other');
const backup = fs.readdirSync(cwd).find(f => f.endsWith('.bak'));
check('respalda el archivo original', backup && fs.readFileSync(path.join(cwd, backup), 'utf8') === original);
const dryCwd = path.join(root, 'dry');
install('cursor', { cwd: dryCwd, dryRun: true });
check('dry-run no crea archivos', !fs.existsSync(dryCwd));
fs.writeFileSync(file, '{"mcp":{"emulator-mcp":{"command":"custom"}}}');
assert.throws(() => install('opencode', { cwd }), /already exists/);
check('no reemplaza entrada diferente existente', parse(fs.readFileSync(file, 'utf8')).mcp['emulator-mcp'].command === 'custom');
fs.writeFileSync(file, '{invalid json');
assert.throws(() => install('opencode', { cwd }), /Invalid JSON/);
check('configuracion invalida queda intacta', fs.readFileSync(file, 'utf8') === '{invalid json');
assert.throws(() => install('unknown', { cwd }), /Choose an agent/);
check('rechaza agente desconocido', true);
console.log(`${count} comprobaciones de instalacion pasaron. Temporary fixtures: ${root}`);
