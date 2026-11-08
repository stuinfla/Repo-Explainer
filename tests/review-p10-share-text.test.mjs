// og:/twitter: titles and descriptions come from the REAL assembler: <= 70 / <= 200 chars, cut at a word
// boundary, never an ellipsis ("…Promote noth…" shipped on the live ruvllm page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';
import { fitText, fitTitle } from '../tools/assemble-page.mjs';
import { metaContent } from '../src/site-check.mjs';

const TAG = 'Edit weights under evidence. Roll back exactly. Promote nothing alone.';
function page(mutate) {
  const dir = makeBuild({ mutate });
  try { const r = assemble(dir); assert.equal(r.status, 0, r.stderr.slice(0, 300)); return r.html; } finally { cleanup(dir); }
}

test('the ruvllm case through the real assembler: title <= 70, whole sentences, no ellipsis, same on twitter:', () => {
  const html = page((c) => { c.repo.name = 'ruvllm'; c.concept.tagline = TAG; });
  for (const k of ['og:title', 'twitter:title']) {
    const t = metaContent(html, k);
    assert.equal(t, 'ruvllm — Edit weights under evidence. Roll back exactly');
    assert.ok(t.length <= 70 && !/…|\.\.\.$/.test(t));
  }
  assert.ok(!/…/.test(html.match(/<head>[\s\S]*<\/head>/)[0]), 'no ellipsis anywhere in <head>');
});

test('one very long unbroken sentence is cut at a word boundary with no dangling connector', () => {
  const t = fitTitle('p-map', 'Run many promise-returning and async functions concurrently and keep the order of results exactly', null);
  assert.ok(t.length <= 70, `${t.length}`);
  assert.match(t, /^p-map — Run many promise-returning/);
  assert.ok(!/(?:\s(?:and|or|the|a|of|to|with))$/i.test(t) && !/…/.test(t), t);
  assert.ok(`${'Run many promise-returning and async functions concurrently and keep the order of results exactly'}`.includes(t.slice('p-map — '.length)), 'a true prefix of the tagline: cut on a word, not mid-word');
});

test('an authored meta.title that fits is kept; one that is too long is replaced, never clipped', () => {
  assert.equal(fitTitle('foo', 'tag', 'Foo: the short authored title'), 'Foo: the short authored title');
  const t = fitTitle('foo', 'A short tagline', 'x '.repeat(60));
  assert.equal(t, 'foo — A short tagline');
});

test('descriptions: <= 200, sentence- then word-boundary, no ellipsis; short ones untouched', () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} says something useful.`).join(' ');
  const d = fitText(long, 200);
  assert.ok(d.length <= 200 && d.length > 150 && d.endsWith('.'), `${d.length}: ${d}`);
  const noStops = 'word '.repeat(80).trim();
  const w = fitText(noStops, 200);
  assert.ok(w.length <= 200 && w.length > 190 && !w.endsWith('…') && /word$/.test(w));
  assert.equal(fitText('Short one.', 200), 'Short one.');
  const html = page((c) => { c.concept.tagline = long; });
  assert.ok(metaContent(html, 'og:description').length <= 200);
  assert.ok(metaContent(html, 'description').length <= 200);
});
