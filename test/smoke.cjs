// Chequea el servidor MCP sin abrir navegador: tools, schemas y catalogo.
const { server } = require('../src/index.cjs');
const catalog = require('../src/catalog.cjs');

const expected = ['list_devices', 'screenshot_on', 'preview_devices', 'check_responsive', 'interact_on', 'emulator_status', 'open_responsive_session', 'list_responsive_sessions', 'observe_responsive_session', 'navigate_responsive_session', 'interact_responsive_session', 'close_responsive_session'];
let fails = 0;
const t = (label, cond, detail) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond || !detail ? '' : ' -> ' + JSON.stringify(detail).slice(0, 300)));
  if (!cond) fails++;
};

const registered = Object.keys(server._registeredTools).sort();
t('12 tools registradas', registered.length === 12 && expected.every((n) => registered.includes(n)), registered);
t('catalogo curado >= 17 pantallas', catalog.listAll().length >= 17);
t('default preview set valido', catalog.DEFAULT_PREVIEW.every((id) => { try { catalog.resolve(id); return true; } catch { return false; } }));
t('todos los ids resuelven en vertical y horizontal', catalog.CATALOG.every((e) => {
  try { catalog.resolve(e.id); catalog.resolve(e.id + '-landscape'); return true; } catch { return false; }
}));
t('rechaza ids inventados', (() => { try { catalog.resolve('nokia-3310'); return false; } catch { return true; } })());
t('requiere node >= 20 para fetch/globalThis', Number(process.versions.node.split('.')[0]) >= 20);

console.log(fails ? `\nfallo en ${fails}` : '\nsmoke ok');
process.exit(fails ? 1 : 0);
