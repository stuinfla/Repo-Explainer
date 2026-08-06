#!/usr/bin/env node
// make-diagrams.mjs — Station 4 structural-SVG rung (tools/ CONTRACT.md row 4)
//
// JOB (ADR-0005 Station 4 + INV-18 + DDD §13 INV-15): produce the structural-diagram SVGs as REAL,
// BEAUTIFUL vector diagrams — dark, layered/isometric, glassmorphic glowing cards on a dark gradient
// canvas — NOT raw ASCII as <text>, and NOT a flat freshman wireframe. The MANDATORY architecture
// diagram (grounded in the REAL kb dep-graph + symbols) is drawn as a LAYERED STACK (entry → core →
// foundation → external) of glowing glass slabs with glowing connectors; the MANDATORY process/data-
// flow diagram (grounded in the REAL kb entrypoints) is drawn as a STEPPED VERTICAL PATH with depth
// and glowing arrows. big-idea & aha-insight diagrams are drawn from brain-authored structure.
//
// STYLE (the fix for the owner's "flat boxes on light = garbage" note): dark gradient background
// (#0b1018 → #070a10) with a soft top spotlight + faint dot grid; glassmorphic translucent cards
// (semi-transparent fills + subtle light strokes + a glass sheen); colored glow via an SVG blur
// filter (a blurred accent aura is drawn behind each lit element); vibrant accent colours pulled from
// the brain's concept.palette (accent / accent-2 / accent-3) that read well on dark; white/light text;
// monospace technical eyebrow + caption. Methodology mirrors the ascii-to-svg skill (parse → elements
// → pixel positions → render shapes then connectors → xmllint validate) with a custom dark/glow style.
//
// ACCESSIBILITY: every SVG keeps an ASCII/textual fallback in <title>/<desc>, and build.json carries
// altText + asciiFallback next to each rendered SVG — the ASCII source is a FEATURE (for humans AND AI).
//
// CONTRACT: uniform `node tools/make-diagrams.mjs <build-dir>`; reads ONLY its declared slice
// (kb.depGraphPath/.entrypointsPath/.symbolsPath + visuals.<key>.{ascii,altText} + concept.palette);
// writes ONLY visuals.architectureDiagram/.flowDiagram/.bigIdeaDiagram/.insightDiagram + the four .svg;
// PURE (no network); FAIL LOUD (non-zero + clear reason, never a silent placeholder); idempotent.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL = 'make-diagrams';

function die(error) {
  process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error }) + '\n');
  process.stderr.write(`${TOOL}: ${error}\n`);
  process.exit(1);
}
const warn = (msg) => process.stderr.write(`${TOOL}: warning: ${msg}\n`);

function loadJson(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { die(`cannot read ${label} at ${file}: ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { die(`${label} at ${file} is not valid JSON: ${e.message}`); }
}

function resolveKbPath(p, buildDir) {
  if (!p || typeof p !== 'string') return null;
  const cands = path.isAbsolute(p) ? [p] : [path.resolve(process.cwd(), p), path.resolve(buildDir, p)];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ── colour utilities ─────────────────────────────────────────────────────────────────────────────
function hx(h) {
  h = String(h || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [124, 92, 255];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const tint = (hex, a) => { const [r, g, b] = hx(hex); return `rgba(${r},${g},${b},${a})`; };
// lift a possibly-dim brand colour so it pops on a near-black canvas
function vivid(hex) {
  const [r, g, b] = hx(hex);
  const max = Math.max(r, g, b);
  if (max >= 150) return hex;             // already bright enough
  const k = 175 / Math.max(1, max);        // scale up toward a luminous version
  return toHex([r * k, g * k, b * k]);
}

// ── palette: vibrant accents (themed from concept.palette) on a FIXED dark canvas ─────────────────
function resolvePalette(concept) {
  const p = concept && typeof concept === 'object' ? concept.palette : null;
  const g = (k) => (p && typeof p[k] === 'string' && p[k].trim()) ? p[k].trim() : null;
  // dark-friendly, luminous default spectrum: cyan · violet · emerald · pink · amber · blue
  const DEF = ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa'];
  const brand = [g('accent'), g('accent-2'), g('accent-3'), g('accent-4'), g('spectrum')].filter(Boolean).map(vivid);
  const accents = (brand.length ? [...brand, ...DEF] : DEF).slice(0, 6);
  return {
    accents,
    primary: accents[0],
    bgTop: '#0b1018', bgMid: '#0a0e15', bgBot: '#070a10',
    ink: '#f1f5f9', sub: '#aab6c8', muted: '#7c8aa0',
    glass: 'rgba(255,255,255,0.05)', glassStroke: 'rgba(255,255,255,0.10)', edge: 'rgba(255,255,255,0.16)',
    extern: '#7587a0',
  };
}
let PAL = resolvePalette(null);
const accent = (i) => PAL.accents[((i % PAL.accents.length) + PAL.accents.length) % PAL.accents.length];

// ── text metrics + emit ───────────────────────────────────────────────────────────────────────────
const FH = 'ui-sans-serif,system-ui,-apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif';
const FM = 'ui-monospace,SFMono-Regular,&quot;SF Mono&quot;,Menlo,Monaco,Consolas,monospace';
const measure = (s, size, { bold = false, mono = false } = {}) =>
  String(s == null ? '' : s).length * size * (mono ? 0.6 : bold ? 0.6 : 0.55);
function txt(x, y, s, o = {}) {
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

function background(W, H, pal) {
  return [
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)"/>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#spot)"/>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grid)"/>`,
  ].join('\n');
}

// a glassmorphic rounded panel with a colored glow aura, a darker extruded base (depth), and a sheen.
function glassPanel(x, y, w, h, col, { r = 16, fillA = 0.16, depth = 10, aura = 0.5 } = {}) {
  const parts = [];
  if (aura) parts.push(`  <rect x="${x - 5}" y="${y - 3}" width="${w + 10}" height="${h + 10}" rx="${r + 4}" fill="${col}" opacity="${(aura * 0.5).toFixed(3)}" filter="url(#glow)"/>`);
  if (depth) parts.push(`  <rect x="${x}" y="${y + depth}" width="${w}" height="${h}" rx="${r}" fill="${tint(mix(col, '#000000', 0.6), 0.85)}"/>`);
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${tint(col, fillA)}" stroke="${tint(col, 0.42)}" stroke-width="1.25" filter="url(#cardSh)"/>`);
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)"/>`);
  // a whisper of a top-edge highlight (restraint — no glossy bevel)
  parts.push(`  <path d="M ${x + r} ${y + 1.25} H ${x + w - r}" stroke="rgba(255,255,255,0.14)" stroke-width="1" fill="none" stroke-linecap="round"/>`);
  return parts.join('\n');
}

// a darker "glass chip" (component / token) that sits on top of a panel — readable white label
function glassChip(x, y, w, h, col, label, sub, { r = 12 } = {}) {
  const cx = x + 18;
  const parts = [];
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="rgba(11,15,23,0.7)" stroke="${tint(col, 0.45)}" stroke-width="1.25" filter="url(#cardSh)"/>`);
  parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)" opacity="0.4"/>`);
  // a pulsing node dot — every card's "alive" signal, independent of whether it has any edges
  parts.push(`  <circle class="node-pulse" cx="${cx}" cy="${y + h / 2}" r="4.5" fill="${col}" opacity="0.4" filter="url(#glowS)"/>`);
  parts.push(`  <circle cx="${cx}" cy="${y + h / 2}" r="3.2" fill="${mix(col, '#ffffff', 0.35)}"/>`);
  const tx = cx + 16;
  if (sub) {
    parts.push(txt(tx, y + h / 2 - 6, label, { size: 15.5, weight: 700, fill: PAL.ink }));
    parts.push(txt(tx, y + h / 2 + 13, sub, { size: 11, mono: true, fill: PAL.sub }));
  } else {
    parts.push(txt(tx, y + h / 2, label, { size: 15.5, weight: 700, fill: PAL.ink, dom: 'central' }));
  }
  return parts.join('\n');
}

// glowing connector beam (vertical or horizontal) with a chevron arrowhead at the destination
function beam(x1, y1, x2, y2, col, delay = null) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ax = x2 - Math.cos(ang) * 0, ay = y2 - Math.sin(ang) * 0;
  const wing = 9;
  const lx = ax - Math.cos(ang - 0.5) * wing, ly = ay - Math.sin(ang - 0.5) * wing;
  const rx = ax - Math.cos(ang + 0.5) * wing, ry = ay - Math.sin(ang + 0.5) * wing;
  const bright = mix(col, '#ffffff', 0.25);
  const delayAttr = delay != null ? ` style="animation-delay:${delay.toFixed(2)}s"` : '';
  return [
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="9" opacity="0.3" filter="url(#glow)" stroke-linecap="round"/>`,
    `  <line class="flow-line"${delayAttr} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${bright}" stroke-width="2.4" stroke-linecap="round"/>`,
    `  <path d="M ${lx.toFixed(1)} ${ly.toFixed(1)} L ${ax.toFixed(1)} ${ay.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)}" fill="none" stroke="${bright}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('\n');
}

function header(cx, top, eyebrow, title, pal) {
  const out = [];
  out.push(txt(cx, top + 14, eyebrow, { size: 13, mono: true, fill: pal.primary, weight: 600, anchor: 'middle', ls: 3 }));
  out.push(`  <text x="${cx}" y="${top + 50}" font-family="${FH}" font-size="30" font-weight="800" fill="${pal.primary}" text-anchor="middle" opacity="0.45" filter="url(#glowS)">${escapeXml(title)}</text>`);
  out.push(txt(cx, top + 50, title, { size: 30, weight: 800, fill: pal.ink, anchor: 'middle' }));
  out.push(`  <line x1="${cx - 34}" y1="${top + 68}" x2="${cx + 34}" y2="${top + 68}" stroke="${pal.primary}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`);
  return out.join('\n');
}

// Traveling-dash flow animation on connector lines — added 2026-07-12. Purposeful, not
// decorative: these diagrams' whole job is showing dependency/process DIRECTION, and a
// static arrow asks the reader to mentally simulate motion that isn't there. This shows it.
// Baked directly into the SVG (not page CSS) because these files are embedded via <img> —
// external stylesheets can't reach inside them. Respects prefers-reduced-motion natively
// (SVG <style> supports the same media query as any stylesheet).
// 2026-07-12, round 2: the first pass (thin-line dash only) was too weak to register, and on
// diagrams with zero dependency edges (this real repo's architecture graph: 2 modules, 0 links)
// there was literally nothing for it to animate — a real miss, not just subtlety. Fixed with a
// SECOND, independent animation on the node/badge glow circles — present on EVERY card and EVERY
// flow step regardless of edge count, so it can never go silent. Bold on purpose: opacity 0.35->1
// AND a 1.5x scale pulse, not a flicker.
const FLOW_STYLE = `  <style>
    .flow-line { stroke-dasharray: 8 10; stroke-width: 3; animation: flow-dash 1.1s linear infinite; }
    @keyframes flow-dash { to { stroke-dashoffset: -36; } }
    .node-pulse { transform-box: fill-box; transform-origin: center; animation: node-pulse 2.1s cubic-bezier(0.4,0,0.2,1) infinite; }
    @keyframes node-pulse { 0%, 100% { opacity: 0.35; transform: scale(1); } 50% { opacity: 1; transform: scale(1.6); } }
    @media (prefers-reduced-motion: reduce) { .flow-line, .node-pulse { animation: none; } }
  </style>`;

// ── THE REFUSAL (hero animation) ────────────────────────────────────────────────────────────────
// Motion that carries the ARGUMENT, not decoration. Every previous attempt animated the chrome —
// crawling dashed lines — and rightly read as filler. This performs the single idea the whole page
// rests on, above the fold, in nine seconds and no words from the reader:
//   the model's messy decimal weights SNAP to −1 / 0 / +1  →  each becomes subtract / skip / add
//   →  the multiply sign is struck through and dies  →  "it never multiplies."
// One shared 9s timeline (every element keys off the same duration, expressing its beat as a
// percentage) so nothing can drift out of phase on a long-running loop — the failure mode you get
// from per-element durations + delays. Honours prefers-reduced-motion by settling on the END state
// (ternary values + ops visible, multiply already dead), which is the state that carries the meaning.
// THIS IS PER-REPO CONTENT AND MUST COME FROM build.json — NEVER a constant in this file.
// (2026-07-12: it WAS a constant here for about twenty minutes — ternlight's own ternary weights,
// hardcoded — which would have stapled ternlight's animation onto every other repo's hero. Same class
// of defect as shipping a lookalike repo. The brain authors `visuals.heroAnim`; no heroAnim, no band.)
// Shape:
//   visuals.heroAnim = {
//     label:  'The numbers inside the model',            // what the strip is showing
//     chips:  [{ before:'0.0731', after:'0', op:'skip', kind:'zero'|'neg'|'pos' }, ... 3-6 of them],
//     verdict:{ label:'The one expensive move', symbol:'×', dead:'never used' },  // the thing REMOVED
//     kicker: 'it never multiplies — and that is why it fits in 4.6 MB',
//   }
// The shape is generic on purpose: it animates a BEFORE -> AFTER transformation plus the cost it kills.
// That is a shape most interesting repos have (the trick they pull), not a ternary-specific one.
const REFUSAL_W = 1180, REFUSAL_H = 300;

function renderRefusal(pal, spec) {
  const chips = (Array.isArray(spec.chips) ? spec.chips : []).slice(0, 6)
    .map((c) => ({ dec: String(c.before ?? ''), tern: String(c.after ?? ''), op: String(c.op ?? ''), kind: c.kind || 'zero' }))
    .filter((c) => c.dec && c.tern);
  if (chips.length < 3) die('visuals.heroAnim.chips needs at least 3 entries of { before, after, op, kind } — refusing to draw a half-empty animation');
  const CW = 148, CH = 68, GAP = 22;
  const n = chips.length;
  const stripW = n * CW + (n - 1) * GAP;
  const x0 = 56, yChip = 96;
  const colOf = (k) => (k === 'pos' ? pal.accents[0] : k === 'neg' ? (pal.accents[2] || pal.accents[1]) : pal.muted);

  const css = [];
  const body = [background(REFUSAL_W, REFUSAL_H, pal)];

  body.push(txt(x0, 52, String(spec.label || 'Before'), { size: 12.5, mono: true, weight: 700, fill: pal.muted, anchor: 'start', ls: 2.2 }));

  chips.forEach((c, i) => {
    const x = x0 + i * (CW + GAP), cx = x + CW / 2, col = colOf(c.kind);
    // each chip snaps on its own beat, staggered across 18%→38% of the shared timeline
    const t0 = 18 + i * 4;              // snap start, %
    const t1 = t0 + 5;                  // snap end, %
    const tOp = t1 + 6;                 // the op word lands after the snap
    body.push(glassPanel(x, yChip, CW, CH, col, { r: 14, fillA: 0.16, depth: 8, aura: 0.45 }));
    // decimal (fades OUT on the snap) and ternary value (pops IN) share the chip's centre
    body.push(txt(cx, yChip + CH / 2, c.dec, { size: 19, mono: true, weight: 600, fill: pal.ink, anchor: 'middle', dom: 'central', cls: `dec d${i}` }));
    body.push(txt(cx, yChip + CH / 2, c.tern, { size: 26, weight: 800, fill: col, anchor: 'middle', dom: 'central', cls: `ter t${i}` }));
    body.push(txt(cx, yChip + CH + 40, c.op, { size: 15.5, mono: true, weight: 700, fill: col, anchor: 'middle', cls: `op o${i}` }));
    css.push(
      // before-value fully clears (opacity 0) BEFORE the after-value appears — no frame shows both
      // overlapping in the shared chip centre (the vision grader's worst-frame rule caught the collision).
      `@keyframes dec${i}{0%,${t0}%{opacity:1;transform:scale(1)}${t0 + 3}%,100%{opacity:0;transform:scale(0.82)}}`,
      `@keyframes ter${i}{0%,${t0 + 3}%{opacity:0;transform:scale(0.6)}${t1 + 2}%{opacity:1;transform:scale(1.18)}${t1 + 6}%,100%{opacity:1;transform:scale(1)}}`,
      `@keyframes op${i}{0%,${tOp}%{opacity:0;transform:translateY(6px)}${tOp + 5}%,100%{opacity:1;transform:translateY(0)}}`,
      `.d${i}{animation:dec${i} 9s linear infinite}`,
      `.t${i}{animation:ter${i} 9s cubic-bezier(.2,1.6,.35,1) infinite}`,
      `.o${i}{animation:op${i} 9s ease-out infinite}`,
    );
  });

  // the verdict panel: the multiply sign, struck out and killed
  const vx = x0 + stripW + 54, vcx = vx + 92;
  const V = spec.verdict || {};
  body.push(txt(vcx, 52, String(V.label || 'The expensive move'), { size: 12.5, mono: true, weight: 700, fill: pal.muted, anchor: 'middle', ls: 2.2 }));
  body.push(txt(vcx, yChip + CH / 2, String(V.symbol || '\u00d7'), { size: 74, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central', cls: 'mul' }));
  body.push(`  <line class="strike" x1="${vcx - 46}" y1="${yChip + CH / 2 + 34}" x2="${vcx + 46}" y2="${yChip + CH / 2 - 34}" stroke="${pal.accents[0]}" stroke-width="6" stroke-linecap="round"/>`);
  body.push(txt(vcx, yChip + CH + 40, String(V.dead || 'never used'), { size: 15.5, mono: true, weight: 700, fill: pal.accents[0], anchor: 'middle', cls: 'verdict' }));

  body.push(txt(REFUSAL_W / 2, 258, String(spec.kicker || ''), { size: 17, weight: 700, fill: pal.ink, anchor: 'middle', cls: 'kicker' }));

  css.push(
    // the strike is DRAWN across the × (dash-offset), then the × dies back
    `.strike{stroke-dasharray:130;stroke-dashoffset:130;animation:strike 9s ease-in-out infinite}`,
    `@keyframes strike{0%,58%{stroke-dashoffset:130}68%,100%{stroke-dashoffset:0}}`,
    `.mul{transform-box:fill-box;transform-origin:center;animation:mul 9s ease-in-out infinite}`,
    `@keyframes mul{0%,58%{opacity:0.95;transform:scale(1)}70%{opacity:0.95;transform:scale(1)}78%,100%{opacity:0.16;transform:scale(0.9)}}`,
    `@keyframes verdict{0%,72%{opacity:0;transform:translateY(6px)}80%,100%{opacity:1;transform:translateY(0)}}`,
    `.verdict{animation:verdict 9s ease-out infinite}`,
    `@keyframes kicker{0%,80%{opacity:0}88%,100%{opacity:1}}`,
    `.kicker{animation:kicker 9s ease-out infinite}`,
    // transforms must pivot on each glyph, not the SVG origin
    `.dec,.ter,.op,.verdict,.kicker{transform-box:fill-box;transform-origin:center}`,
    // reduced motion: settle on the END state — the meaning, with no movement
    `@media (prefers-reduced-motion:reduce){.dec,.ter,.op,.mul,.strike,.verdict,.kicker{animation:none}`
      + `.dec{opacity:0}.ter,.op,.verdict,.kicker{opacity:1}.mul{opacity:0.16}.strike{stroke-dashoffset:0}}`,
  );

  const style = `  <style>\n    ${css.join('\n    ')}\n  </style>`;
  const desc = `${spec.label || 'Before'}: ${chips.map((c) => `${c.dec} becomes ${c.tern} (${c.op})`).join('; ')}. `
    + `${(spec.verdict || {}).label || 'The expensive move'} — shown as "${(spec.verdict || {}).symbol || '\u00d7'}" — is struck through and goes dark: `
    + `${(spec.verdict || {}).dead || 'never used'}. ${spec.kicker || ''}`;
  return { W: REFUSAL_W, H: REFUSAL_H, body: body.join('\n'), desc, style };
}

function wrapSvg(W, H, body, title, desc, ascii, extraStyle) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="d-title d-desc">
  <title id="d-title">${escapeXml(title)}</title>
  <desc id="d-desc">${escapeXml(desc)}</desc>
${ascii ? `  <metadata><![CDATA[\n${String(ascii).replace(/]]>/g, ']]&gt;')}\n]]></metadata>\n` : ''}${FLOW_STYLE}
${extraStyle || ''}
${defs(PAL)}
${body}
</svg>
`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// a directional dependency edge: a smooth bezier that LEAVES the source straight down and ARRIVES at
// the target straight down, so a downward chevron arrowhead is always correct. Glow underlay + bright core.
function curve(x1, y1, x2, y2, col, { w = 1.9, op = 0.82, glow = true, delay = null } = {}) {
  const dy = Math.max(18, (y2 - y1) * 0.26);           // gentler bend = less awkward tracing
  const tip = y2, base = y2 - 10;                      // stop the line at the arrowhead base, tip at the node
  const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + dy).toFixed(1)}, ${x2.toFixed(1)} ${(tip - dy).toFixed(1)}, ${x2.toFixed(1)} ${base.toFixed(1)}`;
  const bright = mix(col, '#ffffff', 0.2);
  const delayAttr = delay != null ? ` style="animation-delay:${delay.toFixed(2)}s"` : '';
  const parts = [];
  if (glow) parts.push(`  <path d="${d}" fill="none" stroke="${col}" stroke-width="${w + 2}" opacity="0.06" filter="url(#glow)"/>`);
  parts.push(`  <path class="flow-line"${delayAttr} d="${d}" fill="none" stroke="${bright}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`);
  const aw = 6, ah = 9.5;                              // crisp solid triangular arrowhead = unambiguous direction
  parts.push(`  <path d="M ${(x2 - aw).toFixed(1)} ${(tip - ah).toFixed(1)} L ${x2.toFixed(1)} ${tip.toFixed(1)} L ${(x2 + aw).toFixed(1)} ${(tip - ah).toFixed(1)} Z" fill="${bright}" opacity="${op}"/>`);
  return parts.join('\n');
}

// ── ARCHITECTURE: a real layered-DAG dependency map — nodes placed by topological depth, every REAL
// module→module edge drawn as a directional connector, the most-depended-on module marked as the core ──
const AR = { CHIP_H: 62, CHIP_MINW: 150, CHIP_MAXW: 254, CHIP_GAP: 34,
  ROW_GAP: 104, TOP: 144, BOTTOM: 96, LEFT: 156, RIGHT: 78, EXT_GAP: 66, EXT_H: 90 };

function archChipW(it) {
  const lw = measure(clip(it.label, 26), 15, { bold: true });
  const sw = it.sub ? measure(clip(it.sub, 30), 11, { mono: true }) : 0;
  return clamp(Math.ceil(Math.max(lw, sw)) + 58, AR.CHIP_MINW, AR.CHIP_MAXW);
}

function bandName(i, total) {
  if (total <= 1) return 'MODULES';
  if (i === 0) return 'ENTRY';
  if (i === total - 1) return 'FOUNDATION';
  if (total === 3) return 'CORE';
  if (total === 4) return i === 1 ? 'CORE' : 'SERVICES';
  return `TIER ${i}`;
}

// even fan-out/fan-in: spread an edge's departure (or arrival) point across the node's edge so each
// connector gets its own port and the arrowheads never pile onto one ambiguous point
function portX(box, list, e) {
  const n = list.length, idx = list.indexOf(e);
  if (n <= 1) return box.cx;
  const inset = Math.min(28, box.w * 0.34);
  return (box.x + inset) + ((box.x + box.w - inset) - (box.x + inset)) * (idx / (n - 1));
}

function renderArchitecture(eyebrow, title, model, caption, pal) {
  const rows = model.rows, edges = model.edges;
  // MOBILE-FIRST layout (INV-18, 2026-07-30 stuinfla-helix hold — arithmetic, not taste: a
  // 12-node tier laid in one line drove the square canvas to ~1300 units; at a 390px render
  // that is ~3px text). Two changes: (a) wide tiers WRAP onto continuation lines budgeted to
  // WRAP_W, (b) the canvas is PORTRAIT (content-sized), never forced square — a phone renders
  // width-fit, so canvas width alone decides legibility.
  const WRAP_W = 560;
  const TT = rows.length;                       // logical tiers (depth bands)
  const vrows = [];                             // visual rows: { items, tier }
  rows.forEach((r, ti) => {
    let line = [], w = 0;
    for (const it of r) {
      const cwChip = archChipW(it);
      if (line.length && w + AR.CHIP_GAP + cwChip > WRAP_W) { vrows.push({ items: line, tier: ti }); line = []; w = 0; }
      w += (line.length ? AR.CHIP_GAP : 0) + cwChip;
      line.push(it);
    }
    if (line.length) vrows.push({ items: line, tier: ti });
  });
  const firstOfTier = new Map();                // tier -> visual row index of its first line
  vrows.forEach((v, i) => { if (!firstOfTier.has(v.tier)) firstOfTier.set(v.tier, i); });
  const total = vrows.length;
  const rowW = vrows.map((v) => v.items.reduce((s, it) => s + archChipW(it), 0) + AR.CHIP_GAP * (v.items.length - 1));
  const maxRowW = Math.max(AR.CHIP_MINW * 2 + AR.CHIP_GAP, ...rowW);
  const extH = model.ext ? AR.EXT_GAP + AR.EXT_H : 0;
  const cw = AR.LEFT + maxRowW + AR.RIGHT;
  const ch = AR.TOP + total * AR.CHIP_H + (total - 1) * AR.ROW_GAP + extH + AR.BOTTOM;
  const centerX = AR.LEFT + maxRowW / 2;
  const body = [background(cw, ch, pal), '  <g>', header(centerX, 30, eyebrow, title, pal)];

  // place every node and remember its anchor box (colour = its TIER's accent, not its visual line)
  const pos = {};
  vrows.forEach((v, i) => {
    const y = AR.TOP + i * (AR.CHIP_H + AR.ROW_GAP);
    let x = centerX - rowW[i] / 2;
    for (const it of v.items) {
      const w = archChipW(it);
      pos[it.name] = { x, y, w, cx: x + w / 2, top: y, bot: y + AR.CHIP_H, col: accent(v.tier), it };
      x += w + AR.CHIP_GAP;
    }
  });

  // assign each node's edges to distinct ports (sorted toward their neighbour) before drawing
  const outg = {}, inc = {};
  for (const e of edges) { (outg[e.from] = outg[e.from] || []).push(e); (inc[e.to] = inc[e.to] || []).push(e); }
  for (const k in outg) outg[k].sort((a, b) => (pos[a.to] ? pos[a.to].cx : 0) - (pos[b.to] ? pos[b.to].cx : 0));
  for (const k in inc) inc[k].sort((a, b) => (pos[a.from] ? pos[a.from].cx : 0) - (pos[b.from] ? pos[b.from].cx : 0));

  // REAL dependency edges drawn FIRST (behind the cards) — each module→module link, coloured by
  // source, and REVEALED IN SEQUENCE (staggered delay) so the animation traces "here's what depends
  // on what" one link at a time instead of every edge flickering together.
  edges.forEach((e, ei) => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    const sx = portX(a, outg[e.from], e), tx = portX(b, inc[e.to], e);
    const edgeDelay = (ei % 6) * 0.35;
    body.push(b.top > a.bot
      ? curve(sx, a.bot + 3, tx, b.top - 3, a.col, { glow: false, delay: edgeDelay })
      : curve(sx, a.bot + 3, tx, b.bot + 3, a.col, { w: 1.6, op: 0.55, glow: false, delay: edgeDelay }));
  });

  // left depth axis — a real "deeper = more foundational / more depended-on" gauge, not a bolted-on rail
  const axX = AR.LEFT - 34;
  const firstY = AR.TOP + AR.CHIP_H / 2, lastRowY = AR.TOP + (total - 1) * (AR.CHIP_H + AR.ROW_GAP) + AR.CHIP_H / 2, midY = (firstY + lastRowY) / 2;
  body.push(`  <line x1="${axX}" y1="${firstY}" x2="${axX}" y2="${lastRowY + 16}" stroke="rgba(255,255,255,0.13)" stroke-width="1.5" stroke-dasharray="2 6"/>`);
  body.push(`  <path d="M ${axX - 5} ${lastRowY + 10} L ${axX} ${lastRowY + 18} L ${axX + 5} ${lastRowY + 10} Z" fill="rgba(255,255,255,0.28)"/>`);
  body.push(txt(26, midY, 'DEPENDENCY DEPTH', { size: 10.5, mono: true, weight: 700, fill: pal.muted, ls: 2, anchor: 'middle', dom: 'central', extra: `transform="rotate(-90 26 ${midY.toFixed(1)})"` }));
  for (const [ti, vi] of firstOfTier) {   // one band dot + label per TIER, at its first visual line
    const y = AR.TOP + vi * (AR.CHIP_H + AR.ROW_GAP) + AR.CHIP_H / 2, col = accent(ti);
    body.push(`  <circle cx="${axX}" cy="${y}" r="4.5" fill="${col}" filter="url(#glowS)"/>`);
    body.push(`  <circle cx="${axX}" cy="${y}" r="3" fill="${mix(col, '#ffffff', 0.4)}"/>`);
    body.push(txt(axX - 13, y, bandName(ti, TT), { size: 11.5, mono: true, weight: 700, fill: col, ls: 1.2, anchor: 'end', dom: 'central' }));
  }

  // nodes — the hub gets a crisp ring + faint accent wash (a clear focal point, NOT a blurred fog cloud)
  for (const r of rows) for (const it of r) {
    const p = pos[it.name];
    body.push(glassChip(p.x, p.top, p.w, AR.CHIP_H, p.col, clip(it.label, 26), it.sub ? clip(it.sub, 30) : ''));
    if (it.isHub) {
      // a faint accent wash + a crisp ring mark the core, with a small inline CORE tag (no slapped-on pill)
      body.push(`  <rect x="${p.x}" y="${p.top}" width="${p.w}" height="${AR.CHIP_H}" rx="12" fill="${tint(p.col, 0.07)}"/>`);
      body.push(`  <rect x="${(p.x - 4).toFixed(1)}" y="${(p.top - 4).toFixed(1)}" width="${p.w + 8}" height="${AR.CHIP_H + 8}" rx="16" fill="none" stroke="${p.col}" stroke-width="1.5" opacity="0.7"/>`);
      body.push(`  <rect x="${(p.x + p.w - 52).toFixed(1)}" y="${(p.top - 11).toFixed(1)}" width="52" height="20" rx="6" fill="rgba(11,15,23,0.95)" stroke="${tint(p.col, 0.5)}" stroke-width="1"/>`);
      body.push(`  <path d="M ${(p.x + p.w - 40).toFixed(1)} ${(p.top - 1).toFixed(1)} l 3.5 -3.5 l 3.5 3.5 l -3.5 3.5 Z" fill="${p.col}"/>`);
      body.push(txt(p.x + p.w - 30, p.top - 1, 'CORE', { size: 9.5, mono: true, weight: 800, fill: mix(p.col, '#ffffff', 0.3), ls: 1, dom: 'central' }));
    }
  }

  // external-dependency band — a slim row in the SAME glass language (just dimmer), not a foreign grey slab
  if (model.ext) {
    const ey = AR.TOP + total * AR.CHIP_H + (total - 1) * AR.ROW_GAP + AR.EXT_GAP;
    const eh = 64, ew = clamp(maxRowW, 340, 540), ex = centerX - ew / 2, lc = accent(TT - 1);
    body.push(`  <rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" rx="14" fill="rgba(11,15,23,0.55)" stroke="${tint(lc, 0.28)}" stroke-width="1.25"/>`);
    body.push(`  <rect x="${ex}" y="${ey}" width="4" height="${eh}" rx="2" fill="${tint(lc, 0.6)}"/>`);
    body.push(txt(ex + 22, ey + 25, 'EXTERNAL PACKAGES', { size: 10.5, mono: true, weight: 700, fill: pal.muted, ls: 1.5 }));
    body.push(txt(ex + 22, ey + 47, clip(model.ext.names.join('   ·   '), 52), { size: 13, weight: 500, fill: pal.sub }));
    body.push(txt(ex + ew - 20, ey + 36, `${model.ext.count} deps`, { size: 11.5, mono: true, fill: pal.muted, anchor: 'end', dom: 'central' }));
  }

  // legend (explains the arrows + the CORE mark) above the stats caption. Centre it on the CANVAS
  // (not the content column) and font-fit it to the canvas width, so the fixed ~577px legend string
  // can never spill past the edges on a small repo whose square canvas is narrower than the legend
  // (the chalk overflow bug: content-centred at x≈323 left only 245px on the right → "depende‑[d-on]" cut).
  const legY = ch - AR.BOTTOM + 34;
  const legCx = cw / 2;                     // canvas centre (portrait canvas: canvas == content width)
  const legAvail = cw - 32;                 // usable width: a 16px margin each side
  const fitMono = (s, base) => { const w = measure(s, base, { mono: true }); return w <= legAvail ? base : Math.max(9, +(base * legAvail / w).toFixed(2)); };
  const legend = 'arrow points from a module to what it depends on    ◆ CORE = most depended-on';
  body.push(txt(legCx, legY, legend, { size: fitMono(legend, 12.5), mono: true, fill: pal.sub, anchor: 'middle' }));
  if (caption) { const c = clip(caption, 96); body.push(txt(legCx, legY + 26, c, { size: fitMono(c, 12.5), mono: true, fill: pal.muted, anchor: 'middle' })); }
  body.push('  </g>');
  const desc = `${title}: ${rows.map((r, i) => `${bandName(i, TT)} [${r.map((it) => it.name).join(', ')}]`).join(' → ')}; ${edges.length} real dependency edges, core = ${model.hub || 'n/a'}.`;
  return { W: cw, H: ch, body: body.join('\n'), desc };
}

// ── FLOW: a real data-flow pipeline. Each stage card shows the transformation it performs (verb +
// command) and the data it consumes/produces (IN → OUT); plain arrows carry that data to the next
// stage — NO duplicate wire labels (the OUT chip already names what flows on, so we don't restate it) ─
const FL = { CARD_W: 664, CARD_H: 108, VGAP: 62, TOP: 150, BOTTOM: 92, TOK_H: 40 };

// a label that rides ON a connector wire — names the actual artifact handed from one stage to the next,
// so the pipeline visibly CARRIES data (the OUT of a stage becomes the input the next consumes)
function wireTag(cx, midY, text, col) {
  const w = Math.ceil(measure(text, 11, { mono: true })) + 24, h = 22, x = cx - w / 2;
  return [
    `  <rect x="${x.toFixed(1)}" y="${(midY - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${h / 2}" fill="rgba(8,11,17,0.94)" stroke="${tint(col, 0.5)}" stroke-width="1"/>`,
    txt(cx, midY, text, { size: 11, mono: true, fill: mix(col, '#ffffff', 0.4), anchor: 'middle', dom: 'central' }),
  ].join('\n');
}

// a rounded glass "endpoint" pill for the SOURCE input and the final RESULT
function tokenPill(cx, y, kind, label, col) {
  const kw = Math.ceil(measure(kind, 11, { mono: true })) + 16;
  const w = kw + Math.ceil(measure(label, 12.5, { mono: true })) + 50;
  const x = cx - w / 2;
  return [
    `  <rect x="${x.toFixed(1)}" y="${y}" width="${w}" height="${FL.TOK_H}" rx="${FL.TOK_H / 2}" fill="rgba(255,255,255,0.04)" stroke="${tint(col, 0.5)}" stroke-width="1.25"/>`,
    `  <rect x="${x.toFixed(1)}" y="${y}" width="${w}" height="${FL.TOK_H}" rx="${FL.TOK_H / 2}" fill="url(#sheen)" opacity="0.4"/>`,
    `  <circle cx="${(x + 18).toFixed(1)}" cy="${(y + FL.TOK_H / 2).toFixed(1)}" r="3.4" fill="${col}" filter="url(#glowS)"/>`,
    txt(x + 30, y + FL.TOK_H / 2, kind, { size: 11, mono: true, weight: 800, fill: col, ls: 1.2, dom: 'central' }),
    txt(x + 30 + kw, y + FL.TOK_H / 2, label, { size: 12.5, mono: true, fill: PAL.ink, dom: 'central' }),
  ].join('\n');
}

function flowCard(x, y, col, n, s, delay = null) {
  const w = FL.CARD_W, h = FL.CARD_H;
  const parts = [glassPanel(x, y, w, h, col, { r: 16, fillA: 0.07, depth: 6, aura: 0.16 })];
  // number badge — pulses on a delay so stage N "activates" after stage N-1, telling the real
  // execution-order story instead of a uniform decorative flicker.
  const bx = x + 50, by = y + h / 2;
  const delayAttr = delay != null ? ` style="animation-delay:${delay.toFixed(2)}s"` : '';
  parts.push(`  <circle class="node-pulse"${delayAttr} cx="${bx}" cy="${by}" r="22" fill="${col}" opacity="0.28" filter="url(#glowS)"/>`);
  parts.push(`  <circle cx="${bx}" cy="${by}" r="20" fill="${tint(col, 0.2)}" stroke="${col}" stroke-width="1.75"/>`);
  parts.push(txt(bx, by + 1, String(n), { size: 20, weight: 800, fill: mix(col, '#ffffff', 0.55), anchor: 'middle', dom: 'central' }));
  // stage name + the transformation verb
  const tx = x + 88;
  parts.push(txt(tx, y + 34, s.name, { size: 18, weight: 800, fill: PAL.ink, ls: 0.4 }));
  parts.push(txt(tx, y + 55, clip(s.verb, 40), { size: 12.5, fill: PAL.sub }));
  // the command that does it
  const cy = y + 68, cw = w - (tx - x) - 214;
  parts.push(`  <rect x="${tx}" y="${cy}" width="${cw}" height="28" rx="7" fill="rgba(0,0,0,0.42)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
  parts.push(txt(tx + 12, cy + 19, '$ ' + clip(s.cmd, 36), { size: 12, mono: true, fill: mix(col, '#ffffff', 0.5) }));
  // IN → OUT (the data this stage consumes and produces — the actual transformation)
  const iox = x + w - 196;
  parts.push(`  <line x1="${iox - 18}" y1="${y + 18}" x2="${iox - 18}" y2="${y + h - 18}" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>`);
  parts.push(txt(iox, y + 42, 'IN', { size: 10.5, mono: true, weight: 700, fill: PAL.muted, ls: 1.5, dom: 'central' }));
  parts.push(txt(iox + 34, y + 42, clip(s.in, 22), { size: 12, mono: true, fill: PAL.sub, dom: 'central' }));
  // a downward transform-arrow (IN becomes OUT) — not a sideways chevron that reads like a shell prompt
  const axc = iox + 7;
  parts.push(`  <path d="M ${axc} ${y + 50} V ${y + 60}" stroke="${tint(col, 0.55)}" stroke-width="1.4" stroke-linecap="round"/>`);
  parts.push(`  <path d="M ${axc - 3.5} ${y + 56} L ${axc} ${y + 60.5} L ${axc + 3.5} ${y + 56}" fill="none" stroke="${tint(col, 0.55)}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(txt(iox + 34, y + h - 42, 'OUT', { size: 10.5, mono: true, weight: 700, fill: col, ls: 1.5, dom: 'central', anchor: 'start' }));
  parts.push(txt(iox + 34, y + h - 24, clip(s.out, 22), { size: 12, mono: true, weight: 600, fill: mix(col, '#ffffff', 0.4), dom: 'central' }));
  return parts.join('\n');
}

function renderFlow(eyebrow, title, model, caption, pal) {
  const steps = model.steps, n = steps.length;
  const cw = FL.CARD_W + 108;
  const ch = FL.TOP + FL.TOK_H + (n + 1) * FL.VGAP + n * FL.CARD_H + FL.TOK_H + FL.BOTTOM;
  // PORTRAIT canvas (INV-18, 2026-07-30): the flow is a single vertical spine — padding it out to a
  // square multiplied the width ~1.6x and shrank every label below mobile legibility for no reason.
  const cardX = (cw - FL.CARD_W) / 2, spine = cardX + FL.CARD_W / 2;
  const body = [background(cw, ch, pal), '  <g>', header(spine, 30, eyebrow, title, pal)];

  // Staggered activation delay: stage N's beam-in + badge fire STEP later than stage N-1's, so the
  // loop reads as one token/request traveling the pipeline in real execution order, not everything
  // flickering at once. STEP tuned to the beam (1.1s) + pulse (2.1s) durations so the wave is legible.
  const STEP = 0.55;
  let y = FL.TOP;
  body.push(tokenPill(spine, y, 'SOURCE', model.source, accent(0)));
  y += FL.TOK_H;
  for (let i = 0; i < n; i++) {
    const wcol = mix(accent(Math.max(0, i - 1)), accent(i), 0.5);
    body.push(beam(spine, y + 4, spine, y + FL.VGAP - 4, wcol, i * STEP));
    // the wire carries the artifact the previous stage produced (its OUT) into this one — data, moving
    if (i >= 1) body.push(wireTag(spine, y + FL.VGAP / 2, clip(steps[i - 1].out, 22), wcol));
    y += FL.VGAP;
    body.push(flowCard(cardX, y, accent(i), i + 1, steps[i], i * STEP + STEP * 0.4));
    y += FL.CARD_H;
  }
  body.push(beam(spine, y + 4, spine, y + FL.VGAP - 4, accent(n - 1), n * STEP));
  body.push(wireTag(spine, y + FL.VGAP / 2, clip(steps[n - 1].out, 22), accent(n - 1)));
  y += FL.VGAP;
  body.push(tokenPill(spine, y, 'RESULT', model.result, accent(n - 1)));

  if (caption) body.push(txt(spine, ch - FL.BOTTOM + 46, clip(caption, 88), { size: 12, mono: true, fill: pal.muted, anchor: 'middle' }));
  body.push('  </g>');
  const desc = `${title}: ${model.source} ⟶ ${steps.map((s) => `${s.name} (${s.in} → ${s.out})`).join(' ⟶ ')} ⟶ ${model.result}.`;
  return { W: cw, H: ch, body: body.join('\n'), desc };
}

// ── CONCEPT ARCHETYPES (big-idea / insight / demoted architecture / demoted flow) ──────────────────
// ONE rows-model, FOUR distinct visual forms, so no two concept-rendered diagrams share a SHAPE
// (INV-23: rails on truth, never on form). renderConcept dispatches on `variant`, assigned per diagram
// KEY in the DIAGRAMS table: column (bigIdea) · ribbon (flow) · orbit (insight) · strata (architecture).
// WHY (2026-07-18): before this, every concept slot drew the SAME centered vertical card-column. On a
// repo where 2-3 slots demote to concept (bissanmu/spring3-legacy-web: flow+big-idea+insight all did),
// that repetition read as one form three times and tanked the imagery-craft grade (B5 58/60 < floor 70),
// so deploy.mjs's ship-bar rail refused to publish. The house style (glassmorphic dark) stays shared on
// purpose; only the LAYOUT diverges — which is the axis the grader was penalising.
const C = { CARD_H: 78, VGAP: 50, GAP_PLAIN: 30, TOP: 132, BOTTOM: 72, PADX: 30, MINW: 280, MAXW: 580 };

function cwidth(label) { return Math.min(C.MAXW, Math.max(C.MINW, Math.ceil(measure(clip(label, 54), 18.5, { bold: true })) + C.PADX * 2)); }

// word-wrap a string to at most `maxChars` per line (used to keep a caption inside the canvas width)
function wrapText(text, maxChars) {
  const cap = Math.max(8, maxChars);
  const words = String(text).trim().split(/\s+/).filter(Boolean);
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

// flatten a rows-model into ordered steps, marking which connect to the next with an arrow
function conceptSteps(rows, title) {
  rows = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!rows.length) rows = [{ items: [{ label: title }] }];
  const steps = [];
  rows.forEach((r) => r.items.forEach((it, i) => steps.push({
    label: it.label, colorIdx: it.colorIdx, arrow: !!(r.connectWithin && i < r.items.length - 1),
  })));
  return { rows, steps };
}

// caption: WRAP to the real canvas width (mono) so it can never spill past the edges; returns the
// caption SVG plus the bottom-band height to add under the diagram content (min = minPad).
function captionBlock(cx, contentH, availW, caption, pal, minPad) {
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

// wrap a label to fit inside a card of inner width `innerW` at font `fs`, capped at `maxLines` (… on overflow)
function fitLines(label, innerW, fs, maxLines) {
  const perLine = Math.max(6, Math.floor(innerW / (fs * 0.55)));
  let lines = wrapText(clip(label, perLine * maxLines), perLine);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = clip(lines[maxLines - 1] + ' …', perLine); }
  return lines;
}

// VARIANT 1 — column: the original centered VERTICAL chain of glass cards joined by glowing down-arrows.
function conceptColumn(eyebrow, title, steps, caption, pal) {
  const n = steps.length;
  const maxW = Math.max(C.MINW, ...steps.map((s) => cwidth(s.label)));
  const gaps = steps.slice(0, -1).reduce((t, s) => t + (s.arrow ? C.VGAP : C.GAP_PLAIN), 0);
  const cw = maxW + 140;
  const contentH = C.TOP + n * C.CARD_H + gaps;       // canvas through the bottom of the last card
  // PORTRAIT canvas — width = the card column (or the title, whichever is wider), NOT a forced square,
  // so the cards stay flush to the frame on a phone instead of floating in dead side-margins.
  const titleMinW = Math.ceil(measure(title, 30, { bold: true })) + 120;
  const W = Math.max(cw, titleMinW);
  const mid = cw / 2, ox = (W - cw) / 2;
  const cb = captionBlock(mid, contentH, W, caption, pal, C.BOTTOM);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: column -->', background(W, H, pal),
    `  <g transform="translate(${ox.toFixed(1)},0)">`, header(mid, 30, eyebrow, title, pal)];
  let y = C.TOP;
  const geo = steps.map((s, i) => { const g = { ...s, y, col: accent(s.colorIdx != null ? s.colorIdx : i) }; y += C.CARD_H + (s.arrow ? C.VGAP : C.GAP_PLAIN); return g; });
  for (let i = 0; i < geo.length - 1; i++) if (geo[i].arrow) body.push(beam(mid, geo[i].y + C.CARD_H + 6, mid, geo[i + 1].y - 6, mix(geo[i].col, geo[i + 1].col, 0.5)));
  for (const g of geo) {
    const w = cwidth(g.label), x = mid - w / 2;
    body.push(glassPanel(x, g.y, w, C.CARD_H, g.col, { r: 18, fillA: 0.18, depth: 8, aura: 0.5 }));
    body.push(txt(mid, g.y + C.CARD_H / 2, clip(g.label, 54), { size: 18.5, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' }));
  }
  body.push(cb.svg, '  </g>');
  return { W, H, body: body.join('\n') };
}

// VARIANT 2 — ribbon: a horizontal LEFT→RIGHT sequence, cards joined by glowing right-arrows. Reads as
// a pipeline — a landscape shape distinct from the vertical column — so a demoted data-flow never mirrors
// big-idea. Labels wrap to fit inside each card.
const RB = { CARD_H: 118, HGAP: 60, TOP: 156, PADX: 64, MINW: 158, MAXW: 300 };
function ribW(label) { return clamp(Math.ceil(measure(clip(label, 34), 15.5, { bold: true })) + 46, RB.MINW, RB.MAXW); }
function conceptRibbon(eyebrow, title, steps, caption, pal) {
  const n = steps.length;
  const ws = steps.map((s) => ribW(s.label));
  const rowW = ws.reduce((a, b) => a + b, 0) + RB.HGAP * (n - 1);
  const titleMinW = Math.ceil(measure(title, 30, { bold: true })) + 120;
  const W = Math.max(rowW + RB.PADX * 2, titleMinW);
  const cardY = RB.TOP, contentH = cardY + RB.CARD_H;
  const cb = captionBlock(W / 2, contentH, W, caption, pal, 84);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: ribbon -->', background(W, H, pal), header(W / 2, 30, eyebrow, title, pal)];
  let x = (W - rowW) / 2;
  const geo = steps.map((s, i) => { const g = { ...s, x, w: ws[i], col: accent(s.colorIdx != null ? s.colorIdx : i) }; x += ws[i] + RB.HGAP; return g; });
  for (let i = 0; i < n - 1; i++) if (geo[i].arrow) body.push(beam(geo[i].x + geo[i].w + 6, cardY + RB.CARD_H / 2, geo[i + 1].x - 6, cardY + RB.CARD_H / 2, mix(geo[i].col, geo[i + 1].col, 0.5)));
  for (const g of geo) {
    body.push(glassPanel(g.x, cardY, g.w, RB.CARD_H, g.col, { r: 16, fillA: 0.16, depth: 8, aura: 0.4 }));
    const lines = fitLines(g.label, g.w - 30, 15, 3);
    const startY = cardY + RB.CARD_H / 2 - (lines.length - 1) * 11;
    lines.forEach((ln, k) => body.push(txt(g.x + g.w / 2, startY + k * 22, ln, { size: 15, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  }
  body.push(cb.svg);
  return { W, H, body: body.join('\n') };
}

// VARIANT 3 — orbit: a central KEYSTONE card with the remaining ideas as satellites on a ring, each
// joined to the hub by a glowing beam. For "the insight" — the one clever move and what radiates from it.
const OB = { HUBW: 300, HUBH: 98, SATW: 220, SATH: 82, TOP: 128, R: 250, PAD: 56 };
function conceptOrbit(eyebrow, title, steps, caption, pal) {
  const hub = steps[0], sats = steps.slice(1), m = sats.length;
  // Satellites FAN DOWNWARD from the hub (angle 0 = straight down, spreading left/right). This is the
  // fix for the 2-satellite case: a top+bottom placement read as a vertical line (mimicking the column
  // archetype). A downward fan always reads as hub-and-spoke, distinct from every other variant.
  const spread = m <= 1 ? 0 : Math.min(2.5, 0.6 + 0.5 * m);   // total fan angle in radians
  const angOf = (i) => (m <= 1 ? 0 : (i / (m - 1) - 0.5) * spread);
  const maxOff = m ? Math.sin(spread / 2) * OB.R : 0;
  const W = Math.round(Math.max(2 * (maxOff + OB.SATW / 2) + OB.PAD * 2, Math.ceil(measure(title, 30, { bold: true })) + 160));
  const cx = W / 2, cyHub = OB.TOP + OB.HUBH / 2;
  const hubCol = accent(hub.colorIdx != null ? hub.colorIdx : 0);
  const geo = sats.map((s, i) => {
    const a = angOf(i);
    return { ...s, sx: cx + Math.sin(a) * OB.R, sy: cyHub + Math.cos(a) * OB.R, col: accent(s.colorIdx != null ? s.colorIdx : i + 1) };
  });
  const lowest = geo.length ? Math.max(...geo.map((g) => g.sy)) : cyHub;
  const contentH = (geo.length ? lowest + OB.SATH / 2 : cyHub + OB.HUBH / 2) + 20;
  const cb = captionBlock(cx, contentH, W, caption, pal, 84);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: orbit -->', background(W, H, pal), header(cx, 30, eyebrow, title, pal)];
  // beams hub → satellite (behind every card), leaving the hub's bottom edge and stopping short of the card
  for (const g of geo) {
    const dx = g.sx - cx, dy = g.sy - cyHub, d = Math.hypot(dx, dy) || 1, k = (d - OB.SATH / 2 - 4) / d;
    body.push(beam(cx, cyHub + OB.HUBH / 2 - 8, cx + dx * k, cyHub + dy * k, mix(hubCol, g.col, 0.5)));
  }
  for (const g of geo) {
    const x = g.sx - OB.SATW / 2, y = g.sy - OB.SATH / 2;
    body.push(glassPanel(x, y, OB.SATW, OB.SATH, g.col, { r: 15, fillA: 0.15, depth: 6, aura: 0.4 }));
    const lines = fitLines(g.label, OB.SATW - 26, 13.5, 3);
    const sy0 = g.sy - (lines.length - 1) * 10;
    lines.forEach((ln, k) => body.push(txt(g.sx, sy0 + k * 20, ln, { size: 13.5, weight: 600, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  }
  // the hub last, so it sits above every beam
  const hx = cx - OB.HUBW / 2, hy = cyHub - OB.HUBH / 2;
  body.push(glassPanel(hx, hy, OB.HUBW, OB.HUBH, hubCol, { r: 20, fillA: 0.22, depth: 9, aura: 0.62 }));
  const hubLines = fitLines(hub.label, OB.HUBW - 34, 17, 2);
  const hy0 = cyHub - (hubLines.length - 1) * 12;
  hubLines.forEach((ln, k) => body.push(txt(cx, hy0 + k * 24, ln, { size: 17, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  body.push(cb.svg);
  return { W, H, body: body.join('\n') };
}

// VARIANT 4 — strata: concentric NESTED frames, outermost idea to innermost, each labelled at its top
// band, with a pulsing marker so it stays "alive". Reads as "layers, one built inside another" — for a
// demoted architecture (how it is built) when the dep-graph is too trivial to draw as a real map.
const ST = { TOP: 150, SIZE: 640, SIDEPAD: 92 };
function conceptStrata(eyebrow, title, steps, caption, pal) {
  const items = steps.slice(0, 6);
  const n = items.length;
  // inset tuned so the INNERMOST frame stays wide enough to read a 2-line label (the old 1-line clip
  // truncated inner labels to "Your page -…"). Keep the innermost side ≈ 200px minimum.
  const inset = n > 1 ? Math.min(52, (ST.SIZE / 2 - 102) / (n - 1)) : 0;
  const W = ST.SIZE + ST.SIDEPAD * 2, cx = W / 2;
  const contentH = ST.TOP + ST.SIZE + 20;
  const cb = captionBlock(cx, contentH, W, caption, pal, 84);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: strata -->', background(W, H, pal), header(cx, 30, eyebrow, title, pal)];
  items.forEach((s, i) => {
    const side = ST.SIZE - 2 * inset * i;
    const x = cx - side / 2, y = ST.TOP + inset * i;
    const col = accent(s.colorIdx != null ? s.colorIdx : i);
    const r = Math.max(14, 26 - i * 2);
    if (i === 0) body.push(`  <rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="${side + 10}" height="${side + 10}" rx="${r + 4}" fill="${col}" opacity="0.16" filter="url(#glow)"/>`);
    body.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${side}" height="${side}" rx="${r}" fill="${tint(col, 0.09)}" stroke="${tint(col, 0.5)}" stroke-width="1.5"/>`);
    body.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${side}" height="${side}" rx="${r}" fill="url(#sheen)" opacity="0.3"/>`);
    // label rides the top band of each frame, wrapped to at most 2 lines so inner frames stay legible
    const lines = fitLines(s.label, side - 64, 13, 2);
    const startY = y + 20, dotx = cx - side / 2 + 22;
    body.push(`  <circle class="node-pulse" cx="${dotx.toFixed(1)}" cy="${startY.toFixed(1)}" r="4.5" fill="${col}" opacity="0.4" filter="url(#glowS)"/>`);
    body.push(`  <circle cx="${dotx.toFixed(1)}" cy="${startY.toFixed(1)}" r="3" fill="${mix(col, '#ffffff', 0.4)}"/>`);
    lines.forEach((ln, k) => body.push(txt(cx, startY + k * 17, ln, { size: 13, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  });
  body.push(cb.svg);
  return { W, H, body: body.join('\n') };
}

// dispatcher — same rows-model, distinct SHAPE per `variant` (default 'column' keeps old behaviour).
function renderConcept(eyebrow, title, rows, caption, pal, variant = 'column') {
  const { rows: rws, steps } = conceptSteps(rows, title);
  const desc = `${title}: ${rws.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' → ' : ', ')).join(' / ')}`;
  const fn = variant === 'ribbon' ? conceptRibbon
    : variant === 'orbit' ? conceptOrbit
      : variant === 'strata' ? conceptStrata
        : conceptColumn;
  const r = fn(eyebrow, title, steps, caption, pal);
  return { W: r.W, H: r.H, body: r.body, desc };
}

// (REMOVED) renderAsciiMono/wrapMono — these typeset the brain's ASCII VERBATIM as a picture of ASCII,
// which is slop. big-idea & insight are now DRAWN as real glass concept-cards via renderConcept (above)
// from a structured rows model (brain emits visuals.<key>.rows). Legacy .ascii is parsed by asciiRows()
// into that same structured model — so even old builds render as real cards, never as typeset ASCII.

function assertXmllintClean(svgPath, key) {
  try { execFileSync('xmllint', ['--noout', svgPath], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) {
    if (e && e.code === 'ENOENT') die(`xmllint not found on PATH — cannot validate the ${key} SVG; refusing to ship an unverified diagram`);
    const detail = e && e.stderr ? e.stderr.toString().trim() : (e ? e.message : 'unknown error');
    die(`SVG validation failed for ${key} (${svgPath}): ${detail}`);
  }
}

function symbolCountFor(node, sym) {
  if (!sym || !sym.byCrate || !node) return null;
  const bc = sym.byCrate, cands = [node.name];
  if (node.manifest) { const dir = String(node.manifest).replace(/\\/g, '/').replace(/\/[^/]+$/, ''); if (dir) cands.push(dir); }
  for (const c of cands) if (c && Object.prototype.hasOwnProperty.call(bc, c) && typeof bc[c] === 'number') return bc[c];
  return null;
}

// ── ARCHITECTURE model from the REAL dep-graph: topological layers + the actual module→module edges ─
// Assign each module a depth = longest path from a source, so EVERY internal edge points downward and
// the wiring (who depends on whom, what's a hub, what's a shared leaf) is visible — not invented.
function longestPathLayers(names, edges) {
  const succ = {}, indeg = {}, layer = {};
  names.forEach((n) => { succ[n] = []; indeg[n] = 0; layer[n] = 0; });
  for (const e of edges) { if (succ[e.from] && layer[e.to] != null) { succ[e.from].push(e.to); indeg[e.to]++; } }
  const ind = { ...indeg };
  const q = names.filter((n) => ind[n] === 0);
  let seen = 0;
  while (q.length) { const n = q.shift(); seen++; for (const m of succ[n]) { if (layer[m] < layer[n] + 1) layer[m] = layer[n] + 1; if (--ind[m] === 0) q.push(m); } }
  if (seen < names.length) { for (let it = 0; it < names.length; it++) for (const e of edges) if (layer[e.to] < layer[e.from] + 1) layer[e.to] = layer[e.from] + 1; }
  return layer;
}

// crossing-reduction: order each row by the average position of its neighbours in the adjacent row
function orderRows(rows, edges) {
  const pos = {}; rows.forEach((r) => r.forEach((n, i) => { pos[n.name] = i; }));
  const pred = {}, succ = {};
  for (const e of edges) { (pred[e.to] = pred[e.to] || []).push(e.from); (succ[e.from] = succ[e.from] || []).push(e.to); }
  const bary = (n, map) => { const ps = map[n.name]; if (!ps || !ps.length) return pos[n.name]; return ps.reduce((s, p) => s + (pos[p] ?? 0), 0) / ps.length; };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < rows.length; i++) { rows[i].sort((a, b) => bary(a, pred) - bary(b, pred)); rows[i].forEach((n, k) => { pos[n.name] = k; }); }
    for (let i = rows.length - 2; i >= 0; i--) { rows[i].sort((a, b) => bary(a, succ) - bary(b, succ)); rows[i].forEach((n, k) => { pos[n.name] = k; }); }
  }
}

function buildArchModel(dg, sym) {
  const all = (Array.isArray(dg.nodes) ? dg.nodes : []).filter((n) => n && n.name);
  const nameSet = new Set(all.map((n) => n.name));
  const seenE = new Set();
  let edges = (Array.isArray(dg.internalEdges) ? dg.internalEdges : [])
    .filter((e) => e && e.from && e.to && e.from !== e.to && nameSet.has(e.from) && nameSet.has(e.to))
    .filter((e) => { const k = e.from + '\x00' + e.to; if (seenE.has(k)) return false; seenE.add(k); return true; });

  // full-graph degree → keep the most-connected modules when there are too many to draw legibly
  const fIn = {}, fOut = {};
  for (const e of edges) { fIn[e.to] = (fIn[e.to] || 0) + 1; fOut[e.from] = (fOut[e.from] || 0) + 1; }
  const fdeg = (n) => (fIn[n.name] || 0) + (fOut[n.name] || 0);
  const CAP = Number(process.env.ARCH_MAX_NODES) || 12;  // dense monorepos: fewer nodes = legible labels on mobile (INV-18). Default unchanged.
  let nodes = all, trimmed = 0;
  if (all.length > CAP) {
    nodes = [...all].sort((a, b) => fdeg(b) - fdeg(a) || (fIn[b.name] || 0) - (fIn[a.name] || 0)).slice(0, CAP);
    const keep = new Set(nodes.map((n) => n.name));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    trimmed = all.length - nodes.length;
  }

  // degrees on the shown subgraph drive layering, labels and hub detection
  const inDeg = {}, outDeg = {};
  nodes.forEach((n) => { inDeg[n.name] = 0; outDeg[n.name] = 0; });
  for (const e of edges) { inDeg[e.to]++; outDeg[e.from]++; }
  const plur = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const symAnn = (n) => { const k = symbolCountFor(n, sym); return k != null ? `${k} sym` : ''; };

  let rows;
  if (!edges.length) {
    // standalone: no internal edges — lay the modules out as a wrapped grid of independent components
    const per = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length))));
    rows = [];
    for (let i = 0; i < nodes.length; i += per) rows.push(nodes.slice(i, i + per));
  } else {
    const layer = longestPathLayers(nodes.map((n) => n.name), edges);
    const maxL = Math.max(0, ...nodes.map((n) => layer[n.name]));
    rows = [];
    for (let l = 0; l <= maxL; l++) rows.push([]);
    nodes.forEach((n) => rows[layer[n.name]].push(n));
    rows = rows.filter((r) => r.length);
    orderRows(rows, edges);
  }

  // the hub = the module the most others depend on (ties → highest total degree)
  let hub = null, hubScore = -1;
  for (const n of nodes) { const sc = (inDeg[n.name] || 0) * 2 + (outDeg[n.name] || 0); if ((inDeg[n.name] || 0) > 0 && sc > hubScore) { hubScore = sc; hub = n.name; } }

  // attach display metadata to each node
  for (const r of rows) for (const it of r) {
    const id = it.name, di = inDeg[id] || 0, dout = outDeg[id] || 0;
    it.isHub = id === hub;
    it.isEntry = di === 0 && dout > 0;
    it.isLeaf = dout === 0 && di > 0;
    const sub = it.isEntry
      ? ['entry', dout ? `uses ${dout}` : '', symAnn(it)].filter(Boolean).join(' · ')
      : [it.isLeaf ? 'shared' : null, plur(di, 'dependent'), symAnn(it)].filter(Boolean).join(' · ');
    // display name drops a shared @scope/ prefix (keeps the distinguishing part legible); name stays canonical
    it.label = id.replace(/^@[^/]+\//, ''); it.sub = sub || symAnn(it) || '';
  }

  const extNames = Array.isArray(dg.externalDepNames) ? dg.externalDepNames.slice(0, 5) : [];
  const ext = extNames.length ? { names: extNames, count: dg.externalDepCount ?? extNames.length } : null;
  return { rows, edges, ext, hub, trimmed };
}

// ── PROCESS / DATA-FLOW model from the entrypoints: each stage carries the artifact it consumes and
// produces (derived from the detected ecosystem), so the diagram shows DATA MOVING, not a command list ─
function ecoOf(dg) {
  const e = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).map((s) => String(s).toLowerCase());
  if (e.includes('node') || e.includes('npm')) return 'node';
  if (e.includes('rust') || e.includes('cargo')) return 'rust';
  if (e.includes('python') || e.includes('pip')) return 'python';
  return 'generic';
}

function artifactModel(eco) {
  const M = {
    node: {
      source: 'package.json + src/', sourceLabel: 'repo source',
      install: { verb: 'resolve + download dependencies', in: 'package.json + lock', out: 'node_modules/' },
      build: { verb: 'compile + bundle the source', in: 'src/ + node_modules/', out: 'dist/ bundle' },
      run: { verb: 'execute the entry point', in: 'dist/ + CLI args', out: 'program output' },
      verify: { verb: 'run the test suite', in: 'dist/ + test specs', out: 'pass / fail report' },
    },
    rust: {
      source: 'Cargo.toml + src/', sourceLabel: 'repo source',
      install: { verb: 'resolve the crate graph', in: 'Cargo.toml + lock', out: 'cargo cache' },
      build: { verb: 'compile the workspace', in: 'src/ + crates', out: 'target/release/' },
      run: { verb: 'execute the binary', in: 'target/ + args', out: 'program output' },
      verify: { verb: 'run cargo test', in: 'crates + tests', out: 'pass / fail report' },
    },
    python: {
      source: 'pyproject + pkg/', sourceLabel: 'repo source',
      install: { verb: 'install dependencies', in: 'pyproject + lock', out: 'site-packages/' },
      build: { verb: 'build the package', in: 'pkg/ source', out: 'wheel / dist' },
      run: { verb: 'run the entry point', in: 'pkg + CLI args', out: 'program output' },
      verify: { verb: 'run the test suite', in: 'pkg + tests', out: 'pass / fail report' },
    },
    generic: {
      source: 'source tree', sourceLabel: 'repo source',
      install: { verb: 'install dependencies', in: 'manifest', out: 'dependencies' },
      build: { verb: 'build the artifacts', in: 'source', out: 'build output' },
      run: { verb: 'run the program', in: 'build + args', out: 'program output' },
      verify: { verb: 'run the tests', in: 'tests', out: 'pass / fail' },
    },
  };
  return M[eco] || M.generic;
}

function buildFlowModel(ep, dg) {
  const A = artifactModel(ecoOf(dg));
  const pick = (cat) => { const c = (Array.isArray(ep.commands) ? ep.commands : []).find((x) => x && x.category === cat); return c ? c.cmd : null; };
  const binNames = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean);
  const installCmd = (Array.isArray(ep.install) && ep.install[0]) || pick('install');
  const buildCmd = pick('build');
  const runCmd = (binNames[0] && `${binNames[0]} ...`) || pick('run') || (Array.isArray(ep.quickstart) && ep.quickstart[0]) || null;
  const testCmd = pick('test');
  const steps = [];
  if (installCmd) steps.push({ name: 'INSTALL', ...A.install, cmd: installCmd });
  if (buildCmd) steps.push({ name: 'BUILD', ...A.build, cmd: buildCmd });
  if (runCmd) steps.push({ name: 'RUN', ...A.run, cmd: runCmd });
  if (testCmd) steps.push({ name: 'VERIFY', ...A.verify, cmd: testCmd });
  if (!steps.length && Array.isArray(ep.quickstart) && ep.quickstart[0]) steps.push({ name: 'RUN', ...A.run, cmd: ep.quickstart[0] });
  if (steps.length < 2) steps.push({ name: 'RESULT', verb: 'produces the entry artifact', in: steps[0] ? steps[0].out : 'build', out: binNames.length ? `bin: ${binNames.slice(0, 2).join(', ')}` : 'output', cmd: binNames[0] || 'run' });
  const result = binNames.length ? `${binNames.slice(0, 2).join(', ')} ready` : steps[steps.length - 1].out;
  return { steps, source: A.source, sourceLabel: A.sourceLabel, result };
}

// ── BIG-IDEA / INSIGHT: parse brain ASCII into colour-cycled chip rows + arrows ───────────────────
function asciiRows(ascii) {
  const lines = String(ascii).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { title: 'Diagram', rows: [] };
  const title = lines[0];
  const body = lines.slice(1).length ? lines.slice(1) : lines;
  const rows = body.map((line) => {
    const parts = line.split(/\s*(?:->|→|=>|\|>)\s*/).map((p) => p.replace(/^[[(<{]+|[\])>}]+$/g, '').trim()).filter(Boolean);
    if (parts.length > 1) return { items: parts.map((p, i) => ({ label: p, colorIdx: i })), connectWithin: true };
    return { items: [{ label: line.replace(/^[[(<{]+|[\])>}]+$/g, '').trim() || line }] };
  });
  return { title, rows };
}

// ── FORM FAMILIES (INV-23, ADR-0012) ─────────────────────────────────────────────────────────────
// The COARSE layout shape a vision grader actually compares. It does not see "dependency graph" vs
// "runtime sequence"; it sees "a vertical column of rounded boxes joined by downward arrows" — twice —
// and caps B5 at 60 (quality-grade.mjs:158), which is BELOW the 70 ship floor, so the page becomes
// unshippable no matter how good the other nine axes are.
//
// WHY THIS EXISTS (2026-08-06, PolymathWizard/BHIL-Colophon-Spec, runs 30857458852 + 30865218481):
// the previous design assigned one distinct `conceptVariant` per KEY and reasoned that "pairwise
// distinctness holds either way". It does not. That reasoning covered only the four CONCEPT variants
// among themselves and never considered `renderArchitecture` and `renderFlow` — separate functions,
// outside the variant table, BOTH of which emit a vertical card-stack since the 2026-07-30 portrait
// (INV-18 mobile) fix. Any repo with a real dep-graph and a real flow got two vertical stacks and a
// guaranteed refusal. Verified by rendering both SVGs from the failed build and looking at them.
//
// The cure is not a better static table — a static table cannot know which slots demote at runtime.
// It is a RESOLVER: every slot declares the family it WOULD emit, collisions are resolved by priority
// against an ordered preference list, and the emitted set is ASSERTED pairwise-distinct before a
// single byte of SVG is written. This is a property code can decide for free; paying a stochastic
// vision call to discover it — and paying a whole rebuild to react — was the actual defect.
const FORM = {
  VSTACK: 'vertical-stack',   // renderArchitecture · renderFlow · conceptColumn
  HRUN: 'horizontal-run',     // conceptRibbon   — a pipeline reads L→R
  RADIAL: 'radial',           // conceptOrbit    — hub + satellites
  CONTAINMENT: 'containment', // conceptStrata   — nested frames
};
const VARIANT_FAMILY = { column: FORM.VSTACK, ribbon: FORM.HRUN, orbit: FORM.RADIAL, strata: FORM.CONTAINMENT };

// conceptPrefs = ordered preference list of archetypes for this slot when it renders (or demotes) to
// renderConcept. The resolver walks it and takes the first family not already claimed, so a slot always
// lands on a SEMANTICALLY sensible shape rather than whatever is left over.
const DIAGRAMS = [
  // Architecture is grounded-pinned: INV-18 mandates a real dependency map, and the portrait stack is
  // the mobile-correct geometry. It claims VSTACK first and never yields it.
  // NOTE the trailing 'column' on every list. VSTACK is only occupied when a GROUNDED renderer claims
  // it, so when nothing is grounded (a 0-edge graph with authored rows everywhere) it is free — and a
  // list that never offers it starves the fourth slot. Caught by the all-demoted case in
  // tests/diagram-form-diversity.test.mjs before this ever reached a build.
  { key: 'architectureDiagram', file: 'architecture.svg', title: 'Architecture', grounded: 'architecture',
    conceptEyebrow: 'ARCHITECTURE', conceptHeading: 'How it is built', conceptPrefs: ['strata', 'orbit', 'ribbon', 'column'] },
  // A pipeline IS a left→right run, so 'ribbon' is the semantically right demotion for flow — not the
  // 'column' it used to take, which is the exact family grounded-architecture already occupies.
  { key: 'flowDiagram', file: 'flow.svg', title: 'Process / Data Flow', grounded: 'flow',
    conceptEyebrow: 'DATA FLOW', conceptHeading: 'What happens to your data', conceptPrefs: ['ribbon', 'column', 'strata', 'orbit'] },
  // "How it all fits together" is a CONTAINMENT idea (zones inside one thing) — strata first. This also
  // matches what the 2026-08-04 build actually drew and what graded well: a nested-frames big idea.
  { key: 'bigIdeaDiagram', file: 'big-idea.svg', title: 'Big Idea', grounded: null,
    conceptEyebrow: 'THE BIG IDEA', conceptHeading: 'How it all fits together', conceptPrefs: ['strata', 'ribbon', 'column', 'orbit'] },
  { key: 'insightDiagram', file: 'insight.svg', title: 'The Insight', grounded: null,
    conceptEyebrow: 'THE INSIGHT', conceptHeading: 'The clever move', conceptPrefs: ['orbit', 'ribbon', 'strata', 'column'] },
];

// A grounded flow that must yield VSTACK keeps its REAL model — the same source, stage names and result
// derived from the repo's actual entrypoints — re-expressed as a concept chain. Grounding is preserved;
// only the SHAPE changes. One connected chain is ONE row of N items (see the note in main()).
function flowRowsFromModel(model) {
  if (!model || !Array.isArray(model.steps) || !model.steps.length) return null;
  const labels = [model.source, ...model.steps.map((s) => s && s.name), model.result]
    .map((l) => (l == null ? '' : String(l).trim())).filter(Boolean);
  if (labels.length < 2) return null;
  return [{ items: labels.map((label, i) => ({ label, colorIdx: i })), connectWithin: true }];
}

// THE RESOLVER. Input: the slots that will actually render, each declaring whether it renders grounded.
// Output: a per-key decision { family, variant, demotedForForm } with a PAIRWISE-DISTINCT family set.
// Deterministic and total: same inputs always produce the same assignment, and it never returns a
// colliding set — it throws instead, so a form collision can never again reach the vision grader.
// MEASURED, 2026-08-06 (adversarial review finding, then verified by rendering): conceptRibbon lays
// its cards out in ONE horizontal row, so its canvas width grows with item count — 3 items = 731px,
// 4 = 949px, 5 = 1167px, 6 = 1385px. Every other archetype stays portrait regardless of length
// (orbit 806px, strata 824px for the same 6-item chain). Diagrams fit to width on a 390px phone, so a
// 1385px ribbon renders its 13px labels at ~3.7px — against the 568px grounded architecture diagram
// that graded as legible, that is 2.4x the width and ~40% the text size. The 2026-07-30 portrait work
// exists precisely to stop that. So: a ribbon is only offered for a SHORT chain.
const RIBBON_MAX_ITEMS = 3;
function ribbonIsSafe(slot) {
  return !Number.isInteger(slot.chainLength) || slot.chainLength <= RIBBON_MAX_ITEMS;
}

function resolveForms(slots) {
  const taken = new Map();   // family -> key that claimed it
  const out = {};
  // Pass 1 — grounded slots claim VSTACK in DIAGRAMS order (architecture first, so it wins the pin).
  for (const s of slots) {
    if (!s.grounded) continue;
    if (!taken.has(FORM.VSTACK)) { taken.set(FORM.VSTACK, s.key); out[s.key] = { family: FORM.VSTACK, variant: null, demotedForForm: false }; }
  }
  // Pass 2 — everything else (including a grounded slot that lost the VSTACK race) takes the first
  // free family from its own preference list.
  for (const s of slots) {
    if (out[s.key]) continue;
    const prefs = (s.conceptPrefs || []).filter((v) => v !== 'ribbon' || ribbonIsSafe(s));
    // If filtering left nothing, fall back to the unfiltered list: an illegible diagram is bad, but
    // refusing to draw one at all is worse, and INV-18 requires the mandatory diagrams to exist.
    const pick = prefs.find((v) => !taken.has(VARIANT_FAMILY[v]))
      || (s.conceptPrefs || []).find((v) => !taken.has(VARIANT_FAMILY[v]));
    if (!pick) die(`${s.key}: no distinct diagram form remains (claimed: ${[...taken.keys()].join(', ')}). `
      + `Every archetype is already used by another diagram — refusing to draw two diagrams of the same shape (INV-23).`);
    taken.set(VARIANT_FAMILY[pick], s.key);
    out[s.key] = { family: VARIANT_FAMILY[pick], variant: pick, demotedForForm: Boolean(s.grounded) };
  }
  // THE ASSERTION — the whole point. Pairwise distinctness is proven here, not hoped for downstream.
  const fams = Object.values(out).map((d) => d.family);
  if (new Set(fams).size !== fams.length) {
    die(`INV-23 form resolver produced a colliding set (${fams.join(', ')}) — this is a bug in resolveForms, not in the repo being explained.`);
  }
  return out;
}

function defaultAltText(spec, dg, ep, name, fallbackDesc, archModel, asConcept) {
  // a demoted grounded diagram is a concept drawing now — never describe it as a dependency map / pipeline
  if (asConcept) return fallbackDesc || `${spec.title} diagram for ${name}`;
  if (spec.grounded === 'architecture') {
    const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join('/') || 'one ecosystem';
    const hub = archModel && archModel.hub ? `, with ${archModel.hub} as the core module the most others depend on` : '';
    return `${name} module dependency map: ${dg.componentCount ?? (Array.isArray(dg.nodes) ? dg.nodes.length : 0)} components across ${ecos} wired by ${dg.internalEdgeCount ?? 0} internal dependencies, drawn as a layered graph where each arrow points from a module to what it depends on (top entry points down to shared foundation libraries)${hub}.`;
  }
  if (spec.grounded === 'flow') {
    const bins = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean).slice(0, 3).join(', ');
    return `${name} build & run lifecycle: the repo source flows through install (→ dependencies), build (→ compiled artifacts), run the entry point${bins ? ` (${bins})` : ''}, and verify (→ pass/fail), with each stage's input and output artifact labelled so you can see what changes at every step.`;
  }
  return fallbackDesc || `${spec.title} diagram for ${name}`;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || !argv[0]) die('usage: node tools/make-diagrams.mjs <build-dir>');
  const buildDir = path.resolve(argv[0]);
  if (!fs.existsSync(buildDir) || !fs.statSync(buildDir).isDirectory()) die(`build directory does not exist: ${buildDir}`);

  const buildJsonPath = path.join(buildDir, 'build.json');
  if (!fs.existsSync(buildJsonPath)) die(`build.json not found in build dir: ${buildJsonPath}`);
  const buildJson = loadJson(buildJsonPath, 'build.json');

  const kb = buildJson.kb;
  if (!kb || typeof kb !== 'object') die("build.json is missing the 'kb' slot (Station 1 must run before Station 4)");

  const dgPath = resolveKbPath(kb.depGraphPath, buildDir);
  if (!dgPath) die(`architecture diagram cannot be produced: kb.depGraphPath not found (${kb.depGraphPath ?? 'unset'}) — refusing to invent module structure`);
  const dg = loadJson(dgPath, 'dep-graph');
  if (!Array.isArray(dg.nodes) || dg.nodes.length === 0) die(`architecture diagram cannot be produced: dep-graph has no nodes (${dgPath})`);

  const epPath = resolveKbPath(kb.entrypointsPath, buildDir);
  if (!epPath) die(`flow diagram cannot be produced: kb.entrypointsPath not found (${kb.entrypointsPath ?? 'unset'}) — refusing to invent runtime flow`);
  const ep = loadJson(epPath, 'entrypoints');
  const hasFlow = (Array.isArray(ep.install) && ep.install.length) || (Array.isArray(ep.commands) && ep.commands.length)
    || (Array.isArray(ep.binaries) && ep.binaries.length) || (Array.isArray(ep.quickstart) && ep.quickstart.length);
  // A pure library (e.g. a Rust crate workspace) has no runtime entrypoints — skip the flow diagram rather than
  // crash the build or invent a fake flow. The architecture diagram (grounded in the real dep-graph) still ships.
  const skipFlow = !hasFlow;
  if (skipFlow) warn(`no runtime entrypoints (install/commands/binaries/quickstart) in ${epPath} — library repo; skipping flow diagram, architecture diagram still produced`);

  const symPath = resolveKbPath(kb.symbolsPath, buildDir);
  let sym = null;
  if (symPath) sym = loadJson(symPath, 'symbols');
  else warn(`kb.symbolsPath not found (${kb.symbolsPath ?? 'unset'}) — architecture diagram will omit symbol counts`);

  const name = (buildJson.understanding && buildJson.understanding.repoName)
    || (buildJson.repo && buildJson.repo.name) || dg.metaName || ep.metaName || dg.target || 'this repo';

  PAL = resolvePalette(buildJson.concept);
  process.stderr.write(`${TOOL}: palette accents ${PAL.accents.slice(0, 3).join(', ')}${buildJson.concept && buildJson.concept.palette ? ' (themed from concept.palette)' : ' (vivid default)'} — dark/glow renderer\n`);

  const assetsDir = path.join(buildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const visualsIn = (buildJson.visuals && typeof buildJson.visuals === 'object') ? buildJson.visuals : {};
  const merged = {};

  // captions (mono, lowercase, reference-style)
  const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join(' · ') || 'modules';
  const archModel = buildArchModel(dg, sym);
  const flowModel = skipFlow ? null : buildFlowModel(ep, dg);
  const totalModules = dg.componentCount ?? dg.nodes.length;
  const archCaption = `${totalModules} modules · ${dg.internalEdgeCount ?? archModel.edges.length} internal links · ${ecos}`
    + (archModel.trimmed ? `  ·  showing the ${totalModules - archModel.trimmed} most-connected` : '');

  // A dependency map with NO internal edges is a picture of nothing: chalk, stronghold, agenticow and
  // ternlight each shipped a beautifully-styled "N modules · 0 internal links" — decoration around an
  // empty statement, because the renderer drew whatever the graph gave it and never asked whether the
  // graph said anything. Same principle the flow diagram already applies above (skipFlow refuses to
  // invent a runtime flow for a library): a diagram must carry information or it must not be drawn.
  // Here we don't skip — INV-18 requires an architecture diagram — we DEMOTE to the concept renderer
  // and draw what the repo actually IS, from rows the brain authored. Trivial graph => explain the
  // idea, not the (nonexistent) wiring.
  const archDegenerate = archModel.edges.length === 0;
  if (archDegenerate) warn(`dep-graph has 0 internal edges (${totalModules} module${totalModules === 1 ? '' : 's'}) — a dependency map would show nothing; drawing the authored CONCEPT architecture instead`);

  // The flow model is derived from install/build/run/test commands — that is a BUILD LIFECYCLE, not the
  // runtime data-flow its old "Data-flow pipeline" title claimed. Shipping it under that title is what the
  // vision grader kept catching as a caption/content mismatch. Prefer a real runtime flow the brain
  // authored; only fall back to the lifecycle, and when we do, NAME IT HONESTLY.
  const flowAuthored = Array.isArray((visualsIn.flowDiagram || {}).rows) && visualsIn.flowDiagram.rows.length > 0;
  const flowCaption = flowModel ? `${flowModel.steps.length} stages · derived from the project's ${ecos} entrypoints` : null;

  // ── INV-23 FORM RESOLUTION (ADR-0012) ──────────────────────────────────────────────────────────
  // Decided ONCE, for the whole page, BEFORE anything renders. Each slot declares the family it would
  // emit; the resolver guarantees the emitted set is pairwise distinct or dies loudly. This is free and
  // deterministic, and it replaces the old arrangement where a ~$0.30 vision call discovered the
  // collision and a whole rebuild cycle reacted to it — usually too late, at the refine cap.
  const renderSlots = DIAGRAMS
    .filter((spec) => !(spec.grounded === 'flow' && skipFlow))
    .map((spec) => ({
      key: spec.key,
      conceptPrefs: spec.conceptPrefs,
      // How many cards this slot would draw if it demotes — the ribbon's width, and therefore its
      // mobile legibility, is a direct function of this.
      chainLength: (() => {
        const authored = (visualsIn[spec.key] || {}).rows;
        if (Array.isArray(authored) && authored.length) return Math.max(...authored.map((r) => (Array.isArray(r.items) ? r.items.length : 0)));
        if (spec.grounded === 'flow' && flowModel) return (flowRowsFromModel(flowModel) || [{ items: [] }])[0].items.length;
        return null;
      })(),
      // "grounded" here = this slot WOULD draw its real model (a vertical card-stack) if form allowed.
      grounded: (spec.grounded === 'architecture' && !archDegenerate)
        || (spec.grounded === 'flow' && !flowAuthored && Boolean(flowModel)),
    }));
  const forms = resolveForms(renderSlots);
  process.stderr.write(`${TOOL}: INV-23 forms — ${Object.entries(forms)
    .map(([k, d]) => `${k.replace('Diagram', '')}:${d.family}${d.demotedForForm ? ' (demoted for form)' : ''}`).join(' · ')}\n`);

  for (const spec of DIAGRAMS) {
    if (spec.grounded === 'flow' && skipFlow) continue;  // library repo: no runtime flow to draw
    const existing = (visualsIn[spec.key] && typeof visualsIn[spec.key] === 'object') ? visualsIn[spec.key] : {};
    const decision = forms[spec.key];
    let rendered, asciiSrc = null, conceptBack = null;
    // A grounded diagram falls through to the CONCEPT renderer when its grounded model has nothing to
    // say (architecture with 0 edges), when the brain authored something truer (a real runtime flow),
    // or when the INV-23 resolver could not give it a distinct SHAPE (another slot already holds the
    // vertical stack). The third case keeps the REAL model and changes only its layout.
    const asConcept = (spec.grounded === 'architecture' && archDegenerate)
      || (spec.grounded === 'flow' && flowAuthored)
      || decision.demotedForForm;
    if (spec.grounded === 'architecture' && !asConcept) {
      rendered = renderArchitecture(`${name.toUpperCase()} · DEPENDENCY MAP`, 'Module dependency map', archModel, archCaption, PAL);
    } else if (spec.grounded === 'flow' && !asConcept) {
      // honest title: this model IS the build lifecycle (install → build → run → verify), so say so.
      rendered = renderFlow(`${name.toUpperCase()} · LIFECYCLE`, 'Build & run lifecycle', flowModel, flowCaption, PAL);
    } else {
      // big-idea / insight: DRAW real glass concept-cards from a structured rows model (renderConcept) —
      // never typeset ASCII. Prefer the brain's structured .rows; otherwise parse a legacy .ascii source
      // into the SAME model so older builds still render as real cards, not a picture of ASCII.
      let rows = null;
      if (Array.isArray(existing.rows) && existing.rows.length) {
        rows = existing.rows.map((r) => ({
          items: (Array.isArray(r.items) ? r.items : [])
            .map((it, i) => (typeof it === 'string' ? { label: it, colorIdx: i } : { label: it && it.label, colorIdx: (it && it.colorIdx != null) ? it.colorIdx : i }))
            .filter((it) => it.label && String(it.label).trim()),
          connectWithin: r && r.connect !== false,
        })).filter((r) => r.items.length);
      }
      // A grounded flow demoted purely for FORM keeps its real, entrypoint-derived model — same source,
      // same stage names, same result — re-expressed as a connected concept chain. It is not falling
      // back to something invented; it is the same truth in a shape that does not duplicate another
      // diagram. Only reached when the resolver could not hand it the vertical stack.
      if ((!rows || !rows.length) && spec.grounded === 'flow' && decision.demotedForForm) {
        rows = flowRowsFromModel(flowModel);
        if (rows) warn(`flowDiagram demoted to '${decision.variant}' for INV-23 form diversity — real flow model preserved as a ${rows[0].items.length}-item chain`);
      }
      if ((!rows || !rows.length) && spec.grounded) {
        // A DEMOTED grounded diagram must have authored ROWS. Never fall back to .ascii here: for these
        // keys the stored ascii/asciiFallback is a prose *description* (round-tripped by this tool as the
        // accessible text), so accepting it typesets a paragraph as a picture — the exact slop the concept
        // renderer exists to prevent. Structure or nothing.
        // NOTE the shape: renderConcept stacks items VERTICALLY and only draws a connecting arrow between
        // items *within the same row*. So a connected chain is ONE row of N items — NOT N rows of one item
        // (that renders as four floating cards with no arrows, which reads as a bulleted list, not a structure).
        die(`${spec.key}: this repo's dep-graph has ${totalModules} module(s) and 0 internal edges, so a dependency map would show nothing. `
          + `Author visuals.${spec.key}.rows — the CONCEPT of how the thing is built (the 3-4 parts a reader must hold in their head, in order) — `
          + `not the package wiring, and not a paragraph. Shape: one connected chain is ONE row of many items, e.g. `
          + `"rows":[{"items":["your text","tokenizer","ternary engine","384 numbers"],"connect":true}]. `
          + `Refusing to ship a diagram of an empty graph.`);
      }
      if (!rows || !rows.length) {
        const ascii = (typeof existing.ascii === 'string' && existing.ascii.trim()) ? existing.ascii
          : (typeof existing.asciiFallback === 'string' && existing.asciiFallback.trim()) ? existing.asciiFallback : null;
        if (!ascii) die(`missing structure for ${spec.key}: ${spec.title} needs visuals.${spec.key}.rows (preferred) or a legacy .ascii source — the brain must author it`);
        asciiSrc = ascii;
        rows = asciiRows(ascii).rows;
      }
      if (!rows.length) die(`could not build a concept model for ${spec.key}: no usable rows/items`);
      const eyebrow = spec.grounded ? `${name.toUpperCase()} · ${spec.conceptEyebrow}` : spec.conceptEyebrow;
      const heading = (typeof existing.title === 'string' && existing.title.trim()) ? existing.title.trim()
        : spec.conceptHeading;
      // the brain's altText is the one-line TAKEAWAY — render it as the caption so the diagram tells a story
      const cap = (typeof existing.altText === 'string' && existing.altText.trim()) ? existing.altText.trim() : null;
      rendered = renderConcept(eyebrow, heading, rows, cap, PAL, decision.variant);
      // round-trip the structured source + heading so re-running this station (e.g. a refine loop) redraws
      // identically WITHOUT a fresh brain call — and never reverts to the generic title.
      conceptBack = { rows: rows.map((r) => ({ items: r.items.map((it) => it.label), connect: r.connectWithin })), title: heading };
      // textual fallback (accessibility / AI) — synthesize from the structured rows when there is no ASCII
      if (!asciiSrc) asciiSrc = rows.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' -> ' : '   ·   ')).join('\n');
    }
    const altText = (typeof existing.altText === 'string' && existing.altText.trim()) ? existing.altText : defaultAltText(spec, dg, ep, name, rendered.desc, archModel, asConcept);
    const svg = wrapSvg(rendered.W, rendered.H, rendered.body, `${name} — ${spec.title}`, altText, asciiSrc || rendered.desc);
    const svgPath = path.join(assetsDir, spec.file);
    fs.writeFileSync(svgPath, svg, 'utf8');
    assertXmllintClean(svgPath, spec.key);
    // `form` travels with the diagram so the INV-23 guarantee is AUDITABLE after the fact: a test can
    // assert the emitted set is pairwise distinct, and a grader verdict of "two same-form diagrams" can
    // be checked against what was actually drawn instead of being taken on faith.
    merged[spec.key] = { svgPath, altText, asciiFallback: asciiSrc || rendered.desc, format: 'svg-vector-dark', xmllintOK: true, form: decision.family, formVariant: decision.variant, ...(conceptBack || {}) };
  }

  // THE REFUSAL — the hero animation. Emitted ONLY when the brain authored `visuals.heroAnim` for THIS
  // repo. No heroAnim => no band. It must never fall back to another repo's animation, and there is no
  // generic default worth showing: an animation that does not perform THIS project's one idea is the
  // decoration we spent all of 2026-07-12 removing.
  const animSpec = (visualsIn.heroAnim && typeof visualsIn.heroAnim === 'object') ? visualsIn.heroAnim : null;
  if (animSpec) {
    const r = renderRefusal(PAL, animSpec);
    const svg = wrapSvg(r.W, r.H, r.body, `${name} — the one idea, in motion`, r.desc, null, r.style);
    const p = path.join(assetsDir, 'refusal.svg');
    fs.writeFileSync(p, svg, 'utf8');
    assertXmllintClean(p, 'heroAnim');
    merged.heroAnim = { ...animSpec, svgPath: p, altText: r.desc, format: 'svg-vector-animated', xmllintOK: true };
    process.stderr.write(`${TOOL}: refusal.svg — hero animation (9s loop, reduced-motion safe)\n`);
  } else {
    process.stderr.write(`${TOOL}: no visuals.heroAnim authored — skipping the hero animation (never borrowing another repo's)\n`);
  }

  buildJson.visuals = { ...visualsIn, ...merged };
  fs.writeFileSync(buildJsonPath, JSON.stringify(buildJson, null, 2) + '\n', 'utf8');

  const producedKeys = DIAGRAMS.map((d) => d.key).filter((k) => merged[k]);
  const outputs = {
    slot: 'visuals',
    mergedKeys: producedKeys,
    svgPaths: Object.fromEntries(producedKeys.map((k) => [k, merged[k].svgPath])),
    groundedIn: { architecture: dgPath, flow: skipFlow ? null : epPath, symbols: symPath || null },
    renderer: 'dark / glassmorphic / glowing (layered isometric)',
  };
  process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n');
  process.exit(0);
}

main();
