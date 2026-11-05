// tests/diagram-form-diversity.test.mjs — INV-23 (FormDiversity), ADR-0012.
//
// Two diagrams of the same coarse form (e.g. a vertical column of cards) cap the grader's B5 axis at 60, below the
// 70 ship floor, so the page becomes unshippable. make-diagrams therefore resolves one distinct form family per slot
// BEFORE drawing (resolveForms) and dies loudly if it cannot. These tests pin the resolver's outputs end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBuild, runTool } from './helpers/diagram-build.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

// A fixture shaped like the repo that actually failed: a REAL dep-graph with internal edges (so architecture renders
// grounded) AND real entrypoints (so flow renders grounded) — the common case for an application repo, and the collision.
// A 0-edge dep-graph demotes architecture to the concept renderer, which refuses an empty graph unless rows are authored.
const NODES = ['cli', 'router', 'validator', 'chain', 'parser'];
const EDGES = [['cli', 'router'], ['cli', 'parser'], ['router', 'validator'], ['validator', 'parser'], ['chain', 'parser']];
function makeFixture({ edges = true, flowRows = null, entrypoints = true, archRows = null } = {}) {
  const visuals = {
    bigIdeaDiagram: { rows: [{ items: ['front matter', 'document body', 'colophon'], connect: true }], title: 'One file, three zones' },
    insightDiagram: { rows: [{ items: ['granted', 'dispatch', 'quarantine'], connect: true }], title: 'The clever move' },
  };
  if (flowRows) visuals.flowDiagram = { rows: flowRows };
  if (archRows) visuals.architectureDiagram = { rows: archRows, title: 'How it is built' };
  return makeBuild({ nodes: NODES, edges: edges ? EDGES : [], entrypoints, visuals, repoName: 'colophon-spec' });
}

const run = (dir) => { const r = runTool(dir); if (r.status !== 0) { const e = new Error(r.out); e.stdout = r.stdout; e.stderr = r.stderr; throw e; } return r; };
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

test('INV-23 — the architecture and flow diagrams specifically never share a form (the collision regression)', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  assert.notEqual(v.architectureDiagram.form, v.flowDiagram.form,
    'architecture and flow collapsed to the same visual form');
  // The pin now sits where it belongs. Architecture is RADIAL (a dependency map IS hub-and-spokes,
  // and buildArchModel already computes the hub), which leaves vertical-stack free for the grounded
  // renderFlow. NEITHER diagram demotes, so neither is drawn in a form that misdescribes it.
  assert.equal(v.architectureDiagram.form, 'radial');
  assert.equal(v.flowDiagram.form, 'vertical-stack');
});

test('INV-23 — the ribbon width rule still guards any slot that demotes (bans WIDE ribbons, not ribbons)', () => {
  // conceptRibbon is the only archetype whose width grows with item count (6 items = 1385px, 13px labels at 3.66px on a
  // phone); RIBBON_MAX_ITEMS keeps long chains off it.
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
  // Mirror the real layout (tools/ + src/): the tool imports ../src/story-diagrams.mjs (ADR-0014), so a
  // bare copy in a temp dir would die on MODULE_NOT_FOUND and the mutation would be "caught" for the
  // wrong reason — exactly the failure mode the stderr assertion below exists to rule out.
  const repo = path.join(path.dirname(TOOL), '..');
  fs.mkdirSync(path.join(mutantDir, 'tools'));
  fs.mkdirSync(path.join(mutantDir, 'src'));
  fs.cpSync(path.join(repo, 'tools', 'diagrams'), path.join(mutantDir, 'tools', 'diagrams'), { recursive: true });
  for (const f of ['story-diagrams.mjs', 'story-diagrams-mobile.mjs']) fs.copyFileSync(path.join(repo, 'src', f), path.join(mutantDir, 'src', f));
  fs.copyFileSync(TOOL, path.join(mutantDir, 'tools', 'make-diagrams.mjs'));
  // the DIAGRAMS table (the resolver's input) lives in tools/diagrams/models.mjs since make-diagrams was split
  const modelsPath = path.join(mutantDir, 'tools', 'diagrams', 'models.mjs');
  const src = fs.readFileSync(modelsPath, 'utf8');
  const mutant = path.join(mutantDir, 'tools', 'make-diagrams.mjs');
  // Strand the insight slot: no preferences => the resolver can find no free family for it.
  const NEEDLE = /conceptHeading: 'The clever move', conceptPrefs: \[[^\]]*\]/;
  assert.ok(NEEDLE.test(src), 'mutation target not found — the DIAGRAMS table shape changed; update this test');
  const mutated = src.replace(NEEDLE, "conceptHeading: 'The clever move', conceptPrefs: []");
  assert.ok(mutated !== src, 'mutation did not apply');
  fs.writeFileSync(modelsPath, mutated);

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
  return [...svg.matchAll(/<rect x="([-0-9.]+)" y="([-0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"[^>]*filter="url\(#[\w-]*cardSh\)"/g)]
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

test('ADR-0012 — the radial layout never overlaps two cards, at any module count', () => {
  for (const n of [2, 3, 4, 5, 7, 9, 12]) {   // 12 = ARCH_MAX_NODES, the most the radial map draws
    const names = Array.from({ length: n }, (_, i) => `mod${i}`);
    const dir = makeBuild({ nodes: names, edges: names.slice(1).map((x) => [x, names[0]]), repoName: 'demo', visuals: {
      bigIdeaDiagram: { rows: [{ items: ['a', 'b', 'c'], connect: true }] },
      insightDiagram: { rows: [{ items: ['x', 'y', 'z'], connect: true }] },
    } });
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
  const heightOf = (svgPath) => Number(/viewBox="0 0 [0-9.]+ ([0-9.]+)/.exec(fs.readFileSync(svgPath, 'utf8'))[1]);
  const seen = [];
  for (const n of [4, 5, 7, 9]) {
    const dir = makeFixture();
    const bj = path.join(dir, 'build.json');
    const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
    b.visuals.insightDiagram.rows = [{ items: Array.from({ length: n }, (_, i) => `stage number ${i + 1}`), connect: true }];
    fs.writeFileSync(bj, JSON.stringify(b, null, 2));
    run(dir);
    const d = visualsOf(dir).insightDiagram;
    assert.equal(d.formVariant, 'grid', `${n} items must land on the grid, not a wide ribbon`);
    seen.push({ n, w: widthOf(d.svgPath), h: heightOf(d.svgPath) });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(seen.every((x) => x.w === seen[0].w), `row width must not depend on item count: ${JSON.stringify(seen)}`);
  assert.ok(seen[0].w < 800, `a portrait canvas: got ${seen[0].w}px`);
  assert.ok(seen[3].h > seen[0].h, 'more items wrap onto more rows (height grows, width does not)');
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

test('ADR-0012 — an ACCURATE alt text is left in the author\'s own words, even on a handoff-shaped Big Idea', () => {
  const dir = makeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  // Three connected items draw as a left-to-right handoff. This description is accurate for that form
  // and richer than the generated "A left-to-right handoff: a → b → c" template.
  const ACCURATE = 'The file starts with front matter, carries the document body, and ends with a colophon.';
  b.visuals.bigIdeaDiagram.altText = ACCURATE;
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  run(dir);
  const v = visualsOf(dir);
  assert.equal(v.bigIdeaDiagram.form, 'horizontal-run', 'precondition: this fixture draws a handoff');
  assert.equal(v.bigIdeaDiagram.altText, ACCURATE,
    'an accurate claim must survive — upstream\'s unconditional template replaced good descriptions with boilerplate');
  assert.match(fs.readFileSync(v.bigIdeaDiagram.svgPath, 'utf8'), /ends with a colophon/,
    'the accessible <desc> must carry the author\'s words too, not only the recorded alt text');
});

test('a Big Idea alt text that claims CONTAINMENT is corrected — the page draws a handoff, not nested frames', () => {
  const dir = makeFixture();
  const bj = path.join(dir, 'build.json');
  const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
  b.visuals.bigIdeaDiagram.altText = 'The big idea, drawn as one outlined file containing two zones stacked inside it.';
  fs.writeFileSync(bj, JSON.stringify(b, null, 2));
  run(dir);
  const v = visualsOf(dir);
  assert.match(v.bigIdeaDiagram.altText, /left-to-right handoff: front matter → document body → colophon/);
  assert.doesNotMatch(fs.readFileSync(v.bigIdeaDiagram.svgPath, 'utf8'), /containing two zones/,
    'a screen reader must not hear a containment the page never drew');
});
