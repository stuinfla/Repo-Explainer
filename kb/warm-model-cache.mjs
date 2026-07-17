#!/usr/bin/env node
// warm-model-cache.mjs — make the KB embedder offline-first in hosted builds.
//
// Incident this exists for (2026-07-16, build 79f135b3, bissanmu/spring3-legacy-web): a
// Hugging Face/CloudFront outage left the Actions runner with no way to download
// Xenova/bge-small-en-v1.5, station 1's mandatory real-embedding KB build (INV-06/07)
// correctly refused to fabricate grounding, and the agent burned its whole budget
// discovering that. With kb/models-cache warm (restored by actions/cache), the builder's
// existing offline-first path (resolve-deps.mjs configureModel) never touches the network.
//
// This script: ensures the model is present in kb/models-cache (downloading only when
// missing), then VALIDATES it by running one real embedding — a partial/corrupt cache
// must fail here, not 20 minutes into a build. Exit 0 = cache is good.
//
// Usage: node kb/warm-model-cache.mjs [model]   (default: the hosted pipeline's embedder)

import { loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';

const MODEL = process.argv[2] || 'Xenova/bge-small-en-v1.5';

try {
  const { T, via } = await loadTransformers();
  const cache = chooseModelCache(MODEL);
  const { haveLocalModel } = configureModel(T, cache, MODEL);
  console.log(`[warm-model-cache] ${MODEL} — ${haveLocalModel ? 'already cached' : 'not cached, downloading'} (${cache}; transformers via ${via})`);
  const fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });
  const out = await fe('warm-up probe', { pooling: 'mean', normalize: true });
  const dim = out?.data?.length;
  if (!dim || dim < 64) throw new Error(`embedding came back with suspicious dimension ${dim}`);
  console.log(`[warm-model-cache] OK — real embedding produced (${dim}-dim); KB builds are offline-first from here`);
} catch (e) {
  console.error(`[warm-model-cache] FAILED: ${e.message}`);
  console.error('[warm-model-cache] no usable local model and no working download path — the runner preflight will stop the build in seconds with a clear alert instead of burning its budget');
  process.exit(1);
}
