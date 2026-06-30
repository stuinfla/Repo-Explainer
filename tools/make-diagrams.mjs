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
  const { size = 14, fill = PAL.ink, weight = 400, anchor = 'start', mono = false, ls, opacity, dom, extra } = o;
  return `<text x="${x}" y="${y}" font-family="${mono ? FM : FH}" font-size="${size}" font-weight="${weight}"`
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
  // a calm node dot (small halo, not a flare)
  parts.push(`  <circle cx="${cx}" cy="${y + h / 2}" r="4.5" fill="${col}" opacity="0.4" filter="url(#glowS)"/>`);
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
function beam(x1, y1, x2, y2, col) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ax = x2 - Math.cos(ang) * 0, ay = y2 - Math.sin(ang) * 0;
  const wing = 9;
  const lx = ax - Math.cos(ang - 0.5) * wing, ly = ay - Math.sin(ang - 0.5) * wing;
  const rx = ax - Math.cos(ang + 0.5) * wing, ry = ay - Math.sin(ang + 0.5) * wing;
  const bright = mix(col, '#ffffff', 0.25);
  return [
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="9" opacity="0.3" filter="url(#glow)" stroke-linecap="round"/>`,
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${bright}" stroke-width="2.4" stroke-linecap="round"/>`,
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

function wrapSvg(W, H, body, title, desc, ascii) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="d-title d-desc">
  <title id="d-title">${escapeXml(title)}</title>
  <desc id="d-desc">${escapeXml(desc)}</desc>
${ascii ? `  <metadata><![CDATA[\n${String(ascii).replace(/]]>/g, ']]&gt;')}\n]]></metadata>\n` : ''}${defs(PAL)}
${body}
</svg>
`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// a directional dependency edge: a smooth bezier that LEAVES the source straight down and ARRIVES at
// the target straight down, so a downward chevron arrowhead is always correct. Glow underlay + bright core.
function curve(x1, y1, x2, y2, col, { w = 1.9, op = 0.82, glow = true } = {}) {
  const dy = Math.max(18, (y2 - y1) * 0.26);           // gentler bend = less awkward tracing
  const tip = y2, base = y2 - 10;                      // stop the line at the arrowhead base, tip at the node
  const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + dy).toFixed(1)}, ${x2.toFixed(1)} ${(tip - dy).toFixed(1)}, ${x2.toFixed(1)} ${base.toFixed(1)}`;
  const bright = mix(col, '#ffffff', 0.2);
  const parts = [];
  if (glow) parts.push(`  <path d="${d}" fill="none" stroke="${col}" stroke-width="${w + 2}" opacity="0.06" filter="url(#glow)"/>`);
  parts.push(`  <path d="${d}" fill="none" stroke="${bright}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`);
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
  const rows = model.rows, edges = model.edges, total = rows.length;
  const rowW = rows.map((r) => r.reduce((s, it) => s + archChipW(it), 0) + AR.CHIP_GAP * (r.length - 1));
  const maxRowW = Math.max(AR.CHIP_MINW * 2 + AR.CHIP_GAP, ...rowW);
  const extH = model.ext ? AR.EXT_GAP + AR.EXT_H : 0;
  const cw = AR.LEFT + maxRowW + AR.RIGHT;
  const ch = AR.TOP + total * AR.CHIP_H + (total - 1) * AR.ROW_GAP + extH + AR.BOTTOM;
  const S = Math.max(cw, ch), ox = (S - cw) / 2, oy = (S - ch) / 2;
  const centerX = AR.LEFT + maxRowW / 2;
  const body = [background(S, S, pal), `  <g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`, header(centerX, 30, eyebrow, title, pal)];

  // place every node and remember its anchor box
  const pos = {};
  rows.forEach((r, i) => {
    const y = AR.TOP + i * (AR.CHIP_H + AR.ROW_GAP);
    let x = centerX - rowW[i] / 2;
    for (const it of r) {
      const w = archChipW(it);
      pos[it.name] = { x, y, w, cx: x + w / 2, top: y, bot: y + AR.CHIP_H, col: accent(i), it };
      x += w + AR.CHIP_GAP;
    }
  });

  // assign each node's edges to distinct ports (sorted toward their neighbour) before drawing
  const outg = {}, inc = {};
  for (const e of edges) { (outg[e.from] = outg[e.from] || []).push(e); (inc[e.to] = inc[e.to] || []).push(e); }
  for (const k in outg) outg[k].sort((a, b) => (pos[a.to] ? pos[a.to].cx : 0) - (pos[b.to] ? pos[b.to].cx : 0));
  for (const k in inc) inc[k].sort((a, b) => (pos[a.from] ? pos[a.from].cx : 0) - (pos[b.from] ? pos[b.from].cx : 0));

  // REAL dependency edges drawn FIRST (behind the cards) — each module→module link, coloured by source
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const sx = portX(a, outg[e.from], e), tx = portX(b, inc[e.to], e);
    body.push(b.top > a.bot
      ? curve(sx, a.bot + 3, tx, b.top - 3, a.col, { glow: false })
      : curve(sx, a.bot + 3, tx, b.bot + 3, a.col, { w: 1.6, op: 0.55, glow: false }));
  }

  // left depth axis — a real "deeper = more foundational / more depended-on" gauge, not a bolted-on rail
  const axX = AR.LEFT - 34;
  const firstY = AR.TOP + AR.CHIP_H / 2, lastRowY = AR.TOP + (total - 1) * (AR.CHIP_H + AR.ROW_GAP) + AR.CHIP_H / 2, midY = (firstY + lastRowY) / 2;
  body.push(`  <line x1="${axX}" y1="${firstY}" x2="${axX}" y2="${lastRowY + 16}" stroke="rgba(255,255,255,0.13)" stroke-width="1.5" stroke-dasharray="2 6"/>`);
  body.push(`  <path d="M ${axX - 5} ${lastRowY + 10} L ${axX} ${lastRowY + 18} L ${axX + 5} ${lastRowY + 10} Z" fill="rgba(255,255,255,0.28)"/>`);
  body.push(txt(26, midY, 'DEPENDENCY DEPTH', { size: 10.5, mono: true, weight: 700, fill: pal.muted, ls: 2, anchor: 'middle', dom: 'central', extra: `transform="rotate(-90 26 ${midY.toFixed(1)})"` }));
  rows.forEach((r, i) => {
    const y = AR.TOP + i * (AR.CHIP_H + AR.ROW_GAP) + AR.CHIP_H / 2, col = accent(i);
    body.push(`  <circle cx="${axX}" cy="${y}" r="4.5" fill="${col}" filter="url(#glowS)"/>`);
    body.push(`  <circle cx="${axX}" cy="${y}" r="3" fill="${mix(col, '#ffffff', 0.4)}"/>`);
    body.push(txt(axX - 13, y, bandName(i, total), { size: 11.5, mono: true, weight: 700, fill: col, ls: 1.2, anchor: 'end', dom: 'central' }));
  });

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
    const eh = 64, ew = clamp(maxRowW, 340, 540), ex = centerX - ew / 2, lc = accent(total - 1);
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
  const legCx = S / 2 - ox;                 // canvas centre, expressed inside this translate(ox,oy) group
  const legAvail = S - 32;                  // usable width: a 16px margin each side
  const fitMono = (s, base) => { const w = measure(s, base, { mono: true }); return w <= legAvail ? base : Math.max(9, +(base * legAvail / w).toFixed(2)); };
  const legend = 'arrow points from a module to what it depends on    ◆ CORE = most depended-on';
  body.push(txt(legCx, legY, legend, { size: fitMono(legend, 12.5), mono: true, fill: pal.sub, anchor: 'middle' }));
  if (caption) { const c = clip(caption, 96); body.push(txt(legCx, legY + 26, c, { size: fitMono(c, 12.5), mono: true, fill: pal.muted, anchor: 'middle' })); }
  body.push('  </g>');
  const desc = `${title}: ${rows.map((r, i) => `${bandName(i, total)} [${r.map((it) => it.name).join(', ')}]`).join(' → ')}; ${edges.length} real dependency edges, core = ${model.hub || 'n/a'}.`;
  return { W: S, H: S, body: body.join('\n'), desc };
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

function flowCard(x, y, col, n, s) {
  const w = FL.CARD_W, h = FL.CARD_H;
  const parts = [glassPanel(x, y, w, h, col, { r: 16, fillA: 0.07, depth: 6, aura: 0.16 })];
  // number badge (subtle glow, not an arcade slab)
  const bx = x + 50, by = y + h / 2;
  parts.push(`  <circle cx="${bx}" cy="${by}" r="22" fill="${col}" opacity="0.28" filter="url(#glowS)"/>`);
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
  const S = Math.max(cw, ch), ox = (S - cw) / 2, oy = (S - ch) / 2;
  const cardX = (cw - FL.CARD_W) / 2, spine = cardX + FL.CARD_W / 2;
  const body = [background(S, S, pal), `  <g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`, header(spine, 30, eyebrow, title, pal)];

  let y = FL.TOP;
  body.push(tokenPill(spine, y, 'SOURCE', model.source, accent(0)));
  y += FL.TOK_H;
  for (let i = 0; i < n; i++) {
    const wcol = mix(accent(Math.max(0, i - 1)), accent(i), 0.5);
    body.push(beam(spine, y + 4, spine, y + FL.VGAP - 4, wcol));
    // the wire carries the artifact the previous stage produced (its OUT) into this one — data, moving
    if (i >= 1) body.push(wireTag(spine, y + FL.VGAP / 2, clip(steps[i - 1].out, 22), wcol));
    y += FL.VGAP;
    body.push(flowCard(cardX, y, accent(i), i + 1, steps[i]));
    y += FL.CARD_H;
  }
  body.push(beam(spine, y + 4, spine, y + FL.VGAP - 4, accent(n - 1)));
  body.push(wireTag(spine, y + FL.VGAP / 2, clip(steps[n - 1].out, 22), accent(n - 1)));
  y += FL.VGAP;
  body.push(tokenPill(spine, y, 'RESULT', model.result, accent(n - 1)));

  if (caption) body.push(txt(spine, ch - FL.BOTTOM + 46, clip(caption, 88), { size: 12, mono: true, fill: pal.muted, anchor: 'middle' }));
  body.push('  </g>');
  const desc = `${title}: ${model.source} ⟶ ${steps.map((s) => `${s.name} (${s.in} → ${s.out})`).join(' ⟶ ')} ⟶ ${model.result}.`;
  return { W: S, H: S, body: body.join('\n'), desc };
}

// ── CONCEPT (big-idea / insight): a centered VERTICAL glowing flow of idea-cards ───────────────────
// Wide-but-short horizontal strips waste a forced-square canvas, so we stack the idea as a vertical
// path that fills a near-square — sequence items get glowing down-arrows; separate statements stack.
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

function renderConcept(eyebrow, title, rows, caption, pal) {
  rows = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!rows.length) rows = [{ items: [{ label: title }] }];
  // flatten into vertical steps, marking which connect to the next with an arrow
  const steps = [];
  rows.forEach((r) => r.items.forEach((it, i) => steps.push({
    label: it.label, colorIdx: it.colorIdx, arrow: !!(r.connectWithin && i < r.items.length - 1),
  })));
  const n = steps.length;
  const maxW = Math.max(C.MINW, ...steps.map((s) => cwidth(s.label)));
  const gaps = steps.slice(0, -1).reduce((t, s) => t + (s.arrow ? C.VGAP : C.GAP_PLAIN), 0);
  const cw = maxW + 140;
  const contentH = C.TOP + n * C.CARD_H + gaps;       // canvas through the bottom of the last card

  // PORTRAIT canvas — width = the card column (or the title, whichever is wider), NOT a forced square.
  // A square left big dead side-margins around the narrow card column, which looked broken when the
  // diagram was panned on a phone. Portrait keeps the cards flush to the frame on every device.
  const titleMinW = Math.ceil(measure(title, 30, { bold: true })) + 120;
  const W = Math.max(cw, titleMinW);
  // caption: WRAP to the real canvas width (mono) so it can never spill past the edges, then size the
  // bottom band to the wrapped line count.
  const CAP_FS = 13, CAP_CW = CAP_FS * 0.6, CAP_LH = CAP_FS * 1.5;
  const capCharCap = Math.max(16, Math.floor((W - 104) / CAP_CW));
  let capLines = caption ? wrapText(caption, capCharCap) : [];
  if (capLines.length > 3) { capLines = capLines.slice(0, 3); capLines[2] = clip(capLines[2] + ' …', capCharCap); }
  const bottomPad = capLines.length ? Math.max(C.BOTTOM, 34 + capLines.length * CAP_LH + 22) : C.BOTTOM;
  const H = contentH + bottomPad;
  const ox = (W - cw) / 2, oy = 0;                    // centre the card column horizontally; portrait, so no vertical centring
  const mid = cw / 2;

  const body = [background(W, H, pal), `  <g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`, header(mid, 30, eyebrow, title, pal)];
  let y = C.TOP;
  const geo = steps.map((s, i) => { const g = { ...s, y, col: accent(s.colorIdx != null ? s.colorIdx : i) }; y += C.CARD_H + (s.arrow ? C.VGAP : C.GAP_PLAIN); return g; });
  for (let i = 0; i < geo.length - 1; i++) if (geo[i].arrow) body.push(beam(mid, geo[i].y + C.CARD_H + 6, mid, geo[i + 1].y - 6, mix(geo[i].col, geo[i + 1].col, 0.5)));
  for (const g of geo) {
    const w = cwidth(g.label), x = mid - w / 2;
    body.push(glassPanel(x, g.y, w, C.CARD_H, g.col, { r: 18, fillA: 0.18, depth: 8, aura: 0.5 }));
    body.push(txt(mid, g.y + C.CARD_H / 2, clip(g.label, 54), { size: 18.5, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' }));
  }
  // caption wrapped + stacked + centered below the last card
  let cy = contentH + 34 + CAP_FS;
  for (const cl of capLines) { body.push(txt(mid, cy, cl, { size: CAP_FS, mono: true, fill: pal.muted, anchor: 'middle' })); cy += CAP_LH; }
  body.push('  </g>');
  const desc = `${title}: ${rows.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' → ' : ', ')).join(' / ')}`;
  return { W, H, body: body.join('\n'), desc };
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
    .filter((e) => { const k = e.from + ' ' + e.to; if (seenE.has(k)) return false; seenE.add(k); return true; });

  // full-graph degree → keep the most-connected modules when there are too many to draw legibly
  const fIn = {}, fOut = {};
  for (const e of edges) { fIn[e.to] = (fIn[e.to] || 0) + 1; fOut[e.from] = (fOut[e.from] || 0) + 1; }
  const fdeg = (n) => (fIn[n.name] || 0) + (fOut[n.name] || 0);
  const CAP = 12;
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

const DIAGRAMS = [
  { key: 'architectureDiagram', file: 'architecture.svg', title: 'Architecture', grounded: 'architecture' },
  { key: 'flowDiagram', file: 'flow.svg', title: 'Process / Data Flow', grounded: 'flow' },
  { key: 'bigIdeaDiagram', file: 'big-idea.svg', title: 'Big Idea', grounded: null },
  { key: 'insightDiagram', file: 'insight.svg', title: 'The Insight', grounded: null },
];

function defaultAltText(spec, dg, ep, name, fallbackDesc, archModel) {
  if (spec.grounded === 'architecture') {
    const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join('/') || 'one ecosystem';
    const hub = archModel && archModel.hub ? `, with ${archModel.hub} as the core module the most others depend on` : '';
    return `${name} module dependency map: ${dg.componentCount ?? (Array.isArray(dg.nodes) ? dg.nodes.length : 0)} components across ${ecos} wired by ${dg.internalEdgeCount ?? 0} internal dependencies, drawn as a layered graph where each arrow points from a module to what it depends on (top entry points down to shared foundation libraries)${hub}.`;
  }
  if (spec.grounded === 'flow') {
    const bins = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean).slice(0, 3).join(', ');
    return `${name} data-flow pipeline: the repo source flows through install (→ dependencies), build (→ compiled artifacts), run the entry point${bins ? ` (${bins})` : ''}, and verify (→ pass/fail), with each stage's input and output artifact labelled so you can see what data changes at every step.`;
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
  const flowCaption = flowModel ? `${flowModel.steps.length} stages · derived from the project's ${ecos} entrypoints` : null;

  for (const spec of DIAGRAMS) {
    if (spec.grounded === 'flow' && skipFlow) continue;  // library repo: no runtime flow to draw
    const existing = (visualsIn[spec.key] && typeof visualsIn[spec.key] === 'object') ? visualsIn[spec.key] : {};
    let rendered, asciiSrc = null, conceptBack = null;
    if (spec.grounded === 'architecture') {
      rendered = renderArchitecture(`${name.toUpperCase()} · DEPENDENCY MAP`, 'Module dependency map', archModel, archCaption, PAL);
    } else if (spec.grounded === 'flow') {
      rendered = renderFlow(`${name.toUpperCase()} · PIPELINE`, 'Data-flow pipeline', flowModel, flowCaption, PAL);
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
      if (!rows || !rows.length) {
        const ascii = (typeof existing.ascii === 'string' && existing.ascii.trim()) ? existing.ascii
          : (typeof existing.asciiFallback === 'string' && existing.asciiFallback.trim()) ? existing.asciiFallback : null;
        if (!ascii) die(`missing structure for ${spec.key}: ${spec.title} needs visuals.${spec.key}.rows (preferred) or a legacy .ascii source — the brain must author it`);
        asciiSrc = ascii;
        rows = asciiRows(ascii).rows;
      }
      if (!rows.length) die(`could not build a concept model for ${spec.key}: no usable rows/items`);
      const eyebrow = spec.key === 'bigIdeaDiagram' ? 'THE BIG IDEA' : 'THE INSIGHT';
      const heading = (typeof existing.title === 'string' && existing.title.trim()) ? existing.title.trim()
        : (spec.key === 'bigIdeaDiagram' ? 'How it all fits together' : 'The clever move');
      // the brain's altText is the one-line TAKEAWAY — render it as the caption so the diagram tells a story
      const cap = (typeof existing.altText === 'string' && existing.altText.trim()) ? existing.altText.trim() : null;
      rendered = renderConcept(eyebrow, heading, rows, cap, PAL);
      // round-trip the structured source + heading so re-running this station (e.g. a refine loop) redraws
      // identically WITHOUT a fresh brain call — and never reverts to the generic title.
      conceptBack = { rows: rows.map((r) => ({ items: r.items.map((it) => it.label), connect: r.connectWithin })), title: heading };
      // textual fallback (accessibility / AI) — synthesize from the structured rows when there is no ASCII
      if (!asciiSrc) asciiSrc = rows.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' -> ' : '   ·   ')).join('\n');
    }
    const altText = (typeof existing.altText === 'string' && existing.altText.trim()) ? existing.altText : defaultAltText(spec, dg, ep, name, rendered.desc, archModel);
    const svg = wrapSvg(rendered.W, rendered.H, rendered.body, `${name} — ${spec.title}`, altText, asciiSrc || rendered.desc);
    const svgPath = path.join(assetsDir, spec.file);
    fs.writeFileSync(svgPath, svg, 'utf8');
    assertXmllintClean(svgPath, spec.key);
    merged[spec.key] = { svgPath, altText, asciiFallback: asciiSrc || rendered.desc, format: 'svg-vector-dark', xmllintOK: true, ...(conceptBack || {}) };
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
