// The two pure tier rules. evaluateShipworthy is the SHIP gate (mean>=82, min>=70, five ship operators);
// evaluatePass is the EXEMPLARY tier (mean>=90, min>=85, all six operators). Boundaries are pinned on both
// sides, so a loosened threshold (or a 0/0 mutation) fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePass, evaluateShipworthy, SHIP_OPERATORS } from '../tools/quality-grade.mjs';

const ALL_YES = [true, true, true, true, true, true];   // order: believeIUnderstand, approachable, explainsToNovice, architectureConfidence, makesMeSmile, zeroKnowledgeReader

test('EXEMPLARY tier: 90/85 is the boundary on both axes, and every one of six operators must be YES', () => {
  assert.equal(evaluatePass({ mean: 90, min: 85, operatorQuestions: ALL_YES }), true);
  assert.equal(evaluatePass({ mean: 89, min: 85, operatorQuestions: ALL_YES }), false, 'mean 89');
  assert.equal(evaluatePass({ mean: 90, min: 84, operatorQuestions: ALL_YES }), false, 'min 84');
  assert.equal(evaluatePass({ mean: 95, min: 50, operatorQuestions: ALL_YES }), false, 'a single slop axis fails despite a high mean');
  for (let i = 0; i < 6; i++) {
    const ops = ALL_YES.map((v, j) => (j === i ? false : v));
    assert.equal(evaluatePass({ mean: 95, min: 90, operatorQuestions: ops }), false, `operator #${i + 1} NO must fail`);
  }
  assert.equal(evaluatePass({ mean: 95, min: 90, operatorQuestions: ALL_YES.slice(0, 5) }), false, 'a missing operator is not a YES');
  assert.equal(evaluatePass({}), false);
});

test('SHIP tier: 82/70 is the boundary on both axes', () => {
  const ops = Object.fromEntries(SHIP_OPERATORS.map((k) => [k, true]));
  assert.equal(evaluateShipworthy({ mean: 82, min: 70, operatorQuestions: ops }), true);
  assert.equal(evaluateShipworthy({ mean: 81, min: 70, operatorQuestions: ops }), false, 'mean 81');
  assert.equal(evaluateShipworthy({ mean: 82, min: 69, operatorQuestions: ops }), false, 'min 69');
  assert.equal(evaluateShipworthy({ mean: 0, min: 0, operatorQuestions: ops }), false, 'a 0/0 page must never ship');
});

test('SHIP tier: each of the five ship operators blocks; architectureConfidence does not', () => {
  const ops = Object.fromEntries(SHIP_OPERATORS.map((k) => [k, true]));
  for (const k of SHIP_OPERATORS) {
    assert.equal(evaluateShipworthy({ mean: 90, min: 90, operatorQuestions: { ...ops, [k]: false } }), false, `${k}=false`);
  }
  assert.equal(evaluateShipworthy({ mean: 90, min: 90, operatorQuestions: { ...ops, architectureConfidence: false } }), true);
});

test('SHIP tier accepts the array form (order of the six operator questions) as well as the object form', () => {
  assert.equal(evaluateShipworthy({ mean: 90, min: 90, operatorQuestions: ALL_YES }), true);
  assert.equal(evaluateShipworthy({ mean: 90, min: 90, operatorQuestions: [true, true, true, true, true, false] }), false, 'zeroKnowledgeReader is the sixth');
  assert.equal(evaluateShipworthy({ mean: 90, min: 90, operatorQuestions: [true, true, true, false, true, true] }), true, 'architectureConfidence is the fourth and informational');
});
