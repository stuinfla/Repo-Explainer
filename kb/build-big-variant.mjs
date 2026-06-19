#!/usr/bin/env node
// build-big-variant.mjs — build the BIG (768-dim) variant of a KB by RE-EMBEDDING the
// existing passages with a stronger model. No repo re-walk: the big variant indexes the
// EXACT SAME text as the small (Seed) build, so the two can never drift in content — only
// the embedder (and answer sharpness) differs.
//
//   small (default ship):  Xenova/all-MiniLM-L6-v2  · 384-dim · Seed-compatible
//   big   (this script):   Xenova/bge-base-en-v1.5  · 768-dim · Mac/PC, sharper retrieval
//
// bge-base-en-v1.5 is asymmetric: PASSAGES embedded with NO prefix (here); QUERIES get an
// instruction prefix at query time (ask-kb reads it from <rvf>.embed.json). Pooling = CLS.
//
// MODES (embedding is the slow part — shard it across processes, then ingest once):
//   node build-big-variant.mjs embed  <store> <shardIdx> <nShards>   # write a vec shard
//   node build-big-variant.mjs ingest <store>                        # assemble .rvf from shards
//   node build-big-variant.mjs both                                  # single-process (slow)
//   node build-big-variant.mjs --smoke                               # model sanity check

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, chooseModelCache } from './resolve-deps.mjs';
import { targets } from './kb.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const KB_DIR = path.dirname(__filename);

const MODEL = 'Xenova/bge-base-en-v1.5';
const DIM = 768;
const POOLING = 'cls';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

// STORES is DERIVED from the config registry (no hard-coded repo names). For each configured
// target slug the big variant re-embeds the SAME passages the small build wrote; passages +
// metadata sidecars are shared by both variants. The generic builder writes ids.json, so the
// meta file is always `<slug>-kb.ids.json`. Legacy ruview's *.meta.json is still resolved by a
// fallback in storeMeta() so an old store also works.
const STORES = Object.fromEntries(Object.keys(targets).map((slug) => [slug, {
  passages: `${slug}-kb.passages.jsonl`,
  meta: `${slug}-kb.ids.json`,
}]));
const vecShardPath = (store, i, n) => path.join(KB_DIR, `${store}-kb.big.vecs.${i}-${n}.jsonl`);
// KB data files live in kb/stores/<store>/ when organized; flat kb/ otherwise.
const storeDir = (store) => {
  const sub = path.join(KB_DIR, 'stores', store);
  return fs.existsSync(sub) ? sub : KB_DIR;
};
// Resolve the meta sidecar: generic builds write <slug>-kb.ids.json; legacy stores used
// <slug>-kb.meta.json. Prefer ids.json, fall back to meta.json if only the legacy file exists.
const storeMeta = (store) => {
  const dir = storeDir(store);
  const ids = path.join(dir, `${store}-kb.ids.json`);
  const legacy = path.join(dir, `${store}-kb.meta.json`);
  return fs.existsSync(ids) ? ids : (fs.existsSync(legacy) ? legacy : ids);
};

const argv = process.argv.slice(2);
const SMOKE = argv.includes('--smoke');

const { mod: rvfMod } = loadRvf();
const { RvfDatabase } = rvfMod;

// ---- embedder (bge needs remote download on first run; allow it explicitly) ----
let _fe = null;
async function getEmbedder() {
  if (_fe) return _fe;
  const { T, via } = await loadTransformers();
  const cache = chooseModelCache();
  T.env.localModelPath = cache;
  T.env.allowRemoteModels = !fs.existsSync(path.join(cache, MODEL));
  console.log(`[big] transformers via ${via} | model ${MODEL} | cache ${cache} `
    + `(${T.env.allowRemoteModels ? 'will download' : 'local'})`);
  _fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });
  return _fe;
}
async function embedTexts(texts) {
  const fe = await getEmbedder();
  return fe(texts, { pooling: POOLING, normalize: true }); // { data, dims:[n,DIM] }
}

function readPassages(file, limit = 0) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (line) => {
      const s = line.trim();
      if (!s) return;
      try { rows.push(JSON.parse(s)); } catch { /* skip malformed */ }
      if (limit && rows.length >= limit) rl.close();
    });
    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}
function cosine(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

// ---------- MODE: embed one shard ----------
async function embedShard(store, shardIdx, nShards) {
  const cfg = STORES[store];
  const rows = await readPassages(path.join(storeDir(store), cfg.passages));
  const mine = rows.filter((_, i) => i % nShards === shardIdx);
  const outFile = vecShardPath(store, shardIdx, nShards);
  console.log(`[embed ${store} ${shardIdx}/${nShards}] ${mine.length} of ${rows.length} passages -> ${path.basename(outFile)}`);
  const fd = fs.openSync(outFile + '.tmp', 'w');
  const BATCH = 64;
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < mine.length; i += BATCH) {
    const batch = mine.slice(i, i + BATCH);
    const out = await embedTexts(batch.map((r) => r.text));
    const dim = out.dims[1];
    if (dim !== DIM) throw new Error(`embed dim ${dim} != ${DIM}`);
    for (let j = 0; j < batch.length; j++) {
      const v = Array.from(out.data.slice(j * dim, (j + 1) * dim));
      fs.writeSync(fd, JSON.stringify({ id: batch[j].id, v }) + '\n');
    }
    done += batch.length;
    if ((i / BATCH) % 20 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`[embed ${store} ${shardIdx}/${nShards}] ${done}/${mine.length} (${rate.toFixed(1)}/s)`);
    }
  }
  fs.closeSync(fd);
  fs.renameSync(outFile + '.tmp', outFile); // atomic: file appears only when complete
  console.log(`[embed ${store} ${shardIdx}/${nShards}] DONE ${done} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ---------- MODE: ingest all shards into one .rvf ----------
async function ingestStore(store) {
  const cfg = STORES[store];
  if (!cfg) throw new Error(`unknown store '${store}' (known: ${Object.keys(STORES).join(', ')})`);
  const dir = storeDir(store);                       // kb/stores/<store>/ (or flat fallback)
  const passagesFile = path.join(dir, cfg.passages);
  const metaFile = storeMeta(store);                 // ids.json (or legacy meta.json) — shared sidecar
  void metaFile;                                     // reserved for future meta-tagging; passages drive reconcile
  const totalPassages = (await readPassages(passagesFile)).length;

  // collect every vec shard for this store
  const shardFiles = fs.readdirSync(KB_DIR)
    .filter((f) => f.startsWith(`${store}-kb.big.vecs.`) && f.endsWith('.jsonl'))
    .map((f) => path.join(KB_DIR, f));
  if (!shardFiles.length) throw new Error(`no vec shards for ${store} — run embed mode first`);
  console.log(`[ingest ${store}] ${shardFiles.length} shard file(s)`);

  const base = path.join(dir, `${store}-kb.big`);    // write big.rvf into kb/stores/<store>/
  const OUT_RVF = `${base}.rvf`;
  for (const f of [OUT_RVF, OUT_RVF + '.idmap.json']) if (fs.existsSync(f)) fs.unlinkSync(f);
  const db = await RvfDatabase.create(OUT_RVF, { dimensions: DIM, metric: 'cosine' });

  const seen = new Set();
  let accepted = 0, rejected = 0, dupes = 0;
  for (const sf of shardFiles) {
    const rows = await readPassages(sf); // {id, v}
    const BATCH = 256;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).filter((r) => {
        if (seen.has(r.id)) { dupes++; return false; }
        seen.add(r.id); return true;
      });
      if (!batch.length) continue;
      const res = await db.ingestBatch(batch.map((r) => ({ id: r.id, vector: r.v })));
      accepted += res.accepted; rejected += res.rejected;
    }
    console.log(`[ingest ${store}] +${path.basename(sf)} (accepted=${accepted}, dupes=${dupes})`);
  }
  const status = await db.status();
  await db.close();

  // NOTE: passages + metadata are SHARED (un-tagged) with the small build in the same dir —
  // the big variant re-uses them (ask-kb reads <store>-kb.passages.jsonl for both), so we do
  // NOT copy a tagged duplicate here (saves ~92 MB/repo and keeps stores/ clean).
  // query-side embedder config (how ask-kb embeds a query for THIS .rvf)
  fs.writeFileSync(`${OUT_RVF}.embed.json`, JSON.stringify({
    model: MODEL, dimensions: DIM, metric: 'cosine', pooling: POOLING, normalize: true,
    queryPrefix: QUERY_PREFIX,
    // bge packs relevant docs tighter than MiniLM; scale the ranking-offset bundle down so the
    // MiniLM-tuned boosts/demotions don't invert bge's good raw order. Tuned via held-out grade.
    rankScale: 0.45,
    note: 'Big (Mac/PC) variant. Passages embedded with NO prefix; queries use queryPrefix (asymmetric).',
    builtFrom: cfg.passages, generated: new Date().toISOString(),
  }, null, 2));

  const ok = status.totalVectors === totalPassages && accepted === totalPassages;
  console.log(`[ingest ${store}] vectors=${status.totalVectors} passages=${totalPassages} accepted=${accepted} rejected=${rejected} dupes=${dupes} match=${ok}`);
  if (!ok) { console.error(`[ingest ${store}] RECONCILE FAILED`); process.exit(1); }
  // clean shards on success
  for (const sf of shardFiles) fs.unlinkSync(sf);
  console.log(`[ingest ${store}] OK — wrote ${path.basename(OUT_RVF)} (+passages,meta,embed.json); shards cleaned`);
  return { store, vectors: status.totalVectors };
}

async function smoke() {
  console.log('=== SMOKE ===');
  // Use the first configured target's passages if present; else just exercise the model on text.
  const firstStore = Object.keys(STORES)[0];
  const passFile = firstStore ? path.join(storeDir(firstStore), STORES[firstStore].passages) : null;
  const rows = passFile && fs.existsSync(passFile)
    ? await readPassages(passFile, 3)
    : [{ path: '(smoke)', text: 'metaharness is a factory for agent frameworks' }];
  const out = await embedTexts(rows.map((r) => r.text));
  console.log('dim:', out.dims[1], '(expected', DIM + ')');
  if (out.dims[1] !== DIM) process.exit(1);
  const fe = await getEmbedder();
  const q = await fe([QUERY_PREFIX + `about ${rows[0].path}`], { pooling: POOLING, normalize: true });
  console.log('cosine(query, passage0) =', cosine(Array.from(q.data), Array.from(out.data.slice(0, DIM))).toFixed(4));
  process.exit(0);
}

// ---------- dispatch ----------
const mode = argv[0];
if (SMOKE) {
  await smoke();
} else if (mode === 'embed') {
  await embedShard(argv[1], parseInt(argv[2], 10), parseInt(argv[3], 10));
} else if (mode === 'ingest') {
  await ingestStore(argv[1]);
} else if (mode === 'both') {
  // `both [store]` — single store when given, else every configured target.
  const stores = argv[1] ? [argv[1]] : Object.keys(STORES);
  for (const s of stores) {
    if (!STORES[s]) { console.error(`unknown store '${s}' (known: ${Object.keys(STORES).join(', ')})`); process.exit(2); }
    await embedShard(s, 0, 1); await ingestStore(s);
  }
} else {
  console.error('usage: build-big-variant.mjs embed <store> <i> <n> | ingest <store> | both [store] | --smoke');
  process.exit(2);
}
