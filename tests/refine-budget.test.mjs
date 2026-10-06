// refineBudget — how many content re-authors can still be GRADED.
//
// 2026-09-17 (ruvnet/ruos): the build had already spent its grades when the refine loop started, so it
// re-authored the page TWICE with a full brain call each time, and quality-grade then refused to look
// at either ("REFINE CAP REACHED (3/3) — returning the last scorecard unchanged"). Two paid rewrites
// nobody read. The loop clamped to the grader's cap but never asked how many grades were already used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineBudget } from '../src/orchestrator.mjs';

test('a fresh build (1 grade used) may refine twice', () => assert.equal(refineBudget(2, 1), 2));
test('one refine already graded leaves one', () => assert.equal(refineBudget(2, 2), 1));
test('REGRESSION: with the grader cap spent, NO refine pass may run', () => assert.equal(refineBudget(2, 3), 0));
test('an over-ask is clamped to what the grader will actually look at', () => assert.equal(refineBudget(5, 1), 2));
test('asking for none means none', () => assert.equal(refineBudget(0, 1), 0));
test('never negative, even if the counter overshoots', () => assert.equal(refineBudget(2, 9), 0));
