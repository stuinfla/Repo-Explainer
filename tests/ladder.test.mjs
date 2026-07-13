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

// ── REGRESSION: the gate must SEE what it claims to judge (2026-07-12) ────────────────────────────
// The bug that made explainsToNovice / zeroKnowledgeReader unpassable on EVERY build ever shipped:
// the RUBRIC told the vision model "judge the novice questions on the first four sections (hero,
// problem, what-it-is, insight)", but CROP_SECTIONS never captured #problem or #the-insight. So the
// model judged "can a newcomer follow this?" against whatever four images arrived first — which
// included the ARCHITECTURE DIAGRAM — and reported, correctly for what it was shown, that the reader
// meets "Rust engine"/"BitLinear" with no grounding. The grounding was on the page, in the two
// sections the grader was structurally incapable of seeing.
//
// Note the shape of the miss: a test ALREADY asserted the TEXT gate (extractRungText) scans exactly
// rungs 1-4. Nobody asserted the VISION gate captured the same four. The two halves of one gate
// drifted apart in silence. These tests bind them together.
test('INV-06/O6 — CROP_SECTIONS captures EVERY ladder rung the RUBRIC promises the grader', async () => {
  const { CROP_SECTIONS, LADDER_RUNGS } = await import('../tools/quality-grade.mjs');
  const captured = new Set(CROP_SECTIONS.map((c) => c.key));
  for (const rung of LADDER_RUNGS) {
    assert.ok(captured.has(rung),
      `ladder rung "${rung}" is NOT in CROP_SECTIONS — the RUBRIC tells the grader it will see this `
      + `section and judge the novice operators on it. If it is never captured, those operators can `
      + `never pass, no matter what is written in that section.`);
  }
});

test('O6 — every ladder-rung crop is LABELLED as one, so the grader can tell them from deep sections', async () => {
  const { CROP_SECTIONS, LADDER_RUNGS, RUBRIC } = await import('../tools/quality-grade.mjs');
  for (const rung of LADDER_RUNGS) {
    const spec = CROP_SECTIONS.find((c) => c.key === rung);
    assert.ok(spec.rung === true, `crop "${rung}" must be marked rung:true`);
    assert.match(spec.label, /LADDER RUNG/,
      `crop "${rung}" label must say "LADDER RUNG" — the RUBRIC instructs the model to judge the `
      + `novice operators ONLY on crops with that label`);
  }
  // and the RUBRIC must actually reference the label it relies on
  assert.match(RUBRIC, /LADDER RUNG/,
    'RUBRIC must tell the grader to judge the novice operators on the LADDER RUNG crops');
});

test('A6 — get-started is captured WHOLE, not as a viewport slice that cuts off the example', async () => {
  const { CROP_SECTIONS } = await import('../tools/quality-grade.mjs');
  const gs = CROP_SECTIONS.find((c) => c.key === 'getStarted');
  assert.ok(gs && gs.whole === true,
    'get-started must be captured as a whole element: a 390x844 viewport slice ends above the runnable '
    + 'example, so the grader marks down "no complete program" for a program that is simply below the '
    + 'crop edge (this held A6 at 68 on mobile; capturing the whole section took it to 97).');
});

test('INV-20 — ordinary words in display caps are NOT acronyms (INSIDE / MODEL / MOVE)', async () => {
  const { findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');
  // the inlined hero animation set these in uppercase; INV-20 read them as unexplained acronyms and
  // failed the build BEFORE the vision pass. An English word in caps is styling, not an acronym.
  const hits = findUnexplainedAcronyms('The numbers INSIDE the MODEL. The one expensive MOVE.');
  assert.deepEqual(hits, [], `display-caps English words must not trip INV-20 (got: ${hits.join(', ')})`);
  // ...but a real unglossed acronym still must
  assert.ok(findUnexplainedAcronyms('It compiles to WASM at build time.').includes('WASM'),
    'a genuinely unglossed acronym must still be caught');
});

// ── REGRESSION: a gloss the reader cannot SEE does not count (2026-07-13) ─────────────────────────
// assemble-page renders a table <caption> as class="visually-hidden" (screen-reader only). INV-20 was
// scanning it, so glossing an acronym THERE satisfied the linter while a sighted reader still met a bare
// "POST /agents/{id}/chat" and "Streaming SSE chat" with nothing to decode them. Two independent authors
// (a subagent, and me) both reached for that caption as the natural place to put the gloss — which is the
// tell that the CHECK was rewarding the wrong thing, not that the authors were careless. A gate you can
// satisfy without helping the reader is worse than no gate: it manufactures false confidence.
test('INV-20 — a gloss hidden from sighted readers (visually-hidden) does NOT satisfy the gate', async () => {
  const { extractRungText, findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');

  const hiddenGloss = `<section class="hero"><h1>Hi</h1></section>
    <details class="section" id="what-it-is"><table>
      <caption class="visually-hidden">every row is a web request that sends data (POST)</caption>
      <tr><td>POST /agents/chat</td></tr>
    </table></details>`;
  assert.ok(findUnexplainedAcronyms(extractRungText(hiddenGloss)).includes('POST'),
    'a gloss inside visually-hidden text must NOT count — the sighted reader still sees bare "POST"');

  const visibleGloss = `<section class="hero"><h1>Hi</h1></section>
    <details class="section" id="what-it-is">
      <p>Each row begins with the request that hands the service something to do (POST).</p>
      <table><caption class="visually-hidden">The service's web addresses.</caption>
      <tr><td>POST /agents/chat</td></tr></table>
    </details>`;
  assert.deepEqual(findUnexplainedAcronyms(extractRungText(visibleGloss)), [],
    'the SAME gloss in visible prose must satisfy the gate');
});
