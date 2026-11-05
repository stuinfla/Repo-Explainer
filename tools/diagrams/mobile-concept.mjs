// tools/diagrams/mobile-concept.mjs — the PHONE layouts of the five concept archetypes (column · ribbon · orbit ·
// strata · grid). Same rows-model as the desktop archetypes (concept.mjs), drawn on a 360-wide canvas with every
// label >= 13 and no truncation: a label wraps (long tokens break) rather than being clipped.

import { accent, mix, tint, txt, beam, glassPanel } from './draw.mjs';
import { conceptSteps } from './concept.mjs';
import { MW, MX, MIW, mobileHeader, mobileCaption, mobileFrame, wrapBold } from './mobile.mjs';

const stack = (out, ls, x, y, lh, o) => { ls.forEach((ln, k) => out.push(txt(x, y + k * lh, ln, o))); return y + ls.length * lh; };

// VSTACK — a vertical chain of full-width cards joined by down-arrows (column plain, ribbon numbered)
function chain(out, steps, y, pal, numbered) {
  const geo = steps.map((s, i) => {
    const lab = wrapBold(s.label, MIW - (numbered ? 84 : 40), 17);
    return { s, lab, h: Math.max(64, 26 + lab.length * 22 + 12), col: accent(s.colorIdx != null ? s.colorIdx : i) };
  });
  geo.forEach((g) => { g.y = y; y += g.h + (g.s.arrow ? 46 : 26); });
  geo.forEach((g, i) => {
    if (i < geo.length - 1 && g.s.arrow) out.push(beam(MW / 2, g.y + g.h + 6, MW / 2, geo[i + 1].y - 6, mix(g.col, geo[i + 1].col, 0.5)));
  });
  geo.forEach((g, i) => {
    out.push(glassPanel(MX, g.y, MIW, g.h, g.col, { r: 16, fillA: 0.17, depth: 6, aura: 0.4, solid: true }));
    if (numbered) {
      out.push(`  <circle cx="${MX + 30}" cy="${g.y + g.h / 2}" r="15" fill="${tint(g.col, 0.22)}" stroke="${g.col}" stroke-width="1.75"/>`);
      out.push(txt(MX + 30, g.y + g.h / 2 + 1, String(i + 1), { size: 15, weight: 800, fill: mix(g.col, '#ffffff', 0.55), anchor: 'middle', dom: 'central' }));
      stack(out, g.lab, MX + 56, g.y + g.h / 2 - (g.lab.length - 1) * 11 + 6, 22, { size: 17, weight: 700, fill: pal.ink });
    } else {
      stack(out, g.lab, MW / 2, g.y + g.h / 2 - (g.lab.length - 1) * 11 + 6, 22, { size: 17, weight: 700, fill: pal.ink, anchor: 'middle' });
    }
  });
  const last = geo[geo.length - 1];
  return last.y + last.h;
}

// RADIAL — the keystone on top, the rest hanging off one spine with a beam to each
function tree(out, steps, y, pal) {
  const [hub, ...sats] = steps;
  const hubCol = accent(hub.colorIdx != null ? hub.colorIdx : 0);
  const hl = wrapBold(hub.label, MIW - 32, 17), hh = Math.max(70, 28 + hl.length * 22 + 10);
  const hubY = y;
  y += hh + 30;
  const SX = MX + 14, CX = MX + 40, CW = MIW - 40;
  const geo = sats.map((s, i) => {
    const lab = wrapBold(s.label, CW - 28, 15);
    const g = { s, lab, h: Math.max(54, 22 + lab.length * 20 + 8), col: accent(s.colorIdx != null ? s.colorIdx : i + 1), y };
    y += g.h + 18;
    return g;
  });
  if (geo.length) out.push(`  <line x1="${SX}" y1="${hubY + hh}" x2="${SX}" y2="${geo[geo.length - 1].y + geo[geo.length - 1].h / 2}" stroke="${tint(hubCol, 0.5)}" stroke-width="2"/>`);
  geo.forEach((g) => out.push(beam(SX, g.y + g.h / 2, CX - 4, g.y + g.h / 2, mix(hubCol, g.col, 0.5))));
  geo.forEach((g) => {
    out.push(glassPanel(CX, g.y, CW, g.h, g.col, { r: 14, fillA: 0.15, depth: 5, aura: 0.34, solid: true }));
    stack(out, g.lab, CX + CW / 2, g.y + g.h / 2 - (g.lab.length - 1) * 10 + 5, 20, { size: 15, weight: 600, fill: pal.ink, anchor: 'middle' });
  });
  out.push(glassPanel(MX, hubY, MIW, hh, hubCol, { r: 18, fillA: 0.22, depth: 8, aura: 0.5, solid: true }));
  stack(out, hl, MW / 2, hubY + hh / 2 - (hl.length - 1) * 11 + 6, 22, { size: 17, weight: 800, fill: pal.ink, anchor: 'middle' });
  return y - 18;
}

// GRID — two columns, read left to right and wrapping
function grid(out, steps, y, pal) {
  const CW = (MIW - 12) / 2;
  for (let i = 0; i < steps.length; i += 2) {
    const pair = steps.slice(i, i + 2).map((s, k) => ({ s, lab: wrapBold(s.label, CW - 20, 15), col: accent(s.colorIdx != null ? s.colorIdx : i + k) }));
    const h = Math.max(70, ...pair.map((p) => 24 + p.lab.length * 20 + 8));
    pair.forEach((p, k) => {
      const x = pair.length === 1 ? MX + (MIW - CW) / 2 : MX + k * (CW + 12);
      out.push(glassPanel(x, y, CW, h, p.col, { r: 15, fillA: 0.16, depth: 6, aura: 0.34, solid: true }));
      stack(out, p.lab, x + CW / 2, y + h / 2 - (p.lab.length - 1) * 10 + 5, 20, { size: 15, weight: 700, fill: pal.ink, anchor: 'middle' });
    });
    y += h + 16;
  }
  return y - 16;
}

// CONTAINMENT — nested frames, outermost to innermost; each frame's label rides its top band
function strata(out, steps, y, pal) {
  const items = steps.slice(0, 6), n = items.length, INS = 14;
  const labs = items.map((s, i) => wrapBold(s.label, MIW - 2 * INS * i - 36, 14));
  const bands = labs.map((l) => 12 + l.length * 18 + 4);
  const innerMin = 40;
  // total height = every band + inner floor + the bottom padding of each frame
  const total = bands.reduce((a, b) => a + b, 0) + innerMin + n * INS;
  items.forEach((s, i) => {
    const x = MX + INS * i, top = y + bands.slice(0, i).reduce((a, b) => a + b, 0);
    const w = MIW - 2 * INS * i, h = y + total - INS * i - top;
    const col = accent(s.colorIdx != null ? s.colorIdx : i), r = Math.max(10, 22 - i * 2);
    if (i === 0) out.push(`  <rect x="${x - 4}" y="${top - 4}" width="${w + 8}" height="${h + 8}" rx="${r + 4}" fill="${col}" opacity="0.14" filter="url(#glow)"/>`);
    out.push(`  <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="${tint(col, 0.09)}" stroke="${tint(col, 0.5)}" stroke-width="1.5"/>`);
    out.push(`  <circle class="node-pulse" cx="${x + 16}" cy="${top + 20}" r="4.5" fill="${col}" opacity="0.4" filter="url(#glowS)"/>`);
    out.push(`  <circle cx="${x + 16}" cy="${top + 20}" r="3" fill="${mix(col, '#ffffff', 0.4)}"/>`);
    stack(out, labs[i], x + 30, top + 25, 18, { size: 14, weight: 700, fill: pal.ink });
  });
  return y + total;
}

const LAYOUT = { column: (o, s, y, p) => chain(o, s, y, p, false), ribbon: (o, s, y, p) => chain(o, s, y, p, true), orbit: tree, strata, grid };

/** Phone twin of renderConcept(): same rows-model, same variant choice. @returns {{W,H,body,desc}} */
export function renderConceptMobile(eyebrow, title, rows, caption, pal, variant = 'column') {
  const { rows: rws, steps } = conceptSteps(rows, title);
  const hd = mobileHeader(eyebrow, title, pal);
  const out = [hd.svg];
  const end = (LAYOUT[variant] || LAYOUT.column)(out, steps, hd.bottom, pal);
  const cb = mobileCaption(end, caption, pal);
  out.push(cb.svg);
  const { W, H, body } = mobileFrame([`  <!-- concept archetype (phone): ${variant} -->`, ...out], cb.bottom);
  const desc = `${title}: ${rws.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' → ' : ', ')).join(' / ')}`;
  return { W, H, body, desc };
}
