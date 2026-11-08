// INV-15 / INV-18: architecture and flow are drawn as real vectors (boxes + connectors), a graph that says nothing is
// not drawn, and the four concept slots take distinct archetypes. Fixtures run through the real tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, runTool, svgOf, cleanup } from './helpers/diagram-build.mjs';

const CONCEPTS = {
  bigIdeaDiagram: { rows: [{ items: ['A', 'B', 'C'], connect: true }] },
  insightDiagram: { rows: [{ items: ['the one clever move', 'its result'], connect: true }] },
};
// 3 components, 2 internal deps (app -> core -> util) + authored rows for the two judgment diagrams
const makeFixture = () => makeBuild({ visuals: CONCEPTS });
// 0 internal edges: a dependency map here would show nothing
const makeDegenerateFixture = () => makeBuild({ nodes: ['thing', 'thing-monorepo'], edges: [], visuals: CONCEPTS });
// ruos's real shape: nodes: []
const makeZeroNodeFixture = () => makeBuild({ nodes: [], edges: [], visuals: CONCEPTS });
const runMakeDiagrams = (dir) => { const r = runTool(dir); if (r.status !== 0) { const e = new Error(r.out); e.stdout = r.stdout; e.stderr = r.stderr; throw e; } return r; };
const withVisuals = (dir, extra) => {
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  Object.assign(b.visuals, extra);
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
};

test('INV-18 — the ARCHITECTURE diagram is real vectors: one card per module and one connector per dependency, not ASCII-as-text', () => {
  const dir = makeFixture();
  try {
    runMakeDiagrams(dir);
    const svg = svgOf(dir, 'architecture.svg');
    for (const n of ['app', 'core', 'util']) assert.ok(svg.includes(`>${n}<`), `module ${n} must be drawn as a labelled card`);
    assert.equal((svg.match(/<path class="flow-line"/g) || []).length, 2, 'one connector per internal dependency (app->core, core->util)');
    assert.ok((svg.match(/<rect\b/g) || []).length >= 4, 'the background card plus a card per module');
  } finally { cleanup(dir); }
});

test('INV-18 — the PROCESS/DATA-FLOW diagram is real vectors: one card per lifecycle stage joined by arrows, not ASCII-as-text', () => {
  const dir = makeFixture();
  try {
    runMakeDiagrams(dir);
    const svg = svgOf(dir, 'flow.svg');
    for (const st of ['INSTALL', 'BUILD', 'RUN', 'VERIFY']) assert.ok(svg.includes(`>${st}<`), `stage ${st} must be drawn as a card`);
    assert.ok((svg.match(/<(path|line)\b/g) || []).length >= 3, 'the stages are joined by connectors');
    assert.ok((svg.match(/<rect\b/g) || []).length >= 5, 'the background card plus a card per stage');
  } finally { cleanup(dir); }
});

// A diagram must CARRY INFORMATION or not be drawn: an accurate picture of an empty graph is still a picture of nothing.
test('a dep-graph with 0 internal edges REFUSES to draw a dependency map (no picture of nothing)', () => {
  const dir = makeDegenerateFixture();
  assert.throws(() => runMakeDiagrams(dir), (err) => {
    const out = String(err.stdout || '') + String(err.stderr || '');
    assert.match(out, /0 internal edges|would show nothing|empty graph/i,
      'must fail LOUD, naming the empty graph — never silently render a 2-box "dependency map"');
    assert.match(out, /architectureDiagram\.rows/,
      'the failure must tell the brain exactly what to author instead (the CONCEPT of how it is built)');
    return true;
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a degenerate dep-graph WITH authored concept rows renders the concept, not an empty map', () => {
  const dir = makeDegenerateFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.architectureDiagram = {
    title: 'Four parts',
    rows: [{ items: ['your text', 'the engine', 'a small file', 'your page'], connect: true }],
  };
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'architecture.svg'), 'utf8');
  assert.ok(!/Module dependency map/.test(svg), 'must NOT fall back to the empty dependency map');
  assert.ok(!/0 internal links/.test(svg), 'must never ship the "0 internal links" caption');
  assert.match(svg, /the engine/, 'must draw the authored concept instead');
  fs.rmSync(dir, { recursive: true, force: true });
});

// A graph with no nodes has no edges: it takes the same path as the 0-edge tests above.
test('a dep-graph with ZERO nodes WITH authored concept rows renders the concept (ruos regression)', () => {
  const dir = makeZeroNodeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.architectureDiagram = {
    title: 'How it is built',
    rows: [{ items: ['protocol layer', 'control tools', 'desktop executor', 'agent stack'], connect: true }],
  };
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  try {
    runMakeDiagrams(dir);
    const svg = fs.readFileSync(path.join(dir, 'assets', 'architecture.svg'), 'utf8');
    assert.match(svg, /desktop executor/, 'must draw the authored concept');
    assert.ok(!/Module dependency map/.test(svg), 'must NOT draw an empty dependency map');
    assert.ok(!/0 modules|0 internal links/.test(svg), 'must never ship a "0 modules" caption');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a dep-graph with ZERO nodes and NO authored rows still fails LOUD, naming what to author', () => {
  const dir = makeZeroNodeFixture();
  try {
    assert.throws(() => runMakeDiagrams(dir), (err) => {
      const out = String(err.stdout || '') + String(err.stderr || '');
      assert.match(out, /architectureDiagram\.rows/,
        'relaxing the guard must not let a zero-node repo through with an invented diagram');
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The hero animation is PER-REPO content: never a constant borrowed from another repo.
test('no visuals.heroAnim => NO animation is emitted (never another repo\'s)', () => {
  const dir = makeFixture();                       // fixture has no heroAnim
  runMakeDiagrams(dir);
  assert.ok(!fs.existsSync(path.join(dir, 'assets', 'refusal.svg')),
    'a repo that authored no heroAnim must get NO animation band — never a borrowed one');
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.ok(!b.visuals.heroAnim, 'must not invent a heroAnim slot');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the hero animation renders THIS repo\'s authored content, with no ternlight residue', () => {
  const dir = makeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.heroAnim = {
    label: 'Before',
    chips: [
      { before: 'slow', after: 'fast', op: 'cached', kind: 'pos' },
      { before: 'big', after: 'small', op: 'trimmed', kind: 'neg' },
      { before: 'noisy', after: 'quiet', op: 'dropped', kind: 'zero' },
    ],
    verdict: { label: 'The cost it kills', symbol: '×', dead: 'never paid' },
    kicker: 'this repo does not do the expensive thing',
  };
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'refusal.svg'), 'utf8');
  assert.match(svg, /this repo does not do the expensive thing/, 'renders the authored kicker');
  assert.match(svg, /cached/, 'renders the authored ops');
  for (const leak of ['0.0731', 'never multiplies', '4.6 MB', 'ternlight']) {
    assert.ok(!svg.includes(leak), `ternlight residue leaked into another repo's animation: "${leak}"`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// A repo where several slots draw as concept diagrams must not show one visual form repeatedly (INV-23).
// 0 internal edges -> architecture draws as a concept; authored flow rows -> flow does too. All four slots render
// via renderConcept and must NOT share a form.
const chain = (items) => ({ rows: [{ items, connect: true }] });
const makeAllConceptFixture = () => makeBuild({ nodes: ['a', 'b'], edges: [], repoName: 'fourforms', visuals: {
  architectureDiagram: chain(['outer layer', 'middle layer', 'inner core']),
  flowDiagram: chain(['input', 'transform', 'output']),
  bigIdeaDiagram: chain(['idea A', 'idea B', 'idea C']),
  insightDiagram: chain(['the move', 'result one', 'result two']),
} });

test('the four concept slots render as DISTINCT archetypes (no shared vertical-card form)', () => {
  const dir = makeAllConceptFixture();
  runMakeDiagrams(dir);
  const arch = {};
  for (const [file, key] of [['architecture', 'architectureDiagram'], ['flow', 'flowDiagram'], ['big-idea', 'bigIdeaDiagram'], ['insight', 'insightDiagram']]) {
    const svg = fs.readFileSync(path.join(dir, 'assets', `${file}.svg`), 'utf8');
    const m = /concept archetype: (\w+)/.exec(svg);
    assert.ok(m, `${file}.svg must declare a concept archetype (the renderer used renderConcept)`);
    arch[key] = m[1];
  }
  assert.equal(new Set(Object.values(arch)).size, 4,
    `all four concept diagrams must use DISTINCT archetypes — this is the whole fix. Got ${JSON.stringify(arch)}`);
  // Nested frames assert literal containment: architecture only gets 'strata' when its authored text claims it. This one does not.
  assert.deepEqual(arch,
    { architectureDiagram: 'orbit', flowDiagram: 'ribbon', bigIdeaDiagram: 'column', insightDiagram: 'grid' },
    'each diagram key must map to its assigned archetype');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('architecture earns nested frames (strata) only when its own text claims containment', () => {
  const dir = makeAllConceptFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.architectureDiagram.altText = 'Three layers nested inside one another, from the outer layer to the inner core.';
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'architecture.svg'), 'utf8');
  assert.equal(/concept archetype: (\w+)/.exec(svg)?.[1], 'strata');
  fs.rmSync(dir, { recursive: true, force: true });
});
