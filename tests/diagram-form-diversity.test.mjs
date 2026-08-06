// tests/diagram-form-diversity.test.mjs — INV-23 (FormDiversity), ADR-0012.
//
// THE INCIDENT THIS ENCODES (2026-08-06): PolymathWizard/BHIL-Colophon-Spec failed TWICE
// (runs 30857458852, 30865218481; $12.47 spent, nothing delivered) because the architecture
// diagram and the runtime-flow diagram rendered as the SAME visual form — a vertical column of
// rounded cards joined by downward arrows. The vision grader capped B5 at 60 ("two-or-more
// same-form diagrams", quality-grade.mjs:158). The ship floor is min >= 70, so the cap made the
// page arithmetically unshippable no matter how good the other nine axes were.
//
// The old design assigned one static `conceptVariant` per key and asserted in a comment that
// "pairwise distinctness holds either way". It did not: that reasoning covered only the four
// CONCEPT variants, and never `renderArchitecture` / `renderFlow` — separate functions, outside
// the variant table, both emitting a vertical card-stack since the 2026-07-30 portrait fix.
//
// These tests fail RED against that design (it emits no `form` field at all, and its two grounded
// renderers collide) and pass only with the deterministic resolver.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

// A fixture shaped like the repo that actually failed: a REAL dep-graph with internal edges (so
// architecture renders grounded) AND real entrypoints (so flow renders grounded). That combination
// — the common case for any application repo — is precisely what used to collide.
function makeFixture({ edges = true, flowRows = null, entrypoints = true, archRows = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-form-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'cli' }, { name: 'router' }, { name: 'validator' }, { name: 'chain' }, { name: 'parser' }],
    internalEdges: edges ? [
      { from: 'cli', to: 'router' }, { from: 'cli', to: 'parser' }, { from: 'router', to: 'validator' },
      { from: 'validator', to: 'parser' }, { from: 'chain', to: 'parser' },
    ] : [],
    componentCount: 5, internalEdgeCount: edges ? 5 : 0, ecosystems: ['python'],
    externalDepNames: ['PyYAML'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify(entrypoints ? {
    install: ['pip install -e .'],
    commands: [{ category: 'build', cmd: 'make build' }, { category: 'test', cmd: 'pytest' }],
    binaries: [{ name: 'colophon' }], quickstart: ['colophon seal'], workspace: { kind: 'single' },
  } : {}));
  fs.writeFileSync(path.join(kb, 'symbols.json'), JSON.stringify({ count: 42, byCrate: { parser: 20 } }));
  const visuals = {
    bigIdeaDiagram: { rows: [{ items: ['front matter', 'document body', 'colophon'], connect: true }], title: 'One file, three zones' },
    insightDiagram: { rows: [{ items: ['granted', 'dispatch', 'quarantine'], connect: true }], title: 'The clever move' },
  };
  if (flowRows) visuals.flowDiagram = { rows: flowRows };
  // A 0-edge dep-graph demotes architecture to the concept renderer, which (correctly, pre-existing
  // behaviour) REFUSES to draw a picture of an empty graph unless the brain authored real rows.
  if (archRows) visuals.architectureDiagram = { rows: archRows, title: 'How it is built' };
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'colophon-spec' },
    kb: {
      depGraphPath: path.join(kb, 'dep-graph.json'),
      entrypointsPath: path.join(kb, 'entrypoints.json'),
      symbolsPath: path.join(kb, 'symbols.json'),
    },
    visuals,
  }, null, 2));
  return dir;
}

const run = (dir, tool = TOOL) => execFileSync(process.execPath, [tool, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
const visualsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals;
const DIAGRAM_KEYS = ['architectureDiagram', 'flowDiagram', 'bigIdeaDiagram', 'insightDiagram'];
const formsOf = (v) => DIAGRAM_KEYS.filter((k) => v[k]).map((k) => v[k].form);

test('INV-23 — the exact BHIL-Colophon-Spec shape (grounded architecture + grounded flow) emits PAIRWISE-DISTINCT forms', () => {
  const dir = makeFixture();               // edges > 0 AND real entrypoints => both would be vertical stacks
  run(dir);
  const v = visualsOf(dir);
  const forms = formsOf(v);
  assert.equal(forms.length, 4, `expected 4 diagrams, got ${forms.length}`);
  assert.ok(forms.every(Boolean), `every diagram must record its form, got ${JSON.stringify(forms)}`);
  assert.equal(new Set(forms).size, 4,
    `INV-23 VIOLATED — two diagrams share a form: ${JSON.stringify(Object.fromEntries(DIAGRAM_KEYS.map((k) => [k, v[k]?.form])))}`);
});

test('INV-23 — the architecture and flow diagrams specifically never share a form (the regression that cost $12.47)', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  assert.notEqual(v.architectureDiagram.form, v.flowDiagram.form,
    'architecture and flow collapsed to the same visual form — this is the exact 2026-08-04 failure');
  // The pin now sits where it belongs. Architecture is RADIAL (a dependency map IS hub-and-spokes,
  // and buildArchModel already computes the hub), which leaves vertical-stack free for the grounded
  // renderFlow. NEITHER diagram demotes, so neither is drawn in a form that misdescribes it.
  assert.equal(v.architectureDiagram.form, 'radial');
  assert.equal(v.flowDiagram.form, 'vertical-stack');
});

test('INV-23 — the ribbon width rule still guards any slot that demotes (bans WIDE ribbons, not ribbons)', () => {
  // Measured 2026-08-06: conceptRibbon is the only archetype whose width grows with item count
  // (3 items 731px, 4 = 949px, 5 = 1167px, 6 = 1385px); every other archetype stays portrait. At 390px
  // fit-to-width a 1385px ribbon renders 13px labels at 3.66px, against the 568px grounded
  // architecture diagram that graded as legible. RIBBON_MAX_ITEMS keeps long chains off it.
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /RIBBON_MAX_ITEMS/, 'the width rule must exist');
  assert.match(src, /ribbonIsSafe/, 'and must be consulted when picking an archetype');
  const long = makeFixture({ flowRows: [{ items: ['a', 'b', 'c', 'd', 'e', 'f'], connect: true }] });
  run(long);
  assert.notEqual(visualsOf(long).flowDiagram.form, 'horizontal-run',
    'a 6-item authored chain must not land on the ribbon');
});

test('INV-23 — flow no longer demotes at all, so it KEEPS the IN/OUT detail the demotion was destroying', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  assert.equal(v.flowDiagram.formVariant, null,
    'a null variant means the grounded renderFlow drew it — no concept archetype was substituted');
  // renderFlow is the only renderer that labels each stage's input and output artifact. Losing that
  // was the real cost of the first fix; this asserts it survived.
  const svg = fs.readFileSync(v.flowDiagram.svgPath, 'utf8');
  assert.match(svg, />IN</, 'the grounded flow must still label each stage INPUT artifact');
  assert.match(svg, />OUT</, 'the grounded flow must still label each stage OUTPUT artifact');
});

test('INV-23 — the demotion path still works where it genuinely applies (authored flow rows)', () => {
  // When the brain authors a real runtime flow, flow legitimately renders through the concept path.
  // That is a content decision, not a form workaround — and the forms must still be distinct.
  const dir = makeFixture({ flowRows: [{ items: ['request', 'validate', 'dispatch'], connect: true }] });
  run(dir);
  const v = visualsOf(dir);
  const forms = formsOf(v);
  assert.equal(new Set(forms).size, forms.length, `INV-23 VIOLATED with an authored flow: ${JSON.stringify(forms)}`);
  const labels = (v.flowDiagram.rows || []).flatMap((r) => r.items).join(' ').toLowerCase();
  assert.match(labels, /request|validate|dispatch/, 'the authored content must survive the render');
});

test('INV-23 — holds when architecture DEMOTES too (degenerate 0-edge graph + brain-authored flow rows)', () => {
  const dir = makeFixture({
    edges: false,
    flowRows: [{ items: ['input', 'seal', 'dispatch'], connect: true }],
    archRows: [{ items: ['cli', 'router', 'parser'], connect: true }],
  });
  // A 0-edge graph demotes architecture to a concept archetype; all four slots are then concept-rendered.
  const v = (run(dir), visualsOf(dir));
  const forms = formsOf(v);
  assert.equal(new Set(forms).size, forms.length,
    `INV-23 VIOLATED with all-demoted slots: ${JSON.stringify(forms)}`);
});

test('INV-23 — holds for a library repo with no runtime entrypoints (flow skipped, 3 diagrams)', () => {
  const dir = makeFixture({ entrypoints: false });
  run(dir);
  const v = visualsOf(dir);
  const forms = formsOf(v);
  assert.ok(!v.flowDiagram, 'a library repo must not get a fabricated flow diagram');
  assert.equal(forms.length, 3);
  assert.equal(new Set(forms).size, 3, `INV-23 VIOLATED with flow skipped: ${JSON.stringify(forms)}`);
});

// ── THE MUTATION TEST ────────────────────────────────────────────────────────────────────────────
// House rule: a test that cannot fail on broken code is not a test. The five tests above prove the
// resolver produces a distinct set; this one proves the GUARD is real — that a collision would be
// REFUSED rather than silently drawn. We mutate a copy of the tool so one slot has no archetype left
// to take, and assert the tool dies loudly naming INV-23 instead of emitting two identical shapes.
test('INV-23 — the guard FAILS LOUD when no distinct form remains (mutation proof, not a tautology)', () => {
  const mutantDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-form-mutant-'));
  const mutant = path.join(mutantDir, 'make-diagrams.mjs');
  const src = fs.readFileSync(TOOL, 'utf8');
  // Strand the insight slot: no preferences => the resolver can find no free family for it.
  const NEEDLE = /conceptHeading: 'The clever move', conceptPrefs: \[[^\]]*\]/;
  assert.ok(NEEDLE.test(src), 'mutation target not found — the DIAGRAMS table shape changed; update this test');
  const mutated = src.replace(NEEDLE, "conceptHeading: 'The clever move', conceptPrefs: []");
  assert.ok(mutated !== src, 'mutation did not apply');
  fs.writeFileSync(mutant, mutated);

  const dir = makeFixture();
  let threw = false, stderr = '';
  try {
    execFileSync(process.execPath, [mutant, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    threw = true;
    stderr = String(e.stderr || '') + String(e.stdout || '');
  }
  assert.ok(threw, 'MUTATION SURVIVED — the tool emitted diagrams with no distinct form available. The INV-23 guard is not real.');
  assert.match(stderr, /INV-23|distinct diagram form/i,
    `the tool failed, but not for the INV-23 reason — got: ${stderr.slice(0, 400)}`);
});

// ── THE GROUNDED RADIAL ARCHITECTURE (ADR-0012, review finding 4) ────────────────────────────────
// Moving the vertical-stack pin OFF architecture and onto flow dissolves four review findings at
// once: flow keeps its grounded renderer (and its IN/OUT artifact annotations), nothing gets demoted
// to a form that misdescribes it, no 1385px ribbon, and no sequence drawn as containment.
// A dependency map genuinely IS hub-and-spokes — buildArchModel already computes the hub — so this
// is the more faithful drawing, not a compromise.

// Count REAL cards: glassPanel emits several stacked rects per card (aura / depth / fill / sheen),
// and only the fill rect carries filter="url(#cardSh)". The first version of this helper counted all
// of them and reported 13 overlaps on a layout that was actually clean — a detector that cannot tell
// a card from its own shadow is worse than no detector.
function cardRects(svg) {
  return [...svg.matchAll(/<rect x="([-0-9.]+)" y="([-0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"[^>]*filter="url\(#cardSh\)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
}
function overlapCount(rects) {
  let hits = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) hits++;
    }
  }
  return hits;
}

test('ADR-0012 — grounded architecture is RADIAL and grounded flow keeps the vertical stack (nothing demotes)', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  assert.equal(v.architectureDiagram.form, 'radial', 'a dependency map is hub-and-spokes');
  assert.equal(v.flowDiagram.form, 'vertical-stack', 'the flow keeps its grounded renderer');
  assert.equal(v.flowDiagram.formVariant, null, 'null variant means it did NOT demote to a concept archetype');
  // The whole point: the richest diagram on the page stops being sacrificed to the form rule.
  assert.match(v.flowDiagram.asciiFallback || '', /→|->/, 'the grounded flow still describes a sequence');
});

test('ADR-0012 — the radial layout never overlaps two cards, at any module count', () => {
  for (const n of [2, 3, 4, 5, 7, 9]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `emr-radial-${n}-`));
    const kb = path.join(dir, 'kb');
    fs.mkdirSync(kb, { recursive: true });
    const names = Array.from({ length: n }, (_, i) => `mod${i}`);
    fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
      nodes: names.map((x) => ({ name: x })),
      internalEdges: names.slice(1).map((x) => ({ from: x, to: names[0] })),
      componentCount: n, internalEdgeCount: n - 1, ecosystems: ['node'],
      externalDepNames: ['left-pad'], externalDepCount: 1,
    }));
    fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({
      install: ['npm i'], commands: [{ category: 'build', cmd: 'npm run build' }], binaries: [{ name: 'b' }], quickstart: ['npx b'],
    }));
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
      understanding: { repoName: 'demo' },
      kb: { depGraphPath: path.join(kb, 'dep-graph.json'), entrypointsPath: path.join(kb, 'entrypoints.json') },
      visuals: {
        bigIdeaDiagram: { rows: [{ items: ['a', 'b', 'c'], connect: true }] },
        insightDiagram: { rows: [{ items: ['x', 'y', 'z'], connect: true }] },
      },
    }, null, 2));
    run(dir);
    const v = visualsOf(dir);
    const svg = fs.readFileSync(v.architectureDiagram.svgPath, 'utf8');
    const rects = cardRects(svg);
    assert.ok(rects.length >= 2, `${n} modules should draw at least 2 cards, got ${rects.length}`);
    assert.equal(overlapCount(rects), 0,
      `${n} modules: ${overlapCount(rects)} overlapping card pair(s). The arc layout this replaced collided at m=4 `
      + `(1.8 rad / 214px radius puts adjacent cards 128px apart while a card is 196px wide) — collision-freedom `
      + `must be a property of the layout, not a lucky constant.`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ADR-0012 — the radial diagram stays GROUNDED: real hub, real dependent counts, real externals', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  const svg = fs.readFileSync(v.architectureDiagram.svgPath, 'utf8');
  assert.match(svg, /CORE/, 'the hub must be marked — it is the module the most others depend on');
  assert.match(svg, /parser/, 'the real hub from the dep-graph must appear (parser has the most dependents here)');
  assert.match(svg, /EXTERNAL PACKAGES/, 'real external dependencies must still be shown');
  assert.match(v.architectureDiagram.altText || '', /depend/i, 'the alt text must describe a dependency relationship');
});

// ── THE FIFTH FAMILY (found by rendering the real page and looking at it) ────────────────────────
// With four families and four slots, a page where radial, containment and vertical-stack were all
// taken left a long chain only the ribbon — whose width grows with item count. The resolver's
// "better an illegible diagram than none" fallback fired exactly as written and put a 4-item insight
// chain on a 949px ribbon, ~5px text on a phone. The taxonomy was genuinely exhausted, and the review
// had already named the gap: the rubric's own vocabulary is "containment, journey, field, fan…" and
// there was no FIELD. conceptGrid is that field, and it is portrait by construction because the ROW
// WIDTH is bounded rather than the item count.
test('ADR-0012 — a 4-slot page where every other family is taken resolves the last slot to GRID, not a wide ribbon', () => {
  // FOUR items — the shape of the real page that exposed this. A 3-item chain is only 731px and may
  // legitimately stay on the ribbon; the rule is about width, not about avoiding ribbons.
  const dir = makeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.insightDiagram.rows = [{ items: ['router reads the block', 'route in grant', 'requires approval', 'no grant, quarantined'], connect: true }];
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  run(dir);
  const v = visualsOf(dir);
  assert.equal(v.insightDiagram.form, 'grid',
    'with radial + vertical-stack + containment taken, a long chain must land on the field, not the run');
  const forms = formsOf(v);
  assert.equal(new Set(forms).size, 4, `forms must stay pairwise distinct: ${JSON.stringify(forms)}`);
});

test('ADR-0012 — the grid stays portrait as items grow (the property the ribbon lacks)', () => {
  const widthOf = (svgPath) => Number(/viewBox="0 0 ([0-9.]+)/.exec(fs.readFileSync(svgPath, 'utf8'))[1]);
  let prev = 0;
  for (const n of [3, 5, 7, 9]) {
    const items = Array.from({ length: n }, (_, i) => `stage number ${i + 1}`);
    const dir = makeFixture({ flowRows: [{ items, connect: true }] });
    run(dir);
    const v = visualsOf(dir);
    const target = Object.values(v).find((d) => d && d.formVariant === 'grid');
    if (!target) continue;
    const w = widthOf(target.svgPath);
    assert.ok(w < 1000, `${n} items produced a ${w}px grid — the row width must stay bounded`);
    assert.ok(w >= prev - 1, 'width must not oscillate wildly');
    prev = w;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── ALT TEXT MUST NOT DESCRIBE A SHAPE THAT WAS NEVER DRAWN ─────────────────────────────────────
// The brain writes form claims into its alt text ("drawn as a hub with three satellites"). That was
// safe when form was a static per-key constant; it is not safe now that the resolver decides at
// runtime. This string is BOTH the visible caption and the accessible text, so a stale claim makes
// the page assert one structure in pixels and a different one to a screen reader — review finding 5.
test('ADR-0012 — an alt-text form claim that CONTRADICTS the drawn form is rewritten', () => {
  const dir = makeFixture();
  // Authored as a hub; with radial already taken by architecture this slot cannot be radial.
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.insightDiagram.altText = 'The insight, drawn as a hub with three satellites: the router reads the block.';
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  run(dir);
  const v = visualsOf(dir);
  const svg = fs.readFileSync(v.insightDiagram.svgPath, 'utf8');
  assert.doesNotMatch(svg, /hub with three satellites/,
    'a contradicting form claim must not survive into the caption OR the accessible <desc> — fixing only '
    + 'the visible caption leaves a screen reader hearing a structure the page never drew');
  assert.doesNotMatch(v.insightDiagram.altText, /hub with three satellites/,
    'the recorded alt text must carry the correction too');
});

test('ADR-0012 — an ACCURATE alt-text form claim is left in the author\'s own words', () => {
  const dir = makeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  // bigIdea resolves to containment; this claim agrees with it and is richer than any boilerplate.
  b.visuals.bigIdeaDiagram.altText = 'The big idea, drawn as one outlined file containing two zones stacked inside it: front matter and body.';
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  run(dir);
  const v = visualsOf(dir);
  assert.match(v.bigIdeaDiagram.altText, /containing two zones/,
    'an accurate claim must survive — the first version of this rewrite replaced good descriptions with boilerplate');
});
