#!/usr/bin/env node
// build-single-384.mjs — build the SINGLE desktop RVF variant for a target by re-embedding the
// existing passages with bge-small-en-v1.5 (384-dim). ADR-0001 v1.3.1 D2/F: ONE RVF per repo,
// 384-dim `Xenova/bge-small-en-v1.5` — a strong retrieval model (instruction-prefixed BGE
// family), lightest + fastest, the best quality-per-byte/ms for desktop. File is the BARE
// canonical name `<slug>-kb.rvf` (model-agnostic, no .small/.big tag) — exactly what the
// drop-in zip + ask-kb single-variant resolution expect.
//
// No repo re-walk: passages.jsonl is the SAME model-agnostic text the structure-aware chunker
// already produced; only the embedder changes. bge-small is asymmetric: PASSAGES embedded with
// NO prefix (here); QUERIES get the instruction prefix at query time (ask-kb reads it from
// <rvf>.embed.json). Pooling = CLS, normalize = true. close() is the only persist path.
//
// Usage: node kb/build-single-384.mjs <slug>     (default = defaultTarget)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, chooseModelCache } from './resolve-deps.mjs';
import { targets, defaultTarget } from './kb.config.mjs';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));

const MODEL = 'Xenova/bge-small-en-v1.5';
const DIM = 384;
const POOLING = 'cls';
const NORMALIZE = true;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const slug = process.argv[2] || defaultTarget;
if (!targets[slug]) {
  console.error(`unknown target '${slug}' (known: ${Object.keys(targets).join(', ')})`);
  process.exit(2);
}
const storeDir = path.join(KB_DIR, 'stores', slug);
const passagesFile = path.join(storeDir, `${slug}-kb.passages.jsonl`);
const OUT_RVF = path.join(storeDir, `${slug}-kb.rvf`);           // BARE canonical name (v1.3.1)
if (!fs.existsSync(passagesFile)) {
  console.error(`passages not found: ${passagesFile} — run build-kb.mjs first to walk the repo`);
  process.exit(2);
}

function readPassages(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (line) => { const s = line.trim(); if (s) { try { rows.push(JSON.parse(s)); } catch { /* skip */ } } });
    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

async function main() {
  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  console.log(`[single-384] @ruvector/rvf via: ${rvfVia}`);

  const { T, via: tVia } = await loadTransformers();
  const cache = chooseModelCache();
  T.env.localModelPath = cache;
  T.env.allowRemoteModels = !fs.existsSync(path.join(cache, MODEL));
  console.log(`[single-384] transformers via ${tVia} | model ${MODEL} | cache ${cache} `
    + `(${T.env.allowRemoteModels ? 'will download' : 'local'})`);
  const fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });

  const rows = await readPassages(passagesFile);
  console.log(`[single-384] ${rows.length} passages from ${path.basename(passagesFile)}`);

  // fresh store
  for (const f of [OUT_RVF, OUT_RVF + '.idmap.json']) fs.rmSync(f, { force: true });
  const db = await RvfDatabase.create(OUT_RVF, { dimensions: DIM, metric: 'cosine' });

  const BATCH = 64;
  let accepted = 0, rejected = 0;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const out = await fe(batch.map((r) => r.text), { pooling: POOLING, normalize: NORMALIZE });
    const dim = out.dims[1];
    if (dim !== DIM) throw new Error(`embed dim ${dim} != ${DIM}`);
    const ingest = batch.map((r, j) => ({
      id: r.id,
      vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)),
    }));
    const res = await db.ingestBatch(ingest);
    accepted += res.accepted; rejected += res.rejected;
    if ((i / BATCH) % 5 === 0) {
      const rate = (i + batch.length) / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r${i + batch.length}/${rows.length} (${rate.toFixed(1)}/s)`);
    }
  }
  const status = await db.status();
  await db.close();                                              // ONLY persist path
  console.log(`\n[single-384] ingested accepted=${accepted} rejected=${rejected} vectors=${status.totalVectors}`);

  // query-side embedder config (how ask-kb embeds a query for THIS .rvf)
  fs.writeFileSync(`${OUT_RVF}.embed.json`, JSON.stringify({
    model: MODEL, dimensions: DIM, metric: 'cosine', pooling: POOLING, normalize: NORMALIZE,
    queryPrefix: QUERY_PREFIX,
    // bge packs relevant docs tighter than MiniLM; scale the MiniLM-tuned ranking-offset bundle
    // down so it doesn't invert bge's already-good raw order. Tuned via the held-out grade.
    rankScale: 0.45,
    note: 'Single 384-dim desktop variant (ADR v1.3.1). Passages embedded with NO prefix; queries use queryPrefix (asymmetric).',
    builtFrom: path.basename(passagesFile), generated: new Date().toISOString(),
  }, null, 2));

  const ok = status.totalVectors === rows.length && accepted === rows.length;
  console.log('=== POST-INGEST ===');
  console.log(`Reconcile: passages=${rows.length} vectors=${status.totalVectors} accepted=${accepted} rejected=${rejected} match=${ok}`);
  if (!ok) { console.error('[single-384] RECONCILE FAILED'); process.exit(1); }
  console.log(`[single-384] OK -> ${path.relative(KB_DIR, OUT_RVF)} (+embed.json) | size ${fs.statSync(OUT_RVF).size} bytes`);
}

main().catch((e) => { console.error('[single-384] ERROR:', e); process.exit(1); });
