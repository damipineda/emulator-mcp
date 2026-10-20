const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function assertHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL invalida: ${url}`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Solo acepto http/https, recibi ${parsed.protocol} (${url})`);
  }
  return parsed;
}

// Navega y deja la pagina lista para medir/capturar en el viewport emulado.
async function openUrl(page, url, opts = {}) {
  assertHttpUrl(url);
  const waitUntil = opts.waitUntil || 'domcontentloaded';
  const timeout = opts.timeoutMs ?? 30000;
  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout });
  } catch (err) {
    const soft = /Timeout .* exceeded/.test(String(err.message)) && waitUntil === 'networkidle';
    if (!soft) throw new Error(`No pude cargar ${url}: ${String(err.message).split('\n')[0]}`);
  }
  if (opts.waitForSelector) {
    await page.waitForSelector(opts.waitForSelector, { timeout, state: opts.waitForState || 'visible' })
      .catch(() => { throw new Error(`El selector "${opts.waitForSelector}" no aparecio en ${url}`); });
  }
  await page.waitForTimeout(opts.settleMs ?? 400);
  const status = response ? response.status() : null;
  return {
    status,
    ok: status === null ? true : status < 400,
    finalUrl: page.url(),
    title: await page.title().catch(() => null),
    timedOutOnNetworkIdle: waitUntil === 'networkidle' && response === undefined,
  };
}

module.exports = { openUrl, assertHttpUrl };
