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
  // Architecture keeps the grounded vertical stack (INV-18 + the mobile-portrait geometry); flow yields.
  assert.equal(v.architectureDiagram.form, 'vertical-stack');
  assert.equal(v.flowDiagram.form, 'horizontal-run');
});

test('INV-23 — a flow demoted for FORM keeps its real entrypoint-derived model (grounding is never traded for shape)', () => {
  const dir = makeFixture();
  run(dir);
  const v = visualsOf(dir);
  // The demoted flow round-trips a rows model built from the REAL flow model, not invented content.
  assert.ok(Array.isArray(v.flowDiagram.rows) && v.flowDiagram.rows.length, 'demoted flow must round-trip its rows');
  const labels = v.flowDiagram.rows.flatMap((r) => r.items).join(' ').toLowerCase();
  assert.ok(/install|build|run|verify|source|colophon/.test(labels),
    `demoted flow lost its real model — got ${JSON.stringify(v.flowDiagram.rows)}`);
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
