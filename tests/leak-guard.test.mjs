// assemble-page's unresolved-token guard, exercised through the REAL assembler (no mirrored regex).
// Rule: a leaked sentinel screams (TODO / PLACEHOLDER / FIXME / {{x}} / ${x} / [object Object] / a bare
// `undefined`|`NaN` that ENDS a phrase); the English words for the same things are fine; a table or
// definition cell whose whole content is a bare value is API documentation, not a leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

function run(mutate) {
  const dir = makeBuild({ mutate });
  try { return assemble(dir); } finally { cleanup(dir); }
}
const prose = (text) => run((c) => { c.content.sections.problem.paragraphs = [text]; });
const clean = (text) => { const r = prose(text); assert.equal(r.status, 0, `"${text}" must render (stderr: ${r.stderr.slice(0, 200)})`); };
const leaks = (text, tokenRe) => {
  const r = prose(text);
  assert.equal(r.status, 1, `"${text}" must be refused`);
  assert.match(r.stderr, /unresolved token \/ placeholder leaked into the page/);
  if (tokenRe) assert.match(r.stderr, tokenRe, 'the error names the offending token');
};

test('REAL COPY that killed the p-map build renders (English "placeholder" is not a leak)', () => {
  clean('When your mapper returns the sentinel value pMapSkip, that slot is simply omitted from the results array — no placeholder, no error, just a silently dropped entry.');
});

test('other legitimate prose the old case-insensitive guard killed', () => {
  clean('A todo list app for teams.');
  clean('Reading it is undefined behaviour in C++.');
  clean('Nan bread recipes, sorted.');
});

test('GENUINE leaks are refused, and the error names the token', () => {
  leaks('Hello {{name}}', /\{\{/);
  leaks('Cost: ${price}', /\$\{/);
  leaks('Author: [object Object]', /\[object Object\]/);
  leaks('Version: undefined', /undefined/);
  leaks('Score: NaN', /NaN/);
  leaks('TODO: write the intro', /TODO/);
  leaks('PLACEHOLDER', /PLACEHOLDER/);
  leaks('FIXME later', /FIXME/);
  leaks('Lorem Ipsum dolor sit amet', /Lorem Ipsum/);
});

test('the distinction IS the case — same word, two verdicts', () => {
  clean('no placeholder, no error');
  leaks('no PLACEHOLDER, no error', /PLACEHOLDER/);
});

test('a documented default in an options table is NOT a leak (the real p-map row)', () => {
  const r = run((c) => { c.content.sections.whatItIs.table = { head: ['option', 'type', 'default'], rows: [['signal', 'AbortSignal', 'undefined'], ['x', 'n', 'NaN'], ['y', 'z', 'null']] }; });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.html, /<td>AbortSignal<\/td>/, 'the table really rendered');
});

test('masking does not blind the guard: a leak outside a bare value cell is still refused', () => {
  const heading = run((c) => { c.content.sections.insight.title = 'undefined'; });
  assert.equal(heading.status, 1, 'a heading is not a value cell');
  const cell = run((c) => { c.content.sections.whatItIs.table = { head: ['who'], rows: [['Built by undefined']] }; });
  assert.equal(cell.status, 1, 'a sentence ending in a leaked value is corruption even inside a cell');
});

test('a failed render leaves no index.html behind', () => {
  const r = prose('PLACEHOLDER');
  assert.equal(r.html, null);
});
