const fs = require('node:fs');
const path = require('node:path');
const { parse, modify, applyEdits } = require('jsonc-parser');
const { version } = require('../package.json');

const PACKAGE_URL = `https://github.com/damipineda/emulator-mcp/archive/refs/tags/v${version}.tar.gz`;

function configuration(agent, cwd) {
  const run = ['-y', `--package=${PACKAGE_URL}`, 'emulator-mcp'];
  const stdio = { type: 'stdio', command: 'npx', args: run };
  switch (agent) {
    case 'opencode': {
      const json = path.join(cwd, 'opencode.json');
      const jsonc = path.join(cwd, 'opencode.jsonc');
      if (fs.existsSync(json) && fs.existsSync(jsonc)) throw new Error('Both opencode.json and opencode.jsonc exist. Choose one config before installing.');
      return { file: fs.existsSync(jsonc) ? jsonc : json, key: 'mcp', entry: { type: 'local', command: ['npx', ...run], enabled: true, timeout: 60000 } };
    }
    case 'cursor': return { file: path.join(cwd, '.cursor/mcp.json'), key: 'mcpServers', entry: stdio };
    case 'claude-code': return { file: path.join(cwd, '.mcp.json'), key: 'mcpServers', entry: stdio };
    case 'vscode': return { file: path.join(cwd, '.vscode/mcp.json'), key: 'servers', entry: stdio };
    default: throw new Error('Choose an agent: opencode, cursor, claude-code, vscode. See README for the native Codex command.');
  }
}

function install(agent, { cwd = process.cwd(), dryRun = false } = {}) {
  const config = configuration(agent, cwd);
  const exists = fs.existsSync(config.file);
  const source = exists ? fs.readFileSync(config.file, 'utf8') : '{}\n';
  const errors = [];
  const parsed = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`Invalid JSON/JSONC: ${config.file}. Nothing was changed.`);
  const group = parsed[config.key];
  if (group !== undefined && (!group || Array.isArray(group) || typeof group !== 'object')) throw new Error(`Invalid ${config.key} object. Nothing was changed.`);
  const current = group?.['emulator-mcp'];
  if (current !== undefined) {
    if (JSON.stringify(current) === JSON.stringify(config.entry)) {
      console.log(`Already configured: ${config.file}`);
      return { ...config, changed: false };
    }
    throw new Error(`An emulator-mcp entry already exists in ${config.file}. Remove or rename that entry first; it was not overwritten.`);
  }
  const output = applyEdits(source, modify(source, [config.key, 'emulator-mcp'], config.entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes('\r\n') ? '\r\n' : '\n' },
  }));
  if (dryRun) {
    console.log(`Config: ${config.file}\n${output}`);
    return { ...config, changed: false, output };
  }
  fs.mkdirSync(path.dirname(config.file), { recursive: true });
  if (exists) fs.copyFileSync(config.file, `${config.file}.${Date.now()}.bak`, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(config.file, output);
  console.log(`Configured ${agent}: ${config.file}\nRestart or reconnect your agent to load the 12 MCP tools.\nEach agent may ask you to trust the server. No client connection has been tested by this installer.`);
  return { ...config, changed: true };
}

module.exports = { install, configuration, PACKAGE_URL };
