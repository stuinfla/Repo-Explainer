// generate-image: (a) re-draw an image whose prompt changed instead of reusing the old PNG, (b) not trust a
// legacy PNG with no cache-key sidecar, (c) reuse an unchanged rung, (d) report an unpriced engine/quality as
// UNPRICED (usd null), never $0, (e) send only colour values as the palette direction, (f) never claim a
// quality for a Grok-rendered run. Runs the REAL CLI in a child process with globalThis.fetch replaced by a
// preload stub, so no network or paid API is ever reached.
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
// opts.missingModels: OpenAI model ids whose probe 404s; opts.grok: serve the Grok list + render.
async function stubImport(opts = {}) {
  const fresh = (await png({ r: 0, g: 255, b: 0 })).toString('base64');
  const src = `
    import fs from 'node:fs';
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
      const OPTS = ${JSON.stringify(opts)};
      if (u === 'https://api.x.ai/v1/models') return OPTS.grok ? ok({ data: [{ id: 'grok-imagine-image-2.0' }] }) : new Response('{}', { status: 401 });
      if (u.includes('/models/')) {
        const id = decodeURIComponent(u.split('/').pop());
        return (OPTS.missingModels || []).includes(id) || OPTS.openaiDown ? new Response('{}', { status: 404 }) : ok({ id });
      }
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
function runTool(dir, preload, extraEnv = {}, { full = false } = {}) {
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  const env = { PATH: process.env.PATH, OPENAI_API_KEY: 'sk-test-not-real', CALL_LOG: log, ...extraEnv };
  const r = spawnSync(process.execPath, ['--import', preload, TOOL, dir], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, `tool failed: ${r.stdout}\n${r.stderr}`);
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return full ? { calls, result: JSON.parse(r.stdout.trim().split('\n').pop()) } : calls;
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

test('priceImages: gpt-image-2 at its rated quality (high) totals exactly; at xhigh it is UNPRICED, not the high rate', async () => {
  const { priceImages } = await import('../tools/generate-image.mjs');
  const items = [{ id: 'hero', engine: 'gpt-image-2', px: '1536x1024' }, { id: 'p', engine: 'gpt-image-2', px: '1024x1024' }];
  const high = priceImages(items);
  assert.equal(high.usd, 0.417);
  assert.equal(high.unpriced, 0);
  const xhigh = priceImages(items.map((i) => ({ ...i, quality: 'xhigh' })));
  assert.equal(xhigh.usd, null, 'a high-quality rate must not be applied to an xhigh render');
  assert.equal(xhigh.unpriced, 2);
  assert.deepEqual(xhigh.unpricedEngines, ['gpt-image-2@xhigh']);
  assert.equal(priceImages([{ id: 'x', engine: 'gpt-image-1', px: '1024x1024' }]).usd, null, 'gpt-image-1 is no longer a rated engine');
});

test('the gpt-image-2 FALLBACK renders at xhigh and is reported UNPRICED (its rate is for high)', async () => {
  const preload = await stubImport({ missingModels: ['gpt-image-2.5-flare'] });
  const dir = setup('a lighthouse in fog');
  runTool(dir, preload);
  const cost = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals.cost;
  assert.equal(cost.usd, null);
  assert.deepEqual(cost.unpricedEngines, ['gpt-image-2@xhigh']);
});

test('paletteSuffix sends colour values only — layout knobs never reach the image prompt', async () => {
  const { paletteSuffix } = await import('../tools/generate-image.mjs');
  const out = paletteSuffix({ accent: '#4be3c8', bg: 'rgb(10, 12, 20)', radius: '18px', ease: 'cubic-bezier(.2,.8,.2,1)', 'hero-grad-angle': '135deg', ink: '  ' });
  assert.equal(out, '\n\nColour direction (hold to this palette): accent: #4be3c8; bg: rgb(10, 12, 20).');
  assert.equal(paletteSuffix({ radius: '18px' }), '');
});

test('end to end: the prompt actually sent carries the accent colour but not radius/ease', async () => {
  const preload = await stubImport();
  const dir = setup('a lighthouse in fog');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ concept: { palette: { accent: '#4be3c8', radius: '18px', 'hero-grad-angle': '135deg' } }, visuals: { hero: { role: 'metaphor', prompt: 'a lighthouse in fog' } } }));
  const [sent] = runTool(dir, preload);
  assert.match(sent, /accent: #4be3c8/);
  assert.doesNotMatch(sent, /radius|135deg|hero-grad-angle/);
});

test('a Grok-rendered run reports engine grok and NO xhigh quality claim', async () => {
  const preload = await stubImport({ openaiDown: true, grok: true });
  const dir = setup('a lighthouse in fog');
  const { result } = runTool(dir, preload, { OPENAI_API_KEY: '', GROK_AI_KEY: 'xai-test' }, { full: true });
  assert.equal(result.outputs.engine, 'grok-imagine-image-2.0');
  assert.match(result.outputs.quality, /^n\/a/);
  assert.doesNotMatch(result.outputs.quality, /xhigh/);
});

test('an OpenAI run reports the engine and the quality it actually used', async () => {
  const preload = await stubImport();
  const dir = setup('a lighthouse in fog');
  const { result } = runTool(dir, preload, {}, { full: true });
  assert.equal(result.outputs.engine, 'gpt-image-2.5-flare');
  assert.equal(result.outputs.quality, 'xhigh');
});
