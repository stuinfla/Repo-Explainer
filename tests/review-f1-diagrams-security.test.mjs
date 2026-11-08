// F1 fix round: palette/href injection, over-long phone labels, symlink escape, and the legibility guards, each driven
// through the real tool (or the real exported guard) so that disabling the guard turns the test red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeBuild, runTool, visualsOf, svgOf, cleanup, CONCEPT_SLOTS } from './helpers/diagram-build.mjs';
import { makeBuild as makePage, assemble, cleanup as cleanupPage } from './helpers/assemble-fixture.mjs';
import { SYSTEM_MAP } from './fixtures/story-claude-swap.mjs';
import { makeRepoReaders } from '../tools/diagrams/story.mjs';
import { legibilityDefects, drawMobileChecked, textOutsideCanvas, findTextOverlaps } from '../tools/diagrams/legibility.mjs';
import { validateSystemMap, validateDecision } from '../src/story-diagrams.mjs';
import { DECISION } from './fixtures/story-claude-swap.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const CLONE = {
  'README.md': 'Works with both the Claude Code CLI and the VS Code extension.\n',
  'src/claude_swap/autoswitch.py': '    if h - active_headroom < settings.hysteresis_pct:\n        continue\n',
};
const withPalette = (dir, palette) => {
  const p = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  b.concept = { palette };
  fs.writeFileSync(p, JSON.stringify(b));
};

// ── set8 D1: a brain-authored palette value must never reach an attribute as markup ─────────────────────────────
test('make-diagrams: a palette accent carrying an attribute payload is dropped, never written into any SVG', () => {
  const dir = makeBuild({ visuals: CONCEPT_SLOTS });
  try {
    withPalette(dir, { accent: '#fff" onmouseover="alert(document.domain)', 'accent-2': 'red" onload="x' });
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const files = fs.readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.svg'));
    assert.ok(files.length >= 8, `expected the wide + phone twins, got ${files.length}`);
    for (const f of files) {
      const svg = svgOf(dir, f);
      assert.doesNotMatch(svg, /onmouseover|onload|alert\(/i, `${f} carries the injected handler`);
    }
  } finally { cleanup(dir); }
});

test('make-diagrams: a valid 3-digit hex palette still themes the diagrams (the sanitiser does not swallow real colours)', () => {
  const dir = makeBuild({ visuals: CONCEPT_SLOTS });
  try {
    withPalette(dir, { accent: '#f0a' });
    assert.equal(runTool(dir).status, 0);
    assert.match(svgOf(dir, 'architecture.svg'), /#ff00aa/i);
  } finally { cleanup(dir); }
});

test('assemble-page: a palette value with a double quote is refused', () => {
  const dir = makePage({ mutate: (c) => { c.concept.palette.accent = '#4be3c8" onmouseover="alert(1)'; } });
  try {
    const r = assemble(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /disallowed value/);
  } finally { cleanupPage(dir); }
});

// ── set7 D1: hero CTA hrefs ─────────────────────────────────────────────────────────────────────────────────────
test('assemble-page: javascript:/data: CTA hrefs become "#", web/in-page/mailto links survive', () => {
  const ctas = [
    { label: 'a', href: 'javascript:alert(document.domain)' },
    { label: 'b', href: ' JaVaScRiPt:alert(1)' },
    { label: 'c', href: 'data:text/html,<script>1</script>' },
    { label: 'd', href: '//evil.example/x' },
    { label: 'e', href: 'https://example.com/ok' },
    { label: 'f', href: '#how-it-works' },
    { label: 'g', href: 'mailto:a@b.co' },
  ];
  const dir = makePage({ mutate: (c) => { c.content.sections.hero.ctas = ctas; } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.html, /javascript:/i);
    assert.doesNotMatch(r.html, /href="data:/i);
    assert.doesNotMatch(r.html, /href="\/\/evil/);
    const hrefs = [...r.html.matchAll(/<a class="cta[^"]*" href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs.slice(0, 7), ['#', '#', '#', '#', 'https://example.com/ok', '#how-it-works', 'mailto:a@b.co']);
  } finally { cleanupPage(dir); }
});

// ── set8 D2: a long wire-tag token must not take down the build ─────────────────────────────────────────────────
test('flow phone twin: very long binary names are clipped like the desktop pill, not a FATAL "label leaves the canvas"', () => {
  const dir = makeBuild({ visuals: CONCEPT_SLOTS });
  try {
    fs.writeFileSync(path.join(dir, 'kb', 'entrypoints.json'), JSON.stringify({
      binaries: [{ name: 'create-my-really-long-app' }, { name: 'another-long-cli-name' }],
    }));
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    assert.match(svgOf(dir, 'flow.m.svg'), /bin: create-my-really…/);
  } finally { cleanup(dir); }
});

// ── set5 D2/D3: story labels the phone canvas cannot hold are refused up front, not FATAL at draw time ─────────
test('systemMap: a 45-char inputs.label / outputs.label and a non-string runsOn are rejected by the validator', () => {
  assert.deepEqual(validateSystemMap(clone(SYSTEM_MAP)), []);
  const long = 'X'.repeat(45);
  let m = clone(SYSTEM_MAP); m.inputs.label = long;
  assert.match(validateSystemMap(m).join(';'), /inputs\.label must be 1–30/);
  m = clone(SYSTEM_MAP); m.outputs.label = long;
  assert.match(validateSystemMap(m).join(';'), /outputs\.label must be 1–30/);
  m = clone(SYSTEM_MAP); m.worksWith.runsOn = [42];
  assert.match(validateSystemMap(m).join(';'), /runsOn must be 1–5 strings/);
  m = clone(SYSTEM_MAP); m.worksWith.runsOn = Array(6).fill('mac');
  assert.match(validateSystemMap(m).join(';'), /runsOn/);
  const d = clone(DECISION); d.panelLabel = long;
  assert.match(validateDecision(d).join(';'), /panelLabel must be 1–30/);
});

test('make-diagrams: a systemMap with an over-long label falls back to the grounded diagram (exit 0), it does not die', () => {
  const bad = clone(SYSTEM_MAP); bad.inputs.label = 'X'.repeat(45);
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, systemMap: bad }, clone: CLONE });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stderr, /systemMap rejected: .*inputs\.label must be 1–30/);
    assert.equal(visualsOf(dir).architectureDiagram.form, 'radial');
  } finally { cleanup(dir); }
});

// ── set8 D3: the hero phone twin goes through the same overlap/off-canvas check as every other twin ─────────────
test('hero refusal phone twin: a verdict label wider than the phone canvas fails the build (it used to ship clipped)', () => {
  const heroAnim = { label: 'Before', verdict: { label: 'A'.repeat(70), symbol: '×', dead: 'never paid' }, kicker: 'k',
    chips: [{ before: '0.5', after: '0', op: 'skip', kind: 'zero' }, { before: '-0.4', after: '-1', op: 'negate', kind: 'neg' }, { before: '0.91', after: '+1', op: 'add', kind: 'pos' }] };
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim } });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /heroAnim: the phone layout still fails .*label leaves the canvas/);
  } finally { cleanup(dir); }
});

test('hero refusal phone twin: the intended before/after swap in one spot is NOT reported as an overlap', () => {
  const heroAnim = { label: 'Before', verdict: { label: 'Cost', symbol: '×', dead: 'never paid' }, kicker: 'k',
    chips: [{ before: '0.07', after: '0', op: 'skip', kind: 'zero' }, { before: '-0.4', after: '-1', op: 'negate', kind: 'neg' }, { before: '0.91', after: '+1', op: 'add', kind: 'pos' }] };
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim } });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    assert.ok(visualsOf(dir).heroAnim.mobileLabelPx >= 11);
  } finally { cleanup(dir); }
});

// ── set8 WEAK: the guards themselves, exercised on markup that violates them ────────────────────────────────────
const svgWith = (texts, W = 360) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 200">${texts.join('')}</svg>`;
const T = (x, y, s, size = 14) => `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif">${s}</text>`;

test('legibility guard: text under the 11px phone floor, overlapping labels and labels off the canvas are each reported', () => {
  const small = legibilityDefects(svgWith([T(10, 20, 'tiny', 9)]));
  assert.match(small.join(';'), /smallest text is 7\.8px on a phone \(floor 11px\)/);
  const overlap = legibilityDefects(svgWith([T(10, 50, 'first label here'), T(20, 52, 'second label here')]));
  assert.match(overlap.join(';'), /labels overlap: "first label here" \/ "second label here"/);
  assert.deepEqual(findTextOverlaps(svgWith([T(10, 50, 'first label here'), T(10, 120, 'second label here')])), []);
  const off = legibilityDefects(svgWith([T(200, 50, 'this label runs far past the right edge')]));
  assert.match(off.join(';'), /label leaves the canvas: "this label runs far past the right edge"/);
  assert.deepEqual(textOutsideCanvas(svgWith([T(10, 50, 'fits')])), []);
  assert.deepEqual(legibilityDefects(svgWith([T(10, 50, 'fits fine', 14)])), []);
});

test('legibility guard: drawMobileChecked re-flows once, then throws naming the defect; a clean first pass is accepted', () => {
  const calls = [];
  const bad = svgWith([T(200, 50, 'this label runs far past the right edge')]);
  assert.throws(() => drawMobileChecked('x', (s) => { calls.push(s); return bad; }), /x: the phone layout still fails after the corrective re-flow — label leaves the canvas/);
  assert.deepEqual(calls, [1, 0.88]);
  const seen = [];
  const r = drawMobileChecked('y', (s) => { seen.push(s); return s === 1 ? bad : svgWith([T(10, 50, 'fits fine')]); });
  assert.equal(r.pass, 2);
  assert.deepEqual(seen, [1, 0.88]);
});

test('make-diagrams: colliding module labels on the wide dependency map stop the build (strict overlap die)', () => {
  const ns = Array.from({ length: 3 }, (_, i) => `a-very-long-module-name-number-${i}-extra`);
  const dir = makeBuild({ nodes: ns, edges: ns.slice(1).map((x) => [x, ns[0]]), visuals: CONCEPT_SLOTS });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /architectureDiagram: labels overlap on the dependency map/);
  } finally { cleanup(dir); }
});

// ── owner Q: the story reader must not follow a symlink out of the clone ───────────────────────────────────────
test('story reader: a symlink inside the clone that points outside it reads as null; a real file and an in-clone link still read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-sym-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-out-'));
  try {
    const root = path.join(dir, 'clone');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET-LINE\n');
    fs.writeFileSync(path.join(root, 'real.txt'), 'real line\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    fs.symlinkSync('real.txt', path.join(root, 'inside.txt'));
    const rd = makeRepoReaders({ repo: { clonePath: root } }, dir);
    assert.equal(rd.read('real.txt'), 'real line\n');
    assert.equal(rd.read('inside.txt'), 'real line\n');
    assert.equal(rd.read('leak.txt'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
