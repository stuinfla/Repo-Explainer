// tools/diagrams/legibility.mjs — the deterministic legibility rail (ADR-0012 D5) and the label-collision check.
//
// A phone fits a diagram to width, so its on-screen text size is a pure function of canvas width:
//   px = smallest declared font size x (MOBILE_CONTENT_PX / canvas width)
// MOBILE_CONTENT_PX = 312 was measured on a real page (figure.diagram boundingBox at a 390px viewport).
// The MOBILE variant of every diagram must clear MOBILE_FLOOR_PX on EVERY text element (the owner's rule:
// "you always need a mobile friendly version"); the build step fails when it cannot.

export const MOBILE_CONTENT_PX = 312;
export const MOBILE_FLOOR_PX = 11;

const stripMeta = (svg) => svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');

// Every font size an SVG declares: presentation attributes (font-size="13"), CSS declarations in <style> or
// style="" (font-size: 13px — the story SVGs size ALL their text this way), and the `font: 13px …` shorthand.
export function fontSizesOf(svg) {
  const s = stripMeta(svg);
  const out = [];
  for (const m of s.matchAll(/font-size\s*[:=]\s*"?\s*([0-9.]+)/g)) out.push(Number(m[1]));
  for (const m of s.matchAll(/(?:^|[;{\s"])font\s*:\s*(?:[a-z0-9-]+\s+)*([0-9.]+)px/g)) out.push(Number(m[1]));
  return out;
}

const canvasW = (svg) => { const m = /viewBox="0 0 ([0-9.]+)/.exec(svg); return m ? Number(m[1]) : 0; };
const r2 = (v) => Math.round(v * 100) / 100;

/** Smallest text of ANY kind on a phone, in CSS px (null when the SVG declares no text). */
export function minTextPx(svg) {
  const W = canvasW(svg), sizes = fontSizesOf(svg);
  if (!W || !sizes.length) return null;
  return r2(Math.min(...sizes) * (MOBILE_CONTENT_PX / W));
}

/** The desktop variant's card-label size if a phone were shown it (eyebrows/captions <=12px excluded); informational. */
export function labelPx(svg) {
  const W = canvasW(svg), labels = fontSizesOf(svg).filter((x) => x > 12);
  if (!labels.length || !W) return null;
  return r2(Math.min(...labels) * (MOBILE_CONTENT_PX / W));
}

// ── label collisions ───────────────────────────────────────────────────────────────────────────────
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (a, n) => { const m = new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(a); return m ? m[1] : null; };

function classRules(svg) {
  const rules = {};
  for (const m of svg.matchAll(/\.([a-z][\w-]*)\s*\{([^}]*)\}/gi)) {
    const body = m[2];
    const fs = /font-size\s*:\s*([0-9.]+)/.exec(body) || /font\s*:\s*(?:[a-z0-9-]+\s+)*([0-9.]+)px/.exec(body);
    rules[m[1]] = {
      size: fs ? Number(fs[1]) : null,
      bold: /font-weight\s*:\s*(?:[7-9]00|bold)/.test(body),
      mono: /font\s*:[^;]*(?:mono|Menlo)/i.test(body) || /font-family\s*:[^;]*mono/i.test(body),
    };
  }
  return rules;
}

// The hero refusal animation swaps a chip's BEFORE value (class "dec dN") for its AFTER value ("ter tN") in one spot, by design.
const swapKey = (cls) => { const m = /\b(?:dec d|ter t)(\d+)\b/.exec(cls || ''); return m ? m[1] : null; };

/** Every visible label with an estimated bounding box, read from the emitted markup (not from the layout code). */
export function textBoxes(svg) {
  const s = stripMeta(svg).replace(/<g class="sd-actC">[\s\S]*?<\/g>/g, '');   // the story's ACTIVE/PICKED overlay shares a spot by design
  const rules = classRules(s);
  const boxes = [];
  for (const m of s.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = m[1];
    if (/\bfilter="/.test(a)) continue;                     // the blurred glow twin of a title
    const content = unesc(m[2].replace(/<[^>]+>/g, ''));
    if (!content.trim()) continue;
    const cls = (attr(a, 'class') || '').split(/\s+/).map((c) => rules[c]).filter(Boolean);
    const style = attr(a, 'style') || '';
    const sizeStyle = /font-size\s*:\s*([0-9.]+)/.exec(style);
    const size = sizeStyle ? Number(sizeStyle[1]) : attr(a, 'font-size') ? Number(attr(a, 'font-size')) : (cls.find((c) => c.size) || {}).size || 14;
    const bold = Number(attr(a, 'font-weight') || 0) >= 700 || cls.some((c) => c.bold);
    const mono = /mono|Menlo/i.test(attr(a, 'font-family') || '') || cls.some((c) => c.mono);
    const x = Number(attr(a, 'x')), y = Number(attr(a, 'y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const ls = Number(attr(a, 'letter-spacing') || 0);
    const w = content.length * (size * (mono || bold ? 0.6 : 0.55) + ls);
    const anchor = attr(a, 'text-anchor') || 'start';
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const central = attr(a, 'dominant-baseline') === 'central';
    const y0 = central ? y - size * 0.5 : y - size * 0.8;
    boxes.push({ text: content, x0, x1: x0 + w, y0, y1: y0 + size, size, swap: swapKey(attr(a, 'class')) });
  }
  return boxes;
}

/** Pairs of labels whose boxes overlap by more than 1px in both axes. */
export function findTextOverlaps(svg) {
  const b = textBoxes(svg), out = [];
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      const ox = Math.min(b[i].x1, b[j].x1) - Math.max(b[i].x0, b[j].x0);
      const oy = Math.min(b[i].y1, b[j].y1) - Math.max(b[i].y0, b[j].y0);
      if (ox > 1 && oy > 1 && !(b[i].swap != null && b[i].swap === b[j].swap)) out.push([b[i].text, b[j].text]);
    }
  }
  return out;
}

/** Labels whose estimated box leaves the canvas (the right/left edge) — a label that would be cut off. */
export function textOutsideCanvas(svg) {
  const W = canvasW(svg);
  return textBoxes(svg).filter((t) => t.x0 < -1 || t.x1 > W + 1).map((t) => t.text);
}

/** Everything wrong with a PHONE svg: text under the floor, labels that collide, labels that leave the canvas. */
export function legibilityDefects(svg) {
  const out = [];
  const px = minTextPx(svg);
  if (px == null) out.push('declares no text size at all');
  else if (px < MOBILE_FLOOR_PX) out.push(`smallest text is ${px}px on a phone (floor ${MOBILE_FLOOR_PX}px)`);
  for (const [a, b] of findTextOverlaps(svg)) out.push(`labels overlap: "${a}" / "${b}"`);
  for (const t of textOutsideCanvas(svg)) out.push(`label leaves the canvas: "${t}"`);
  return out;
}

/**
 * Draw a phone twin and prove it: pass 1 at normal wrapping; on any defect ONE corrective pass re-flows with tighter
 * wrapping (`render(0.88)`); if that still has a defect the build step fails, loudly, naming each defect.
 * @param {string} label    what is being drawn (for the error)
 * @param {(wrapScale:number)=>string} render  returns the finished SVG text
 * @returns {{ svg: string, px: number, pass: 1|2 }}
 */
export function drawMobileChecked(label, render) {
  let defects = [];
  for (const [pass, scale] of [[1, 1], [2, 0.88]]) {
    const svg = render(scale);
    defects = legibilityDefects(svg);
    if (!defects.length) return { svg, px: minTextPx(svg), pass };
  }
  throw new Error(`${label}: the phone layout still fails after the corrective re-flow — ${defects.join('; ')}`);
}

/** The one stderr line for a page's diagrams. */
export function reportLegibility(tool, merged) {
  const entries = Object.entries(merged).filter(([, v]) => v && typeof v.mobileLabelPx === 'number');
  if (!entries.length) return;
  process.stderr.write(`${tool}: phone text size @${MOBILE_CONTENT_PX}px (floor ${MOBILE_FLOOR_PX}px) — `
    + `${entries.map(([k, v]) => `${k.replace('Diagram', '')} ${v.mobileLabelPx}px`).join(' · ')}\n`);
}
