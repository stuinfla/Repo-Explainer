// tests/raster-cap.test.mjs — INV-22's raster cap is ARITHMETIC, not a plea (ADR-0012 D5).
//
// THE INCIDENT (2026-08-04, PolymathWizard/BHIL-Colophon-Spec, run 30865218481): the rubric caps B5
// at 55 only when a raster fails BOTH the takeaway test AND the swap test. The grader summarised a
// hero image as "a generic desk-and-invoice scene" and applied the cap — but the image showed
// labelled binders (ACME-2026-Q3, RUBICON-2026-Q1), a legible handwritten note reading "Signal Decay
// Curve — worth keeping?", and THE SAME NOTE faded and fallen on the floor: the project's entire
// thesis (a finding recorded, then lost) told in pixels. It plainly passed the takeaway test. The
// misapplied cap put B5 below the 70 ship floor and destroyed a $6.51 build.
//
// The first fix was a prompt instruction asking the model to state both verdicts before capping.
// That violated ADR-0012 D5 ("a property code can decide is decided in code") — so the verdicts are
// now structured output and the CAP is arithmetic over them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(REPO, 'tools', 'quality-grade.mjs'), 'utf8');

// applyRasterCap is module-private (quality-grade.mjs runs main() on import), so this reproduces its
// exact contract and pins the SOURCE shape alongside — the pattern the 2026-07-19 lesson prescribes
// for a cross-file mechanism that must not silently rot.
function applyRasterCap(deviceLabel, graded) {
  const rasters = Array.isArray(graded.rasters) ? graded.rasters : null;
  if (!rasters || !rasters.length) return { b5: graded.gateB.B5, capped: false, note: null };
  const isFail = (v) => String(v || '').trim().toUpperCase() === 'FAIL';
  const bothFail = rasters.filter((r) => isFail(r.takeaway) && isFail(r.swappable));
  const reportedB5 = graded.gateB.B5;
  if (bothFail.length) return { b5: Math.min(reportedB5, 55), capped: true, note: 'capped' };
  if (reportedB5 <= 55) return { b5: reportedB5, capped: false, note: 'DISAGREEMENT' };
  return { b5: reportedB5, capped: false, note: null };
}

const g = (b5, rasters) => ({ gateB: { B5: b5 }, rasters });

test('INV-22 — the cap fires ONLY when a raster fails BOTH tests', () => {
  const r = applyRasterCap('mobile(390)', g(90, [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL' }]));
  assert.equal(r.capped, true);
  assert.equal(r.b5, 55, 'B5 must be capped at 55');
});

test('INV-22 — a raster that passes TAKEAWAY is not capped, however stock-looking (the 2026-08-04 image)', () => {
  // The real image: teaches the project's thesis from the pixels, but reads as a common desk genre.
  const r = applyRasterCap('desktop(1440)', g(88, [
    { what: 'hero cabinet/receipt scene', takeaway: 'PASS', swappable: 'FAIL' },
  ]));
  assert.equal(r.capped, false, 'failing only the swap test must NOT trigger the cap');
  assert.equal(r.b5, 88, 'B5 must survive intact — this is the build that should not have died');
});

test('INV-22 — failing only the SWAP test across several rasters still never caps', () => {
  const r = applyRasterCap('mobile(390)', g(84, [
    { what: 'hero', takeaway: 'PASS', swappable: 'FAIL' },
    { what: 'problem photo', takeaway: 'PASS', swappable: 'FAIL' },
  ]));
  assert.equal(r.capped, false);
  assert.equal(r.b5, 84);
});

test('INV-22 — the cap never RAISES a score (a genuinely worse B5 is left alone)', () => {
  const r = applyRasterCap('mobile(390)', g(40, [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL' }]));
  assert.equal(r.b5, 40, 'Math.min — a 40 stays 40; the cap is a ceiling, never a floor');
});

test('INV-22 — a cap applied despite passing verdicts is a LOGGED DISAGREEMENT, not a silent number', () => {
  // Exactly the 2026-08-04 shape: the grader scored at the cap while its own verdicts say otherwise.
  const r = applyRasterCap('desktop(1440)', g(55, [{ what: 'hero', takeaway: 'PASS', swappable: 'FAIL' }]));
  assert.equal(r.note, 'DISAGREEMENT',
    'a grader whose number contradicts its own recorded verdicts must be surfaced, not trusted silently');
  assert.equal(r.b5, 55,
    'but do NOT silently repair the score upward — B5 can be legitimately low for non-raster reasons');
});

test('INV-22 — no raster verdicts reported (older grader output) changes nothing', () => {
  assert.equal(applyRasterCap('mobile(390)', { gateB: { B5: 77 }, rasters: [] }).b5, 77);
  assert.equal(applyRasterCap('mobile(390)', { gateB: { B5: 77 } }).b5, 77);
});

// ── SOURCE-SHAPE PINS ────────────────────────────────────────────────────────────────────────────
test('SOURCE SHAPE — the cap is applied in CODE and the schema asks for the structured verdicts', () => {
  assert.match(SRC, /function applyRasterCap\(/, 'the cap must exist as a function, not only as prose in the prompt');
  assert.match(SRC, /graded\.gateB\.B5 = rasterCap\.b5/, 'buildScorecard must actually apply the arithmetic result');
  assert.match(SRC, /"rasters":\s*\[/, 'RESPONSE_SPEC must request per-raster takeaway/swappable verdicts');
  assert.match(SRC, /"takeaway": "PASS\|FAIL"/, 'verdicts must be a constrained enum, not free prose');
});
