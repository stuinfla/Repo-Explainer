// Social-card legibility gate, measured from rendered pixels.
//  - the known-bad ruvllm wordmark (grey on near-black, cropped from the real shipped card) must FAIL;
//  - the corrected renderer's output on the same kind of palette over the busiest possible art must PASS;
//  - the corrective-re-render / fatal flow is tested on the real runGate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { inkVisibility, regionReadable, backdropContrast, runGate, MIN_CONTRAST } from '../src/card-legibility.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'tools', 'make-social-card.mjs');
// Probe exactly like the tool's findBin: `magick` (v7) first, else `convert` (v6, what apt installs on CI).
const BIN = ['magick', 'convert'].find((b) => spawnSync(b, ['-version']).status === 0) || null;
const hasMagick = BIN !== null;
const im = (args) => execFileSync(BIN, args);

test('the shipped ruvllm wordmark (grey on near-black) FAILS the legibility measure', async () => {
  const f = path.join(HERE, 'fixtures', 'ruvllm-bad-wordmark.png');
  const v = await inkVisibility(f, { x: 0, y: 0, w: 150, h: 60 }, [104, 111, 103]);
  assert.ok(v.inkShare >= 0.002, `the wordmark is drawn (${v.inkShare})`);
  assert.ok(v.backgroundContrast > 2.5 && v.backgroundContrast < MIN_CONTRAST, `measured ${v.backgroundContrast.toFixed(2)}:1 must sit below ${MIN_CONTRAST}`);
  assert.equal(regionReadable({ inkShare: 0.1, backgroundContrast: v.backgroundContrast }), false);
});

function buildFixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-card-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  im(['-seed', '7', '-size', '1536x1024', 'plasma:fractal', path.join(dir, 'assets', 'hero.png')]);
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    visuals: { hero: { file: 'assets/hero.png' } },
    concept: { tagline: 'Edit weights under evidence. Roll back exactly. Promote nothing alone.', palette: { bg: '#0b1020', 'bg-2': '#3a3a3a', accent: '#d9f24a' }, ...extra.concept },
    understanding: { repoName: 'ruvllm' },
  }));
  return dir;
}

test('the real renderer on busy art: both text boxes clear 4.5:1 from the rendered pixels', { skip: !hasMagick }, async () => {
  const dir = buildFixture();
  try {
    const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    const card = path.join(dir, 'assets', 'social-card.png');
    // text-free backdrop is gone with the temp dir, so measure the finished card the way a viewer sees it
    const wm = await inkVisibility(card, { x: 64, y: 40, w: 80, h: 30 }, [247, 248, 252]);
    const tag = await inkVisibility(card, { x: 64, y: 440, w: 800, h: 130 }, [247, 248, 252]);
    assert.ok(regionReadable(wm), `wordmark ${JSON.stringify(wm)}`);
    assert.ok(regionReadable(tag), `tagline ${JSON.stringify(tag)}`);
    assert.ok(wm.backgroundContrast >= 10 && tag.backgroundContrast >= 10, 'on opaque-ish brand panels the margin is wide, not borderline');
    const slot = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).brand.socialCard;
    assert.equal(slot.legibility.attempts, 1);
    assert.match(slot.legibility.measured, /wordmark \d+\.\d+:1, tagline|tagline \d+\.\d+:1, wordmark/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the wordmark takes the palette\'s bg knob, never "the second colour in the object"', { skip: !hasMagick }, async () => {
  const dir = buildFixture({ concept: { palette: { 'bg-2': '#ffffff', accent: '#ffffff', bg: '#101820' } } });
  try {
    assert.equal(spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' }).status, 0);
    const wm = await inkVisibility(path.join(dir, 'assets', 'social-card.png'), { x: 64, y: 40, w: 80, h: 30 }, [247, 248, 252]);
    assert.ok(wm.backgroundContrast >= 10, `light ink on a dark bg panel, got ${wm.backgroundContrast}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('text reaches ImageMagick literally: a tagline or repo name of "@file" never reads that file into the card', { skip: !hasMagick }, () => {
  // Relative "@secret.txt" resolves against the tool's cwd. Old inline `caption:@secret.txt` / `label:@secret.txt` would
  // pull this file in: 60 lines wrap taller than the 260px tagline limit and a 400-char line is a >760px wordmark,
  // so the old code exits 1 ("too long" / "too wide"). Literal text is a short, fitting string and exits 0.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-secret-'));
  fs.writeFileSync(path.join(cwd, 'secret.txt'), Array.from({ length: 60 }, (_, i) => `line ${i} ${'X'.repeat(400)}`).join('\n'));
  const dir = buildFixture({ concept: { tagline: '@secret.txt' } });
  try {
    const bj = path.join(dir, 'build.json');
    const ctx = JSON.parse(fs.readFileSync(bj, 'utf8'));
    ctx.understanding.repoName = '@secret.txt';
    fs.writeFileSync(bj, JSON.stringify(ctx));
    const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8', cwd });
    assert.equal(r.status, 0, `"@file" text must render as literal text: ${r.stdout}`);
    assert.equal(JSON.parse(fs.readFileSync(bj, 'utf8')).brand.socialCard.tagline, '@secret.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('the final readability check on the FINISHED card is live: a composite that drops the ink is fatal', { skip: !hasMagick }, () => {
  // A shim `magick` that behaves normally except the last call (the final composite into social-card.png), which
  // writes the bare backdrop: the gate passes (backdrop is fine) but no ink reaches the card.
  const realBin = execFileSync('which', [BIN]).toString().trim();
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-shim-'));
  const shim = path.join(shimDir, BIN);
  fs.writeFileSync(shim, `#!/bin/sh\nfor last; do :; done\ncase "$last" in *social-card.png) cp "$1" "$last"; exit 0;; esac\nexec "${realBin}" "$@"\n`, { mode: 0o755 });
  const dir = buildFixture();
  try {
    const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8', env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.status, 1, r.stdout);
    assert.match(JSON.parse(r.stdout).error, /not legible on the finished card/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(shimDir, { recursive: true, force: true }); }
});

test('a palette with no colour fails loud with a non-zero exit', { skip: !hasMagick }, () => {
  const dir = buildFixture({ concept: { palette: { accent: 'teal' } } });
  try {
    const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ok, false);
    assert.ok(!fs.existsSync(path.join(dir, 'assets', 'social-card.png')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backdropContrast reports the WORST 1% of pixels, so one bright patch under the text fails it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-bd-'));
  try {
    const f = path.join(dir, 'bd.png');
    const bar = await sharp({ create: { width: 40, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();   // 20% white bar
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0b1020' } }).composite([{ input: bar, left: 0, top: 0 }]).png().toFile(f);
    const c = await backdropContrast(f, { x: 0, y: 0, w: 200, h: 100 }, [247, 248, 252]);
    assert.ok(c.p1 < 1.2, `white ink over a white patch is ~1:1, got ${c.p1}`);
    assert.ok(c.median > 15, `most of the box is dark, got ${c.median}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runGate: pass first time = 1 attempt; fail then pass = ONE corrective re-render; fail twice = fatal', async () => {
  const calls = [];
  const render = async (n) => { calls.push(n); return n; };
  const ok1 = await runGate({ render, measure: async () => ({ ok: true, detail: 'x' }) });
  assert.equal(ok1.attempts, 1);
  calls.length = 0;
  const ok2 = await runGate({ render, measure: async (n) => ({ ok: n === 1, detail: 'x' }) });
  assert.deepEqual([ok2.attempts, calls], [2, [0, 1]]);
  calls.length = 0;
  await assert.rejects(runGate({ render, measure: async () => ({ ok: false, detail: 'wordmark 2.10:1' }) }), /legibility gate.*wordmark 2\.10:1.*refusing to ship/);
  assert.deepEqual(calls, [0, 1], 'exactly one corrective re-render, never a third');
});

test('literalText: no leading "@" and no live "%" ever reaches ImageMagick (policy-independent, runs everywhere)', async () => {
  const { literalText } = await import('../src/card-legibility.mjs');
  assert.equal(literalText('@secret.txt')[0], '\u00a0', 'a guard that is not whitespace to ImageMagick precedes any leading @');
  assert.equal(literalText('100%[fx:1]'), '\u00a0100%%[fx:1]', 'percent is doubled so it prints, never expands');
  assert.equal(literalText('plain').replace(/^\u00a0/, ''), 'plain');
});
