// Phone twins (assets/<name>.m.svg) through the REAL assembler: <picture> swap, lightbox choice, hero swap, and a
// deploy-blocking check when a named twin is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';
import { pickLightboxSrc, PHONE_MAX } from '../tools/assemble-page.mjs';
import { checkSite, blockingFailures } from '../src/site-check.mjs';

const SVG = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${t}</title><desc>d</desc><rect width="4" height="4"/></svg>`;
function twinned(dir, ctx) {
  const a = path.join(dir, 'assets');
  const keys = { architectureDiagram: 'arch', flowDiagram: 'flow', bigIdeaDiagram: 'big', insightDiagram: 'ins' };
  for (const [k, n] of Object.entries(keys)) {
    fs.writeFileSync(path.join(a, `${n}.svg`), SVG(n)); fs.writeFileSync(path.join(a, `${n}.m.svg`), SVG(`${n}-phone`));
    ctx.visuals[k] = { svgPath: path.join(a, `${n}.svg`), mobileSvgPath: path.join(a, `${n}.m.svg`), altText: `${n} alt` };
  }
  fs.writeFileSync(path.join(a, 'hero-scene.svg'), SVG('wide-hero')); fs.writeFileSync(path.join(a, 'hero-scene.m.svg'), SVG('phone-hero'));
  ctx.visuals.heroAnim = { svgPath: path.join(a, 'hero-scene.svg'), mobileSvgPath: path.join(a, 'hero-scene.m.svg'), altText: 'scene' };
}
function run(mutate) {
  const dir = makeBuild({ mutate: (c, d) => { twinned(d, c); mutate?.(c, d); } });
  const r = assemble(dir);
  return { dir, r };
}

test('every diagram slot gets a <picture> with the phone source, a data-src-m on its zoom button, and the file ships', () => {
  const { dir, r } = run();
  try {
    assert.equal(r.status, 0, r.stderr.slice(0, 300));
    for (const n of ['arch', 'flow', 'big', 'ins']) {
      assert.ok(r.html.includes(`<picture><source media="(max-width: ${PHONE_MAX}px)" srcset="assets/${n}.m.svg"><img src="assets/${n}.svg"`), `${n} picture`);
      assert.ok(r.html.includes(`data-src="assets/${n}.svg" data-src-m="assets/${n}.m.svg"`), `${n} zoom`);
      assert.ok(fs.existsSync(path.join(dir, 'site', 'assets', `${n}.m.svg`)), `${n}.m.svg copied`);
    }
    assert.deepEqual(blockingFailures(checkSite(path.join(dir, 'site'))).filter((f) => /phone-twin/.test(f.msg)), []);
  } finally { cleanup(dir); }
});

test('without twins the markup is unchanged (no picture, no data-src-m)', () => {
  const dir = makeBuild(); const r = assemble(dir); cleanup(dir);
  assert.ok(!r.html.includes('<picture>') && !/data-src-m="/.test(r.html) && !r.html.includes('rf-m"'));
});

test('the lightbox picks the phone file under the phone query and the wide file otherwise (the shipped function)', () => {
  assert.equal(pickLightboxSrc(true, 'assets/a.m.svg', 'assets/a.svg'), 'assets/a.m.svg');
  assert.equal(pickLightboxSrc(false, 'assets/a.m.svg', 'assets/a.svg'), 'assets/a.svg');
  assert.equal(pickLightboxSrc(true, null, 'assets/a.svg'), 'assets/a.svg', 'no twin: wide even on a phone');
  const { dir, r } = run();
  try {
    assert.ok(r.html.includes(pickLightboxSrc.toString()), 'the page ships exactly this function');
    assert.ok(r.html.includes(`pickLightboxSrc(window.matchMedia('(max-width: ${PHONE_MAX}px)').matches, btn.getAttribute('data-src-m'), btn.getAttribute('data-src'))`));
  } finally { cleanup(dir); }
});

test('hero: wide and phone scenes both inline, the phone one hidden from AT, with the swap CSS shipped', () => {
  const { dir, r } = run();
  try {
    assert.match(r.html, /<div class="rf-d">[\s\S]*wide-hero[\s\S]*<\/div><div class="rf-m" aria-hidden="true">[\s\S]*phone-hero/);
    const css = fs.readFileSync(path.join(dir, 'site', 'styles.css'), 'utf8');
    assert.ok(css.includes('.hero-refusal .rf-m { display: none; }'));
    assert.ok(css.includes(`@media (max-width: ${PHONE_MAX}px) { .hero-refusal .rf-d { display: none; } .hero-refusal .rf-m { display: block; } }`));
  } finally { cleanup(dir); }
});

test('a named twin that is missing fails the build loudly; one deleted from site/ blocks the deploy check', () => {
  const { dir, r } = run((c, d) => fs.rmSync(path.join(d, 'assets', 'flow.m.svg')));
  try { assert.equal(r.status, 1); assert.match(r.stderr, /flow diagram \(phone twin\)/); } finally { cleanup(dir); }
  const ok = run();
  try {
    fs.rmSync(path.join(ok.dir, 'site', 'assets', 'big.m.svg'));
    assert.ok(blockingFailures(checkSite(path.join(ok.dir, 'site'))).some((f) => /phone-twin.*big\.m\.svg/.test(f.msg)));
  } finally { cleanup(ok.dir); }
});
