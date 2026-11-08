// tests/review-p11-mobile.test.mjs — P11: every diagram has a PHONE twin drawn from the same model; labels never collide;
// motion is scoped, transform/opacity-only and reduced-motion safe. Everything is read from the REAL tool's output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, runTool, visualsOf, svgOf, cleanup, chain, CONCEPT_SLOTS } from './helpers/diagram-build.mjs';
import { labelBoxes, overlappingLabels, cssOf, phonePx, canvasWidth } from './helpers/diagram-svg.mjs';
import { renderSystemMapMobile, renderDecisionMobile } from '../src/story-diagrams-mobile.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

// a ruvllm-like 12-module graph: real-looking names, one name with a space, one long unbreakable identifier
const NODES = ['ruvllm', 'ruvllm-core', 'MetaHarness', 'Ruflo plugin', 'ruvector-attention-wasm', 'sona', 'lora-adapters',
  'kv-cache', 'tokenizer-bpe', 'router', 'scheduler', 'bench-harness'];
const EDGES = [['ruvllm', 'ruvllm-core'], ['ruvllm', 'MetaHarness'], ['MetaHarness', 'Ruflo plugin'], ['ruvllm-core', 'sona'],
  ['ruvllm-core', 'kv-cache'], ['router', 'ruvllm-core'], ['scheduler', 'router'], ['lora-adapters', 'sona'],
  ['tokenizer-bpe', 'ruvllm-core'], ['bench-harness', 'ruvllm'], ['ruvector-attention-wasm', 'ruvllm-core'], ['Ruflo plugin', 'router']];

const CLONE = {
  'README.md': 'Works with both the Claude Code CLI and the VS Code extension.\n',
  'src/claude_swap/autoswitch.py': '    if h - active_headroom < settings.hysteresis_pct:\n        continue\n',
};
const text = (svg) => labelBoxes(svg).map((b) => b.text).join(' ');
const squash = (s) => s.replace(/\s+/g, '');

test('the overlap detector can fail: two labels on one spot are reported, two apart are not', () => {
  const mk = (b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text x="50" y="40" font-size="14">MetaHarness</text><text x="${b}" y="40" font-size="14">Ruflo plugin</text></svg>`;
  assert.deepEqual(overlappingLabels(mk(60)), [['MetaHarness', 'Ruflo plugin']]);
  assert.deepEqual(overlappingLabels(mk(250)), []);
});

test('radial architecture (12 modules): no two labels overlap, on the wide map or the phone map', () => {
  const dir = makeBuild({ nodes: NODES, edges: EDGES, visuals: CONCEPT_SLOTS, repoName: 'ruvllm' });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    for (const file of ['architecture.svg', 'architecture.m.svg']) {
      const svg = svgOf(dir, file);
      const labels = labelBoxes(svg);
      assert.ok(labels.length >= 24, `${file}: expected a label per module plus subs, got ${labels.length}`);
      assert.deepEqual(overlappingLabels(svg), [], `${file}: overlapping labels`);
      const W = canvasWidth(svg);
      for (const b of labels) assert.ok(b.x0 >= -1 && b.x1 <= W + 1, `${file}: "${b.text}" leaves the ${W}px canvas (${b.x0.toFixed(0)}..${b.x1.toFixed(0)})`);
    }
  } finally { cleanup(dir); }
});

test('radial architecture: one source of truth — every module, count and edge is on BOTH canvases', () => {
  const dir = makeBuild({ nodes: NODES, edges: EDGES, visuals: CONCEPT_SLOTS, repoName: 'ruvllm' });
  try {
    assert.equal(runTool(dir).status, 0);
    const wide = svgOf(dir, 'architecture.svg'), phone = svgOf(dir, 'architecture.m.svg');
    for (const name of ['MetaHarness', 'Ruflo plugin', 'sona', 'kv-cache', 'router', 'bench-harness']) {
      assert.ok(squash(text(wide)).includes(squash(name)), `wide lost ${name}`);
      assert.ok(squash(text(phone)).includes(squash(name)), `phone lost ${name}`);
    }
    // the 24-char identifier is broken at its hyphens on the phone (never clipped with an ellipsis)
    assert.ok(squash(text(phone)).includes('ruvector-attention-wasm'), 'long identifier must survive whole on the phone');
    assert.doesNotMatch(text(phone), /…/, 'the phone layout never truncates');
    const edges = (svg) => (svg.match(/class="flow-line"/g) || []).length;
    assert.equal(edges(wide), EDGES.length, 'wide: one spoke per real dependency');
    assert.equal(edges(phone), EDGES.length, 'phone: the same spokes');
    for (const svg of [wide, phone]) assert.match(svg, /12 modules · 12 internal links/);
    const v = visualsOf(dir).architectureDiagram;
    assert.equal(v.altText.includes('12 modules'), true);
  } finally { cleanup(dir); }
});

test('a one-satellite map with long external package names keeps the package list clear of the dep count', () => {
  const dir = makeBuild({ nodes: ['core', 'util'], edges: [['core', 'util']], visuals: CONCEPT_SLOTS });
  try {
    const bj = path.join(dir, 'kb', 'dep-graph.json');
    const dg = JSON.parse(fs.readFileSync(bj, 'utf8'));
    dg.externalDepNames = ['@modelcontextprotocol/sdk', 'better-sqlite3', 'onnxruntime-node', 'sharp', 'zod'];
    dg.externalDepCount = 41;
    fs.writeFileSync(bj, JSON.stringify(dg));
    assert.equal(runTool(dir).status, 0);
    for (const file of ['architecture.svg', 'architecture.m.svg']) {
      assert.deepEqual(overlappingLabels(svgOf(dir, file)), [], `${file}: external-packages labels overlap`);
    }
  } finally { cleanup(dir); }
});

test('wrapped (two-line) module labels do not collide with their sub-line on either canvas', () => {
  const nodes = ['core', 'Ruflo plugin metaharness bridge adapter', 'Another quite long module display name', 'util'];
  const dir = makeBuild({ nodes, edges: [['core', nodes[1]], ['core', nodes[2]], [nodes[1], 'util']], visuals: CONCEPT_SLOTS });
  try {
    assert.equal(runTool(dir).status, 0);
    for (const file of ['architecture.svg', 'architecture.m.svg']) {
      const svg = svgOf(dir, file), b = labelBoxes(svg);
      const stacked = b.filter((x, i) => b.some((y, j) => j !== i && Math.abs((x.x0 + x.x1) / 2 - (y.x0 + y.x1) / 2) < 1 && y.y0 > x.y0 && y.y0 - x.y0 < 22 && x.size >= 13));
      assert.ok(stacked.length >= 1, `${file}: the fixture must actually wrap a label onto two lines`);
      assert.deepEqual(overlappingLabels(svg), [], `${file}: overlapping labels`);
    }
  } finally { cleanup(dir); }
});

test('a 60-character unbreakable module name wraps inside its phone card instead of leaving the canvas', () => {
  const long = 'a'.repeat(30) + '-' + 'b'.repeat(29);
  const dir = makeBuild({ nodes: ['core', long, 'util'], edges: [['core', long], ['core', 'util']], visuals: CONCEPT_SLOTS });
  try {
    assert.equal(runTool(dir).status, 0);
    const svg = svgOf(dir, 'architecture.m.svg');
    for (const b of labelBoxes(svg)) assert.ok(b.x0 >= 0 && b.x1 <= 360, `"${b.text}" is outside the 360px canvas`);
    assert.ok(squash(text(svg)).includes(long), 'the whole name is still there, just wrapped');
  } finally { cleanup(dir); }
});

test('story diagrams: the phone twins carry every claim, quote-backed pill, and number of the verified model', () => {
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, systemMap: SYSTEM_MAP, decision: DECISION }, clone: CLONE });
  try {
    assert.equal(runTool(dir).status, 0);
    const map = text(svgOf(dir, 'architecture.m.svg')), dec = text(svgOf(dir, 'flow.m.svg'));
    for (const must of ['Account 1', 'Poll usage', '90% line, 10-pt margin, 5m cooldown', 'cswap menubar', '✓ Claude Code CLI', '✕ Codex',
      'not mentioned anywhere in the README or source', 'Linux / WSL', 'macOS']) assert.ok(squash(map).includes(squash(must)), `system map phone lost "${must}"`);
    for (const must of ['93%', '85%', '34%', '62%', 'switch point', '83% to qualify', 'Needs 10 pts more room than work', 'most headroom',
      '✓ PICKED', '✕ skipped', "Before the swap it refreshes the pick's token"]) assert.ok(squash(dec).includes(squash(must)), `decision phone lost "${must}"`);
    for (const svg of [svgOf(dir, 'architecture.m.svg'), svgOf(dir, 'flow.m.svg')]) {
      assert.deepEqual(overlappingLabels(svg), [], 'story phone labels overlap');
      assert.equal(canvasWidth(svg), 360);
    }
  } finally { cleanup(dir); }
});

test('story phone decision: bars are drawn to scale (34% vs 93%) and the threshold sits at 90%', () => {
  const svg = renderDecisionMobile(DECISION);
  const w = (fill) => Number(new RegExp(`width="([\\d.]+)" height="18" rx="6" fill="${fill}"`).exec(svg)[1]);
  const red = w('#f85149'), green = w('#3fb950');
  assert.ok(Math.abs((red - green) - 0.59 * 328) < 0.7, `bar widths differ by ${(red - green).toFixed(1)}, expected ${(0.59 * 328).toFixed(1)}`);
  assert.match(svg, /x1="311\.2" y1="[\d.]+" x2="311\.2"/, 'threshold tick at 16 + 0.90 x 328');
  assert.throws(() => renderDecisionMobile({ ...DECISION, rule: undefined }), /rule: \{file, quote\} required/, 'the phone renderer keeps the grounding gate');
  assert.throws(() => renderSystemMapMobile({ ...SYSTEM_MAP, worksWith: { items: [{ name: 'x', status: 'yes' }] } }), /needs file \+ quote/);
});

// ── motion: scoped, opacity/transform only, reduced-motion safe ──────────────────────────────────
function motionProblems(svg, label) {
  const bad = [];
  const id = /<svg id="([^"]+)"/.exec(svg);
  if (!id) return [`${label}: root <svg> has no id to scope under`];
  const { rules, keyframes } = cssOf(svg);
  for (const r of rules) {
    for (const sel of r.selector.split(',').map((x) => x.trim())) if (!sel.startsWith(`#${id[1]}`)) bad.push(`${label}: unscoped selector "${sel}"`);
  }
  for (const k of keyframes) {
    if (!k.name.startsWith(`${id[1]}-`)) bad.push(`${label}: keyframes "${k.name}" not prefixed with ${id[1]}-`);
    for (const p of k.props) if (!['opacity', 'transform'].includes(p)) bad.push(`${label}: keyframes "${k.name}" animates ${p}`);
  }
  const used = [...svg.matchAll(/animation\s*:\s*([\w-]+)\s/g)].map((m) => m[1]);
  for (const u of used) if (!keyframes.some((k) => k.name === u)) bad.push(`${label}: animation "${u}" has no keyframes`);
  // every animation outside a media block must be stopped by a reduced-motion rule (same specificity, later in the sheet, so it wins)
  const loose = rules.filter((r) => /animation\s*:/.test(r.decl) && !r.inNoPref && !r.inReduce);
  const stops = rules.filter((r) => r.inReduce && /animation\s*:\s*none/.test(r.decl)).map((r) => r.selector).join(',');
  const stopClasses = new Set([...stops.matchAll(/\.([\w-]+)/g)].map((m) => m[1]));
  const classLists = [...svg.matchAll(/\sclass="([^"]+)"/g)].map((m) => m[1].split(/\s+/));
  for (const r of loose) for (const sel of r.selector.split(',').map((x) => x.trim())) {
    const cls = (/\.([\w-]+)$/.exec(sel) || [])[1];
    const owners = classLists.filter((l) => l.includes(cls));
    const stopped = stops.includes(sel) || (owners.length > 0 && owners.every((l) => l.some((c) => stopClasses.has(c))));
    if (!stopped) bad.push(`${label}: "${sel}" animates with no reduced-motion stop`);
  }
  return bad;
}

test('the motion checker can fail (unscoped rule, dash-offset keyframes, no reduced-motion stop)', () => {
  const bad = '<svg id="x" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.leak { animation: spin 1s infinite; } @keyframes spin { to { stroke-dashoffset: 9; } }</style></svg>';
  const p = motionProblems(bad, 'bad').join('\n');
  assert.match(p, /unscoped selector "\.leak"/);
  assert.match(p, /keyframes "spin" not prefixed/);
  assert.match(p, /animates stroke-dashoffset/);
  assert.match(p, /no reduced-motion stop/);
});

test('every SVG the tool emits (wide, phone, story, refusal) scopes its rules, animates only opacity/transform, and honours reduced-motion', () => {
  const heroAnim = { label: 'The numbers inside the model', verdict: { label: 'The one expensive move', symbol: '×', dead: 'never used' },
    kicker: 'it never multiplies — and that is why it fits in 4.6 MB',
    chips: [{ before: '0.0731', after: '0', op: 'skip', kind: 'zero' }, { before: '-0.4', after: '-1', op: 'negate', kind: 'neg' }, { before: '0.91', after: '+1', op: 'add', kind: 'pos' }] };
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, systemMap: SYSTEM_MAP, decision: DECISION, heroAnim }, clone: CLONE });
  try {
    assert.equal(runTool(dir).status, 0);
    const files = fs.readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.svg'));
    assert.ok(files.length >= 10, `expected wide+phone for 4 slots plus the refusal pair, got ${files.join()}`);
    const ids = new Set();
    for (const f of files) {
      const svg = svgOf(dir, f);
      assert.deepEqual(motionProblems(svg, f), []);
      const id = /<svg id="([^"]+)"/.exec(svg)[1];
      assert.ok(!ids.has(id), `${f}: svg id ${id} is not unique across the page's diagrams`);
      ids.add(id);
      // shared def ids are prefixed too, so two inlined SVGs cannot capture each other's gradients and filters
      for (const m of svg.matchAll(/\sid="(bg|spot|sheen|grid|glow|glowS|cardSh)"/g)) assert.fail(`${f}: unprefixed def id ${m[1]}`);
    }
  } finally { cleanup(dir); }
});

test('refusal (inlined into the page): reduced motion settles on the END state, and the strike is a transform, not a dash-offset', () => {
  const heroAnim = { label: 'Before', verdict: { label: 'Cost', symbol: '×', dead: 'never paid' }, kicker: 'it does not pay',
    chips: [{ before: 'slow', after: 'fast', op: 'cached', kind: 'pos' }, { before: 'big', after: 'small', op: 'trimmed', kind: 'neg' }, { before: 'noisy', after: 'quiet', op: 'dropped', kind: 'zero' }] };
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim } });
  try {
    assert.equal(runTool(dir).status, 0);
    for (const f of ['refusal.svg', 'refusal.m.svg']) {
      const svg = svgOf(dir, f);
      const { rules } = cssOf(svg);
      const reduce = rules.filter((r) => r.inReduce).map((r) => `${r.selector}{${r.decl}}`).join('\n');
      assert.match(reduce, /\.dec\{opacity:0\}/, `${f}: the before-value must be gone in the static state`);
      assert.match(reduce, /\.ter,[^{]*\.op,[^{]*\.verdict,[^{]*\.kicker\{opacity:1\}/, `${f}: after-values, ops, verdict and kicker are all visible`);
      assert.doesNotMatch(svg, /stroke-dashoffset/, `${f}: no dash-offset animation`);
      const strike = rules.find((r) => /\.strike$/.test(r.selector) && !r.inReduce);
      assert.doesNotMatch(strike.decl, /opacity\s*:\s*0|scale\(0\)/, `${f}: the base strike rule must leave the line fully drawn`);
    }
    const v = visualsOf(dir).heroAnim;
    assert.ok(v.mobileSvgPath.endsWith('refusal.m.svg') && v.mobileLabelPx >= 11);
  } finally { cleanup(dir); }
});

test('refusal phone twin: a wide value drops the chips to one column instead of shrinking the text', () => {
  const heroAnim = { label: 'Before', verdict: { label: 'Cost', symbol: '×', dead: 'never paid' }, kicker: 'k',
    chips: [{ before: '0.073107310731073107', after: '0', op: 'skip', kind: 'zero' }, { before: '-0.4', after: '-1', op: 'negate', kind: 'neg' }, { before: '0.91', after: '+1', op: 'add', kind: 'pos' }] };
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim } });
  try {
    assert.equal(runTool(dir).status, 0);
    const svg = svgOf(dir, 'refusal.m.svg');
    assert.ok(phonePx(svg) >= 11);
    const xs = new Set([...svg.matchAll(/<text class="dec d\d" x="([\d.]+)"/g)].map((m) => m[1]));
    assert.equal(xs.size, 1, `one column expected, chips were centred at ${[...xs].join(', ')}`);
  } finally { cleanup(dir); }
});

test('the phone twin never says "left-to-right" under a stack that reads top to bottom; the wide twin and the alt text keep the author\'s words', () => {
  const dir = makeBuild({ visuals: { bigIdeaDiagram: chain(['front matter', 'document body', 'colophon']), insightDiagram: CONCEPT_SLOTS.insightDiagram } });
  try {
    assert.equal(runTool(dir).status, 0);
    assert.match(text(svgOf(dir, 'big-idea.svg')), /left-to-right handoff/);
    assert.doesNotMatch(text(svgOf(dir, 'big-idea.m.svg')), /left-to-right/);
    assert.match(text(svgOf(dir, 'big-idea.m.svg')), /top-to-bottom handoff: front matter/);
    assert.match(visualsOf(dir).bigIdeaDiagram.altText, /left-to-right handoff/);
  } finally { cleanup(dir); }
});

test('the picture swap contract: the phone file sits beside the wide file, is reported on stdout, and a re-run is byte-identical', () => {
  const dir = makeBuild({ visuals: CONCEPT_SLOTS });
  try {
    const r1 = runTool(dir);
    assert.equal(r1.status, 0);
    const out = JSON.parse(r1.stdout.trim().split('\n').pop());
    const v = visualsOf(dir);
    for (const [key, file] of [['architectureDiagram', 'architecture'], ['flowDiagram', 'flow'], ['bigIdeaDiagram', 'big-idea'], ['insightDiagram', 'insight']]) {
      assert.equal(path.basename(v[key].svgPath), `${file}.svg`);
      assert.equal(path.basename(v[key].mobileSvgPath), `${file}.m.svg`);
      assert.equal(path.dirname(v[key].mobileSvgPath), path.dirname(v[key].svgPath));
      assert.equal(out.outputs.mobileSvgPaths[key], v[key].mobileSvgPath);
    }
    // a re-run reads the round-tripped rows (and the recorded alt text, which becomes the caption once), then is a fixed point
    assert.equal(runTool(dir).status, 0);
    const before = fs.readdirSync(path.join(dir, 'assets')).sort().map((f) => [f, svgOf(dir, f)]);
    assert.equal(runTool(dir).status, 0);
    for (const [f, body] of before) assert.equal(svgOf(dir, f), body, `${f} changed on a further re-run`);
  } finally { cleanup(dir); }
});

test('every concept family has a phone layout (column, ribbon, orbit, strata, grid) — drawn through the real tool', () => {
  // strata is only offered when the authored takeaway claims containment; ribbon/grid/orbit/column come from the slot preferences
  const dir = makeBuild({ visuals: {
    architectureDiagram: { altText: 'Nested layers: the cache sits inside the engine, inside the runtime', rows: [{ items: ['runtime', 'engine', 'cache'], connect: true }] },
    bigIdeaDiagram: chain(['front matter', 'document body', 'colophon']),
    insightDiagram: { rows: [{ items: ['granted', 'dispatch', 'quarantine', 'audit trail', 'release'], connect: false }] },
  }, nodes: ['a', 'b'], edges: [], entrypoints: false });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const v = visualsOf(dir);
    const variants = ['architectureDiagram', 'bigIdeaDiagram', 'insightDiagram'].map((k) => v[k].formVariant);
    assert.equal(new Set(variants).size, 3, `three distinct concept families expected, got ${variants}`);
    for (const k of ['architectureDiagram', 'bigIdeaDiagram', 'insightDiagram']) {
      const svg = fs.readFileSync(v[k].mobileSvgPath, 'utf8');
      assert.match(svg, new RegExp(`concept archetype \\(phone\\): ${v[k].formVariant}`));
      assert.ok(phonePx(svg) >= 11);
      assert.deepEqual(overlappingLabels(svg), []);
    }
  } finally { cleanup(dir); }
});
