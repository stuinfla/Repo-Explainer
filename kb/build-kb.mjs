#!/usr/bin/env node
// build-kb.mjs — GENERIC, config-driven RVF corpus builder (full + incremental delta).
//
// Repo shape is DATA in kb.config.mjs (repoDir, scopeExclude, extension classes, componentRoots,
// include[] rules). This script:
//   1. reads the target entry from kb.config.mjs (--target <slug>, default = defaultTarget),
//   2. builds the corpus via kb/chunker.mjs (structure-aware chunker) + corpus-rules.mjs,
//   3. embeds chunks with the target's embedder (local ONNX via @xenova/transformers, offline),
//   4. writes the store into kb/stores/<slug>/ (KB_STORE_DIR overrides, mirroring KB_REPO_DIR):
//        <slug>-kb<suffix>.rvf (+ .idmap.json written by RVF on close)
//        <slug>-kb.passages.jsonl   (full untruncated chunk text)
//        <slug>-kb.ids.json         (per-id kind/preview index + maxIdEver high-water mark).
//
// --delta (ADR-0010): re-chunk everything (cheap), embed ONLY files whose ordered chunk texts
// changed, delete vanished ids, carry the rest untouched. File-granular on purpose: readers
// (ask-kb.mjs, incl. copies frozen in shipped drop-ins) reconstruct a path's chunk order by
// numeric id sort, so a changed file's chunks are replaced WHOLESALE under fresh increasing ids.
// Synthetic `PRIMER#` entries (index-primer.mjs) are preserved verbatim. All store mutation is
// staged on a clone and published atomically (crash-safe). NOTE: per-vector `metadata` is NOT
// passed to ingestBatch — @ruvector/rvf 0.3.0 rejects it (issue #704); sidecars carry it all.
//
// Usage: node kb/build-kb.mjs --target <slug> [--delta] [--force-delta]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { RULE_IMPLS } from './corpus-rules.mjs';
import { makeContext } from './chunker.mjs';
import {
  SYNTHETIC_PATH_RE, acquireLock, readPassages, readIdsIndex,
  cloneFile, publish, firstIdOrderViolation,
} from './store-set.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/

// Default embedder (legacy / Seed-compatible): MiniLM-384 → <slug>-kb.small.rvf.
// A target may override via an `embed` block in kb.config.mjs (ADR-0001 v1.3.1).
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIM = 384;
const BATCH = 32;
const CHURN_LIMIT = 0.4;    // delta refuses above this work fraction (ADR-0010 D3)

// ---------- arg parsing ----------
function parseArgs(argv) {
  const a = { target: defaultTarget, delta: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') a.target = argv[++i];
    else if (argv[i].startsWith('--target=')) a.target = argv[i].slice('--target='.length);
    else if (argv[i] === '--delta') a.delta = true;
    else if (argv[i] === '--force-delta') { a.delta = true; a.force = true; }
  }
  return a;
}

// ---------- shared pieces ----------
function resolveEmbedder(target) {
  const emb = target.embed || {};
  return {
    MODEL: emb.model || DEFAULT_MODEL,
    DIM: emb.dim || DEFAULT_DIM,
    POOLING: emb.pooling || 'mean',
    QUERY_PREFIX: emb.queryPrefix || '',   // passages are embedded WITHOUT the prefix
    RANK_SCALE: typeof emb.rankScale === 'number' ? emb.rankScale : 1.0,
    RVF_SUFFIX: emb.rvfSuffix || (target.embed ? '.rvf' : '.small.rvf'),
    hasOverride: !!target.embed,
  };
}

function storePaths(slug, RVF_SUFFIX) {
  const storeDir = process.env.KB_STORE_DIR
    ? path.resolve(process.env.KB_STORE_DIR)
    : path.join(__dirname, 'stores', slug);
  const base = path.join(storeDir, `${slug}-kb`);
  return {
    storeDir, base,
    OUT_RVF: `${base}${RVF_SUFFIX}`,
    OUT_PASSAGES: `${base}.passages.jsonl`,
    OUT_IDS: `${base}.ids.json`,
    OUT_EMBEDCFG: `${base}${RVF_SUFFIX}.embed.json`,
  };
}

function buildCorpus(target) {
  const ctx = makeContext(target);
  console.log(`[build-kb] repoDir=${ctx.repoDir}`);
  for (const rule of target.include || []) {
    const impl = RULE_IMPLS[rule.rule];
    if (!impl) { console.error(`[build-kb] unknown include rule "${rule.rule}" — skipped`); continue; }
    const n = impl(ctx, rule);
    console.log(`[build-kb] rule ${rule.rule.padEnd(18)} -> ${n} source(s)`);
  }
  const entries = ctx.entries;
  console.log('=== CORPUS (source files per kind) ===');
  console.log(JSON.stringify(ctx.sourceCounts, null, 2));
  const kindTotals = {};
  for (const e of entries) kindTotals[e.kind] = (kindTotals[e.kind] || 0) + 1;
  console.log('Chunks per kind:', JSON.stringify(kindTotals));
  console.log('Total chunks:', entries.length);
  console.log('Distinct source paths:', new Set(entries.map((e) => e.path)).size);
  return entries;
}

async function initEmbedder(MODEL) {
  const { T, via: tVia } = await loadTransformers();
  const cache = chooseModelCache(MODEL);
  const { haveLocalModel } = configureModel(T, cache, MODEL);
  console.log(`[build-kb] transformers via ${tVia} | model ${haveLocalModel ? 'local' : 'remote'} (${cache})`);
  return T.pipeline('feature-extraction', MODEL, { quantized: true });
}

// Embed `texts` in batches; returns Float32Array per text. Passages get NO query prefix.
async function embedTexts(fe, texts, { DIM, POOLING }, label) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fe(batch, { pooling: POOLING, normalize: true });
    const dim = res.dims[1];
    if (dim !== DIM) throw new Error(`embed dim ${dim} != ${DIM}`);
    for (let j = 0; j < batch.length; j++) out.push(Float32Array.from(res.data.slice(j * dim, (j + 1) * dim)));
    if ((i / BATCH) % 20 === 0) process.stdout.write(`\r[${label}] ${Math.min(i + batch.length, texts.length)}/${texts.length}`);
  }
  if (texts.length) process.stdout.write(`\r[${label}] ${texts.length}/${texts.length}\n`);
  return out;
}

const passageLine = (id, e) => JSON.stringify({ id, text: e.text, path: e.path, title: e.title, source_type: e.source_type, kind: e.kind });
const idsEntry = (e) => ({
  path: e.path, kind: e.kind, source_type: e.source_type, title: e.title,
  chunk: e.chunkIdx + 1, of: e.chunkTotal,
  preview: e.text.slice(0, 240).replace(/\s+/g, ' '),
});
// FileIdentity (ADR-0010 D2.3): ordered chunk TEXTS of the exact path, all projections,
// JSON-serialized (injective). Texts only — the embed input is text alone, so metadata-only
// changes refresh via the sidecar rewrite without re-embedding.
const fileHash = (texts) => crypto.createHash('sha256').update(JSON.stringify(texts)).digest('hex');

// ---------- full build ----------
async function fullBuild({ slug, target, entries, embCfg, paths, RvfDatabase, fe }) {
  const { MODEL, DIM, POOLING, QUERY_PREFIX, RANK_SCALE, hasOverride } = embCfg;
  const { OUT_RVF, OUT_PASSAGES, OUT_IDS, OUT_EMBEDCFG } = paths;

  fs.rmSync(OUT_RVF, { force: true });
  fs.rmSync(OUT_RVF + '.idmap.json', { force: true });
  const db = await RvfDatabase.create(OUT_RVF, { dimensions: DIM, metric: 'cosine' });

  const idsIndex = {};                          // id -> { path, kind, title, chunk, preview }
  fs.rmSync(OUT_PASSAGES, { force: true });
  const passagesFd = fs.openSync(OUT_PASSAGES, 'w');
  let passageLines = 0;
  let ingested = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const vecs = await embedTexts(fe, batch.map((e) => e.text), embCfg, 'embed');
    const ingest = batch.map((e, j) => {
      const id = String(i + j + 1);
      idsIndex[id] = idsEntry(e);
      fs.writeSync(passagesFd, passageLine(id, e) + '\n');
      passageLines++;
      // NO metadata field: @ruvector/rvf 0.3.0 rejects it (issue #704); sidecars carry it.
      return { id, vector: vecs[j] };
    });
    const r = await db.ingestBatch(ingest);
    ingested += r.accepted;
    if (r.rejected) console.error('REJECTED', r.rejected, 'in batch at', i);
  }
  fs.closeSync(passagesFd);
  console.log(`[build-kb] ingested ${ingested} vectors | passages lines ${passageLines}`);

  const status = await db.status();
  await db.close();   // ONLY persist path

  fs.writeFileSync(OUT_IDS, JSON.stringify({
    model: MODEL, dimensions: DIM, metric: 'cosine', maxIdEver: entries.length, entries: idsIndex,
  }, null, 0));

  // Embedder sidecar (read by ask-kb + index-primer so the QUERY/primer use the SAME model).
  if (hasOverride) {
    fs.writeFileSync(OUT_EMBEDCFG, JSON.stringify({
      model: MODEL, pooling: POOLING, normalize: true, queryPrefix: QUERY_PREFIX, rankScale: RANK_SCALE,
    }, null, 2));
  }

  const idCount = Object.keys(idsIndex).length;
  const ok = status.totalVectors === entries.length && passageLines === entries.length && idCount === entries.length;
  console.log('=== POST-INGEST ===');
  console.log('RVF status:', JSON.stringify(status));
  console.log(`Reconcile: chunks=${entries.length} vectors=${status.totalVectors} passages=${passageLines} ids=${idCount} match=${ok}`);
  if (!ok) { console.error('[build-kb] RECONCILE FAILED'); process.exit(1); }
  console.log(`[build-kb] OK -> ${path.relative(__dirname, OUT_RVF)} (+passages,ids) | size ${fs.statSync(OUT_RVF).size} bytes`);
}

// ---------- delta build (ADR-0010 D2) ----------
async function deltaBuild({ slug, entries, embCfg, paths, RvfDatabase, fe, force }) {
  const { MODEL, DIM, POOLING } = embCfg;
  const { OUT_RVF, OUT_PASSAGES, OUT_IDS, OUT_EMBEDCFG } = paths;
  const refuse = (code, msg) => { console.error(`[delta] REFUSED: ${msg}`); process.exit(code); };

  // ---- previous state (sidecars are the source of truth) ----
  const prevPassages = await readPassages(OUT_PASSAGES);
  const prevIds = readIdsIndex(OUT_IDS);

  // Baseline validation (ADR-0010 D2.1): passages ↔ ids must agree exactly before we plan.
  const passIdSet = new Set(prevPassages.map((r) => r.id));
  const idsIdSet = new Set(Object.keys(prevIds.entries));
  if (passIdSet.size !== prevPassages.length) refuse(1, 'duplicate ids in passages sidecar — rebuild fully');
  if (passIdSet.size !== idsIdSet.size || [...passIdSet].some((id) => !idsIdSet.has(id))) {
    refuse(1, `passages/ids id-set mismatch (${passIdSet.size} vs ${idsIdSet.size}) — rebuild fully`);
  }
  // Embedder identity guard (model + dim from ids.json; pooling/normalize from .embed.json).
  if (prevIds.header.model !== MODEL || prevIds.header.dimensions !== DIM) {
    refuse(2, `embedder mismatch: store=${prevIds.header.model}/${prevIds.header.dimensions} target=${MODEL}/${DIM} — rebuild fully`);
  }
  if (fs.existsSync(OUT_EMBEDCFG)) {
    const ec = JSON.parse(fs.readFileSync(OUT_EMBEDCFG, 'utf8'));
    if ((ec.pooling || 'mean') !== POOLING || ec.normalize === false) {
      refuse(2, `embed config mismatch (pooling/normalize) — rebuild fully`);
    }
  }
  // Live store must agree with the sidecars.
  {
    const ro = await RvfDatabase.openReadonly(OUT_RVF);
    const st = await ro.status();
    await ro.close();
    if (st.totalVectors !== prevPassages.length) {
      refuse(1, `store totalVectors=${st.totalVectors} != sidecar records=${prevPassages.length} — rebuild fully`);
    }
  }

  // ---- split previous into tree records vs preserved synthetic (PRIMER#) ----
  const synthetic = prevPassages.filter((r) => SYNTHETIC_PATH_RE.test(r.path));
  const prevTree = prevPassages.filter((r) => !SYNTHETIC_PATH_RE.test(r.path));
  const prevByPath = new Map();
  for (const r of prevTree) {
    if (!prevByPath.has(r.path)) prevByPath.set(r.path, []);
    prevByPath.get(r.path).push(r);
  }
  for (const arr of prevByPath.values()) arr.sort((a, b) => Number(a.id) - Number(b.id)); // emission order

  const newByPath = new Map();
  for (const e of entries) {
    if (!newByPath.has(e.path)) newByPath.set(e.path, []);
    newByPath.get(e.path).push(e);
  }

  // ---- diff at file granularity ----
  const carried = new Map();      // path -> prev records (ids reused positionally)
  const toEmbed = [];             // corpus entries needing embedding (emission order)
  const deleteIds = [];
  let changedPaths = 0, addedPaths = 0;
  for (const [p, newRecs] of newByPath) {
    const prevRecs = prevByPath.get(p);
    if (prevRecs && fileHash(prevRecs.map((r) => r.text)) === fileHash(newRecs.map((e) => e.text))) {
      carried.set(p, prevRecs);
    } else {
      toEmbed.push(...newRecs);
      if (prevRecs) { changedPaths++; deleteIds.push(...prevRecs.map((r) => r.id)); }
      else addedPaths++;
    }
  }
  let vanishedIds = 0;
  for (const [p, prevRecs] of prevByPath) {
    if (!newByPath.has(p)) { vanishedIds += prevRecs.length; deleteIds.push(...prevRecs.map((r) => r.id)); }
  }

  const churn = (toEmbed.length + vanishedIds) / entries.length;
  console.log(`[delta] plan: carried=${carried.size} paths | embed=${toEmbed.length} chunks `
    + `(${changedPaths} changed + ${addedPaths} added paths) | delete=${deleteIds.length} ids `
    + `(${vanishedIds} vanished) | preserved synthetic=${synthetic.length} | churn=${(churn * 100).toFixed(1)}%`);
  if (churn > CHURN_LIMIT && !force) {
    refuse(2, `churn ${(churn * 100).toFixed(1)}% > ${CHURN_LIMIT * 100}% — a full rebuild is cheaper/safer `
      + `(or pass --force-delta if this is intentional)`);
  }

  // ---- assign ids: carried keep theirs; fresh from the persisted high-water mark ----
  let maxIdEver = Number(prevIds.header.maxIdEver || 0);
  for (const r of prevPassages) { const n = Number(r.id); if (n > maxIdEver) maxIdEver = n; }
  let nextId = maxIdEver + 1;
  const posByPath = new Map();
  const newRecords = entries.map((e) => {
    const pos = posByPath.get(e.path) || 0;
    posByPath.set(e.path, pos + 1);
    const prevRecs = carried.get(e.path);
    const id = prevRecs ? prevRecs[pos].id : String(nextId++);
    return { id, e };
  });
  if (nextId >= Number.MAX_SAFE_INTEGER) refuse(1, 'id space exhausted (MAX_SAFE_INTEGER)');
  const violation = firstIdOrderViolation(newRecords.map(({ id, e }) => ({ id, path: e.path })));
  if (violation) refuse(1, `internal id-order invariant violation at path ${violation}`);

  // ---- new sidecar contents (corpus order, then preserved synthetic raw lines/entries) ----
  const passagesOut = newRecords.map(({ id, e }) => passageLine(id, e)).concat(synthetic.map((r) => r.raw));
  const idsOut = {};
  for (const { id, e } of newRecords) idsOut[id] = idsEntry(e);
  for (const r of synthetic) idsOut[r.id] = prevIds.entries[r.id];   // verbatim (kind/preview live only here)
  const idsJson = JSON.stringify({
    model: MODEL, dimensions: DIM, metric: 'cosine', maxIdEver: nextId - 1, entries: idsOut,
  }, null, 0);
  const expectTotal = entries.length + synthetic.length;

  // ---- no-op / sidecar-only shortcut (metadata refresh without re-embedding) ----
  if (!toEmbed.length && !deleteIds.length) {
    const oldPassages = fs.readFileSync(OUT_PASSAGES, 'utf8');
    const newPassages = passagesOut.join('\n') + '\n';
    if (oldPassages === newPassages && fs.readFileSync(OUT_IDS, 'utf8') === idsJson) {
      console.log(`[delta] OK — nothing changed (${entries.length} chunks carried, 0 embedded)`);
      return;
    }
    publish([
      { staged: writeStaged(OUT_PASSAGES, newPassages), live: OUT_PASSAGES },
      { staged: writeStaged(OUT_IDS, idsJson), live: OUT_IDS },
    ]);
    console.log(`[delta] OK — sidecar-only refresh (0 embedded, 0 deleted, ${entries.length} carried)`);
    return;
  }

  // ---- stage the store clone; validate idmap coverage BEFORE mutating ----
  const S = `${OUT_RVF}.staged`;
  const liveIdmap = `${OUT_RVF}.idmap.json`;
  if (!fs.existsSync(liveIdmap)) refuse(1, `missing ${path.basename(liveIdmap)} (needed to delete by id) — rebuild fully`);
  cloneFile(OUT_RVF, S);
  cloneFile(liveIdmap, `${S}.idmap.json`);
  const cleanupStaged = () => {
    for (const f of [S, `${S}.idmap.json`, `${OUT_PASSAGES}.staged`, `${OUT_IDS}.staged`]) fs.rmSync(f, { force: true });
  };
  try {
    const idmap = JSON.parse(fs.readFileSync(liveIdmap, 'utf8'));
    const mapped = new Set(Object.keys(idmap.idToLabel || {}));
    const unmapped = deleteIds.filter((id) => !mapped.has(id));
    if (unmapped.length) refuse(1, `${unmapped.length} ids to delete are missing from .idmap.json (e.g. ${unmapped[0]}) — rebuild fully`);

    const vecs = await embedTexts(fe, toEmbed.map((e) => e.text), embCfg, 'delta-embed');
    const freshByEntry = new Map(toEmbed.map((e, i) => [e, vecs[i]]));

    const db = await RvfDatabase.open(S);
    if (deleteIds.length) {
      const d = await db.delete(deleteIds);
      if (d.deleted !== deleteIds.length) {
        await db.close();
        throw new Error(`delete mismatch: planned ${deleteIds.length}, store deleted ${d.deleted}`);
      }
    }
    const freshRecords = newRecords.filter(({ e }) => freshByEntry.has(e));
    let accepted = 0;
    for (let i = 0; i < freshRecords.length; i += BATCH) {
      const r = await db.ingestBatch(freshRecords.slice(i, i + BATCH).map(({ id, e }) => ({ id, vector: freshByEntry.get(e) })));
      accepted += r.accepted;
      if (r.rejected) { await db.close(); throw new Error(`ingest rejected ${r.rejected} at batch ${i}`); }
    }
    if (accepted !== toEmbed.length) { await db.close(); throw new Error(`ingest mismatch: planned ${toEmbed.length}, accepted ${accepted}`); }
    if (deleteIds.length) await db.compact();

    const st = await db.status();
    if (st.totalVectors !== expectTotal) { await db.close(); throw new Error(`staged totalVectors=${st.totalVectors} != expected ${expectTotal}`); }
    if (freshRecords.length) {   // probe: a changed chunk must be retrievable in the staged store
      const probe = freshRecords[0];
      const hits = await db.query(freshByEntry.get(probe.e), 5);
      if (!hits.some((h) => h.id === probe.id)) { await db.close(); throw new Error(`probe query did not return fresh id ${probe.id}`); }
    }
    await db.close();   // writes the staged .idmap.json

    publish([
      { staged: S, live: OUT_RVF },
      { staged: `${S}.idmap.json`, live: liveIdmap },
      { staged: writeStaged(OUT_PASSAGES, passagesOut.join('\n') + '\n'), live: OUT_PASSAGES },
      { staged: writeStaged(OUT_IDS, idsJson), live: OUT_IDS },
    ]);
  } catch (e) {
    cleanupStaged();
    console.error('[delta] FAILED (live store untouched):', e.message);
    process.exit(1);
  }
  console.log(`[delta] OK — embedded ${toEmbed.length}, deleted ${deleteIds.length}, carried ${entries.length - toEmbed.length}, `
    + `preserved ${synthetic.length} synthetic | totalVectors=${expectTotal}`);
}

function writeStaged(livePath, content) {
  const staged = `${livePath}.staged`;
  fs.writeFileSync(staged, content);
  return staged;
}

// ---------- main ----------
async function main() {
  const { target: slug, delta, force } = parseArgs(process.argv.slice(2));
  const target = getTarget(slug);
  const embCfg = resolveEmbedder(target);
  console.log(`[build-kb] target=${slug} metaName=${target.metaName} | model=${embCfg.MODEL} dim=${embCfg.DIM} `
    + `pooling=${embCfg.POOLING} out=${slug}-kb${embCfg.RVF_SUFFIX}${delta ? ' | MODE=delta' : ''}`);

  const entries = buildCorpus(target);
  if (!entries.length) { console.error('[build-kb] corpus is EMPTY — nothing to build (refusing: a bad repoDir must never plan a full deletion)'); process.exit(1); }

  const paths = storePaths(slug, embCfg.RVF_SUFFIX);
  fs.mkdirSync(paths.storeDir, { recursive: true });

  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  console.log('[build-kb] @ruvector/rvf via:', rvfVia);
  const fe = await initEmbedder(embCfg.MODEL);

  const releaseLock = acquireLock(paths.base);
  try {
    const havePrev = fs.existsSync(paths.OUT_RVF) && fs.existsSync(paths.OUT_PASSAGES) && fs.existsSync(paths.OUT_IDS);
    if (delta && !havePrev) console.warn('[delta] WARN: no previous store/sidecars — falling back to a FULL build');
    if (delta && havePrev) {
      await deltaBuild({ slug, entries, embCfg, paths, RvfDatabase, fe, force });
    } else {
      await fullBuild({ slug, target, entries, embCfg, paths, RvfDatabase, fe });
    }
  } finally {
    releaseLock();
  }
}

main().catch((e) => { console.error('[build-kb] ERROR:', e); process.exit(1); });
