// INV-23's bespoke animated hero SCENE (visuals.heroAnim.sceneSvg -> assets/hero-scene.svg): the scene path and its
// guards, so an unanimated or unscalable file can never reach the hero band.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validScene } from './helpers/hero-scene-fixture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

const SCENE = validScene();
// the pre-3.0.1 hosted-door contract: no root id, unscoped selectors, no text-size floor
const UNSCOPED_SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><title>t</title><desc>d</desc>
  <style>.d{animation:go 9s linear infinite}@keyframes go{0%{opacity:0}100%{opacity:1}}@media (prefers-reduced-motion: reduce){.d{animation:none}}</style>
  <text x="2" y="9" font-size="3">tiny</text><rect class="d" x="1" y="1" width="20" height="10"/></svg>`;

function fixture(heroAnim, sceneBody = SCENE) {   // 'no heroAnim => no band' is covered in diagrams.test.mjs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-scene-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'hero-scene.svg'), sceneBody);
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
    assert.match(v.heroAnim.altText, /original model stays locked/, 'alt text comes from the scene\'s own <desc>');
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

test('a hosted-door sceneSvg gets the SAME strict contract as the local one (no root id, 3px text are refused)', () => {
  const dir = fixture({ sceneSvg: 'assets/hero-scene.svg' }, UNSCOPED_SCENE);
  try {
    assert.throws(() => run(dir), (e) => {
      const out = String(e.stdout || '') + String(e.stderr || '');
      assert.match(out, /root <svg> has no id/);
      assert.match(out, /smallest text is [0-9.]+px/);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
