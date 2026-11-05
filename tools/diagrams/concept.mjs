// tools/diagrams/concept.mjs — the five desktop CONCEPT archetypes (column · ribbon · orbit · strata · grid) drawn
// from one rows-model. Their phone-width twins live in mobile-concept.mjs.

import {
  accent, mix, tint, measure, txt, clip, clamp, background, glassPanel, beam, header, captionBlock, fitLines,
} from './draw.mjs';

// ── CONCEPT ARCHETYPES (big-idea / insight, and architecture / flow when they do not draw their own grounded form) ──
// One rows-model, five distinct SHAPES, so no two slots share a form (INV-23, ADR-0012): column · ribbon · orbit ·
// strata · grid. resolveForms assigns one per page; the house style (glassmorphic dark) stays shared on purpose.
const C = { CARD_H: 78, VGAP: 50, GAP_PLAIN: 30, TOP: 132, BOTTOM: 72, PADX: 30, MINW: 280, MAXW: 580 };

function cwidth(label) { return Math.min(C.MAXW, Math.max(C.MINW, Math.ceil(measure(clip(label, 54), 18.5, { bold: true })) + C.PADX * 2)); }

// flatten a rows-model into ordered steps, marking which connect to the next with an arrow
export function conceptSteps(rows, title) {
  rows = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!rows.length) rows = [{ items: [{ label: title }] }];
  const steps = [];
  rows.forEach((r) => r.items.forEach((it, i) => steps.push({
    label: it.label, colorIdx: it.colorIdx, arrow: !!(r.connectWithin && i < r.items.length - 1),
  })));
  return { rows, steps };
}

// VARIANT 1 — column: the original centered VERTICAL chain of glass cards joined by glowing down-arrows.
function conceptColumn(eyebrow, title, steps, caption, pal) {
  const n = steps.length;
  const maxW = Math.max(C.MINW, ...steps.map((s) => cwidth(s.label)));
  const gaps = steps.slice(0, -1).reduce((t, s) => t + (s.arrow ? C.VGAP : C.GAP_PLAIN), 0);
  const cw = maxW + 140;
  const contentH = C.TOP + n * C.CARD_H + gaps;       // canvas through the bottom of the last card
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

// VARIANT 2 — ribbon: a horizontal LEFT→RIGHT sequence, cards joined by glowing right-arrows (a pipeline).
const RB = { CARD_H: 118, HGAP: 60, TOP: 156, PADX: 64, MINW: 158, MAXW: 300 };
function ribW(label) { return clamp(Math.ceil(measure(clip(label, 34), 15.5, { bold: true })) + 46, RB.MINW, RB.MAXW); }
function conceptRibbon(eyebrow, title, steps, caption, pal, key) {
  const n = steps.length;
  // A four-stage Big Idea handoff uses compact fixed cards: the general 300px cards give a 1385px canvas (2-3px on a phone).
  const compactHandoff = key === 'bigIdeaDiagram' && n === 4;
  const ws = compactHandoff ? steps.map(() => 170) : steps.map((s) => ribW(s.label));
  const hgap = compactHandoff ? 34 : RB.HGAP;
  const rowW = ws.reduce((a, b) => a + b, 0) + hgap * (n - 1);
  const titleMinW = Math.ceil(measure(title, 30, { bold: true })) + 120;
  const W = Math.max(rowW + (compactHandoff ? 34 : RB.PADX) * 2, titleMinW);
  const cardY = RB.TOP, contentH = cardY + RB.CARD_H;
  const cb = captionBlock(W / 2, contentH, W, caption, pal, 84);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: ribbon -->', background(W, H, pal), header(W / 2, 30, eyebrow, title, pal)];
  let x = (W - rowW) / 2;
  const geo = steps.map((s, i) => { const g = { ...s, x, w: ws[i], col: accent(s.colorIdx != null ? s.colorIdx : i) }; x += ws[i] + hgap; return g; });
  for (let i = 0; i < n - 1; i++) if (geo[i].arrow) body.push(beam(geo[i].x + geo[i].w + 6, cardY + RB.CARD_H / 2, geo[i + 1].x - 6, cardY + RB.CARD_H / 2, mix(geo[i].col, geo[i + 1].col, 0.5)));
  for (const g of geo) {
    body.push(glassPanel(g.x, cardY, g.w, RB.CARD_H, g.col, { r: 16, fillA: 0.16, depth: 8, aura: 0.4 }));
    const lines = fitLines(g.label, g.w - 30, 15, 3, { bold: true });
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
    const lines = fitLines(g.label, OB.SATW - 26, 13.5, 3, { bold: true });
    const sy0 = g.sy - (lines.length - 1) * 10;
    lines.forEach((ln, k) => body.push(txt(g.sx, sy0 + k * 20, ln, { size: 13.5, weight: 600, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  }
  // the hub last, so it sits above every beam
  const hx = cx - OB.HUBW / 2, hy = cyHub - OB.HUBH / 2;
  body.push(glassPanel(hx, hy, OB.HUBW, OB.HUBH, hubCol, { r: 20, fillA: 0.22, depth: 9, aura: 0.62 }));
  const hubLines = fitLines(hub.label, OB.HUBW - 34, 17, 2, { bold: true });
  const hy0 = cyHub - (hubLines.length - 1) * 12;
  hubLines.forEach((ln, k) => body.push(txt(cx, hy0 + k * 24, ln, { size: 17, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central' })));
  body.push(cb.svg);
  return { W, H, body: body.join('\n') };
}

// VARIANT 4 — strata: concentric NESTED frames, outermost idea to innermost (only offered when the text claims containment).
const ST = { TOP: 150, SIZE: 640, SIDEPAD: 92 };
function conceptStrata(eyebrow, title, steps, caption, pal) {
  const items = steps.slice(0, 6);
  const n = items.length;
  // keep the innermost frame ≈ 200px wide so it can hold a 2-line label
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

// VARIANT 5 — grid: the ribbon's left→right reading wrapped into rows of at most three. The ribbon's width grows with
// item count (4 items = 949px, ~5px text on a phone); the grid bounds the ROW width instead, so it stays portrait.
export const GR = { PER_ROW: 3, HGAP: 22, VGAP: 30, TOP: 150, PADX: 52, MINW: 168, MAXW: 260, CARD_H: 104 };
function gridW(label) { return clamp(Math.ceil(measure(clip(label, 30), 15, { bold: true })) + 44, GR.MINW, GR.MAXW); }

function conceptGrid(eyebrow, title, steps, caption, pal) {
  const perRow = Math.min(GR.PER_ROW, Math.max(1, steps.length));
  const rows = [];
  for (let i = 0; i < steps.length; i += perRow) rows.push(steps.slice(i, i + perRow));
  const cellW = Math.max(...steps.map((s) => gridW(s.label)));
  const rowW = perRow * cellW + (perRow - 1) * GR.HGAP;
  const W = Math.round(Math.max(rowW + GR.PADX * 2, Math.ceil(measure(title, 30, { bold: true })) + 120));
  const cx = W / 2;
  const contentH = GR.TOP + rows.length * GR.CARD_H + (rows.length - 1) * GR.VGAP + 16;
  const cb = captionBlock(cx, contentH, W, caption, pal, 84);
  const H = contentH + cb.band;
  const body = ['  <!-- concept archetype: grid -->', background(W, H, pal), header(cx, 30, eyebrow, title, pal)];
  let y = GR.TOP, idx = 0;
  for (const row of rows) {
    const thisW = row.length * cellW + (row.length - 1) * GR.HGAP;
    let x = cx - thisW / 2;
    row.forEach((st, k) => {
      const col = accent(st.colorIdx != null ? st.colorIdx : idx);
      // an arrow to the next card IN THIS ROW keeps the left→right reading a chain deserves
      if (k < row.length - 1 && st.arrow !== false) {
        body.push(beam(x + cellW + 3, y + GR.CARD_H / 2, x + cellW + GR.HGAP - 3, y + GR.CARD_H / 2, col));
      }
      body.push(glassPanel(x, y, cellW, GR.CARD_H, col, { r: 15, fillA: 0.16, depth: 7, aura: 0.4 }));
      const lines = fitLines(st.label, cellW - 26, 15, 4, { bold: true });
      const y0 = y + GR.CARD_H / 2 - (lines.length - 1) * 10;
      lines.forEach((ln, j) => body.push(txt(x + cellW / 2, y0 + j * 20, ln, { size: 15, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' })));
      x += cellW + GR.HGAP;
      idx++;
    });
    y += GR.CARD_H + GR.VGAP;
  }
  body.push(cb.svg);
  return { W, H, body: body.join('\n') };
}

// dispatcher — same rows-model, distinct SHAPE per `variant`; `key` is the diagram slot (DIAGRAMS[].key).
export function renderConcept(eyebrow, title, rows, caption, pal, variant = 'column', key = null) {
  const { rows: rws, steps } = conceptSteps(rows, title);
  const desc = `${title}: ${rws.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' → ' : ', ')).join(' / ')}`;
  const fn = variant === 'ribbon' ? conceptRibbon
    : variant === 'grid' ? conceptGrid
      : variant === 'orbit' ? conceptOrbit
        : variant === 'strata' ? conceptStrata
        : conceptColumn;
  const r = fn(eyebrow, title, steps, caption, pal, key);
  return { W: r.W, H: r.H, body: r.body, desc };
}
