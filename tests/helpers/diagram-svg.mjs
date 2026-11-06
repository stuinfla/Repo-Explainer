// Independent SVG probes for the diagram tests — deliberately NOT importing tools/diagrams/legibility.mjs, so a bug there
// cannot make a test agree with itself. Reads only what the emitted markup says.

/** Every font size the SVG declares (presentation attribute, style="", and CSS rules). */
export function fontSizes(svg) {
  const s = svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  const out = [];
  for (const m of s.matchAll(/font-size\s*[:=]\s*"?\s*([0-9.]+)/g)) out.push(Number(m[1]));
  for (const m of s.matchAll(/(?:^|[;{\s"])font\s*:\s*(?:[a-z0-9-]+\s+)*([0-9.]+)px/g)) out.push(Number(m[1]));
  return out;
}
export const canvasWidth = (svg) => Number(/viewBox="0 0 ([0-9.]+)/.exec(svg)[1]);
/** Smallest text on a 390px phone (page content column = 312px), in CSS px. */
export const phonePx = (svg) => Math.min(...fontSizes(svg)) * (312 / canvasWidth(svg));

const attr = (a, n) => { const m = new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(a); return m ? m[1] : null; };

/** Label boxes from the markup. Width is the CONSERVATIVE 0.6em/char (wider than any layout assumes). */
export function labelBoxes(svg) {
  const css = {};
  for (const m of svg.matchAll(/\.([a-z][\w-]*)\s*\{([^}]*)\}/gi)) {
    const fs = /font-size\s*:\s*([0-9.]+)/.exec(m[2]) || /font\s*:\s*(?:[a-z0-9-]+\s+)*([0-9.]+)px/.exec(m[2]);
    if (fs) css[m[1]] = Number(fs[1]);
  }
  const body = svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/<g class="sd-actC">[\s\S]*?<\/g>/g, '');
  const out = [];
  for (const m of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = m[1];
    if (/\bfilter="/.test(a)) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (!text.trim()) continue;
    const inline = /font-size\s*:\s*([0-9.]+)/.exec(attr(a, 'style') || '');
    const size = inline ? Number(inline[1]) : attr(a, 'font-size') ? Number(attr(a, 'font-size')) : css[(attr(a, 'class') || '').split(/\s+/).find((c) => css[c])] || 14;
    const x = Number(attr(a, 'x')), y = Number(attr(a, 'y'));
    const w = text.length * (size * 0.6 + Number(attr(a, 'letter-spacing') || 0));
    const anchor = attr(a, 'text-anchor') || 'start';
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const y0 = attr(a, 'dominant-baseline') === 'central' ? y - size / 2 : y - size * 0.8;
    out.push({ text, x0, x1: x0 + w, y0, y1: y0 + size, size });
  }
  return out;
}

/** Pairs of labels whose boxes overlap by more than 1px on both axes. */
export function overlappingLabels(svg) {
  const b = labelBoxes(svg), hits = [];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const ox = Math.min(b[i].x1, b[j].x1) - Math.max(b[i].x0, b[j].x0);
    const oy = Math.min(b[i].y1, b[j].y1) - Math.max(b[i].y0, b[j].y0);
    if (ox > 1 && oy > 1) hits.push([b[i].text, b[j].text]);
  }
  return hits;
}

// ── CSS: a tiny brace parser for the <style> blocks ──────────────────────────────────────────────
function parseBlock(src) {
  const items = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    items.push({ head, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return items;
}
/** { rules:[{selector, decl, inReduce, inNoPref}], keyframes:[{name, props:Set}] } across every <style> in the SVG. */
export function cssOf(svg) {
  const rules = [], keyframes = [];
  const walk = (src, ctx) => {
    for (const { head, body } of parseBlock(src)) {
      if (head.startsWith('@keyframes')) {
        const props = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
        keyframes.push({ name: head.replace('@keyframes', '').trim(), props });
      } else if (head.startsWith('@media')) {
        walk(body, { reduce: /reduce\s*\)/.test(head), noPref: /no-preference/.test(head) });
      } else {
        rules.push({ selector: head, decl: body, inReduce: !!ctx.reduce, inNoPref: !!ctx.noPref });
      }
    }
  };
  for (const m of svg.matchAll(/<style>([\s\S]*?)<\/style>/g)) walk(m[1], {});
  return { rules, keyframes };
}
