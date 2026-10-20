// Todo lo de aqui dentro corre en la pagina evaluada: page.evaluate serializa
// solo la funcion, asi que los helpers tienen que estar adentro.
function auditInPage(opts) {
  function sel(el) {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let name = node.nodeName.toLowerCase();
      if (name === 'html' || name === 'body') break;
      if (typeof node.className === 'string' && node.className.trim()) {
        const cls = node.className.trim().split(/\s+/).filter((c) => c.length < 30).slice(0, 2);
        if (cls.length) name += '.' + cls.join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.nodeName === node.nodeName);
        if (sameTag.length > 1) name += `:nth(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(name);
      node = node.parentElement;
    }
    return parts.join(' > ') || el.nodeName.toLowerCase();
  }

  function visible(el, rect) {
    if (rect.width <= 0 && rect.height <= 0) return false;
    // Fuera de la pantalla por la izquierda/arriba: truco de "visually hidden".
    if (rect.right <= 0 || rect.bottom <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    if (st.clip && st.clip !== 'auto' && st.position === 'absolute') return false;
    if (/inset\(50%/.test(st.clipPath || '')) return false;
    return true;
  }

  // Los enlaces inline dentro de una frase estan exentos de la regla de 44px
  // (WCAG 2.5.8); solo cuentan los controles con forma de control.
  function isInlineTextLink(el, st) {
    if (st.display !== 'inline') return true;
    if (el.closest('button, [role="button"], .btn, .button')) return false;
    return !st.backgroundColor.match(/rgba?\((?!0 0 0 0)/) && !st.borderTopWidth.match(/[1-9]/);
  }

  const doc = document.documentElement;
  const body = document.body || doc;
  // El viewport REAL del dispositivo es el visual viewport. Cuando el contenido
  // es mas ancho que la pantalla, Chrome expande el layout viewport y
  // window.innerWidth miente: hay que medir contra el dispositivo.
  const layoutW = window.innerWidth;
  const layoutH = window.innerHeight;
  const visualW = window.visualViewport ? Math.round(window.visualViewport.width) : layoutW;
  const visualH = window.visualViewport ? Math.round(window.visualViewport.height) : layoutH;
  const deviceW = opts.deviceWidth || visualW;
  const refW = Math.min(visualW, deviceW);
  // Factor de encogido: si el layout se expandio, todo se ve mas chico en pantalla.
  const scale = layoutW > refW ? refW / layoutW : 1;

  const docScrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
  const horizontalOverflowPx = Math.max(0, docScrollWidth - refW);
  const layoutViewportExpandedPx = Math.max(0, layoutW - refW);

  const offenders = [];
  const clipped = [];
  const cutContainers = [];
  const smallTargets = [];
  const bigImages = [];
  const handled = new Set();
  const nodes = Array.from(body.querySelectorAll('*')).slice(0, 15000);

  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect)) continue;

    const st = getComputedStyle(el);

    if (rect.right > refW + opts.tolerance && rect.width > 24 && offenders.length < opts.maxOffenders) {
      const parentRect = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
      const parentOverflows = parentRect && parentRect.right > refW + opts.tolerance;
      if (!parentOverflows) {
        offenders.push({
          selector: sel(el),
          tag: el.nodeName.toLowerCase(),
          widthPx: Math.round(rect.width),
          rightPx: Math.round(rect.right),
          overflowPx: Math.round(rect.right - refW),
          widthOnScreenPx: Math.round(rect.width * scale),
        });
      }
    }

    const clipsX = st.overflowX === 'hidden' || st.overflowX === 'clip';
    if (clipsX && el.scrollWidth > el.clientWidth + Math.max(opts.tolerance, opts.minCutPx) && cutContainers.length < opts.maxContainers) {
      // Hoja de sprites o imagen de fondo recortada a proposito: no es un bug.
      const spriteOnly = st.backgroundImage !== 'none' && el.childElementCount === 0 && !(el.textContent || '').trim();
      cutContainers.push({
        selector: sel(el),
        contentWidthPx: el.scrollWidth,
        visibleWidthPx: el.clientWidth,
        cutPx: el.scrollWidth - el.clientWidth,
        overflowX: st.overflowX,
        kind: spriteOnly ? 'sprite_background' : 'clipped_content',
      });
    }

    const interactive = el.matches('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[onclick],label');
    if (interactive && !handled.has(el)) {
      handled.add(el);
      const effW = Math.round(rect.width * scale);
      const effH = Math.round(rect.height * scale);
      const min = Math.min(effW, effH);
      const inlineLink = el.nodeName === 'A' && isInlineTextLink(el, st);
      if (!inlineLink && min > 0 && min < opts.minTapSize && effW < refW && smallTargets.length < opts.maxTargets) {
        smallTargets.push({
          selector: sel(el),
          text: ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '') + '').trim().slice(0, 40),
          widthPx: effW,
          heightPx: effH,
        });
      }
    }

    const clipsY = st.overflowY === 'hidden' || st.overflowY === 'clip';
    const isLeafText = el.childElementCount === 0 && (el.textContent || '').trim().length > 0;
    if (clipsY && isLeafText && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 4 && clipped.length < opts.maxClipped) {
      clipped.push({
        selector: sel(el),
        text: (el.textContent || '').trim().slice(0, 60),
        visibleHeightPx: el.clientHeight,
        contentHeightPx: el.scrollHeight,
      });
    }

    if (el.nodeName === 'IMG' && (rect.right > refW + opts.tolerance || rect.width > refW + opts.tolerance) && bigImages.length < opts.maxImages) {
      bigImages.push({
        selector: sel(el),
        renderedWidthPx: Math.round(rect.width),
        naturalWidthPx: el.naturalWidth || null,
        hasSrcset: Boolean(el.getAttribute('srcset') || el.getAttribute('sizes')),
        alt: (el.getAttribute('alt') || '').slice(0, 40),
      });
    }
  }

  const meta = document.querySelector('meta[name="viewport"]');
  const metaContent = meta ? (meta.getAttribute('content') || '') : null;
  let zoomBlocked = false;
  if (metaContent) {
    zoomBlocked = /user-scalable\s*=\s*(no|0)/i.test(metaContent);
    const maxScale = /maximum-scale\s*=\s*([0-9.]+)/i.exec(metaContent);
    if (maxScale && Number(maxScale[1]) <= 1) zoomBlocked = true;
  }

  const mediaRules = [];
  const unreadableStylesheets = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadableStylesheets.push(sheet.href || 'inline');
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      if (rule.type === CSSRule.MEDIA_RULE && rule.conditionText) {
        if (mediaRules.length >= opts.maxMediaRules) break;
        if (!mediaRules.some((m) => m.media === rule.conditionText)) {
          mediaRules.push({ media: rule.conditionText, matches: window.matchMedia(rule.conditionText).matches });
        }
      }
    }
  }

  return {
    url: location.href,
    title: document.title,
    deviceWidth: deviceW,
    viewport: {
      deviceWidthPx: refW,
      deviceHeightPx: visualH,
      layoutWidthPx: layoutW,
      layoutHeightPx: layoutH,
      devicePixelRatio: window.devicePixelRatio,
      contentZoomScale: Math.round(scale * 100) / 100,
    },
    pageHeightPx: doc.scrollHeight,
    docScrollWidth,
    horizontalOverflowPx,
    layoutViewportExpandedPx,
    hasHorizontalScroll: docScrollWidth > refW,
    offenders,
    clipped,
    cutContainers,
    smallTargets,
    bigImages,
    metaViewport: { present: Boolean(meta), content: metaContent, zoomBlocked },
    matchedMedia: mediaRules.filter((m) => m.matches).map((m) => m.media),
    mediaRulesSampled: mediaRules.length,
    unreadableStylesheets: unreadableStylesheets.slice(0, 5),
    fontsStatus: document.fonts ? document.fonts.status : 'unknown',
  };
}

function summarize(audit, opts) {
  const findings = [];
  const push = (severity, code, detail) => findings.push({ severity, code, detail });
  const v = audit.viewport;

  if (audit.layoutViewportExpandedPx > 0) {
    push('high', 'layout_viewport_expanded',
      `El layout se expandio a ${v.layoutWidthPx}px para hacer entrar contenido en una pantalla de ${v.deviceWidthPx}px (zoom forzado a ${v.contentZoomScale}x). La pagina no es responsive en este ancho: el usuario ve todo encogido o debe hacer pan horizontal.`);
  }
  if (audit.horizontalOverflowPx > 0) {
    push('high', 'horizontal_overflow',
      `El documento mide ${audit.docScrollWidth}px contra ${v.deviceWidthPx}px del dispositivo: ${audit.horizontalOverflowPx}px de desborde horizontal.`);
    for (const o of audit.offenders) {
      push('high', 'element_overflows',
        `"${o.selector}" (${o.widthPx}px) termina en ${o.rightPx}px: ${o.overflowPx}px fuera del borde derecho del dispositivo.`);
    }
    if (!audit.offenders.length) {
      push('high', 'element_overflows', 'No se pudo asignar el desborde a un elemento concreto (layout expandido por contenido ancho).');
    }
  }
  for (const c of audit.cutContainers) {
    if (c.kind === 'sprite_background') {
      push('info', 'sprite_background',
        `"${c.selector}" recorta una imagen de fondo (${c.cutPx}px ocultos): tecnica de sprite, no rompe el layout.`);
    } else {
      push('medium', 'content_cut_by_overflow',
        `"${c.selector}" tiene overflow-x ${c.overflowX} y corta ${c.cutPx}px de contenido (${c.contentWidthPx}px dentro de ${c.visibleWidthPx}px).`);
    }
  }
  if (!audit.metaViewport.present) {
    push('high', 'missing_meta_viewport', 'Falta <meta name="viewport">: en el movil se renderiza el layout de escritorio con zoom.');
  } else if (audit.metaViewport.zoomBlocked) {
    push('medium', 'zoom_blocked', `El meta viewport bloquea el zoom (${audit.metaViewport.content}); incumple accesibilidad.`);
  }
  for (const c of audit.clipped) {
    push('medium', 'clipped_text',
      `"${c.selector}" recorta texto: ${c.contentHeightPx}px de contenido en ${c.visibleHeightPx}px visibles ("${c.text}").`);
  }
  for (const t of audit.smallTargets) {
    push('low', 'small_tap_target',
      `"${t.selector}" con texto "${t.text}" mide ${t.widthPx}x${t.heightPx}px en pantalla, menos de ${opts.minTapSize}px de area tocable.`);
  }
  for (const i of audit.bigImages) {
    push('medium', 'image_overflow',
      `Imagen "${i.selector}" renderiza ${i.renderedWidthPx}px en un dispositivo de ${v.deviceWidthPx}px${i.hasSrcset ? ' (usa srcset/sizes, revisa el art-direction)' : ' (sin srcset: se descarga la version grande)'}.`);
  }
  if (audit.unreadableStylesheets.length) {
    push('info', 'unreadable_css',
      `${audit.unreadableStylesheets.length} hoja(s) de estilos cross-origin no permitieron leer sus media queries.`);
  }
  return findings;
}

const AUDIT_DEFAULTS = {
  tolerance: 2,
  minTapSize: 44,
  minCutPx: 24,
  maxOffenders: 12,
  maxClipped: 12,
  maxContainers: 10,
  maxTargets: 15,
  maxImages: 8,
  maxMediaRules: 40,
  maxFindings: 30,
};

// deviceWidth es obligatorio: window.innerWidth miente cuando el contenido
// desborda y Chrome expande el layout viewport.
async function auditPage(page, userOpts = {}) {
  // Un { tolerance: undefined } pisaria el default y volveria NaN las comparaciones.
  const clean = Object.fromEntries(Object.entries(userOpts).filter(([, v]) => v !== undefined && v !== null));
  const options = { ...AUDIT_DEFAULTS, ...clean };
  const audit = await page.evaluate(auditInPage, options);
  let findings = summarize(audit, options);
  if (findings.length > options.maxFindings) {
    const hidden = findings.length - options.maxFindings;
    findings = findings.slice(0, options.maxFindings);
    findings.push({ severity: 'info', code: 'findings_truncated', detail: `${hidden} hallazgos mas quedaron fuera (subi maxFindings si los necesitas).` });
  }
  return { ...audit, findings };
}

module.exports = { auditPage, auditInPage, summarize };
