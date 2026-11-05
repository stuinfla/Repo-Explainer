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
//   concept.palette         REQUIRED — `bg` (else the first colour-like value) paints the text panels.
//   understanding.repoName  the display name baked in as the kicker (the JOB's "repo name");
//     (or repo.name)        declared here so the card can satisfy "repo name + tagline baked in".
//                           Best-effort: if neither is present the card ships with the tagline alone.
//
// Outputs:
//   brand.socialCard slot   { px:"1200x630", file:"<…>/assets/social-card.png", tagline:"…",
//                             legibility:{ minContrast, measured, attempts } }
//   <build-dir>/assets/social-card.png  (exactly 1200×630, OG / Twitter summary_large_image)
//
// Mechanics: ImageMagick (`magick` v7, `convert` v6 fallback) bakes the wordmark and the wrapped tagline onto
// SOLID-ish brand panels over the hero (text never sits directly on art). LEGIBILITY GATE: the text-free
// backdrop under each text box is measured with sharp; ink must reach WCAG 4.5:1 on 99% of those pixels.
// A failure triggers ONE corrective re-render (opaque panels); a second failure is fatal — no unreadable card ships.
//
// Idempotent: re-running overwrites social-card.png + the brand.socialCard slot; it never appends.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backdropContrast, inkVisibility, regionReadable, runGate, MIN_CONTRAST } from '../src/card-legibility.mjs';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(/i;
const CARD_W = 1200, CARD_H = 630, PAD = 64;
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/HelveticaNeue.ttc',
  '/System/Library/Fonts/Avenir.ttc',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',    // hosted runner (fonts-liberation)
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
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

// Text reaches ImageMagick ONLY as `caption:@file` / `label:@file`. Inline `caption:${text}` makes a leading
// '@' read an arbitrary file into the public PNG and expands % escapes; the @file form is literal.
function textFile(stage, name, text) {
  const f = path.join(stage, `${name}.txt`);
  fs.writeFileSync(f, String(text));
  return `@${f}`;
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

function toRgb(c) {
  const s = String(c).trim();
  const m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
    return h.length >= 6 ? [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] : null;
  }
  const r = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return r ? [Math.round(r[1]), Math.round(r[2]), Math.round(r[3])] : null;
}
// The panel colour is the palette's `bg` knob (by NAME — taking "the second colour" once picked bg-2 as the ink).
function panelColor(palette) {
  const named = Object.entries(palette || {}).find(([k]) => k.replace(/^--/, '').toLowerCase() === 'bg')?.[1];
  const rgb = typeof named === 'string' ? toRgb(named) : null;
  if (rgb) return rgb;
  for (const c of collectColors(palette ?? {}, [])) { const v = toRgb(c); if (v) return v; }
  return null;
}
const INKS = [[247, 248, 252], [10, 10, 18]];
const relLum = (c) => { const f = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const pickInk = (panel) => {
  const cr = (ink) => { const [h, l] = [relLum(ink), relLum(panel)].sort((a, b) => b - a); return (h + 0.05) / (l + 0.05); };
  return cr(INKS[0]) >= cr(INKS[1]) ? INKS[0] : INKS[1];
};
const hex = (c) => `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;

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

// Re-read fresh and merge only brand.socialCard (make-favicon may write build.json around the same time).
function mergeSocialCard(buildDir, slot) {
  const bj = path.join(buildDir, 'build.json');
  const ctx = JSON.parse(fs.readFileSync(bj, 'utf8'));
  ctx.brand = (ctx.brand && typeof ctx.brand === 'object') ? ctx.brand : {};
  ctx.brand.socialCard = slot;
  fs.writeFileSync(bj, JSON.stringify(ctx, null, 2) + '\n');
}

// Returns the process exit code. It never calls process.exit itself: that inside the try would skip the
// finally and leak the social-card-* temp dir on every run.
async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) {
    emit({ ok: false, outputs: {}, error: 'usage: node tools/make-social-card.mjs <build-dir>' });
    log('usage: node tools/make-social-card.mjs <build-dir>');
    return 2;
  }
  let stage = null;
  try {
    const bin = findBin();
    if (!bin) throw new Error('ImageMagick not found — need `magick` (v7) or `convert` (v6) on PATH');

    const ctx = readCtx(buildDir);
    const hero = resolveHero(buildDir, ctx);

    const tagline = ctx?.concept?.tagline;
    if (typeof tagline !== 'string' || !tagline.trim()) {
      throw new Error('concept.tagline is missing/empty in build.json — the card requires an authored tagline');
    }

    const panel = panelColor(ctx?.concept?.palette ?? {});
    if (!panel) throw new Error('concept.palette has no usable colour (need ≥1 hex or rgb() value) — cannot brand the card');

    const repoName = (typeof ctx?.understanding?.repoName === 'string' && ctx.understanding.repoName.trim())
      ? ctx.understanding.repoName.trim()
      : (typeof ctx?.repo?.name === 'string' && ctx.repo.name.trim() ? ctx.repo.name.trim() : null);

    const font = pickFont();
    const assets = path.join(buildDir, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    stage = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-'));
    const out = path.join(assets, 'social-card.png');
    const fontArgs = font ? ['-font', font] : [];
    const dimsOf = (f) => execFileSync(bin === 'magick' ? bin : 'identify', [...(bin === 'magick' ? ['identify'] : []), '-format', '%w %h', f],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split(' ').map(Number);

    const cover = path.join(stage, 'cover.png');
    magick(bin, [hero, '-resize', `${CARD_W}x${CARD_H}^`, '-gravity', 'center', '-extent', `${CARD_W}x${CARD_H}`, cover]);

    const render = async (attempt) => {
      const alpha = attempt === 0 ? 0.92 : 1;               // corrective pass: fully opaque panels
      const ink = pickInk(panel);
      const rgba = `rgba(${panel[0]},${panel[1]},${panel[2]},${alpha})`;
      const clear = `rgba(${panel[0]},${panel[1]},${panel[2]},0)`;
      const f = (n) => path.join(stage, `${n}-${attempt}.png`);

      // tagline: largest size (58 → 40) that wraps to ≤ 3 lines
      let tagH = 0, tagW = 0, tagSize = 0;
      for (const size of [58, 52, 46, 40]) {
        magick(bin, ['-background', 'none', '-fill', hex(ink), ...fontArgs, '-size', `${CARD_W - PAD * 2}x`, '-gravity', 'West',
          '-pointsize', String(size), `caption:${textFile(stage, `tag-${attempt}-${size}`, tagline)}`, '-trim', '+repage', f('tag')]);
        [tagW, tagH] = dimsOf(f('tag')); tagSize = size;
        if (tagH <= size * 3.6) break;
      }
      if (tagH > 260) throw new Error(`tagline wraps to ${tagH}px even at ${tagSize}pt — too long for the card`);
      const tagTop = CARD_H - 64 - tagH;
      const panelTop = tagTop - 40;

      const layers = [cover,
        '(', '-size', `${CARD_W}x56`, `gradient:${clear}-${rgba}`, ')', '-gravity', 'NorthWest', '-geometry', `+0+${panelTop - 56}`, '-composite',
        '(', '-size', `${CARD_W}x${CARD_H - panelTop}`, `xc:${rgba}`, ')', '-geometry', `+0+${panelTop}`, '-composite'];
      const boxes = { tagline: { x: PAD, y: tagTop, w: tagW, h: tagH } };
      let wmFile = null;
      if (repoName) {
        let size = 34, wmW = 0, wmH = 0;
        for (; size >= 24; size -= 2) {
          magick(bin, ['-background', 'none', '-fill', hex(ink), ...fontArgs, '-pointsize', String(size), `label:${textFile(stage, `wm-${attempt}-${size}`, repoName)}`, '-trim', '+repage', f('wm')]);
          [wmW, wmH] = dimsOf(f('wm'));
          if (wmW <= 760) break;
        }
        if (wmW > 760) throw new Error(`repo name "${repoName}" is too wide for the card wordmark`);
        wmFile = f('wm');
        const wmY = 40;
        layers.push('(', '-size', `${wmW + 36}x${wmH + 24}`, 'xc:none', '-fill', rgba, '-draw', `roundrectangle 0,0 ${wmW + 35},${wmH + 23} 14,14`, ')',
          '-geometry', `+${PAD - 18}+${wmY - 12}`, '-composite');
        boxes.wordmark = { x: PAD, y: wmY, w: wmW, h: wmH };
      }
      const backdrop = f('backdrop');
      magick(bin, [...layers, backdrop]);
      return { backdrop, boxes, ink, wmFile, tagFile: f('tag'), alpha };
    };
    const measure = async (art) => {
      const res = {};
      for (const [name, box] of Object.entries(art.boxes)) res[name] = (await backdropContrast(art.backdrop, box, art.ink)).p1;
      const worst = Math.min(...Object.values(res));
      return { ok: worst >= MIN_CONTRAST, detail: Object.entries(res).map(([k, v]) => `${k} ${v.toFixed(2)}:1`).join(', ') };
    };
    const { art, attempts, detail } = await runGate({ render, measure });

    const finalArgs = [art.backdrop];
    if (art.wmFile) finalArgs.push(art.wmFile, '-gravity', 'NorthWest', '-geometry', `+${art.boxes.wordmark.x}+${art.boxes.wordmark.y}`, '-composite');
    finalArgs.push(art.tagFile, '-gravity', 'NorthWest', '-geometry', `+${art.boxes.tagline.x}+${art.boxes.tagline.y}`, '-composite', out);
    magick(bin, finalArgs);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`social card not written: ${out}`);
    // the ink must actually be on the finished card (a missing font / failed composite would leave it blank)
    for (const [name, box] of Object.entries(art.boxes)) {
      const v = await inkVisibility(out, box, art.ink);
      if (!regionReadable(v)) throw new Error(`rendered ${name} is not legible on the finished card (ink ${(v.inkShare * 100).toFixed(1)}% of its box, ${v.backgroundContrast.toFixed(2)}:1)`);
    }
    const dims = dimsOf(out).join('x');
    if (dims !== `${CARD_W}x${CARD_H}`) throw new Error(`social card is ${dims}, expected ${CARD_W}x${CARD_H}`);

    const slot = { px: `${CARD_W}x${CARD_H}`, file: out, tagline, legibility: { minContrast: MIN_CONTRAST, measured: detail, attempts } };
    mergeSocialCard(buildDir, slot);

    log(`wrote ${dims} social card to ${out}`);
    emit({ ok: true, outputs: { file: out, px: slot.px, slot: 'brand.socialCard', merged: slot }, error: null });
    return 0;
  } catch (e) {
    emit({ ok: false, outputs: {}, error: e.message });
    log(`FAILED: ${e.message}`);
    return 1;
  } finally {
    if (stage) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best-effort cleanup */ } }
  }
}

process.exitCode = await main();
