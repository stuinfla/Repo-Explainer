#!/usr/bin/env node
// make-favicon.mjs — Station 5 (BRAND): derive the favicon set from the hero identity.
//
// Conforms to tools/CONTRACT.md (the load-bearing anti-brittleness anchor):
//   • Invoked uniformly:  node tools/make-favicon.mjs <build-dir>   (one positional arg).
//   • PURE — reads ONLY its declared inputs from <build-dir>/build.json, writes ONLY its outputs.
//   • FAIL LOUD — any problem prints { ok:false, … } to stdout AND exits non-zero. Never a silent
//     placeholder / default asset (INV-04, Never-Fail-Silently).
//   • Merges ONLY its own slot (brand.favicon) back into build.json; every other slot is untouched.
//   • stdout carries ONLY the single JSON result object; all diagnostics go to stderr.
//
// Declared inputs (read from build.json):
//   visuals.hero.file   REQUIRED — the hero raster (Station 4). Favicons are CROPPED from it so the
//                       icon carries the same metaphor/identity as the page ("hero-derived favicon").
//   concept.palette     used-if-present — only as the (invisible, opaque-source) flatten backdrop for
//                       the apple-touch-icon; no brand colour is invented if it is absent.
//
// Outputs:
//   brand.favicon slot  { set:[…png/ico…], appleTouchIcon:"apple-touch-icon.png", derivedFromHero:true }
//   <build-dir>/assets/ favicon-16/32/48/192/512.png · apple-touch-icon.png (180) · favicon.ico (16/32/48)
//
// Mechanics: shells out to ImageMagick (`magick`, v7 — `convert` v6 fallback), because it is the tool that
// writes multi-resolution .ico natively. No npm install.
//
// Idempotent: re-running overwrites these files + the brand.favicon slot; it never appends.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(/i;
const ICON_SIZES = [16, 32, 48, 192, 512];

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) { process.stderr.write(`[make-favicon] ${msg}\n`); }

function findBin() {
  for (const b of ['magick', 'convert']) {
    try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return b; } catch { /* try next */ }
  }
  return null;
}

function magick(bin, args) {
  try {
    execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const detail = (e.stderr ? e.stderr.toString() : e.message || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`ImageMagick failed (${bin} ${args.join(' ')}): ${detail || 'non-zero exit'}`);
  }
}

// Pull the first colour-like string (hex / rgb()) out of the open-shape palette, in author order.
function firstColor(v) {
  if (typeof v === 'string') { const s = v.trim(); return HEX.test(s) || RGB.test(s) ? s : null; }
  if (Array.isArray(v)) { for (const x of v) { const c = firstColor(x); if (c) return c; } return null; }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) { const c = firstColor(x); if (c) return c; } return null; }
  return null;
}

function readCtx(buildDir) {
  const bj = path.join(buildDir, 'build.json');
  if (!fs.existsSync(bj)) throw new Error(`build.json not found in build dir: ${bj}`);
  try { return JSON.parse(fs.readFileSync(bj, 'utf8')); }
  catch (e) { throw new Error(`build.json is not valid JSON: ${e.message}`); }
}

function resolveHero(buildDir, ctx) {
  const f = ctx?.visuals?.hero?.file;
  if (!f || typeof f !== 'string') {
    throw new Error('visuals.hero.file is missing in build.json — generate the hero (Station 4) first');
  }
  const p = path.isAbsolute(f) ? f : path.resolve(buildDir, f);
  if (!fs.existsSync(p)) throw new Error(`hero image not found on disk: ${p}`);
  return p;
}

// Re-read fresh and merge only brand.favicon (make-social-card may write build.json around the same time).
function mergeFavicon(buildDir, slot) {
  const bj = path.join(buildDir, 'build.json');
  const ctx = JSON.parse(fs.readFileSync(bj, 'utf8'));
  ctx.brand = (ctx.brand && typeof ctx.brand === 'object') ? ctx.brand : {};
  ctx.brand.favicon = slot;
  fs.writeFileSync(bj, JSON.stringify(ctx, null, 2) + '\n');
}

function main() {
  const buildDir = process.argv[2];
  if (!buildDir) {
    emit({ ok: false, outputs: {}, error: 'usage: node tools/make-favicon.mjs <build-dir>' });
    log('usage: node tools/make-favicon.mjs <build-dir>');
    process.exit(2);
  }
  try {
    const bin = findBin();
    if (!bin) throw new Error('ImageMagick not found — need `magick` (v7) or `convert` (v6) on PATH');

    const ctx = readCtx(buildDir);
    const hero = resolveHero(buildDir, ctx);
    const bg = firstColor(ctx?.concept?.palette ?? {}) || 'white'; // opaque-source flatten backdrop only

    const assets = path.join(buildDir, 'assets');
    fs.mkdirSync(assets, { recursive: true });

    // Standard square favicons — center-square crop of the hero so the icon keeps the hero's identity.
    for (const n of ICON_SIZES) {
      const out = path.join(assets, `favicon-${n}.png`);
      magick(bin, [hero, '-resize', `${n}x${n}^`, '-gravity', 'center', '-extent', `${n}x${n}`, '-strip', out]);
    }

    // apple-touch-icon — 180×180, NO alpha (iOS masks/composites it itself).
    const apple = path.join(assets, 'apple-touch-icon.png');
    magick(bin, [hero, '-resize', '180x180^', '-gravity', 'center', '-extent', '180x180',
      '-background', bg, '-alpha', 'remove', '-alpha', 'off', '-strip', apple]);

    // favicon.ico — multi-resolution (48 base + 16 + 32) from a single hero crop.
    const ico = path.join(assets, 'favicon.ico');
    magick(bin, [hero, '-resize', '48x48^', '-gravity', 'center', '-extent', '48x48',
      '(', '-clone', '0', '-resize', '16x16', ')',
      '(', '-clone', '0', '-resize', '32x32', ')',
      ico]);

    const set = [...ICON_SIZES.map((n) => `favicon-${n}.png`), 'favicon.ico'];
    const allFiles = [...set, 'apple-touch-icon.png'];
    for (const f of allFiles) {
      const p = path.join(assets, f);
      if (!fs.existsSync(p) || fs.statSync(p).size === 0) throw new Error(`favicon output missing/empty: ${p}`);
    }

    const slot = { set, appleTouchIcon: 'apple-touch-icon.png', derivedFromHero: true };
    mergeFavicon(buildDir, slot);

    log(`wrote ${allFiles.length} favicon files to ${assets}`);
    emit({ ok: true, outputs: { dir: assets, files: allFiles, slot: 'brand.favicon', merged: slot }, error: null });
    process.exit(0);
  } catch (e) {
    emit({ ok: false, outputs: {}, error: e.message });
    log(`FAILED: ${e.message}`);
    process.exit(1);
  }
}

main();
