// tests/diagram-legibility.test.mjs — the deterministic legibility rail (ADR-0012 D5).
//
// A diagram fits to width on a phone, so its on-screen text size is a pure function of its canvas
// width — knowable at Station 4, for free, before a single vision token is spent. Measured on the
// real BHIL-Colophon-Spec page (figure.diagram boundingBox = 312px at a 390px viewport):
//   architecture 732px -> 5.54px · flow 611px -> 6.64px · big-idea 824px -> 4.92px · insight 928px -> 4.37px
// and the ribbon this session's first INV-23 fix produced: 1385px -> 2.9px.
//
// WHAT IS DELIBERATELY NOT ASSERTED: an absolute floor. This repo enforces none, and the four shipped
// diagrams sit at 4.4-6.6px because the page gives each one a tap-to-zoom lightbox. A threshold here
// would be an invented number dressed as a standard. The defensible signal is RELATIVE — a diagram far
// worse than its siblings is an outlier the page design does not account for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(REPO, 'tools', 'make-diagrams.mjs'), 'utf8');

const MOBILE_CONTENT_PX = 312, OUTLIER_RATIO = 0.62;
const legibilityOf = (svg) => {
  const m = /viewBox="0 0 ([0-9.]+)/.exec(svg);
  if (!m) return null;
  const W = Number(m[1]);
  const labels = [...svg.matchAll(/font-size="([0-9.]+)"/g)].map((x) => Number(x[1])).filter((x) => x > 12);
  if (!labels.length || !W) return null;
  return Math.round((Math.min(...labels) * (MOBILE_CONTENT_PX / W)) * 100) / 100;
};
const outliers = (byKey) => {
  const vals = Object.values(byKey).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  return Object.entries(byKey).filter(([, v]) => v < median * OUTLIER_RATIO).map(([k]) => k);
};
const svgOf = (w, fontSize) => `<svg viewBox="0 0 ${w} 400"><text font-size="${fontSize}">x</text></svg>`;

test('legibility — text size is width-driven, and the measurement matches the real page', () => {
  // The four real diagrams, from the actual re-rendered BHIL page.
  assert.equal(legibilityOf(svgOf(732, 13)), 5.54);
  assert.equal(legibilityOf(svgOf(611, 13)), 6.64);
  assert.equal(legibilityOf(svgOf(824, 13)), 4.92);
  assert.equal(legibilityOf(svgOf(928, 13)), 4.37);
});

test('legibility — the 1385px ribbon that broke this session IS flagged as an outlier', () => {
  const page = {
    architectureDiagram: legibilityOf(svgOf(732, 13)),
    flowDiagram: legibilityOf(svgOf(1385, 13)),     // the bad ribbon
    bigIdeaDiagram: legibilityOf(svgOf(824, 13)),
    insightDiagram: legibilityOf(svgOf(766, 13)),
  };
  assert.deepEqual(outliers(page), ['flowDiagram'],
    `the wide ribbon must be flagged; got ${JSON.stringify(page)}`);
});

test('legibility — the CURRENT four-diagram page raises no outlier (no false alarm on good output)', () => {
  const page = {
    architectureDiagram: legibilityOf(svgOf(732, 13)),
    flowDiagram: legibilityOf(svgOf(611, 13)),
    bigIdeaDiagram: legibilityOf(svgOf(824, 13)),
    insightDiagram: legibilityOf(svgOf(928, 13)),
  };
  assert.deepEqual(outliers(page), [],
    `a page whose diagrams are merely small — but uniformly so — must not cry wolf; got ${JSON.stringify(page)}`);
});

test('legibility — eyebrows and captions (small mono) do not drag the measurement down', () => {
  const svg = '<svg viewBox="0 0 600 400"><text font-size="9.5">EYEBROW</text><text font-size="16">Real label</text></svg>';
  assert.equal(legibilityOf(svg), 8.32, 'only card labels (>12px source size) count');
});

test('SOURCE SHAPE — the measurement runs in make-diagrams and is RECORDED, not just logged', () => {
  assert.match(SRC, /function legibilityOf\(/, 'the measurement must exist at Station 4, before any vision spend');
  assert.match(SRC, /mobileLabelPx: legibilityOf\(svg\)/, 'it must be recorded per diagram in build.json (the D4 pattern)');
  assert.match(SRC, /reportLegibility\(merged\)/, 'and reported for the page as a whole');
  assert.match(SRC, /MOBILE_CONTENT_PX = 312/, 'the basis must be the MEASURED page width, not a guess');
});
