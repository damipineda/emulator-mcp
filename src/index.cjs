#!/usr/bin/env node
const fs = require('node:fs');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const catalog = require('./catalog.cjs');
const browser = require('./browser.cjs');
const { openUrl } = require('./navigate.cjs');
const { auditPage } = require('./audit.cjs');
const { runSteps, shoot } = require('./steps.cjs');
const { captureDir } = require('./config.cjs');

const server = new McpServer({ name: 'emulator-mcp', version: require('../package.json').version });

const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
const fail = (message, hint) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...(hint ? { hint } : {}) }, null, 2) }],
});

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function withImage(payload, filePath, returnImage) {
  if (!returnImage) return ok(payload);
  const bytes = fs.statSync(filePath).size;
  if (bytes > 5 * 1024 * 1024) {
    return ok({ ...payload, imageOmitted: `png de ${Math.round(bytes / 1024)}KB demasiado grande para devolver en linea; abre el path` });
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(payload, null, 2) },
      { type: 'image', data: fs.readFileSync(filePath).toString('base64'), mimeType: 'image/png' },
    ],
  };
}

async function captureOneWith(device, url, opts) {
  const { context, page } = await browser.newDeviceContext(device, opts);
  try {
    const nav = await openUrl(page, url, opts);
    const audit = opts.audit === false
      ? null
      : await auditPage(page, { ...opts, minTapSize: opts.minTapSize, tolerance: opts.tolerance, deviceWidth: device.viewport.width });
    const file = opts.screenshot === false
      ? { path: null, bytes: 0, viewport: device.viewport, fullPage: false }
      : await shoot(page, opts.name || `${device.id}-${nav.finalUrl}`, opts.fullPage);
    return {
      device: { id: device.id, label: device.label, viewport: device.viewport, dpr: device.deviceScaleFactor, mobile: device.isMobile, touch: device.hasTouch },
      ...file,
      status: nav.status,
      title: nav.title,
      finalUrl: nav.finalUrl,
      userAgent: await page.evaluate(() => navigator.userAgent),
      browser: browser.channelInfo(),
      ...(audit ? {
        horizontalOverflowPx: audit.horizontalOverflowPx,
        layoutViewportExpandedPx: audit.layoutViewportExpandedPx,
        pageHeightPx: audit.pageHeightPx,
        contentZoomScale: audit.viewport.contentZoomScale,
        findings: audit.findings,
      } : {}),
      _audit: audit,
    };
  } finally {
    await browser.closeContext(context);
  }
}

function customDevice(v) {
  return {
    id: `custom-${v.width}x${v.height}`,
    label: `Custom ${v.width}x${v.height}`,
    group: v.width >= 700 ? 'desktop' : 'phone',
    frame: 'unknown',
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.deviceScaleFactor || 1,
    isMobile: v.mobile ?? v.width < 700,
    hasTouch: v.touch ?? v.width < 700,
    userAgent: undefined,
  };
}


// ---------- list_devices ----------
server.registerTool(
  'list_devices',
  {
    title: 'List emulated screens',
    description: `Devuelve los ids de pantallas que aceptan las demas tools (telefonos, tablets, laptops, desktops, con viewport, DPR, mobile y touch reales).
Usa primero esta tool si no sabes que dispositivo pedir. Cualquier nombre del catalogo interno de Playwright (por ejemplo "iPhone 12", "Pixel 5", "Desktop Chrome") tambien funciona, y podes forzar apaisado agregando " landscape" al id.`,
    inputSchema: {
      group: z.enum(['phone', 'tablet', 'desktop']).optional().describe('Filtra por tipo de pantalla'),
      query: z.string().optional().describe('Busqueda por texto en id o label, p.ej. "ipad" o "fold"'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ group, query }) => {
    let devices = catalog.listAll();
    if (group) devices = devices.filter((d) => d.group === group);
    if (query) {
      const q = query.toLowerCase();
      devices = devices.filter((d) => d.id.includes(q) || d.label.toLowerCase().includes(q));
    }
    return ok({
      count: devices.length,
      devices,
      defaultPreviewSet: catalog.DEFAULT_PREVIEW,
      note: 'Estos son los ids curados. Tambien sirven los nombres de Playwright (207 variants) y el sufijo "-landscape".',
    });
  }
);

// ---------- screenshot_on ----------
const navFields = {
  url: z.string().describe('URL http/https a abrir en la pantalla emulada'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional()
    .describe('Estrategia de espera antes de capturar. "networkidle" para SPA, "commit" si la red es lenta'),
  waitForSelector: z.string().optional().describe('Selector CSS que debe verse antes de capturar (útil en SPA)'),
  settleMs: z.number().int().min(0).max(30000).optional().describe('Milisegundos extra tras cargar para dejar terminar animaciones (default 400)'),
  timeoutMs: z.number().int().min(1000).max(120000).optional().describe('Timeout de navegacion y esperas (default 30000)'),
  locale: z.string().optional().describe('Locale, p.ej. "es-PY" para ver formatos locales'),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional().describe('Tema pedido por CSS prefers-color-scheme'),
  timezone: z.string().optional().describe('Timezone IANA, p.ej. "America/Asuncion"'),
  geolocation: z.object({ latitude: z.number(), longitude: z.number() }).optional().describe('Coordenadas para emular GPS'),
  block: z.array(z.enum(['image', 'media', 'font', 'stylesheet', 'script', 'third-party'])).optional()
    .describe('Resource types a bloquear (acelera capturas en paginas pesadas)'),
};

server.registerTool(
  'screenshot_on',
  {
    title: 'Screenshot on one screen',
    description: `Abre una URL dentro del navegador local emulando UNA pantalla concreto (viewport, DPR, mobile flag, touch y user-agent reales) y guarda un PNG.
Tambien corre una auditoria responsive en ese viewport y devuelve los hallazgos junto al path de la imagen.
Pedido tipico: { url, device: "iphone-15-max" }. Para cambiar tamano sin dispositivo: { url, viewport: { width: 380, height: 800 } }.
Devolve el path en captures/; pide returnImage=true solo si necesitas ver la imagen, porque consume muchos tokens.`,
    inputSchema: {
      ...navFields,
      device: z.string().optional().describe('Id de pantalla de list_devices ("iphone-15-max", "ipad-pro-11", "laptop") o nombre Playwright'),
      viewport: z.object({
        width: z.number().int().min(240).max(5000),
        height: z.number().int().min(240).max(5000),
        deviceScaleFactor: z.number().min(1).max(4).optional(),
        mobile: z.boolean().optional(),
        touch: z.boolean().optional(),
      }).optional().describe('Viewport explicito cuando ningun dispositivo del catalogo te sirve'),
      fullPage: z.boolean().optional().describe('Captura toda la altura del documento, no solo lo visible'),
      name: z.string().optional().describe('Nombre semantico para el archivo (se sanitiza y vive en captures/)'),
      returnImage: z.boolean().optional().describe('Si es true, además del path se devuelve el PNG embebido'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    if (!args.device && !args.viewport) return fail('Falta "device" o "viewport"', 'Llama list_devices para ver los ids disponibles');
    try {
      const target = args.device || `custom-${args.viewport.width}x${args.viewport.height}`;
      const device = args.device ? catalog.resolve(args.device) : customDevice(args.viewport);
      const result = await captureOneWith(device, args.url, { ...args, name: args.name || target });
      const { _audit, ...payload } = result;
      return withImage({ ...payload, audit: _audit }, result.path, args.returnImage);
    } catch (err) {
      return fail(err.message);
    }
  }
);

// ---------- preview_devices ----------
server.registerTool(
  'preview_devices',
  {
    title: 'Same page on many screens',
    description: `Captura la MISMA URL en varias pantallas a la vez (hasta 4 en paralelo) y devuelve un PNG por dispositivo con el desborde horizontal de cada uno.
Es la tool para responder "como se ve esto en movil, tablet y desktop". Sin "devices" usa el set standard: iphone-15-max, galaxy-s24, ipad-pro-11, laptop, desktop-hd.
Si solo necesitas saber donde se rompe el layout, usa check_responsive: hace las mismas aperturas y no baja imagenes.`,
    inputSchema: {
      ...navFields,
      devices: z.array(z.string()).max(12).optional().describe('Ids de pantalla. Default: set estandar de 5'),
      fullPage: z.boolean().optional().describe('Captura completa por dispositivo (pesa mucho en paginas largas)'),
      concurrency: z.number().int().min(1).max(4).optional().describe('Capturas simultaneas (default 4)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    const targets = args.devices?.length ? args.devices : catalog.DEFAULT_PREVIEW;
    try {
      const shots = await mapLimit(targets, args.concurrency ?? 4, async (t) => {
        try {
          const device = catalog.resolve(t);
          const r = await captureOneWith(device, args.url, { ...args, name: args.name ? `${args.name}-${device.id}` : undefined });
          const { _audit, ...rest } = r;
          return { ...rest, findingCount: _audit ? _audit.findings.length : 0, topFindings: _audit ? _audit.findings.slice(0, 3) : [] };
        } catch (err) {
          return { device: { id: t }, error: String(err.message).split('\n')[0] };
        }
      });
      const broken = shots.filter((s) => s.horizontalOverflowPx > 0).map((s) => s.device?.id).filter(Boolean);
      return ok({
        url: args.url,
        captures: shots.map((s) => ({
          device: s.device?.id, label: s.device?.label, viewport: s.device?.viewport,
          path: s.path, bytes: s.bytes, status: s.status,
          horizontalOverflowPx: s.horizontalOverflowPx, findingCount: s.findingCount, topFindings: s.topFindings,
          error: s.error,
        })),
        summary: {
          total: shots.length,
          failed: shots.filter((s) => s.error).length,
          withHorizontalOverflow: broken,
          captureDir: captureDir(),
        },
      });
    } catch (err) {
      return fail(err.message);
    }
  }
);

// ---------- check_responsive ----------
server.registerTool(
  'check_responsive',
  {
    title: 'Audit layout across screens',
    description: `Abre la URL en varias pantallas y reporta SOLO problemas de responsive, sin imagenes: desborde horizontal con el selector exacto que lo causa, texto recortado, targets tocables chicos, imágenes fuera de viewport, meta viewport faltante o que bloquea el zoom, y que media queries activan en cada ancho.
Severidades: high = se rompe el layout, medium = se pierde contenido o baja performance, low = incomodo en tactil, info = contexto.
Cada pantalla reporta viewport.deviceWidthPx (la pantalla real) y viewport.layoutWidthPx (lo que mide window.innerWidth); si layoutWidthPx > deviceWidthPx la pagina no es responsive ahi.
Usa esta tool para verificar un rediseño o para encontrar breakpoints rotos; despues captura con screenshot_on el dispositivo que falla para verlo.`,
    inputSchema: {
      ...navFields,
      devices: z.array(z.string()).max(12).optional().describe('Pantallas a auditar. Default: iphone-se, iphone-15-max, galaxy-s24, ipad-pro-11, laptop, desktop-hd'),
      minTapSize: z.number().int().min(20).max(80).optional().describe('Px minimos de un target tocable (default 44)'),
      tolerance: z.number().int().min(0).max(20).optional().describe('Px de holgura antes de marcar desborde (default 2)'),
      includeMediaQueries: z.boolean().optional().describe('Incluye las media queries que matchean en cada viewport (default false)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    const targets = args.devices?.length ? args.devices : ['iphone-se', 'iphone-15-max', 'galaxy-s24', 'ipad-pro-11', 'laptop', 'desktop-hd'];
    try {
      const results = await mapLimit(targets, args.concurrency ?? 4, async (t) => {
        try {
          const device = catalog.resolve(t);
          const r = await captureOneWith(device, args.url, {
            ...args, fullPage: false, screenshot: false, name: `audit-${device.id}`,
          });
          const a = r._audit;
          const byCode = {};
          for (const f of a.findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
          return {
            device: device.id,
            label: device.label,
            viewport: a.viewport,
            pageHeightPx: a.pageHeightPx,
            horizontalOverflowPx: a.horizontalOverflowPx,
            offenders: a.offenders,
            clippedText: a.clipped,
            smallTapTargets: a.smallTargets,
            imageOverflow: a.bigImages,
            metaViewport: a.metaViewport,
            ...(args.includeMediaQueries ? { matchedMedia: a.matchedMedia, unreadableStylesheets: a.unreadableStylesheets } : {}),
            counts: byCode,
            findings: a.findings,
          };
        } catch (err) {
          return { device: t, error: String(err.message).split('\n')[0] };
        }
      });
      const perSeverity = { high: 0, medium: 0, low: 0, info: 0 };
      for (const r of results) for (const f of r.findings || []) perSeverity[f.severity] = (perSeverity[f.severity] || 0) + 1;
      return ok({
        url: args.url,
        verdict: perSeverity.high > 0 ? 'FALLA' : perSeverity.medium > 0 ? 'FUNCIONA CON AVISOS' : 'OK',
        totals: perSeverity,
        failingDevices: results.filter((r) => r.horizontalOverflowPx > 0 || (r.counts && r.counts.high)).map((r) => r.device),
        screens: results,
      });
    } catch (err) {
      return fail(err.message);
    }
  }
);

// ---------- interact_on ----------
server.registerTool(
  'interact_on',
  {
    title: 'Drive a flow on an emulated screen',
    description: `Ejecuta una secuencia de pasos en UNA pantalla emulada dentro de la misma sesion de navegador: navegar, tocar, escribir, esperar, scrollear, medir con JS y capturar.
Es la tool para probar flujos (login, checkout, menu hamburguesa, scroll) y verificar que el resultado se vea bien en ese dispositivo.
Cada paso es { action, ...args }. Localizadores aceptados por paso: selector (CSS o Playwright), text, role+name, label, placeholder, alt, testId.
Acciones: navigate, click, tap, dblclick, hover, type, press, scroll, wait_for, set_viewport, screenshot, get_text, count, eval, assert, back, reload.
Ejemplo: [{action:"navigate",url}, {action:"click",text:"Menu"}, {action:"assert",text:"Reservar"}, {action:"screenshot",fullPage:false}].
Se detiene en el primer paso que falla (salvo continueOnError). No podras mantener una sesion entre llamadas: meté todo el flujo en una sola invocacion.
Si la pagina desborda el ancho del dispositivo, click/tap se resuelven por coordenada (touchscreen.tap o mouse.click) porque el chequeo de hit-target de Playwright falla con el layout expandido; el paso devuelve "via" con lo que usó.`,
    inputSchema: {
      url: z.string().describe('URL inicial (los pasos pueden navegar despues)'),
      device: z.string().optional().describe('Pantalla emulada; default "iphone-15-max"'),
      viewport: z.object({ width: z.number().int(), height: z.number().int(), deviceScaleFactor: z.number().optional(), mobile: z.boolean().optional(), touch: z.boolean().optional() }).optional(),
      steps: require('./step-schema.cjs'),
      continueOnError: z.boolean().optional().describe('Si true sigue ejecutando cuando un paso falla'),
      finalScreenshot: z.boolean().optional().describe('Captura al terminar aunque no pidas un paso screenshot (default true)'),
      name: z.string().optional().describe('Prefijo del archivo de captura'),
      locale: z.string().optional(),
      colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async (args) => {
    let device;
    try {
      device = args.viewport ? customDevice(args.viewport) : catalog.resolve(args.device || 'iphone-15-max');
    } catch (err) {
      return fail(err.message);
    }
    const { context, page } = await browser.newDeviceContext(device, args);
    try {
      if (args.steps[0].action !== 'navigate') {
        await openUrl(page, args.url, { waitUntil: 'domcontentloaded', settleMs: 400 });
      }
      const run = await runSteps(page, args.steps, device, { continueOnError: args.continueOnError });
      let finalShot = null;
      if (args.finalScreenshot !== false && !run.results.some((r) => r.action === 'screenshot' && r.ok)) {
        finalShot = await shoot(page, `${args.name || 'flow'}-${device.id}-${page.url()}`, false);
      }
      const lastError = run.failedAt === null ? null : run.results[run.failedAt];
      return ok({
        device: { id: device.id, viewport: device.viewport },
        ok: lastError === null,
        stoppedAt: run.failedAt,
        finalUrl: page.url(),
        steps: run.results,
        finalScreenshot: finalShot,
        ...(lastError ? { error: lastError.error, hint: 'Verifica el localizador con un paso count o get_text antes de asumir que el flujo esta roto' } : {}),
      });
    } catch (err) {
      return fail(err.message);
    } finally {
      await browser.closeContext(context);
    }
  }
);

// ---------- emulator_status ----------
server.registerTool(
  'emulator_status',
  {
    title: 'Server status',
    description: 'Dice que navegador local usa la emulacion, donde caen las capturas y cuantas pantallas hay disponibles. Usala para diagnosticar antes de culpar a la pagina.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const dir = captureDir();
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).slice(-5);
    } catch { /* todavia no hubo capturas */ }
    return ok({
      browser: browser.channelInfo(),
      launchOrder: process.env.EMULATOR_MCP_BROWSER || 'chrome,msedge,chromium',
      captureDir: dir,
      recentCaptures: files,
      curatedScreens: catalog.listAll().length,
      playwrightScreens: Object.keys(require('playwright').devices).length,
      node: process.version,
    });
  }
);

require('./session-tools.cjs')(server);

let closing = false;
async function shutdownAndExit(code = 0) {
  if (closing) return;
  closing = true;
  await require('./sessions.cjs').shutdown();
  await browser.shutdown();
  process.exit(code);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // El cliente MCP cierra stdin al desconectarse: ahi soltamos el navegador.
  process.stdin.on('end', () => shutdownAndExit());
  process.stdin.on('close', () => shutdownAndExit());
  process.on('SIGINT', () => shutdownAndExit());
  process.on('SIGTERM', () => shutdownAndExit());
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`emulator-mcp fallo al iniciar: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = { server, main, catalog };
