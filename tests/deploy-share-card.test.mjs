// The share card must point at the host the page is actually served from (a NETLIFY_SITE_NAME override or a
// cross-owner rename changes it after assemble), and must be verified LIVE after deploy. Real helpers, real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retargetHost, verifyShareCardLive } from '../tools/deploy.mjs';
import { checkSite, blockingFailures } from '../src/site-check.mjs';
import { pngBuffer } from './helpers/png.mjs';

const BAKED = 'foo-explainer.netlify.app', REAL = 'helix-explainer.netlify.app';
function page() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-card-'));
  fs.mkdirSync(path.join(d, 'assets'));
  fs.writeFileSync(path.join(d, 'assets', 'card.png'), pngBuffer(1200, 630));
  const t = (k, v) => `<meta property="${k}" content="${v}">`;
  fs.writeFileSync(path.join(d, 'index.html'), `<!doctype html><html lang="en"><head><title>Foo explainer</title>
<meta name="description" content="A description that is certainly longer than twenty characters"><meta name="viewport" content="width=device-width">
${t('og:title', 'foo — Fast')}${t('og:description', 'Fast things')}${t('og:url', `https://${BAKED}/`)}${t('og:image', `https://${BAKED}/assets/card.png`)}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="foo — Fast"><meta name="twitter:image" content="https://${BAKED}/assets/card.png"></head><body>x</body></html>`);
  fs.writeFileSync(path.join(d, 'sitemap.xml'), `<loc>https://${BAKED}/</loc>`);
  return d;
}
const blocking = (d, host) => blockingFailures(checkSite(d, { host })).map((f) => f.msg);

test('a renamed site FAILS the host check before the rewrite and passes after it', () => {
  const d = page();
  const before = blocking(d, REAL);
  assert.ok(before.length >= 1 && before.every((m) => /og:image|twitter:image/.test(m)), 'old behaviour: card points at the wrong host: ' + before.join(' / '));
  const r = retargetHost(d, REAL);
  assert.deepEqual(r, { rewritten: true, from: BAKED });
  assert.deepEqual(blocking(d, REAL), []);
  const html = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.ok(!html.includes(BAKED) && html.includes(`https://${REAL}/assets/card.png`));
  assert.match(fs.readFileSync(path.join(d, 'sitemap.xml'), 'utf8'), new RegExp(REAL));
});

test('an unchanged host is left alone', () => {
  const d = page();
  const before = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.deepEqual(retargetHost(d, BAKED), { rewritten: false, from: BAKED });
  assert.equal(fs.readFileSync(path.join(d, 'index.html'), 'utf8'), before);
});

const png = pngBuffer(1200, 630);
const res = (status, type, body = png) => ({ ok: status < 400, status, headers: { get: () => type }, arrayBuffer: async () => body });
const LIVE = `https://${BAKED}`;

test('live verify: served 200 image/png at 1200x630 passes', async () => {
  const d = page();
  const r = await verifyShareCardLive({ pageDir: d, liveUrl: LIVE, fetchImpl: async () => res(200, 'image/png'), delayMs: 0 });
  assert.equal(r.ok, true);
});

test('live verify: a 404 card, wrong content-type or wrong size is a failure with a reason (after retries)', async () => {
  const d = page();
  let calls = 0;
  const r404 = await verifyShareCardLive({ pageDir: d, liveUrl: LIVE, fetchImpl: async () => { calls++; return res(404, 'text/html'); }, tries: 3, delayMs: 0 });
  assert.equal(r404.ok, false); assert.match(r404.msg, /HTTP 404/); assert.equal(calls, 3);
  assert.match((await verifyShareCardLive({ pageDir: d, liveUrl: LIVE, fetchImpl: async () => res(200, 'text/html'), tries: 1 })).msg, /expected image\/png/);
  assert.match((await verifyShareCardLive({ pageDir: d, liveUrl: LIVE, fetchImpl: async () => res(200, 'image/png', pngBuffer(600, 315)), tries: 1 })).msg, /600x315/);
});

test('live verify: lag then success passes; a host mismatch fails at once without retrying', async () => {
  const d = page();
  let n = 0;
  assert.equal((await verifyShareCardLive({ pageDir: d, liveUrl: LIVE, fetchImpl: async () => (++n < 3 ? res(404, '') : res(200, 'image/png')), delayMs: 0 })).ok, true);
  let calls = 0;
  const t0 = Date.now();
  const r = await verifyShareCardLive({ pageDir: d, liveUrl: `https://${REAL}`, fetchImpl: async () => { calls++; return res(200, 'image/png'); }, delayMs: 300 });
  assert.ok(Date.now() - t0 < 250, 'no waiting on a mismatch that cannot heal');
  assert.equal(r.ok, false); assert.match(r.msg, /points at/); assert.equal(calls, 0);
});
