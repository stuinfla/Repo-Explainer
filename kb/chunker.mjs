// chunker.mjs — the ONE structure-aware chunker + corpus-context factory (ADR-0010 D1).
//
// Factored VERBATIM out of build-kb.mjs so external tools (delta builders, audits) can import
// the REAL chunker instead of replicating it — replication drift was the corruption risk that
// motivated issue #14's hash guard. Everything here is pure text ops + fs walking; no embedder,
// no store. build-kb.mjs is the only in-repo consumer; the drop-in zips do not ship this file.
//
// Exports: CHUNK_CHARS, OVERLAP_CHARS, STRUCT_TARGET_CHARS, STRUCT_MIN_CHARS,
//          windowChunk(), structureBoundaries(), chunk(), classifySourceType(), makeContext().

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/

export const CHUNK_CHARS = 4000;   // ~1000 tokens (hard ceiling for the window fallback)
export const OVERLAP_CHARS = 400;
// Structure-aware target (ADR-0001 v1.3.0 D5): split at code/document STRUCTURE boundaries,
// keep a doc-comment attached to the symbol it documents, target ≤512 tokens (~2048 chars).
export const STRUCT_TARGET_CHARS = 2048;   // ≤512 tokens
export const STRUCT_MIN_CHARS = 160;       // don't emit micro-fragments; coalesce upward

// ---------- source_type tagging (ADR-0001 v1.3.2: src|test|example|doc|config) ----------
// Every passage carries a coarse source_type so the AI knows what a hit IS (production source vs a
// test vs an example vs prose vs config) and can ask for tests/examples as usage docs. Derived from
// the path first (tests/, examples/, benches/ dirs win), then the corpus `kind`, then the extension.
export function classifySourceType(relPath, kind) {
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
export function windowChunk(text) {
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
export function structureBoundaries(text) {
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
export function chunk(text) {
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
export function makeContext(target) {
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
