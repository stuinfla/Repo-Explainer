// tests/leak-guard.test.mjs — assemble-page's unresolved-token guard (found 2026-08-08).
//
// THE BUG: the guard used ONE case-insensitive regex, so `\bPLACEHOLDER\b/i` matched the ordinary
// English word. A real local build of sindresorhus/p-map died at assemble-page on a page that was
// completely fine, because the copy legitimately read: "…that slot is simply omitted from the
// results array — no placeholder, no error, just a silently dropped entry" (describing pMapSkip).
//
// Same latent fault on its siblings: /i made \bTODO\b fail any page about a to-do app, and
// `undefined` fail any JS page discussing undefined behaviour. A guard that cannot tell a leaked
// sentinel from the English word for one will keep killing good builds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The shipped rule, mirrored (the guard is inline in assemble-page's render path).
const leakCase = /\{\{|\}\}|\$\{|\[object Object\]|(?:^|[\s">:])(?:undefined|NaN)(?!\s+[a-z])(?:[\s"<.,;)]|$)|\bTODO\b|\bPLACEHOLDER\b|\bFIXME\b/;
const leakAny = /lorem ipsum/i;
const leaks = (html) => Boolean(html.match(leakCase) || html.match(leakAny));

test('REAL COPY that killed the p-map build must now pass', () => {
  const real = '<p>When your mapper returns the sentinel value pMapSkip, that slot is simply omitted from the '
    + 'results array — no placeholder, no error, just a silently dropped entry.</p>';
  assert.equal(leaks(real), false, 'ordinary English "placeholder" is not a leaked token');
});

test('other legitimate prose the old guard would have killed', () => {
  assert.equal(leaks('<p>A todo list app for teams.</p>'), false, 'lowercase "todo" is a real word');
  assert.equal(leaks('<p>Reading it is undefined behaviour in C++.</p>'), false, '"undefined behaviour" is prose');
  assert.equal(leaks('<p>Nan bread recipes, sorted.</p>'), false, '"Nan" is not the number NaN');
});

test('GENUINE leaks are still caught — the guard must still guard', () => {
  assert.equal(leaks('<p>Hello {{name}}</p>'), true, 'handlebars token');
  assert.equal(leaks('<p>Cost: ${price}</p>'), true, 'unevaluated template literal');
  assert.equal(leaks('<p>Author: [object Object]</p>'), true, 'stringified object');
  assert.equal(leaks('<p>Version: undefined</p>'), true, 'a leaked JS undefined');
  assert.equal(leaks('<p>Score: NaN</p>'), true, 'a leaked NaN');
  assert.equal(leaks('<p>TODO: write the intro</p>'), true, 'a screaming sentinel');
  assert.equal(leaks('<p>PLACEHOLDER</p>'), true, 'the actual sentinel this rule exists for');
  assert.equal(leaks('<p>FIXME later</p>'), true);
  assert.equal(leaks('<p>Lorem Ipsum dolor sit amet</p>'), true, 'filler slop in any casing');
});

test('the distinction IS the case — same word, two verdicts', () => {
  assert.equal(leaks('<p>no placeholder, no error</p>'), false);
  assert.equal(leaks('<p>no PLACEHOLDER, no error</p>'), true);
});

// ── DOCUMENTED DEFAULTS ARE NOT LEAKS (found 2026-08-09 on a real p-map build) ──────────────────
// p-map's options table correctly documents `signal`'s default as `undefined`. The guard read its
// own API reference as corruption and killed a perfect page. `undefined` is genuinely ambiguous in
// documentation and the PATTERN cannot resolve it — the CONTEXT can: a cell whose entire content is
// a bare value is documentation; the same word in prose or a heading is still a leak.
const mask = (html) => html
  .replace(/<pre[\s\S]*?<\/pre>/gi, '')
  .replace(/<code[\s\S]*?<\/code>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<(td|dd)\b[^>]*>\s*(undefined|NaN|null)\s*<\/\1>/gi, '<$1>—</$1>');
const leaksCtx = (html) => leaks(mask(html));

test('a documented default in an options table is NOT a leak (the real p-map row)', () => {
  const row = '<tr><td>signal</td><td>AbortSignal</td><td>undefined</td>'
    + '<td>Standard JavaScript signal for cancelling the entire operation mid-flight</td></tr>';
  assert.equal(leaksCtx(row), false, "p-map's signal default is documentation, not corruption");
});

test('the same masking covers definition lists and the other bare values', () => {
  assert.equal(leaksCtx('<dl><dt>concurrency</dt><dd>undefined</dd></dl>'), false);
  assert.equal(leaksCtx('<td>NaN</td>'), false);
  assert.equal(leaksCtx('<td>null</td>'), false);
});

test('but a leak OUTSIDE a value cell is still caught — masking must not blind the guard', () => {
  assert.equal(leaksCtx('<h2>undefined</h2>'), true, 'a heading is not a value cell');
  assert.equal(leaksCtx('<p>Version: undefined</p>'), true, 'prose is still scanned');
  // A cell whose sentence TERMINATES in a leaked value is a leak — the interpolation failed at the
  // end of the string. (A cell reading "Version undefined was released" is prose and correctly
  // passes, by the same rule that lets "undefined behaviour" through.)
  assert.equal(leaksCtx('<td>Built by undefined</td>'), true,
    'a sentence ending in a leaked value is still corruption, masking or not');
});
