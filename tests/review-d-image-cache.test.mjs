// review-d (3.0.1): generate-image must (a) re-draw an image whose prompt changed instead of reusing the
// old PNG, (b) not trust a legacy PNG with no cache-key sidecar, (c) still reuse an unchanged rung, and
// (d) report an unpriced engine as UNPRICED (usd null), never $0. Runs the REAL CLI in a child process
// with globalThis.fetch replaced by a preload stub, so no network or paid API is ever reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'generate-image.mjs');

const png = (rgb) => sharp({ create: { width: 4, height: 4, channels: 3, background: rgb } }).png().toBuffer();

// Preload: every fetch is answered locally; each image generation is appended to CALL_LOG.
async function stubImport() {
  const fresh = (await png({ r: 0, g: 255, b: 0 })).toString('base64');
  const src = `
    import fs from 'node:fs';
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
      if (u.includes('api.x.ai')) return new Response('{}', { status: 401 });
      if (u.includes('/models/')) return ok({ id: u.split('/').pop() });
      if (u.endsWith('/images/generations')) {
        fs.appendFileSync(process.env.CALL_LOG, JSON.parse(opts.body).prompt.replace(/\\n/g, ' ') + '\\n');
        return ok({ data: [{ b64_json: '${fresh}' }] });
      }
      throw new Error('unexpected fetch ' + u);
    };`;
  return 'data:text/javascript,' + encodeURIComponent(src);
}

function setup(prompt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-d-img-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  writePrompt(dir, prompt);
  return dir;
}
function writePrompt(dir, prompt) {
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ visuals: { hero: { role: 'metaphor', prompt } } }));
}
function runTool(dir, preload) {
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  const env = { PATH: process.env.PATH, OPENAI_API_KEY: 'sk-test-not-real', CALL_LOG: log };
  const r = spawnSync(process.execPath, ['--import', preload, TOOL, dir], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, `tool failed: ${r.stdout}\n${r.stderr}`);
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

test('a rewritten prompt re-draws the image; an unchanged one is reused', async () => {
  const preload = await stubImport();
  const dir = setup('a lighthouse in fog');
  const hero = path.join(dir, 'assets', 'hero.png');

  assert.equal(runTool(dir, preload).length, 1, 'first run draws the hero');
  assert.equal(runTool(dir, preload).length, 0, 'same prompt: resume cache reuses it, no paid call');

  fs.writeFileSync(hero, await png({ r: 255, g: 0, b: 0 }));   // mark the on-disk picture as "old"
  writePrompt(dir, 'a bridge being built from both banks');
  const calls = runTool(dir, preload);
  assert.equal(calls.length, 1, 'prompt changed: must call the API again');
  assert.match(calls[0], /bridge being built/);
  const { data } = await sharp(fs.readFileSync(hero)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 3)], [0, 255, 0], 'hero.png now holds the NEW picture');
});

test('a legacy PNG with no cache-key sidecar is regenerated, not trusted', async () => {
  const preload = await stubImport();
  const dir = setup('a lighthouse in fog');
  fs.writeFileSync(path.join(dir, 'assets', 'hero.png'), await png({ r: 255, g: 0, b: 0 }));
  assert.equal(runTool(dir, preload).length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'hero.png.key.json')), 'sidecar written after drawing');
});

test('an engine with no sourced rate is UNPRICED (usd null), never $0', async () => {
  const preload = await stubImport();
  const dir = setup('a lighthouse in fog');
  runTool(dir, preload);
  const cost = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals.cost;
  assert.equal(cost.usd, null);
  assert.equal(cost.unpriced, 1);
  assert.deepEqual(cost.unpricedEngines, ['gpt-image-2.5-flare']);
});

test('priceImages totals a fully-priced set exactly', async () => {
  const { priceImages } = await import('../tools/generate-image.mjs');
  const r = priceImages([{ id: 'hero', engine: 'gpt-image-2', px: '1536x1024' }, { id: 'p', engine: 'gpt-image-2', px: '1024x1024' }]);
  assert.equal(r.usd, 0.417);
  assert.equal(r.unpriced, 0);
});
