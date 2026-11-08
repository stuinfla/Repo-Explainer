// The hero headline must go through inline() (which escapes) — there is no raw-HTML escape hatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

const PAYLOAD = '<img src=x onerror="window.__XSS_FIRED=1">';

test('hero.headlineHtml is ignored: markup in it never reaches the page', () => {
  const dir = makeBuild({ mutate: (c) => { c.content.sections.hero.headlineHtml = PAYLOAD; } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.html, /__XSS_FIRED/, 'headlineHtml must not be rendered at all');
    assert.match(r.html, /<h1>H<\/h1>/, 'the plain headline still renders');
  } finally { cleanup(dir); }
});

test('markup inside hero.headline is escaped, not injected', () => {
  const dir = makeBuild({ mutate: (c) => { c.content.sections.hero.headline = PAYLOAD; } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.html, /<img src=x onerror/, 'a raw <img> from the headline would run script');
    assert.match(r.html, /&lt;img src=x onerror=&quot;window\.__XSS_FIRED=1&quot;&gt;/, 'the payload is shown as inert text');
  } finally { cleanup(dir); }
});
