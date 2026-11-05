// Inline-link scheme allowlist, exercised through the REAL assembler: a script-capable scheme (any case,
// any whitespace/control-char obfuscation) must never become an href; http(s)/mailto/relative links survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

function render(md) {
  const dir = makeBuild({ mutate: (c) => { c.content.sections.problem.paragraphs = [md]; } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr.slice(0, 300));
    return r.html;
  } finally { cleanup(dir); }
}
// every href/src attribute value in the page body, lower-cased and stripped of whitespace/control chars,
// the way a browser normalises a scheme before dispatching it
const hrefs = (html) => [...html.matchAll(/\b(?:href|src)="([^"]*)"/gi)]
  .map((m) => m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/[\s\u0000-\u001f]/g, '').toLowerCase());
const dangerous = (html) => hrefs(html).filter((h) => /^(javascript|data|vbscript):/.test(h));

const PAYLOADS = [
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)',
  '[x](DATA:text/html;base64,PHNjcmlwdD4=)',
  '[x](vbscript:msgbox(1))',
  '[x](VbScRiPt:msgbox(1))',
  '[x]( javascript:alert(1))',
  '[x](java\tscript:alert(1))',
  '[x](JaVa\tScRiPt:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](\u0001javascript:alert(1))',
];

test('script-capable link schemes never reach an href, whatever the case or obfuscation', () => {
  for (const p of PAYLOADS) {
    const html = render(`before ${p} after`);
    assert.deepEqual(dangerous(html), [], `${JSON.stringify(p)} produced a dangerous href`);
    assert.ok(!/href="\s*(?:javascript|data|vbscript):/i.test(html), `${JSON.stringify(p)} raw href survived`);
  }
});

test('a neutralised link keeps its visible text and points at "#"', () => {
  const html = render('see [click me](javascript:alert(1)) now');
  assert.match(html, /<a href="#">click me<\/a>/);
});

test('legitimate links still render', () => {
  const html = render('[a](https://example.com/x) [b](http://example.com/y) [c](mailto:me@example.com) [d](/docs/x) [e](#how-it-works)');
  assert.match(html, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener">a<\/a>/);
  assert.match(html, /<a href="http:\/\/example\.com\/y" target="_blank" rel="noopener">b<\/a>/);
  assert.match(html, /<a href="mailto:me@example\.com">c<\/a>/);
  assert.match(html, /<a href="\/docs\/x">d<\/a>/);
  assert.match(html, /<a href="#how-it-works">e<\/a>/);
});
