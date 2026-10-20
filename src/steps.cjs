const fs = require('node:fs');
const { resolveCapturePath, slug, stamp } = require('./config.cjs');

function ensureCaptureDir() {
  const { captureDir } = require('./config.cjs');
  fs.mkdirSync(captureDir(), { recursive: true });
}

async function shoot(page, label, fullPage) {
  ensureCaptureDir();
  const name = `${stamp()}-${slug(label)}.png`;
  const file = resolveCapturePath(name);
  await page.screenshot({ path: file, fullPage: Boolean(fullPage) });
  const vp = page.viewportSize();
  return {
    path: file,
    bytes: fs.statSync(file).size,
    viewport: vp,
    fullPage: Boolean(fullPage),
  };
}

// Playwright chequea que el punto del click le pertenezca al elemento, y ese
// chequeo se rompe cuando la pagina desborda el viewport emulado (el layout
// mide mas de lo que la pantalla ve). Disparar por coordenada es lo que el
// usuario realmente obtiene, asi que lo usamos como camino alternativo.
async function pointerAction(page, loc, step, ctx, kind, timeout) {
  if (step.force) {
    await loc.first().click({ timeout: timeout, force: true });
    return { via: 'locator.click(force)' };
  }
  const expanded = await page.evaluate(() => {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    return window.innerWidth > vw + 2;
  });
  if (!expanded) {
    if (kind === 'dblclick') await loc.first().dblclick({ timeout: timeout });
    else await loc.first().click({ timeout: timeout });
    return { via: kind === 'dblclick' ? 'locator.dblclick' : 'locator.click' };
  }

  await loc.first().scrollIntoViewIfNeeded({ timeout: timeout });
  const box = await loc.first().boundingBox();
  if (!box) throw new Error('el elemento no tiene caja visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const visibleWidth = await page.evaluate(() => (window.visualViewport ? window.visualViewport.width : window.innerWidth));
  if (cx < 0 || cx > visibleWidth) {
    throw new Error(
      `el objetivo queda en x=${Math.round(cx)}px, afuera de la pantalla de ${Math.round(visibleWidth)}px por el desborde horizontal. ` +
      'Arregla el layout o usa force:true / dispatchEvent para ese paso.'
    );
  }
  if (kind === 'dblclick') {
    await page.mouse.dblclick(cx, cy);
    return { via: 'mouse.dblclick', coords: { x: Math.round(cx), y: Math.round(cy) }, reason: 'layout mas ancho que la pantalla emulada' };
  }
  if (ctx.emulation.hasTouch && ctx.emulation.isMobile) {
    await page.touchscreen.tap(cx, cy);
    return { via: 'touchscreen.tap', coords: { x: Math.round(cx), y: Math.round(cy) }, reason: 'layout mas ancho que la pantalla emulada' };
  }
  await page.mouse.click(cx, cy);
  return { via: 'mouse.click', coords: { x: Math.round(cx), y: Math.round(cy) }, reason: 'layout mas ancho que la pantalla emulada' };
}

async function runStep(page, step, ctx) {
  const timeout = step.timeoutMs ?? ctx.timeoutMs ?? 15000;
  switch (step.action) {
    case 'navigate': {
      const { openUrl } = require('./navigate.cjs');
      const nav = await openUrl(page, step.url, {
        waitUntil: step.waitUntil,
        timeoutMs: timeout,
        waitForSelector: step.selector,
        settleMs: step.settleMs,
      });
      return { url: nav.finalUrl, title: nav.title, status: nav.status };
    }
    case 'click':
    case 'tap': {
      const loc = await ctx.locate(page, step);
      const via = await pointerAction(page, loc, step, ctx, 'click', timeout);
      return { clicked: ctx.labelOf(step), ...via };
    }
    case 'dblclick': {
      const loc = await ctx.locate(page, step);
      const via = await pointerAction(page, loc, step, ctx, 'dblclick', timeout);
      return { dblclicked: ctx.labelOf(step), ...via };
    }
    case 'hover': {
      const loc = await ctx.locate(page, step);
      await loc.first().hover({ timeout });
      return { hovered: ctx.labelOf(step) };
    }
    case 'type': {
      const loc = await ctx.locate(page, step, { ignoreText: true });
      const value = String(step.value ?? step.text ?? '');
      if (step.clear !== false) await loc.first().fill(value, { timeout });
      else await loc.first().pressSequentially(value, { delay: step.delay ?? 10, timeout });
      return { typed: value.slice(0, 40), into: step.selector || step.label || step.placeholder || step.testId };
    }
    case 'press': {
      await page.keyboard.press(step.key, { delay: step.delay });
      return { pressed: step.key };
    }
    case 'scroll': {
      if (step.selector) {
        await ctx.locate(page, step).first().scrollIntoViewIfNeeded({ timeout });
        return { scrolledTo: ctx.labelOf(step) };
      }
      const y = step.to === 'top' ? 0 : step.to === 'bottom' ? await page.evaluate(() => document.documentElement.scrollHeight) : step.y;
      await page.evaluate((to) => window.scrollTo({ top: to, behavior: 'instant' }), y ?? 0);
      return { scrollY: await page.evaluate(() => window.scrollY) };
    }
    case 'wait_for': {
      if (step.selector) {
        await page.waitForSelector(step.selector, { timeout, state: step.state || 'visible' });
        return { waited: step.selector };
      }
      if (step.url) {
        await page.waitForURL(step.url, { timeout });
        return { waitedUrl: String(step.url) };
      }
      await page.waitForTimeout(Math.min(step.ms ?? 500, 30000));
      return { waitedMs: step.ms ?? 500 };
    }
    case 'set_viewport': {
      if (!step.width || !step.height) throw new Error('set_viewport necesita width y height');
      const viewport = { width: step.width, height: step.height };
      await page.setViewportSize(viewport);
      ctx.emulation.viewport = viewport;
      return { viewport, note: 'DPR, mobile y touch se fijan al abrir la sesion; para cambiarlos usa otra llamada con otro device' };
    }
    case 'screenshot':
      return await shoot(page, step.name || `${ctx.deviceId}-${slug(page.url())}`, step.fullPage);
    case 'get_text': {
      const loc = await ctx.locate(page, step);
      const texts = await loc.allInnerTexts();
      return { texts: texts.map((t) => t.trim().slice(0, 300)).slice(0, 20) };
    }
    case 'count': {
      const loc = await ctx.locate(page, step);
      return { count: await loc.count() };
    }
    case 'eval': {
      const value = await page.evaluate(step.expression);
      const json = JSON.stringify(value ?? null);
      if (json && json.length > 8000) return { truncated: true, preview: json.slice(0, 8000) };
      return { value: value ?? null };
    }
    case 'assert': {
      const problems = [];
      if (step.selector) {
        const loc = await ctx.locate(page, step);
        const n = await loc.count();
        if (step.visible && n === 0) problems.push(`no hay nada visible para "${step.selector}"`);
        if (step.count !== undefined && n !== step.count) problems.push(`"${step.selector}" coincide con ${n} elementos, se esperaban ${step.count}`);
      }
      if (step.text) {
        const body = await page.evaluate(() => document.body.innerText || '');
        if (!body.includes(step.text)) problems.push(`el texto "${step.text}" no aparece en la pagina`);
      }
      if (step.urlIncludes && !page.url().includes(step.urlIncludes)) {
        problems.push(`la URL final "${page.url()}" no contiene "${step.urlIncludes}"`);
      }
      if (problems.length) throw new Error(`assert fallo: ${problems.join('; ')}`);
      return { asserted: ctx.labelOf(step) || step.text || step.urlIncludes };
    }
    case 'back':
      await page.goBack({ timeout });
      return { url: page.url() };
    case 'reload':
      await page.reload({ timeout, waitUntil: step.waitUntil || 'domcontentloaded' });
      return { url: page.url() };
    default:
      throw new Error(`Accion desconocida: ${step.action}`);
  }
}

function makeCtx(page, device) {
  return {
    emulation: {
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
    },
    deviceId: device.id,
    labelOf(step) {
      return step.selector || step.text || step.url || step.key || null;
    },
    locate: async (p, step, locateOpts = {}) => {
      if (step.selector) return p.locator(step.selector);
      if (step.testId) return p.getByTestId(step.testId);
      if (step.label) return p.getByLabel(step.label);
      if (step.placeholder) return p.getByPlaceholder(step.placeholder);
      if (step.role) return p.getByRole(step.role, { name: step.name });
      if (step.alt) return p.getByAltText(step.alt);
      if (step.text && !locateOpts.ignoreText) return p.getByText(step.text, { exact: Boolean(step.exact) });
      throw new Error(`El paso "${step.action}" necesita un localizador: selector, testId, label, placeholder, role+name, alt o text`);
    },
  };
}

async function runSteps(page, steps, device, ctxOptions = {}) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps vacio');
  if (steps.length > 40) throw new Error('maximo 40 pasos por llamada');
  const ctx = makeCtx(page, device);
  const results = [];
  for (const [index, step] of steps.entries()) {
    try {
      const output = await runStep(page, step, ctx);
      results.push({ index, action: step.action, ok: true, ...output });
    } catch (err) {
      const entry = { index, action: step.action, ok: false, error: String(err.message).split('\n')[0] };
      results.push(entry);
      if (!ctxOptions.continueOnError) {
        return { results, failedAt: index, stopped: true };
      }
    }
  }
  return { results, failedAt: null, stopped: false };
}

module.exports = { runSteps, shoot, ensureCaptureDir };
