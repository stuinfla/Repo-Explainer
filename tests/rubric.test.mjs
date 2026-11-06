// The rubric text carries the A6 axis and the operator questions, and the grader REJECTS a reply that
// omits A6 (behaviour, through the real gradeCrops with a stubbed fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC, gradeCrops } from '../tools/quality-grade.mjs';
import { gradeReply, withStubbedGrader, tempCrops, ARGS } from './grader-stub.mjs';

test('prompt text: the RUBRIC names A6 and the operator questions', () => {
  assert.match(RUBRIC, /\bA6\b/);
  assert.match(RUBRIC, /what (they|you)('|’)?ll see|what you will see|implementation confidence/i);
  assert.match(RUBRIC, /approachable/i);
  assert.match(RUBRIC, /confidence I understand the architecture/i);
  assert.match(RUBRIC, /make me smile|that'?s cool/i);
});

test('a complete reply is accepted, with all eleven scores kept', async () => {
  const out = await withStubbedGrader([gradeReply(88)], () => gradeCrops(ARGS(tempCrops())));
  assert.equal(Object.keys(out.gateA).length, 6);
  assert.equal(out.gateA.A6, 88);
});

test('a reply WITHOUT gateA.A6 is rejected loudly, never scored as a pass', async () => {
  const bad = gradeReply(95);
  delete bad.gateA.A6;
  await assert.rejects(
    withStubbedGrader([bad], () => gradeCrops(ARGS(tempCrops()))),
    /gateA\.A6 invalid\/missing/);
});

test('a reply with a missing rationale or a non-boolean operator answer is rejected', async () => {
  const noRationale = gradeReply(95); noRationale.rationales.B3 = '';
  await assert.rejects(withStubbedGrader([noRationale], () => gradeCrops(ARGS(tempCrops()))), /rationale B3/);
  const badOp = gradeReply(95); badOp.operatorQuestions.makesMeSmile = 'yes';
  await assert.rejects(withStubbedGrader([badOp], () => gradeCrops(ARGS(tempCrops()))), /operatorQuestions\.makesMeSmile must be boolean/);
});
