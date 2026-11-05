// refineBudget: how many content re-authors can still be GRADED. A pass past the grader's cap is a paid
// brain call nobody reads. The cap comes from quality-grade (the one source), never a copy of the number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineBudget } from '../src/orchestrator.mjs';
import { MAX_QUALITY_ITERATIONS } from '../tools/quality-grade.mjs';

const CAP = MAX_QUALITY_ITERATIONS;

test('the cap is one initial grade plus two refines', () => assert.equal(CAP, 3));
test('a fresh build (1 grade used) may refine up to cap-1 times', () => assert.equal(refineBudget(5, 1), CAP - 1));
test('one refine already graded leaves one', () => assert.equal(refineBudget(5, 2), CAP - 2));
test('REGRESSION: with the grader cap spent, NO refine pass may run', () => assert.equal(refineBudget(2, CAP), 0));
test('an over-ask is clamped to what the grader will look at', () => assert.equal(refineBudget(99, 1), CAP - 1));
test('asking for none means none', () => assert.equal(refineBudget(0, 1), 0));
test('never negative, even if the counter overshoots', () => assert.equal(refineBudget(2, CAP + 6), 0));
