// OPTIONAL 3D hero (visuals.hero3d) — owner ask 2026-09-17: "the flourish of animations in Three.js".
//
// The rule this encodes: 3D is an ENHANCEMENT, never the page. The vision gate scores still
// screenshots, WebGL costs battery on phones, and a CDN can be blocked — so the authored SVG scene
// (or the raster hero) must remain in the DOM and the 3D layer must paint over it only when WebGL
// exists and the viewer has not asked for reduced motion. These tests pin all three properties, so
// nobody can later "simplify" the fallback away and ship a blank hero to a phone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'assemble-page.mjs');
const FIXTURES = path.join(REPO, 'tests', 'fixtures');

// Reuse whatever minimal build.json the existing assemble-page tests rely on, if one is published;
// otherwise build the smallest context assemble-page accepts.
function baseContext(dir) {
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4000000004945' + '4e44ae426082', 'hex');
  fs.writeFileSync(path.join(assets, 'hero.png'), png);
  fs.writeFileSync(path.join(assets, 'card.png'), png);
  fs.writeFileSync(path.join(assets, 'favicon-32.png'), png);
  fs.writeFileSync(path.join(assets, 'arch.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>a</title><desc>d</desc><rect width="4" height="4"/></svg>');
  return { assets };
}

function fixture({ hero3d, sceneSvg } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-3d-'));
  const { assets } = baseContext(dir);
  if (sceneSvg) {
    fs.writeFileSync(path.join(assets, 'hero-scene.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>s</title><desc>the scene</desc><style>@keyframes g{0%{opacity:0}100%{opacity:1}}@media (prefers-reduced-motion: reduce){*{animation:none}}</style><rect width="4" height="4"/></svg>');
  }
  if (hero3d) fs.writeFileSync(path.join(assets, 'hero-3d.js'), 'export async function mount(host){ host.dataset.mounted = "1"; }\n');
  const ctx = {
    repo: { owner: 'o', name: 'r', slug: 'r', url: 'https://github.com/o/r' },
    concept: { palette: { accent: '#4be3c8' }, metaphor: 'm', tagline: 't' },
    kb: { primerPath: path.join(dir, 'primer.md') },
    visuals: {
      hero: { file: path.join(assets, 'hero.png'), altText: 'h' },
      architectureDiagram: { svgPath: path.join(assets, 'arch.svg'), altText: 'arch' },
      ...(sceneSvg ? { heroAnim: { svgPath: path.join(assets, 'hero-scene.svg'), altText: 'scene' } } : {}),
      ...(hero3d ? { hero3d: { module: 'assets/hero-3d.js', altText: 'a room seen by wifi' } } : {}),
    },
    brand: { socialCard: { file: path.join(assets, 'card.png') }, favicon: { set: [path.join(assets, 'favicon-32.png')] } },
    content: {
      sections: {
        hero: { headline: 'H', lede: 'L' },
        problem: { title: 'P', lead: 'l', paragraphs: ['p'] },
        whatItIs: { title: 'W', lead: 'l', paragraphs: ['p'] },
        insight: { title: 'I', oh: 'oh', lead: 'l', paragraphs: ['p'] },
        howItWorks: { title: 'HW', paragraphs: ['p'] },
        useCases: { title: 'U', cases: [{ title: 'c', paragraphs: ['p'] }] },
        getStarted: { title: 'G', install: 'npm i', steps: [{ strong: 's', text: 't' }] },
        pack: { title: 'K', intro: 'i', downloadLabel: 'd' },
      },
    },
  };
  fs.writeFileSync(path.join(dir, 'primer.md'), '# primer\n');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(ctx, null, 2));
  return dir;
}
const run = (dir) => execFileSync(process.execPath, [TOOL, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
const html = (dir) => fs.readFileSync(path.join(dir, 'site', 'index.html'), 'utf8');

test('no hero3d authored → no canvas host and no module script (unchanged page)', () => {
  const dir = fixture({ sceneSvg: true });
  try {
    run(dir);
    const h = html(dir);
    assert.ok(!/data-hero-3d/.test(h), 'nothing 3D may appear when none was authored');
    assert.ok(/hero-refusal/.test(h), 'the authored SVG scene still renders');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hero3d authored → 3D layer is added AND the flat scene stays in the DOM', () => {
  const dir = fixture({ sceneSvg: true, hero3d: true });
  try {
    run(dir);
    const h = html(dir);
    assert.ok(/data-hero-3d/.test(h), 'the 3D host must be present');
    assert.ok(/hero-refusal/.test(h), 'the SVG scene must REMAIN — 3D is an enhancement, not a replacement');
    assert.ok(fs.existsSync(path.join(dir, 'site', 'assets', 'hero-3d.js')), 'the authored module ships beside the page');
    assert.match(h, /prefers-reduced-motion: reduce/, 'reduced motion must skip the 3D layer');
    assert.match(h, /webgl2['"]?\)\s*\|\|/, 'WebGL support must be probed before importing anything');
    assert.match(h, /catch \(err\)/, 'any failure must leave the page as it was');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hero3d pointing at a missing module fails loud rather than shipping a blank hero', () => {
  const dir = fixture({ sceneSvg: true, hero3d: true });
  try {
    fs.rmSync(path.join(dir, 'assets', 'hero-3d.js'));
    assert.throws(() => run(dir), (e) => {
      assert.match(String(e.stdout || '') + String(e.stderr || ''), /hero3d\.module not found/i);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
