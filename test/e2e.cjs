const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { server } = require('../src/index.cjs');
const browser = require('../src/browser.cjs');

const PORT = 8731;
const FIXTURE = path.join(__dirname, 'fixture.html');
let pass = 0;
let failCount = 0;

function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { failCount++; console.log('  FAIL ' + label + (detail ? ' -> ' + JSON.stringify(detail).slice(0, 400) : '')); }
}

function startFixtureServer() {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const srv = http.createServer((req, res) => {
    if (req.url === '/broken') { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }
  return { isError: Boolean(res.isError), payload, imageParts: (res.content || []).filter((c) => c.type === 'image').length };
}

(async () => {
  const srv = await startFixtureServer();
  const url = `http://127.0.0.1:${PORT}/`;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(clientTransport);

  console.log('\n[1] handshakes y tools');
  const tools = await client.listTools();
  check('expone 12 tools', tools.tools.length === 12, tools.tools.map((t) => t.name));
  const described = tools.tools.every((t) => (t.description || '').length > 120);
  check('todas las tools traen descripcion usable', described);

  console.log('\n[2] list_devices');
  const list = await call(client, 'list_devices', {});
  check('devuelve catalogo', list.payload.count >= 17, list.payload.count);
  const iphoneSe = list.payload.devices.find((d) => d.id === 'iphone-se');
  check('iphone-se es 320x568 dpr2', iphoneSe && iphoneSe.width === 320 && iphoneSe.deviceScaleFactor === 2, iphoneSe);
  const only = await call(client, 'list_devices', { group: 'tablet' });
  check('filtro por group=tablet', only.payload.devices.every((d) => d.group === 'tablet') && only.payload.devices.length >= 3);

  console.log('\n[3] screenshot_on en pantalla chica (debe detectar el desborde)');
  const shot = await call(client, 'screenshot_on', { url, device: 'iphone-se', name: 'e2e-se', settleMs: 120 });
  check('sin error', !shot.isError, shot.payload);
  check('png escrito en disco', shot.payload.path && fs.existsSync(shot.payload.path), shot.payload.path);
  check('png con contenido real', shot.payload.bytes > 4000, shot.payload.bytes);
  check('emula mobile con UA de iPhone', shot.payload.device.mobile === true && /iPhone/.test(shot.payload.userAgent), shot.payload.userAgent);
  check('detecta desborde horizontal', shot.payload.horizontalOverflowPx > 150, shot.payload.horizontalOverflowPx);
  check('detecta layout expandido (zoom forzado)', shot.payload.layoutViewportExpandedPx > 500, shot.payload.layoutViewportExpandedPx);
  const offenderCodes = (shot.payload.findings || []).map((f) => f.code);
  check('hallazgo horizontal_overflow', offenderCodes.includes('horizontal_overflow'), offenderCodes);
  check('hallazgo layout_viewport_expanded', offenderCodes.includes('layout_viewport_expanded'), offenderCodes);
  check('culpa al selector correcto', (shot.payload.audit.offenders || []).some((o) => /tarjeta-ancho/.test(o.selector)), shot.payload.audit.offenders);
  check('detecta contenido cortado por overflow-x', offenderCodes.includes('content_cut_by_overflow'), shot.payload.audit.cutContainers);
  check('marca texto recortado', offenderCodes.includes('clipped_text'), offenderCodes);
  check('marca target tocable chico', offenderCodes.includes('small_tap_target'), offenderCodes);
  check('marca imagen fuera de viewport', offenderCodes.includes('image_overflow'), offenderCodes);

  console.log('\n[4] screenshot_on con viewport explicito + landscape');
  const custom = await call(client, 'screenshot_on', { url, viewport: { width: 380, height: 700 }, name: 'e2e-custom' });
  check('viewport custom funciona', !custom.isError && custom.payload.device.viewport.width === 380, custom.payload.device);
  const land = await call(client, 'screenshot_on', { url, device: 'galaxy-s24-landscape', name: 'e2e-land' });
  check('landscape invierte el viewport', !land.isError && land.payload.device.viewport.width === 780, land.payload.device?.viewport);

  console.log('\n[5] preview_devices en paralelo');
  const preview = await call(client, 'preview_devices', { url, devices: ['iphone-15-max', 'ipad-pro-11', 'laptop'], settleMs: 100 });
  check('3 capturas', preview.payload.captures.length === 3, preview.payload.summary);
  check('todos los png existen', preview.payload.captures.every((c) => c.path && fs.existsSync(c.path)));
  check('iphone-15-max con overflow por la tabla de 620px',
    preview.payload.captures.find((c) => c.device === 'iphone-15-max').horizontalOverflowPx > 150);
  check('laptop sin overflow', preview.payload.captures.find((c) => c.device === 'laptop').horizontalOverflowPx === 0);

  console.log('\n[6] check_responsive (sin imagenes)');
  const audit = await call(client, 'check_responsive', { url, devices: ['iphone-se', 'desktop-hd'], includeMediaQueries: true, settleMs: 100 });
  check('veredicto FALLA', audit.payload.verdict === 'FALLA', audit.payload.totals);
  check('iphone-se en lista de fallas', audit.payload.failingDevices.includes('iphone-se'), audit.payload.failingDevices);
  const hd = audit.payload.screens.find((s) => s.device === 'desktop-hd');
  check('desktop-hd sin desborde', hd.horizontalOverflowPx === 0, hd.horizontalOverflowPx);
  check('media queries matched por breakpoint', (hd.matchedMedia || []).some((m) => m.includes('768')), hd.matchedMedia);
  const se = audit.payload.screens.find((s) => s.device === 'iphone-se');
  check('iphone-se matchea max-width:380px', (se.matchedMedia || []).some((m) => m.includes('380')), se.matchedMedia);
  check('no deja pngs de auditoria', !fs.readdirSync(path.join(__dirname, '..', 'captures')).some((f) => f.startsWith('2') && f.includes('audit-')));

  console.log('\n[7] interact_on: flujo de reserva');
  const flow = await call(client, 'interact_on', {
    url,
    device: 'galaxy-s24',
    name: 'e2e-flow',
    steps: [
      { action: 'click', selector: '#link-reservar' },
      { action: 'type', selector: '#nombre', value: 'Ana Ocampos' },
      { action: 'click', selector: '#confirmar' },
      { action: 'assert', text: 'Turno confirmado para Ana Ocampos' },
      { action: 'get_text', selector: '#confirmada' },
      { action: 'count', selector: 'table.ancha td' },
      { action: 'eval', expression: '({ w: window.innerWidth, device: window.visualViewport.width, scroll: document.documentElement.scrollWidth })' },
      { action: 'scroll', to: 'bottom' },
      { action: 'set_viewport', width: 380, height: 800 },
      { action: 'screenshot', name: 'e2e-flow-final' },
    ],
  });
  check('flujo completo ok', flow.payload.ok === true, flow.payload.steps?.find((s) => !s.ok));
  check('assert encontro el texto', flow.payload.steps.some((s) => s.action === 'assert' && s.ok));
  check('get_text devuelve el texto', JSON.stringify(flow.payload.steps).includes('Ana Ocampos'));
  check('eval mide la pantalla real via visualViewport', flow.payload.steps.find((s) => s.action === 'eval')?.value?.device === 360, flow.payload.steps.find((s) => s.action === 'eval'));
  check('window.innerWidth sigue siendo el layout expandido', flow.payload.steps.find((s) => s.action === 'eval')?.value?.w > 360);
  check('set_viewport aplica 380px', flow.payload.steps.find((s) => s.action === 'set_viewport')?.viewport?.width === 380);
  check('captura final guardada', flow.payload.finalScreenshot === null ? fs.existsSync(flow.payload.steps.at(-1).path) : fs.existsSync(flow.payload.finalScreenshot.path));

  console.log('\n[8] errores esperados');
  const badDevice = await call(client, 'screenshot_on', { url, device: 'nokia-3310' });
  check('dispositivo inexistente -> isError con sugerencia', badDevice.isError && /list_devices/.test(badDevice.payload.error), badDevice.payload);
  const badUrl = await call(client, 'screenshot_on', { url: 'file:///C:/Windows/win.ini', device: 'iphone-se' });
  check('rechaza file://', badUrl.isError && /http\/https/.test(badUrl.payload.error), badUrl.payload);
  const noTarget = await call(client, 'interact_on', { url, device: 'iphone-se', steps: [{ action: 'click', selector: '#no-existe' }] });
  check('localizador inexistente reporta el paso', noTarget.payload.ok === false && noTarget.payload.stoppedAt === 0, noTarget.payload);
  const notFoundPage = await call(client, 'screenshot_on', { url: `http://127.0.0.1:${PORT}/broken`, device: 'iphone-se' });
  check('pagina 404 no rompe y informa status', notFoundPage.payload.status === 404, notFoundPage.payload);

  console.log('\n[9] navegador real de sistema');
  const status = await call(client, 'emulator_status', {});
  check('usa chrome/edge del sistema', ['chrome', 'msedge'].includes(status.payload.browser.channel), status.payload);
  check('headless por defecto', status.payload.browser.headless === true);

  await client.close();
  await browser.shutdown();
  srv.close();
  console.log(`\npasaron ${pass}, fallaron ${failCount}`);
  process.exit(failCount ? 1 : 0);
})().catch(async (err) => {
  console.error('e2e rompio:', err.stack || err.message);
  await browser.shutdown();
  process.exit(1);
});
