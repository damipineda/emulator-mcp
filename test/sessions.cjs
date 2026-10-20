const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  let checks = 0;
  const check = (label, value) => { assert.ok(value, label); checks++; console.log('ok ' + label); };
  const fixture = http.createServer((req, res) => {
    if (req.url === '/missing') { res.writeHead(404); res.end('Missing'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'fixture-responsive.html')));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const client = new Client({ name: 'session-e2e', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '../src/index.cjs')], stderr: 'pipe' });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...JSON.parse(result.content.find(c => c.type === 'text').text), isError: !!result.isError, images: result.content.filter(c => c.type === 'image').length };
  };
  let dashboardUrl;
  try {
    await client.connect(transport);
    const url = `http://127.0.0.1:${fixture.address().port}/`;
    const invalid = await call('open_responsive_session', { url: 'file:///tmp/a', devices: ['iphone-se'] });
    check('rechaza URL no web antes de abrir pantallas', invalid.isError);
    const opened = await call('open_responsive_session', { url, devices: ['iphone-se', 'ipad-pro-11', 'laptop'] });
    check('abre tres tamaños en el mismo MCP por stdio', opened.screens?.length === 3);
    const sessionId = opened.sessionId;
    dashboardUrl = opened.dashboardUrl;
    check('todas las pantallas cargan la misma URL', opened.screens.every(s => s.finalUrl === url));
    check('lista conserva la sesion entre llamadas', (await call('list_responsive_sessions')).sessions[0].sessionId === sessionId);
    const panel = await fetch(dashboardUrl);
    check('panel local accesible', panel.ok && (await panel.text()).includes('Una página. Varias pantallas.'));
    const denied = await fetch(new URL('/state', dashboardUrl));
    check('panel exige ruta privada de la sesion', denied.status === 404);
    const state = await (await fetch(new URL('state', dashboardUrl))).json();
    check('panel muestra tres tamaños reales', state.screens.length === 3 && new Set(state.screens.map(s => s.viewport.width)).size === 3);
    const png = await fetch(new URL('screen/screen-1', dashboardUrl));
    check('panel entrega captura PNG real', png.ok && (await png.arrayBuffer()).byteLength > 4000);
    const typed = await call('interact_responsive_session', { sessionId, steps: [{ action: 'type', selector: '#nombre', value: 'Ana' }] });
    check('repite entrada en todas las pantallas', typed.ok && typed.results.length === 3);
    const clicked = await call('interact_responsive_session', { sessionId, steps: [{ action: 'click', selector: '#confirmar' }] });
    check('segunda llamada usa el estado anterior', clicked.ok);
    const observed = await call('observe_responsive_session', { sessionId, dom: true, audit: true, returnImages: true });
    check('agente recibe imagen por tamaño', observed.images === 3);
    check('agente observa resultado persistente por DOM', observed.screens.every(s => s.dom.includes('Turno confirmado para Ana')));
    check('auditoria disponible por tamaño', observed.screens.every(s => s.audit?.viewport));
    const first = opened.screens[0].screenId;
    await call('interact_responsive_session', { sessionId, screenId: first, steps: [{ action: 'type', selector: '#nombre', value: 'Solo movil' }] });
    const isolated = await call('interact_responsive_session', { sessionId, steps: [{ action: 'eval', expression: 'document.querySelector("#nombre").value' }] });
    check('accion individual no cambia las otras pantallas', isolated.results[0].results[0].value === 'Solo movil' && isolated.results[1].results[0].value === 'Ana');
    await call('interact_responsive_session', { sessionId, screenId: first, steps: [{ action: 'eval', expression: '(async () => { console.error("session-test-error"); await fetch("/missing"); return true; })()' }] });
    const events = await call('observe_responsive_session', { sessionId });
    check('captura consola y HTTP fallidos por pantalla', events.screens[0].events.some(e => e.message.includes('session-test-error')) && events.screens[0].events.some(e => e.type === 'http_error'));
    check('eventos de una pantalla no se mezclan con otras', !events.screens[1].events.some(e => e.message.includes('session-test-error')));
    const failure = await call('interact_responsive_session', { sessionId, steps: [{ action: 'assert', text: 'Texto inexistente' }] });
    check('fallos se informan por pantalla', !failure.ok && failure.results.every(s => !s.ok));
    const badTarget = await call('interact_responsive_session', { sessionId, screenId: 'missing', steps: [{ action: 'reload' }] });
    check('rechaza screenId inexistente', badTarget.isError);
    const changed = await call('navigate_responsive_session', { sessionId, url: url + '?updated=1' });
    check('navega todas juntas', changed.ok && changed.screens.every(s => s.finalUrl.endsWith('?updated=1')));
    const errors = await call('navigate_responsive_session', { sessionId, url: url + 'missing' });
    check('404 no se reporta como exito', !errors.ok && errors.results.every(r => r.status === 404));
    const closed = await call('close_responsive_session', { sessionId });
    check('cierre libera la sesion', closed.closed && (await call('list_responsive_sessions')).sessions.length === 0);
    check('sesion cerrada ya no acepta acciones', (await call('observe_responsive_session', { sessionId })).isError);
    let unreachable = false;
    try { await fetch(dashboardUrl); } catch { unreachable = true; }
    check('cierre apaga el panel', unreachable);
    // Leave a session open to verify transport disconnect cleanup as well.
    dashboardUrl = (await call('open_responsive_session', { url, devices: ['laptop'] })).dashboardUrl;
    await client.close();
    let stopped = false;
    for (let i = 0; i < 30; i++) {
      try { await fetch(dashboardUrl); await new Promise(r => setTimeout(r, 100)); }
      catch { stopped = true; break; }
    }
    check('desconectar MCP cierra sesiones y paneles', stopped);
    console.log(`${checks} comprobaciones de sesiones pasaron`);
  } finally {
    await client.close();
    await new Promise(resolve => fixture.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
