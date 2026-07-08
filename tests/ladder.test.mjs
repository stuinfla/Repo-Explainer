// Conformance test — ADR-0006 The Comprehension Ladder (first-principles altitude control).
//
// First real reader (2026-07-03): "lots of acronyms and assumptions the reader understands them."
// Verified on the live hono page: JSX, SSG, KV, R2, ESM, CJS all unglossed. The gate could not
// catch it because every judge was an expert. This suite pins the three repairs:
//   (1) O6 zeroKnowledgeReader joins the operator gate + the beginner persona pass (RUBRIC);
//   (2) INV-20 UnexplainedAcronymZero — deterministic linter over ladder rungs 1-4;
//   (3) the ship tier blocks on zeroKnowledgeReader (technical-but-pretty must not ship).

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('O6 — RUBRIC carries zeroKnowledgeReader (owner verbatim) + the beginner persona pass', async () => {
  const { RUBRIC, RESPONSE_SPEC } = await import('../tools/quality-grade.mjs');
  assert.match(RUBRIC, /zeroKnowledgeReader/, 'RUBRIC missing the sixth operator question key');
  assert.match(RUBRIC, /knows nothing about this domain[\s\S]*first four\s+sections/i,
    'RUBRIC must ask the owner\'s O6 question about the first four sections');
  assert.match(RUBRIC, /DIFFERENT\s+domain/i, 'RUBRIC must set the beginner persona (smart developer from a different domain)');
  assert.match(RESPONSE_SPEC, /zeroKnowledgeReader/, 'RESPONSE_SPEC must require the sixth operator boolean');
});

test('O6 — the ship tier blocks on zeroKnowledgeReader', async () => {
  const { SHIP_OPERATORS, evaluateShipworthy } = await import('../tools/quality-grade.mjs');
  assert.ok(SHIP_OPERATORS.includes('zeroKnowledgeReader'), 'SHIP_OPERATORS must include zeroKnowledgeReader');
  const good = { believeIUnderstand: true, approachable: true, explainsToNovice: true, makesMeSmile: true, zeroKnowledgeReader: true };
  assert.equal(evaluateShipworthy({ mean: 88, min: 75, operatorQuestions: good }), true);
  assert.equal(evaluateShipworthy({ mean: 88, min: 75, operatorQuestions: { ...good, zeroKnowledgeReader: false } }), false,
    'a technically-strong page a newcomer cannot follow must NOT ship');
});

test('INV-20 — flags bare acronyms, passes glossed ones (both directions) and the whitelist', async () => {
  const { findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');
  assert.deepEqual(findUnexplainedAcronyms('Ship with the SSG helper and KV bindings.'), ['KV', 'SSG'],
    'bare SSG and KV must be flagged');
  assert.deepEqual(findUnexplainedAcronyms('SSG (pre-building pages as plain files) is built in.'), [],
    'acronym-first gloss must pass');
  assert.deepEqual(findUnexplainedAcronyms('It pre-builds pages as plain files (SSG).'), [],
    'gloss-first must pass');
  assert.deepEqual(findUnexplainedAcronyms('call it the gate-and-dynamics state, or GDN state: the signal carried forward.'), [],
    'appositive gloss ("…, or GDN state") must pass');
  assert.deepEqual(findUnexplainedAcronyms('GDN — the running signal between layers — is snapshotted.'), [],
    'dash gloss must pass');
  assert.deepEqual(findUnexplainedAcronyms('It saves the KV, the table of numbers built while reading.'), [],
    'comma-appositive gloss must pass');
  assert.deepEqual(findUnexplainedAcronyms('A CLI with a JSON API over HTTP.'), [],
    'cross-domain developer lingua franca (whitelist) must pass');
  assert.deepEqual(findUnexplainedAcronyms('GET STARTED NOW — ALL NEW, ZERO setup'), [],
    'styling caps are not acronyms');
});

test('INV-20 — extractRungText scans rungs 1-4 only (deep sections keep full altitude)', async () => {
  const { extractRungText, findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');
  const html = `
    <section class="hero"><h1>No more 2am mystery crashes</h1></section>
    <details class="section" id="problem"><p>Your build breaks and the log says nothing about RVF.</p></details>
    <details class="section" id="what-it-is"><p>It watches every step.</p></details>
    <details class="section" id="the-insight"><p>One idea: record, then replay.</p></details>
    <details class="section" id="how-it-works"><p>Internally it uses HNSW and SIMD kernels.</p></details>`;
  const text = extractRungText(html);
  assert.deepEqual(findUnexplainedAcronyms(text), ['RVF'],
    'RVF in the problem rung must be flagged; HNSW/SIMD in how-it-works must NOT be scanned');
});
