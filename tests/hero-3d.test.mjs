// Optional 3D hero (visuals.hero3d): an ENHANCEMENT, never the page. The vision gate scores still
// screenshots and WebGL costs battery, so the flat SVG scene must stay in the DOM and the 3D layer may
// only paint over it when WebGL exists and reduced motion is off. Runs the real assemble-page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

test('no hero3d authored → no canvas host and no module script (unchanged page)', () => {
  const dir = makeBuild({ scene: true });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/data-hero-3d/.test(r.html), 'nothing 3D may appear when none was authored');
    assert.ok(/hero-refusal/.test(r.html), 'the authored SVG scene still renders');
  } finally { cleanup(dir); }
});

test('hero3d authored → 3D layer is added AND the flat scene stays in the DOM', () => {
  const dir = makeBuild({ scene: true, hero3d: true });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(/data-hero-3d/.test(r.html), 'the 3D host must be present');
    assert.ok(/hero-refusal/.test(r.html), 'the SVG scene must REMAIN — 3D is an enhancement, not a replacement');
    assert.ok(fs.existsSync(path.join(dir, 'site', 'assets', 'hero-3d.js')), 'the authored module ships beside the page');
    // the guards must live in the loader <script type="module">, not merely somewhere in the page's CSS
    const loader = [...r.html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((b) => b.includes('data-hero-3d'));
    assert.ok(loader, 'the 3D loader must be a module script');
    const at = (re) => loader.search(re);
    assert.ok(at(/prefers-reduced-motion: reduce/) >= 0, 'reduced motion must skip the 3D layer');
    assert.ok(at(/webgl2['"]?\)\s*\|\|/) >= 0, 'WebGL support must be probed before importing anything');
    assert.ok(at(/catch \(err\)/) >= 0, 'any failure must leave the page as it was');
    assert.ok(at(/prefers-reduced-motion: reduce/) < at(/import\(/) && at(/webgl2/) < at(/import\(/), 'both guards must run BEFORE the module is imported');
  } finally { cleanup(dir); }
});

test('hero3d pointing at a missing module fails loud rather than shipping a blank hero', () => {
  const dir = makeBuild({ scene: true, hero3d: true });
  try {
    fs.rmSync(path.join(dir, 'assets', 'hero-3d.js'));
    const r = assemble(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /hero3d\.module not found/i);
  } finally { cleanup(dir); }
});
