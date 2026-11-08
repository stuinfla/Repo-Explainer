// The grader's element crops must hide the sticky header, or a figure taller than the phone viewport is judged
// with the header sitting on top of it. Behavioural guard: the crop section of quality-grade must add and remove
// the hiding style around the diagram crops.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../tools/quality-grade.mjs', import.meta.url), 'utf8');
test('diagram crops hide the sticky header and restore it afterwards', () => {
  const add = src.indexOf("st.id = 'grade-hide-head'");
  const firstCrop = src.indexOf('for (const d of diagSpecs)');
  const lastCrop = src.indexOf('for (let i = 0; i < conceptN; i++)');
  const remove = src.indexOf("getElementById('grade-hide-head')?.remove()");
  assert.ok(add > -1 && add < firstCrop, 'header is hidden before the first diagram crop');
  assert.ok(remove > lastCrop, 'header is restored after the last concept crop');
});
