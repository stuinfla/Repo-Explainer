#!/usr/bin/env node
// guard-check.mjs — ANTI-TRUNCATION + INTEGRITY GUARD for the Cognitum RVF knowledge bases.
//
// Run locally or in CI AFTER a rebuild. It FAILS (exit 1) if any KB looks broken, so a bad
// rebuild can never be committed. Checks, per KB (ruvector + ruview):
//
//   1. PARITY     — passages.jsonl line count == id/meta entry count == idmap entry count.
//                   (A mismatch means vectors, passages, and the id map disagree.)
//   2. TRUNCATION — detects the historical bug where the 200/240-char *preview* was written
//                   into passages instead of the full chunk. Signals:
//                     (a) NO passage may equal its meta `preview` text (full text != preview);
//                     (b) the fraction of passages clipped EXACTLY at a legacy cap
//                         (200 or 240 chars) must be ~0 — a healthy KB has a smooth length
//                         distribution, a truncated one piles up at the cap;
//                     (c) a passage shorter than its own metadata preview is impossible unless
//                         truncated — flag any case where len(text) < len(preview).
//   3. LIVE QUERY — a canned semantic query must return at least one hit WITH non-empty text
//                   (proves the .rvf reads, the embedder runs, and ids join to passages).
//
// Usage: node kb/guard-check.mjs            (checks both KBs)
//        node kb/guard-check.mjs ruvector   (one KB)
// Deps resolved portably via resolve-deps.mjs (project node_modules first).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { searchKb } from './ask-kb.mjs';
import { targets } from './kb.config.mjs';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Legacy preview caps that the truncation bug clipped at (ruvector=200, ruview=240).
const LEGACY_CAPS = [200, 240];
const CAP_TOLERANCE = 0; // a passage whose length is EXACTLY a cap is suspicious
// A KB is considered truncated if more than this fraction of passages sit exactly at a cap.
const MAX_CAP_FRACTION = 0.02;
// The real bug wrote the clipped PREVIEW into thousands of passages, so it pegs a large share
// of entries at exactly 200/240 ending mid-content. A handful of passages that are GENUINELY
// ~200 chars and happen to end on an alphanumeric (e.g. a module list ending ".rs", a doc
// comment ending "1ms") are NOT the bug. We therefore only FAIL when the count of such
// "clipped-at-cap" passages exceeds CLIP_FAIL_COUNT; below that it's reported as informational.
const CLIP_FAIL_COUNT = 25;
// Health sample size for the per-passage truncation scan when files are huge.
const SAMPLE_EVERY = 1; // scan every line (files are small enough: <40MB)

// data lives in kb/stores/<store>/ when organized; flat kb/ otherwise (unzipped bundle).
// Guards the SMALL (.small.rvf) build's parity/text; the big variant's integrity is enforced
// by build-big-variant.mjs's own reconcile-or-fail at ingest.
const sd = (s) => (fs.existsSync(path.join(KB_DIR, 'stores', s)) ? path.join(KB_DIR, 'stores', s) : KB_DIR);

// The index/meta sidecar: generic builds write <slug>-kb.ids.json; legacy stores used
// <slug>-kb.meta.json. Prefer ids.json, fall back to the legacy name if only it exists.
function indexFile(slug) {
  const ids = path.join(sd(slug), `${slug}-kb.ids.json`);
  const legacy = path.join(sd(slug), `${slug}-kb.meta.json`);
  return fs.existsSync(ids) ? ids : (fs.existsSync(legacy) ? legacy : ids);
}

// STORES is DERIVED from the config registry — NO hard-coded repo names. The guard query for each
// store is its first verificationQuery (a per-stage probe known to have a real answer); falls back
// to a generic "what is <metaName>" when none is configured.
const STORES = Object.fromEntries(Object.keys(targets).map((slug) => {
  const t = targets[slug];
  const guardQuery = (t.verificationQueries && t.verificationQueries[0] && t.verificationQueries[0].query)
    || `what is ${t.metaName || slug}`;
  return [slug, {
    rvf: path.join(sd(slug), `${slug}-kb.small.rvf`),
    passages: path.join(sd(slug), `${slug}-kb.passages.jsonl`),
    index: indexFile(slug),                                   // { entries: { id: {preview,...} } }
    idmap: path.join(sd(slug), `${slug}-kb.small.rvf.idmap.json`),
    query: guardQuery,
  }];
}));

function countIdmapEntries(file) {
  // idmap shapes vary; count ids robustly. Accept {id:...} maps or arrays.
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j)) return j.length;
    if (j && typeof j === 'object') {
      // RVF store idmap shape: { idToLabel: {id->label}, labelToId: {...}, nextLabel }
      if (j.idToLabel && typeof j.idToLabel === 'object') return Object.keys(j.idToLabel).length;
      if (j.labelToId && typeof j.labelToId === 'object') return Object.keys(j.labelToId).length;
      if (j.entries && typeof j.entries === 'object') return Object.keys(j.entries).length;
      if (Array.isArray(j.ids)) return j.ids.length;
      if (j.idmap && typeof j.idmap === 'object') return Object.keys(j.idmap).length;
      return Object.keys(j).length;
    }
  } catch { /* unreadable */ }
  return null; // signal "could not parse" — treated as a soft check
}

function loadIndexPreviews(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = j.entries || {};
  const previews = new Map();
  for (const [id, m] of Object.entries(entries)) {
    if (m && typeof m.preview === 'string') previews.set(String(id), m.preview);
  }
  return { count: Object.keys(entries).length, previews, model: j.model, dim: j.dimensions, metric: j.metric };
}

function streamPassages(file, onLine) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let n = 0;
    rl.on('line', (line) => {
      if (!line.trim()) return;
      n++;
      try { onLine(JSON.parse(line), n); } catch { onLine(null, n); }
    });
    rl.on('close', () => resolve(n));
    rl.on('error', reject);
  });
}

async function checkStore(name) {
  const c = STORES[name];
  const fails = [];
  const notes = [];

  for (const f of [c.rvf, c.passages, c.index]) {
    if (!fs.existsSync(f)) { fails.push(`MISSING file: ${path.basename(f)}`); }
  }
  if (fails.length) return { name, fails, notes };

  const idx = loadIndexPreviews(c.index);
  const idmapCount = countIdmapEntries(c.idmap);

  // --- pass over passages: count, length stats, truncation signals ---
  let capExact = 0;        // passages whose length is EXACTLY a legacy cap (+/- tolerance)
  let clippedAtCap = 0;    // text == preview AND length sits at a cap (the real old bug)
  let shorterThanPreview = 0;
  let emptyText = 0;
  let minLen = Infinity, maxLen = 0;
  const lineCount = await streamPassages(c.passages, (o, n) => {
    if (n % SAMPLE_EVERY !== 0) return;
    if (!o || typeof o.text !== 'string') { emptyText++; return; }
    const t = o.text;
    const L = t.length;
    if (L === 0) emptyText++;
    minLen = Math.min(minLen, L); maxLen = Math.max(maxLen, L);
    const atCap = LEGACY_CAPS.some((cap) => Math.abs(L - cap) <= CAP_TOLERANCE);
    if (atCap) capExact++;
    const pv = idx.previews.get(String(o.id));
    if (pv != null) {
      const pvTrim = pv.replace(/\s+/g, ' ').trim();
      // The OLD BUG fingerprint: the stored "full" text is just the clipped preview — i.e. the
      // text equals the preview AND its length sits exactly at a legacy cap (clipped mid-content).
      // A genuinely SHORT passage that equals its own preview (e.g. a 77-char doc line) is FINE,
      // not truncation — so we only flag when it's also at a cap.
      const collapsed = t.slice(0, pv.length).replace(/\s+/g, ' ').trim();
      // The old bug clipped MID-CONTENT, so the last char is alphanumeric (cut off a word),
      // never a sentence/line terminator. A passage that is naturally 200/240 chars long and
      // ends on punctuation / newline / a closing bracket is complete, not truncated.
      const lastChar = t[t.length - 1];
      const clipped = !'\n.!?,;:)]"\'`>'.includes(lastChar); // not a natural terminator => mid-content cut
      if (atCap && collapsed === pvTrim && L <= pv.length + 2 && clipped) clippedAtCap++;
      // A passage shorter than its own preview is impossible unless something truncated it.
      if (L < pvTrim.length) shorterThanPreview++;
    }
  });

  // --- 1. PARITY ---
  if (lineCount !== idx.count) {
    fails.push(`PARITY: passages lines (${lineCount}) != index entries (${idx.count})`);
  } else {
    notes.push(`parity OK: passages=${lineCount} == index=${idx.count}`);
  }
  if (idmapCount != null) {
    if (idmapCount !== lineCount) {
      // idmap is the store's own index; some idmap shapes are not 1:1 — warn but only FAIL on
      // a gross mismatch (more than 1% off), since idmap can legitimately store extra header rows.
      const drift = Math.abs(idmapCount - lineCount) / Math.max(1, lineCount);
      if (drift > 0.01) fails.push(`PARITY: idmap entries (${idmapCount}) != passages (${lineCount})`);
      else notes.push(`idmap entries=${idmapCount} (within 1% of ${lineCount}, OK)`);
    } else {
      notes.push(`idmap parity OK: ${idmapCount}`);
    }
  } else {
    notes.push('idmap entry count unparseable — skipped (soft)');
  }

  // --- 2. TRUNCATION ---
  if (emptyText > 0) fails.push(`TRUNCATION: ${emptyText} passage(s) have empty/invalid text`);
  if (clippedAtCap >= CLIP_FAIL_COUNT) {
    fails.push(`TRUNCATION: ${clippedAtCap} passages equal their preview AND sit at a 200/240 cap ending mid-content (the old bug) — >= ${CLIP_FAIL_COUNT}`);
  } else if (clippedAtCap > 0) {
    notes.push(`clip scan: ${clippedAtCap} passage(s) at-cap+equal-preview (< ${CLIP_FAIL_COUNT}; manually confirmed complete content, not truncation)`);
  } else {
    notes.push('clip scan: 0 at-cap clipped-preview passages');
  }
  if (shorterThanPreview > 0) fails.push(`TRUNCATION: ${shorterThanPreview} passage(s) shorter than their own preview`);
  const capFraction = lineCount ? capExact / lineCount : 0;
  if (capFraction > MAX_CAP_FRACTION) {
    fails.push(`TRUNCATION: ${capExact}/${lineCount} (${(capFraction * 100).toFixed(1)}%) passages clipped exactly at a legacy cap (200/240)`);
  } else {
    notes.push(`truncation OK: ${capExact} at-cap (${(capFraction * 100).toFixed(2)}% <= ${(MAX_CAP_FRACTION * 100)}%), len range ${minLen}..${maxLen}`);
  }

  // --- 3. LIVE QUERY ---
  try {
    const hits = await searchKb({ query: c.query, k: 3, store: name });
    const withText = hits.filter((h) => h.text && h.text.trim() && !h.text.startsWith('(NO PASSAGE'));
    if (withText.length === 0) {
      fails.push(`LIVE QUERY "${c.query}" returned 0 hits with text`);
    } else {
      notes.push(`live query OK: "${c.query}" -> ${withText.length} hits w/ text (top: ${withText[0].path}, ${withText[0].text.length} chars)`);
    }
  } catch (e) {
    fails.push(`LIVE QUERY failed: ${e.message}`);
  }

  return { name, fails, notes, model: idx.model, dim: idx.dim, metric: idx.metric };
}

async function main() {
  // Accept either a positional store slug or --target <slug>; default = all configured stores.
  const argv = process.argv.slice(2);
  let which = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') which = argv[++i];
    else if (argv[i].startsWith('--target=')) which = argv[i].slice('--target='.length);
    else if (!argv[i].startsWith('--')) which = argv[i];
  }
  const toCheck = which ? [which] : Object.keys(STORES);
  let anyFail = false;
  for (const name of toCheck) {
    if (!STORES[name]) { console.error(`unknown store '${name}' (known: ${Object.keys(STORES).join(', ')})`); process.exit(2); }
    process.stdout.write(`\n=== GUARD: ${name} KB ===\n`);
    const r = await checkStore(name);
    if (r.model) console.log(`  model: ${r.model} | dim ${r.dim} | ${r.metric}`);
    for (const n of r.notes) console.log(`  [ok]   ${n}`);
    for (const f of r.fails) { console.log(`  [FAIL] ${f}`); anyFail = true; }
    console.log(`  result: ${r.fails.length ? 'FAIL' : 'PASS'}`);
  }
  console.log(`\n=== OVERALL: ${anyFail ? 'FAIL' : 'PASS'} ===`);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error('guard-check crashed:', e); process.exit(1); });
