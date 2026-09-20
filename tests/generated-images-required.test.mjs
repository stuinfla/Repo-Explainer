import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../tools/assemble-page.mjs', import.meta.url), 'utf8');

test('assembly makes the generated hero and section images mandatory', () => {
  assert.match(src, /visuals\.hero \(MANDATORY generated image\)/);
  assert.match(src, /at least one generated section image is MANDATORY/);
  assert.match(src, /must include a visible problem or use-case generated image/);
});

test('a problem SVG cannot hide a successfully generated problem raster', () => {
  assert.doesNotMatch(src, /problemVisual[\s\S]{0,180}\?\s*visuals\.problemVisual[\s\S]{0,180}:\s*\(problemImg/,
    'exclusive SVG-or-raster fallback silently hides the generated image');
  assert.match(src, /problemImg \? figureHtml\(problemImg\.file/);
});
