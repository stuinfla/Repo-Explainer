#!/usr/bin/env node
// generate-image.mjs — Station 4 (VISUALIZE): generate the EMOTIONAL raster rungs.
//
// One pure tool over a probed image engine. Reads the brain-authored emotional rungs from the
// BuildContext (`visuals.hero` + every entry in `visuals.sections[]`), generates each as a real
// raster image, and merges ONLY its own slots back into build.json (hero, sections, cost). The STRUCTURAL rungs
// (architecture/flow/big-idea/insight SVGs) are make-diagrams' job, not this one.
//
// Engine: ONE engine renders every raster. PRIMARY_MODEL (gpt-image-2.5-flare) at QUALITY; if its probe
// fails, FALLBACK_MODEL (gpt-image-2) at the same quality; only with no OpenAI key (or a failed OpenAI
// chain) does Grok (GROK_MODEL) render. Grok takes `aspect_ratio`+`resolution`, NOT `size`, and its native
// output can exceed the target px (we only ever downscale via sharp; see GROK_PX_MAP). If every probe
// fails we STOP LOUD — never a silent substitution, never a placeholder.
//
// Sizes: hero = 1536x1024; raster sections = 1024x1024 (valid sizes: 1024x1024, 1024x1536,
// 1536x1024, auto — the DALL·E-3 1792x1024 is rejected). `auto` has no Grok mapping (falls
// through to OpenAI) since no rung in this pipeline actually declares it.
//
// CONTRACT (tools/CONTRACT.md): pure (reads only `visuals` rungs + `concept.palette` + the
// Grok/OpenAI keys from env), fail-loud (non-zero exit + clear message, NEVER a placeholder
// asset), single JSON result object on stdout, diagnostics on stderr, merges ONLY visuals.hero +
// visuals.sections[] + visuals.cost (the derived price, read by src/receipt.mjs).
//
// Usage: node tools/generate-image.mjs <build-dir>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validateHeroScene } from './diagrams/scene.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url)); // tools/
const ROOT = path.resolve(TOOLS_DIR, '..');

const API_URL = 'https://api.openai.com/v1';
const GROK_API_URL = 'https://api.x.ai/v1';
const GROK_MODEL = 'grok-imagine-image-2.0';   // 2026-09-17: newest on the live xAI list (2026-08-08); same aspect_ratio/resolution request verified HTTP 200
// Grok has no per-pixel `size` param — it takes aspect_ratio + resolution. Mapped so the native
// output is >= our target px (downscale-only). Verified live 2026-07-11: 1536x1024 -> "3:2"@"2k"
// natively returns 2496x1664 (same 1.5 ratio); 1024x1024 -> "1:1"@"1k" returns EXACTLY 1024x1024.
const GROK_PX_MAP = {
  '1536x1024': { aspect_ratio: '3:2', resolution: '2k' },
  '1024x1536': { aspect_ratio: '2:3', resolution: '2k' },
  '1024x1024': { aspect_ratio: '1:1', resolution: '1k' },
};
// xhigh on the 2.5-flare family: measured sharper, with legible on-screen text, at ~28s per 1536x1024 hero (see git history).
const QUALITY = 'xhigh';
const PRIMARY_MODEL = 'gpt-image-2.5-flare';  // verified: real 1536x1024 generation, HTTP 200
const FALLBACK_MODEL = 'gpt-image-2';          // previous generation, safety net only if the probe fails
const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const PROBE_TIMEOUT_MS = 30_000;
const GEN_TIMEOUT_MS = 300_000;              // an endpoint under load can take 60-90s+ per render
const GEN_ATTEMPTS = 3;                       // retry transient upstream 502s / aborts
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- single-JSON-on-stdout result helpers (exit code is the source of truth) ----
function emit(result, code) {
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(code);
}
function fail(error, code = 1) { emit({ ok: false, outputs: {}, error }, code); }
function succeed(outputs) { emit({ ok: true, outputs, error: null }, 0); }

// ---- env: OpenAI key from process env, else parse the repo-root .env (OPENAI_API_KEY / OPEN_AI_KEY) ----
function parseEnvFile(file, keys) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (!keys.includes(k)) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
function loadOpenAiKey() {
  const fromProc = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  if (fromProc && fromProc.trim()) return fromProc.trim();
  const dotenv = parseEnvFile(path.join(ROOT, '.env'), ['OPENAI_API_KEY', 'OPEN_AI_KEY']);
  const fromFile = dotenv.OPENAI_API_KEY || dotenv.OPEN_AI_KEY;
  return fromFile && fromFile.trim() ? fromFile.trim() : null;
}
function loadGrokKey() {
  const fromProc = process.env.GROK_AI_KEY || process.env.GROK_API_KEY;
  if (fromProc && fromProc.trim()) return fromProc.trim();
  const dotenv = parseEnvFile(path.join(ROOT, '.env'), ['GROK_AI_KEY', 'GROK_API_KEY']);
  const fromFile = dotenv.GROK_AI_KEY || dotenv.GROK_API_KEY;
  return fromFile && fromFile.trim() ? fromFile.trim() : null;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Probe a model ID against the live keys; returns true iff GET /v1/models/<id> -> HTTP 200.
async function probeModel(model, apiKey) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_URL}/models/${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }, PROBE_TIMEOUT_MS);
  } catch (e) {
    console.error(`[generate-image] probe ${model}: network error — ${e?.message || e}`);
    return false;
  }
  if (res.status === 200) { console.error(`[generate-image] probe ${model}: HTTP 200 (available)`); return true; }
  console.error(`[generate-image] probe ${model}: HTTP ${res.status} (unavailable)`);
  return false;
}

// One pure image API call. Returns a validated PNG Buffer or THROWS (no placeholder, ever).
async function generateOne(model, prompt, size, apiKey) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_URL}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality: QUALITY, n: 1 }),
    }, GEN_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`image API request failed (${model}, ${size}): ${e?.message || e}`);
  }
  const bodyText = await res.text();
  if (res.status !== 200) {
    let msg = bodyText;
    try { msg = JSON.parse(bodyText)?.error?.message || bodyText; } catch { /* keep raw */ }
    throw new Error(`image API HTTP ${res.status} (${model}, ${size}): ${msg}`);
  }
  let json;
  try { json = JSON.parse(bodyText); } catch { throw new Error(`image API returned non-JSON (${model}): ${bodyText.slice(0, 200)}`); }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`image API 200 but no b64_json image in response (${model}, ${size})`);
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) throw new Error(`image API returned an empty image (${model}, ${size})`);
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`image API returned non-PNG bytes (${model}, ${size})`);
  return buf;
}

// Probe: does this key have live access to the Grok image model? xAI has no per-ID model endpoint
// like OpenAI's (confirmed live 2026-07-10) — list all models and check membership instead.
async function probeGrok(apiKey) {
  let res;
  try {
    res = await fetchWithTimeout(`${GROK_API_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, PROBE_TIMEOUT_MS);
  } catch (e) {
    console.error(`[generate-image] probe grok: network error — ${e?.message || e}`);
    return false;
  }
  if (res.status !== 200) { console.error(`[generate-image] probe grok: HTTP ${res.status} (unavailable)`); return false; }
  let json;
  try { json = JSON.parse(await res.text()); } catch { console.error('[generate-image] probe grok: non-JSON model list'); return false; }
  const ok = Array.isArray(json?.data) && json.data.some((m) => m.id === GROK_MODEL);
  console.error(`[generate-image] probe grok: ${ok ? 'HTTP 200 (available)' : 'model not in live list'}`);
  return ok;
}

// One pure Grok image call. Two things Grok does differently from OpenAI, found via a real
// end-to-end test (2026-07-11), not assumed: (1) native output may exceed the target px by design
// (see GROK_PX_MAP); (2) response format is NOT guaranteed PNG — the response carries a real
// `mime_type` field and was observed returning JPEG (JFIF magic bytes) for one prompt while
// another returned PNG. So the buffer is ALWAYS piped through sharp -> png() regardless of source
// format or whether dimensions already match — this simultaneously normalizes format AND size in
// one step, rather than trusting either. Throws (no placeholder), same contract as generateOne.
async function generateOneGrok(prompt, targetPx, apiKey) {
  const grokParams = GROK_PX_MAP[targetPx];
  if (!grokParams) throw new Error(`no Grok aspect-ratio mapping for px="${targetPx}"`);
  let res;
  try {
    res = await fetchWithTimeout(`${GROK_API_URL}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROK_MODEL, prompt, n: 1, response_format: 'b64_json', ...grokParams }),
    }, GEN_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`Grok image API request failed (${targetPx}): ${e?.message || e}`);
  }
  const bodyText = await res.text();
  if (res.status !== 200) {
    let msg = bodyText;
    try { msg = JSON.parse(bodyText)?.error?.message || bodyText; } catch { /* keep raw */ }
    throw new Error(`Grok image API HTTP ${res.status} (${targetPx}): ${msg}`);
  }
  let json;
  try { json = JSON.parse(bodyText); } catch { throw new Error(`Grok image API returned non-JSON: ${bodyText.slice(0, 200)}`); }
  const item = json?.data?.[0];
  const b64 = item?.b64_json;
  if (!b64) throw new Error(`Grok image API 200 but no b64_json image in response (${targetPx})`);
  const rawBuf = Buffer.from(b64, 'base64');
  if (rawBuf.length === 0) throw new Error(`Grok image API returned an empty image (${targetPx}, mime_type=${item?.mime_type || 'unknown'})`);

  // Normalize format AND size in one pass — never trust the source is already PNG at the right
  // dimensions (see the function comment: observed both PNG and JPEG from this same endpoint).
  const [wantW, wantH] = targetPx.split('x').map(Number);
  let buf;
  try {
    buf = await sharp(rawBuf).resize(wantW, wantH).png().toBuffer();
  } catch (e) {
    throw new Error(`Grok image (mime_type=${item?.mime_type || 'unknown'}) failed to decode/normalize for ${targetPx}: ${e?.message || e}`);
  }
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`normalized output is not valid PNG (${targetPx})`);
  return buf;
}

function safeName(s) { return String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'; }

// ── IMAGE CACHE KEY (3.0.1) ─────────────────────────────────────────────────────────────────────
// The resume cache used to reuse ANY valid PNG on disk, so a repair that rewrote a prompt and re-ran
// this tool got the OLD picture back and the weakness only looked fixed. A cached file is now reused
// only when its sidecar (`<file>.key.json`) records the same hash of everything that changes the
// picture: the full prompt sent (palette suffix included), px, engine, quality. A legacy file with no
// sidecar is REGENERATED, not trusted: we cannot know which prompt drew it, and re-rolling it costs
// one image once, whereas trusting it would silently keep the exact bug this fixes.
export function imageCacheKey({ prompt, px, engine, quality }) {
  return crypto.createHash('sha256').update(JSON.stringify([String(prompt), String(px), String(engine), String(quality)])).digest('hex');
}
export const sidecarPath = (filePath) => `${filePath}.key.json`;
export function cacheDecision(filePath, key) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return { reuse: false, reason: 'no file' }; }
  if (!(buf.length > 0 && buf.subarray(0, 8).equals(PNG_MAGIC))) return { reuse: false, reason: 'not a valid PNG' };
  let side;
  try { side = JSON.parse(fs.readFileSync(sidecarPath(filePath), 'utf8')); } catch { return { reuse: false, reason: 'no cache-key sidecar (legacy file — regenerating)' }; }
  if (side?.key !== key) return { reuse: false, reason: 'prompt/size/engine changed since this file was drawn' };
  return { reuse: true, bytes: buf.length };
}
export function writeSidecar(filePath, key) {
  fs.writeFileSync(sidecarPath(filePath), JSON.stringify({ key }) + '\n');
}

// ── IMAGE PRICING ───────────────────────────────────────────────────────────────────────────────
// USD per image, quality=high only (last checked 2026-08-09). There is NO sourced rate for
// gpt-image-2.5-flare, for Grok, or for any engine rendered at a quality other than the rated one, so
// those are UNPRICED (usd null), never $0 and never a high-quality rate applied to an xhigh render.
export const RATED_QUALITY = 'high';
export const IMAGE_RATES = {
  'gpt-image-2': { '1024x1024': 0.167, '1536x1024': 0.25, '1024x1536': 0.25 },
};
export function priceImages(items, rates = IMAGE_RATES) {
  let sum = 0;
  const perImage = [];
  const unpricedEngines = new Set();
  for (const { id, engine, px, quality = RATED_QUALITY } of items) {
    const rate = quality === RATED_QUALITY ? rates[engine]?.[px] : undefined;
    if (typeof rate === 'number') sum += rate; else unpricedEngines.add(rates[engine] ? `${engine}@${quality}` : engine);
    perImage.push({ id, engine, px, usd: typeof rate === 'number' ? rate : null });
  }
  const unpriced = perImage.filter((p) => p.usd == null).length;
  const pricedUsd = Math.round(sum * 1e4) / 1e4;
  return { usd: unpriced ? null : pricedUsd, pricedUsd, unpriced, unpricedEngines: [...unpricedEngines], perImage };
}

// Colour-direction suffix for the image prompt: ONLY colour values (hex / rgb() / hsl()) go in. The palette
// also carries layout knobs (radius, ease, hero-grad-angle) that mean nothing to an image model.
const COLOUR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;
export function paletteSuffix(palette) {
  if (!palette || typeof palette !== 'object') return '';
  const parts = Object.entries(palette)
    .filter(([, v]) => v != null && COLOUR_VALUE.test(String(v).trim()))
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length ? `\n\nColour direction (hold to this palette): ${parts.join('; ')}.` : '';
}

/** Quality label for the result: Grok has no quality param, so a Grok-rendered run must not claim `xhigh`. */
export const qualityFor = (engineId) => (engineId === GROK_MODEL
  ? 'n/a (Grok has no quality param; see px for the aspect_ratio/resolution tier used)' : QUALITY);


// ── hero scene instead of a hero raster ────────────────────────────────────────────────────────
// When the page already has a VALID authored hero scene (visuals.heroAnim, validated by the same function
// make-diagrams uses), the paid raster hero is not drawn: the scene IS the hero. The decision is a pure function.
export function heroRasterDecision(visuals, buildDir) {
  const a = visuals && typeof visuals.heroAnim === 'object' ? visuals.heroAnim : null;
  if (!a) return { skip: false, reason: 'no hero scene authored' };
  let svg = null;
  if (typeof a.sceneMarkup === 'string' && a.sceneMarkup.trim()) svg = a.sceneMarkup;
  else if (typeof a.sceneSvg === 'string' && a.sceneSvg.trim()) {
    const f = path.isAbsolute(a.sceneSvg) ? a.sceneSvg : path.join(buildDir, a.sceneSvg);
    try { svg = fs.readFileSync(f, 'utf8'); } catch { return { skip: false, reason: `hero scene file not readable: ${f}` }; }
  }
  if (!svg) return { skip: false, reason: 'heroAnim carries no scene (chips band only)' };
  const defects = validateHeroScene(svg);
  return defects.length ? { skip: false, reason: `hero scene invalid: ${defects.slice(0, 3).join('; ')}` } : { skip: true, svg, reason: 'valid hero scene' };
}

// The favicon and social-card stations crop visuals.hero.file, so a scene-hero still needs ONE image: the scene's
// static end state (no animation runs in a rasteriser) centred on its own background. Free: no model call.
export async function renderSceneBackdrop(svg, outFile, { bg = '#0d1114', w = 1536, h = 1024 } = {}) {
  const bgm = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(svg);   // the scene's own page colour, else the palette bg
  const scene = await sharp(Buffer.from(svg), { density: 192 }).resize({ height: h, width: w, fit: 'inside' }).png().toBuffer();
  const m = await sharp(scene).metadata();
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: (bgm && bgm[1]) || bg } })
    .composite([{ input: scene, left: Math.round((w - m.width) / 2), top: Math.round((h - m.height) / 2) }]).png().toBuffer();
  fs.writeFileSync(outFile, buf);
  return buf.length;
}

// Normalise the brain-declared rungs into a uniform work list. Fail loud on any malformed rung.
function collectRungs(visuals) {
  const rungs = [];
  const hero = visuals.hero;
  if (hero && (hero.prompt != null || hero.role != null || hero.px != null)) {
    rungs.push({ kind: 'hero', id: 'hero', role: hero.role, prompt: hero.prompt, px: hero.px || '1536x1024' });
  }
  const sections = visuals.sections;
  if (sections != null) {
    if (!Array.isArray(sections)) throw new Error('visuals.sections must be an array');
    sections.forEach((s, i) => {
      if (!s || typeof s !== 'object') throw new Error(`visuals.sections[${i}] is not an object`);
      rungs.push({ kind: 'section', index: i, id: s.id, role: s.role, prompt: s.prompt, px: s.px || '1024x1024' });
    });
  }
  return rungs;
}

function validateRung(r) {
  const where = r.kind === 'hero' ? 'visuals.hero' : `visuals.sections[${r.index}]`;
  if (r.kind === 'section' && (r.id == null || String(r.id).trim() === '')) throw new Error(`${where}.id is required (drives filename + arc mapping)`);
  if (r.role == null || String(r.role).trim() === '') throw new Error(`${where}.role is required`);
  if (r.prompt == null || String(r.prompt).trim() === '') throw new Error(`${where}.prompt is required`);
  if (!VALID_SIZES.has(r.px)) throw new Error(`${where}.px="${r.px}" is not a valid gpt-image size (allowed: ${[...VALID_SIZES].join(', ')})`);
}

async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) fail('usage: node tools/generate-image.mjs <build-dir>', 2);
  const absBuildDir = path.isAbsolute(buildDir) ? buildDir : path.resolve(process.cwd(), buildDir);
  const buildJsonPath = path.join(absBuildDir, 'build.json');

  // ---- read the BuildContext + take ONLY the declared slice ----
  let build;
  try { build = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); }
  catch (e) { return fail(`cannot read build.json at ${buildJsonPath}: ${e?.message || e}`); }

  const visuals = build.visuals;
  if (!visuals || typeof visuals !== 'object') return fail('build.json has no `visuals` slot — nothing declared to generate (a missing input is a loud stop)');

  let rungs;
  try { rungs = collectRungs(visuals); } catch (e) { return fail(`malformed visuals rungs: ${e?.message || e}`); }
  if (rungs.length === 0) return fail('no emotional rungs declared (visuals.hero + visuals.sections[] are both empty) — nothing to generate');
  try { for (const r of rungs) validateRung(r); } catch (e) { return fail(e?.message || String(e)); }

  // A valid authored hero scene replaces the paid raster hero (recorded as hero.rasterSkipped = 'scene').
  const heroDecision = heroRasterDecision(visuals, absBuildDir);
  const drawRungs = heroDecision.skip ? rungs.filter((r) => r.kind !== 'hero') : rungs;
  console.error(`[generate-image] hero raster: ${heroDecision.skip ? 'SKIPPED — the hero scene is the hero' : `drawn (${heroDecision.reason})`}`);

  const palette = (build.concept && typeof build.concept === 'object') ? build.concept.palette : null;
  const colourSuffix = paletteSuffix(palette);

  // ---- probe the engines: OpenAI (flare -> gpt-image-2) first, Grok as the safety net, else a loud stop ----
  const grokKey = loadGrokKey();
  const grokOK = !!grokKey && await probeGrok(grokKey);
  const apiKey = loadOpenAiKey();
  let openaiModel = null;
  if (apiKey) {
    if (await probeModel(PRIMARY_MODEL, apiKey)) openaiModel = PRIMARY_MODEL;
    else if (await probeModel(FALLBACK_MODEL, apiKey)) {
      openaiModel = FALLBACK_MODEL;
      console.error(`[generate-image] ${PRIMARY_MODEL} probe failed — falling back to ${FALLBACK_MODEL}`);
    }
  }
  if (!grokOK && !openaiModel) {
    return fail(`image-engine probe failed for Grok AND the whole OpenAI chain (${PRIMARY_MODEL}, ${FALLBACK_MODEL}) — refusing to substitute or fake an image`);
  }
  const engine = openaiModel || GROK_MODEL;
  const generateFn = openaiModel
    ? (prompt, px) => generateOne(openaiModel, prompt, px, apiKey)
    : (prompt, px) => generateOneGrok(prompt, px, grokKey);
  console.error(`[generate-image] engine: ${engine} (every raster)`);

  const assetsDir = path.join(absBuildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  // ---- generate rungs with ONE process and bounded concurrency (3); ANY failure is a loud stop (no partial merge) ----
  const IMAGE_CONCURRENCY = 3;
  async function mapWithConcurrency(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; }
        catch (reason) { out[i] = { status: 'rejected', reason }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }
  async function renderRung(r) {
    const label = `${r.kind}${r.kind === 'section' ? `(${r.id})` : ''}`;
    const fileName = `${safeName(r.kind === 'hero' ? 'hero' : r.id)}.png`;
    const filePath = path.join(assetsDir, fileName);
    // resume idempotency: reuse a PNG on disk ONLY if it was drawn from these exact inputs (see imageCacheKey)
    const fullPrompt = String(r.prompt) + colourSuffix;
    const key = imageCacheKey({ prompt: fullPrompt, px: r.px, engine, quality: engine === GROK_MODEL ? 'n/a' : QUALITY });
    const cache = cacheDecision(filePath, key);
    if (cache.reuse) {
      console.error(`[generate-image] ${label}: reusing cached ${cache.bytes} bytes (same prompt/size/engine) -> ${filePath}`);
      return { rung: r, filePath, bytes: cache.bytes };
    }
    if (cache.reason !== 'no file') console.error(`[generate-image] ${label}: not reusing ${filePath} — ${cache.reason}`);
    let buf, lastErr;
    for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
      try { buf = await generateFn(fullPrompt, r.px); break; }
      catch (e) {
        lastErr = e;
        if (attempt < GEN_ATTEMPTS) {
          console.error(`[generate-image] ${label}: attempt ${attempt}/${GEN_ATTEMPTS} failed (${e?.message || e}) — retrying in ${attempt * 4}s`);
          await new Promise((res) => setTimeout(res, attempt * 4000));
        }
      }
    }
    if (!buf) throw lastErr || new Error(`image generation failed after ${GEN_ATTEMPTS} attempts`);
    fs.writeFileSync(filePath, buf);
    writeSidecar(filePath, key);
    console.error(`[generate-image] ${label}: ${buf.length} bytes -> ${filePath}`);
    return { rung: r, filePath, bytes: buf.length };
  }

  const results = await mapWithConcurrency(drawRungs, IMAGE_CONCURRENCY, renderRung);

  const failures = results.map((res, i) => (res.status === 'rejected' ? `${drawRungs[i].kind}${drawRungs[i].kind === 'section' ? `(${drawRungs[i].id})` : ''}: ${res.reason?.message || res.reason}` : null)).filter(Boolean);
  if (failures.length) return fail(`image generation failed for ${failures.length} rung(s): ${failures.join(' | ')}`);

  // ---- merge ONLY visuals.hero + visuals.sections[] back into build.json (read-modify-write) ----
  // Re-read so we never clobber a slot another tool may have updated; touch ONLY our two sub-slots.
  let fresh;
  try { fresh = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); }
  catch (e) { return fail(`cannot re-read build.json before merge: ${e?.message || e}`); }
  if (!fresh.visuals || typeof fresh.visuals !== 'object') fresh.visuals = {};

  const newSections = [];
  for (let i = 0; i < results.length; i++) {
    const { rung, filePath, bytes } = results[i].value;
    const entry = { role: rung.role, prompt: rung.prompt, file: filePath, px: rung.px, engine, http200: true, bytes };
    if (rung.kind === 'hero') {
      fresh.visuals.hero = entry;
    } else {
      newSections.push({ id: rung.id, ...entry });
    }
  }
  // Only overwrite sections[] if the brain declared sections this run (otherwise leave untouched).
  if (Array.isArray(visuals.sections)) fresh.visuals.sections = newSections;
  let heroBackdrop = null;
  if (heroDecision.skip) {
    const file = path.join(assetsDir, 'hero-scene-static.png');
    const pbg = String(build.concept?.palette?.bg || '').trim();
    const bytes = await renderSceneBackdrop(heroDecision.svg, file, /^#[0-9a-f]{3,8}$/i.test(pbg) ? { bg: pbg } : {});
    const h = visuals.hero || {};
    fresh.visuals.hero = { role: h.role || 'metaphor', prompt: h.prompt, file, px: '1536x1024', engine: 'scene-render', http200: true, bytes, rasterSkipped: 'scene' };
    heroBackdrop = file;
  }

  // Image cost is DERIVED (the image APIs return no charge); an engine/quality with no sourced rate is UNPRICED, never $0.
  const priced = priceImages(results.map((res) => {
    const r = res.value.rung;
    return { id: r.id || r.kind, engine, px: r.px, quality: engine === GROK_MODEL ? 'n/a' : QUALITY };
  }));
  if (priced.unpriced) console.error(`[generate-image] cost: ${priced.unpriced} image(s) UNPRICED — no sourced rate for ${priced.unpricedEngines.join(', ')}`);
  fresh.visuals.cost = {
    usd: priced.usd,
    pricedUsd: priced.pricedUsd,
    unpriced: priced.unpriced,
    unpricedEngines: priced.unpricedEngines,
    images: results.length,
    heroRasterSkipped: heroDecision.skip,
    perImage: priced.perImage,
    basis: priced.unpriced
      ? `UNPRICED: no sourced per-image rate for ${priced.unpricedEngines.join(', ')} — usd is null, not $0`
      : 'derived from published per-image rates at quality=high (the image APIs return no charge)',
    ratesCheckedAt: '2026-08-09',
    ratedQuality: RATED_QUALITY,
  };

  fs.writeFileSync(buildJsonPath, JSON.stringify(fresh, null, 2) + '\n');

  const files = results.map((res) => res.value.filePath).concat(heroBackdrop ? [heroBackdrop] : []);
  succeed({
    engine,
    quality: qualityFor(engine),
    rungs: results.map((res) => ({ id: res.value.rung.id, kind: res.value.rung.kind, px: res.value.rung.px, file: res.value.filePath, http200: true })),
    files,
    slots: ['visuals.hero', 'visuals.sections'],
    buildJson: buildJsonPath,
  });
}

// Run only as a CLI, so tests can import the pure helpers above without firing the pipeline.
const isDirectRun = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; }
  catch { return false; }
})();
if (isDirectRun) main().catch((e) => fail(`unexpected error: ${e?.stack || e?.message || e}`));
