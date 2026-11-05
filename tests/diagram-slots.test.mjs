// tests/diagram-slots.test.mjs — what make-diagrams draws per slot, and that the words describe the picture.
// Each test runs the real tool on a fixture build dir. Every one fails on the pre-3.0.1 tool (see the 3.0.1 review, R1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, runTool, visualsOf, svgOf, cleanup, chain, CONCEPT_SLOTS } from './helpers/diagram-build.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

const names = (n) => Array.from({ length: n }, (_, i) => `mod${i}`);
const star = (ns) => ns.slice(1).map((x) => [x, ns[0]]);     // everything depends on mod0
const has = (svg, label) => svg.includes(`>${label}<`);
const CLONE = {
  'README.md': 'Works with both the Claude Code CLI and the VS Code extension.\n',
  'src/claude_swap/autoswitch.py': '    if h - active_headroom < settings.hysteresis_pct:\n        continue\n',
};

test('radial architecture draws EVERY module it counts (12 modules -> 12 cards, not 10)', () => {
  const ns = names(12);
  const dir = makeBuild({ nodes: ns, edges: star(ns), visuals: CONCEPT_SLOTS });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const svg = svgOf(dir, 'architecture.svg');
    const missing = ns.filter((n) => !has(svg, n));
    assert.deepEqual(missing, [], `modules counted in the caption but not drawn: ${missing}`);
    assert.match(svg, />12 modules · 11 internal links/);
    // 11 spokes: one per real dependency edge (the dropped nodes took their edges with them before)
    assert.equal((svg.match(/<path class="flow-line"/g) || []).length, 11);
  } finally { cleanup(dir); }
});

test('radial architecture over the cap says exactly which modules it kept — and draws exactly those', () => {
  const ns = names(20);
  const dir = makeBuild({ nodes: ns, edges: star(ns), visuals: CONCEPT_SLOTS });
  try {
    assert.equal(runTool(dir).status, 0);
    const svg = svgOf(dir, 'architecture.svg');
    assert.match(svg, /20 modules · 19 internal links.*showing the 12 most-connected/);
    assert.equal(ns.filter((n) => has(svg, n)).length, 12, 'the caption promises 12 and the picture must hold 12');
  } finally { cleanup(dir); }
});

test('radial satellites are ordered by dependent count, most depended-on first', () => {
  // core has 4 dependents (hub); b has 2, c has 1; a, x, y, z have none
  const edges = [['a', 'core'], ['x', 'core'], ['y', 'core'], ['z', 'core'], ['x', 'b'], ['y', 'b'], ['z', 'c']];
  const dir = makeBuild({ nodes: ['core', 'b', 'c', 'a', 'x', 'y', 'z'], edges, visuals: CONCEPT_SLOTS });
  try {
    assert.equal(runTool(dir).status, 0);
    const svg = svgOf(dir, 'architecture.svg');
    const at = (n) => svg.indexOf(`>${n}<`);
    const order = ['b', 'c', 'x', 'y', 'z', 'a'];     // by dependents, then total links, then name
    for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) > 0 && at(order[i - 1]) < at(order[i]), `${order[i - 1]} must be drawn before ${order[i]}`);
  } finally { cleanup(dir); }
});

test('grounded architecture: the <desc> and the recorded altText describe the hub map that was drawn, not the brain\'s concept rows', () => {
  const brainAlt = 'Three conceptual parts: tokenizer, engine, output';
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, architectureDiagram: { altText: brainAlt, rows: [{ items: ['tokenizer', 'engine', 'output'], connect: true }] } } });
  try {
    assert.equal(runTool(dir).status, 0);
    const v = visualsOf(dir).architectureDiagram;
    assert.equal(v.form, 'radial');
    const svg = svgOf(dir, 'architecture.svg');
    const desc = /<desc id="dg-architecture-desc">([^<]*)<\/desc>/.exec(svg)[1];
    for (const text of [desc, v.altText]) {
      assert.doesNotMatch(text, /tokenizer|conceptual parts/);
      assert.match(text, /hub with the other modules around it/);
      assert.match(text, /core, the core module the most others depend on, sits in the middle/);
      assert.doesNotMatch(text, /layered|top entry points down/, 'the old tier-stack wording is gone');
    }
  } finally { cleanup(dir); }
});

test('a verified systemMap draws even when the graph has 0 edges and the brain authored NO architecture rows', () => {
  const dir = makeBuild({ nodes: ['a', 'b'], edges: [], visuals: { ...CONCEPT_SLOTS, systemMap: SYSTEM_MAP }, clone: CLONE });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, `must not die before the story is considered: ${r.out}`);
    const v = visualsOf(dir).architectureDiagram;
    assert.equal(v.form, 'systemMap');
    assert.match(svgOf(dir, 'architecture.svg'), /What claude-swap plugs into/);
  } finally { cleanup(dir); }
});

test('0 edges and NO rows and NO verified story still fails loud, naming what to author', () => {
  const dir = makeBuild({ nodes: ['a', 'b'], edges: [], visuals: CONCEPT_SLOTS });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 1);
    assert.match(r.out, /architectureDiagram\.rows/);
  } finally { cleanup(dir); }
});

test('a library repo (no entrypoints) with a verified decision still draws it in the flow slot', () => {
  const dir = makeBuild({ entrypoints: false, visuals: { ...CONCEPT_SLOTS, decision: DECISION }, clone: CLONE });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const v = visualsOf(dir);
    assert.equal(v.flowDiagram.form, 'decision', 'the story must not be skipped just because there is no lifecycle');
    assert.match(svgOf(dir, 'flow.svg'), /The moment claude-swap switches you/);
    const forms = ['architectureDiagram', 'flowDiagram', 'bigIdeaDiagram', 'insightDiagram'].map((k) => v[k].form);
    assert.equal(new Set(forms).size, 4, `forms must stay pairwise distinct: ${forms}`);
  } finally { cleanup(dir); }
});

test('a library repo whose decision cannot be verified draws no flow diagram at all', () => {
  const bad = { ...DECISION, rule: { file: 'src/claude_swap/autoswitch.py', quote: 'a line that is not in the file' } };
  const dir = makeBuild({ entrypoints: false, visuals: { ...CONCEPT_SLOTS, decision: bad }, clone: CLONE });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    assert.equal(visualsOf(dir).flowDiagram, undefined);
    assert.match(r.stderr, /decision dropped: quote not found/);
  } finally { cleanup(dir); }
});

test('authored flow rows that are all blank are not "authored": the lifecycle is drawn instead of dying', () => {
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, flowDiagram: { rows: [{ items: ['', '  '], connect: true }] } } });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    assert.equal(visualsOf(dir).flowDiagram.form, 'vertical-stack');
    assert.match(svgOf(dir, 'flow.svg'), /LIFECYCLE/);
  } finally { cleanup(dir); }
});

test('a big-idea authored only as legacy .ascii is refused (rows are the only source)', () => {
  const dir = makeBuild({ visuals: { bigIdeaDiagram: { ascii: 'Big Idea\n[First] -> [Second] -> [Third]' }, insightDiagram: chain(['x', 'y', 'z']) } });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /missing structure for bigIdeaDiagram: .*visuals\.bigIdeaDiagram\.rows/);
  } finally { cleanup(dir); }
});
