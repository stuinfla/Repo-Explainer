// tools/diagrams/draw.mjs — the shared drawing kit for make-diagrams: colour, palette, text metrics, glass
// primitives, wrapping, and the scoped <svg> wrapper. No I/O; the one piece of module state is the live palette.

import { esc as escapeXml } from '../../src/story-diagrams.mjs';

export { escapeXml };

export const TOOL = 'make-diagrams';

export function die(error) {
  process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error }) + '\n');
  process.stderr.write(`${TOOL}: ${error}\n`);
  process.exit(1);
}
export const warn = (msg) => process.stderr.write(`${TOOL}: warning: ${msg}\n`);

export const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── colour utilities ─────────────────────────────────────────────────────────────────────────────
function hx(h) {
  h = String(h || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [124, 92, 255];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
export const tint = (hex, a) => { const [r, g, b] = hx(hex); return `rgba(${r},${g},${b},${a})`; };
// lift a possibly-dim brand colour so it pops on a near-black canvas
function vivid(hex) {
  const [r, g, b] = hx(hex);
  const max = Math.max(r, g, b);
  if (max >= 150) return toHex([r, g, b]);
  const k = 175 / Math.max(1, max);
  return toHex([r * k, g * k, b * k]);
}

// ── palette: vibrant accents (themed from concept.palette) on a FIXED dark canvas ─────────────────
export function resolvePalette(concept) {
  const p = concept && typeof concept === 'object' ? concept.palette : null;
  const g = (k) => (p && typeof p[k] === 'string' && /^#([0-9a-f]{3}){1,2}$/i.test(p[k].trim())) ? p[k].trim() : null; // hex only: palette values land in fill=/stroke= attributes
  const DEF = ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa'];
  const brand = [g('accent'), g('accent-2'), g('accent-3'), g('accent-4'), g('spectrum')].filter(Boolean).map(vivid);
  const accents = (brand.length ? [...brand, ...DEF] : DEF).slice(0, 6);
  return {
    accents, primary: accents[0],
    bgTop: '#0b1018', bgMid: '#0a0e15', bgBot: '#070a10',
    ink: '#f1f5f9', sub: '#aab6c8', muted: '#7c8aa0',
    glass: 'rgba(255,255,255,0.05)', glassStroke: 'rgba(255,255,255,0.10)', edge: 'rgba(255,255,255,0.16)',
    extern: '#7587a0',
  };
}
export let PAL = resolvePalette(null);
export function setPalette(concept) { PAL = resolvePalette(concept); return PAL; }
export const accent = (i) => PAL.accents[((i % PAL.accents.length) + PAL.accents.length) % PAL.accents.length];

// ── text metrics + emit ───────────────────────────────────────────────────────────────────────────
export const FH = 'ui-sans-serif,system-ui,-apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif';
export const FM = 'ui-monospace,SFMono-Regular,&quot;SF Mono&quot;,Menlo,Monaco,Consolas,monospace';
/** Estimated advance width of `s` at `size` px (the one metric both the layout and the overlap check use). */
export const measure = (s, size, { bold = false, mono = false } = {}) =>
  String(s == null ? '' : s).length * size * (mono ? 0.6 : bold ? 0.6 : 0.55);
export function txt(x, y, s, o = {}) {
  const { size = 14, fill = PAL.ink, weight = 400, anchor = 'start', mono = false, ls, opacity, dom, extra, cls } = o;
  return `<text${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" font-family="${mono ? FM : FH}" font-size="${size}" font-weight="${weight}"`
    + ` fill="${fill}" text-anchor="${anchor}"${dom ? ` dominant-baseline="${dom}"` : ''}`
    + `${ls != null ? ` letter-spacing="${ls}"` : ''}${opacity != null ? ` opacity="${opacity}"` : ''}${extra ? ` ${extra}` : ''}>${escapeXml(s)}</text>`;
}

// ── shared visual primitives (glassmorphic + glow) ─────────────────────────────────────────────────
function defs(pal) {
  return `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${pal.bgTop}"/><stop offset="0.55" stop-color="${pal.bgMid}"/><stop offset="1" stop-color="${pal.bgBot}"/>
    </linearGradient>
    <radialGradient id="spot" cx="0.5" cy="0.02" r="0.8">
      <stop offset="0" stop-color="${tint(pal.primary, 0.1)}"/><stop offset="0.5" stop-color="${tint(pal.primary, 0.025)}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(255,255,255,0.09)"/><stop offset="0.5" stop-color="rgba(255,255,255,0.015)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.014)"/>
    </pattern>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="11"/></filter>
    <filter id="glowS" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="cardSh" x="-40%" y="-50%" width="180%" height="210%">
      <feDropShadow dx="0" dy="6" stdDeviation="11" flood-color="#000000" flood-opacity="0.34"/>
    </filter>
  </defs>`;
}
const DEF_IDS = ['bg', 'spot', 'sheen', 'grid', 'glow', 'glowS', 'cardSh'];

export function background(W, H) {
  return [
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)"/>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#spot)"/>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grid)"/>`,
  ].join('\n');
}

// a glassmorphic rounded panel with a colored glow aura, a darker extruded base (depth), and a sheen.
// `solid` lays an opaque canvas-coloured plate under it so connector lines never run through the card's text.
export function glassPanel(x, y, w, h, col, { r = 16, fillA = 0.16, depth = 10, aura = 0.5, solid = false } = {}) {
  const parts = [];
  if (aura) parts.push(`  <rect x="${x - 5}" y="${y - 3}" width="${w + 10}" height="${h + 10}" rx="${r + 4}" fill="${col}" opacity="${(aura * 0.5).toFixed(3)}" filter="url(#glow)"/>`);
  if (depth) parts.push(`  <rect x="${x}" y="${y + depth}" width="${w}" height="${h}" rx="${r}" fill="${tint(mix(col, '#000000', 0.6), 0.85)}"/>`);
  if (solid) parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${PAL.bgMid}"/>`);
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${tint(col, fillA)}" stroke="${tint(col, 0.42)}" stroke-width="1.25" filter="url(#cardSh)"/>`);
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)"/>`);
  parts.push(`  <path d="M ${x + r} ${y + 1.25} H ${x + w - r}" stroke="rgba(255,255,255,0.14)" stroke-width="1" fill="none" stroke-linecap="round"/>`);
  return parts.join('\n');
}

// glowing connector beam with a chevron arrowhead at the destination
export function beam(x1, y1, x2, y2, col, delay = null) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const wing = 9;
  const lx = x2 - Math.cos(ang - 0.5) * wing, ly = y2 - Math.sin(ang - 0.5) * wing;
  const rx = x2 - Math.cos(ang + 0.5) * wing, ry = y2 - Math.sin(ang + 0.5) * wing;
  const bright = mix(col, '#ffffff', 0.25);
  const delayAttr = delay != null ? ` style="animation-delay:${delay.toFixed(2)}s"` : '';
  return [
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="9" opacity="0.3" filter="url(#glow)" stroke-linecap="round"/>`,
    `  <line class="flow-line"${delayAttr} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${bright}" stroke-width="2.4" stroke-linecap="round"/>`,
    `  <path d="M ${lx.toFixed(1)} ${ly.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)}" fill="none" stroke="${bright}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('\n');
}

export function header(cx, top, eyebrow, title, pal) {
  return [
    txt(cx, top + 14, eyebrow, { size: 13, mono: true, fill: pal.primary, weight: 600, anchor: 'middle', ls: 3 }),
    `  <text x="${cx}" y="${top + 50}" font-family="${FH}" font-size="30" font-weight="800" fill="${pal.primary}" text-anchor="middle" opacity="0.45" filter="url(#glowS)">${escapeXml(title)}</text>`,
    txt(cx, top + 50, title, { size: 30, weight: 800, fill: pal.ink, anchor: 'middle' }),
    `  <line x1="${cx - 34}" y1="${top + 68}" x2="${cx + 34}" y2="${top + 68}" stroke="${pal.primary}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`,
  ].join('\n');
}

// a directional dependency edge: a smooth bezier that LEAVES the source straight down and ARRIVES at the target
// straight down, so a downward chevron arrowhead is always correct. Glow underlay + bright core.
export function curve(x1, y1, x2, y2, col, { w = 1.9, op = 0.82, glow = true, delay = null } = {}) {
  const dy = Math.max(18, (y2 - y1) * 0.26);
  const tip = y2, base = y2 - 10;
  const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + dy).toFixed(1)}, ${x2.toFixed(1)} ${(tip - dy).toFixed(1)}, ${x2.toFixed(1)} ${base.toFixed(1)}`;
  const bright = mix(col, '#ffffff', 0.2);
  const delayAttr = delay != null ? ` style="animation-delay:${delay.toFixed(2)}s"` : '';
  const parts = [];
  if (glow) parts.push(`  <path d="${d}" fill="none" stroke="${col}" stroke-width="${w + 2}" opacity="0.06" filter="url(#glow)"/>`);
  parts.push(`  <path class="flow-line"${delayAttr} d="${d}" fill="none" stroke="${bright}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`);
  const aw = 6, ah = 9.5;
  parts.push(`  <path d="M ${(x2 - aw).toFixed(1)} ${(tip - ah).toFixed(1)} L ${x2.toFixed(1)} ${tip.toFixed(1)} L ${(x2 + aw).toFixed(1)} ${(tip - ah).toFixed(1)} Z" fill="${bright}" opacity="${op}"/>`);
  return parts.join('\n');
}

// ── wrapping ─────────────────────────────────────────────────────────────────────────────────────
// Split one over-long token at - _ / . boundaries first, then hard, so a long identifier wraps instead of overflowing.
function breakToken(word, cap) {
  if (word.length <= cap) return [word];
  const pieces = word.match(/[^-_/.]+[-_/.]?|[-_/.]+/g) || [word];
  const out = [];
  let cur = '';
  for (const p of pieces) {
    if ((cur + p).length <= cap) { cur += p; continue; }
    if (cur) out.push(cur);
    cur = '';
    let rest = p;
    while (rest.length > cap) { out.push(rest.slice(0, cap)); rest = rest.slice(cap); }
    cur = rest;
  }
  if (cur) out.push(cur);
  return out;
}

// word-wrap to at most `maxChars` per line. `hard` also breaks a single token longer than a line.
export function wrapText(text, maxChars, { hard = false } = {}) {
  const cap = Math.max(8, maxChars);
  let words = String(text).trim().split(/\s+/).filter(Boolean);
  if (hard) words = words.flatMap((w) => breakToken(w, cap));
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cap) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

// caption: WRAP to the real canvas width (mono) so it can never spill past the edges; returns the caption SVG
// plus the bottom-band height to add under the diagram content (min = minPad).
export function captionBlock(cx, contentH, availW, caption, pal, minPad) {
  const FS = 13, CW = FS * 0.6, LH = FS * 1.5;
  if (!caption) return { svg: '', band: minPad };
  const cap = Math.max(16, Math.floor((availW - 104) / CW));
  let lines = wrapText(caption, cap);
  if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = clip(lines[2] + ' …', cap); }
  const parts = [];
  let y = contentH + 34 + FS;
  for (const l of lines) { parts.push(txt(cx, y, l, { size: FS, mono: true, fill: pal.muted, anchor: 'middle' })); y += LH; }
  return { svg: parts.join('\n'), band: Math.max(minPad, 34 + lines.length * LH + 22) };
}

// wrap a label to fit inside a card of inner width `innerW` at font `fs`, capped at `maxLines` (… on overflow).
// `bold` uses the bold advance so the wrapped text agrees with measure() and cannot overrun the card.
export function fitLines(label, innerW, fs, maxLines, { bold = false } = {}) {
  const perLine = Math.max(6, Math.floor(innerW / (fs * (bold ? 0.6 : 0.55))));
  let lines = wrapText(clip(label, perLine * maxLines), perLine);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = clip(lines[maxLines - 1] + ' …', perLine); }
  return lines;
}

// ── the scoped <svg> wrapper ─────────────────────────────────────────────────────────────────────
// Every rule is scoped under the SVG's own id and every keyframe/def id carries it as a prefix, so the file can be
// inlined next to other SVGs (or into the page) without its CSS or ids leaking. Motion is opacity/transform only;
// prefers-reduced-motion stops it and leaves the static end-state.
export function flowStyle(id) {
  return `  <style>
    #${id} .flow-line { stroke-dasharray: 8 10; stroke-width: 3; animation: ${id}-flow 2.4s ease-in-out infinite; }
    @keyframes ${id}-flow { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
    #${id} .node-pulse { transform-box: fill-box; transform-origin: center; animation: ${id}-pulse 2.1s cubic-bezier(0.4,0,0.2,1) infinite; }
    @keyframes ${id}-pulse { 0%, 100% { opacity: 0.35; transform: scale(1); } 50% { opacity: 1; transform: scale(1.6); } }
    @media (prefers-reduced-motion: reduce) { #${id} .flow-line, #${id} .node-pulse { animation: none; } }
  </style>`;
}

/** Prefix the shared def ids (and every url(#…) use) so two inlined SVGs never share an id. */
export function scopeIds(svg, id) {
  let out = svg;
  for (const d of DEF_IDS) out = out.split(`id="${d}"`).join(`id="${id}-${d}"`).split(`url(#${d})`).join(`url(#${id}-${d})`);
  return out;
}

export function wrapSvg({ id, W, H, body, title, desc, ascii, extraStyle, extraAttrs = '' }) {
  const svg = `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${id}-title ${id}-desc"${extraAttrs}>
  <title id="${id}-title">${escapeXml(title)}</title>
  <desc id="${id}-desc">${escapeXml(desc)}</desc>
${ascii ? `  <metadata><![CDATA[\n${String(ascii).replace(/]]>/g, ']]&gt;')}\n]]></metadata>\n` : ''}${flowStyle(id)}
${extraStyle || ''}
${defs(PAL)}
${body}
</svg>
`;
  return scopeIds(svg, id);
}
