// theme-contrast.test.mjs — the CTA label must be readable on ANY brain-chosen accent.
//
// Regression: `.cta` paints its label with `--on-accent` over `--spectrum` (falling back to
// `--accent`). The design-system skeleton hard-codes `--on-accent: #0a0a12` (near-black), but the
// per-repo theme overrides the fill freely. A dark accent therefore produced near-black text on a
// near-black button — an invisible CTA. buildTheme() now derives the ink by measuring WCAG
// contrast against the real fill, and refuses a sub-AA explicit choice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTheme, contrast, parseColors } from '../tools/assemble-page.mjs';

const AA = 4.5;
const DARK_INK = '#0a0a12';
const LIGHT_INK = '#f7f8fc';

// buildTheme narrates its derivation on stderr; keep the test output clean.
function quiet(fn) {
  const orig = process.stderr.write;
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stderr.write = orig; }
}
const onAccent = (palette) => {
  const { css } = quiet(() => buildTheme({ palette }));
  const m = css.match(/--on-accent:\s*([^;]+);/);
  return m ? m[1].trim() : null;
};
// worst-case contrast of `ink` across every colour stop in `fill`
const worst = (fill, ink) => Math.min(...parseColors(fill).map((f) => contrast(f, parseColors(ink)[0])));

test('dark accent with no on-accent set → light ink is derived, and it clears AA', () => {
  const fill = '#0b1020';
  assert.equal(onAccent({ accent: fill }), LIGHT_INK);
  assert.ok(worst(fill, LIGHT_INK) >= AA, `derived ink must clear AA, got ${worst(fill, LIGHT_INK)}`);
});

test('light accent with no on-accent set → dark ink is derived, and it clears AA', () => {
  const fill = '#ffd166';
  assert.equal(onAccent({ accent: fill }), DARK_INK);
  assert.ok(worst(fill, DARK_INK) >= AA);
});

test('a --spectrum gradient wins over --accent, and every stop is considered', () => {
  // accent is light, but the actual button fill (spectrum) is dark at both stops.
  const spectrum = 'linear-gradient(90deg,#0b1020,#111827)';
  assert.equal(onAccent({ accent: '#ffd166', spectrum }), LIGHT_INK);
  assert.ok(worst(spectrum, LIGHT_INK) >= AA);
});

test('REGRESSION: an explicit sub-AA on-accent is overridden, not shipped', () => {
  // This is the exact bug: dark accent + the skeleton's near-black ink = invisible label.
  const fill = '#0b1020';
  assert.ok(worst(fill, DARK_INK) < AA, 'fixture must actually be a failing combination');
  assert.equal(onAccent({ accent: fill, 'on-accent': DARK_INK }), LIGHT_INK);
});

test('an explicit on-accent that already clears AA is respected', () => {
  assert.equal(onAccent({ accent: '#0b1020', 'on-accent': '#ffffff' }), '#ffffff');
});

test('a non-colour fill (var() only) leaves --on-accent to the skeleton default', () => {
  // Nothing parseable to measure against → do not invent a token.
  assert.equal(onAccent({ accent: 'var(--brand)' }), null);
});
