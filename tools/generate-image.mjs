#!/usr/bin/env node
// generate-image.mjs — Station 4 (VISUALIZE): generate the EMOTIONAL raster rungs.
//
// One pure tool over a probed image engine. Reads the brain-authored emotional rungs from the
// BuildContext (`visuals.hero` + every entry in `visuals.sections[]`), generates each as a real
// raster image, and merges ONLY its own two slots back into build.json. The STRUCTURAL rungs
// (architecture/flow/big-idea/insight SVGs) are make-diagrams' job, not this one.
//
// Image engine (2026-07-11, real evidence — see the QUALITY comment below for the A/B numbers):
// PRIMARY = grok-imagine-image-quality (xAI). Live-measured 5-10s/image vs gpt-image-2's 44-120s
// (10-23x faster), same visual quality tier for this flat-illustrative content, verified once the
// correct params were found (Grok takes `aspect_ratio`+`resolution`, NOT `size` — that's OpenAI's
// shape and Grok hard-rejects it). Native output can exceed our target px by design (we request a
// resolution tier >= target so we only ever downscale via sharp, never upscale-blur) — see
// GROK_PX_MAP. FALLBACK (if the Grok key/probe is unavailable) = gpt-image-2, quality "medium",
// then gpt-image-1 if THAT probe fails too. If everything 404s we STOP LOUD with the failing IDs —
// never a silent substitution, never a placeholder.
//
// Sizes: hero = 1536x1024; raster sections = 1024x1024 (valid sizes: 1024x1024, 1024x1536,
// 1536x1024, auto — the DALL·E-3 1792x1024 is rejected). `auto` has no Grok mapping (falls
// through to OpenAI) since no rung in this pipeline actually declares it.
//
// CONTRACT (tools/CONTRACT.md): pure (reads only `visuals` rungs + `concept.palette` + the
// Grok/OpenAI keys from env), fail-loud (non-zero exit + clear message, NEVER a placeholder
// asset), single JSON result object on stdout, diagnostics on stderr, merges ONLY visuals.hero +
// visuals.sections[].
//
// Usage: node tools/generate-image.mjs <build-dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url)); // tools/
const ROOT = path.resolve(TOOLS_DIR, '..');

const API_URL = 'https://api.openai.com/v1';
const GROK_API_URL = 'https://api.x.ai/v1';
const GROK_MODEL = 'grok-imagine-image-quality';
// Grok has no per-pixel `size` param — it takes aspect_ratio + resolution. Mapped so the native
// output is >= our target px (downscale-only). Verified live 2026-07-11: 1536x1024 -> "3:2"@"2k"
// natively returns 2496x1664 (same 1.5 ratio); 1024x1024 -> "1:1"@"1k" returns EXACTLY 1024x1024.
const GROK_PX_MAP = {
  '1536x1024': { aspect_ratio: '3:2', resolution: '2k' },
  '1024x1536': { aspect_ratio: '2:3', resolution: '2k' },
  '1024x1024': { aspect_ratio: '1:1', resolution: '1k' },
};
// Was 'high' ("owner requirement: max quality"). Reversed 2026-07-10 on real evidence, not a
// guess: a live timed A/B (same prompt, same size) measured high=119.6s vs medium=43.6s per
// image (2.7x), and the medium output was viewed directly — full-bleed, correct dimensions, no
// visible quality loss for this flat-vector-icon content type. Checked and rejected the
// alternatives first: grok-imagine-image-quality is 23x faster but its API hard-rejects a `size`
// param (confirmed via live 400 "Argument not supported: size") — can't meet the 1536x1024
// hero / 1024x1024 section contract, disqualified on a technical constraint, not taste.
// gemini-3.1-flash-image is 14x faster but added an unrequested padded frame instead of filling
// the canvas — a real defect, not fixed, flagged as a future candidate once that's resolved.
// Meta's Emu has no public API at all (app-only, watermarked) — not usable regardless of quality.
const QUALITY = 'medium';
const PRIMARY_MODEL = 'gpt-image-2';         // verified primary (ADR-0005 D7)
const FALLBACK_MODEL = 'gpt-image-1';        // safety net only if the probe fails
const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const PROBE_TIMEOUT_MS = 30_000;
const GEN_TIMEOUT_MS = 300_000;              // high-quality photoreal renders can take 60–90s+ when the endpoint is loaded; 180s was too tight and aborted mid-render
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

// Build a deterministic colour-direction suffix from the brain's palette (pure transform).
function paletteSuffix(palette) {
  if (!palette || typeof palette !== 'object') return '';
  const parts = Object.entries(palette)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length ? `\n\nColour direction (hold to this palette): ${parts.join('; ')}.` : '';
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

  const palette = (build.concept && typeof build.concept === 'object') ? build.concept.palette : null;
  const colourSuffix = paletteSuffix(palette);

  // ---- probe the engine: Grok (fast primary, 2026-07-11) -> gpt-image-2 -> gpt-image-1 -> loud stop ----
  // Grok chosen as primary on real measured evidence, not preference: ~5-10s/image vs gpt-image-2's
  // ~44-120s (10-23x), same visual quality tier for this content type — see the header comment.
  // OpenAI stays the fully-proven fallback if the Grok key is missing or the probe fails.
  //
  // ENGINE CHOICE IS PER-RUNG, on the READER's terms, not the pipeline's (2026-07-12).
  // The hero is the ONE image above the fold: it is the first thing a stranger sees and it decides
  // whether they scroll at all. Every hero on the wall that landed well was a gpt-image-2 render; the
  // first build to ship a Grok hero (ternlight) came back from Stuart as "a 4 out of 10". Grok's real,
  // measured win is SPEED (~5-10s vs gpt-image-2's ~44-120s) — and speed is worth having on the two
  // secondary rasters, which nobody's first impression rests on. Making the hero fast was optimising
  // the one place where slow was worth paying for.
  //   hero     -> quality engine (gpt-image-2), ~1 extra minute, spent where it buys the most
  //   sections -> fast engine (Grok), 10-23x faster, quality tier is fine for supporting art
  // Either engine covers for the other if its probe fails, so a missing key degrades, never dies.
  let generateFn = null;
  const engines = {};
  const grokKey = loadGrokKey();
  const grokOK = !!grokKey && await probeGrok(grokKey);
  const apiKey = loadOpenAiKey();
  let openaiModel = null;
  if (apiKey) {
    if (await probeModel(PRIMARY_MODEL, apiKey)) openaiModel = PRIMARY_MODEL;
    else if (await probeModel(FALLBACK_MODEL, apiKey)) {
      openaiModel = FALLBACK_MODEL;
      console.error(`[generate-image] gpt-image-2 probe failed — falling back to ${FALLBACK_MODEL}`);
    }
  }
  if (!grokOK && !openaiModel) {
    return fail(`image-engine probe failed for Grok AND the whole OpenAI chain (${PRIMARY_MODEL}, ${FALLBACK_MODEL}) — refusing to substitute or fake an image`);
  }
  const grokFn = grokOK ? (prompt, px) => generateOneGrok(prompt, px, grokKey) : null;
  const openaiFn = openaiModel ? (prompt, px) => generateOne(openaiModel, prompt, px, apiKey) : null;

  // 2026-07-12, REVISED SAME DAY on real evidence: the section rasters get the QUALITY engine too.
  // The speed split above was right in principle and wrong in fact — the section images are full-width,
  // on-page, and a reader looks straight at them; they are not "supporting art". Shipping them on the fast
  // engine produced a problem-section image nobody could decode. Grok stays as the FALLBACK (it is genuinely
  // 10-23x faster and a fine safety net), but it is no longer the default for anything a reader sees big.
  // Cost of this decision: ~2 extra minutes per build. That is the correct trade and we measured it.
  engines.hero = openaiModel || GROK_MODEL;
  engines.section = openaiModel || GROK_MODEL;
  const heroFn = openaiFn || grokFn;
  const sectionFn = openaiFn || grokFn;
  generateFn = (prompt, px, kind) => (kind === 'hero' ? heroFn : sectionFn)(prompt, px);
  const engine = `hero:${engines.hero} + sections:${engines.section}`;
  console.error(`[generate-image] engines — hero: ${engines.hero} (quality, above the fold) · sections: ${engines.section} (speed)`);

  const assetsDir = path.join(absBuildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  // ---- generate rungs with BOUNDED concurrency; ANY failure is a loud stop (no partial merge) ----
  // Was a strict sequential for-loop: the endpoint 502s/stalls when several HIGH-quality renders
  // peak at once, so concurrency was disabled entirely. Two things changed 2026-07-10: (1) QUALITY
  // dropped to 'medium' (see above) — a lighter request than what caused those stalls; (2) SKILL.md
  // was ALSO telling the agent to fire "one call per rung, in parallel" as separate `generate-image`
  // processes — but this file never had a per-rung CLI arg, so those were redundant full-script
  // invocations racing on the same output files, papered over by the resume-cache check and a
  // `until ls *.png; do sleep 5; done` polling loop the agent improvised (measured: ~6min of a
  // ~12min image station was that polling + one 302s blocking call). Fixed at the source instead of
  // patching the workaround: ONE process call now handles every rung with real bounded concurrency.
  // Cap of 3 is a conservative starting point (medium-quality concurrent stability is untested past
  // this) — raise it only after a real measured run shows headroom, don't guess it higher.
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
    // resume idempotency: reuse a valid PNG already on disk (from an earlier partial run) — don't re-roll finished work
    try {
      const cached = fs.readFileSync(filePath);
      if (cached.length > 0 && cached.subarray(0, 8).equals(PNG_MAGIC)) {
        console.error(`[generate-image] ${label}: reusing cached ${cached.length} bytes -> ${filePath}`);
        return { rung: r, filePath, bytes: cached.length };
      }
    } catch { /* not cached — generate below */ }
    let buf, lastErr;
    for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
      try { buf = await generateFn(String(r.prompt) + colourSuffix, r.px, r.kind); break; }
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
    console.error(`[generate-image] ${label}: ${buf.length} bytes -> ${filePath}`);
    return { rung: r, filePath, bytes: buf.length };
  }

  const results = await mapWithConcurrency(rungs, IMAGE_CONCURRENCY, renderRung);

  const failures = results.map((res, i) => (res.status === 'rejected' ? `${rungs[i].kind}${rungs[i].kind === 'section' ? `(${rungs[i].id})` : ''}: ${res.reason?.message || res.reason}` : null)).filter(Boolean);
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
    const rungEngine = rung.kind === 'hero' ? engines.hero : engines.section;
    const entry = { role: rung.role, prompt: rung.prompt, file: filePath, px: rung.px, engine: rungEngine, http200: true, bytes };
    if (rung.kind === 'hero') {
      fresh.visuals.hero = entry;
    } else {
      newSections.push({ id: rung.id, ...entry });
    }
  }
  // Only overwrite sections[] if the brain declared sections this run (otherwise leave untouched).
  if (Array.isArray(visuals.sections)) fresh.visuals.sections = newSections;

  // ── IMAGE COST (2026-08-09) ───────────────────────────────────────────────────────────────────
  // Rasters are the single largest line item in a LOCAL build and were entirely unaccounted, which
  // is why "what does a build cost?" could only be answered by estimating. Per-image, per-size rates
  // are published and the image APIs return no charge, so this is DERIVED and labelled as such.
  // Rates last checked 2026-08-09; if they drift, the receipt is wrong in a visible, fixable way
  // rather than silently absent.
  const IMAGE_RATES = {                       // USD per image, quality=high
    'gpt-image-2': { '1024x1024': 0.167, '1536x1024': 0.25, '1024x1536': 0.25 },
    'gpt-image-1': { '1024x1024': 0.167, '1536x1024': 0.25, '1024x1536': 0.25 },
  };
  let imageUsd = 0;
  const perImage = [];
  for (const res of results) {
    const r = res.value.rung;
    const eng = r.kind === 'hero' ? engines.hero : engines.section;
    const rate = IMAGE_RATES[eng]?.[r.px];
    if (typeof rate === 'number') imageUsd += rate;
    perImage.push({ id: r.id || r.kind, engine: eng, px: r.px, usd: rate ?? null });
  }
  fresh.visuals.cost = {
    usd: Math.round(imageUsd * 1e4) / 1e4,
    images: results.length,
    perImage,
    basis: 'derived from published per-image rates (the image APIs return no charge)',
    ratesCheckedAt: '2026-08-09',
  };

  fs.writeFileSync(buildJsonPath, JSON.stringify(fresh, null, 2) + '\n');

  const files = results.map((res) => res.value.filePath);
  succeed({
    engine,
    quality: engine === GROK_MODEL ? 'n/a (Grok has no quality param; see px for the aspect_ratio/resolution tier used)' : QUALITY,
    rungs: results.map((res) => ({ id: res.value.rung.id, kind: res.value.rung.kind, px: res.value.rung.px, file: res.value.filePath, http200: true })),
    files,
    slots: ['visuals.hero', 'visuals.sections'],
    buildJson: buildJsonPath,
  });
}

main().catch((e) => fail(`unexpected error: ${e?.stack || e?.message || e}`));
