// The share card is a REQUIRED, verified deliverable: each rule blocks the deploy (real checkSite on real files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSite, blockingFailures, verifyLiveShareCard, pngSize, CARD_MAX_BYTES } from '../src/site-check.mjs';
import { pngBuffer } from './helpers/png.mjs';

const HOST = 'foo-explainer.netlify.app';
function site({ card = pngBuffer(1200, 630), ogImage = `https://${HOST}/assets/card.png`, twImage, title = 'foo — Fast things', ogUrl = `https://${HOST}/`, twCard = 'summary_large_image', omitImage = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-sc-'));
  fs.mkdirSync(path.join(d, 'assets'));
  if (card) fs.writeFileSync(path.join(d, 'assets', 'card.png'), card);
  const t = (k, v) => `<meta property="${k}" content="${v}">`;
  fs.writeFileSync(path.join(d, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Foo explainer</title>
<meta name="description" content="A description that is certainly longer than twenty characters"><meta name="viewport" content="width=device-width">
${t('og:title', title)}${t('og:description', 'Fast things')}${t('og:url', ogUrl)}${omitImage ? '' : t('og:image', ogImage)}
<meta name="twitter:card" content="${twCard}"><meta name="twitter:title" content="${title}">${omitImage ? '' : `<meta name="twitter:image" content="${twImage ?? ogImage}">`}
</head><body><main>x</main></body></html>`);
  return d;
}
const fails = (d, opts) => blockingFailures(checkSite(d, opts)).map((f) => f.msg);

test('a correct card passes with zero blocking failures', () => assert.deepEqual(fails(site(), { host: HOST }), []));

test('each way the card can be wrong blocks the deploy', () => {
  const cases = {
    'missing og:image tag': [{ omitImage: true }, /og:image/],
    'relative URL': [{ ogImage: 'assets/card.png' }, /og:image is an absolute https URL/],
    'http, not https': [{ ogImage: `http://${HOST}/assets/card.png` }, /og:image is an absolute https URL/],
    'file not in the build': [{ card: null }, /Share card file exists/],
    'wrong size 1200x627': [{ card: pngBuffer(1200, 627) }, /exactly 1200x630 \(found 1200x627\)/],
    'not a PNG at all': [{ card: Buffer.from('GIF89a not a png at all, but long enough to read a header from') }, /real PNG.*not a PNG/],
    'over 1.5 MB': [{ card: pngBuffer(1200, 630, { noise: CARD_MAX_BYTES }) }, /under 1\.5 MB/],
    'twitter:image differs from og:image': [{ twImage: `https://${HOST}/assets/other.png` }, /same file/],
    'image on another host than og:url': [{ ogImage: 'https://elsewhere.netlify.app/assets/card.png', twImage: 'https://elsewhere.netlify.app/assets/card.png' }, /same host as og:url/],
    'title clipped with an ellipsis': [{ title: 'foo — Promote noth…' }, /og:title/],
    'title over 70 chars': [{ title: 'x'.repeat(71) }, /og:title/],
    'wrong twitter card type': [{ twCard: 'summary' }, /summary_large_image/],
  };
  for (const [name, [opts, re]] of Object.entries(cases)) {
    const f = fails(site(opts), { host: HOST });
    assert.ok(f.some((m) => re.test(m)), `${name}: expected ${re}, got ${JSON.stringify(f)}`);
  }
});

test('boundaries: exactly 70 chars passes; a card just under 1.5 MB passes', () => {
  assert.deepEqual(fails(site({ title: 'y'.repeat(70) }), { host: HOST }), []);
  const big = pngBuffer(1200, 630, { noise: CARD_MAX_BYTES - 5000 });
  assert.ok(big.length < CARD_MAX_BYTES && big.length > CARD_MAX_BYTES - 20000, `fixture is ${big.length}`);
  assert.deepEqual(fails(site({ card: big }), { host: HOST }), []);
});

test('the deploy host is enforced when the caller knows it (cross-owner disambiguation changes the host)', () => {
  const f = fails(site(), { host: 'owner-foo-explainer.netlify.app' });
  assert.ok(f.some((m) => /og:image is an absolute https URL.*on owner-foo-explainer\.netlify\.app/.test(m)), JSON.stringify(f));
});

test('pngSize reads IHDR from real bytes and rejects non-PNG', () => {
  assert.deepEqual(pngSize(pngBuffer(1200, 630)), { w: 1200, h: 630 });
  assert.equal(pngSize(Buffer.alloc(40)), null);
});

const res = (status, type, body) => async () => ({ ok: status < 400, status, headers: { get: () => type }, arrayBuffer: async () => body });
const html = `<meta property="og:image" content="https://${HOST}/assets/card.png">`;
test('live check: 200 image/png of 1200x630 passes; every other outcome fails with a reason', async () => {
  const png = pngBuffer(1200, 630);
  const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.length);
  assert.equal((await verifyLiveShareCard({ html, liveUrl: `https://${HOST}`, fetchImpl: res(200, 'image/png', ab) })).ok, true);
  assert.match((await verifyLiveShareCard({ html, fetchImpl: res(404, 'text/html', ab) })).msg, /HTTP 404/);
  assert.match((await verifyLiveShareCard({ html, fetchImpl: res(200, 'text/html', ab) })).msg, /content-type/);
  assert.match((await verifyLiveShareCard({ html, fetchImpl: res(200, 'image/png', new ArrayBuffer(40)) })).msg, /not a PNG/);
  assert.match((await verifyLiveShareCard({ html, liveUrl: 'https://owner-foo-explainer.netlify.app', fetchImpl: res(200, 'image/png', ab) })).msg, /points at foo-explainer/);
  assert.match((await verifyLiveShareCard({ html, fetchImpl: async () => { throw new Error('ECONNRESET'); } })).msg, /ECONNRESET/);
});

test('the REAL deploy tool refuses a page with no share card before touching the network', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-dep-'));
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<!doctype html><title>A test explainer page</title>');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { url: 'https://github.com/o/r', slug: 'r' }, page: { dir: path.join(dir, 'site') } }));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/deploy.mjs', import.meta.url)), dir], { encoding: 'utf8', env: { ...process.env, NETLIFY_AUTH_TOKEN: '' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /SITE INTEGRITY[\s\S]*Share card file exists/);
});
