// Owner rule (2026-10-13): anything that names a link must BE a link, and an external link opens in a
// new tab. The source repo's address in the page's top banner was plain <code> text on every build —
// "super easy fix ... you should be making in every standard that you build".
// This builds a real page through assemble-page and audits the output, so any future surface that
// prints a URL without linking it (or links out without target=_blank rel=noopener) fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

function build() {
  const dir = makeBuild();
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    return r.html;
  } finally { cleanup(dir); }
}

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<head[\s\S]*?<\/head>/i, '');

test('every external anchor opens in a new tab with rel=noopener', () => {
  const html = build();
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>/gi)];
  assert.ok(anchors.length > 0, 'the page must contain external links for this audit to mean anything');
  const bad = anchors.filter((m) => !/target="_blank"/.test(m[0]) || !/rel="[^"]*noopener/.test(m[0])).map((m) => m[1]);
  assert.deepEqual(bad, [], `external links missing target=_blank / rel=noopener: ${bad.join(', ')}`);
});

test('no URL-looking text appears outside a link', () => {
  const body = strip(build()).replace(/<a\b[\s\S]*?<\/a>/gi, ' ');   // drop everything that IS a link
  const text = body.replace(/<[^>]+>/g, ' ');
  const hits = [...text.matchAll(/\bhttps?:\/\/[^\s<>"')]+|\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|dev|org|net)\/[^\s<>"')]*/gi)].map((m) => m[0]);
  assert.deepEqual(hits, [], `URL text that is not a hot link: ${hits.join(', ')}`);
});

test('the top banner shows the source repo as a clickable link to it', () => {
  const html = build();
  const banner = html.match(/<p class="prov-live">[\s\S]*?<\/p>/)[0];
  assert.match(banner, /<a href="https:\/\/github\.com\/o\/r"[^>]*target="_blank"[^>]*>/, 'the source address must be a link to the repo');
});
