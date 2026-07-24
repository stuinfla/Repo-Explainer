#!/usr/bin/env node
// index-primer.mjs — TOP-DOWN ORIENTATION LAYER.
//
// Indexes a synthesized "primer" markdown INTO an existing Cognitum RVF knowledge base so the
// six top-down comprehension-journey questions (what is it / concepts / how each works /
// maturity / where are the docs / how to use end-to-end) return a whole synthesized section
// instead of a raw repo fragment. This is an idempotent REPLACE (ADR-0010 D6): any existing
// PRIMER# generation is deleted from the store and filtered from the sidecars before the fresh
// one is ingested, so re-running never duplicates the orientation layer. Mutation is staged on
// a clone of the .rvf (+ .idmap.json) and published atomically with the sidecars, under the
// StoreSet lock shared with build-kb.mjs --delta. Ids are allocated from the persisted
// high-water mark (ids.json maxIdEver) so they never collide or reuse. PARITY holds throughout.
//
// Usage:
//   node kb/index-primer.mjs ruvector   # indexes ../ruvector-primer.md into ruvector-kb
//   node kb/index-primer.mjs ruview     # indexes ../ruview-primer.md  into ruview-kb
//
// Section splitting: split the primer into logical documents on level-2 markdown headers
// (## ...), fence-aware (a '#' inside a ``` code block is NOT a header). Each ## section
// (with its nested ### subsections) is ONE logical document under a synthetic path
// `PRIMER#<slug>`. A short level-1 title/preamble at the top is folded into the first section
// so nothing is lost. Sections > CHUNK_CHARS are chunked, but all chunks keep the SAME
// synthetic path so whole-doc retrieval reassembles them.
//
// Deps resolved PORTABLY via resolve-deps.mjs (project node_modules -> env -> Mac paths).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';
import { targets } from './kb.config.mjs';
import { SYNTHETIC_PATH_RE, acquireLock, readPassages, cloneFile, publish } from './store-set.mjs';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KB_DIR, '..');

const CHUNK_CHARS = 4000;     // match the corpus chunker; sections under this stay whole
const OVERLAP_CHARS = 400;    // same sliding-window overlap the corpus uses (stitch() de-overlaps)

// data lives in kb/stores/<store>/ when organized; flat kb/ otherwise. Indexes the primer
// sections into the SMALL (.small.rvf) build (the Seed default + the source of the bundles).
// KB_STORE_DIR overrides (same convention as build-kb.mjs — lets tests/staging avoid real stores).
const sd = (s) => {
  if (process.env.KB_STORE_DIR) return path.resolve(process.env.KB_STORE_DIR);
  return fs.existsSync(path.join(KB_DIR, 'stores', s)) ? path.join(KB_DIR, 'stores', s) : KB_DIR;
};

// The index/meta sidecar + its chunk-field convention. Generic builds write <slug>-kb.ids.json
// with { chunk, of } ('split' style); legacy ruview used <slug>-kb.meta.json with "1/3" ('slash').
function resolveIndex(slug) {
  const ids = path.join(sd(slug), `${slug}-kb.ids.json`);
  const legacy = path.join(sd(slug), `${slug}-kb.meta.json`);
  if (fs.existsSync(ids)) return { index: ids, chunkStyle: 'split' };
  if (fs.existsSync(legacy)) return { index: legacy, chunkStyle: 'slash' };
  return { index: ids, chunkStyle: 'split' };   // default for a not-yet-built store
}

// Primer path: kb/stores/<slug>/<slug>-primer.md (per plan §2a). Fall back to the legacy flat
// ROOT/<slug>-primer.md if a store-local primer is not present.
function primerPath(slug) {
  const local = path.join(sd(slug), `${slug}-primer.md`);
  const legacy = path.join(ROOT, `${slug}-primer.md`);
  return fs.existsSync(local) ? local : legacy;
}

// Resolve the ship variant: a single-768 build (recipe v1.3.0) writes only <slug>-kb.big.rvf;
// the legacy dual-variant build writes <slug>-kb.small.rvf. Prefer .big.rvf when present so the
// primer is embedded with — and ingested into — the SAME store/model the corpus used.
function resolveRvf(slug) {
  const big = path.join(sd(slug), `${slug}-kb.big.rvf`);
  const plain = path.join(sd(slug), `${slug}-kb.rvf`); // single-384 build (recipe v1.3.1)
  const small = path.join(sd(slug), `${slug}-kb.small.rvf`);
  if (fs.existsSync(big)) return big;
  if (fs.existsSync(plain)) return plain;
  return small;
}

// STORES is DERIVED from the config registry — NO hard-coded repo names.
const STORES = Object.fromEntries(Object.keys(targets).map((slug) => {
  const ri = resolveIndex(slug);
  return [slug, {
    primer: primerPath(slug),
    rvf: resolveRvf(slug),
    passages: path.join(sd(slug), `${slug}-kb.passages.jsonl`),
    index: ri.index,
    chunkStyle: ri.chunkStyle,
  }];
}));

function slugify(s) {
  return s.toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

// Split markdown into level-2 (##) sections, fence-aware. A level-1 (#) title or any preamble
// before the first ## is folded into the first section so no text is lost. Returns
// [{ title, body }] where body INCLUDES the heading line.
function splitSections(md) {
  const lines = md.split('\n');
  let inFence = false;
  const sections = [];
  let cur = null;        // current ## section
  let preamble = '';     // text before the first ## (title + intro)

  for (const line of lines) {
    // Track fenced code blocks so '#' comments inside them are never treated as headers.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/); // exactly level-2 (## but not ###)
    const isH2 = h2 && !/^###/.test(line);

    if (isH2) {
      if (cur) sections.push(cur);
      cur = { title: h2[1].trim(), body: line + '\n' };
    } else if (cur) {
      cur.body += line + '\n';
    } else {
      preamble += line + '\n';
    }
  }
  if (cur) sections.push(cur);

  // Fold the preamble (the # title + "About this document") into the first section's text so
  // it is searchable but does not create an empty/orphan document.
  if (sections.length && preamble.trim()) {
    sections[0] = { title: sections[0].title, body: preamble.trimEnd() + '\n\n' + sections[0].body };
  } else if (!sections.length && preamble.trim()) {
    sections.push({ title: 'primer', body: preamble });
  }
  return sections;
}

// Chunk a long section, mirroring the corpus chunker (paragraph-preferred, overlapping window).
function chunkText(text) {
  if (text.length <= CHUNK_CHARS) return [text];
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > i + CHUNK_CHARS / 2) end = para;
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
  }
  return out;
}

async function main() {
  const store = process.argv[2];
  const conf = STORES[store];
  if (!conf) { console.error(`Usage: node kb/index-primer.mjs <${Object.keys(STORES).join('|')}>`); process.exit(2); }
  for (const f of [conf.primer, conf.rvf, conf.passages, conf.index]) {
    if (!fs.existsSync(f)) { console.error(`MISSING: ${f}`); process.exit(1); }
  }
  if (!fs.existsSync(`${conf.rvf}.idmap.json`)) {
    console.error(`MISSING: ${conf.rvf}.idmap.json (needed to replace an existing primer generation) — rebuild the KB fully, then re-run`);
    process.exit(1);
  }

  // ---- build the orientation documents ----
  const md = fs.readFileSync(conf.primer, 'utf8');
  const sections = splitSections(md);

  // entries: { synthPath, title, chunkIdx, chunkTotal, text }
  const entries = [];
  for (const s of sections) {
    const synthPath = `PRIMER#${slugify(s.title)}`;
    const chunks = chunkText(s.body);
    chunks.forEach((c, i) => entries.push({
      path: synthPath, title: s.title, chunkIdx: i, chunkTotal: chunks.length, text: c,
    }));
  }

  const releaseLock = acquireLock(path.join(sd(store), `${store}-kb`));
  try { await replacePrimer(store, conf, sections, entries); }
  finally { releaseLock(); }
}

async function replacePrimer(store, conf, sections, entries) {
  const idx = JSON.parse(fs.readFileSync(conf.index, 'utf8'));
  const prevPassages = await readPassages(conf.passages);

  // ---- idempotent REPLACE: drop any existing PRIMER# generation first (ADR-0010 D6) ----
  const oldPrimer = prevPassages.filter((r) => SYNTHETIC_PATH_RE.test(r.path));
  const keepLines = prevPassages.filter((r) => !SYNTHETIC_PATH_RE.test(r.path)).map((r) => r.raw);
  for (const r of oldPrimer) delete idx.entries[r.id];

  // NEW ids from the persisted high-water mark — never reused, never colliding (INV-KB7).
  let maxIdEver = Number(idx.maxIdEver || 0);
  for (const r of prevPassages) { const n = Number(r.id); if (n > maxIdEver) maxIdEver = n; }
  const startId = maxIdEver;
  console.log(`[index-primer:${store}] sections=${sections.length} new-chunks=${entries.length} `
    + `replacing=${oldPrimer.length} old primer chunks | start-id=${startId + 1}`);

  // ---- embed (same model/pooling/normalize as the corpus build) ----
  // Read the embedder config the build wrote next to the .rvf (<rvf>.embed.json). For a single-768
  // bge store that is { model: bge, pooling: cls } so the primer is embedded with the SAME model
  // (else 384-dim vectors would be rejected by a 768-dim store). PASSAGES get NO query prefix.
  const embedCfg = (() => {
    const p = `${conf.rvf}.embed.json`;
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* fall through */ } }
    return { model: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean', normalize: true };
  })();
  const EMBED_MODEL = embedCfg.model || 'Xenova/all-MiniLM-L6-v2';
  const EMBED_POOLING = embedCfg.pooling || 'mean';
  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  const { T, via: tVia } = await loadTransformers();
  const modelCache = chooseModelCache(EMBED_MODEL);
  const { haveLocalModel } = configureModel(T, modelCache, EMBED_MODEL);
  console.log(`[index-primer:${store}] rvf via ${rvfVia} | transformers via ${tVia} | model ${EMBED_MODEL} `
    + `${haveLocalModel ? 'local' : 'remote'} (${modelCache}) | pooling ${EMBED_POOLING}`);
  const fe = await T.pipeline('feature-extraction', EMBED_MODEL, { quantized: true });

  // ---- staged replace: clone the .rvf (+ idmap), delete old primer ids, ingest fresh ----
  const S = `${conf.rvf}.staged`;
  cloneFile(conf.rvf, S);
  cloneFile(`${conf.rvf}.idmap.json`, `${S}.idmap.json`);
  const cleanupStaged = () => { for (const f of [S, `${S}.idmap.json`]) fs.rmSync(f, { force: true }); };

  const newLines = [];
  let ingested = 0;
  const BATCH = 32;
  try {
    const db = await RvfDatabase.open(S);
    if (oldPrimer.length) {
      const d = await db.delete(oldPrimer.map((r) => r.id));
      if (d.deleted !== oldPrimer.length) {
        await db.close();
        throw new Error(`old-primer delete mismatch: planned ${oldPrimer.length}, store deleted ${d.deleted} — rebuild fully`);
      }
    }
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const out = await fe(batch.map((e) => e.text), { pooling: EMBED_POOLING, normalize: true });
      const dim = out.dims[1];
      const ingest = batch.map((e, j) => {
        const id = String(startId + i + j + 1);
        newLines.push(JSON.stringify({ id, text: e.text, path: e.path, title: e.title }));
        // index entry — match each KB's existing chunk-field convention
        const chunkField = conf.chunkStyle === 'slash'
          ? { chunk: `${e.chunkIdx + 1}/${e.chunkTotal}` }
          : { chunk: e.chunkIdx + 1, of: e.chunkTotal };
        idx.entries[id] = {
          path: e.path, kind: 'primer-orientation', title: e.title, ...chunkField,
          preview: e.text.slice(0, 240).replace(/\s+/g, ' '),
        };
        // NO metadata field: @ruvector/rvf 0.3.0 rejects it (issue #704); the sidecars carry it.
        return { id, vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)) };
      });
      const r = await db.ingestBatch(ingest);
      ingested += r.accepted;
      if (r.rejected) { await db.close(); throw new Error(`REJECTED ${r.rejected} in batch at ${i}`); }
    }
    if (oldPrimer.length) await db.compact();
    const status = await db.status();
    const expect = keepLines.length + entries.length;
    if (status.totalVectors !== expect) {
      await db.close();
      throw new Error(`staged totalVectors=${status.totalVectors} != expected ${expect}`);
    }
    await db.close();   // writes the staged .idmap.json

    idx.maxIdEver = startId + entries.length;
    const stagedPassages = `${conf.passages}.staged`;
    fs.writeFileSync(stagedPassages, keepLines.concat(newLines).join('\n') + '\n');
    const stagedIndex = `${conf.index}.staged`;
    fs.writeFileSync(stagedIndex, JSON.stringify(idx, null, conf.chunkStyle === 'slash' ? 1 : 0));
    publish([
      { staged: S, live: conf.rvf },
      { staged: `${S}.idmap.json`, live: `${conf.rvf}.idmap.json` },
      { staged: stagedPassages, live: conf.passages },
      { staged: stagedIndex, live: conf.index },
    ]);
  } catch (e) {
    cleanupStaged();
    console.error(`[index-primer:${store}] FAILED (live store untouched):`, e.message);
    process.exit(1);
  }

  console.log(`[index-primer:${store}] OK — replaced ${oldPrimer.length} old primer chunks with ${ingested} fresh `
    + `| orientation sections=${sections.length} | totalVectors=${keepLines.length + entries.length}`);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
