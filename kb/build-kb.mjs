#!/usr/bin/env node
// build-kb.mjs — GENERIC, config-driven RVF corpus builder.
//
// Replaces the per-repo prototypes (build-ruview-kb.mjs + .build-ruvector-kb/build.mjs): repo
// shape is now DATA in kb.config.mjs (repoDir, scopeExclude, extension classes, componentRoots,
// include[] rules). This script:
//   1. reads the target entry from kb.config.mjs (--target <slug>, default = defaultTarget),
//   2. force-walks the target's OWN tree only (scopeExclude + .gitmodules submodule paths skipped),
//   3. dispatches config.include[] through corpus-rules.mjs (the rule-type registry),
//   4. embeds every chunk with local MiniLM-384 (Xenova/all-MiniLM-L6-v2, quantized ONNX, offline),
//   5. writes the SMALL store into kb/stores/<slug>/:
//        <slug>-kb.small.rvf  (+ .idmap.json written by RVF on close)
//        <slug>-kb.passages.jsonl   (full untruncated chunk text, shared with the big variant)
//        <slug>-kb.ids.json         (per-id kind/preview index; guard-check + ask-kb read this).
//
// Vectors: @ruvector/rvf (RvfDatabase, HNSW, cosine). Embeddings: local @xenova/transformers.
// Deps resolved PORTABLY via resolve-deps.mjs. NO cloud APIs. close() is the only persist path.
//
// Usage: node kb/build-kb.mjs --target agent-harness-generator
//        node kb/build-kb.mjs                 (uses defaultTarget)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel } from './resolve-deps.mjs';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { RULE_IMPLS } from './corpus-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;
const CHUNK_CHARS = 4000;   // ~1000 tokens
const OVERLAP_CHARS = 400;

// ---------- arg parsing ----------
function parseArgs(argv) {
  const a = { target: defaultTarget };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') a.target = argv[++i];
    else if (argv[i].startsWith('--target=')) a.target = argv[i].slice('--target='.length);
  }
  return a;
}

// ---------- shared text helpers ----------
function chunk(text) {
  const out = [];
  if (text.length <= CHUNK_CHARS) return [text];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > i + CHUNK_CHARS / 2) end = para;  // prefer paragraph boundary
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
  }
  return out;
}

// ---------- build context factory ----------
// Builds the `ctx` object the corpus rules consume. Honors scopeExclude + .gitmodules (force-walk:
// a repo with no .gitmodules walks its whole tree, which is the intended AHG case).
function makeContext(target) {
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) {
    throw new Error(`build-kb: repoDir not found for target "${target.slug}": ${repoDir} `
      + '(run P0 clone into .targets/ first)');
  }
  const skip = new Set(target.scopeExclude || []);

  // Read .gitmodules so nested submodules (external upstream repos) are never indexed. Absent
  // .gitmodules -> force-walk (no-op exclusion), the AHG case (Constraint A).
  const submoduleDirs = (() => {
    const set = new Set();
    const gm = (() => { try { return fs.readFileSync(path.join(repoDir, '.gitmodules'), 'utf8'); } catch { return null; } })();
    if (gm) for (const m of gm.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) set.add(path.resolve(repoDir, m[1].trim()));
    return set;
  })();
  const inSubmodule = (p) => {
    for (const d of submoduleDirs) { if (p === d || p.startsWith(d + path.sep)) return true; }
    return false;
  };

  function* walk(dir) {
    let dirents;
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { return; }
    for (const e of dirents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        if (inSubmodule(p)) continue;
        yield* walk(p);
      } else if (e.isFile()) {
        yield p;
      }
    }
  }

  const rel = (p) => path.relative(repoDir, p);

  // Corpus accumulation state.
  const entries = [];                 // { path, kind, title, chunkIdx, chunkTotal, text }
  const sourceCounts = {};            // kind -> source-file count
  const ingestedPaths = new Set();    // absolute paths already ingested (md-sweep / literal de-dup)
  const fullBodyPaths = new Set();    // absolute paths ingested as full source bodies

  function addDoc(relPath, kind, title, text, absPath) {
    const chunks = chunk(text);
    chunks.forEach((c, i) => entries.push({
      path: relPath, kind, title, chunkIdx: i, chunkTotal: chunks.length, text: c,
    }));
    sourceCounts[kind] = (sourceCounts[kind] || 0) + 1;
    if (absPath) ingestedPaths.add(absPath);
  }

  return {
    repoDir,
    walk,
    rel,
    addDoc,
    alreadyIngested: (absPath) => ingestedPaths.has(absPath),
    isFullBody: (absPath) => fullBodyPaths.has(absPath),
    markFullBody: (absPath) => { if (absPath) fullBodyPaths.add(absPath); },
    entries,
    sourceCounts,
  };
}

// ---------- main ----------
async function main() {
  const { target: slug } = parseArgs(process.argv.slice(2));
  const target = getTarget(slug);
  console.log(`[build-kb] target=${slug} metaName=${target.metaName}`);

  const ctx = makeContext(target);
  console.log(`[build-kb] repoDir=${ctx.repoDir}`);

  // ---- run the configured include rules in order ----
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
  console.log('Total chunks to embed:', entries.length);
  console.log('Distinct source paths:', new Set(entries.map((e) => e.path)).size);
  if (!entries.length) { console.error('[build-kb] corpus is EMPTY — nothing to build'); process.exit(1); }

  // ---- output layout: kb/stores/<slug>/ ----
  const storeDir = path.join(__dirname, 'stores', slug);
  fs.mkdirSync(storeDir, { recursive: true });
  const base = path.join(storeDir, `${slug}-kb`);
  const OUT_RVF = `${base}.small.rvf`;
  const OUT_PASSAGES = `${base}.passages.jsonl`;
  const OUT_IDS = `${base}.ids.json`;

  // ---- embedder (offline-first; remote download only if model not cached) ----
  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  console.log('[build-kb] @ruvector/rvf via:', rvfVia);
  const { T, modelCache, via: tVia } = await loadTransformers();
  const { haveLocalModel } = configureModel(T, modelCache);
  console.log(`[build-kb] transformers via ${tVia} | model ${haveLocalModel ? 'local' : 'remote'} (${modelCache})`);
  const fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });

  // ---- fresh store + sidecars ----
  fs.rmSync(OUT_RVF, { force: true });
  fs.rmSync(OUT_RVF + '.idmap.json', { force: true });
  const db = await RvfDatabase.create(OUT_RVF, { dimensions: DIM, metric: 'cosine' });

  const idsIndex = {};                          // id -> { path, kind, title, chunk, preview }
  fs.rmSync(OUT_PASSAGES, { force: true });
  const passagesFd = fs.openSync(OUT_PASSAGES, 'w');
  let passageLines = 0;
  const BATCH = 32;
  let ingested = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const out = await fe(batch.map((e) => e.text), { pooling: 'mean', normalize: true });
    const dim = out.dims[1];
    if (dim !== DIM) throw new Error(`embed dim ${dim} != ${DIM}`);
    const ingest = batch.map((e, j) => {
      const id = String(i + j + 1);
      idsIndex[id] = {
        path: e.path, kind: e.kind, title: e.title,
        chunk: e.chunkIdx + 1, of: e.chunkTotal,
        preview: e.text.slice(0, 240).replace(/\s+/g, ' '),
      };
      fs.writeSync(passagesFd, JSON.stringify({ id, text: e.text, path: e.path, title: e.title }) + '\n');
      passageLines++;
      return {
        id,
        vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)),
        metadata: { path: e.path, kind: e.kind, title: e.title, chunk: e.chunkIdx },
      };
    });
    const r = await db.ingestBatch(ingest);
    ingested += r.accepted;
    if (r.rejected) console.error('REJECTED', r.rejected, 'in batch at', i);
    if ((i / BATCH) % 20 === 0) process.stdout.write(`\r${i + batch.length}/${entries.length}`);
  }
  fs.closeSync(passagesFd);
  console.log(`\n[build-kb] ingested ${ingested} vectors | passages lines ${passageLines}`);

  const status = await db.status();
  await db.close();   // ONLY persist path

  fs.writeFileSync(OUT_IDS, JSON.stringify({
    model: MODEL, dimensions: DIM, metric: 'cosine', entries: idsIndex,
  }, null, 0));

  const idCount = Object.keys(idsIndex).length;
  const ok = status.totalVectors === entries.length && passageLines === entries.length && idCount === entries.length;
  console.log('=== POST-INGEST ===');
  console.log('RVF status:', JSON.stringify(status));
  console.log(`Reconcile: chunks=${entries.length} vectors=${status.totalVectors} passages=${passageLines} ids=${idCount} match=${ok}`);
  if (!ok) { console.error('[build-kb] RECONCILE FAILED'); process.exit(1); }
  console.log(`[build-kb] OK -> ${path.relative(__dirname, OUT_RVF)} (+passages,ids) | size ${fs.statSync(OUT_RVF).size} bytes`);
}

main().catch((e) => { console.error('[build-kb] ERROR:', e); process.exit(1); });
