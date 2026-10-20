const { chromium } = require('playwright');
const { browserChannel, headless } = require('./config.cjs');

let browser = null;
let usedChannel = null;
let launching = null;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  if (launching) return launching;
  launching = launchBrowser();
  try { return await launching; } finally { launching = null; }
}

async function launchBrowser() {
  const errors = [];
  for (const channel of browserChannel()) {
    try {
      browser = await chromium.launch({
        headless: headless(),
        ...(channel === 'chromium' ? {} : { channel }),
      });
      usedChannel = channel;
      return browser;
    } catch (err) {
      errors.push(`${channel}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(
    `No pude abrir ningun navegador (${browserChannel().join(', ')}). Errores: ${errors.join(' | ')}. ` +
    'Ajusta EMULATOR_MCP_BROWSER o instala Chrome/Edge.'
  );
}

async function newDeviceContext(device, opts = {}) {
  const b = await getBrowser();
  const contextOptions = {
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    ...(device.userAgent ? { userAgent: device.userAgent } : {}),
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.colorScheme ? { colorScheme: opts.colorScheme } : {}),
    ...(opts.timezone ? { timezoneId: opts.timezone } : {}),
    ...(opts.geolocation ? { geolocation: opts.geolocation, permissions: ['geolocation'] } : {}),
  };
  const context = await b.newContext(contextOptions);
  context.setDefaultTimeout(opts.timeoutMs ?? 20000);
  if (opts.block) {
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      return opts.block.includes(type) ? route.abort() : route.continue();
    });
  }
  const page = await context.newPage();
  // En Chrome de escritorio el CSS de viewport coincide con el ancho logical;
  // esto ademas hace que matchMedia vea el dispositivo emulado.
  await page.emulateMedia({ media: 'screen', reducedMotion: opts.reducedMotion || 'no-preference' });
  return { context, page };
}

async function closeContext(context) {
  if (!context) return;
  try { await context.close(); } catch { /* ya cerrado */ }
}

async function shutdown() {
  const b = browser;
  browser = null;
  if (!b) return;
  try { await b.close(); } catch { /* proceso hijo muerto */ }
}

function channelInfo() {
  return { channel: usedChannel, headless: headless() };
}

module.exports = { getBrowser, newDeviceContext, closeContext, shutdown, channelInfo };
