#!/usr/bin/env node
const path = require('node:path');
const os = require('node:os');
const { version } = require('../package.json');
const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-v') {
  console.log(version);
} else if (command === '--help' || command === '-h') {
  console.log(`emulator-mcp ${version}

Usage:
  emulator-mcp                         Start the MCP server over stdio
  emulator-mcp install <agent>         Configure this project
  emulator-mcp install <agent> --dry-run  Print config without writing
  emulator-mcp demo [http://localhost:3000]  Open a persistent comparison

Install targets: opencode, cursor, claude-code, vscode
Requires Node.js >=20 and Chrome or Edge. No API key required.
Codex: see https://github.com/damipineda/emulator-mcp#installation`);
} else if (command === 'install') {
  try { require('../src/install.cjs').install(args[1], { dryRun: args.includes('--dry-run') }); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
} else if (!command || command === 'serve' || command === 'demo') {
  // Keep user captures outside npx's disposable package cache.
  process.env.EMULATOR_MCP_CAPTURE_DIR ||= path.join(os.homedir(), '.emulator-mcp', 'captures');
  if (command === 'demo') {
    process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
    require('../demo/session.cjs');
  } else {
    require('../src/index.cjs').main().catch(err => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
} else {
  console.error(`Unknown command: ${command}. Run emulator-mcp --help.`);
  process.exitCode = 1;
}
