#!/usr/bin/env node
// build-kb-768.mjs — SINGLE 768-dim, STRUCTURE-AWARE RVF builder (recipe ADR-0001 v1.3.0).
//
// Supersedes the dual-variant path (build-kb.mjs MiniLM-384 + build-big-variant.mjs bge-768)
// for brand-new desktop repos: ONE embed pass, ONE file. Per D2/F (v1.3.0):
//   - embedder = Xenova/bge-base-en-v1.5 (768-dim, CLS pooling, asymmetric query prefix)
//   - chunking = STRUCTURE-AWARE, not fixed windows (the bigger lever at this corpus size):
//       * markdown/prose  → split at heading boundaries (## / ###), each heading + its body
//       * Rust source     → split at item boundaries (fn / struct / enum / impl / trait / mod /
//                            pub …), keeping a leading doc-comment (//! /// /** */) ATTACHED to
//                            the symbol it documents
//       * any over-long block → soft-split at blank lines, ≤512 tokens (~2048 chars) per chunk
//
// Output (kb/stores/<slug>/):
//   <slug>-kb.big.rvf            768-dim HNSW store (ask-kb prefers .big.rvf automatically)
//   <slug>-kb.big.rvf.embed.json embedder config (model/pooling/queryPrefix) read by ask-kb
//   <slug>-kb.passages.jsonl     full untruncated chunk text (shared, un-tagged)
//   <slug>-kb.ids.json           per-id kind/preview index (guard + ask-kb read this)
//
// Usage: node kb/build-kb-768.mjs --target photonlayer

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, chooseModelCache, configureModel } from './resolve-deps.mjs';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { RULE_IMPLS } from './corpus-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/

const MODEL = 'Xenova/bge-base-en-v1.5';
const DIM = 768;
const POOLING = 'cls';
// bge is asymmetric: PASSAGES embedded with NO prefix (here); QUERIES get this instruction
// prefix at query time (ask-kb reads it from <rvf>.embed.json).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

// ~512 tokens ≈ 2048 chars (bge max seq 512). We split structurally first, then soft-cap.
const MAX_CHARS = 2048;
const SOFT_MIN = 200; // don't emit a heading with a near-empty body as its own chunk if mergeable

// ---------- arg parsing ----------
function parseArgs(argv) {
  const a = { target: defaultTarget };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') a.target = argv[++i];
    else if (argv[i].startsWith('--target=')) a.target = argv[i].slice('--target='.length);
  }
  return a;
}

// ============================ STRUCTURE-AWARE CHUNKING ============================

// Soft-split an over-long block at blank lines (then hard char windows as a last resort),
// keeping each piece ≤ MAX_CHARS. Used as the leaf splitter under both md + rust splitters.
function softSplit(text, max = MAX_CHARS) {
  if (text.length <= max) return [text];
  const out = [];
  const paras = text.split(/\n{2,}/);
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const p of paras) {
    if (p.length > max) {
      // a single paragraph bigger than max: hard-window it (rare: a giant table/code block)
      flush();
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
      continue;
    }
    if ((buf + '\n\n' + p).length > max) { flush(); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  flush();
  return out.length ? out : [text.slice(0, max)];
}

// Markdown: split at heading boundaries. Each heading keeps the title line + its body until the
// next same-or-higher-level heading. A short body merges forward so we don't shatter into stubs.
function chunkMarkdown(text) {
  const lines = text.split('\n');
  const sections = [];
  let cur = { head: '', body: [] };
  const headRe = /^(#{1,6})\s+/;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && headRe.test(line)) {
      if (cur.head || cur.body.length) sections.push(cur);
      cur = { head: line, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  if (cur.head || cur.body.length) sections.push(cur);

  // Merge tiny sections forward into the next so a bare "## X" + 1 line doesn't become a chunk.
  const merged = [];
  for (const s of sections) {
    const blob = (s.head ? s.head + '\n' : '') + s.body.join('\n');
    if (merged.length && blob.trim().length < SOFT_MIN && (merged[merged.length - 1].length + blob.length) <= MAX_CHARS) {
      merged[merged.length - 1] += '\n' + blob;
    } else {
      merged.push(blob);
    }
  }
  // Each section then soft-split if it overruns MAX_CHARS.
  const out = [];
  for (const m of merged) out.push(...softSplit(m));
  return out.filter((c) => c.trim().length);
}

// Rust: split at top-level item boundaries, keeping a leading doc-comment with its symbol.
// We track brace depth so an item's whole body stays in one chunk; doc-comments (//! /// /** */)
// and attributes (#[...]) immediately preceding an item are pulled in with it.
function chunkRust(text) {
  const lines = text.split('\n');
  const ITEM = /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?(fn|struct|enum|impl|trait|mod|const|static|type|macro_rules!)\b/;
  const DOC = /^\s*(\/\/[!/]|\/\*\*|\*|#\[)/; // doc comment, block-doc continuation, or attribute
  const chunks = [];
  let i = 0;
  // Leading module preamble (//! file docs + use/imports before the first item) → its own chunk.
  let preamble = [];
  while (i < lines.length && !ITEM.test(lines[i])) {
    // stop pulling preamble once we hit a doc/attr run that clearly leads an item
    if (DOC.test(lines[i]) && i + 1 < lines.length) {
      // look ahead: is the next non-doc line an item? if so this doc belongs to that item
      let j = i;
      while (j < lines.length && (DOC.test(lines[j]) || lines[j].trim() === '')) j++;
      if (j < lines.length && ITEM.test(lines[j])) break;
    }
    preamble.push(lines[i]);
    i++;
  }
  if (preamble.join('\n').trim()) chunks.push(preamble.join('\n').trim());

  while (i < lines.length) {
    // gather any leading doc-comment / attribute run for this item
    const start = i;
    let j = i;
    while (j < lines.length && (DOC.test(lines[j]) || lines[j].trim() === '') && !ITEM.test(lines[j])) j++;
    // now lines[j] should be the item (or EOF). Consume the item by brace matching.
    if (j >= lines.length) { // trailing doc/blank with no item
      const tail = lines.slice(start).join('\n');
      if (tail.trim()) chunks.push(tail.trim());
      break;
    }
    let depth = 0; let seenBrace = false; let k = j;
    for (; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '{') { depth++; seenBrace = true; }
        else if (ch === '}') depth--;
      }
      // item ends when braces balance after opening, or (no-brace item like `type X = …;`) at ';'
      if (seenBrace && depth <= 0) { k++; break; }
      if (!seenBrace && /;\s*$/.test(lines[k]) && ITEM.test(lines[j])) { k++; break; }
    }
    const block = lines.slice(start, Math.max(k, j + 1)).join('\n').trim();
    if (block) chunks.push(...softSplit(block));
    i = Math.max(k, j + 1);
  }
  return chunks.filter((c) => c.trim().length);
}

// Choose splitter by the doc's kind/path. Source bodies are prefixed "Source <rel> (full):\n";
// we keep that header line and chunk the code under it. Prose/docs → markdown splitter.
function structureChunk(entry) {
  const { kind, text, path: rel } = entry;
  const isRust = /\.rs$/i.test(rel) || kind === 'source';
  if (isRust) {
    // peel the "Source x (full):" / "Module x — doc comment:" header line if present
    const m = text.match(/^((?:Source|Module|Component|Template|Crate)\b[^\n]*\n)([\s\S]*)$/);
    const header = m ? m[1] : '';
    const body = m ? m[2] : text;
    const parts = chunkRust(body);
    return parts.map((p, idx) => (idx === 0 && header ? header + p : p));
  }
  // markdown / doc / adr / npm / crate-manifest → heading-aware
  return chunkMarkdown(text);
}

// ---------- build context (force-walk; honors scopeExclude + .gitmodules) ----------
function makeContext(target) {
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) throw new Error(`build-kb-768: repoDir not found: ${repoDir}`);
  const skip = new Set(target.scopeExclude || []);

  const submoduleDirs = (() => {
    const set = new Set();
    let gm = null;
    try { gm = fs.readFileSync(path.join(repoDir, '.gitmodules'), 'utf8'); } catch { /* none */ }
    if (gm) for (const m of gm.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) set.add(path.resolve(repoDir, m[1].trim()));
    return set;
  })();
  const inSubmodule = (p) => { for (const d of submoduleDirs) { if (p === d || p.startsWith(d + path.sep)) return true; } return false; };

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
      } else if (e.isFile()) yield p;
    }
  }

  const rel = (p) => path.relative(repoDir, p);
  const docs = [];                 // raw addDoc entries (un-chunked) { path, kind, title, text }
  const sourceCounts = {};
  const ingestedPaths = new Set();
  const fullBodyPaths = new Set();

  function addDoc(relPath, kind, title, text /*, absPath */) {
    const absPath = arguments[4];
    docs.push({ path: relPath, kind, title, text });
    sourceCounts[kind] = (sourceCounts[kind] || 0) + 1;
    if (absPath) ingestedPaths.add(absPath);
  }

  return {
    repoDir, walk, rel, addDoc,
    alreadyIngested: (p) => ingestedPaths.has(p),
    isFullBody: (p) => fullBodyPaths.has(p),
    markFullBody: (p) => { if (p) fullBodyPaths.add(p); },
    docs, sourceCounts,
  };
}

// ---------- main ----------
async function main() {
  const { target: slug } = parseArgs(process.argv.slice(2));
  const target = getTarget(slug);
  console.log(`[build-kb-768] target=${slug} metaName=${target.metaName} | model=${MODEL} dim=${DIM}`);

  const ctx = makeContext(target);
  console.log(`[build-kb-768] repoDir=${ctx.repoDir}`);

  for (const rule of target.include || []) {
    const impl = RULE_IMPLS[rule.rule];
    if (!impl) { console.error(`[build-kb-768] unknown include rule "${rule.rule}" — skipped`); continue; }
    const n = impl(ctx, rule);
    console.log(`[build-kb-768] rule ${rule.rule.padEnd(18)} -> ${n} source(s)`);
  }

  // STRUCTURE-AWARE chunk every collected doc.
  const entries = [];
  for (const d of ctx.docs) {
    const parts = structureChunk(d);
    parts.forEach((c, i) => entries.push({
      path: d.path, kind: d.kind, title: d.title, chunkIdx: i, chunkTotal: parts.length, text: c,
    }));
  }

  console.log('=== CORPUS (source files per kind) ===');
  console.log(JSON.stringify(ctx.sourceCounts, null, 2));
  const kindTotals = {};
  for (const e of entries) kindTotals[e.kind] = (kindTotals[e.kind] || 0) + 1;
  console.log('Chunks per kind:', JSON.stringify(kindTotals));
  console.log('Total chunks to embed:', entries.length);
  console.log('Distinct source paths:', new Set(entries.map((e) => e.path)).size);
  const lens = entries.map((e) => e.text.length);
  console.log(`Chunk chars: min=${Math.min(...lens)} max=${Math.max(...lens)} mean=${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)} (cap ${MAX_CHARS})`);
  if (!entries.length) { console.error('[build-kb-768] corpus is EMPTY'); process.exit(1); }

  const storeDir = path.join(__dirname, 'stores', slug);
  fs.mkdirSync(storeDir, { recursive: true });
  const base = path.join(storeDir, `${slug}-kb`);
  const OUT_RVF = `${base}.big.rvf`;
  const OUT_EMBEDCFG = `${OUT_RVF}.embed.json`;
  const OUT_PASSAGES = `${base}.passages.jsonl`;
  const OUT_IDS = `${base}.ids.json`;

  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  console.log('[build-kb-768] @ruvector/rvf via:', rvfVia);
  const modelCache = chooseModelCache(MODEL);
  const { T, via: tVia } = await loadTransformers();
  const { haveLocalModel } = configureModel(T, modelCache, MODEL);
  console.log(`[build-kb-768] transformers via ${tVia} | model ${haveLocalModel ? 'local' : 'remote'} (${modelCache})`);
  const fe = await T.pipeline('feature-extraction', MODEL, { quantized: true });

  fs.rmSync(OUT_RVF, { force: true });
  fs.rmSync(OUT_RVF + '.idmap.json', { force: true });
  const db = await RvfDatabase.create(OUT_RVF, { dimensions: DIM, metric: 'cosine' });

  const idsIndex = {};
  fs.rmSync(OUT_PASSAGES, { force: true });
  const passagesFd = fs.openSync(OUT_PASSAGES, 'w');
  let passageLines = 0;
  const BATCH = 16;
  let ingested = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    // PASSAGES: no prefix (bge asymmetric). pooling = CLS.
    const out = await fe(batch.map((e) => e.text), { pooling: POOLING, normalize: true });
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
    process.stdout.write(`\r${i + batch.length}/${entries.length}`);
  }
  fs.closeSync(passagesFd);
  console.log(`\n[build-kb-768] ingested ${ingested} vectors | passages lines ${passageLines}`);

  const status = await db.status();
  await db.close(); // ONLY persist path

  fs.writeFileSync(OUT_IDS, JSON.stringify({ model: MODEL, dimensions: DIM, metric: 'cosine', entries: idsIndex }, null, 0));
  fs.writeFileSync(OUT_EMBEDCFG, JSON.stringify({ model: MODEL, pooling: POOLING, normalize: true, queryPrefix: QUERY_PREFIX, rankScale: 0.6 }, null, 2));

  const idCount = Object.keys(idsIndex).length;
  const ok = status.totalVectors === entries.length && passageLines === entries.length && idCount === entries.length;
  console.log('=== POST-INGEST ===');
  console.log('RVF status:', JSON.stringify(status));
  console.log(`Reconcile: chunks=${entries.length} vectors=${status.totalVectors} passages=${passageLines} ids=${idCount} match=${ok}`);
  if (!ok) { console.error('[build-kb-768] RECONCILE FAILED'); process.exit(1); }
  console.log(`[build-kb-768] OK -> ${path.relative(__dirname, OUT_RVF)} (+embed.json,passages,ids) | size ${fs.statSync(OUT_RVF).size} bytes`);
}

main().catch((e) => { console.error('[build-kb-768] ERROR:', e); process.exit(1); });
