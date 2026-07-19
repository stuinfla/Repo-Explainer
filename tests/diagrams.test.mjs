// Conformance test — INV-15 (StructuralDiagramsAsSVG) + INV-18 (ArchitectureAndFlowRequired).
//
// THE keystone test. It encodes the exact failure the owner caught: make-diagrams emitted raw
// ASCII rendered as SVG <text> inside one background <rect>, NOT a real vector diagram with node
// boxes and connectors. A real diagram (post-fix, via the ascii-to-svg skill) draws node boxes
// (multiple <rect>) and/or connectors (<path>/<line>/<polyline>). This test FAILS RED against the
// current tool and turns GREEN only when make-diagrams produces genuine vectors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

// Self-contained fixture: a minimal-but-real kb extraction (3 components, 2 internal deps) +
// brain-authored ASCII for the two judgment diagrams, so make-diagrams has everything it needs.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-diag-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'app' }, { name: 'core' }, { name: 'util' }],
    internalEdges: [{ from: 'app', to: 'core' }, { from: 'core', to: 'util' }],
    componentCount: 3, internalEdgeCount: 2, ecosystems: ['node'],
    externalDepNames: ['left-pad'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({
    install: ['npm i'],
    commands: [{ category: 'build', cmd: 'npm run build' }, { category: 'test', cmd: 'npm test' }],
    binaries: [{ name: 'fixrepo' }], quickstart: ['npx fixrepo'], workspace: { kind: 'single' },
  }));
  fs.writeFileSync(path.join(kb, 'symbols.json'), JSON.stringify({ count: 10, byCrate: { core: 5 } }));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'fixrepo' },
    kb: {
      depGraphPath: path.join(kb, 'dep-graph.json'),
      entrypointsPath: path.join(kb, 'entrypoints.json'),
      symbolsPath: path.join(kb, 'symbols.json'),
    },
    visuals: {
      bigIdeaDiagram: { ascii: 'Big Idea\n[A] -> [B] -> [C]' },
      insightDiagram: { ascii: 'The Insight\nthe one clever move' },
    },
  }, null, 2));
  return dir;
}

function runMakeDiagrams(dir) {
  return execFileSync(process.execPath, [TOOL, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
}

test('INV-18 — make-diagrams renders the ARCHITECTURE diagram as REAL vectors (node boxes + connectors), not raw ASCII as <text>', () => {
  const dir = makeFixture();
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'architecture.svg'), 'utf8');

  const rects = (svg.match(/<rect\b/g) || []).length;
  const connectors = (svg.match(/<(path|line|polyline|polygon)\b/g) || []).length;
  const texts = (svg.match(/<text\b/g) || []).length;

  // ASCII-as-text == exactly ONE <rect> (the background card) + many <text> + ZERO connectors.
  // A real architecture diagram draws a box per component and a line/arrow per dependency.
  assert.ok(
    rects >= 2 || connectors >= 1,
    `architecture.svg is ASCII-as-text, not a real diagram: ${rects} <rect>, ${connectors} connectors, ${texts} <text>. ` +
    'A real diagram needs node boxes (>=2 <rect>) or connectors (<path>/<line>). This is exactly the failure the owner caught.',
  );
});

test('INV-18 — make-diagrams renders the PROCESS/DATA-FLOW diagram as REAL vectors (steps + arrows), not raw ASCII as <text>', () => {
  const dir = makeFixture();
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'flow.svg'), 'utf8');

  const rects = (svg.match(/<rect\b/g) || []).length;
  const connectors = (svg.match(/<(path|line|polyline|polygon)\b/g) || []).length;
  const texts = (svg.match(/<text\b/g) || []).length;

  assert.ok(
    rects >= 2 || connectors >= 1,
    `flow.svg is ASCII-as-text, not a real diagram: ${rects} <rect>, ${connectors} connectors, ${texts} <text>. ` +
    'A real flow diagram needs step boxes (>=2 <rect>) or arrows (<path>/<line>).',
  );
});

// ── REGRESSION: a diagram must CARRY INFORMATION or not be drawn (2026-07-12) ─────────────────────
// chalk, stronghold, agenticow AND ternlight each shipped a gorgeous, animated "N modules · 0
// internal links" — a truthful picture of an EMPTY GRAPH. "Grounded in the repo's real structure" is
// necessary, not sufficient: it is entirely possible to draw an accurate picture of nothing. The
// renderer drew whatever the graph handed it and nobody asked whether the graph SAID anything.
function makeDegenerateFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-degen-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'thing' }, { name: 'thing-monorepo' }],
    internalEdges: [],                       // <- 0 edges: a dependency map here shows NOTHING
    componentCount: 2, internalEdgeCount: 0, ecosystems: ['rust'],
    externalDepNames: ['libm'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({
    install: ['cargo build'], commands: [{ category: 'test', cmd: 'cargo test' }],
    binaries: [], quickstart: [], workspace: { kind: 'single' },
  }));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'thing' },
    kb: { depGraphPath: path.join(kb, 'dep-graph.json'), entrypointsPath: path.join(kb, 'entrypoints.json') },
    visuals: {
      bigIdeaDiagram: { ascii: 'Big Idea\n[A] -> [B]' },
      insightDiagram: { ascii: 'The Insight\nclever' },
    },
  }, null, 2));
  return dir;
}

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

// ── REGRESSION: the hero animation is PER-REPO and must never be borrowed (2026-07-12) ────────────
// For about twenty minutes the animation's content (ternlight's own ternary weights, "it never
// multiplies", "4.6 MB") was a CONSTANT inside make-diagrams — which would have stapled ternlight's
// animation onto every other repo's hero. Same class of defect as shipping a lookalike repo.
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

// ── REGRESSION: the four concept slots must render as DISTINCT archetypes (2026-07-18) ─────────────
// Before this, EVERY concept-rendered diagram drew ONE vertical card-column. On a repo where multiple
// slots demote to concept (bissanmu/spring3-legacy-web: flow + big-idea + insight all did), three
// diagrams shared one visual form and the imagery-craft grade fell below the ship-bar floor (B5 58/60
// < 70), so deploy.mjs refused to publish a fully-built page. Each key now owns a distinct archetype:
// column (bigIdea) · ribbon (flow) · orbit (insight) · strata (architecture).
function makeAllConceptFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-forms-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  // 0 internal edges -> architecture demotes to concept; entrypoints present + authored flow rows ->
  // flow demotes to concept too. So all four slots render via renderConcept and must NOT share a form.
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'a' }, { name: 'b' }], internalEdges: [],
    componentCount: 2, internalEdgeCount: 0, ecosystems: ['node'],
    externalDepNames: ['dep'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({
    install: ['npm i'], commands: [{ category: 'build', cmd: 'npm run build' }],
    binaries: [{ name: 'x' }], quickstart: ['npx x'], workspace: { kind: 'single' },
  }));
  const chain = (items) => ({ rows: [{ items, connect: true }] });
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'fourforms' },
    kb: { depGraphPath: path.join(kb, 'dep-graph.json'), entrypointsPath: path.join(kb, 'entrypoints.json') },
    visuals: {
      architectureDiagram: chain(['outer layer', 'middle layer', 'inner core']),
      flowDiagram: chain(['input', 'transform', 'output']),
      bigIdeaDiagram: chain(['idea A', 'idea B', 'idea C']),
      insightDiagram: chain(['the move', 'result one', 'result two']),
    },
  }, null, 2));
  return dir;
}

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
  assert.deepEqual(arch,
    { architectureDiagram: 'strata', flowDiagram: 'ribbon', bigIdeaDiagram: 'column', insightDiagram: 'orbit' },
    'each diagram key must map to its assigned archetype');
  fs.rmSync(dir, { recursive: true, force: true });
});
