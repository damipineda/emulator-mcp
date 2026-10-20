const { randomUUID, randomBytes } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const browser = require('./browser.cjs');
const catalog = require('./catalog.cjs');
const { openUrl, assertHttpUrl } = require('./navigate.cjs');
const { runSteps, shoot } = require('./steps.cjs');
const { auditPage } = require('./audit.cjs');

const sessions = new Map();

function get(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Sesion inexistente o cerrada. Usa open_responsive_session.');
  return session;
}

// MCP calls and panel captures share a queue: screenshots never race actions.
function exclusive(session, action) {
  const job = session.pending.then(() => {
    if (session.closed) throw new Error('Sesion cerrada');
    return action();
  });
  session.pending = job.catch(() => {});
  return job;
}

function describe(session) {
  return {
    sessionId: session.id, url: session.url, dashboardUrl: session.dashboardUrl,
    screens: session.screens.map(s => ({
      screenId: s.id, device: s.device.id, label: s.device.label,
      viewport: s.page.viewportSize(), finalUrl: s.page.url(),
    })),
  };
}

async function snapshot(session, opts = {}) {
  const screens = [];
  for (const s of session.screens) {
    try {
      const image = await s.page.screenshot({ scale: 'css', timeout: 10000 });
      s.image = image;
      const audit = opts.audit ? await auditPage(s.page, { deviceWidth: s.page.viewportSize().width }) : undefined;
      const capture = opts.save ? await shoot(s.page, `${session.id}-${s.id}`, opts.fullPage) : undefined;
      screens.push({
        screenId: s.id, device: s.device.id, viewport: s.page.viewportSize(),
        finalUrl: s.page.url(), title: await s.page.title(),
        ...(capture ? { capture } : {}), ...(audit ? { audit } : {}),
        ...(opts.dom ? { dom: (await s.page.locator('body').ariaSnapshot()).slice(0, 20000) } : {}),
        events: s.events.slice(-30),
      });
    } catch (err) { screens.push({ screenId: s.id, error: err.message }); }
  }
  return { ...describe(session), updatedAt: new Date().toISOString(), screens };
}

async function dashboard(session) {
  const token = randomBytes(24).toString('hex');
  const base = `/${token}/`;
  const srv = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
    const route = pathname.slice(base.length);
    try {
      if (route === '') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
      } else if (route === 'state') {
        // Coalesce polling from multiple panel tabs.
        if (!session.poll) {
          session.poll = exclusive(session, () => snapshot(session)).finally(() => { session.poll = null; });
        }
        const state = await session.poll;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(state));
      } else if (route.startsWith('screen/')) {
        const screen = session.screens.find(s => s.id === route.slice(7));
        if (!screen?.image) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'image/png');
        res.end(screen.image);
      } else { res.writeHead(404); res.end(); }
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });
  session.http = srv;
  session.dashboardUrl = `http://127.0.0.1:${srv.address().port}${base}`;
}

async function open(opts) {
  assertHttpUrl(opts.url);
  if (sessions.size >= 3) throw new Error('Maximo 3 sesiones; cierra una antes de abrir otra.');
  const devices = [...new Set(opts.devices || ['iphone-se', 'iphone-15-max', 'ipad-pro-11', 'laptop'])].map(catalog.resolve);
  if (!devices.length || devices.length > 6) throw new Error('Elige entre 1 y 6 dispositivos.');
  const session = { id: randomUUID(), url: opts.url, screens: [], pending: Promise.resolve(), closed: false };
  // Reserve before awaiting browser startup to enforce the session limit.
  sessions.set(session.id, session);
  try {
    for (const device of devices) {
      const { context, page } = await browser.newDeviceContext(device, opts);
      const screen = { id: `screen-${session.screens.length + 1}`, device, context, page, events: [] };
      session.screens.push(screen);
      const event = (type, message) => {
        screen.events.push({ type, message: String(message).slice(0, 2000) });
        if (screen.events.length > 100) screen.events.shift();
      };
      page.on('console', msg => event(`console.${msg.type()}`, msg.text()));
      page.on('pageerror', err => event('pageerror', err.message));
      page.on('requestfailed', req => event('requestfailed', `${req.method()} ${req.url()} ${req.failure()?.errorText}`));
      page.on('response', response => { if (response.status() >= 400) event('http_error', `${response.status()} ${response.url()}`); });
      await openUrl(page, opts.url, opts);
    }
    await snapshot(session);
    await dashboard(session);
    return describe(session);
  } catch (err) { await close(session.id); throw err; }
}

async function observe(id, opts) {
  const session = get(id);
  return exclusive(session, () => snapshot(session, { ...opts, save: true }));
}

async function navigate(id, url, opts = {}) {
  assertHttpUrl(url);
  const session = get(id);
  return exclusive(session, async () => {
    session.url = url;
    const results = [];
    for (const screen of session.screens) {
      try { results.push({ screenId: screen.id, ...await openUrl(screen.page, url, opts) }); }
      catch (err) { results.push({ screenId: screen.id, error: err.message }); }
    }
    return { ...describe(session), ok: results.every(r => !r.error && r.ok), results };
  });
}

async function interact(id, target, steps) {
  if (steps.some(step => step.action === 'set_viewport')) throw new Error('Los tamanos de la comparacion son fijos. Abre otra sesion para cambiarlos.');
  const session = get(id);
  return exclusive(session, async () => {
    const screens = target === 'all' ? session.screens : session.screens.filter(s => s.id === target);
    if (!screens.length) throw new Error('screenId desconocido. Usa list_responsive_sessions.');
    const results = [];
    for (const screen of screens) {
      try {
        const run = await runSteps(screen.page, steps, screen.device);
        results.push({ screenId: screen.id, ok: !run.results.some(r => !r.ok), ...run, finalUrl: screen.page.url() });
      } catch (err) { results.push({ screenId: screen.id, ok: false, error: err.message }); }
    }
    return { sessionId: id, ok: results.every(r => r.ok), results };
  });
}

async function close(id) {
  const session = get(id);
  return exclusive(session, async () => {
    session.closed = true;
    sessions.delete(id);
    if (session.http) await new Promise(resolve => {
      session.http.close(resolve);
      session.http.closeAllConnections();
    });
    await Promise.all(session.screens.map(s => browser.closeContext(s.context)));
    return { sessionId: id, closed: true };
  });
}

async function shutdown() { await Promise.all([...sessions.keys()].map(close)); }
module.exports = { open, observe, navigate, interact, close, shutdown, list: () => [...sessions.values()].filter(s => s.dashboardUrl).map(describe) };
