// src/story-diagrams-mobile.mjs — the PHONE-WIDTH twins of the two story diagrams (ADR-0014).
//
// WHY: the wide canvases (1110px system map, 1000px+ decision) put 13px labels at ~3px on a 390px phone. These
// render the SAME verified model on a 360px portrait canvas, one column, with no text below 13px, which a phone
// shows at 13 x 312/360 = 11.3px. Content is never re-authored: every name, number, quote-backed claim and note is read
// from the model the wide renderer draws; only wrapping and stacking order differ (wrapAll never truncates).
// The page swaps the two with <picture><source media>, so the model stays the single source of truth.

import {
  esc, wrapAll, validateSystemMap, validateDecision, describeSystemMap, describeDecision, style, decisionMotion,
  C, SW, DOTS, ST,
} from './story-diagrams.mjs';

export const MOBILE_W = 360;
/** Corrective-pass knob: make-diagrams re-draws once with every wrap width scaled by this when the first pass has a defect. */
export const tune = { wrap: 1 };
const wr = (text, px, perChar) => wrapAll(text, px * tune.wrap, perChar);
const X = 16, IW = MOBILE_W - 2 * X;
// advance per character at a given size (kept equal to the overlap checker's estimate: regular .55, bold/mono .6)
const reg = (px) => px * 0.55;
const bold = (px) => px * 0.6;
const num = (n) => Number(Number(n).toFixed(1));

function open(id, W, H, m, desc, extra = '') {
  return [
    `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">${esc(m.title)}</title>`,
    `<desc id="${id}-d">${esc(desc)}</desc>`,
    style(id, extra, { mobile: true }),
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${C.bg}" stroke="${C.line}"/>`,
  ];
}

// stacked wrapped text; returns the y after the last line
function lines(o, cls, ls, x, y, lh, extra = '') {
  ls.forEach((ln, k) => o.push(`<text class="${cls}" x="${x}" y="${y + k * lh}"${extra}>${esc(ln)}</text>`));
  return y + ls.length * lh;
}

function titleBlock(o, m, subtitle) {
  let y = lines(o, 'sd-ttl', wr(m.title, IW, bold(21)), X, 40, 26);
  if (subtitle) y = lines(o, 'sd-sub', wr(subtitle, IW, reg(13)), X, y - 6, 18);
  return y + 12;
}

const down = (o, y, h = 24) => {
  const ax = MOBILE_W / 2;
  o.push(`<path class="sd-flow" stroke="${C.mute}" d="M ${ax} ${y} L ${ax} ${y + h - 6}"/>`);
  o.push(`<path d="M ${ax - 6} ${y + h - 12} L ${ax} ${y + h - 4} L ${ax + 6} ${y + h - 12}" stroke="${C.mute}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  return y + h;
};

export function renderSystemMapMobile(m) {
  const problems = validateSystemMap(m);
  if (problems.length) throw new Error(`systemMap invalid: ${problems.join('; ')}`);
  const o = [];
  const body = [];
  let y = titleBlock(body, m, m.subtitle);

  // inputs
  body.push(`<text class="sd-head" x="${X}" y="${y + 4}">${esc(m.inputs.label || 'INPUTS')}</text>`);
  y += 18;
  m.inputs.items.forEach((it, i) => {
    const nm = wr(it.name, IW - 56, bold(15)), sub = it.sub ? wr(it.sub, IW - 56, reg(13)) : [];
    const h = 22 + nm.length * 20 + sub.length * 17 + 8;
    body.push(`<rect x="${X}" y="${y}" width="${IW}" height="${h}" rx="10" fill="${C.card}" stroke="${C.line}"/>`);
    body.push(`<circle cx="${X + 24}" cy="${y + 22}" r="7" fill="${esc(DOTS[i % DOTS.length])}"/>`);
    const yn = lines(body, 'sd-h', nm, X + 42, y + 26, 20);
    lines(body, 'sd-s', sub, X + 42, yn, 17);
    y += h + 10;
  });
  if (m.inputs.note) {
    const nl = String(m.inputs.note).split('\n').slice(0, 2).flatMap((ln) => wr(ln, IW - 32, reg(13)));
    const h = 16 + nl.length * 18;
    body.push(`<rect x="${X}" y="${y}" width="${IW}" height="${h}" rx="10" fill="none" stroke="${C.line}" stroke-dasharray="4 4"/>`);
    lines(body, 'sd-s', nl, X + 16, y + 24, 18);
    y += h + 10;
  }
  y = down(body, y - 4, 30);

  // engine
  const engSub = m.engine.sub ? wr(m.engine.sub, IW - 40, reg(13)) : [];
  const stepCols = [C.blue, C.amber, C.green, '#a371f7'];
  const steps = m.engine.steps.map((st) => ({ st, t: wr(st.title, IW - 100, bold(15)), s: wr(st.sub, IW - 100, reg(13)) }));
  const engTop = y;
  let sy = engTop + 54 + engSub.length * 17;
  steps.forEach((c) => { c.h = 18 + c.t.length * 20 + c.s.length * 17 + 8; c.y = sy; sy += c.h + 26; });
  const engBottom = sy - 26 + 16;
  body.push(`<rect x="${X}" y="${engTop}" width="${IW}" height="${engBottom - engTop}" rx="14" fill="${C.card}" stroke="${C.green}" stroke-width="1.6"/>`);
  lines(body, 'sd-h', wr(m.engine.name, IW - 40, bold(15)), X + 20, engTop + 30, 20);
  lines(body, 'sd-s', engSub, X + 20, engTop + 50, 17);
  steps.forEach((c, i) => {
    body.push(`<rect x="${X + 14}" y="${c.y}" width="${IW - 28}" height="${c.h}" rx="10" fill="${C.bg}" stroke="${C.line}"/>`);
    body.push(`<circle cx="${X + 38}" cy="${c.y + 24}" r="12" fill="${stepCols[i % 4]}"/><text class="sd-num" x="${X + 38}" y="${c.y + 29}" text-anchor="middle">${i + 1}</text>`);
    const yn = lines(body, 'sd-h', c.t, X + 60, c.y + 28, 20);
    lines(body, 'sd-s', c.s, X + 60, yn, 17);
    if (i < steps.length - 1) {
      const ax = MOBILE_W / 2, ay = c.y + c.h + 4;
      body.push(`<path d="M ${ax} ${ay} L ${ax} ${ay + 16} M ${ax - 6} ${ay + 10} L ${ax} ${ay + 17} L ${ax + 6} ${ay + 10}" stroke="${C.mute}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
    }
  });
  y = engBottom;
  if (m.outputs.streamLabel) {
    y = lines(body, 'sd-s', wr(m.outputs.streamLabel, IW - 40, reg(13)), MOBILE_W / 2, y + 22, 17, ' text-anchor="middle"') - 8;
  }
  y = down(body, y + 4, 28);

  // outputs
  body.push(`<text class="sd-head" x="${X}" y="${y + 4}">${esc(m.outputs.label || 'OUTPUTS')}</text>`);
  y += 18;
  m.outputs.items.forEach((it) => {
    const nm = wr(it.name, IW - 40, bold(15)), cmd = it.cmd ? wr(it.cmd, IW - 40, bold(13)) : [], sub = it.sub ? wr(it.sub, IW - 40, reg(13)) : [];
    const h = 18 + nm.length * 20 + cmd.length * 18 + sub.length * 17 + 8;
    body.push(`<rect x="${X}" y="${y}" width="${IW}" height="${h}" rx="10" fill="${C.card}" stroke="${C.line}"/>`);
    let yy = lines(body, 'sd-h', nm, X + 20, y + 28, 20);
    yy = lines(body, 'sd-code', cmd, X + 20, yy, 18);
    lines(body, 'sd-s', sub, X + 20, yy, 17);
    y += h + 10;
  });

  // works-with — every pill is backed by evidence the tool itself checked (the model is already verified)
  const ww = m.worksWith.items;
  const runsOn = Array.isArray(m.worksWith.runsOn) ? m.worksWith.runsOn.slice(0, 5) : [];
  const pillRows = [];
  let row = [], rw = 0;
  ww.forEach((it) => {
    const label = `${SW[it.status][2]} ${it.name}`, w = Math.round(label.length * bold(14) + 28);
    if (row.length && rw + w + 10 > IW - 32) { pillRows.push(row); row = []; rw = 0; }
    row.push({ it, label, w }); rw += w + 10;
  });
  if (row.length) pillRows.push(row);
  const no = ww.find((x) => x.status === 'no');
  const noLines = no && m.worksWith.noNote ? wr(m.worksWith.noNote, IW - 32, reg(13)) : [];
  const ronRows = [];
  row = []; rw = 0;
  runsOn.forEach((r) => {
    const w = Math.round(r.length * reg(13) + 30);
    if (row.length && rw + w + 8 > IW - 32) { ronRows.push(row); row = []; rw = 0; }
    row.push({ r, w }); rw += w + 8;
  });
  if (row.length) ronRows.push(row);
  const bandH = 40 + pillRows.length * 44 + (noLines.length ? noLines.length * 18 + 6 : 0) + (ronRows.length ? 32 + ronRows.length * 38 : 0) + 8;
  body.push(`<rect x="${X}" y="${y}" width="${IW}" height="${bandH}" rx="14" fill="${C.card}" stroke="${C.line}"/>`);
  body.push(`<text class="sd-head" x="${X + 16}" y="${y + 28}">WORKS WITH</text>`);
  let by = y + 44;
  pillRows.forEach((r) => {
    let px = X + 16;
    r.forEach(({ it, label, w }) => {
      const [stroke, fill] = SW[it.status];
      body.push(`<rect x="${px}" y="${by}" width="${w}" height="34" rx="17" fill="${fill}" stroke="${stroke}"/>`);
      body.push(`<text class="sd-pill" x="${px + w / 2}" y="${by + 22}" text-anchor="middle" fill="${stroke}">${esc(label)}</text>`);
      px += w + 10;
    });
    by += 44;
  });
  if (noLines.length) by = lines(body, 'sd-s', noLines, X + 16, by + 12, 18);
  if (ronRows.length) {
    body.push(`<text class="sd-head" x="${X + 16}" y="${by + 22}">RUNS ON</text>`);
    by += 34;
    ronRows.forEach((r) => {
      let px = X + 16;
      r.forEach(({ r: t, w }) => {
        body.push(`<rect x="${px}" y="${by}" width="${w}" height="30" rx="15" fill="none" stroke="${C.mute}"/>`);
        body.push(`<text class="sd-s" x="${px + w / 2}" y="${by + 20}" text-anchor="middle" style="fill:${C.fg}">${esc(t)}</text>`);
        px += w + 8;
      });
      by += 38;
    });
  }
  const H = Math.ceil(y + bandH + 24);
  o.push(...open('sd-map-m', MOBILE_W, H, m, describeSystemMap(m)), ...body, '</svg>');
  return `${o.join('\n')}\n`;
}

export function renderDecisionMobile(m) {
  const problems = validateDecision(m);
  if (problems.length) throw new Error(`decision invalid: ${problems.join('; ')}`);
  const cs = m.candidates, body = [];
  const BW = IW, BAR_H = 22;
  const act = cs.findIndex((c) => c.status === 'active');
  let y = titleBlock(body, m, m.subtitle || 'Illustrative numbers.');

  const rows = cs.map((c) => {
    const note = c.note ? wr(c.note, IW, reg(13)) : [];
    const nm = wr(c.name, IW - 64, bold(15));
    return { c, note, nm, h: 6 + nm.length * 20 + 8 + BAR_H + 26 + note.length * 17 + 14 };
  });
  rows.forEach((r) => { r.y = y; y += r.h; });
  const chartBottom = y;
  const xOf = (v) => num(X + (v / 100) * BW);

  rows.forEach(({ c, note, nm, y: ry }, i) => {
    const nameEnd = lines(body, 'sd-h', nm, X, ry + 20, 20);
    body.push(`<text class="sd-s" x="${X + IW}" y="${ry + 20}" text-anchor="end" style="fill:${C.fg}">${esc(`${c.value}%`)}</text>`);
    const by = nameEnd;
    body.push(`<rect x="${X}" y="${by}" width="${BW}" height="${BAR_H}" rx="8" fill="${C.card}" stroke="${C.line}"/>`);
    body.push(`<rect ${i === act ? 'class="sd-fillA" ' : ''}x="${X + 2}" y="${by + 2}" width="${num(Math.max(0, (c.value / 100) * BW - 4))}" height="${BAR_H - 4}" rx="6" fill="${ST[c.status]}"/>`);
    body.push(`<line x1="${xOf(m.threshold.value)}" y1="${by - 4}" x2="${xOf(m.threshold.value)}" y2="${by + BAR_H + 4}" stroke="${C.red}" stroke-width="1.8" stroke-dasharray="4 3"/>`);
    if (m.qualify && typeof m.qualify.value === 'number') body.push(`<line x1="${xOf(m.qualify.value)}" y1="${by - 4}" x2="${xOf(m.qualify.value)}" y2="${by + BAR_H + 4}" stroke="${C.amber}" stroke-width="1.8" stroke-dasharray="4 3"/>`);
    const sy = by + BAR_H + 20;
    if (c.status === 'active') {
      body.push(`<rect class="sd-alert" x="${X - 2}" y="${by - 2}" width="${BW + 4}" height="${BAR_H + 4}" rx="9" fill="none" stroke="${C.red}" stroke-width="3"/>`);
      body.push(`<g class="sd-act"><text class="sd-pill" x="${X}" y="${sy}" fill="${C.red}">ACTIVE</text></g>`);
    } else if (c.status === 'skipped') {
      body.push(`<g class="sd-mk"><text class="sd-pill" x="${X}" y="${sy}" fill="${C.amber}">✕ skipped</text></g>`);
    } else if (c.status === 'picked') {
      body.push(`<rect class="sd-ring" x="${X - 3}" y="${by - 3}" width="${BW + 6}" height="${BAR_H + 6}" rx="10" fill="none" stroke="${C.green}" stroke-width="3"/>`);
      body.push(`<g class="sd-pk"><text class="sd-pill" x="${X}" y="${sy}" fill="${C.green}">✓ PICKED</text></g>`);
      body.push(`<g class="sd-actC"><text class="sd-pill" x="${X}" y="${sy}" fill="${C.green}">ACTIVE</text></g>`);
    } else {
      body.push(`<g class="sd-mk"><text class="sd-pill" x="${X}" y="${sy}" fill="${C.blue}">✓ eligible</text></g>`);
    }
    lines(body, 'sd-s', note, X, sy + 20, 17);
  });

  // the threshold (and qualify) marks cross every bar; their labels sit in a legend under the chart
  const q = m.qualify && typeof m.qualify.value === 'number' ? m.qualify : null;
  y = chartBottom + 4;
  const tTop = y + 14;
  y = lines(body, 'sd-s', wr(`${m.threshold.value}% ${m.threshold.label}`, IW - 28, bold(13)), X + 28, tTop, 18, ` style="fill:${C.red};font-weight:700"`);
  body.push(`<line x1="${X}" y1="${tTop - 5}" x2="${X + 20}" y2="${tTop - 5}" stroke="${C.red}" stroke-width="2" stroke-dasharray="5 4"/>`);
  if (q) {
    const qTop = y + 4;
    y = lines(body, 'sd-s', wr(`${q.value}% ${q.label || 'to qualify'}`, IW - 28, bold(13)), X + 28, qTop, 18, ` style="fill:${C.amber};font-weight:700"`);
    body.push(`<line x1="${X}" y1="${qTop - 5}" x2="${X + 20}" y2="${qTop - 5}" stroke="${C.amber}" stroke-width="2" stroke-dasharray="5 4"/>`);
  }
  y += 14;

  // how it decides
  body.push(`<text class="sd-head" x="${X}" y="${y + 6}">${esc(m.panelLabel || 'HOW IT DECIDES')}</text>`);
  y += 26;
  m.steps.forEach((s, i) => {
    const t = wr(s.title, IW - 40, bold(15)), sb = wr(s.sub, IW - 40, reg(13));
    body.push(`<circle cx="${X + 12}" cy="${y + 12}" r="12" fill="${[C.red, C.amber, C.green, C.blue][i]}"/><text class="sd-num" x="${X + 12}" y="${y + 17}" text-anchor="middle">${i + 1}</text>`);
    const yn = lines(body, 'sd-h', t, X + 36, y + 17, 20);
    y = lines(body, 'sd-s', sb, X + 36, yn, 17) + 10;
  });
  if (m.caption) y = lines(body, 'sd-s', wr(m.caption, IW, reg(13)), X, y + 12, 17);
  const H = Math.ceil(y + 24);
  return `${[...open('sd-decision-m', MOBILE_W, H, m, describeDecision(m), decisionMotion('sd-decision-m', { axis: 'X' })), ...body, '</svg>'].join('\n')}\n`;
}
