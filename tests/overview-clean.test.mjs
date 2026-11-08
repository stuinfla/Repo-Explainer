// The NotebookLM "Gemini Notebook" mark must be gone from what ships: measured on pixels, not on source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { markBox, INFOGRAPHIC_MARK, cleanInfographic, endCardIndex } from '../src/overview-clean.mjs';

const W = 1376, H = 768;
const gradient = async (file, { busy = false } = {}) => {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, n = busy ? ((x * 7 + y * 13) % 2 ? 40 : 235) : 0;
    raw[i] = busy ? n : 232 + Math.round(x / W * 10); raw[i + 1] = busy ? n : 238 + Math.round(y / H * 8); raw[i + 2] = busy ? n : 250;
  }
  const mark = markBox(INFOGRAPHIC_MARK, W, H);
  // a dark "logo": a block where the mark sits (cleaning must remove it)
  const inner = { x: mark.x + Math.round(mark.w * 0.2), y: mark.y + Math.round(mark.h * 0.3), w: Math.round(mark.w * 0.7), h: Math.round(mark.h * 0.4) };
  for (let y = inner.y; y < inner.y + inner.h; y++) for (let x = inner.x; x < inner.x + inner.w; x++) { const i = (y * W + x) * 3; raw[i] = raw[i + 1] = raw[i + 2] = 20; }
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
  return { mark, inner };
};
const darkest = async (file, b) => { const { data } = await sharp(file).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); let m = 255; for (let i = 0; i < data.length; i += 3) m = Math.min(m, data[i]); return m; };

test('markBox stays inside the frame', () => {
  const b = markBox({ x: 0.95, y: 0.95, w: 0.2, h: 0.2 }, 100, 100);
  assert.ok(b.x + b.w < 100 && b.y + b.h < 100, JSON.stringify(b));
});

test('cleanInfographic removes a dark mark sitting on a smooth background (measured on pixels)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-clean-'));
  try {
    const f = path.join(dir, 'in.png'), o = path.join(dir, 'out.png');
    const { inner } = await gradient(f);
    assert.equal(await darkest(f, inner), 20, 'the fixture really has a dark mark');
    const r = await cleanInfographic(f, o);
    assert.equal(r.cleaned, true);
    assert.ok(await darkest(o, inner) > 200, 'the mark area is background-light after cleaning');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cleanInfographic refuses to paste over a busy background and says why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-clean-'));
  try {
    const f = path.join(dir, 'in.png'), o = path.join(dir, 'out.png');
    await gradient(f, { busy: true });
    const r = await cleanInfographic(f, o);
    assert.equal(r.cleaned, false);
    assert.match(r.reason, /not flat/);
    assert.ok(fs.existsSync(o), 'the original is still written so the build can ship it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('endCardIndex finds a bright flat splash that runs to the end, and nothing else', () => {
  const slide = { mean: 213, std: 40 }, card = { mean: 248, std: 4 };
  assert.equal(endCardIndex([slide, slide, card, card, card]), 2);
  assert.equal(endCardIndex([slide, slide, slide]), -1, 'no splash');
  assert.equal(endCardIndex([card, slide, slide]), -1, 'a bright slide earlier in the video is not the end card');
  assert.equal(endCardIndex([slide, card, slide, card]), 3, 'only the unbroken trailing run counts');
});
