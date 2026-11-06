// tools/diagrams/refusal.mjs — THE REFUSAL (hero animation), wide and phone layouts.
// Motion that carries the page's one idea: a BEFORE value snaps to an AFTER value, then the cost it kills is
// struck through. One shared 9s timeline (every element keys off the same duration) so nothing drifts out of phase.
// Content is PER-REPO and comes only from visuals.heroAnim in build.json — never a constant here (ADR-0013).
//   visuals.heroAnim = {
//     label:  'The numbers inside the model',
//     chips:  [{ before:'0.0731', after:'0', op:'skip', kind:'zero'|'neg'|'pos' }, ... 3-6 of them],
//     verdict:{ label:'The one expensive move', symbol:'×', dead:'never used' },
//     kicker: 'it never multiplies — and that is why it fits in 4.6 MB',
//   }
// The band is INLINED into the page, so every rule and keyframe is scoped under the SVG's own id (it cannot leak),
// motion is opacity/transform only, and prefers-reduced-motion settles on the END state.

import { die, txt, glassPanel, background, wrapText } from './draw.mjs';
import { MW, MX, MIW, wrapReg, wrapBold } from './mobile.mjs';

export const REFUSAL_W = 1180, REFUSAL_H = 300;

const colOf = (pal, k) => (k === 'pos' ? pal.accents[0] : k === 'neg' ? (pal.accents[2] || pal.accents[1]) : pal.muted);

function readChips(spec) {
  const chips = (Array.isArray(spec.chips) ? spec.chips : []).slice(0, 6)
    .map((c) => ({ dec: String(c.before ?? ''), tern: String(c.after ?? ''), op: String(c.op ?? ''), kind: c.kind || 'zero' }))
    .filter((c) => c.dec && c.tern);
  if (chips.length < 3) die('visuals.heroAnim.chips needs at least 3 entries of { before, after, op, kind } — refusing to draw a half-empty animation');
  return chips;
}

// the keyframes: chip i snaps on its own beat (18%→38% of the shared timeline); the strike is drawn by SCALING the line
// out from its start (transform, not dash-offset), then the × dies back.
function refusalCss(id, n, strike) {
  const S = `#${id}`, css = [];
  for (let i = 0; i < n; i++) {
    const t0 = 18 + i * 4, t1 = t0 + 5, tOp = t1 + 6;
    css.push(
      // the before-value fully clears (opacity 0) BEFORE the after-value appears — no frame shows both in the chip centre
      `@keyframes ${id}-dec${i}{0%,${t0}%{opacity:1;transform:scale(1)}${t0 + 3}%,100%{opacity:0;transform:scale(0.82)}}`,
      `@keyframes ${id}-ter${i}{0%,${t0 + 3}%{opacity:0;transform:scale(0.6)}${t1 + 2}%{opacity:1;transform:scale(1.18)}${t1 + 6}%,100%{opacity:1;transform:scale(1)}}`,
      `@keyframes ${id}-op${i}{0%,${tOp}%{opacity:0;transform:translateY(6px)}${tOp + 5}%,100%{opacity:1;transform:translateY(0)}}`,
      `${S} .d${i}{animation:${id}-dec${i} 9s linear infinite}`,
      `${S} .t${i}{animation:${id}-ter${i} 9s cubic-bezier(.2,1.6,.35,1) infinite}`,
      `${S} .o${i}{animation:${id}-op${i} 9s ease-out infinite}`,
    );
  }
  css.push(
    `${S} .strike{transform-origin:${strike.x}px ${strike.y}px;animation:${id}-strike 9s ease-in-out infinite}`,
    `@keyframes ${id}-strike{0%,58%{transform:scale(0);opacity:0}59%{opacity:1}68%,100%{transform:scale(1);opacity:1}}`,
    `${S} .mul{transform-box:fill-box;transform-origin:center;animation:${id}-mul 9s ease-in-out infinite}`,
    `@keyframes ${id}-mul{0%,58%{opacity:0.95;transform:scale(1)}70%{opacity:0.95;transform:scale(1)}78%,100%{opacity:0.16;transform:scale(0.9)}}`,
    `@keyframes ${id}-verdict{0%,72%{opacity:0;transform:translateY(6px)}80%,100%{opacity:1;transform:translateY(0)}}`,
    `${S} .verdict{animation:${id}-verdict 9s ease-out infinite}`,
    `@keyframes ${id}-kicker{0%,80%{opacity:0}88%,100%{opacity:1}}`,
    `${S} .kicker{animation:${id}-kicker 9s ease-out infinite}`,
    // transforms must pivot on each glyph, not the SVG origin
    `${S} .dec,${S} .ter,${S} .op,${S} .verdict,${S} .kicker{transform-box:fill-box;transform-origin:center}`,
    // reduced motion: settle on the END state — the meaning, with no movement
    `@media (prefers-reduced-motion:reduce){${S} .dec,${S} .ter,${S} .op,${S} .mul,${S} .strike,${S} .verdict,${S} .kicker{animation:none}`
      + `${S} .dec{opacity:0}${S} .ter,${S} .op,${S} .verdict,${S} .kicker{opacity:1}${S} .mul{opacity:0.16}}`,
  );
  return `  <style>\n    ${css.join('\n    ')}\n  </style>`;
}

function describe(spec, chips) {
  const V = spec.verdict || {};
  return `${spec.label || 'Before'}: ${chips.map((c) => `${c.dec} becomes ${c.tern} (${c.op})`).join('; ')}. `
    + `${V.label || 'The expensive move'} — shown as "${V.symbol || '×'}" — is struck through and goes dark: `
    + `${V.dead || 'never used'}. ${spec.kicker || ''}`;
}

export function renderRefusal(pal, spec, { id = 'dg-hero' } = {}) {
  const chips = readChips(spec);
  const CW = 148, CH = 68, GAP = 22, n = chips.length;
  const x0 = 56, yChip = 96, stripW = n * CW + (n - 1) * GAP;
  const body = [background(REFUSAL_W, REFUSAL_H)];
  body.push(txt(x0, 52, String(spec.label || 'Before'), { size: 12.5, mono: true, weight: 700, fill: pal.muted, ls: 2.2 }));
  chips.forEach((c, i) => {
    const x = x0 + i * (CW + GAP), cx = x + CW / 2, col = colOf(pal, c.kind);
    body.push(glassPanel(x, yChip, CW, CH, col, { r: 14, fillA: 0.16, depth: 8, aura: 0.45 }));
    body.push(txt(cx, yChip + CH / 2, c.dec, { size: 19, mono: true, weight: 600, fill: pal.ink, anchor: 'middle', dom: 'central', cls: `dec d${i}` }));
    body.push(txt(cx, yChip + CH / 2, c.tern, { size: 26, weight: 800, fill: col, anchor: 'middle', dom: 'central', cls: `ter t${i}` }));
    body.push(txt(cx, yChip + CH + 40, c.op, { size: 15.5, mono: true, weight: 700, fill: col, anchor: 'middle', cls: `op o${i}` }));
  });
  const vx = x0 + stripW + 54, vcx = vx + 92, V = spec.verdict || {};
  const strike = { x: vcx - 46, y: yChip + CH / 2 + 34 };
  body.push(txt(vcx, 52, String(V.label || 'The expensive move'), { size: 12.5, mono: true, weight: 700, fill: pal.muted, anchor: 'middle', ls: 2.2 }));
  body.push(txt(vcx, yChip + CH / 2, String(V.symbol || '×'), { size: 74, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central', cls: 'mul' }));
  body.push(`  <line class="strike" x1="${strike.x}" y1="${strike.y}" x2="${vcx + 46}" y2="${yChip + CH / 2 - 34}" stroke="${pal.accents[0]}" stroke-width="6" stroke-linecap="round"/>`);
  body.push(txt(vcx, yChip + CH + 40, String(V.dead || 'never used'), { size: 15.5, mono: true, weight: 700, fill: pal.accents[0], anchor: 'middle', cls: 'verdict' }));
  body.push(txt(REFUSAL_W / 2, 258, String(spec.kicker || ''), { size: 17, weight: 700, fill: pal.ink, anchor: 'middle', cls: 'kicker' }));
  return { W: REFUSAL_W, H: REFUSAL_H, body: body.join('\n'), desc: describe(spec, chips), style: refusalCss(id, n, strike) };
}

/** Phone twin: chips in a two-column field (one column when a value is wide), the verdict below, the kicker wrapped. */
export function renderRefusalMobile(pal, spec, { id = 'dg-hero-m' } = {}) {
  const chips = readChips(spec);
  const widest = Math.max(...chips.flatMap((c) => [c.dec.length * 13 * 0.6, c.tern.length * 20 * 0.6]));
  const cols = widest > (MIW - 12) / 2 - 20 ? 1 : 2, CW = cols === 2 ? (MIW - 12) / 2 : MIW, CH = 64;
  const body = [];
  let y = 34;
  wrapText(String(spec.label || 'Before'), Math.floor(MIW / (13 * 0.6 + 1.5)), { hard: true }).forEach((ln) => { body.push(txt(MX, y, ln, { size: 13, mono: true, weight: 700, fill: pal.muted, ls: 1.5 })); y += 18; });
  y += 8;
  for (let i = 0; i < chips.length; i += cols) {
    const rowChips = chips.slice(i, i + cols);
    const ops = rowChips.map((c) => wrapReg(c.op, CW - 8, 14));
    const rowH = CH + 12 + Math.max(...ops.map((o) => o.length)) * 18 + 14;
    rowChips.forEach((c, k) => {
      const idx = i + k, x = cols === 1 ? MX : MX + k * (CW + 12), cx = x + CW / 2, col = colOf(pal, c.kind);
      body.push(glassPanel(x, y, CW, CH, col, { r: 14, fillA: 0.16, depth: 6, aura: 0.4 }));
      body.push(txt(cx, y + CH / 2, c.dec, { size: 15, mono: true, weight: 600, fill: pal.ink, anchor: 'middle', dom: 'central', cls: `dec d${idx}` }));
      body.push(txt(cx, y + CH / 2, c.tern, { size: 22, weight: 800, fill: col, anchor: 'middle', dom: 'central', cls: `ter t${idx}` }));
      ops[k].forEach((ln, j) => body.push(txt(cx, y + CH + 26 + j * 18, ln, { size: 14, mono: true, weight: 700, fill: col, anchor: 'middle', cls: `op o${idx}` })));
    });
    y += rowH;
  }
  const V = spec.verdict || {};
  body.push(txt(MW / 2, y + 10, String(V.label || 'The expensive move'), { size: 13, mono: true, weight: 700, fill: pal.muted, anchor: 'middle', ls: 1 }));
  const sy = y + 70, sx = MW / 2;
  body.push(txt(sx, sy, String(V.symbol || '×'), { size: 64, weight: 800, fill: pal.ink, anchor: 'middle', dom: 'central', cls: 'mul' }));
  const strike = { x: sx - 40, y: sy + 30 };
  body.push(`  <line class="strike" x1="${strike.x}" y1="${strike.y}" x2="${sx + 40}" y2="${sy - 30}" stroke="${pal.accents[0]}" stroke-width="5" stroke-linecap="round"/>`);
  const dead = wrapBold(String(V.dead || 'never used'), MIW, 14);
  dead.forEach((ln, j) => body.push(txt(MW / 2, sy + 62 + j * 18, ln, { size: 14, mono: true, weight: 700, fill: pal.accents[0], anchor: 'middle', cls: 'verdict' })));
  let ky = sy + 62 + dead.length * 18 + 22;
  wrapBold(String(spec.kicker || ''), MIW, 17).forEach((ln) => { body.push(txt(MW / 2, ky, ln, { size: 17, weight: 700, fill: pal.ink, anchor: 'middle', cls: 'kicker' })); ky += 22; });
  const H = Math.ceil(ky + 14);
  return { W: MW, H, body: [background(MW, H), ...body].join('\n'), desc: describe(spec, chips), style: refusalCss(id, chips.length, strike) };
}
