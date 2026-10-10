// src/story-diagrams.mjs — the two "story" diagram types (ADR-0014).
//
// WHY: the dependency-graph diagrams answer "how is the code laid out?". Readers ask other things:
// "what does this plug into, and does it work with MY tool?" and "how does it actually decide?".
// These renderers draw those two answers from a small, EVIDENCE-BACKED model the brain authors.
//
//   renderSystemMap(model)  — inputs → engine → outputs, plus a WORKS WITH strip whose every entry
//                             carries its evidence (a "no" is a recorded search, never a guess).
//   renderDecision(model)   — candidates as gauges against a threshold; skipped / picked marked; the
//                             handoff animated. Shows a choice being made, not a list of steps.
//
// PURE: no I/O, no network. validate*() enforce grounding BEFORE anything is drawn; render*() never
// emit a label wider than its box (fit() truncates with an ellipsis), so output is always legible.
// Motion is gated on prefers-reduced-motion, and the static (reduced-motion) state is the END of the
// story, so a still image still tells all of it. No scripts, no foreignObject, no external refs.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(Number(n).toFixed(1));

// Average advance widths (px per char) for the fonts the SVG asks for — deliberately a touch wide.
const W_BOLD16 = 8.2, W_REG13 = 6.1, W_CODE13 = 7.9, W_BOLD14 = 7.8;

/** Truncate `text` with an ellipsis so it fits `maxPx` at `perChar` px per character. */
export function fit(text, maxPx, perChar) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const max = Math.max(1, Math.floor(maxPx / perChar));
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Word-wrap to at most `maxLines` lines of `maxPx`; only the final line is ever truncated. */
export function wrap(text, maxPx, perChar, maxLines = 2) {
  const words = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const cap = Math.max(1, Math.floor(maxPx / perChar));
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= cap) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.map((l) => fit(l, maxPx, perChar));
  const head = lines.slice(0, maxLines - 1);
  return [...head, fit(lines.slice(maxLines - 1).join(' '), maxPx, perChar)];
}

const isStr = (v, max = 160) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// ── validation (grounding gate) ────────────────────────────────────────────────────────────────────
/** @returns {string[]} problems; empty means the model is drawable AND grounded. */
export function validateSystemMap(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['systemMap: not an object'];
  if (!isStr(m.title, 60)) e.push('title: required, ≤60 chars');
  const list = (v, min, max, name) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) { e.push(`${name}: need ${min}–${max} items`); return []; }
    return v;
  };
  list(m.inputs && m.inputs.items, 1, 5, 'inputs.items').forEach((it, i) => {
    if (!isStr(it && it.name, 40)) e.push(`inputs.items[${i}].name required`);
  });
  const steps = list(m.engine && m.engine.steps, 2, 4, 'engine.steps');
  if (!m.engine || !isStr(m.engine.name, 40)) e.push('engine.name required');
  steps.forEach((s, i) => { if (!isStr(s && s.title, 30) || !isStr(s && s.sub, 80)) e.push(`engine.steps[${i}] needs title ≤30 and sub ≤80`); });
  list(m.outputs && m.outputs.items, 1, 4, 'outputs.items').forEach((it, i) => {
    if (!isStr(it && it.name, 40)) e.push(`outputs.items[${i}].name required`);
    if (it && it.cmd != null && !isStr(it.cmd, 40)) e.push(`outputs.items[${i}].cmd too long`);
  });
  const ww = list(m.worksWith && m.worksWith.items, 1, 6, 'worksWith.items');
  ww.forEach((it, i) => {
    if (!isStr(it && it.name, 28)) e.push(`worksWith.items[${i}].name required`);
    if (!it || !['yes', 'partial', 'no'].includes(it.status)) { e.push(`worksWith.items[${i}].status must be yes|partial|no`); return; }
    // the grounding rule: every claim must be CHECKABLE by the tool — it does not take the brain's word.
    if (it.status === 'no') {
      const t = Array.isArray(it.terms) ? it.terms : [];
      if (t.length < 1 || t.length > 5 || !t.every((x) => isStr(x, 30))) e.push(`worksWith.items[${i}].terms required for a "no" (1–5 search terms the tool will grep for)`);
    } else if (!isStr(it.file, 200) || !isStr(it.quote, 240)) {
      e.push(`worksWith.items[${i}] needs file + quote — a verbatim line from that file that supports the claim`);
    }
  });
  return e;
}

export function validateDecision(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['decision: not an object'];
  if (!isStr(m.title, 60)) e.push('title: required, ≤60 chars');
  const c = Array.isArray(m.candidates) ? m.candidates : [];
  if (c.length < 2 || c.length > 6) e.push('candidates: need 2–6');
  c.forEach((it, i) => {
    if (!isStr(it && it.name, 24)) e.push(`candidates[${i}].name required`);
    if (!it || typeof it.value !== 'number' || it.value < 0 || it.value > 100) e.push(`candidates[${i}].value must be 0–100`);
    if (!it || !['active', 'skipped', 'picked', 'eligible'].includes(it.status)) e.push(`candidates[${i}].status invalid`);
  });
  if (c.filter((x) => x && x.status === 'picked').length > 1) e.push('candidates: at most one picked');
  if (c.filter((x) => x && x.status === 'active').length > 1) e.push('candidates: at most one active');
  if (!m.threshold || typeof m.threshold.value !== 'number' || !isStr(m.threshold.label, 60)) e.push('threshold: {value, label} required');
  const steps = Array.isArray(m.steps) ? m.steps : [];
  if (steps.length < 2 || steps.length > 4) e.push('steps: need 2–4');
  steps.forEach((s, i) => { if (!isStr(s && s.title, 40) || !isStr(s && s.sub, 60)) e.push(`steps[${i}] needs title ≤40 and sub ≤60`); });
  if (!m.rule || !isStr(m.rule.file, 200) || !isStr(m.rule.quote, 240)) e.push('rule: {file, quote} required — a verbatim line from the source that defines the decision');
  return e;
}

// ── shared style ───────────────────────────────────────────────────────────────────────────────────
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const C = { bg: '#0d1117', card: '#161b22', line: '#30363d', fg: '#f0f6fc', mute: '#8b949e', red: '#f85149', amber: '#d29922', green: '#3fb950', blue: '#4493c9', code: '#79c0ff' };

function style(extra = '') {
  return `<style>
    svg text { font-family: ${FONT}; }
    .sd-ttl { font-size: 24px; font-weight: 700; fill: ${C.fg}; }
    .sd-sub { font-size: 13px; fill: ${C.mute}; }
    .sd-h { font-size: 16px; font-weight: 700; fill: ${C.fg}; }
    .sd-s { font-size: 13px; fill: ${C.mute}; }
    .sd-head { font-size: 11px; letter-spacing: 1.6px; fill: ${C.mute}; font-weight: 700; }
    .sd-pill { font-size: 14px; font-weight: 700; }
    .sd-code { font: 13px ${MONO}; fill: ${C.code}; }
    .sd-num { font-size: 12px; font-weight: 700; fill: ${C.bg}; }
    .sd-flow { fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: 6 9; }
    ${extra}
    @media (prefers-reduced-motion: no-preference) { .sd-flow { animation: sd-dash 1.3s linear infinite; } }
    @keyframes sd-dash { to { stroke-dashoffset: -30; } }
  </style>`;
}

const norm = (t) => String(t).toLowerCase().replace(/[\s*_`>#|-]+/g, ' ').trim();

/**
 * Check every "works with" claim against the real repo and return a NEW model holding only what the
 * tool itself could confirm. `read(file)` → text|null; `search(terms)` → [{file,line}] (case-insensitive).
 *   yes / partial → kept only if the quote is really in the file;
 *   no            → kept only if the tool's own search finds ZERO mentions (a "no" is a measurement);
 *                   a term that IS mentioned means "unsupported" would be a guess — the pill is dropped.
 * @returns {{ model: object, notes: string[] }}
 */
export function verifySystemMap(model, { read, search }) {
  const notes = [];
  const items = [];
  for (const it of model.worksWith.items) {
    if (it.status === 'no') {
      const hits = search(it.terms) || [];
      if (hits.length === 0) {
        items.push({ ...it, evidence: `searched ${it.terms.join(', ')} in the README and source: 0 matches` });
      } else {
        notes.push(`dropped "${it.name}": claimed no support but ${hits.length} mention(s), e.g. ${hits[0].file}:${hits[0].line}`);
      }
      continue;
    }
    const text = read(it.file);
    if (text != null && norm(text).includes(norm(it.quote))) {
      items.push({ ...it, evidence: `${it.file}: "${it.quote}"` });
    } else {
      notes.push(`dropped "${it.name}": quote not found in ${it.file}${text == null ? ' (file unreadable)' : ''}`);
    }
  }
  return { model: { ...model, worksWith: { ...model.worksWith, items } }, notes };
}

/** A decision is only drawn when its rule's quote really is in the named file. @returns {{ok:boolean, note?:string}} */
export function verifyDecision(model, { read }) {
  const text = read(model.rule.file);
  if (text != null && norm(text).includes(norm(model.rule.quote))) return { ok: true };
  return { ok: false, note: `decision dropped: quote not found in ${model.rule.file}${text == null ? ' (file unreadable)' : ''}` };
}

export function describeSystemMap(m) {
  const ww = m.worksWith.items.map((x) => `${x.name}: ${x.status === 'yes' ? 'works' : x.status === 'partial' ? 'partly' : 'no evidence of support'}`).join('; ');
  return `${m.inputs.items.map((i) => i.name).join(', ')} feed ${m.engine.name} (${m.engine.steps.map((x) => x.title).join(', ')}), which drives ${m.outputs.items.map((x) => x.name).join(', ')}. Works with — ${ww}.`;
}

export function describeDecision(m) {
  const sum = m.candidates.map((c) => `${c.name} at ${c.value} percent${c.status === 'active' ? ' (active, over the line)' : c.status === 'skipped' ? ' (skipped)' : c.status === 'picked' ? ' (picked)' : ' (eligible)'}`).join('; ');
  return `${sum}. ${m.steps.map((x) => x.title).join('. ')}. Numbers are illustrative.`;
}

// ── SYSTEM MAP ─────────────────────────────────────────────────────────────────────────────────────
const SW = { yes: [C.green, '#12261a', '✓'], partial: [C.amber, '#2a2412', '~'], no: [C.amber, '#2a1a12', '✕'] };
const DOTS = [C.red, C.amber, C.green, C.blue, '#a371f7'];

export function renderSystemMap(m) {
  const problems = validateSystemMap(m);
  if (problems.length) throw new Error(`systemMap invalid: ${problems.join('; ')}`);
  const W = 1110, LX = 40, LW = 210, EX = 330, EW = 330, OX = 770, OW = 300, TOP = 104, LH = 16;
  const ins = m.inputs.items, steps = m.engine.steps, outs = m.outputs.items;

  // every card measures its own wrapped text, so nothing is cut mid-word and cards stay tidy
  const inCards = ins.map((it) => {
    const nm = wrap(it.name, LW - 56, W_BOLD16, 2);
    const sub = it.sub ? wrap(it.sub, LW - 56, W_REG13, 2) : [];
    return { it, nm, sub, h: 62 + Math.max(0, nm.length - 1) * 18 + Math.max(0, sub.length - 1) * LH };
  });
  let y = TOP + 12;
  inCards.forEach((c) => { c.y = y; y += c.h + 14; });
  const inBottom = y - 14;
  const noteLines = m.inputs.note ? String(m.inputs.note).split('\n').slice(0, 2).flatMap((ln) => wrap(ln, LW - 30, W_REG13, 2)).slice(0, 3) : [];
  const noteH = noteLines.length ? 22 + noteLines.length * 20 : 0;
  const leftBottom = inBottom + (noteH ? 16 + noteH : 0);

  const engSub = m.engine.sub ? wrap(m.engine.sub, EW - 44, W_REG13, 2) : [];
  const stepCards = steps.map((st) => { const sub = wrap(st.sub, EW - 100, W_REG13, 2); return { st, sub, h: 62 + Math.max(0, sub.length - 1) * LH }; });
  y = TOP + 68 + Math.max(0, engSub.length - 1) * LH;
  stepCards.forEach((c) => { c.y = y; y += c.h + 22; });
  const engBottom = y - 22 + 20;

  const outCards = outs.map((it) => { const sub = it.sub ? wrap(it.sub, OW - 40, W_REG13, 2) : []; return { it, sub, h: 80 + Math.max(0, sub.length - 1) * LH }; });
  y = TOP + 12;
  outCards.forEach((c) => { c.y = y; y += c.h + 21; });
  const outBottom = y - 21;

  const chartBottom = Math.max(leftBottom, engBottom, outBottom);
  const ww = m.worksWith.items;
  const runsOn = Array.isArray(m.worksWith.runsOn) ? m.worksWith.runsOn.slice(0, 5) : [];
  const bandY = chartBottom + 24, bandH = runsOn.length ? 130 : 90;
  const H = bandY + bandH + 28;
  const engMid = (TOP + engBottom) / 2;

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="sd-t sd-d">`);
  o.push(`<title id="sd-t">${esc(m.title)}</title>`);
  o.push(`<desc id="sd-d">${esc(describeSystemMap(m))}</desc>`);
  o.push(style());
  o.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${C.bg}" stroke="${C.line}"/>`);
  o.push(`<text class="sd-ttl" x="40" y="48">${esc(fit(m.title, 1000, 13.5))}</text>`);
  if (m.subtitle) o.push(`<text class="sd-sub" x="40" y="72">${esc(fit(m.subtitle, 1000, 7))}</text>`);

  // inputs
  o.push(`<text class="sd-head" x="${LX}" y="${TOP}">${esc(fit(m.inputs.label || 'INPUTS', LW, 9))}</text>`);
  inCards.forEach((c, i) => {
    const cy = c.y + 31;
    o.push(`<rect x="${LX}" y="${c.y}" width="${LW}" height="${c.h}" rx="10" fill="${C.card}" stroke="${C.line}"/>`);
    o.push(`<circle cx="${LX + 24}" cy="${cy}" r="7" fill="${esc(DOTS[i % DOTS.length])}"/>`);
    c.nm.forEach((ln, k) => o.push(`<text class="sd-h" x="${LX + 42}" y="${c.y + 27 + k * 18}">${esc(ln)}</text>`));
    const subY = c.y + 47 + (c.nm.length - 1) * 18;
    c.sub.forEach((ln, k) => o.push(`<text class="sd-s" x="${LX + 42}" y="${subY + k * LH}">${esc(ln)}</text>`));
    const spread = (i - (ins.length - 1) / 2) * 12;
    o.push(`<path class="sd-flow" stroke="${C.mute}" d="M ${LX + LW} ${cy} C ${LX + LW + 40} ${cy}, ${LX + LW + 40} ${num(engMid + spread)}, ${EX} ${num(engMid + spread)}"/>`);
  });
  if (noteLines.length) {
    const ny = inBottom + 16;
    o.push(`<rect x="${LX}" y="${ny}" width="${LW}" height="${noteH}" rx="10" fill="none" stroke="${C.line}" stroke-dasharray="4 4"/>`);
    noteLines.forEach((ln, i) => o.push(`<text class="sd-s" x="${LX + 16}" y="${ny + 26 + i * 20}">${esc(ln)}</text>`));
  }

  // engine
  o.push(`<rect x="${EX}" y="${TOP}" width="${EW}" height="${engBottom - TOP}" rx="14" fill="${C.card}" stroke="${C.green}" stroke-width="1.6"/>`);
  o.push(`<text class="sd-h" x="${EX + 22}" y="${TOP + 32}">${esc(fit(m.engine.name, EW - 44, W_BOLD16))}</text>`);
  engSub.forEach((ln, k) => o.push(`<text class="sd-s" x="${EX + 22}" y="${TOP + 52 + k * LH}">${esc(ln)}</text>`));
  const stepCols = [C.blue, C.amber, C.green, '#a371f7'];
  stepCards.forEach((c, i) => {
    o.push(`<rect x="${EX + 22}" y="${c.y}" width="${EW - 44}" height="${c.h}" rx="10" fill="${C.bg}" stroke="${C.line}"/>`);
    o.push(`<circle cx="${EX + 46}" cy="${c.y + 31}" r="11" fill="${stepCols[i % 4]}"/><text class="sd-num" x="${EX + 46}" y="${c.y + 35}" text-anchor="middle">${i + 1}</text>`);
    o.push(`<text class="sd-h" x="${EX + 68}" y="${c.y + 27}">${esc(fit(c.st.title, EW - 100, W_BOLD16))}</text>`);
    c.sub.forEach((ln, k) => o.push(`<text class="sd-s" x="${EX + 68}" y="${c.y + 47 + k * LH}">${esc(ln)}</text>`));
    if (i < stepCards.length - 1) {
      const ax = EX + EW / 2, ay = c.y + c.h + 3;
      o.push(`<path d="M ${ax} ${ay} L ${ax} ${ay + 16} M ${ax - 6} ${ay + 10} L ${ax} ${ay + 17} L ${ax + 6} ${ay + 10}" stroke="${C.mute}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
    }
  });

  // outputs
  o.push(`<text class="sd-head" x="${OX}" y="${TOP}">${esc(fit(m.outputs.label || 'OUTPUTS', OW, 9))}</text>`);
  if (m.outputs.streamLabel) {
    wrap(m.outputs.streamLabel, OX - EX - EW - 10, W_REG13, 2).forEach((ln, k) => o.push(`<text class="sd-s" x="${EX + EW + 6}" y="${TOP + 28 + k * LH}">${esc(ln)}</text>`));
  }
  outCards.forEach((c) => {
    o.push(`<rect x="${OX}" y="${c.y}" width="${OW}" height="${c.h}" rx="10" fill="${C.card}" stroke="${C.line}"/>`);
    o.push(`<text class="sd-h" x="${OX + 20}" y="${c.y + 30}">${esc(fit(c.it.name, OW - 40, W_BOLD16))}</text>`);
    if (c.it.cmd) o.push(`<text class="sd-code" x="${OX + 20}" y="${c.y + 50}">${esc(fit(c.it.cmd, OW - 40, W_CODE13))}</text>`);
    c.sub.forEach((ln, k) => o.push(`<text class="sd-s" x="${OX + 20}" y="${c.y + 68 + k * LH}">${esc(ln)}</text>`));
    o.push(`<path class="sd-flow" stroke="${C.green}" d="M ${EX + EW} ${num(engMid)} C ${EX + EW + 60} ${num(engMid)}, ${EX + EW + 60} ${c.y + 40}, ${OX} ${c.y + 40}"/>`);
  });

  // works-with strip — every pill is backed by evidence the tool itself checked
  o.push(`<rect x="40" y="${bandY}" width="${W - 80}" height="${bandH}" rx="14" fill="${C.card}" stroke="${C.line}"/>`);
  o.push(`<text class="sd-head" x="64" y="${bandY + 30}">WORKS WITH</text>`);
  let px = 64;
  ww.forEach((it) => {
    const [stroke, fill, mark] = SW[it.status];
    const label = `${mark} ${fit(it.name, 200, W_BOLD14)}`;
    const w = Math.round(label.length * W_BOLD14 + 36);
    o.push(`<rect x="${px}" y="${bandY + 42}" width="${w}" height="36" rx="18" fill="${fill}" stroke="${stroke}"/>`);
    o.push(`<text class="sd-pill" x="${px + w / 2}" y="${bandY + 65}" text-anchor="middle" fill="${stroke}">${esc(label)}</text>`);
    px += w + 14;
  });
  const no = ww.find((x) => x.status === 'no');
  if (no && m.worksWith.noNote && px < W - 340) {
    o.push(`<text class="sd-s" x="${px + 6}" y="${bandY + 65}">${esc(fit(m.worksWith.noNote, W - 64 - px - 6, W_REG13))}</text>`);
  }
  if (runsOn.length) {
    o.push(`<text class="sd-head" x="64" y="${bandY + 108}">RUNS ON</text>`);
    let rx = 140;
    runsOn.forEach((r) => {
      const t = fit(r, 160, W_REG13), w = Math.round(t.length * W_REG13 + 30);
      o.push(`<rect x="${rx}" y="${bandY + 93}" width="${w}" height="26" rx="13" fill="none" stroke="${C.mute}"/>`);
      o.push(`<text class="sd-s" x="${rx + w / 2}" y="${bandY + 110}" text-anchor="middle" fill="${C.fg}" style="fill:${C.fg}">${esc(t)}</text>`);
      rx += w + 12;
    });
  }
  o.push('</svg>');
  return `${o.join('\n')}\n`;
}

// ── DECISION ───────────────────────────────────────────────────────────────────────────────────────
const ST = { active: C.red, skipped: C.amber, picked: C.green, eligible: C.blue };

export function renderDecision(m) {
  const problems = validateDecision(m);
  if (problems.length) throw new Error(`decision invalid: ${problems.join('; ')}`);
  const cs = m.candidates, n = cs.length, steps = m.steps;
  const X0 = 70, TW = 110, PITCH = 155, TOPY = 150, BASE = 450, PX = 3; // 100% = TOPY, 0% = BASE
  const chartRight = X0 + (n - 1) * PITCH + TW;
  const PANEL = chartRight + 170;
  const W = Math.max(PANEL + 320, 1000), H = 572;
  const yOf = (v) => num(BASE - v * PX);
  const cx = (i) => X0 + i * PITCH + TW / 2;
  const act = cs.findIndex((c) => c.status === 'active');
  const pick = cs.findIndex((c) => c.status === 'picked');
  const thrY = yOf(m.threshold.value);
  const q = m.qualify && typeof m.qualify.value === 'number' ? m.qualify : null;

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="sd-t sd-d">`);
  o.push(`<title id="sd-t">${esc(m.title)}</title>`);
  o.push(`<desc id="sd-d">${esc(describeDecision(m))}</desc>`);
  o.push(style(`
    .sd-ring { opacity: 1; } .sd-act, .sd-actC { opacity: 0; }
    .sd-fillA { transform-box: fill-box; transform-origin: bottom; }
    .sd-arc { stroke-dasharray: 1; stroke-dashoffset: 0; }
    @media (prefers-reduced-motion: no-preference) {
      .sd-fillA { animation: sd-grow 10s ease-in-out infinite; }
      .sd-alert { animation: sd-alert 10s ease-in-out infinite; }
      .sd-mk    { animation: sd-mark 10s ease-out infinite; }
      .sd-pk    { animation: sd-pick 10s ease-out infinite; }
      .sd-ring  { animation: sd-ringk 10s ease-in-out infinite; }
      .sd-arc   { animation: sd-arck 10s ease-in-out infinite; }
      .sd-act   { animation: sd-leave 10s ease-in-out infinite; }
      .sd-actC  { animation: sd-enter 10s ease-in-out infinite; }
    }
    @keyframes sd-grow  { 0% { transform: scaleY(.84); } 26%, 100% { transform: scaleY(1); } }
    @keyframes sd-alert { 0%, 24% { opacity: 0; } 30% { opacity: 1; } 38% { opacity: .35; } 46%, 94% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes sd-mark  { 0%, 44% { opacity: 0; } 50%, 94% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes sd-pick  { 0%, 56% { opacity: 0; } 62%, 82% { opacity: 1; } 86%, 100% { opacity: 0; } }
    @keyframes sd-ringk { 0%, 56% { opacity: 0; } 64% { opacity: 1; } 72% { opacity: .55; } 80%, 94% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes sd-arck  { 0%, 62% { stroke-dashoffset: 1; opacity: 1; } 78%, 94% { stroke-dashoffset: 0; opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 0; } }
    @keyframes sd-leave { 0%, 78% { opacity: 1; } 84%, 100% { opacity: 0; } }
    @keyframes sd-enter { 0%, 84% { opacity: 0; } 90%, 94% { opacity: 1; } 100% { opacity: 0; } }`));
  o.push(`<defs><marker id="sd-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.green}"/></marker></defs>`);
  o.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${C.bg}" stroke="${C.line}"/>`);
  o.push(`<text class="sd-ttl" x="40" y="48">${esc(fit(m.title, W - 80, 13.5))}</text>`);
  o.push(`<text class="sd-sub" x="40" y="72">${esc(fit(m.subtitle || 'Illustrative numbers.', W - 80, 7))}</text>`);

  cs.forEach((c, i) => {
    const x = X0 + i * PITCH, top = yOf(c.value), h = num(BASE - 3 - top);
    o.push(`<rect x="${x}" y="${TOPY}" width="${TW}" height="${BASE - TOPY}" rx="10" fill="${C.card}" stroke="${C.line}"/>`);
    o.push(`<rect ${i === act ? 'class="sd-fillA" ' : ''}x="${x + 3}" y="${top}" width="${TW - 6}" height="${h}" rx="7" fill="${ST[c.status]}"/>`);
  });
  o.push(`<line x1="${X0 - 15}" y1="${thrY}" x2="${chartRight + 15}" y2="${thrY}" stroke="${C.red}" stroke-width="1.8" stroke-dasharray="7 5"/>`);
  o.push(`<text class="sd-s" x="${chartRight + 24}" y="${Number(thrY) - 18}" style="fill:${C.red};font-weight:700">${esc(`${m.threshold.value}%`)}</text>`);
  wrap(m.threshold.label, PANEL - chartRight - 40, W_REG13, 2).forEach((ln, k) => o.push(`<text class="sd-s" x="${chartRight + 24}" y="${Number(thrY) - 4 + k * 14}" style="font-size:12px">${esc(ln)}</text>`));
  if (q) {
    const qy = yOf(q.value);
    o.push(`<line x1="${X0 - 15}" y1="${qy}" x2="${chartRight + 15}" y2="${qy}" stroke="${C.amber}" stroke-width="1.8" stroke-dasharray="7 5"/>`);
    o.push(`<text class="sd-s" x="${chartRight + 24}" y="${Number(qy) + 12}" style="fill:${C.amber};font-weight:700">${esc(`${q.value}% ${fit(q.label || 'to qualify', PANEL - chartRight - 70, 6.5)}`)}</text>`);
  }
  if (act >= 0) o.push(`<rect class="sd-alert" x="${X0 + act * PITCH}" y="${TOPY}" width="${TW}" height="${BASE - TOPY}" rx="10" fill="none" stroke="${C.red}" stroke-width="3"/>`);
  if (pick >= 0) o.push(`<rect class="sd-ring" x="${X0 + pick * PITCH - 3}" y="${TOPY - 3}" width="${TW + 6}" height="${BASE - TOPY + 6}" rx="12" fill="none" stroke="${C.green}" stroke-width="3.5"/>`);
  if (act >= 0 && pick >= 0) {
    const a = cx(act) + 33, b = cx(pick);
    o.push(`<path class="sd-arc" pathLength="1" d="M ${a} 120 C ${a + 52} 66, ${b - 55} 62, ${b} 106" fill="none" stroke="${C.green}" stroke-width="3" stroke-linecap="round" marker-end="url(#sd-ah)"/>`);
  }
  cs.forEach((c, i) => {
    const mid = cx(i);
    if (c.status === 'active') {
      o.push(`<g class="sd-act"><rect x="${mid - 28}" y="112" width="56" height="20" rx="10" fill="${C.red}"/><text class="sd-pill" style="font-size:12px" x="${mid}" y="126" text-anchor="middle" fill="${C.bg}">ACTIVE</text></g>`);
    } else if (c.status === 'skipped') {
      o.push(`<g class="sd-mk"><text class="sd-pill" style="font-size:13px" x="${mid}" y="140" text-anchor="middle" fill="${C.amber}">✕ skipped</text></g>`);
    } else if (c.status === 'picked') {
      o.push(`<g class="sd-pk"><rect x="${mid - 40}" y="112" width="80" height="22" rx="11" fill="${C.green}"/><text class="sd-pill" style="font-size:13px" x="${mid}" y="128" text-anchor="middle" fill="${C.bg}">✓ PICKED</text></g>`);
      o.push(`<g class="sd-actC"><rect x="${mid - 40}" y="112" width="80" height="22" rx="11" fill="${C.green}"/><text class="sd-pill" style="font-size:12px" x="${mid}" y="127" text-anchor="middle" fill="${C.bg}">ACTIVE</text></g>`);
    } else {
      o.push(`<g class="sd-mk"><text class="sd-pill" style="font-size:13px" x="${mid}" y="140" text-anchor="middle" fill="${C.blue}">✓ eligible</text></g>`);
    }
    o.push(`<text class="sd-h" x="${mid}" y="476" text-anchor="middle">${esc(fit(c.name, PITCH - 20, W_BOLD16))}</text>`);
    o.push(`<text class="sd-s" x="${mid}" y="495" text-anchor="middle" style="fill:${C.fg}">${esc(`${c.value}%`)}</text>`);
    if (c.note) wrap(c.note, PITCH - 12, W_REG13, 2).forEach((ln, k) => o.push(`<text class="sd-s" x="${mid}" y="${512 + k * 15}" text-anchor="middle">${esc(ln)}</text>`));
  });

  o.push(`<text class="sd-head" x="${PANEL}" y="160">${esc(fit(m.panelLabel || 'HOW IT DECIDES', 280, 9))}</text>`);
  steps.forEach((s, i) => {
    const y = 196 + i * 72;
    o.push(`<circle cx="${PANEL + 8}" cy="${y}" r="11" fill="${[C.red, C.amber, C.green, C.blue][i]}"/><text class="sd-num" x="${PANEL + 8}" y="${y + 4}" text-anchor="middle">${i + 1}</text>`);
    o.push(`<text class="sd-h" style="font-size:14.5px" x="${PANEL + 28}" y="${y}">${esc(fit(s.title, W - PANEL - 48, 8.0))}</text>`);
    wrap(s.sub, W - PANEL - 48, W_REG13, 2).forEach((ln, k) => o.push(`<text class="sd-s" x="${PANEL + 28}" y="${y + 18 + k * 15}">${esc(ln)}</text>`));
  });
  if (m.caption) o.push(`<text class="sd-s" x="40" y="556">${esc(fit(m.caption, W - 80, W_REG13))}</text>`);
  o.push('</svg>');
  return `${o.join('\n')}\n`;
}
