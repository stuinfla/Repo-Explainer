// INV-22: the raster cap is arithmetic over the grader's structured verdicts, applied in code (ADR-0012 D5).
// B5 is capped at 55 ONLY when a raster fails BOTH the takeaway and the swap test; a cap that contradicts the
// grader's own verdicts is logged, not trusted silently. These tests run the REAL functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRasterCap, buildScorecard, gradeCrops, RESPONSE_SPEC } from '../tools/quality-grade.mjs';
import { gradeReply, withStubbedGrader, tempCrops, ARGS } from './grader-stub.mjs';

const g = (b5, rasters) => ({ gateB: { B5: b5 }, rasters });

test('the cap fires ONLY when a raster fails BOTH tests, and lands on exactly 55', () => {
  const r = applyRasterCap('mobile(390)', g(90, [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL' }]));
  assert.equal(r.capped, true);
  assert.equal(r.b5, 55);
  assert.match(r.note, /1 raster\(s\) failed BOTH tests \(hero\)/);
});

test('a raster that passes TAKEAWAY is never capped, however stock-looking (the 2026-08-04 image)', () => {
  const r = applyRasterCap('desktop(1440)', g(88, [{ what: 'hero cabinet/receipt scene', takeaway: 'PASS', swappable: 'FAIL' }]));
  assert.equal(r.capped, false);
  assert.equal(r.b5, 88);
  assert.equal(r.note, null);
});

test('failing only the SWAP test across several rasters never caps', () => {
  const r = applyRasterCap('mobile(390)', g(84, [
    { what: 'hero', takeaway: 'PASS', swappable: 'FAIL' }, { what: 'problem', takeaway: 'PASS', swappable: 'FAIL' }]));
  assert.deepEqual([r.capped, r.b5], [false, 84]);
});

test('the cap is a ceiling: a worse B5 stays; a B5 of 56 is lowered to 55; a verdict string is case-insensitive', () => {
  assert.equal(applyRasterCap('m', g(40, [{ takeaway: 'FAIL', swappable: 'FAIL' }])).b5, 40);
  assert.equal(applyRasterCap('m', g(56, [{ takeaway: 'FAIL', swappable: 'FAIL' }])).b5, 55);
  assert.equal(applyRasterCap('m', g(90, [{ takeaway: ' fail ', swappable: 'Fail' }])).capped, true);
});

test('a B5 at/below the cap while every raster passed one test is a LOGGED DISAGREEMENT, score untouched', () => {
  const r = applyRasterCap('desktop(1440)', g(55, [{ what: 'hero', takeaway: 'PASS', swappable: 'FAIL' }]));
  assert.match(r.note, /INV-22 DISAGREEMENT on desktop\(1440\): B5=55/);
  assert.equal(r.b5, 55);
  assert.equal(applyRasterCap('d', g(56, [{ takeaway: 'PASS', swappable: 'FAIL' }])).note, null, '56 is above the cap: no disagreement');
});

test('no raster verdicts (older grader output) changes nothing', () => {
  assert.equal(applyRasterCap('m', { gateB: { B5: 77 }, rasters: [] }).b5, 77);
  assert.equal(applyRasterCap('m', { gateB: { B5: 77 } }).b5, 77);
});

test('RESPONSE_SPEC asks the grader for the structured per-raster verdicts', () => {
  assert.match(RESPONSE_SPEC, /"rasters":\s*\[/);
  assert.match(RESPONSE_SPEC, /"takeaway": "PASS\|FAIL"/);
  assert.match(RESPONSE_SPEC, /"swappable": "PASS\|FAIL"/);
});

// D1: gradeCrops used to DROP the rasters field, so the cap above never ran in production.
test('D1: gradeCrops returns the grader\'s raster verdicts (the cap needs them)', async () => {
  const rasters = [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL', why: 'a laptop' }];
  const out = await withStubbedGrader([gradeReply(90, { rasters })], () => gradeCrops(ARGS(tempCrops())));
  assert.deepEqual(out.rasters, rasters);
});

test('D1: end to end — a both-FAIL raster in the grader reply caps B5 at 55 in the scorecard', async () => {
  const rasters = [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL', why: 'generic' }];
  const graded = await withStubbedGrader([gradeReply(90, { rasters })], () => gradeCrops(ARGS(tempCrops())));
  const { scorecard } = buildScorecard('mobile(390)', graded, { architecturePresent: true, architectureVisible: true, flowPresent: true, flowVisible: true }, 'x.png', []);
  assert.equal(scorecard.gateB.B5, 55);
  assert.equal(scorecard.headlineScore, 55);
  assert.equal(scorecard.passed, false, 'min 55 is under the 70 ship floor');
});
