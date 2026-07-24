// store-set.mjs — StoreSet aggregate helpers (ADR-0010; DDD: docs/ddd/kb-delta-domain.md).
//
// A "StoreSet" is the .rvf file PLUS its sidecars (.passages.jsonl, .ids.json, .embed.json,
// .idmap.json). Consistency is defined across the set, so mutation follows one discipline:
// stage → verify → publish atomically. This module owns that discipline plus the StoreSet
// lockfile shared by build-kb.mjs --delta and index-primer.mjs (closes the planning race
// where one builder computes ids from sidecars while the other is mid-write).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const SYNTHETIC_PATH_RE = /^PRIMER#/;   // the documented "synthetic, preserve on delta" marker
const LOCK_STALE_MS = 60 * 60 * 1000;          // 1 h — a builder that old is presumed dead

// ---------- StoreSet lock ----------
// Exclusive-create lockfile next to the store. Both builders take it BEFORE reading any state.
export function acquireLock(baseNoExt) {
  const lockPath = `${baseNoExt}.lock`;
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = Infinity;
    try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* raced away → retry once */ }
    if (age < LOCK_STALE_MS) {
      const who = (() => { try { return fs.readFileSync(lockPath, 'utf8'); } catch { return '(unreadable)'; } })();
      throw new Error(`StoreSet is locked by another builder: ${lockPath} ${who}. `
        + `If that process is dead, remove the lock file and retry.`);
    }
    fs.rmSync(lockPath, { force: true });                 // stale — reclaim
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
  }
  let released = false;
  const release = () => { if (!released) { released = true; fs.rmSync(lockPath, { force: true }); } };
  process.once('exit', release);
  return release;
}

// ---------- sidecar readers ----------
// Passages, keeping the RAW line for every record so preserved (synthetic) entries can be
// republished byte-identical (their shape differs from corpus lines — ADR-0010 D2.6).
export function readPassages(file) {
  return new Promise((resolve, reject) => {
    const records = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const o = JSON.parse(line);
        records.push({ raw: line, id: String(o.id), path: o.path || '', text: o.text || '' });
      } catch { /* skip malformed line (matches ask-kb's reader) */ }
    });
    rl.on('close', () => resolve(records));
    rl.on('error', reject);
  });
}

// ids.json: { model, dimensions, metric, maxIdEver?, entries: { id -> {...} } }
export function readIdsIndex(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { header: { model: j.model, dimensions: j.dimensions, metric: j.metric, maxIdEver: j.maxIdEver }, entries: j.entries || {} };
}

// ---------- atomic write + staged publish ----------
export function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// Clone a file for staging. COPYFILE_FICLONE is instant (CoW) on APFS and silently falls
// back to a real copy elsewhere.
export function cloneFile(src, dst) {
  fs.rmSync(dst, { force: true });
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
}

// Publish staged files over the live generation: live → .bak, staged → live, drop .bak.
// pairs: [{ staged, live }]. On failure mid-swap, restore every .bak and rethrow, so the
// live StoreSet is never left mixed-generation (ADR-0010 D2.7).
export function publish(pairs) {
  const swapped = [];
  try {
    for (const { live } of pairs) {
      if (fs.existsSync(live)) { fs.renameSync(live, `${live}.bak`); swapped.push(live); }
    }
    for (const { staged, live } of pairs) fs.renameSync(staged, live);
    for (const live of swapped) fs.rmSync(`${live}.bak`, { force: true });
  } catch (e) {
    for (const live of swapped) {
      try { if (fs.existsSync(`${live}.bak`)) { fs.rmSync(live, { force: true }); fs.renameSync(`${live}.bak`, live); } }
      catch { /* keep restoring the rest; the .bak that failed stays on disk for manual recovery */ }
    }
    throw new Error(`StoreSet publish failed and was rolled back: ${e.message}`);
  }
}

// ---------- invariant checks ----------
// INV-KB2: within every path, ids strictly increase in record order (records must be given
// in emission order). Returns the first violating path or null.
export function firstIdOrderViolation(records) {
  const lastByPath = new Map();
  for (const r of records) {
    const n = Number(r.id);
    const prev = lastByPath.get(r.path);
    if (prev !== undefined && n <= prev) return r.path;
    lastByPath.set(r.path, n);
  }
  return null;
}
