// tests/sharp-image-fallback.test.mjs — favicon & social-card without ImageMagick.
//
// On a box with no ImageMagick binary on PATH, make-favicon and make-social-card must still
// produce their full output set via sharp/libvips instead of dying with "ImageMagick not found":
// the favicon PNG set + a multi-resolution favicon.ico + apple-touch-icon, and a 1200×630 social
// card. The ImageMagick path is unchanged when a binary is present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAVICON = path.join(REPO, 'tools', 'make-favicon.mjs');
const SOCIAL = path.join(REPO, 'tools', 'make-social-card.mjs');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]); // reserved=0, type=1 (icon)

async function makeBuildDir() {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpfb-'));
  const assets = path.join(buildDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const heroPath = path.join(assets, 'hero.png');
  await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#7c3aed' } })
    .png().toFile(heroPath);
  const ctx = {
    repo: { name: 'demo-repo' },
    understanding: { repoName: 'demo-repo' },
    concept: { palette: { primary: '#7c3aed', accent: '#38bdf8', text: '#ffffff' }, tagline: 'A short, legible tagline for the social card' },
    visuals: { hero: { file: heroPath } },
  };
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(ctx, null, 2));
  return { buildDir, assets };
}

// Force ImageMagick "absent" by running with an empty PATH so findBin() finds no magick/convert.
const NO_MAGICK_ENV = { ...process.env, PATH: '' };

test('favicon — sharp fallback produces the full icon set + a multi-resolution .ico', async () => {
  const { buildDir, assets } = await makeBuildDir();
  const r = spawnSync(process.execPath, [FAVICON, buildDir], { encoding: 'utf8', env: NO_MAGICK_ENV });
  assert.equal(r.status, 0, `favicon fallback must succeed: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /sharp fallback renderer/, 'it must announce the fallback');
  for (const n of [16, 32, 48, 192, 512]) {
    const p = path.join(assets, `favicon-${n}.png`);
    assert.ok(fs.existsSync(p), `favicon-${n}.png must exist`);
    assert.ok(fs.readFileSync(p).subarray(0, 8).equals(PNG_MAGIC), `favicon-${n}.png must be a real PNG`);
  }
  const apple = path.join(assets, 'apple-touch-icon.png');
  assert.ok(fs.existsSync(apple) && fs.readFileSync(apple).subarray(0, 8).equals(PNG_MAGIC));
  const ico = path.join(assets, 'favicon.ico');
  assert.ok(fs.existsSync(ico), 'favicon.ico must exist');
  const icoBuf = fs.readFileSync(ico);
  assert.ok(icoBuf.subarray(0, 4).equals(ICO_MAGIC), 'favicon.ico must be a real ICO');
  assert.equal(icoBuf.readUInt16LE(4), 3, 'the .ico must carry 3 resolutions (16/32/48)');
});

test('social-card — sharp fallback produces a 1200×630 PNG', async () => {
  const { buildDir, assets } = await makeBuildDir();
  const r = spawnSync(process.execPath, [SOCIAL, buildDir], { encoding: 'utf8', env: NO_MAGICK_ENV });
  assert.equal(r.status, 0, `social-card fallback must succeed: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /sharp fallback renderer/, 'it must announce the fallback');
  const card = path.join(assets, 'social-card.png');
  assert.ok(fs.existsSync(card), 'social-card.png must exist');
  const buf = fs.readFileSync(card);
  assert.ok(buf.subarray(0, 8).equals(PNG_MAGIC), 'social-card.png must be a real PNG');
  const meta = await sharp(card).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});
