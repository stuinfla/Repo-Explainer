// Conformance test — INV-05 (the exemplar-anchored gate rule, ADR-0005 v1.7.0).
//
// The grader must expose a PURE, unit-testable pass-rule so the gate logic can be verified without
// a network call or a browser. PASS iff: meanScore >= 90 AND headlineScore (min axis) >= 85 AND all
// five operator yes/no questions are true. The OLD rule was headlineScore >= 95 (unreachable) with
// no operator questions. This test FAILS RED until quality-grade.mjs exports evaluatePass().

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ALL_YES = [true, true, true, true, true];

test('INV-05 — quality-grade exports a pure evaluatePass() implementing the v1.7 exemplar-anchored bar', async () => {
  const mod = await import('../tools/quality-grade.mjs');
  assert.equal(
    typeof mod.evaluatePass, 'function',
    'quality-grade.mjs must export evaluatePass({ mean, min, operatorQuestions }) — the v1.7 pass-rule is not yet implemented',
  );

  // A genuinely-good page (as good as the owner's photonlayer example: ~88 headline / ~92 mean).
  assert.equal(mod.evaluatePass({ mean: 91, min: 86, operatorQuestions: ALL_YES }), true, 'a good page should PASS');

  // The anti-slop floor: a single slop axis (a raw-ASCII diagram ~= 50) must fail even with a high mean.
  assert.equal(mod.evaluatePass({ mean: 95, min: 50, operatorQuestions: ALL_YES }), false, 'a single slop axis (min 50) must FAIL');

  // Overall not good enough (mean below 90) must fail.
  assert.equal(mod.evaluatePass({ mean: 89, min: 86, operatorQuestions: ALL_YES }), false, 'mean < 90 must FAIL');

  // A single operator NO (e.g. "no confidence I understand the architecture") must fail, regardless of scores.
  assert.equal(mod.evaluatePass({ mean: 93, min: 88, operatorQuestions: [true, true, false, true, true] }), false, 'an operator NO must FAIL');

  // The old >=95 floor is gone: a page that would have FAILED the old rule but clears the new bar passes.
  assert.equal(mod.evaluatePass({ mean: 92, min: 88, operatorQuestions: ALL_YES }), true, 'min 88 (below old 95) now passes under the exemplar bar');
});
