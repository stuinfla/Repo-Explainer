#!/usr/bin/env node
// index-primer.mjs — TOP-DOWN ORIENTATION LAYER.
//
// Indexes a synthesized "primer" markdown INTO an existing RVF knowledge base so the six
// top-down comprehension-journey questions (what is it / concepts / how each works / maturity /
// where are the docs / how to use end-to-end) return a whole synthesized section instead of a raw
// repo fragment. This is an idempotent REPLACE (ADR-0010 D6): any existing PRIMER# generation is
// deleted from the store and filtered from the sidecars before the fresh one is ingested, so
// re-running never duplicates the orientation layer. Mutation is staged on a clone of the .rvf
// (+ .idmap.json) and published atomically with the sidecars, under the StoreSet lock shared with
// build-kb.mjs --delta. Ids are allocated from the persisted high-water mark (ids.json maxIdEver)
// so they never collide or reuse. PARITY holds throughout.
//
// Usage:   node kb/index-primer.mjs <slug>    # indexes <store>/<slug>-primer.md into <slug>-kb
// Library: import { indexPrimer } from './index-primer.mjs'; await indexPrimer(slug)  (throws on failure)
//
// Section splitting: the primer is split on level-2 markdown headers (## ...), fence-aware (a '#'
// inside a ``` code block is NOT a header). Each ## section (with its nested ### subsections) is
// ONE logical document under a synthetic path `PRIMER#<slug>`. A short level-1 title/preamble at
// the top is folded into the first section so nothing is lost. Sections > CHUNK_CHARS are chunked,
// but all chunks keep the SAME synthetic path so whole-doc retrieval reassembles them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel, chooseModelCache } from './resolve-deps.mjs';
import { SYNTHETIC_PATH_RE, acquireLock, readPassages, cloneFile, publish, storeDirFor } from './store-set.mjs';
import { windowChunk } from './chunker.mjs';

const __filename = fileURLToPath(import.meta.url);

// Files of one store: kb/stores/<slug>/ (KB_STORE_DIR overrides, same convention as build-kb.mjs).
function storeFiles(slug) {
  const dir = storeDirFor(slug);
  const base = path.join(dir, `${slug}-kb`);
  return {
    dir, base,
    primer: path.join(dir, `${slug}-primer.md`),
    rvf: `${base}.rvf`,
    passages: `${base}.passages.jsonl`,
    index: `${base}.ids.json`,
  };
}

export function slugify(s) {
  return s.toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

// Split markdown into level-2 (##) sections, fence-aware. A level-1 (#) title or any preamble
// before the first ## is folded into the first section so no text is lost. Returns
// [{ title, body }] where body INCLUDES the heading line.
export function splitSections(md) {
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

// Index <slug>'s primer into its KB. Throws on any failure (the live store is left untouched).
// Returns { sections, replaced, ingested, totalVectors }.
export async function indexPrimer(slug, { log = console.log } = {}) {
  if (!slug) throw new Error('indexPrimer: slug is required');
  const conf = storeFiles(slug);
  for (const f of [conf.primer, conf.rvf, conf.passages, conf.index]) {
    if (!fs.existsSync(f)) throw new Error(`MISSING: ${f}`);
  }
  if (!fs.existsSync(`${conf.rvf}.idmap.json`)) {
    throw new Error(`MISSING: ${conf.rvf}.idmap.json (needed to replace an existing primer generation) — rebuild the KB fully, then re-run`);
  }

  // ---- build the orientation documents ----
  const sections = splitSections(fs.readFileSync(conf.primer, 'utf8'));

  // entries: { path, title, chunkIdx, chunkTotal, text }
  const entries = [];
  for (const s of sections) {
    const synthPath = `PRIMER#${slugify(s.title)}`;
    const chunks = windowChunk(s.body);
    chunks.forEach((c, i) => entries.push({
      path: synthPath, title: s.title, chunkIdx: i, chunkTotal: chunks.length, text: c,
    }));
  }

  const releaseLock = acquireLock(conf.base);
  try { return await replacePrimer(slug, conf, sections, entries, log); }
  finally { releaseLock(); }
}

// Which rows of the previous generation go, which are kept, and where new ids start (never reused: INV-KB7).
// Mutates idx.entries (drops the old primer ids) so re-running can never duplicate the orientation layer.
export function planPrimerReplace(prevPassages, idx) {
  const oldPrimer = prevPassages.filter((r) => SYNTHETIC_PATH_RE.test(r.path));
  const keepLines = prevPassages.filter((r) => !SYNTHETIC_PATH_RE.test(r.path)).map((r) => r.raw);
  for (const r of oldPrimer) delete idx.entries[r.id];
  let maxIdEver = Number(idx.maxIdEver || 0);
  for (const r of prevPassages) { const n = Number(r.id); if (n > maxIdEver) maxIdEver = n; }
  return { oldPrimer, keepLines, startId: maxIdEver };
}

// The embedder the store was BUILT with: <rvf>.embed.json, cross-checked against ids.json.model. Primer vectors from
// any other model would be accepted by the store (same dimension) and silently rank wrong, so this throws.
export function readEmbedConfig(embedPath, idx) {
  if (!fs.existsSync(embedPath)) throw new Error(`MISSING: ${embedPath} (the embedder the store was built with) — rebuild the KB fully, then re-run`);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(embedPath, 'utf8')); } catch (e) { throw new Error(`UNREADABLE: ${embedPath}: ${e.message}`); }
  if (!cfg.model) throw new Error(`INVALID: ${embedPath} has no model`);
  if (idx && idx.model && idx.model !== cfg.model) {
    throw new Error(`embedder mismatch: ids.json says the store was built with ${idx.model} but ${path.basename(embedPath)} says ${cfg.model} — rebuild the KB fully`);
  }
  return cfg;
}

async function replacePrimer(store, conf, sections, entries, log) {
  const idx = JSON.parse(fs.readFileSync(conf.index, 'utf8'));
  const prevPassages = await readPassages(conf.passages);

  // ---- idempotent REPLACE: drop any existing PRIMER# generation first (ADR-0010 D6) ----
  const { oldPrimer, keepLines, startId } = planPrimerReplace(prevPassages, idx);
  log(`[index-primer:${store}] sections=${sections.length} new-chunks=${entries.length} `
    + `replacing=${oldPrimer.length} old primer chunks | start-id=${startId + 1}`);

  // ---- embed (same model/pooling/normalize as the corpus build) ----
  // PASSAGES get NO query prefix. The embedder identity comes from the sidecar the build wrote, never a guess.
  const embedCfg = readEmbedConfig(`${conf.rvf}.embed.json`, idx);
  const EMBED_MODEL = embedCfg.model;
  const EMBED_POOLING = embedCfg.pooling || 'mean';
  const { mod: rvfMod, via: rvfVia } = loadRvf();
  const { RvfDatabase } = rvfMod;
  const { T, via: tVia } = await loadTransformers();
  const modelCache = chooseModelCache();
  const { haveLocalModel } = configureModel(T, modelCache, EMBED_MODEL);
  log(`[index-primer:${store}] rvf via ${rvfVia} | transformers via ${tVia} | model ${EMBED_MODEL} `
    + `${haveLocalModel ? 'local' : 'remote'} (${modelCache}) | pooling ${EMBED_POOLING}`);
  const fe = await T.pipeline('feature-extraction', EMBED_MODEL, { quantized: true });

  // ---- staged replace: clone the .rvf (+ idmap), delete old primer ids, ingest fresh ----
  const S = `${conf.rvf}.staged`;
  cloneFile(conf.rvf, S);
  cloneFile(`${conf.rvf}.idmap.json`, `${S}.idmap.json`);
  const stagedPassages = `${conf.passages}.staged`;
  const stagedIndex = `${conf.index}.staged`;
  const cleanupStaged = () => { for (const f of [S, `${S}.idmap.json`, stagedPassages, stagedIndex]) fs.rmSync(f, { force: true }); };

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
        idx.entries[id] = {
          path: e.path, kind: 'primer-orientation', title: e.title, chunk: e.chunkIdx + 1, of: e.chunkTotal,
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
    fs.writeFileSync(stagedPassages, keepLines.concat(newLines).join('\n') + '\n');
    fs.writeFileSync(stagedIndex, JSON.stringify(idx, null, 0));
    publish([
      { staged: S, live: conf.rvf },
      { staged: `${S}.idmap.json`, live: `${conf.rvf}.idmap.json` },
      { staged: stagedPassages, live: conf.passages },
      { staged: stagedIndex, live: conf.index },
    ]);
  } catch (e) {
    cleanupStaged();
    throw new Error(`index-primer ${store} FAILED (live store untouched): ${e.message}`);
  }

  const totalVectors = keepLines.length + entries.length;
  log(`[index-primer:${store}] OK — replaced ${oldPrimer.length} old primer chunks with ${ingested} fresh `
    + `| orientation sections=${sections.length} | totalVectors=${totalVectors}`);
  return { sections: sections.length, replaced: oldPrimer.length, ingested, totalVectors };
}

// Run as CLI only when invoked directly, so importing this module never exits the process.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: node kb/index-primer.mjs <slug>'); process.exit(2); }
  indexPrimer(slug).catch((e) => { console.error(e.message); process.exit(1); });
}
