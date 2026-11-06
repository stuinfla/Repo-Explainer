// tests/story-diagrams.test.mjs — the system-map and decision diagram renderers (ADR-0014).
//
// The reference models below describe claude-swap (realiti4/claude-swap, read from its README and
// src/claude_swap/autoswitch.py + settings.py on 2026-10-10). They are the two graphics the owner
// signed off as "the level and style I want", expressed as data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fit, wrap, renderSystemMap, renderDecision, validateSystemMap, validateDecision, verifySystemMap, verifyDecision,
} from '../src/story-diagrams.mjs';
import { renderSystemMapMobile, renderDecisionMobile } from '../src/story-diagrams-mobile.mjs';
import { fontSizes, canvasWidth, cssOf } from './helpers/diagram-svg.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));

function xmllintOk(svg) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')), 'x.svg');
  fs.writeFileSync(f, svg);
  try { execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); return true; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

for (const [name, render, model] of [['system map', renderSystemMap, SYSTEM_MAP], ['decision', renderDecision, DECISION]]) {
  test(`${name}: renders well-formed, script-free, self-contained SVG`, () => {
    const svg = render(model);
    const ok = xmllintOk(svg);
    if (ok !== null) assert.equal(ok, true, 'xmllint must accept it');
    assert.match(svg, /^<svg id="sd-(map|decision)" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<script|foreignObject|href="https?:|<image/i);
    assert.match(svg, /<title id="sd-t">/);
    assert.match(svg, /<desc id="sd-d">/);
  });

  test(`${name}: motion is gated on prefers-reduced-motion`, () => {
    const svg = render(model);
    assert.match(svg, /@media \(prefers-reduced-motion: no-preference\)/);
    // strip every @media (...) { ... } block with real brace matching, then no animation may remain
    let out = svg, at;
    while ((at = out.indexOf('@media')) !== -1) {
      let i = out.indexOf('{', at), depth = 0;
      for (; i < out.length; i++) { if (out[i] === '{') depth++; else if (out[i] === '}' && --depth === 0) break; }
      out = out.slice(0, at) + out.slice(i + 1);
    }
    assert.doesNotMatch(out.replace(/@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, ''), /animation:/);
  });
}

test('system map: states what it works with, including the recorded "no"', () => {
  const svg = renderSystemMap(SYSTEM_MAP);
  assert.match(svg, /✓ Claude Code CLI/);
  assert.match(svg, /✓ VS Code extension/);
  assert.match(svg, /✕ Codex/);
  assert.match(svg, /not mentioned anywhere in the README or source/);
  assert.match(svg, /Linux \/ WSL/);
  assert.match(svg, /cswap menubar/);
});

test('system map: GUARD — a claim the tool cannot check is refused, not drawn', () => {
  const m = clone(SYSTEM_MAP);
  delete m.worksWith.items[0].quote;
  assert.throws(() => renderSystemMap(m), /needs file \+ quote/);
  const m2 = clone(SYSTEM_MAP);
  delete m2.worksWith.items[2].terms;
  assert.throws(() => renderSystemMap(m2), /terms required for a "no"/);
});

// A tiny in-memory "repo" for the verifier.
const REPO = {
  'README.md': 'Multi-account switcher for Claude Code.\n\nWorks with both the Claude Code CLI and the VS Code extension.\n',
  'src/claude_swap/autoswitch.py': '    if h - active_headroom < settings.hysteresis_pct:\n        continue\n',
};
const read = (f) => (f in REPO ? REPO[f] : null);
const search = (terms) => Object.entries(REPO).flatMap(([file, txt]) => txt.split('\n')
  .map((l, i) => ({ file, line: i + 1, l })).filter(({ l }) => terms.some((t) => l.toLowerCase().includes(t.toLowerCase()))));

test('verify: real quotes survive; a "no" with zero mentions is a recorded measurement', () => {
  const { model, notes } = verifySystemMap(SYSTEM_MAP, { read, search });
  assert.equal(notes.length, 0, notes.join('; '));
  assert.equal(model.worksWith.items.length, 3);
  assert.match(model.worksWith.items[2].evidence, /searched codex .*: 0 matches/);
});

test('verify: GUARD — a fabricated quote is dropped, never drawn', () => {
  const m = clone(SYSTEM_MAP);
  m.worksWith.items[0].quote = 'Seamlessly integrates with every IDE on earth';
  const { model, notes } = verifySystemMap(m, { read, search });
  assert.equal(model.worksWith.items.some((x) => x.name === 'Claude Code CLI'), false);
  assert.ok(notes.some((n) => /quote not found/.test(n)));
});

test('verify: GUARD — a "no" is dropped when the repo DOES mention the term', () => {
  const m = clone(SYSTEM_MAP);
  m.worksWith.items[2].terms = ['claude code'];
  const { model, notes } = verifySystemMap(m, { read, search });
  assert.equal(model.worksWith.items.some((x) => x.name === 'Codex'), false);
  assert.ok(notes.some((n) => /claimed no support but/.test(n)));
});

test('verify: GUARD — a claim naming an unreadable file is dropped', () => {
  const m = clone(SYSTEM_MAP);
  m.worksWith.items[1].file = 'docs/does-not-exist.md';
  const { notes } = verifySystemMap(m, { read, search });
  assert.ok(notes.some((n) => /file unreadable/.test(n)));
});

test('verify decision: the rule must really be in the named file', () => {
  assert.equal(verifyDecision(DECISION, { read }).ok, true);
  const m = clone(DECISION);
  m.rule.quote = 'if account.is_best(): return True';
  assert.equal(verifyDecision(m, { read }).ok, false);
});

test('system map: GUARD — unknown status and wrong counts are refused', () => {
  const m = clone(SYSTEM_MAP);
  m.worksWith.items[1].status = 'probably';
  assert.ok(validateSystemMap(m).some((e) => /status must be/.test(e)));
  const m2 = clone(SYSTEM_MAP);
  m2.engine.steps = [m2.engine.steps[0]];
  assert.ok(validateSystemMap(m2).some((e) => /engine\.steps/.test(e)));
});

test('decision: shows a real choice — threshold, qualify line, skipped and picked', () => {
  const svg = renderDecision(DECISION);
  assert.match(svg, />90%<\/text>/);
  assert.match(svg, />switch point<\/text>/);
  assert.match(svg, /83% to qualify/);
  assert.match(svg, /✕ skipped/);
  assert.match(svg, /✓ PICKED/);
  assert.match(svg, /✓ eligible/);
  assert.match(svg, /class="sd-arc"/, 'handoff arc from active to picked');
});

test('decision: reduced-motion still tells the whole story (static state = the END)', () => {
  const svg = renderDecision(DECISION);
  const base = svg.slice(svg.indexOf('<style>'), svg.indexOf('@media (prefers-reduced-motion'));
  assert.doesNotMatch(base, /\.sd-arc\s*\{[^}]*stroke-dashoffset/, 'the arc is never dash-offset: it is simply drawn (opacity is its only animation)');
  assert.match(base, /\.sd-ring \{ opacity: 1; \}/, 'pick ring visible');
});

test('decision: bars are drawn to scale (a 34% bar is shorter than a 93% bar by 59 points)', () => {
  const svg = renderDecision(DECISION);
  const h = (fill) => Number(new RegExp(`height="([\\d.]+)" rx="7" fill="${fill}"`).exec(svg)[1]);
  const red = h('#f85149'), green = h('#3fb950');
  assert.ok(Math.abs((red - green) - 59 * 3) < 0.6, `expected ~177px difference, got ${red - green}`);
});

test('decision: GUARD — no decision without the source rule it came from', () => {
  const m = clone(DECISION);
  delete m.rule;
  assert.throws(() => renderDecision(m), /rule: \{file, quote\} required/);
});

test('decision: GUARD — values outside 0–100 and two picks are refused', () => {
  const m = clone(DECISION);
  m.candidates[0].value = 140;
  assert.ok(validateDecision(m).some((e) => /0–100/.test(e)));
  const m2 = clone(DECISION);
  m2.candidates[1].status = 'picked';
  assert.ok(validateDecision(m2).some((e) => /at most one picked/.test(e)));
});

test('decision: GUARD — threshold and qualify lines must sit on the 0–100 gauge, not off it', () => {
  for (const bad of [140, -5, 100.5]) {
    const m = clone(DECISION);
    m.threshold.value = bad;
    assert.ok(validateDecision(m).some((e) => /threshold/.test(e)), `threshold ${bad} must be refused`);
    assert.throws(() => renderDecision(m), /threshold/);
    const q = clone(DECISION);
    q.qualify.value = bad;
    assert.ok(validateDecision(q).some((e) => /qualify\.value must be 0–100/.test(e)), `qualify ${bad} must be refused`);
  }
  for (const edge of [0, 100]) {   // the gauge's own ends are legal
    const m = clone(DECISION);
    m.threshold.value = edge;
    m.qualify = { value: edge, label: 'to qualify' };
    assert.deepEqual(validateDecision(m), []);
  }
  const none = clone(DECISION);
  none.qualify = null;
  assert.deepEqual(validateDecision(none), [], 'qualify is optional');
});

test('fit: never lets a label exceed its box — truncates with an ellipsis', () => {
  const long = 'A very long label that would otherwise run straight out of its card and over a neighbour';
  const out = fit(long, 120, 7);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= Math.floor(120 / 7), `got ${out.length} chars`);
  assert.equal(fit('short', 120, 7), 'short');
});

test('render: a long label in the model is truncated in the output, not overflowed', () => {
  const m = clone(SYSTEM_MAP);
  m.engine.steps[1].sub = 'x'.repeat(78);
  const svg = renderSystemMap(m);
  assert.doesNotMatch(svg, /x{40,}/);
  assert.match(svg, /x+…/);
});

test('render: long text WRAPS onto a second line — cut mid-word only as a last resort', () => {
  const m = clone(SYSTEM_MAP);
  m.inputs.items[0].sub = 'OAuth tokens backed up per slot and refreshed';
  const svg = renderSystemMap(m);
  assert.doesNotMatch(svg, /OAuth tokens backed up p…/);
  assert.match(svg, />OAuth tokens backed up</);
  assert.match(svg, />per slot and refreshed</);
});

test('render: a long bold card name wraps instead of being cut', () => {
  const m = clone(SYSTEM_MAP);
  m.inputs.items[1].name = '5h / 7d usage windows';
  const svg = renderSystemMap(m);
  assert.doesNotMatch(svg, />5h \/ 7d usage win…</);
  assert.match(svg, />5h \/ 7d usage</);
  assert.match(svg, />windows</);
});

test('wrap: only the last line may be truncated, and never past maxLines', () => {
  const lines = wrap('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda', 90, 6, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(lines.every((l) => l.length <= 15));
  assert.deepEqual(wrap('short text', 200, 6, 2), ['short text']);
});

test('render: markup in model text is escaped', () => {
  const m = clone(SYSTEM_MAP);
  m.inputs.items[0].name = '<img src=x onerror=alert(1)>';
  const svg = renderSystemMap(m);
  assert.doesNotMatch(svg, /<img src=x/);
  assert.match(svg, /&lt;img/);
});

// ── the PHONE twins (drawn from the same verified model; the page swaps them in below 640px) ────────────────
for (const [name, render, model] of [['system map', renderSystemMapMobile, SYSTEM_MAP], ['decision', renderDecisionMobile, DECISION]]) {
  test(`${name} (phone): well-formed, script-free, 360 wide, no text under 13 units`, () => {
    const svg = render(model);
    const ok = xmllintOk(svg);
    if (ok !== null) assert.equal(ok, true, 'xmllint must accept it');
    assert.doesNotMatch(svg, /<script|foreignObject|href="https?:|<image/i);
    assert.equal(canvasWidth(svg), 360);
    assert.ok(Math.min(...fontSizes(svg)) >= 13, `smallest declared size ${Math.min(...fontSizes(svg))}`);
    assert.match(svg, /<svg id="sd-(map|decision)-m" /);
    assert.match(svg, /<title id="sd-(map|decision)-m-t">/);
  });

  test(`${name} (phone): motion is gated, opacity/transform only, scoped under its own id`, () => {
    const svg = render(model);
    const id = /<svg id="([^"]+)"/.exec(svg)[1];
    assert.match(svg, /@media \(prefers-reduced-motion: no-preference\)/);
    let out = svg, at;
    while ((at = out.indexOf('@media')) !== -1) {
      let i = out.indexOf('{', at), depth = 0;
      for (; i < out.length; i++) { if (out[i] === '{') depth++; else if (out[i] === '}' && --depth === 0) break; }
      out = out.slice(0, at) + out.slice(i + 1);
    }
    assert.doesNotMatch(out.replace(/@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, ''), /animation:/, 'no animation outside the no-preference block');
    for (const m of svg.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      assert.ok(m[1].startsWith(`${id}-`), `keyframes ${m[1]} must be prefixed with ${id}-`);
      assert.doesNotMatch(m[2], /stroke-dash/, `keyframes ${m[1]} may only move opacity/transform`);
    }
    for (const r of cssOf(svg).rules) for (const sel of r.selector.split(',')) assert.ok(sel.trim().startsWith(`#${id}`), `unscoped selector "${sel.trim()}"`);
  });
}

test('decision (phone): reduced-motion shows the END of the story — pick ring visible, ACTIVE overlays hidden', () => {
  const svg = renderDecisionMobile(DECISION);
  const base = svg.slice(svg.indexOf('<style>'), svg.indexOf('@media (prefers-reduced-motion'));
  assert.match(base, /#sd-decision-m \.sd-ring \{ opacity: 1; \}/);
  assert.match(base, /#sd-decision-m \.sd-act, #sd-decision-m \.sd-actC \{ opacity: 0; \}/);
  assert.match(svg, /✓ PICKED/);
});

test('system map (phone): a long unbreakable name wraps by breaking at hyphens, never an ellipsis', () => {
  const m = clone(SYSTEM_MAP);
  m.inputs.items[0].name = 'a-very-long-hyphenated-input-name-here';
  const svg = renderSystemMapMobile(m);
  assert.doesNotMatch(svg, /…/);
  assert.equal(svg.replace(/<[^>]+>/g, '').replace(/\s+/g, '').includes('a-very-long-hyphenated-input-name-here'), true);
});
