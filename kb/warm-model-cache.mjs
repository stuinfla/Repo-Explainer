#!/usr/bin/env node
// warm-model-cache.mjs — make the KB embedder offline-first in hosted builds.
//
// Incident 1 (2026-07-16, build 79f135b3): a Hugging Face/CloudFront failure left the Actions
// runner unable to download Xenova/bge-small-en-v1.5; station 1's mandatory real-embedding KB
// build (INV-06/07) correctly refused to fabricate grounding, and the agent burned its whole
// budget discovering that.
// Incident 2 (2026-07-17, run 29557533994 — the make-good): HF answered HTTP 429. GitHub's
// shared runner IPs are RATE-LIMITED by HF, so "wait for HF to recover" is not a fix and the
// actions/cache can never warm itself from HF. The model (MIT, 24 MB) is therefore served from
// THIS repo's own release — github.com is the one origin an Actions runner can always reach.
//
// Source order: local cache (validate only) → our release asset → HF (last resort).
// Always VALIDATES by running one real embedding — a partial/corrupt cache must fail here,
// not 20 minutes into a build. Exit 0 = cache is good.
//
// Usage: node kb/warm-model-cache.mjs [model]   (default: the hosted pipeline's embedder)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';

const MODEL = process.argv[2] || 'Xenova/bge-small-en-v1.5';
const RELEASE_ASSET = 'https://github.com/stuinfla/Repo-Explainer/releases/download/kb-models-v1/bge-small-en-v1.5.tgz';

async function fetchFromRelease(cacheRoot) {
  if (MODEL !== 'Xenova/bge-small-en-v1.5') return false; // only the standard embedder is mirrored
  console.log(`[warm-model-cache] fetching from this repo's release (HF-independent): ${RELEASE_ASSET}`);
  const res = await fetch(RELEASE_ASSET, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) { console.log(`[warm-model-cache] release asset HTTP ${res.status} — falling through`); return false; }
  const tgz = path.join(cacheRoot, 'bge-small-en-v1.5.tgz');
  fs.mkdirSync(path.join(cacheRoot, 'Xenova'), { recursive: true });
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', path.join(cacheRoot, 'Xenova')]);
  fs.rmSync(tgz);
  return fs.existsSync(path.join(cacheRoot, MODEL, 'onnx', 'model_quantized.onnx'));
}

try {
  const { T, via } = await loadTransformers();
  const cache = chooseModelCache(MODEL);
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
