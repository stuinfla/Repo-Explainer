#!/usr/bin/env node
// make-social-card.mjs — Station 5 (BRAND): the designed 1200×630 OG / Twitter social card.
//
// Conforms to tools/CONTRACT.md (the load-bearing anti-brittleness anchor):
//   • Invoked uniformly:  node tools/make-social-card.mjs <build-dir>   (one positional arg).
//   • PURE — reads ONLY its declared inputs from <build-dir>/build.json, writes ONLY its outputs.
//   • FAIL LOUD — any problem prints { ok:false, … } to stdout AND exits non-zero. Never a silent
//     placeholder / default card (INV-04, Never-Fail-Silently).
//   • Merges ONLY its own slot (brand.socialCard) back into build.json; every other slot untouched.
//   • stdout carries ONLY the single JSON result object; all diagnostics go to stderr.
//
// Declared inputs (read from build.json):
//   visuals.hero.file       REQUIRED — the hero raster; used full-bleed as the card's brand backdrop.
//   concept.tagline         REQUIRED — the one line baked into the card (= og:description).
//   concept.palette         REQUIRED — needs ≥1 colour-like value; drives the legibility scrim + text.
//   understanding.repoName  the display name baked in as the kicker (the JOB's "repo name");
//     (or repo.name)        declared here so the card can satisfy "repo name + tagline baked in".
//                           Best-effort: if neither is present the card ships with the tagline alone.
//
// Outputs:
//   brand.socialCard slot   { px:"1200x630", file:"<…>/assets/social-card.png", tagline:"…" }
//   <build-dir>/assets/social-card.png  (exactly 1200×630, OG / Twitter summary_large_image)
//
// Mechanics: shells out to ImageMagick (`magick`, v7 — `convert` v6 fallback), matching the kb/
// engine's system-binary style (kb/make-dropin.mjs → `zip`). ImageMagick bakes the wrapped tagline +
// kicker straight into the PNG (no browser, no npm install).
//
// Idempotent: re-running overwrites social-card.png + the brand.socialCard slot; it never appends.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(/i;
const CARD_W = 1200, CARD_H = 630, PAD = 64;
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/HelveticaNeue.ttc',
  '/System/Library/Fonts/Avenir.ttc',
  '/Library/Fonts/Arial.ttf',
];

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) { process.stderr.write(`[make-social-card] ${msg}\n`); }

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

function pickFont() { for (const f of FONT_CANDIDATES) { if (fs.existsSync(f)) return f; } return null; }

// Collect colour-like strings (hex / rgb()) from the open-shape palette, in author order.
function collectColors(v, out) {
  if (out.length >= 6) return out;
  if (typeof v === 'string') { const s = v.trim(); if (HEX.test(s) || RGB.test(s)) out.push(s); }
  else if (Array.isArray(v)) { for (const x of v) collectColors(x, out); }
  else if (v && typeof v === 'object') { for (const x of Object.values(v)) collectColors(x, out); }
  return out;
}

function hexToRgb(h) {
  let s = h.replace('#', '');
  if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split('').map((c) => c + c).join('');
  if (s.length < 6) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
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

// Re-read fresh and merge only brand.socialCard, to minimise the window vs the parallel make-favicon.
function mergeSocialCard(buildDir, slot) {
  const bj = path.join(buildDir, 'build.json');
  const ctx = JSON.parse(fs.readFileSync(bj, 'utf8'));
  ctx.brand = (ctx.brand && typeof ctx.brand === 'object') ? ctx.brand : {};
  ctx.brand.socialCard = slot;
  fs.writeFileSync(bj, JSON.stringify(ctx, null, 2) + '\n');
}

// ── sharp fallback when ImageMagick is absent ─────────────────────────────────────────────────
// Same composed result as the magick path: hero cover-cropped to 1200×630, a legibility scrim
// gradient from the brand colour, the repo-name kicker top-left, and the wrapped tagline
// bottom-left. The text is an SVG layer rendered by libvips/librsvg (DejaVu Sans is installed).
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
async function makeCardWithSharp(hero, out, { tagline, repoName, base, accent, textColor }) {
  const rgb = hexToRgb(base);
  const [r, g, b] = rgb || [22, 24, 40];
  const lines = wrapText(tagline, 34);
  const lineEls = lines.map((ln, i) =>
    `<text x="${PAD}" y="${CARD_H - 72 - (lines.length - 1 - i) * 68}" font-family="DejaVu Sans, Ubuntu, sans-serif" font-size="58" font-weight="bold" fill="${textColor}">${escapeXml(ln)}</text>`).join('');
  const kicker = repoName
    ? `<text x="${PAD}" y="80" font-family="DejaVu Sans, Ubuntu, sans-serif" font-size="34" font-weight="bold" fill="${accent}">${escapeXml(repoName)}</text>`
    : '';
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="rgba(${r},${g},${b},0)"/>`
    + `<stop offset="0.4" stop-color="rgba(${r},${g},${b},0.35)"/>`
    + `<stop offset="1" stop-color="rgba(${r},${g},${b},0.95)"/>`
    + `</linearGradient></defs>`
    + `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#s)"/>${kicker}${lineEls}</svg>`;
  await sharp(hero).resize(CARD_W, CARD_H, { fit: 'cover' })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png().toFile(out);
  const meta = await sharp(out).metadata();
  if (meta.width !== CARD_W || meta.height !== CARD_H) {
    throw new Error(`social card is ${meta.width}x${meta.height}, expected ${CARD_W}x${CARD_H}`);
  }
}

async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) {
    emit({ ok: false, outputs: {}, error: 'usage: node tools/make-social-card.mjs <build-dir>' });
    log('usage: node tools/make-social-card.mjs <build-dir>');
    process.exit(2);
  }
  let stage = null;
  try {
    const bin = findBin();
    if (!bin) log('ImageMagick not found — using the sharp fallback renderer.');

    const ctx = readCtx(buildDir);
    const hero = resolveHero(buildDir, ctx);

    const tagline = ctx?.concept?.tagline;
    if (typeof tagline !== 'string' || !tagline.trim()) {
      throw new Error('concept.tagline is missing/empty in build.json — the card requires an authored tagline');
    }

    const colors = collectColors(ctx?.concept?.palette ?? {}, []);
    if (colors.length === 0) {
      throw new Error('concept.palette has no usable colour (need ≥1 hex or rgb() value) — cannot brand the card');
    }
    const base = colors[0];
    const accent = colors[1] || colors[0];

    // Legibility scrim: transparent at top (hero shows) → opaque brand colour at the bottom (text sits).
    const rgb = hexToRgb(base);
    const scrim = rgb
      ? `gradient:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)-rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`
      : `gradient:none-${base}`;
    // Tagline colour: contrast against the (near-opaque base) bottom of the scrim.
    const textColor = rgb && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 150 ? '#0a0a0a' : '#ffffff';

    const repoName = (typeof ctx?.understanding?.repoName === 'string' && ctx.understanding.repoName.trim())
      ? ctx.understanding.repoName.trim()
      : (typeof ctx?.repo?.name === 'string' && ctx.repo.name.trim() ? ctx.repo.name.trim() : null);

    const assets = path.join(buildDir, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const out = path.join(assets, 'social-card.png');
    let dims;

    if (bin) {
      stage = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-'));
      const baseImg = path.join(stage, 'base.png');
      const tagImg = path.join(stage, 'tag.png');

      // 1) Hero full-bleed cover + scrim, with the repo-name kicker baked into the top-left.
      const baseArgs = [hero, '-resize', `${CARD_W}x${CARD_H}^`, '-gravity', 'center', '-extent', `${CARD_W}x${CARD_H}`,
        '(', '-size', `${CARD_W}x${CARD_H}`, scrim, ')', '-composite'];
      const font = pickFont();
      if (repoName) {
        baseArgs.push('-gravity', 'NorthWest', '-fill', accent);
        if (font) baseArgs.push('-font', font);
        baseArgs.push('-pointsize', '34', '-annotate', `+${PAD}+54`, repoName);
      }
      baseArgs.push(baseImg);
      magick(bin, baseArgs);

      // 2) The tagline as a wrapped caption layer (auto-wrapped at the text column width).
      const tagArgs = ['-background', 'none', '-fill', textColor];
      if (font) tagArgs.push('-font', font);
      tagArgs.push('-size', `${CARD_W - PAD * 2}x`, '-gravity', 'West', '-pointsize', '58', `caption:${tagline}`, tagImg);
      magick(bin, tagArgs);

      // 3) Composite the tagline into the lower-left and write the final card.
      magick(bin, [baseImg, tagImg, '-gravity', 'SouthWest', '-geometry', `+${PAD}+72`, '-composite', out]);

      if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`social card not written: ${out}`);
      // `magick identify …` (v7) vs the standalone `identify` (v6).
      dims = (bin === 'magick'
        ? execFileSync(bin, ['identify', '-format', '%wx%h', out], { stdio: ['ignore', 'pipe', 'pipe'] })
        : execFileSync('identify', ['-format', '%wx%h', out], { stdio: ['ignore', 'pipe', 'pipe'] })).toString().trim();
      if (dims !== `${CARD_W}x${CARD_H}`) throw new Error(`social card is ${dims}, expected ${CARD_W}x${CARD_H}`);
    } else {
      await makeCardWithSharp(hero, out, { tagline, repoName, base, accent, textColor });
      dims = `${CARD_W}x${CARD_H}`;
    }

    const slot = { px: `${CARD_W}x${CARD_H}`, file: out, tagline };
    mergeSocialCard(buildDir, slot);

    log(`wrote ${dims} social card to ${out}`);
    emit({ ok: true, outputs: { file: out, px: slot.px, slot: 'brand.socialCard', merged: slot }, error: null });
    process.exit(0);
  } catch (e) {
    emit({ ok: false, outputs: {}, error: e.message });
    log(`FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    if (stage) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best-effort cleanup */ } }
  }
}

main();
