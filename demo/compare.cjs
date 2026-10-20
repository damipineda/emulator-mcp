// Prueba visual: la MISMA pagina, rota y responsive, en 4 pantallas emuladas.
// Genera capturas reales por CDP y un HTML comparativo autocontenido.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/catalog.cjs');
const browser = require('../src/browser.cjs');
const { openUrl } = require('../src/navigate.cjs');
const { auditPage } = require('../src/audit.cjs');
const { shoot } = require('../src/steps.cjs');

const DEVICES = ['iphone-se', 'galaxy-s24', 'ipad-pro-11', 'laptop'];
const PAGES = [
  { key: 'roto', label: 'Layout fijo (como hoy)', file: 'fixture.html' },
  { key: 'responsive', label: 'Layout responsive', file: 'fixture-responsive.html' },
];
const OUT_DIR = path.join(__dirname, 'out');
const target = process.argv[2];

fs.mkdirSync(OUT_DIR, { recursive: true });
const html = Object.fromEntries(PAGES.map((p) => [p.key, fs.readFileSync(path.join(__dirname, '..', 'test', p.file), 'utf8')]));
const srv = http.createServer((req, res) => {
  const key = req.url === '/responsive' ? 'responsive' : 'roto';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html[key]);
});

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  await new Promise((r) => srv.listen(8741, '127.0.0.1', r));
  const rows = [];
  for (const page of PAGES) {
    for (const id of DEVICES) {
      const device = catalog.resolve(id);
      const { context, page: p } = await browser.newDeviceContext(device, {});
      await openUrl(p, `http://127.0.0.1:8741/${page.key}`, { settleMs: 300 });
      const a = await auditPage(p, { deviceWidth: device.viewport.width });
      const shot = await shoot(p, `demo-${page.key}-${device.id}`, false);
      rows.push({
        page: page.key, pageLabel: page.label, device: device.id, label: device.label,
        deviceW: a.viewport.deviceWidthPx, layoutW: a.viewport.layoutWidthPx, zoom: a.viewport.contentZoomScale,
        overflow: a.horizontalOverflowPx, cut: a.cutContainers.filter((c) => c.kind !== 'sprite_background').length,
        findings: a.findings.length, high: a.findings.filter((f) => f.severity === 'high').length,
        png: shot.path, bytes: shot.bytes,
      });
      await browser.closeContext(context);
      console.log(`${page.key.padEnd(11)} ${device.id.padEnd(13)} pantalla ${String(a.viewport.deviceWidthPx).padStart(4)}px  layout ${String(a.viewport.layoutWidthPx).padStart(4)}px  zoom ${a.viewport.contentZoomScale}x  overflow ${String(a.horizontalOverflowPx).padStart(3)}px  hallazgos ${a.findings.length} (high ${rows.at(-1).high})`);
    }
  }
  await browser.shutdown();
  srv.close();

  const img = (pageKey, device) => {
    const r = rows.find((x) => x.page === pageKey && x.device === device);
    return `<figure><figcaption>${esc(r.label)} · layout ${r.layoutW}px · zoom ${r.zoom}x · desborde ${r.overflow}px</figcaption><img src="data:image/png;base64,${fs.readFileSync(r.png).toString('base64')}" alt="${esc(r.label)} ${esc(r.pageLabel)}"></figure>`;
  };
  const table = rows.map((r) => `<tr class="${r.high ? 'bad' : 'good'}"><td>${esc(r.pageLabel)}</td><td>${esc(r.label)}</td><td>${r.deviceW}</td><td>${r.layoutW}</td><td>${r.zoom}x</td><td>${r.overflow}</td><td>${r.cut}</td><td>${r.high} / ${r.findings}</td></tr>`).join('\n');

  const doc = `<style>
 .emc{font:15px/1.5 system-ui,sans-serif;color:#181613}
 .emc h2{font-size:17px;margin:24px 0 10px}
 .emc p.lead{margin:0 0 18px;color:#5b544a;max-width:70ch}
 .emc .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
 .emc figure{margin:0;background:#fff;border:1px solid #E5DFD3;border-radius:10px;padding:10px}
 .emc figcaption{font-size:12px;color:#5b544a;margin-bottom:8px}
 .emc img{width:100%;height:auto;border:1px solid #E5DFD3;border-radius:4px;display:block}
 .emc table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
 .emc th,.emc td{border-bottom:1px solid #E5DFD3;padding:7px 9px;text-align:left}
 .emc tr.bad td:first-child{box-shadow:inset 3px 0 0 #B3452F}
 .emc tr.good td:first-child{box-shadow:inset 3px 0 0 #2F7A57}
 .emc .note{margin-top:22px;padding:14px 16px;background:#fff;border:1px solid #E5DFD3;border-radius:10px;max-width:80ch}
 .emc code{background:#EFE9DE;padding:1px 5px;border-radius:4px}
</style><div class="emc">
<h2>La misma pagina, la misma pantalla emulada</h2>
<p class="lead">Las dos columnas se abrieron con el viewport, DPR, touch y user-agent de un iPhone SE real de 320px. Lo unico que cambia es el CSS de la pagina.</p>
<h2>iPhone SE (320px)</h2>
<div class="grid">${img('roto', 'iphone-se')}${img('responsive', 'iphone-se')}</div>
<h2>Laptop (1366px)</h2>
<div class="grid">${img('roto', 'laptop')}${img('responsive', 'laptop')}</div>
<h2>Mediciones de las 8 aperturas</h2>
<table><thead><tr><th>Pagina</th><th>Pantalla</th><th>Ancho real</th><th>Ancho del layout</th><th>Zoom forzado</th><th>Desborde X</th><th>Contenido cortado</th><th>Hallazgos high / total</th></tr></thead><tbody>
${table}
</tbody></table>
<div class="note"><strong>Por que "se ve igual" en el movil.</strong> Cuando el contenido es mas ancho que la pantalla, Chrome no lo recorta: expande el layout viewport a ${rows.find(r=>r.page==='roto'&&r.device==='iphone-se').layoutW}px y encoge todo a ${rows.find(r=>r.page==='roto'&&r.device==='iphone-se').zoom}x. Por eso <code>window.innerWidth</code> no es el ancho del dispositivo y una pagina no responsive devuelve capturas que parecen de escritorio. La emulacion (user-agent, DPR, touch, media queries) si estuvo aplicada en los dos casos; lo que cambia es si el CSS responde a ese ancho.</div>
</div>`;

  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, doc);
    console.log('\nhtml comparativo ->', target);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'mediciones.json'), JSON.stringify(rows, null, 2));
  console.log('mediciones ->', path.join(OUT_DIR, 'mediciones.json'));
})().catch(async (e) => { console.error('demo fallo:', e.message); await browser.shutdown(); srv.close(); process.exit(1); });
