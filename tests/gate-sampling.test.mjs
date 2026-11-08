// A device whose mean lands within 82+-3 is graded a second time (cost doubles on those pages only); the
// vision cost ledger is cumulative and never prints an unknown model as $0; the local door's hold check
// reads page structure only. All against the real exported functions, grader stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeDevice, isBorderline, mergeSamples, BORDERLINE, visionCost, diagramsStructurallyPresent } from '../tools/quality-grade.mjs';
import { gradeReply, withStubbedGrader, tempCrops, ARGS } from './grader-stub.mjs';

test('borderline band is exactly 82+-3, inclusive', () => {
  assert.deepEqual(BORDERLINE, { center: 82, band: 3 });
  for (const [score, expected] of [[78, false], [79, true], [82, true], [85, true], [86, false]]) {
    assert.equal(isBorderline(gradeReply(score)), expected, `mean ${score}`);
  }
});

test('a clearly good page (mean 95) is graded ONCE; a clearly weak page (mean 60) is graded ONCE', async () => {
  for (const score of [95, 60]) {
    const calls = await withStubbedGrader([gradeReply(score)], async (n) => { await gradeDevice(ARGS(tempCrops())); return n(); });
    assert.equal(calls, 1, `mean ${score}`);
  }
});

test('a borderline page (mean 82) is graded TWICE and the two samples are averaged per axis', async () => {
  const a = gradeReply(80), b = gradeReply(85);
  const { calls, merged } = await withStubbedGrader([a, b], async (n) => {
    const merged = await gradeDevice(ARGS(tempCrops()));
    return { calls: n(), merged };
  });
  assert.equal(calls, 2);
  assert.equal(merged.samples, 2);
  assert.equal(merged.gateA.A1, 83, 'round((80+85)/2)');
  assert.equal(merged.gateB.B5, 83);
});

test('a verdict that flips between the two samples is not a stable YES', async () => {
  const a = gradeReply(82), b = gradeReply(82);
  b.operatorQuestions.makesMeSmile = false;
  b.clarity.flowReadsClearly = false; b.clarity.flowNote = 'blurry';
  const merged = await withStubbedGrader([a, b], () => gradeDevice(ARGS(tempCrops())));
  assert.equal(merged.operatorQuestions.makesMeSmile, false);
  assert.equal(merged.operatorQuestions.approachable, true);
  assert.equal(merged.clarity.flowReadsClearly, false);
  assert.equal(merged.clarity.flowNote, 'blurry', 'the note from the sample that said NO is kept');
});

test('a borderline first sample with a both-FAIL raster: B5 is capped to 55 in that sample, then averaged', async () => {
  const first = gradeReply(85, { rasters: [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL' }] });   // capped mean = (10*85+55)/11 = 82.7 -> borderline
  const second = gradeReply(85);
  const merged = await withStubbedGrader([first, second], () => gradeDevice(ARGS(tempCrops())));
  assert.equal(merged.samples, 2);
  assert.equal(merged.gateB.B5, 70, 'round((55+85)/2)');
});

test('if the second sample fails, the first stands (a second opinion must not turn a graded page ungraded)', async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n > 1) return { ok: false, status: 400, text: async () => 'bad request' };   // a 4xx is not retried
    const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify(gradeReply(82)) } }], usage: {} });
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    const out = await gradeDevice(ARGS(tempCrops()));
    assert.equal(out.gateA.A1, 82);
    assert.equal(out.samples, undefined, 'the first sample is returned unmerged');
    assert.equal(n, 2);
  } finally { globalThis.fetch = real; }
});

test('vision cost: priced model sums across passes; an unknown model is UNPRICED (null), never $0', () => {
  const spend = { usd: 0.5, calls: 2, inTokens: 100, outTokens: 10, unpriced: false };
  const c = visionCost({ usd: 0.25, calls: 2, inTokens: 50, outTokens: 5 }, spend, 'gpt-5.6-sol');
  assert.deepEqual([c.usd, c.calls, c.inTokens, c.outTokens], [0.75, 4, 150, 15]);
  assert.match(c.basis, /derived/);
  const u = visionCost(undefined, { ...spend, unpriced: true }, 'other-model');
  assert.equal(u.usd, null);
  assert.match(u.basis, /UNPRICED/);
  assert.equal(visionCost({ usd: null, calls: 1 }, { ...spend }, 'gpt-5.6-sol').usd, null, 'once unpriced, the running total stays unpriced');
});

test('diagramsStructurallyPresent: DOM facts only, every device must have the architecture diagram present and visible', () => {
  const ok = { inv18: { architecturePresent: true, architectureVisible: true, passed: false } };   // vision said unclear: still structurally present
  assert.equal(diagramsStructurallyPresent([ok, ok]), true, 'a vision "unclear" verdict alone can never hold a page');
  assert.equal(diagramsStructurallyPresent([ok, { inv18: { architecturePresent: true, architectureVisible: false } }]), false);
  assert.equal(diagramsStructurallyPresent([ok, { inv18: { architecturePresent: false, architectureVisible: false } }]), false);
  assert.equal(diagramsStructurallyPresent([]), false);
  assert.equal(diagramsStructurallyPresent(undefined), false);
  assert.equal(diagramsStructurallyPresent([{ inv18: { passed: true } }]), false, 'a bare passed:true is not DOM evidence');
});
