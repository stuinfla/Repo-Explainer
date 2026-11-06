// The narrated overview must survive a re-assemble (refine pass, resumed build): live ruvllm lost its video
// because make-overview was the only code that ever put the band into the HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';
import { injectOverview, overviewBlock } from '../src/overview-block.mjs';

const withAssets = (d, files) => { const a = path.join(d, 'site', 'assets'); fs.mkdirSync(a, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(a, f), 'x'); };
const OV = { path: 'assets/overview.mp4', format: 'brief', durationSec: 75.3, infographic: { path: 'assets/overview-infographic.jpg' }, injected: true };

test('assemble-page re-injects the overview band from the overview slot, with the infographic', () => {
  const dir = makeBuild({ mutate: (ctx, d) => { ctx.overview = OV; withAssets(d, ['overview.mp4', 'overview-poster.jpg', 'overview-infographic.jpg']); } });
  try {
    const r = assemble(dir); assert.equal(r.status, 0, r.stderr);
    assert.match(r.html, /<section class="overview-band" data-overview aria-label="A 75-second narrated overview of /);
    assert.match(r.html, /<source src="assets\/overview\.mp4" type="video\/mp4">/);
    assert.match(r.html, /<img src="assets\/overview-infographic\.jpg"/);
    assert.ok(r.html.indexOf('data-overview') < r.html.indexOf('<div class="sections">'), 'the band sits before the sections');
  } finally { cleanup(dir); }
});

test('no band when the overview was skipped, or when its files are not in the site (never a dangling video)', () => {
  const skipped = makeBuild({ mutate: (ctx, d) => { ctx.overview = { skipped: 'no video' }; withAssets(d, ['overview.mp4', 'overview-poster.jpg']); } });
  const missing = makeBuild({ mutate: (ctx) => { ctx.overview = OV; } });
  try {
    for (const d of [skipped, missing]) { const r = assemble(d); assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.html, /data-overview|<video/); }
  } finally { cleanup(skipped); cleanup(missing); }
});

test('injectOverview is idempotent and says why it could not place the band', () => {
  const page = '<main><div class="sections"></div></main>';
  const once = injectOverview(page, { name: 'n', url: 'https://github.com/o/n', secs: 60 });
  assert.equal(once.injected, true);
  assert.equal(injectOverview(once.html, { name: 'n', url: 'https://github.com/o/n', secs: 60 }).html, once.html);
  assert.match(injectOverview('<main></main>', { name: 'n', url: 'u', secs: 1 }).reason, /anchor/);
  assert.doesNotMatch(overviewBlock({ name: '<b>"x"', url: '"><script>', secs: 5 }), /<b>|<script>/, 'name and url are escaped');
});
