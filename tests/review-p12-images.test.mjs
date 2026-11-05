// P12 — responsive AVIF images from the real assembler, the scene-as-hero page, the SSIM quality rule and the
// page-weight budget in site-check. No network, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';
import { ssimLuma, avifSsim, pickQuality, QUALITY_FLOOR, SSIM_TARGET } from '../src/image-variants.mjs';
import { checkSite, pageWeight, blockingFailures, FIRST_VIEW_WARN_BYTES, IMAGE_TOTAL_FAIL_BYTES } from '../src/site-check.mjs';

// A smooth, art-like picture (gradients + shapes): what the image models produce, and compressible.
const art = (w, h) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101820"/><stop offset="1" stop-color="#2a6f6a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w / 2}" cy="${h / 2}" r="${h / 4}" fill="#d9f24a"/><rect x="40" y="40" width="${w / 4}" height="${h / 6}" rx="12" fill="#ff6b4a"/></svg>`)).png().toBuffer();
const HERO = await art(1536, 1024), SQUARE = await art(1024, 1024);

test('the assembler serves responsive AVIF <picture>s: hero eager, others lazy, originals kept for the lightbox', () => {
  const dir = makeBuild({ mutate: (_ctx, d) => { fs.writeFileSync(path.join(d, 'assets', 'hero.png'), HERO); fs.writeFileSync(path.join(d, 'assets', 'problem.png'), SQUARE); } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    const a = path.join(dir, 'site', 'assets');
    const heroPic = r.html.match(/<picture><source type="image\/avif" srcset="assets\/hero-480\.avif 480w, assets\/hero-960\.avif 960w, assets\/hero-1440\.avif 1440w"[^>]*><img [^>]*>/)?.[0];
    assert.ok(heroPic, 'hero must be an AVIF <picture> with 480/960/1440 candidates');
    assert.match(heroPic, /<img src="assets\/hero-960\.jpg" srcset="assets\/hero-480\.jpg 480w, assets\/hero-960\.jpg 960w, assets\/hero-1440\.jpg 1440w"/, 'JPEG fallback set');
    assert.match(heroPic, /width="1536" height="1024"/, 'explicit intrinsic size (no layout shift)');
    assert.match(heroPic, /fetchpriority="high"/);
    assert.doesNotMatch(heroPic, /loading="lazy"/, 'the first visible image must not be lazy');
    const prob = r.html.match(/<picture><source type="image\/avif" srcset="assets\/problem-[^>]*><img [^>]*>/)?.[0];
    assert.ok(prob, 'problem illustration must be a <picture> too');
    assert.match(prob, /loading="lazy"/);
    assert.match(prob, /width="1024" height="1024"/);
    assert.doesNotMatch(prob, /srcset="[^"]*1440/, 'no 1440 candidate for a 1024px source (never upscale)');
    assert.match(r.html, /data-src="assets\/hero\.png"/, 'click-to-enlarge still opens the full-size original');
    assert.ok(fs.statSync(path.join(a, 'hero.png')).size === HERO.length, 'the original ships unchanged');
    for (const f of ['hero-480.avif', 'hero-960.avif', 'hero-1440.avif', 'hero-960.jpg', 'problem-480.avif', 'problem-960.avif']) assert.ok(fs.existsSync(path.join(a, f)), f);
    const avif960 = fs.statSync(path.join(a, 'hero-960.avif')).size;
    assert.ok(avif960 < HERO.length / 4, `960px AVIF (${avif960} B) must be far smaller than the original (${HERO.length} B)`);
    const results = checkSite(path.join(dir, 'site')).filter((x) => /images total|phone-twin/.test(x.msg));
    assert.ok(results.every((x) => x.ok), results.filter((x) => !x.ok).map((x) => x.msg).join('; '));
  } finally { cleanup(dir); }
});

test('a missing responsive file fails the build (srcset candidates are checked, not just src)', () => {
  const dir = makeBuild({ mutate: (_c, d) => { fs.writeFileSync(path.join(d, 'assets', 'hero.png'), HERO); } });
  try {
    assert.equal(assemble(dir).status, 0);
    fs.rmSync(path.join(dir, 'site', 'assets', 'hero-1440.avif'));
    const lost = checkSite(path.join(dir, 'site')).find((x) => /responsive image variant/.test(x.msg));
    assert.equal(lost.ok, false);
    assert.match(lost.msg, /hero-1440\.avif/);
  } finally { cleanup(dir); }
});

test('scene as hero: no raster hero in the page or the site, the scene sits in the hero slot; a skip with no scene fails loud', () => {
  const dir = makeBuild({ scene: true, mutate: (ctx) => { ctx.visuals.hero.rasterSkipped = 'scene'; } });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    const heroArt = r.html.match(/<figure class="hero-art">[\s\S]*?<\/figure>/)[0];
    assert.match(heroArt, /class="hero-refusal"/, 'the scene occupies the hero slot');
    assert.doesNotMatch(heroArt, /<img|<picture/, 'no raster in the hero slot');
    assert.ok(!fs.existsSync(path.join(dir, 'site', 'assets', 'hero.png')), 'the unused backdrop is not shipped');
    assert.ok(!fs.readdirSync(path.join(dir, 'site', 'assets')).some((f) => /^hero-\d+\./.test(f)), 'no hero variants either');
  } finally { cleanup(dir); }
  const bad = makeBuild({ scene: false, mutate: (ctx) => { ctx.visuals.hero.rasterSkipped = 'scene'; } });
  try {
    const r = assemble(bad);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /rasterSkipped is "scene" but visuals\.heroAnim has no scene file/);
  } finally { cleanup(bad); }
});

test('SSIM: identical = 1, damaged < 0.9; the picker never goes below q50 and meets 0.98 where it can', async () => {
  const g = new Uint8Array(64 * 64).map((_, i) => (i * 7) % 256);
  assert.equal(ssimLuma(g, g, 64, 64), 1);
  const noisy = g.map((v, i) => (i % 3 === 0 ? 255 - v : v));
  assert.ok(ssimLuma(g, noisy, 64, 64) < 0.9);
  const p = await pickQuality(HERO);
  assert.ok(p.quality >= QUALITY_FLOOR, `quality ${p.quality} is below the floor`);
  assert.ok(p.ssim >= SSIM_TARGET, `smooth art must reach SSIM ${SSIM_TARGET}, got ${p.ssim}`);
  const lower = await avifSsim(HERO, 960, QUALITY_FLOOR - 5);
  assert.ok(lower.bytes <= p.bytes, 'sanity: lower quality is not larger');
});

// ── page-weight budget ─────────────────────────────────────────────────────────────────────────
function budgetSite({ eagerBytes = 0, lazyBytes = 0, htmlPad = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-budget-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const rnd = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24; return b; };   // incompressible enough
  fs.writeFileSync(path.join(dir, 'assets', 'eager.avif'), rnd(eagerBytes));
  fs.writeFileSync(path.join(dir, 'assets', 'lazy.avif'), rnd(lazyBytes));
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{margin:0}');
  const html = `<!doctype html><html lang="en"><head><title>Budget page</title><meta name="viewport" content="width=device-width"></head><body>
<picture><source type="image/avif" srcset="assets/eager.avif 960w" sizes="100vw"><img src="assets/eager.avif" width="10" height="10" alt="a" fetchpriority="high"></picture>
<picture><source type="image/avif" srcset="assets/lazy.avif 960w"><img src="assets/lazy.avif" width="10" height="10" alt="b" loading="lazy"></picture>
<button data-src="assets/original-never-counted.png"></button>${'x'.repeat(htmlPad)}</body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return { dir, html };
}
const weightResult = (dir, re) => checkSite(dir).find((x) => re.test(x.msg));

test('budget: a light page passes; lightbox originals are not counted', () => {
  const { dir, html } = budgetSite({ eagerBytes: 50_000, lazyBytes: 60_000 });
  try {
    const w = pageWeight(dir, html);
    assert.equal(w.images, 110_000);
    assert.ok(w.firstView > 50_000 && w.firstView < 51_500, `first view ${w.firstView}`);
    assert.equal(weightResult(dir, /First view/).ok, true);
    assert.equal(weightResult(dir, /images total/).ok, true);
  } finally { cleanup(dir); }
});

test('budget: first view over 300 KB WARNS (non-blocking); total images over 1.5 MB FAILS (blocking)', () => {
  const heavyEager = budgetSite({ eagerBytes: FIRST_VIEW_WARN_BYTES + 20_000, lazyBytes: 1000 });
  const heavyTotal = budgetSite({ eagerBytes: 1000, lazyBytes: IMAGE_TOTAL_FAIL_BYTES + 1 });
  try {
    const warn = weightResult(heavyEager.dir, /First view/);
    assert.equal(warn.ok, false);
    assert.equal(warn.blocking, false, 'first-view weight is advisory');
    assert.equal(blockingFailures(checkSite(heavyEager.dir)).filter((x) => /First view|images total/.test(x.msg)).length, 0);
    const fail = weightResult(heavyTotal.dir, /images total/);
    assert.equal(fail.ok, false);
    assert.equal(fail.blocking, true);
    assert.ok(blockingFailures(checkSite(heavyTotal.dir)).some((x) => /images total/.test(x.msg)));
    assert.equal(weightResult(heavyTotal.dir, /First view/).ok, true, 'a lazy-only page is light on first view');
  } finally { cleanup(heavyEager.dir); cleanup(heavyTotal.dir); }
});
