#!/usr/bin/env node
// generate-image.mjs — Station 4 (VISUALIZE): generate the EMOTIONAL raster rungs.
//
// One pure tool over the verified OpenAI image engine. Reads the brain-authored emotional
// rungs from the BuildContext (`visuals.hero` + every entry in `visuals.sections[]`), generates
// each as a real raster image, and merges ONLY its own two slots back into build.json. The
// STRUCTURAL rungs (architecture/flow/big-idea/insight SVGs) are make-diagrams' job, not this one.
//
// Image engine (ADR-0005 D7 / Station 4): PRIMARY = gpt-image-2 (verified real + available in this
// project 2026-06-28 via GET /v1/models/gpt-image-2 -> HTTP 200), quality "high". FALLBACK =
// gpt-image-1, used ONLY if a build-time availability probe of gpt-image-2 fails. If the whole
// OpenAI chain 404s we STOP LOUD with the failing IDs — never a silent substitution, never a
// placeholder. (Deeper cross-provider fallbacks imagen-3 -> gemini-2.x-image are out of scope for
// this OpenAI-keyed tool; their absence is a loud stop, not a fake image.)
//
// Sizes: hero = 1536x1024; raster sections = 1024x1024 (valid gpt-image sizes: 1024x1024,
// 1024x1536, 1536x1024, auto — the DALL·E-3 1792x1024 is rejected).
//
// CONTRACT (tools/CONTRACT.md): pure (reads only `visuals` rungs + `concept.palette` + the OpenAI
// key from env), fail-loud (non-zero exit + clear message, NEVER a placeholder asset), single JSON
// result object on stdout, diagnostics on stderr, merges ONLY visuals.hero + visuals.sections[].
//
// Usage: node tools/generate-image.mjs <build-dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url)); // tools/
const ROOT = path.resolve(TOOLS_DIR, '..');

const API_URL = 'https://api.openai.com/v1';
const QUALITY = 'high';                      // owner requirement: max quality
const PRIMARY_MODEL = 'gpt-image-2';         // verified primary (ADR-0005 D7)
const FALLBACK_MODEL = 'gpt-image-1';        // safety net only if the probe fails
const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const PROBE_TIMEOUT_MS = 30_000;
const GEN_TIMEOUT_MS = 180_000;              // high-quality renders are slow
const GEN_ATTEMPTS = 3;                       // retry transient aborts (concurrent renders can starve one request)
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

  const apiKey = loadOpenAiKey();
  if (!apiKey) return fail('no OpenAI key found (set OPENAI_API_KEY / OPEN_AI_KEY in the environment or repo-root .env)');

  // ---- probe the engine: gpt-image-2 (verified primary) -> gpt-image-1 (fallback) -> loud stop ----
  let engine = null;
  if (await probeModel(PRIMARY_MODEL, apiKey)) engine = PRIMARY_MODEL;
  else if (await probeModel(FALLBACK_MODEL, apiKey)) {
    engine = FALLBACK_MODEL;
    console.error(`[generate-image] gpt-image-2 probe failed — falling back to ${FALLBACK_MODEL}`);
  } else {
    return fail(`image-engine probe failed for the whole OpenAI chain (${PRIMARY_MODEL}, ${FALLBACK_MODEL}) — both unavailable on these keys; refusing to substitute or fake an image`);
  }

  const assetsDir = path.join(absBuildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  // ---- generate every rung (in parallel); ANY failure is a loud stop (no partial slot merge) ----
  const results = await Promise.allSettled(rungs.map(async (r, idx) => {
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
    // stagger so N concurrent high-quality renders don't all peak at once (a starved request hits the abort)
    if (idx) await new Promise((res) => setTimeout(res, idx * 1500));
    let buf, lastErr;
    for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
      try { buf = await generateOne(engine, String(r.prompt) + colourSuffix, r.px, apiKey); break; }
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
  }));

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
    const entry = { role: rung.role, prompt: rung.prompt, file: filePath, px: rung.px, engine, http200: true, bytes };
    if (rung.kind === 'hero') {
      fresh.visuals.hero = entry;
    } else {
      newSections.push({ id: rung.id, ...entry });
    }
  }
  // Only overwrite sections[] if the brain declared sections this run (otherwise leave untouched).
  if (Array.isArray(visuals.sections)) fresh.visuals.sections = newSections;

  fs.writeFileSync(buildJsonPath, JSON.stringify(fresh, null, 2) + '\n');

  const files = results.map((res) => res.value.filePath);
  succeed({
    engine,
    quality: QUALITY,
    rungs: results.map((res) => ({ id: res.value.rung.id, kind: res.value.rung.kind, px: res.value.rung.px, file: res.value.filePath, http200: true })),
    files,
    slots: ['visuals.hero', 'visuals.sections'],
    buildJson: buildJsonPath,
  });
}

main().catch((e) => fail(`unexpected error: ${e?.stack || e?.message || e}`));
