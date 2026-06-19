#!/usr/bin/env node
// index-primer.mjs — TOP-DOWN ORIENTATION LAYER.
//
// Indexes a synthesized "primer" markdown INTO an existing Cognitum RVF knowledge base so the
// six top-down comprehension-journey questions (what is it / concepts / how each works /
// maturity / where are the docs / how to use end-to-end) return a whole synthesized section
// instead of a raw repo fragment. This is an INCREMENTAL append: it opens the existing .rvf
// read-write and ingests NEW ids that do not collide with existing ones, then appends matching
// records to the passages sidecar AND the id/meta index so PARITY holds for guard-check.
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

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KB_DIR, '..');

const CHUNK_CHARS = 4000;     // match the corpus chunker; sections under this stay whole
const OVERLAP_CHARS = 400;    // same sliding-window overlap the corpus uses (stitch() de-overlaps)

// data lives in kb/stores/<store>/ when organized; flat kb/ otherwise. Indexes the primer
// sections into the SMALL (.small.rvf) build (the Seed default + the source of the bundles).
const sd = (s) => (fs.existsSync(path.join(KB_DIR, 'stores', s)) ? path.join(KB_DIR, 'stores', s) : KB_DIR);

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

function maxPassageId(file) {
  let m = 0;
  const data = fs.readFileSync(file, 'utf8');
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    try { const id = Number(JSON.parse(line).id); if (id > m) m = id; } catch { /* skip */ }
  }
  return m;
}

async function main() {
  const store = process.argv[2];
  const conf = STORES[store];
  if (!conf) { console.error(`Usage: node kb/index-primer.mjs <${Object.keys(STORES).join('|')}>`); process.exit(2); }
  for (const f of [conf.primer, conf.rvf, conf.passages, conf.index]) {
    if (!fs.existsSync(f)) { console.error(`MISSING: ${f}`); process.exit(1); }
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

  const idx = JSON.parse(fs.readFileSync(conf.index, 'utf8'));
  const beforeEntries = Object.keys(idx.entries).length;
  const beforePassages = maxPassageId(conf.passages); // == line count (verified contiguous)

  // NEW ids start at max-existing-id + 1 (no collision with the corpus ids).
  const startId = Math.max(beforeEntries, beforePassages);
  console.log(`[index-primer:${store}] sections=${sections.length} new-chunks=${entries.length} `
    + `start-id=${startId + 1} (before: index=${beforeEntries}, passages.maxId=${beforePassages})`);

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

  // ---- append: ingest into .rvf (read-write), passages.jsonl, and the index ----
  const db = await RvfDatabase.open(conf.rvf);
  const passagesFd = fs.openSync(conf.passages, 'a');   // APPEND
  let ingested = 0, appendedPassages = 0;
  const BATCH = 32;
  try {
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const out = await fe(batch.map((e) => e.text), { pooling: EMBED_POOLING, normalize: true });
      const dim = out.dims[1];
      const ingest = batch.map((e, j) => {
        const id = String(startId + i + j + 1);
        // passages sidecar line (full text)
        fs.writeSync(passagesFd, JSON.stringify({ id, text: e.text, path: e.path, title: e.title }) + '\n');
        appendedPassages++;
        // index entry — match each KB's existing chunk-field convention
        const chunkField = conf.chunkStyle === 'slash'
          ? { chunk: `${e.chunkIdx + 1}/${e.chunkTotal}` }
          : { chunk: e.chunkIdx + 1, of: e.chunkTotal };
        idx.entries[id] = {
          path: e.path, kind: 'primer-orientation', title: e.title, ...chunkField,
          preview: e.text.slice(0, 240).replace(/\s+/g, ' '),
        };
        return {
          id,
          vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)),
          metadata: { path: e.path, kind: 'primer-orientation', title: e.title, chunk: e.chunkIdx },
        };
      });
      const r = await db.ingestBatch(ingest);
      ingested += r.accepted;
      if (r.rejected) console.error('REJECTED', r.rejected, 'in batch at', i);
    }
    const status = await db.status();
    console.log(`[index-primer:${store}] ingested=${ingested} | rvf totalVectors=${status.totalVectors}`);
  } finally {
    fs.closeSync(passagesFd);
    await db.close();
  }

  // write the index back (preserve top-level model/dim/metric fields)
  fs.writeFileSync(conf.index, JSON.stringify(idx, null, conf.chunkStyle === 'slash' ? 1 : 0));

  const afterEntries = Object.keys(idx.entries).length;
  console.log(`[index-primer:${store}] index entries: ${beforeEntries} -> ${afterEntries} `
    + `(+${afterEntries - beforeEntries}) | passages appended=${appendedPassages} | orientation sections=${sections.length}`);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
