// ADR-0006 The Comprehension Ladder: the novice operator, the INV-20 acronym linter over rungs 1-4, and the
// guarantee that the vision gate captures the same four rungs the text gate scans.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('O6 — RUBRIC carries zeroKnowledgeReader (owner verbatim) + the beginner persona pass', async () => {
  const { RUBRIC, RESPONSE_SPEC } = await import('../tools/quality-grade.mjs');
  assert.match(RUBRIC, /zeroKnowledgeReader/, 'RUBRIC missing the sixth operator question key');
  assert.match(RUBRIC, /knows nothing about this domain[\s\S]*first four\s+sections/i,
    'RUBRIC must ask the owner\'s O6 question about the first four sections');
  assert.match(RUBRIC, /curious fifteen-year-old/i, 'RUBRIC must set the beginner persona (ADR-0006 D8: a curious fifteen-year-old)');
  assert.doesNotMatch(RUBRIC, /smart developer from a DIFFERENT domain/i, 'the superseded persona must be gone');
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

// The vision gate must capture the same four rungs the text gate scans, or the novice operators are
// judged on whatever images happen to arrive first. Both are derived from ONE list (LADDER); the four
// rungs themselves are pinned here, so dropping one from the list fails instead of silently shrinking both.
test('INV-06/O6 — the ladder is exactly the four rungs the RUBRIC promises, and CROP_SECTIONS captures each', async () => {
  const { CROP_SECTIONS, LADDER_RUNGS } = await import('../tools/quality-grade.mjs');
  assert.deepEqual(LADDER_RUNGS, ['hero', 'problem', 'whatItIs', 'insight'], 'the RUBRIC says there are four rungs');
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
    'get-started must be captured whole: a viewport slice ends above the runnable example, so A6 marks down a program that sits below the crop edge.');
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

// A gloss in screen-reader-only text (visually-hidden) must not satisfy the gate: a sighted reader never sees it.
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

// INV-20 compound-token gloss: "ADR-001 (short for ...)" glosses the reader, so it clears the bare token.
test('INV-20: a gloss attached to a compound token (ADR-001 (…)) clears the bare acronym', async () => {
  const { findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');
  assert.deepEqual(findUnexplainedAcronyms("a design record labeled ADR-001 (short for 'architecture decision record')"), []);
  assert.deepEqual(findUnexplainedAcronyms('The ADR-001 file governs this build.'), ['ADR'], 'a bare compound still fails');
});

// A dash used as punctuation is not a gloss: "GNU — and then it stops" explains nothing.
test('INV-20: an em dash followed by a connective is NOT a gloss; one followed by an explanation is', async () => {
  const { findUnexplainedAcronyms } = await import('../tools/quality-grade.mjs');
  assert.deepEqual(findUnexplainedAcronyms('It runs on GNU — and then it stops.'), ['GNU']);
  assert.deepEqual(findUnexplainedAcronyms('GNU tools — so it is fast.'), ['GNU']);
  assert.deepEqual(findUnexplainedAcronyms('GNU — but only on Linux.'), ['GNU']);
  assert.deepEqual(findUnexplainedAcronyms('GDN — the running signal between layers.'), []);
  assert.deepEqual(findUnexplainedAcronyms('The GNU state — the numbers carried forward.'), []);
});

// The text gate and the vision gate read the same ladder: an unglossed acronym in ANY rung is scanned, and
// every rung's crop selector is the section the text gate scans.
test('INV-20/O6 — extractRungText scans EVERY ladder rung (one bare acronym per rung, each caught)', async () => {
  const { extractRungText, findUnexplainedAcronyms, LADDER, CROP_SECTIONS } = await import('../tools/quality-grade.mjs');
  const fixture = (bareIn) => LADDER.map((r) => {
    const body = `<p>${r.key === bareIn ? 'It speaks ZZQ to the world.' : 'Plain words only here.'}</p>`;
    return r.htmlId === null ? `<section class="hero">${body}</section>` : `<details class="section" id="${r.htmlId}">${body}</details>`;
  }).join('\n');
  for (const r of LADDER) {
    assert.deepEqual(findUnexplainedAcronyms(extractRungText(fixture(r.key))), ['ZZQ'], `a bare acronym in the "${r.key}" rung must be scanned`);
    const crop = CROP_SECTIONS.find((c) => c.key === r.key);
    assert.equal(crop.selector, r.selector, `the "${r.key}" vision crop must select the section the text gate scans`);
  }
});
