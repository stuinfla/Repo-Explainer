#!/usr/bin/env node
// Build the RuView RVF knowledge base — v2 (enriched).
// v1 corpus (docs, ADRs, crate manifests, firmware headers, scripts, ui meta) PLUS:
//   crate-src : every crate's lib.rs/main.rs first ~100 lines + module lists +
//               every .rs file's leading //! doc block (repo-wide sweep)
//   doc-deep  : EVERY *.md in the repo not already in the corpus (full text)
//   ui        : full text content of ui/*.html
//   scripts upgraded to first 40 lines of every file under scripts/ (recursive)
//   plugin manifests (.claude-plugin/marketplace.json, plugins/ruview/.claude-plugin/plugin.json)
// Vectors: @ruvector/rvf (RvfDatabase, HNSW, cosine). Embeddings: local
// @xenova/transformers Xenova/all-MiniLM-L6-v2 (384-dim, quantized ONNX). No cloud APIs.
//
// Usage: node kb/build-ruview-kb.mjs
// Output: kb/ruview-kb.rvf + kb/ruview-kb.meta.json (old files backed up as *.v1.*)
// Deps resolved PORTABLY via kb/resolve-deps.mjs (project node_modules -> env -> Mac paths).
//   KB_REPO_ROOT overrides the repo root (defaults to the parent of kb/).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel } from './resolve-deps.mjs';

const { mod: rvfMod, via: rvfVia } = loadRvf();
const { RvfDatabase } = rvfMod;
console.log('[build-ruview] @ruvector/rvf via:', rvfVia);

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/
// repo root = parent of kb/, overridable for CI.
const ROOT = process.env.KB_REPO_ROOT || path.resolve(__dirname, '..');
const RUVIEW = path.join(ROOT, 'RuView');
// SMALL (384-dim) build lands in kb/stores/ruview/ as .small.rvf (matches the two-variant layout).
const STORE_DIR = path.join(ROOT, 'kb/stores/ruview');
fs.mkdirSync(STORE_DIR, { recursive: true });
const OUT_RVF = path.join(STORE_DIR, 'ruview-kb.small.rvf');
const OUT_META = path.join(STORE_DIR, 'ruview-kb.meta.json');
const OUT_PASSAGES = path.join(STORE_DIR, 'ruview-kb.passages.jsonl');

const CHUNK_CHARS = 4000;   // ~1000 tokens
const OVERLAP_CHARS = 400;
// 'vendor' holds RuView's NESTED git submodules — third-party repos it pulls in, INCLUDING a full
// copy of ruvnet/ruvector (the 1.7M-line engine, which has its OWN KB). CI checks out submodules
// recursively, so without this exclusion the RuView build full-body-indexes all of vendor/** —
// ~36k extra chunks / 4k+ segments that (a) pollute the RuView KB with ruvector's code and
// (b) overwhelm the small .rvf's close()/persist on the free CI runner (ManifestNotFound). The
// RuView KB indexes RuView's OWN code only. '.claude' is agent config, never knowledge.
const SKIP_DIRS = new Set(['target', 'node_modules', '.git', 'dist', 'build', 'vendor', '.claude']);

// Nested git submodules under RuView are SEPARATE upstream repos vendored in — NOT RuView's own
// code: vendor/ruvector (the full 1.7M-line engine, has its own KB), midstream, sublinear-time-solver,
// rvcsi, rufield, and v2/crates/ruv-neural. CI checks out submodules recursively, so indexing them
// drags ruvector/upstream into the RuView KB (44k chunks — overwhelms the small .rvf's close()/persist
// on the CI runner). Read .gitmodules so EVERY submodule (now AND any future one RuView adds) is
// excluded by path — while keeping RuView's OWN authored crates (e.g. wifi-densepose-ruvector, which
// is not a submodule). The RuView KB indexes RuView's own tree only.
const SUBMODULE_DIRS = (() => {
  const set = new Set();
  try {
    const gm = fs.readFileSync(path.join(RUVIEW, '.gitmodules'), 'utf8');
    for (const m of gm.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) set.add(path.resolve(RUVIEW, m[1].trim()));
  } catch { /* no .gitmodules — nothing to exclude */ }
  return set;
})();
const inSubmodule = (p) => {
  for (const d of SUBMODULE_DIRS) { if (p === d || p.startsWith(d + path.sep)) return true; }
  return false;
};

// ---------- helpers ----------
const read = (p) => fs.readFileSync(p, 'utf8');
const tryRead = (p) => { try { return read(p); } catch { return null; } };
const firstLines = (s, n) => s.split('\n').slice(0, n).join('\n');

function* walk(dir, skip = false) {
  let dirents;
  try { dirents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
  for (const e of dirents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (inSubmodule(p)) continue;   // never index nested submodules (external upstream repos)
      if (skip && SKIP_DIRS.has(e.name)) continue;
      yield* walk(p, skip);
    } else if (e.isFile()) yield p;
  }
}

function titleOf(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).slice(0, 200).trim();
}

function chunk(text) {
  const out = [];
  if (text.length <= CHUNK_CHARS) return [text];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > i + CHUNK_CHARS / 2) end = para; // prefer paragraph boundary
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
  }
  return out;
}

// leading //! doc block from the first N lines of a .rs file ('' if none)
function docBlock(text, n = 30) {
  const lines = text.split('\n').slice(0, n).filter((l) => /^\s*\/\/!/.test(l));
  return lines.map((l) => l.replace(/^\s*\/\/!\s?/, '')).join('\n').trim();
}

function htmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- corpus assembly (mechanical, no curation) ----------
const entries = [];   // { path, kind, title, chunkIdx, chunkTotal, text }
const sourceCounts = {};
const ingestedPaths = new Set(); // absolute paths already in corpus (for the md sweep)
function addDoc(relPath, kind, title, text, absPath) {
  const chunks = chunk(text);
  chunks.forEach((c, i) => entries.push({ path: relPath, kind, title, chunkIdx: i, chunkTotal: chunks.length, text: c }));
  sourceCounts[kind] = (sourceCounts[kind] || 0) + 1;
  if (absPath) ingestedPaths.add(absPath);
}

// ============ v1 CORPUS (unchanged except scripts: 40 lines, recursive) ============

// 1. docs/** — every .md/.txt, full text
for (const p of walk(path.join(RUVIEW, 'docs'))) {
  if (!/\.(md|txt)$/.test(p)) continue;
  const rel = path.relative(RUVIEW, p);
  const text = read(p);
  let kind = 'doc';
  if (rel.includes('/adr/') || /(^|\/)ADR-/.test(rel)) kind = 'adr';
  else if (rel.includes('/tutorials/')) kind = 'tutorial';
  addDoc(rel, kind, titleOf(text, path.basename(p)), text, p);
}

// 2. v2/crates/* — Cargo.toml description + README + lib.rs first 60 lines
for (const dirent of fs.readdirSync(path.join(RUVIEW, 'v2/crates'), { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const cdir = path.join(RUVIEW, 'v2/crates', dirent.name);
  if (inSubmodule(cdir)) continue;   // skip vendored submodule crates (e.g. ruv-neural) — not RuView's own
  const parts = [];
  const toml = tryRead(path.join(cdir, 'Cargo.toml'));
  if (toml) {
    const d = toml.match(/^description\s*=\s*"([^"]*)"/m);
    parts.push(`Crate: ${dirent.name}\nDescription: ${d ? d[1] : '(none)'}`);
  } else parts.push(`Crate: ${dirent.name} (no Cargo.toml)`);
  const librs = tryRead(path.join(cdir, 'src/lib.rs'));
  if (librs) parts.push('--- lib.rs (first 60 lines) ---\n' + firstLines(librs, 60));
  const readme = tryRead(path.join(cdir, 'README.md'));
  if (readme) { parts.push('--- README ---\n' + readme); ingestedPaths.add(path.join(cdir, 'README.md')); }
  addDoc(`v2/crates/${dirent.name}`, 'crate', dirent.name, parts.join('\n\n'));
}

// 3. firmware — every .h under esp32-csi-node (first 60 lines) + provision.py docstring
for (const p of walk(path.join(RUVIEW, 'firmware/esp32-csi-node'))) {
  if (!p.endsWith('.h')) continue;
  const rel = path.relative(RUVIEW, p);
  addDoc(rel, 'firmware', path.basename(p), firstLines(read(p), 60), p);
}
{
  const prov = tryRead(path.join(RUVIEW, 'firmware/esp32-csi-node/provision.py'));
  if (prov) addDoc('firmware/esp32-csi-node/provision.py', 'firmware', 'provision.py', firstLines(prov, 60));
}

// 4. scripts/** — first 40 lines of EVERY file (v2: was top-level only, 20 lines)
for (const p of walk(path.join(RUVIEW, 'scripts'), true)) {
  const rel = path.relative(RUVIEW, p);
  addDoc(rel, 'script', path.basename(p), `Script: ${rel}\n` + firstLines(read(p), 40), p);
}

// 5. README.md full + CHANGELOG.md top 500 lines
addDoc('README.md', 'doc', titleOf(read(path.join(RUVIEW, 'README.md')), 'README.md'), read(path.join(RUVIEW, 'README.md')), path.join(RUVIEW, 'README.md'));
addDoc('CHANGELOG.md', 'doc', 'CHANGELOG.md', firstLines(read(path.join(RUVIEW, 'CHANGELOG.md')), 500), path.join(RUVIEW, 'CHANGELOG.md'));

// 6. ui/*.html — title + meta (v1) ... full text content added below as kind 'ui'
for (const f of fs.readdirSync(path.join(RUVIEW, 'ui')).filter((f) => f.endsWith('.html')).sort()) {
  const html = read(path.join(RUVIEW, 'ui', f));
  const t = html.match(/<title>([^<]*)<\/title>/i);
  const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0]).join('\n');
  addDoc(`ui/${f}`, 'doc', t ? t[1] : f, `UI page: ${f}\nTitle: ${t ? t[1] : '(none)'}\n${metas}`);
}

// 6b. examples/**/README.md — explicit example coverage (full text)
{
  const exDir = path.join(RUVIEW, 'examples');
  if (fs.existsSync(exDir)) {
    for (const p of walk(exDir, true)) {
      if (path.basename(p) !== 'README.md') continue;
      const rel = path.relative(RUVIEW, p);
      const text = read(p);
      addDoc(rel, 'example', titleOf(text, path.dirname(rel)), text, p);
    }
  }
}

// 6c. tutorials — explicit sweep so tutorials are guaranteed present & tagged.
//     docs/tutorials/**/*.md, any *tutorial*.md repo-wide, and the user guides.
{
  const tutDir = path.join(RUVIEW, 'docs/tutorials');
  if (fs.existsSync(tutDir)) {
    for (const p of walk(tutDir, true)) {
      if (!/\.(md|txt)$/.test(p) || ingestedPaths.has(p)) continue;
      const rel = path.relative(RUVIEW, p);
      const text = read(p);
      addDoc(rel, 'tutorial', titleOf(text, path.basename(p)), text, p);
    }
  }
  for (const p of walk(RUVIEW, true)) {
    if (ingestedPaths.has(p)) continue;
    const base = path.basename(p).toLowerCase();
    if (!/\.md$/.test(p)) continue;
    if (/tutorial/.test(base) || /user[-_]guide/.test(base)) {
      const rel = path.relative(RUVIEW, p);
      const text = read(p);
      addDoc(rel, 'tutorial', titleOf(text, path.basename(p)), text, p);
    }
  }
}

// 6d. npm — EVERY package.json in the repo (minus exclusions). ENTIRE CATEGORY was
//     previously missing from RuView. Ingest name+description+scripts+deps+bin.
let npmCount = 0;
for (const p of walk(RUVIEW, true)) {
  if (path.basename(p) !== 'package.json') continue;
  const rel = path.relative(RUVIEW, p);
  // honor audit exclusions: skip generated/vendored manifest noise
  if (/(^|\/)(\.vite|pkg|dist|stub)(\/|$)/.test(rel)) continue;
  if (/\/npm\/[^/]+\/package\.json$/.test(rel)) continue; // per-platform prebuilt stub
  let j;
  try { j = JSON.parse(read(p)); } catch { addDoc(rel, 'npm', rel, `npm package manifest (unparseable JSON) at ${rel}`, p); npmCount++; continue; }
  const scripts = j.scripts ? Object.entries(j.scripts).map(([k, v]) => `  ${k}: ${v}`).join('\n') : '';
  const bin = j.bin ? (typeof j.bin === 'string' ? j.bin : Object.keys(j.bin).join(', ')) : '';
  const deps = Object.keys(j.dependencies || {});
  const devDeps = Object.keys(j.devDependencies || {});
  const text =
    `npm package: ${j.name || rel}\nVersion: ${j.version || ''}\nPath: ${rel}\n` +
    `Description: ${j.description || ''}\n` +
    (bin ? `Bin: ${bin}\n` : '') +
    (j.type ? `Module type: ${j.type}\n` : '') +
    (scripts ? `Scripts:\n${scripts}\n` : '') +
    (deps.length ? `Dependencies: ${deps.join(', ')}\n` : '') +
    (devDeps.length ? `DevDependencies: ${devDeps.join(', ')}\n` : '') +
    (j.keywords?.length ? `Keywords: ${j.keywords.join(', ')}\n` : '');
  addDoc(rel, 'npm', j.name || rel, text, p);
  npmCount++;
}

// 6e. workspace-root manifests — v2/Cargo.toml and python/Cargo.toml ([workspace.members]).
for (const rel of ['v2/Cargo.toml', 'python/Cargo.toml', 'Cargo.toml']) {
  const abs = path.join(RUVIEW, rel);
  const t = tryRead(abs);
  if (!t || ingestedPaths.has(abs)) continue;
  const members = (t.match(/members\s*=\s*\[([\s\S]*?)\]/m) || [, ''])[1]
    .split(/[\s,]+/).map((s) => s.replace(/["']/g, '')).filter(Boolean).join(', ');
  addDoc(rel, 'crate', `${rel} workspace manifest`,
    `Cargo workspace manifest: ${rel}\nWorkspace members: ${members}\n\n${t}`, abs);
}

// 6f. tutorial labeling — docs/guides/** and **/user_guide*.md tagged kind:'tutorial'.
for (const p of walk(RUVIEW, true)) {
  if (ingestedPaths.has(p) || !/\.md$/.test(p)) continue;
  const rel = path.relative(RUVIEW, p);
  const base = path.basename(p).toLowerCase();
  if (rel.startsWith('docs/guides/') || /user_guide/.test(base)) {
    const text = read(p);
    addDoc(rel, 'tutorial', titleOf(text, path.basename(p)), text, p);
  }
}

// 6g. high-value sub-module .rs BODIES (FULL text, chunked) — Tauri desktop flash/ota/
//     provision/discovery commands + domain, and the swarm RL / multiview sensing crate.
//     Indexed in full (not just lead doc-comment); added to fullBodyFiles so the repo-wide
//     doc-comment sweep (step 8) skips them.
const fullBodyFiles = new Set();
for (const sub of [
  'v2/crates/wifi-densepose-desktop/src',
  'v2/crates/ruview-swarm/src',
]) {
  const dir = path.join(RUVIEW, sub);
  if (!fs.existsSync(dir)) continue;
  for (const p of walk(dir, true)) {
    if (!p.endsWith('.rs')) continue;
    fullBodyFiles.add(p);
    const rel = path.relative(RUVIEW, p);
    addDoc(rel, 'crate-src', path.basename(p), `Rust source ${rel} (full):\n${read(p)}`, p);
  }
}

// ============ v2 ENRICHMENT ============

// 7. crate-src — every crate in the repo (every Cargo.toml dir with src/):
//    (a) lib.rs|main.rs leading //! block + first 100 lines, (b) module list entry.
const leadFiles = new Set();
const cargoTomls = [...walk(RUVIEW, true)].filter((p) => path.basename(p) === 'Cargo.toml');
let crateCount = 0;
for (const ct of cargoTomls.sort()) {
  const cdir = path.dirname(ct);
  const crateName = (tryRead(ct)?.match(/^name\s*=\s*"([^"]*)"/m) || [])[1] || path.basename(cdir);
  const lead = ['src/lib.rs', 'src/main.rs'].map((f) => path.join(cdir, f)).find((p) => fs.existsSync(p));
  const relDir = path.relative(RUVIEW, cdir) || '.';
  if (lead) {
    crateCount++;
    leadFiles.add(lead);
    const text = read(lead);
    const doc = docBlock(text, 200); // full leading doc block even if longer than 100 lines
    const body = firstLines(text, 100);
    addDoc(path.relative(RUVIEW, lead), 'crate-src', `${crateName} ${path.basename(lead)}`,
      `Crate ${crateName} (${relDir}) — ${path.basename(lead)} leading doc + first 100 lines:\n` +
      (doc ? `/* doc */\n${doc}\n\n` : '') + body, lead);
    // module list: src/**/*.rs + examples/benches/tests file names
    const mods = [...walk(path.join(cdir, 'src'), true)].filter((p) => p.endsWith('.rs')).map((p) => path.relative(path.join(cdir, 'src'), p));
    const extras = [];
    for (const sub of ['examples', 'benches', 'tests', 'docs']) {
      const d = path.join(cdir, sub);
      if (fs.existsSync(d)) {
        const fls = [...walk(d, true)].map((p) => path.relative(d, p)).slice(0, 60);
        if (fls.length) extras.push(`${sub}: ${fls.join(', ')}`);
      }
    }
    addDoc(`${relDir}/src`, 'crate-src', `${crateName} modules`,
      `Crate ${crateName} (${relDir}) modules: ${mods.join(', ')}` + (extras.length ? `\n${extras.join('\n')}` : ''));
  }
}

// 8. crate-src — repo-wide sweep: every .rs file's leading //! doc block (first 30 lines)
//     (skip lead files and the full-body files already indexed in 6g)
let rsDocCount = 0;
for (const p of walk(RUVIEW, true)) {
  if (!p.endsWith('.rs') || leadFiles.has(p) || fullBodyFiles.has(p)) continue;
  const doc = docBlock(firstLines(read(p), 30));
  if (!doc) continue;
  rsDocCount++;
  const rel = path.relative(RUVIEW, p);
  addDoc(rel, 'crate-src', path.basename(p), `Rust module ${rel} — doc comment:\n${doc}`, p);
}

// 9. doc-deep — EVERY *.md in the repo not already ingested (full text)
let mdDeepCount = 0;
for (const p of walk(RUVIEW, true)) {
  if (!p.endsWith('.md') || ingestedPaths.has(p)) continue;
  mdDeepCount++;
  const rel = path.relative(RUVIEW, p);
  const text = read(p);
  addDoc(rel, 'doc-deep', titleOf(text, path.basename(p)), text, p);
}

// 9b. source — FULL FILE BODIES of the IMPLEMENTING code, chunked like docs (~4000 chars).
//     The #1 fix: steps 7/8 only indexed lead files (first 100 lines) and every other .rs as
//     its leading //! doc-comment ONLY (2-line stubs). Here we ingest the WHOLE body of each
//     source file so "how does X work in the implementation / in the code" returns actual code
//     (signatures, params, function bodies), tagged kind:'source'. Steps 7/8 KEEP their
//     lead-doc + module-inventory entries (orientation); this ADDS bodies.
//     SCOPE (size control): IMPLEMENTING code = files under any `/src/` dir, crate-root .rs
//     (lib.rs/main.rs/mod.rs anywhere), and real example PROGRAMS under examples/*/src.
//     EXCLUDE target/ node_modules/ .git/ dist/ build/ pkg/ .vite/ stub/ noise dirs,
//     tests/ benches/ __tests__/, minified/bundled output, non-src example fixtures.
const CODE_EXT = new Set(['.rs', '.py', '.ts', '.tsx', '.js', '.mjs', '.go', '.c', '.h', '.cpp', '.hpp']);
const CRATE_ROOTS = new Set(['lib.rs', 'main.rs', 'mod.rs']);
const NOISE_DIR_RE = /(^|\/)(target|node_modules|\.git|dist|build|pkg|\.vite|stub|vendor|\.claude)(\/|$)/;
const MINIFIED_RE = /\.(min|bundle)\.(js|css|mjs)$/;
function sourceInScope(rel) {
  if (NOISE_DIR_RE.test(rel)) return false;
  if (MINIFIED_RE.test(rel)) return false;
  if (/(^|\/)(tests|benches|__tests__)\//.test(rel)) return false;
  if (/(^|\/)src\//.test(rel)) return true;
  if (CRATE_ROOTS.has(path.basename(rel))) return true;
  return false;
}
let srcBodyCount = 0, srcBodyBytes = 0;
for (const p of walk(RUVIEW, true)) {
  const ext = path.extname(p);
  if (!CODE_EXT.has(ext)) continue;
  if (fullBodyFiles.has(p)) continue;          // already indexed in full by step 6g
  const rel = path.relative(RUVIEW, p);
  if (!sourceInScope(rel)) continue;
  const body = read(p);
  if (!body.trim()) continue;
  srcBodyCount++; srcBodyBytes += body.length;
  addDoc(rel, 'source', path.basename(p), `Source ${rel} (full):\n${body}`);
}

// 10. ui — full text content of ui/*.html
for (const f of fs.readdirSync(path.join(RUVIEW, 'ui')).filter((f) => f.endsWith('.html')).sort()) {
  const text = htmlText(read(path.join(RUVIEW, 'ui', f)));
  if (text) addDoc(`ui/${f}`, 'ui', f, `UI page ${f} full text content:\n${text}`);
}

// 11. plugin manifests
for (const rel of ['.claude-plugin/marketplace.json', 'plugins/ruview/.claude-plugin/plugin.json']) {
  const t = tryRead(path.join(RUVIEW, rel));
  if (t) addDoc(rel, 'doc-deep', rel, `Plugin manifest ${rel}:\n${t}`);
}

// ---------- pre-ingest manifest ----------
console.log('=== CORPUS (source files per kind) ===');
console.log(JSON.stringify(sourceCounts, null, 2));
console.log('crates with lead file:', crateCount, '| .rs files with //! doc:', rsDocCount, '| md swept (doc-deep):', mdDeepCount);
console.log('npm manifests:', npmCount, '| full-body .rs files (desktop+swarm):', fullBodyFiles.size);
console.log('SOURCE full-body files (kind:source, src/** + crate-roots):', srcBodyCount, '| bytes:', srcBodyBytes, '| ~chunks:', Math.ceil(srcBodyBytes / 3600));
console.log('Total chunks to embed:', entries.length);
const kindTotals = {};
for (const e of entries) kindTotals[e.kind] = (kindTotals[e.kind] || 0) + 1;
console.log('Chunks per kind:', JSON.stringify(kindTotals));

// ---------- embed + ingest ----------
// Embedder resolved portably (project node_modules -> XENOVA_PATH env -> Mac build).
// Use the local MiniLM cache when present (fast, offline); otherwise allow remote download.
const { T, modelCache: MODEL_CACHE, via: tVia } = await loadTransformers();
const { haveLocalModel } = configureModel(T, MODEL_CACHE);
console.log('[build-ruview] transformers via:', tVia);
console.log('Embedder:', haveLocalModel ? `local cache ${MODEL_CACHE}` : `remote download (cache: ${MODEL_CACHE})`);
const t0 = Date.now();
const fe = await T.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
console.log('Embedder loaded in', Date.now() - t0, 'ms');

// back up v1 store + sidecars before overwriting
for (const [src, dst] of [
  [OUT_RVF, OUT_RVF.replace(/\.rvf$/, '.v1.rvf')],
  [OUT_RVF + '.idmap.json', OUT_RVF.replace(/\.rvf$/, '.v1.rvf') + '.idmap.json'],
  [OUT_META, OUT_META.replace(/\.json$/, '.v1.json')],
]) {
  if (fs.existsSync(src) && !fs.existsSync(dst)) { fs.copyFileSync(src, dst); console.log('backed up', path.basename(src), '->', path.basename(dst)); }
}

fs.rmSync(OUT_RVF, { force: true });
fs.rmSync(OUT_RVF + '.idmap.json', { force: true });
const db = await RvfDatabase.create(OUT_RVF, { dimensions: 384, metric: 'cosine' });

const meta = {};
// Full-text passages sidecar: one JSON object per line {id,text,path,title}.
// Same id as the vector in the .rvf and in meta — so retrieval can join.
fs.rmSync(OUT_PASSAGES, { force: true });
const passagesFd = fs.openSync(OUT_PASSAGES, 'w');
let passageLines = 0;
const BATCH = 32;
let ingested = 0;
for (let i = 0; i < entries.length; i += BATCH) {
  const batch = entries.slice(i, i + BATCH);
  const out = await fe(batch.map((e) => e.text), { pooling: 'mean', normalize: true });
  const dim = out.dims[1];
  const ingest = batch.map((e, j) => {
    const id = String(i + j + 1);
    meta[id] = { path: e.path, kind: e.kind, title: e.title, chunk: `${e.chunkIdx + 1}/${e.chunkTotal}`, preview: e.text.slice(0, 240).replace(/\s+/g, ' ') };
    // FULL, untruncated chunk text -> passages sidecar.
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
console.log(`\nIngested ${ingested} vectors | passages lines: ${passageLines}`);

const status = await db.status();
console.log('=== POST-INGEST ===');
console.log('RVF status:', JSON.stringify(status));
console.log('Chunks per kind:', JSON.stringify(kindTotals));
console.log('Distinct source paths in KB:', new Set(entries.map((e) => e.path)).size);
console.log('Reconcile: chunks assembled =', entries.length, '| vectors in store =', status.totalVectors, '| match =', entries.length === status.totalVectors);

fs.writeFileSync(OUT_META, JSON.stringify({ model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, metric: 'cosine', entries: meta }, null, 1));
console.log('Passages reconcile: vectors =', status.totalVectors, '| passages lines =', passageLines, '| meta ids =', Object.keys(meta).length, '| match =', status.totalVectors === passageLines && passageLines === Object.keys(meta).length);

// ---------- verification queries ----------
const QUERIES = [
  'how does the breathing extractor bandpass work',
  'pose tracker kalman implementation',
  'how do I calibrate an empty room',
  'MQTT privacy modes',
  'what does the ruview plugin install',
  'C6 time sync accuracy',
];
console.log('=== VERIFICATION QUERIES ===');
for (const q of QUERIES) {
  const qv = await fe([q], { pooling: 'mean', normalize: true });
  const hits = await db.query(Float32Array.from(qv.data), 5);
  console.log(`\nQ: ${q}`);
  for (const h of hits) {
    const m = meta[h.id];
    console.log(`  ${h.distance.toFixed(4)}  [${m.kind}] ${m.path} (chunk ${m.chunk}) — ${m.title}`);
  }
}

await db.close();
console.log('\nDone. RVF size:', fs.statSync(OUT_RVF).size, 'bytes');
