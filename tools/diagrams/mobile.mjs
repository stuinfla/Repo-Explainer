// tools/diagrams/mobile.mjs — the PHONE layouts of the two grounded diagrams (architecture, flow) plus the shared phone
// kit. Canvas is 360 units wide and every text is >= 13, which a 390px phone shows at 13 x 312/360 = 11.3px.
// Each renderer draws from the SAME model object as its desktop twin (arch-flow.mjs): only wrapping and stacking
// differ, so there is one source of truth for every claim. Nothing is truncated: long labels wrap, long tokens break.

import { tune } from '../../src/story-diagrams-mobile.mjs';
import { PAL, accent, mix, tint, measure, txt, escapeXml, FH, background, glassPanel, beam, wrapText, clip } from './draw.mjs';

export const MW = 360;
export const MX = 16;
export const MIW = MW - 2 * MX;

const regCap = (px, fs) => Math.max(6, Math.floor((px * tune.wrap) / (fs * 0.55)));
const boldCap = (px, fs) => Math.max(6, Math.floor((px * tune.wrap) / (fs * 0.6)));
export const wrapReg = (s, px, fs) => wrapText(s, regCap(px, fs), { hard: true });
export const wrapBold = (s, px, fs) => wrapText(s, boldCap(px, fs), { hard: true });

/** Phone header: eyebrow (wrapped mono) + wrapped title + accent rule. Returns { svg, bottom }. */
export function mobileHeader(eyebrow, title, pal) {
  const out = [];
  const eb = wrapText(eyebrow, Math.floor(MIW / (13 * 0.6 + 1.5)), { hard: true });
  let y = 34;
  eb.forEach((ln) => { out.push(txt(MW / 2, y, ln, { size: 13, mono: true, fill: pal.primary, weight: 600, anchor: 'middle', ls: 1.5 })); y += 18; });
  y += 14;
  const tl = wrapBold(title, MIW, 24);
  tl.forEach((ln) => {
    out.push(`  <text x="${MW / 2}" y="${y}" font-family="${FH}" font-size="24" font-weight="800" fill="${pal.primary}" text-anchor="middle" opacity="0.45" filter="url(#glowS)">${escapeXml(ln)}</text>`);
    out.push(txt(MW / 2, y, ln, { size: 24, weight: 800, fill: pal.ink, anchor: 'middle' }));
    y += 30;
  });
  out.push(`  <line x1="${MW / 2 - 34}" y1="${y - 14}" x2="${MW / 2 + 34}" y2="${y - 14}" stroke="${pal.primary}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`);
  return { svg: out.join('\n'), bottom: y + 16 };
}

/** Caption wrapped in full (never clipped) at 13px; returns { svg, bottom }. */
export function mobileCaption(y, caption, pal) {
  if (!caption) return { svg: '', bottom: y + 28 };
  const ls = wrapReg(caption, MIW, 13);
  const svg = ls.map((l, i) => txt(MW / 2, y + 30 + i * 18, l, { size: 13, fill: pal.muted, anchor: 'middle' })).join('\n');
  return { svg, bottom: y + 30 + ls.length * 18 + 20 };
}

/** The finished phone SVG pieces: { W, H, body }. */
export function mobileFrame(parts, H) { return { W: MW, H: Math.ceil(H), body: [background(MW, Math.ceil(H)), ...parts].join('\n') }; }

// stacked text lines, one <text> each; returns the baseline y AFTER the last line
function stack(out, ls, x, y, lh, o) {
  ls.forEach((ln, k) => out.push(txt(x, y + k * lh, ln, o)));
  return y + ls.length * lh;
}

// a straight spoke between two cards (used when both sit in one row, where a down-bezier would degenerate)
function sideSpoke(x1, y, x2, col) {
  const dir = x2 > x1 ? 1 : -1, bright = mix(col, '#ffffff', 0.2);
  return [
    `  <path class="flow-line" d="M ${x1.toFixed(1)} ${y.toFixed(1)} L ${(x2 - dir * 8).toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${bright}" stroke-width="1.8" opacity="0.5" stroke-linecap="round"/>`,
    `  <path d="M ${(x2 - dir * 9).toFixed(1)} ${(y - 5).toFixed(1)} L ${x2.toFixed(1)} ${y.toFixed(1)} L ${(x2 - dir * 9).toFixed(1)} ${(y + 5).toFixed(1)} Z" fill="${bright}" opacity="0.8"/>`,
  ].join('\n');
}
function downCurve(a, b, col) {
  const bright = mix(col, '#ffffff', 0.2), dy = Math.max(14, Math.abs(b.y - a.y) * 0.3);
  const down = b.y >= a.y, s = down ? 1 : -1;
  const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${a.x.toFixed(1)} ${(a.y + s * dy).toFixed(1)}, ${b.x.toFixed(1)} ${(b.y - s * dy).toFixed(1)}, ${b.x.toFixed(1)} ${(b.y - s * 9).toFixed(1)}`;
  return [
    `  <path class="flow-line" d="${d}" fill="none" stroke="${bright}" stroke-width="1.8" opacity="0.5" stroke-linecap="round"/>`,
    `  <path d="M ${(b.x - 6).toFixed(1)} ${(b.y - s * 10).toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)} L ${(b.x + 6).toFixed(1)} ${(b.y - s * 10).toFixed(1)} Z" fill="${bright}" opacity="0.8"/>`,
  ].join('\n');
}

// ── ARCHITECTURE (phone): the hub on top, every other module in a two-column field below it ──────────
export function renderArchitectureMobile(eyebrow, title, model, caption, pal) {
  const hubItem = model.nodes.find((it) => it.isHub) || model.nodes[0];
  const sats = model.nodes.filter((it) => it !== hubItem);
  const hd = mobileHeader(eyebrow, title, pal);
  const pos = new Map();
  const cards = [];

  // hub: CORE tag, label, sub — stacked, so no two texts can share a line
  const hubLabel = wrapBold(hubItem.label, MIW - 32, 17);
  const hubSub = hubItem.sub ? wrapReg(hubItem.sub, MIW - 32, 13) : [];
  const hubH = 20 + 20 + hubLabel.length * 22 + hubSub.length * 18 + 14;
  let y = hd.bottom;
  const hubY = y;
  pos.set(hubItem.name, { x: MW / 2, y: y + hubH / 2, h: hubH, w: MIW });
  y += hubH + 44;

  const SW = (MIW - 12) / 2;
  for (let i = 0; i < sats.length; i += 2) {
    const pair = sats.slice(i, i + 2);
    const prep = pair.map((it) => ({ it, lab: wrapBold(it.label, SW - 20, 14), sub: it.sub ? wrapReg(it.sub, SW - 20, 13) : [] }));
    const h = Math.max(...prep.map((p) => 18 + p.lab.length * 19 + p.sub.length * 17 + 8), 62);
    prep.forEach((p, k) => {
      const x = pair.length === 1 ? MX + (MIW - SW) / 2 : MX + k * (SW + 12);
      p.x = x; p.y = y; p.h = h;
      pos.set(p.it.name, { x: x + SW / 2, y: y + h / 2, h, w: SW });
      cards.push(p);
    });
    y += h + 36;
  }
  const colOf = new Map(cards.map((c, i) => [c.it.name, accent(i + 1)]));
  colOf.set(hubItem.name, accent(0));

  const out = [hd.svg];
  // real dependency edges first (opaque cards drawn after, so lines never run through text)
  const seen = new Set();
  for (const e of model.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b || seen.has(`${e.from}\0${e.to}`)) continue;
    seen.add(`${e.from}\0${e.to}`);
    const col = mix(colOf.get(e.from), colOf.get(e.to), 0.5);
    if (Math.abs(b.y - a.y) < 8) {
      const dir = b.x > a.x ? 1 : -1;
      out.push(sideSpoke(a.x + dir * (a.w / 2 - 0), a.y, b.x - dir * (b.w / 2 + 0), col));
    } else {
      const dir = b.y > a.y ? 1 : -1;
      out.push(downCurve({ x: a.x, y: a.y + dir * (a.h / 2 + 2) }, { x: b.x, y: b.y - dir * (b.h / 2 + 2) }, col));
    }
  }
  cards.forEach((p) => {
    const col = colOf.get(p.it.name);
    out.push(glassPanel(p.x, p.y, SW, p.h, col, { r: 14, fillA: 0.15, depth: 5, aura: 0.3, solid: true }));
    let ty = stack(out, p.lab, p.x + SW / 2, p.y + 26, 19, { size: 14, weight: 700, fill: pal.ink, anchor: 'middle' });
    stack(out, p.sub, p.x + SW / 2, ty - 2, 17, { size: 13, fill: pal.sub, anchor: 'middle' });
  });
  out.push(glassPanel(MX, hubY, MIW, hubH, accent(0), { r: 18, fillA: 0.22, depth: 8, aura: 0.5, solid: true }));
  out.push(txt(MX + 16, hubY + 24, 'CORE', { size: 13, mono: true, weight: 700, fill: accent(0), ls: 1.2 }));
  let hy = stack(out, hubLabel, MW / 2, hubY + 50, 22, { size: 17, weight: 800, fill: pal.ink, anchor: 'middle' });
  stack(out, hubSub, MW / 2, hy - 2, 18, { size: 13, fill: pal.sub, anchor: 'middle' });

  y -= 24;
  if (model.ext) {
    const names = wrapReg(model.ext.names.join(' · '), MIW - 32, 13);
    const h = 26 + 20 + names.length * 18 + 14;
    out.push(glassPanel(MX, y, MIW, h, PAL.extern, { r: 12, fillA: 0.08, depth: 0, aura: 0 }));
    out.push(txt(MX + 16, y + 24, `EXTERNAL PACKAGES · ${model.ext.count} ${model.ext.count === 1 ? 'dep' : 'deps'}`, { size: 13, mono: true, weight: 700, fill: pal.muted, ls: 0.6 }));
    stack(out, names, MX + 16, y + 48, 18, { size: 13, fill: pal.sub });
    y += h + 8;
  }
  const cb = mobileCaption(y, caption, pal);
  out.push(cb.svg);
  const { W, H, body } = mobileFrame(out, cb.bottom);
  const desc = `${title}: ${hubItem.label} is the core module the most others depend on, drawn first; `
    + `below it, ${sats.length} module${sats.length === 1 ? '' : 's'}: ${sats.map((s) => `${s.label}${s.sub ? ` (${s.sub})` : ''}`).join(', ')}`
    + `${model.ext ? `; external packages: ${model.ext.names.join(', ')}` : ''}. Each line runs from a module to what it depends on.`;
  return { W, H, body, desc };
}

// ── FLOW (phone): the same stage cards, stacked at full width ────────────────────────────────────────
export function renderFlowMobile(eyebrow, title, model, caption, pal) {
  const hd = mobileHeader(eyebrow, title, pal);
  const out = [hd.svg];
  let y = hd.bottom;

  const endpoint = (kind, label, col) => {
    const ls = wrapReg(label, MIW - 40, 13);
    const h = 22 + 20 + ls.length * 18 + 8;
    out.push(`  <rect x="${MX}" y="${y}" width="${MIW}" height="${h}" rx="14" fill="rgba(255,255,255,0.04)" stroke="${tint(col, 0.5)}" stroke-width="1.25"/>`);
    out.push(`  <circle cx="${MX + 18}" cy="${y + 20}" r="3.4" fill="${col}" filter="url(#glowS)"/>`);
    out.push(txt(MX + 30, y + 25, kind, { size: 13, mono: true, weight: 800, fill: col, ls: 1.2 }));
    stack(out, ls, MX + 20, y + 46, 18, { size: 13, mono: true, fill: PAL.ink });
    y += h;
  };
  const wire = (i, tag, col) => {
    const ty = y + 38;
    out.push(beam(MW / 2, y + 4, MW / 2, y + 62, col, i * 0.55));
    if (tag) {
      tag = clip(tag, 22);   // the wire pill is one line, as on the desktop twin: a long token must not leave the canvas
      const w = Math.ceil(measure(tag, 13, { mono: true })) + 24;
      out.push(`  <rect x="${(MW / 2 - w / 2).toFixed(1)}" y="${ty - 14}" width="${w}" height="28" rx="14" fill="rgba(8,11,17,0.94)" stroke="${tint(col, 0.5)}" stroke-width="1"/>`);
      out.push(txt(MW / 2, ty, tag, { size: 13, mono: true, fill: mix(col, '#ffffff', 0.4), anchor: 'middle', dom: 'central' }));
    }
    y += 66;
  };

  endpoint('SOURCE', model.source, accent(0));
  model.steps.forEach((s, i) => {
    const col = accent(i);
    wire(i, i >= 1 ? model.steps[i - 1].out : null, mix(accent(Math.max(0, i - 1)), col, 0.5));
    const verb = wrapReg(s.verb, MIW - 76, 13);
    const cmd = wrapText(`$ ${s.cmd}`, Math.floor((MIW - 56) / (13 * 0.6)), { hard: true });
    const inL = wrapText(s.in, Math.floor((MIW - 90) / (13 * 0.6)), { hard: true });
    const outL = wrapText(s.out, Math.floor((MIW - 90) / (13 * 0.6)), { hard: true });
    const cmdH = cmd.length * 18 + 14;
    const h = 20 + 24 + verb.length * 18 + 10 + cmdH + 12 + Math.max(inL.length, 1) * 18 + 8 + Math.max(outL.length, 1) * 18 + 16;
    out.push(glassPanel(MX, y, MIW, h, col, { r: 16, fillA: 0.07, depth: 5, aura: 0.14, solid: true }));
    const bx = MX + 30, by = y + 34;
    out.push(`  <circle class="node-pulse" style="animation-delay:${(i * 0.55 + 0.2).toFixed(2)}s" cx="${bx}" cy="${by}" r="18" fill="${col}" opacity="0.28" filter="url(#glowS)"/>`);
    out.push(`  <circle cx="${bx}" cy="${by}" r="16" fill="${tint(col, 0.2)}" stroke="${col}" stroke-width="1.75"/>`);
    out.push(txt(bx, by + 1, String(i + 1), { size: 16, weight: 800, fill: mix(col, '#ffffff', 0.55), anchor: 'middle', dom: 'central' }));
    out.push(txt(MX + 58, y + 39, s.name, { size: 18, weight: 800, fill: PAL.ink, ls: 0.4 }));
    let yy = stack(out, verb, MX + 20, y + 68, 18, { size: 13, fill: PAL.sub });
    out.push(`  <rect x="${MX + 16}" y="${yy - 4}" width="${MIW - 32}" height="${cmdH}" rx="7" fill="rgba(0,0,0,0.42)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
    yy = stack(out, cmd, MX + 28, yy + 14, 18, { size: 13, mono: true, fill: mix(col, '#ffffff', 0.5) });
    yy += 8;
    out.push(txt(MX + 20, yy + 10, 'IN', { size: 13, mono: true, weight: 700, fill: PAL.muted, ls: 1.2 }));
    stack(out, inL, MX + 64, yy + 10, 18, { size: 13, mono: true, fill: PAL.sub });
    yy += Math.max(inL.length, 1) * 18 + 8;
    out.push(txt(MX + 20, yy + 10, 'OUT', { size: 13, mono: true, weight: 700, fill: col, ls: 1.2 }));
    stack(out, outL, MX + 64, yy + 10, 18, { size: 13, mono: true, weight: 600, fill: mix(col, '#ffffff', 0.4) });
    y += h;
  });
  const last = model.steps[model.steps.length - 1];
  wire(model.steps.length, last.out, accent(model.steps.length - 1));
  endpoint('RESULT', model.result, accent(model.steps.length - 1));
  const cb = mobileCaption(y, caption, pal);
  out.push(cb.svg);
  const { W, H, body } = mobileFrame(out, cb.bottom);
  const desc = `${title}: ${model.source} ⟶ ${model.steps.map((s) => `${s.name} (${s.in} → ${s.out})`).join(' ⟶ ')} ⟶ ${model.result}.`;
  return { W, H, body, desc };
}

