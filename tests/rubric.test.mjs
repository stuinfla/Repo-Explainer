// Conformance test — A6 + the operator qualitative gate (ADR-0005 v1.7.0 §"The QA System").
//
// The vision RUBRIC handed to the grader must COPY the v1.7 spec verbatim, not the old A1–A5/B1–B5
// set. It must include the A6 Implementation-confidence axis and the five operator questions (the
// owner's words). FAILS RED until quality-grade.mjs's RUBRIC is rewritten to the v1.7 spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('A6 + INV-19 — the grader RUBRIC includes the Implementation-confidence axis', async () => {
  const { RUBRIC } = await import('../tools/quality-grade.mjs');
  assert.match(RUBRIC, /\bA6\b/, 'RUBRIC is missing the A6 Implementation-confidence axis');
  assert.match(RUBRIC, /what (they|you)('|’)?ll see|what you will see|implementation confidence/i,
    'RUBRIC must judge whether the reader knows what to run and what they will SEE (A6)');
});

test('Operator gate — the RUBRIC carries the five operator yes/no questions (owner verbatim)', async () => {
  const { RUBRIC } = await import('../tools/quality-grade.mjs');
  assert.match(RUBRIC, /approachable/i, 'missing operator question: "Would this make it approachable?"');
  assert.match(RUBRIC, /confidence I understand the architecture/i,
    'missing operator question: "Would it give me confidence I understand the architecture?"');
  assert.match(RUBRIC, /make me smile|that'?s cool/i, 'missing operator question: "Does it make me smile — oh, that\'s cool?"');
});
