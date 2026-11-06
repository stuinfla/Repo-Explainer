// tools/diagrams/arch-flow.mjs — the two GROUNDED desktop renderers: the radial dependency map (architecture) and
// the build-lifecycle card stack (flow). Their phone-width twins live in mobile.mjs and draw from the SAME models.

import {
  PAL, accent, mix, tint, measure, txt, clip, background, glassPanel, beam, header, curve, captionBlock, fitLines,
} from './draw.mjs';

// ── FLOW (build lifecycle): each stage card shows its verb + command and the artifact it consumes (IN) and
// produces (OUT); the wire between stages carries the previous stage's OUT. ──────────────────────────
const FL = { CARD_W: 664, CARD_H: 108, VGAP: 62, TOP: 150, BOTTOM: 92, TOK_H: 40 };

// ── ARCHITECTURE (radial, ADR-0012): the module the most others depend on in the middle, every other module
// (up to ARCH_MAX_NODES in all) in centred rows of PER_ROW below it, one spoke per real dependency edge. Rows are
// bounded by PER_ROW, not by module count, so the canvas stays portrait and two cards can never overlap. ──
const RD = { HUBW: 268, HUBH: 92, SATW: 196, SATH: 76, TOP: 132, PAD: 46, EXT_H: 62 };

export function renderArchitectureRadial(eyebrow, title, model, caption, pal) {
  const all = model.nodes;
  const hubItem = all.find((it) => it.isHub) || all[0];
  // buildArchModel orders nodes by dependent count, so the most depended-on satellites come first.
  const sats = all.filter((it) => it !== hubItem);
  const m = sats.length;
  // Satellites sit in centred rows of at most PER_ROW (an arc cannot guarantee spacing: cards overlapped at m=4).
  const PER_ROW = 3, HGAP = 26, VGAP = 40;
  const perRow = Math.min(PER_ROW, Math.max(1, m));
  const rowsOfSats = [];
  for (let i = 0; i < m; i += perRow) rowsOfSats.push(sats.slice(i, i + perRow));
  const W = Math.round(Math.max(
    perRow * RD.SATW + (perRow - 1) * HGAP + RD.PAD * 2,
    RD.HUBW + RD.PAD * 2,
    Math.ceil(measure(title, 30, { bold: true })) + 150));
  const cx = W / 2, cyHub = RD.TOP + RD.HUBH / 2;

  const pos = new Map();
  pos.set(hubItem.name, { x: cx, y: cyHub, w: RD.HUBW, h: RD.HUBH, col: accent(0), hub: true });
  const geo = [];
  let satY = cyHub + RD.HUBH / 2 + VGAP + RD.SATH / 2;
  rowsOfSats.forEach((row) => {
    const rowW = row.length * RD.SATW + (row.length - 1) * HGAP;
    let x = cx - rowW / 2 + RD.SATW / 2;
    row.forEach((it) => {
      const idx = sats.indexOf(it);
      const g = { it, x, y: satY, col: accent(idx + 1) };
      pos.set(it.name, { x, y: satY, w: RD.SATW, h: RD.SATH, col: g.col, hub: false });
      geo.push(g);
      x += RD.SATW + HGAP;
    });
    satY += RD.SATH + VGAP;
  });

  const lowest = geo.length ? Math.max(...geo.map((g) => g.y)) : cyHub;
  const extBand = model.ext ? RD.EXT_H + 26 : 0;
  const contentH = (geo.length ? lowest + RD.SATH / 2 : cyHub + RD.HUBH / 2) + 24 + extBand;
  const cb = captionBlock(cx, contentH, W, caption, pal, 92);
  const H = contentH + cb.band;

  const body = [background(W, H, pal), header(cx, 30, eyebrow, title, pal)];

  // REAL dependency edges — every edge whose BOTH ends are drawn (all of them, since every node is drawn).
  // An arrow points from a module to what it depends on.
  const drawn = new Set();
  for (const e of model.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const key = `${e.from}\u0000${e.to}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const k0 = (a.h / 2 + 6) / d, k1 = (d - b.h / 2 - 6) / d;
    body.push(curve(a.x + dx * k0, a.y + dy * k0, a.x + dx * k1, a.y + dy * k1, mix(a.col, b.col, 0.5), { w: 1.7, op: 0.7 }));
  }

  for (const g of geo) {
    const x = g.x - RD.SATW / 2, y = g.y - RD.SATH / 2;
    body.push(glassPanel(x, y, RD.SATW, RD.SATH, g.col, { r: 14, fillA: 0.15, depth: 6, aura: 0.38, solid: true }));
    const lines = fitLines(g.it.label, RD.SATW - 24, 14.5, 2, { bold: true });
    const y0 = g.y - (lines.length - 1) * 9 - (g.it.sub ? 8 : 0);
    lines.forEach((ln, k) => body.push(txt(g.x, y0 + k * 18, ln, { size: 14.5, weight: 700, fill: pal.ink, anchor: 'middle', dom: 'central' })));
    if (g.it.sub) body.push(txt(g.x, g.y + RD.SATH / 2 - 15, clip(g.it.sub, 26), { size: 11, fill: pal.sub, anchor: 'middle', dom: 'central' }));
  }

  // hub last so it sits above every edge
  const hx = cx - RD.HUBW / 2, hy = cyHub - RD.HUBH / 2;
  body.push(glassPanel(hx, hy, RD.HUBW, RD.HUBH, accent(0), { r: 18, fillA: 0.22, depth: 9, aura: 0.6, solid: true }));
  body.push(txt(cx, cyHub - 10, clip(hubItem.label, 24), { size: 18, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central' }));
  if (hubItem.sub) body.push(txt(cx, cyHub + 14, clip(hubItem.sub, 30), { size: 11.5, fill: pal.sub, anchor: 'middle', dom: 'central' }));
  body.push(txt(cx + RD.HUBW / 2 - 34, cyHub - RD.HUBH / 2 + 14, 'CORE', { size: 9.5, mono: true, weight: 700, fill: accent(0), anchor: 'middle', dom: 'central', ls: 1.2 }));

  if (model.ext) {
    const ey = contentH - extBand + 6, ew = Math.min(W - RD.PAD * 2, 460), ex = cx - ew / 2;
    body.push(glassPanel(ex, ey, ew, RD.EXT_H, PAL.extern, { r: 12, fillA: 0.08, depth: 0, aura: 0 }));
    body.push(txt(ex + 16, ey + 22, 'EXTERNAL PACKAGES', { size: 9.5, mono: true, weight: 700, fill: pal.muted, ls: 1.4 }));
    body.push(txt(ex + ew - 16, ey + 22, `${model.ext.count} ${model.ext.count === 1 ? 'dep' : 'deps'}`, { size: 11, mono: true, fill: pal.muted, anchor: 'end' }));
    body.push(txt(ex + 16, ey + 43, clip(model.ext.names.join(' · '), Math.floor((ew - 32) / (12 * 0.55))), { size: 12, fill: pal.sub }));
  }

  body.push(cb.svg);
  const desc = `${title}: ${hubItem.label} is the core module the most others depend on, drawn in the middle; `
    + `around it, ${sats.length} module${sats.length === 1 ? '' : 's'}: ${sats.map((s) => `${s.label}${s.sub ? ` (${s.sub})` : ''}`).join(', ')}`
    + `${model.ext ? `; external packages: ${model.ext.names.join(', ')}` : ''}. `
    + `Each line runs from a module to what it depends on.`;
  return { W, H, body: body.join('\n'), desc };
}

// a label that rides ON a connector wire — names the artifact handed from one stage to the next
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

export function renderFlow(eyebrow, title, model, caption, pal) {
  const steps = model.steps, n = steps.length;
  const cw = FL.CARD_W + 108;
  const ch = FL.TOP + FL.TOK_H + (n + 1) * FL.VGAP + n * FL.CARD_H + FL.TOK_H + FL.BOTTOM;
  // Portrait canvas sized to the single vertical spine (a phone fits it to width, so canvas width decides legibility).
  const cardX = (cw - FL.CARD_W) / 2, spine = cardX + FL.CARD_W / 2;
  const body = [background(cw, ch, pal), '  <g>', header(spine, 30, eyebrow, title, pal)];

  // Each stage fires STEP later than the one before, so the loop reads as one request travelling in execution order.
  const STEP = 0.55;
  let y = FL.TOP;
  body.push(tokenPill(spine, y, 'SOURCE', model.source, accent(0)));
  y += FL.TOK_H;
  for (let i = 0; i < n; i++) {
    const wcol = mix(accent(Math.max(0, i - 1)), accent(i), 0.5);
    body.push(beam(spine, y + 4, spine, y + FL.VGAP - 4, wcol, i * STEP));
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
