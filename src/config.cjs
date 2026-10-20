const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');

function captureDir() {
  return process.env.EMULATOR_MCP_CAPTURE_DIR || path.join(ROOT, 'captures');
}

function browserChannel() {
  const v = (process.env.EMULATOR_MCP_BROWSER || 'chrome,msedge,chromium')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return v.length ? v : ['chrome', 'msedge', 'chromium'];
}

function headless() {
  return process.env.EMULATOR_MCP_HEADED ? false : true;
}

function slug(input, max = 32) {
  const base = String(input)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (base.slice(0, max) || 'page');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveCapturePath(name) {
  const dir = captureDir();
  const target = path.resolve(dir, name);
  const normalizedDir = path.resolve(dir) + path.sep;
  if (!target.startsWith(normalizedDir)) {
    throw new Error(`capture "${name}" apunta fuera de ${dir}`);
  }
  return target;
}

function tmpProfileDir(id) {
  return path.join(os.tmpdir(), 'emulator-mcp', `profile-${id}`);
}

module.exports = { ROOT, captureDir, browserChannel, headless, slug, stamp, resolveCapturePath, tmpProfileDir };
