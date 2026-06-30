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
import { loadRvf, loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { RULE_IMPLS } from './corpus-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/

// Default embedder (legacy / Seed-compatible): MiniLM-384 → <slug>-kb.small.rvf.
// A target may override via an `embed` block in kb.config.mjs (ADR-0001 v1.3.1, single 384-dim
// desktop variant — e.g. ruvn uses bge-small-en-v1.5, mean-pooled, asymmetric query prefix,
// written to the canonical un-suffixed <slug>-kb.rvf with an .embed.json sidecar that ask-kb +
// index-primer read so the query is embedded with the SAME model).
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIM = 384;
const CHUNK_CHARS = 4000;   // ~1000 tokens (hard ceiling for the window fallback)
const OVERLAP_CHARS = 400;
// Structure-aware target (ADR-0001 v1.3.0 D5): split at code/document STRUCTURE boundaries,
// keep a doc-comment attached to the symbol it documents, target ≤512 tokens (~2048 chars).
const STRUCT_TARGET_CHARS = 2048;   // ≤512 tokens
const STRUCT_MIN_CHARS = 160;       // don't emit micro-fragments; coalesce upward

// ---------- arg parsing ----------
function parseArgs(argv) {
  const a = { target: defaultTarget };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') a.target = argv[++i];
    else if (argv[i].startsWith('--target=')) a.target = argv[i].slice('--target='.length);
  }
  return a;
}

// ---------- source_type tagging (ADR-0001 v1.3.2: src|test|example|doc|config) ----------
// Every passage carries a coarse source_type so the AI knows what a hit IS (production source vs a
// test vs an example vs prose vs config) and can ask for tests/examples as usage docs. Derived from
// the path first (tests/, examples/, benches/ dirs win), then the corpus `kind`, then the extension.
function classifySourceType(relPath, kind) {
  const p = (relPath || '').toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec|__mocks__)\//.test(p) || /[._-]test\.|[._-]spec\.|\.test$/.test(p)) return 'test';
  if (/(^|\/)(examples?|demos?)\//.test(p)) return 'example';
  if (/(^|\/)benches?\//.test(p)) return 'test';   // benchmarks are exercised-usage; group with test
  if (kind === 'template') return 'example';        // scaffolding templates are usage exemplars
  if (kind === 'crate' || kind === 'npm') return 'config';
  if (/(^|\/)(cargo\.toml|package\.json|tsconfig\.json|\.toml|\.ya?ml|\.json|\.config\.)/.test(p)) return 'config';
  if (kind === 'doc' || kind === 'adr' || kind === 'ddd' || kind === 'tutorial' || /\.(md|mdx|txt)$/.test(p)) return 'doc';
  if (kind === 'source' || kind === 'crate-src' || /\.(rs|ts|tsx|js|mjs|cjs|py|go)$/.test(p)) return 'src';
  return 'doc';
}

// ---------- shared text helpers ----------
// windowChunk — naive fixed-window fallback for any single STRUCTURAL segment that is still
// larger than the hard ceiling (e.g. one enormous function or one giant prose block).
function windowChunk(text) {
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

// structureBoundaries — return char offsets where a NEW structural unit STARTS, so a split
// there keeps a doc-comment attached to the symbol that immediately follows it. Detects:
//   • Markdown/prose: heading lines (#, ##, …) and fenced-block edges.
//   • Rust / TS / JS source: the start of a doc-comment run (//!, ///, /** , //, #-doc) OR,
//     if no doc-comment precedes, the symbol line itself (pub fn / fn / impl / struct / enum /
//     trait / mod / function / class / export). A doc-comment immediately above a symbol is
//     treated as the START of that symbol's unit (so they never split apart).
// Lines are 0-indexed offsets into `text`.
function structureBoundaries(text) {
  const lines = text.split('\n');
  const offsets = [];
  let pos = 0;
  const lineStart = lines.map((l) => { const s = pos; pos += l.length + 1; return s; });

  const isHeading = (l) => /^#{1,6}\s/.test(l);
  const isSymbol = (l) => /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?(fn|impl|struct|enum|trait|mod|union|macro_rules!)\b/.test(l)
    || /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class)\b/.test(l)
    || /^\s*export\s+(const|let|var|interface|type|enum)\b/.test(l);
  const isDocComment = (l) => /^\s*(\/\/[!/]|\/\*\*|#\s)/.test(l) || /^\s*\/\/\s/.test(l);

  const bset = new Set([0]);
  for (let i = 1; i < lines.length; i++) {
    if (isHeading(lines[i])) { bset.add(lineStart[i]); continue; }
    if (isSymbol(lines[i])) {
      // Walk UP over an attached doc-comment run; the unit starts at the top of that run.
      let j = i - 1;
      while (j >= 0 && isDocComment(lines[j]) && lines[j].trim() !== '') j--;
      bset.add(lineStart[j + 1]);
    }
  }
  for (const b of [...bset].sort((a, z) => a - z)) offsets.push(b);
  return offsets;
}

// chunk — STRUCTURE-AWARE chunker (ADR-0001 v1.3.0 D5). Split at structural boundaries first,
// coalesce adjacent small units up to ~512 tokens, and only fall back to the char-window
// splitter for a single structural unit that still exceeds the hard ceiling. Content is never
// dropped (every char of `text` lands in exactly one chunk's coverage; oversized units overlap).
function chunk(text) {
  if (text.length <= STRUCT_TARGET_CHARS) return [text];
  const bounds = structureBoundaries(text);
  if (bounds.length <= 1) return windowChunk(text); // no structure found → window fallback
  // Build raw segments between consecutive boundaries.
  const segs = [];
  for (let i = 0; i < bounds.length; i++) {
    const start = bounds[i];
    const end = i + 1 < bounds.length ? bounds[i + 1] : text.length;
    segs.push(text.slice(start, end));
  }
  // Coalesce adjacent segments up to the ≤512-token target; window-split any oversized one.
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf); buf = ''; };
  for (const s of segs) {
    if (s.length > CHUNK_CHARS) {            // a single huge unit → window-split it alone
      flush();
      for (const w of windowChunk(s)) out.push(w);
      continue;
    }
    if (buf.length + s.length > STRUCT_TARGET_CHARS && buf.length >= STRUCT_MIN_CHARS) flush();
    buf += s;
  }
  flush();
  return out.length ? out : [text];
}

// ---------- build context factory ----------
// Builds the `ctx` object the corpus rules consume. Honors scopeExclude + .gitmodules (force-walk:
// a repo with no .gitmodules walks its whole tree, which is the intended AHG case).
function makeContext(target) {
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) {
    const hint = process.env.KB_REPO_DIR
      ? `(KB_REPO_DIR override: ${process.env.KB_REPO_DIR} — check that the clone path exists)`
      : '(clone into .targets/ for direct use, or pass via tools/build-kb.mjs which sets KB_REPO_DIR)';
    throw new Error(`build-kb: repoDir not found for target "${target.slug}": ${repoDir} ${hint}`);
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
  const entries = [];                 // { path, kind, source_type, title, chunkIdx, chunkTotal, text }
  const sourceCounts = {};            // kind -> source-file count
  const ingestedPaths = new Set();    // absolute paths already ingested (md-sweep / literal de-dup)
  const fullBodyPaths = new Set();    // absolute paths ingested as full source bodies

  function addDoc(relPath, kind, title, text, absPath) {
    const source_type = classifySourceType(relPath, kind);
    const chunks = chunk(text);
    chunks.forEach((c, i) => entries.push({
      path: relPath, kind, source_type, title, chunkIdx: i, chunkTotal: chunks.length, text: c,
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

  // Resolve the embedder for this target (per-target override beats the MiniLM default).
  const emb = target.embed || {};
  const MODEL = emb.model || DEFAULT_MODEL;
  const DIM = emb.dim || DEFAULT_DIM;
  const POOLING = emb.pooling || 'mean';
  const QUERY_PREFIX = emb.queryPrefix || '';   // passages are embedded WITHOUT the prefix
  const RANK_SCALE = typeof emb.rankScale === 'number' ? emb.rankScale : 1.0;
  // Output naming: an overridden embedder writes the canonical un-suffixed <slug>-kb.rvf
  // (single 384-dim desktop variant, recipe v1.3.1). The MiniLM default keeps .small.rvf for
  // backward-compat with the already-shipped reference repo.
  const RVF_SUFFIX = emb.rvfSuffix || (target.embed ? '.rvf' : '.small.rvf');
  console.log(`[build-kb] target=${slug} metaName=${target.metaName} | model=${MODEL} dim=${DIM} pooling=${POOLING} out=${slug}-kb${RVF_SUFFIX}`);

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
  const OUT_RVF = `${base}${RVF_SUFFIX}`;
  const OUT_PASSAGES = `${base}.passages.jsonl`;
  const OUT_IDS = `${base}.ids.json`;
  const OUT_EMBEDCFG = `${OUT_RVF}.embed.json`;

  // ---- embedder (offline-first; remote download only if model not cached) ----
  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  console.log('[build-kb] @ruvector/rvf via:', rvfVia);
  const { T, modelCache, via: tVia } = await loadTransformers();
  const cache = chooseModelCache(MODEL);
  const { haveLocalModel } = configureModel(T, cache, MODEL);
  console.log(`[build-kb] transformers via ${tVia} | model ${haveLocalModel ? 'local' : 'remote'} (${cache})`);
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
    // PASSAGES are embedded WITHOUT the query prefix (bge asymmetric retrieval).
    const out = await fe(batch.map((e) => e.text), { pooling: POOLING, normalize: true });
    const dim = out.dims[1];
    if (dim !== DIM) throw new Error(`embed dim ${dim} != ${DIM}`);
    const ingest = batch.map((e, j) => {
      const id = String(i + j + 1);
      idsIndex[id] = {
        path: e.path, kind: e.kind, source_type: e.source_type, title: e.title,
        chunk: e.chunkIdx + 1, of: e.chunkTotal,
        preview: e.text.slice(0, 240).replace(/\s+/g, ' '),
      };
      fs.writeSync(passagesFd, JSON.stringify({ id, text: e.text, path: e.path, title: e.title, source_type: e.source_type, kind: e.kind }) + '\n');
      passageLines++;
      return {
        id,
        vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)),
        metadata: { path: e.path, kind: e.kind, source_type: e.source_type, title: e.title, chunk: e.chunkIdx },
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

  // Embedder sidecar (read by ask-kb + index-primer so the QUERY/primer use the SAME model).
  // Only written for an overridden embedder; the MiniLM default needs none (ask-kb's default).
  if (target.embed) {
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

main().catch((e) => { console.error('[build-kb] ERROR:', e); process.exit(1); });
