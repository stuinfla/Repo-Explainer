#!/usr/bin/env node
// warm-model-cache.mjs — make the KB embedder offline-first in hosted builds.
//
// Release asset first (sha256-pinned): GitHub-hosted runners are rate-limited by Hugging Face (HTTP 429).
//
// Source order: local cache (validate only) → our release asset → HF (last resort).
// Always VALIDATES by running one real embedding — a partial/corrupt cache must fail here,
// not 20 minutes into a build. Exit 0 = cache is good.
//
// Usage: node kb/warm-model-cache.mjs [model]   (default: the hosted pipeline's embedder)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';

const MODEL = process.argv[2] || 'Xenova/bge-small-en-v1.5';
const RELEASE_ASSET = 'https://github.com/stuinfla/Repo-Explainer/releases/download/kb-models-v1/bge-small-en-v1.5.tgz';
// sha256 of that asset. Fail closed: the archive is only unpacked when its digest equals this pin, and an
// EMPTY pin means "not pinned yet", so the release path is skipped (HF is used) rather than trusted blind.
// Set it with:  curl -sL <RELEASE_ASSET> | shasum -a 256
export const RELEASE_SHA256 = '9b0cef3ff1a2a7c94a51e8ca8303d0a57951001ef65785235f83ddca9a64fee1';

export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const digestMatches = (buf, pin) => /^[0-9a-f]{64}$/.test(pin) && sha256Hex(buf) === pin;

export async function fetchFromRelease(cacheRoot, { fetchImpl = fetch, pin = RELEASE_SHA256, model = MODEL } = {}) {
  if (model !== 'Xenova/bge-small-en-v1.5') return false; // only the standard embedder is mirrored
  if (!pin) { console.log('[warm-model-cache] release asset has no sha256 pin — refusing to unpack it; falling through'); return false; }
  console.log(`[warm-model-cache] fetching from this repo's release (HF-independent): ${RELEASE_ASSET}`);
  const res = await fetchImpl(RELEASE_ASSET, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) { console.log(`[warm-model-cache] release asset HTTP ${res.status} — falling through`); return false; }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!digestMatches(bytes, pin)) { console.log('[warm-model-cache] release asset sha256 does NOT match the pin — discarded; falling through'); return false; }
  const tgz = path.join(cacheRoot, 'bge-small-en-v1.5.tgz');
  fs.mkdirSync(path.join(cacheRoot, 'Xenova'), { recursive: true });
  fs.writeFileSync(tgz, bytes);
  execFileSync('tar', ['xzf', tgz, '-C', path.join(cacheRoot, 'Xenova')]);
  fs.rmSync(tgz);
  return fs.existsSync(path.join(cacheRoot, model, 'onnx', 'model_quantized.onnx'));
}

async function main() {
  try {
    const { T, via } = await loadTransformers();
    const cache = chooseModelCache();
    let { haveLocalModel } = configureModel(T, cache, MODEL);
    console.log(`[warm-model-cache] ${MODEL} — ${haveLocalModel ? 'already cached' : 'not cached'} (${cache}; transformers via ${via})`);

    if (!haveLocalModel) {
      const seeded = await fetchFromRelease(cache).catch((e) => { console.log(`[warm-model-cache] release fetch failed: ${e.message} — falling through`); return false; });
      if (seeded) {
        ({ haveLocalModel } = configureModel(T, cache, MODEL)); // re-point: now offline
        console.log('[warm-model-cache] seeded from release asset');
      } else {
        console.log('[warm-model-cache] last resort: direct HF download (rate-limited from Actions runner IPs — expect this to fail in CI)');
      }
    }

    const fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });
    const out = await fe('warm-up probe', { pooling: 'mean', normalize: true });
    const dim = out?.data?.length;
    if (!dim || dim < 64) throw new Error(`embedding came back with suspicious dimension ${dim}`);
    console.log(`[warm-model-cache] OK — real embedding produced (${dim}-dim); KB builds are offline-first from here`);
  } catch (e) {
    console.error(`[warm-model-cache] FAILED: ${e.message}`);
    console.error('[warm-model-cache] no usable local model and no working source (release asset + HF both failed) — the runner preflight will stop the build in seconds with a clear alert instead of burning its budget');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
