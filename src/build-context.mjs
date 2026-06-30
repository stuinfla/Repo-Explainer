// src/build-context.mjs — the BuildContext (build.json) lifecycle for the orchestrator.
//
// CONTRACT §a: there is exactly ONE data contract per build — build.json inside the build dir. The
// brain (this CLI) owns it; each station fills its own slot. This module gives the brain the same
// disciplined read-modify-write-one-slot access the tools use, so the orchestrator never clobbers a
// tool's slot. The build dir layout is CONTRACT §b:
//
//   <build-dir>/
//     build.json   the BuildContext (the ONLY cross-tool channel)
//     repo/        the cloned working tree (clone-repo writes this)
//     assets/      generated images / SVGs / favicons / social card
//     site/        the assembled page + the knowledge-pack zip

import fs from 'node:fs';
import path from 'node:path';

export function buildJsonPath(buildDir) { return path.join(path.resolve(buildDir), 'build.json'); }

// Create the build dir + a seed build.json carrying only repo.url (clone-repo, Station 0–1, sets
// buildId + the rest of the repo slot). Idempotent: an existing build.json is preserved and its
// repo.url refreshed, so re-running a build resumes rather than wiping prior station output.
export function initBuildDir(buildDir, repoUrl) {
  const dir = path.resolve(buildDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const p = buildJsonPath(dir);
  let ctx = {};
  if (fs.existsSync(p)) {
    try { ctx = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { ctx = {}; }
  }
  ctx.repo = { ...(ctx.repo || {}), url: repoUrl };
  fs.writeFileSync(p, JSON.stringify(ctx, null, 2) + '\n');
  return dir;
}

export function readContext(buildDir) {
  const p = buildJsonPath(buildDir);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch { throw new Error(`build.json not found at ${p} (run earlier stations first)`); }
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`build.json is not valid JSON: ${e.message}`); }
}

// Read-modify-write a SINGLE top-level slot, exactly like the tools' mergeSlot. For object slots we
// shallow-merge so a partial author preserves sibling keys; non-object values replace outright.
export function mergeSlot(buildDir, slot, value) {
  const p = buildJsonPath(buildDir);
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
  obj[slot] = isPlainObject ? { ...(obj[slot] || {}), ...value } : value;
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return obj[slot];
}

// True iff a slot is already populated (used by --from/--to resume + "skip if done" logic).
export function hasSlot(buildDir, slot) {
  try {
    const ctx = readContext(buildDir);
    const v = ctx[slot];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  } catch { return false; }
}
