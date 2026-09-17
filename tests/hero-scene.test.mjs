// INV-23's bespoke animated hero SCENE — documented in SKILL.md, unimplemented until 2026-09-17.
//
// SKILL.md: "For any repo whose trick is spatial or mechanical (most), author a bespoke animated SVG
// SCENE instead (visuals.heroAnim.sceneSvg -> assets/hero-scene.svg) ... The chips band is the
// fallback for repos whose trick is genuinely abstract." make-diagrams only ever built the chips
// band, so a spatial repo got chips that did not fit — or, for ruvnet/ruos, no animation at all
// (the brain authored no chips, and "no heroAnim => no band"). These tests pin the scene path AND
// the guards, so an unanimated or unscalable file can never reach the hero band.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" width="100" height="40">
  <title>t</title><desc>A request crosses the boundary and the desktop acts.</desc>
  <style>.d{animation:go 9s linear infinite}@keyframes go{0%{opacity:0}100%{opacity:1}}
  @media (prefers-reduced-motion: reduce){.d{animation:none;opacity:1}}</style>
  <rect class="d" x="1" y="1" width="20" height="10" fill="#4be3c8"/></svg>`;

function fixture(heroAnim, sceneBody = SCENE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-scene-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  if (sceneBody !== null) fs.writeFileSync(path.join(dir, 'assets', 'hero-scene.svg'), sceneBody);
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'a' }, { name: 'b' }], internalEdges: [], componentCount: 2, internalEdgeCount: 0, ecosystems: ['node'],
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({ install: ['npm i'], commands: [], binaries: [], quickstart: [] }));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'fix' },
    kb: { depGraphPath: path.join(kb, 'dep-graph.json'), entrypointsPath: path.join(kb, 'entrypoints.json') },
    visuals: {
      heroAnim,
      architectureDiagram: { rows: [{ items: ['one', 'two', 'three'], connect: true }] },
      bigIdeaDiagram: { rows: [{ items: ['x', 'y'], connect: true }] },
      insightDiagram: { rows: [{ items: ['p', 'q'], connect: true }] },
      flowDiagram: { rows: [{ items: ['in', 'out'], connect: true }] },
    },
  }, null, 2));
  return dir;
}
const run = (dir) => execFileSync(process.execPath, [TOOL, dir], { stdio: ['ignore', 'pipe', 'pipe'] });

test('an authored sceneSvg becomes the hero animation (no chips required)', () => {
  const dir = fixture({ sceneSvg: 'assets/hero-scene.svg' });
  try {
    run(dir);
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals;
    assert.equal(v.heroAnim.format, 'svg-vector-animated-scene');
    assert.ok(v.heroAnim.svgPath.endsWith('assets/hero-scene.svg'), 'the band must point at the authored scene');
    assert.match(v.heroAnim.altText, /desktop acts/, 'alt text comes from the scene\'s own <desc>');
    assert.ok(!fs.existsSync(path.join(dir, 'assets', 'refusal.svg')), 'the chips band must NOT also be emitted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a sceneSvg with no animation is REFUSED (a static picture is not a hero animation)', () => {
  const dead = SCENE.replace(/<style>[\s\S]*?<\/style>/, '');
  const dir = fixture({ sceneSvg: 'assets/hero-scene.svg' }, dead);
  try {
    assert.throws(() => run(dir), (e) => {
      assert.match(String(e.stdout || '') + String(e.stderr || ''), /carries no animation/i);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a missing sceneSvg file fails loud rather than silently dropping the band', () => {
  const dir = fixture({ sceneSvg: 'assets/nope.svg' });
  try {
    assert.throws(() => run(dir), (e) => {
      assert.match(String(e.stdout || '') + String(e.stderr || ''), /sceneSvg not found/i);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no heroAnim at all still means NO band (unchanged)', () => {
  const dir = fixture(undefined, null);
  try {
    run(dir);
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals;
    assert.equal(v.heroAnim, undefined);
    assert.ok(!fs.existsSync(path.join(dir, 'assets', 'refusal.svg')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
