const { devices } = require('playwright');

// Device sizes and user agents are resolved from Playwright descriptors.
// Side-by-side preview inspiration: talah221/Mobile-Simulator (not bundled).
const CATALOG = [
  { id: 'iphone-se', label: 'iPhone SE', group: 'phone', frame: 'notchless', pw: 'iPhone SE' },
  { id: 'iphone-13', label: 'iPhone 13 / 14', group: 'phone', frame: 'notch', pw: 'iPhone 14' },
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', group: 'phone', frame: 'island', pw: 'iPhone 15 Pro' },
  { id: 'iphone-15-max', label: 'iPhone 15 Pro Max', group: 'phone', frame: 'island', pw: 'iPhone 15 Pro Max' },
  { id: 'iphone-17-pro-max', label: 'iPhone 17 Pro Max', group: 'phone', frame: 'island', pw: 'iPhone 17 Pro Max' },
  { id: 'pixel-8', label: 'Pixel 8', group: 'phone', frame: 'punch', pw: 'Pixel 8' },
  { id: 'pixel-8a', label: 'Pixel 8a', group: 'phone', frame: 'punch', pw: 'Pixel 8a' },
  { id: 'galaxy-s24', label: 'Galaxy S24', group: 'phone', frame: 'punch', pw: 'Galaxy S24' },
  { id: 'galaxy-fold-cover', label: 'Galaxy Z Fold (cover)', group: 'phone', frame: 'punch', pw: 'Galaxy Z Fold 7 Cover' },
  { id: 'galaxy-fold-open', label: 'Galaxy Z Fold (abierto)', group: 'tablet', frame: 'tablet', pw: 'Galaxy Z Fold 7' },
  { id: 'ipad-mini', label: 'iPad Mini', group: 'tablet', frame: 'tablet', pw: 'iPad Mini' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', group: 'tablet', frame: 'tablet', pw: 'iPad Pro 11' },
  { id: 'ipad-11-gen', label: 'iPad 11a gen', group: 'tablet', frame: 'tablet', pw: 'iPad (gen 11)' },
  { id: 'galaxy-tab-s9', label: 'Galaxy Tab S9', group: 'tablet', frame: 'tablet', pw: 'Galaxy Tab S9' },
  { id: 'laptop', label: 'Laptop 1366', group: 'desktop', frame: 'desktop', custom: { width: 1366, height: 768 } },
  { id: 'desktop-hd', label: 'Desktop 1920', group: 'desktop', frame: 'desktop', custom: { width: 1920, height: 1080 } },
  { id: 'desktop-4k', label: 'Desktop 4K (1920 CSS)', group: 'desktop', frame: 'desktop', custom: { width: 1920, height: 1080, deviceScaleFactor: 2 } },
];

const DEFAULT_PREVIEW = ['iphone-15-max', 'galaxy-s24', 'ipad-pro-11', 'laptop', 'desktop-hd'];

function byPlaywrightName(name) {
  const exact = devices[name];
  if (exact) return exact;
  const lower = String(name).trim().toLowerCase();
  const key = Object.keys(devices).find((k) => k.toLowerCase() === lower);
  return key ? devices[key] : null;
}

function catalogEntry(id) {
  return CATALOG.find((d) => d.id === id) || null;
}

// Acepta id del catalogo, nombre de Playwright ("iPhone 15 Pro"), o variante
// "landscape" de cualquiera de los dos.
function resolve(idOrName) {
  const raw = String(idOrName || '').trim();
  const landscape = /landscape|apaisado|horizontal|横/i.test(raw);
  const base = raw.replace(/[\s_-]*(landscape|apaisado|horizontal)[\s_-]*$/i, '').trim();

  const entry = catalogEntry(base) || catalogEntry(base.toLowerCase());
  if (entry) {
    if (entry.pw) {
      const pwName = landscape ? `${entry.pw} landscape` : entry.pw;
      const desc = byPlaywrightName(pwName);
      if (!desc) throw new Error(`Playwright no tiene "${pwName}"; prueba otro id o usa viewport explicito`);
      return {
        id: entry.id + (landscape ? '-landscape' : ''),
        label: entry.label + (landscape ? ' (apaisado)' : ''),
        group: entry.group,
        frame: entry.frame,
        viewport: desc.viewport,
        deviceScaleFactor: desc.deviceScaleFactor,
        isMobile: desc.isMobile,
        hasTouch: desc.hasTouch,
        userAgent: desc.userAgent,
      };
    }
    const c = entry.custom;
    return {
      id: entry.id + (landscape ? '-landscape' : ''),
      label: entry.label + (landscape ? ' (apaisado)' : ''),
      group: entry.group,
      frame: entry.frame,
      viewport: landscape
        ? { width: c.height, height: c.width }
        : { width: c.width, height: c.height },
      deviceScaleFactor: c.deviceScaleFactor || 1,
      isMobile: false,
      hasTouch: false,
      userAgent: undefined,
    };
  }

  const pwName = landscape ? `${base} landscape` : base;
  const desc = byPlaywrightName(pwName) || byPlaywrightName(base);
  if (desc) {
    return {
      id: raw,
      label: desc.name || raw,
      group: desc.isMobile ? (desc.viewport.width >= 700 ? 'tablet' : 'phone') : 'desktop',
      frame: 'unknown',
      viewport: desc.viewport,
      deviceScaleFactor: desc.deviceScaleFactor,
      isMobile: desc.isMobile,
      hasTouch: desc.hasTouch,
      userAgent: desc.userAgent,
    };
  }

  throw new Error(`Dispositivo desconocido: "${raw}". Usa list_devices para ver los ids validos.`);
}

function listAll() {
  return CATALOG.map((e) => {
    const d = resolve(e.id);
    return {
      id: e.id,
      label: e.label,
      group: e.group,
      frame: e.frame,
      width: d.viewport.width,
      height: d.viewport.height,
      deviceScaleFactor: d.deviceScaleFactor,
      mobile: d.isMobile,
      touch: d.hasTouch,
      landscape_id: e.id + '-landscape',
    };
  });
}

module.exports = { CATALOG, DEFAULT_PREVIEW, resolve, listAll, byPlaywrightName };
