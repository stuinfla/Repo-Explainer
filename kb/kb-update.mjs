#!/usr/bin/env node
// kb-update.mjs — EVERGREEN self-updater for a copied Cognitum RVF KB bundle.
//
// This ships INSIDE the bundle. A consumer who copied the bundle into their own project's
// `kb/` runs it there. It reads the embedded provenance (SOURCE.json — "where I came from"),
// fetches the LIVE canonical build manifest, and tells them whether their copy is current.
//
//   node kb-update.mjs            (== --check)  report only: UP TO DATE / BEHIND
//   node kb-update.mjs --check    same as above
//   node kb-update.mjs --apply    download the canonical bundle, back up, extract over local
//                                 files, re-verify with the bundled guard, print DONE
//   node kb-update.mjs <name>     limit to one store ("ruvector" | "ruview") when SOURCE.json
//                                 carries both (default: report on all stores it knows)
//
// Schedule a periodic check (cron example — every Monday 09:00, log the result):
//   0 9 * * 1  cd /path/to/your/project/kb && /usr/bin/node kb-update.mjs --check >> kb-update.log 2>&1
//
// Zero dependencies. Node 18+ (uses global fetch). Network failures fail LOUD and CLEAN:
// a clear message, a non-zero exit, and NO partial clobber of your local files.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(KB_DIR, 'SOURCE.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CHECK = argv.includes('--check') || !APPLY; // default action is check
const ONLY = argv.find((a) => !a.startsWith('--')); // optional store filter

function die(msg, code = 1) {
  console.error(`\n[kb-update] ERROR: ${msg}`);
  process.exit(code);
}

// ---- read embedded provenance ("where I came from") ----
if (!fs.existsSync(SOURCE_PATH)) {
  die(`no SOURCE.json next to this script (${SOURCE_PATH}).\n` +
      `This bundle predates the evergreen mechanism, or SOURCE.json was removed. ` +
      `Re-download a current bundle to gain self-update.`);
}
let source;
try {
  source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
} catch (e) {
  die(`SOURCE.json is unreadable/corrupt: ${e.message}`);
}

// SOURCE.json carries one or more stores. Normalize to an array of { kbName, ...provenance }.
const stores = Array.isArray(source.stores)
  ? source.stores
  : (source.stores && typeof source.stores === 'object')
    ? Object.entries(source.stores).map(([kbName, v]) => ({ kbName, ...v }))
    : [source]; // single-store SOURCE.json shape

const manifestUrl = source.canonicalManifestUrl
  || stores.find((s) => s.canonicalManifestUrl)?.canonicalManifestUrl;
if (!manifestUrl) die('SOURCE.json has no canonicalManifestUrl — cannot find the live source.');

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    die(`network failure fetching ${url}\n  ${e.message}\n  ` +
        `(offline? firewall? the canonical host moved?) — nothing was changed locally.`, 2);
  }
  if (!res.ok) die(`canonical manifest returned HTTP ${res.status} for ${url} — nothing changed.`, 2);
  try { return await res.json(); } catch (e) { die(`canonical manifest was not valid JSON: ${e.message}`, 2); }
}

async function fetchBuffer(url) {
  let res;
  try { res = await fetch(url, { redirect: 'follow' }); }
  catch (e) { die(`network failure downloading ${url}\n  ${e.message} — nothing was changed locally.`, 2); }
  if (!res.ok) die(`bundle download returned HTTP ${res.status} for ${url} — nothing changed.`, 2);
  return Buffer.from(await res.arrayBuffer());
}

// ---- compare local provenance vs the LIVE canonical manifest ----
// canonical .last-built.json shape: { generated, stores: { <name>: { sha, describe, ... } } }
function canonicalFor(canon, kbName) {
  const cs = (canon.stores && canon.stores[kbName]) || {};
  return {
    builtUtc: canon.generated || null,      // manifest has one build timestamp for the whole rebuild
    sourceCommit: cs.sha || null,
    sourceDescribe: cs.describe || null,
    sourceRepo: cs.sourceRepo || null,
  };
}

function isBehind(local, canon) {
  // Primary signal: build timestamp. Secondary: source commit SHA (covers same-timestamp re-pin).
  const lt = local.builtUtc ? Date.parse(local.builtUtc) : NaN;
  const ct = canon.builtUtc ? Date.parse(canon.builtUtc) : NaN;
  if (!Number.isNaN(lt) && !Number.isNaN(ct) && ct > lt) return true;
  if (local.sourceCommit && canon.sourceCommit && local.sourceCommit !== canon.sourceCommit) return true;
  return false;
}

function short(sha) { return sha ? String(sha).slice(0, 12) : '(none)'; }

async function main() {
  const canon = await fetchJson(manifestUrl);

  const targets = ONLY ? stores.filter((s) => s.kbName === ONLY) : stores;
  if (ONLY && targets.length === 0) die(`SOURCE.json has no store named "${ONLY}". Known: ${stores.map((s) => s.kbName).join(', ')}`);

  console.log(`\n=== Cognitum KB evergreen check ===`);
  console.log(`canonical manifest: ${manifestUrl}`);
  console.log(`canonical built:    ${canon.generated || '(unknown)'}\n`);

  let anyBehind = false;
  const behindStores = [];
  for (const local of targets) {
    const canonS = canonicalFor(canon, local.kbName);
    const behind = isBehind(local, canonS);
    anyBehind = anyBehind || behind;
    if (behind) behindStores.push({ local, canonS });
    if (behind) {
      console.log(`[${local.kbName}] BEHIND`);
      console.log(`    canonical: built ${canonS.builtUtc} from ${short(canonS.sourceCommit)}` +
        `${canonS.sourceDescribe ? ` (${canonS.sourceDescribe})` : ''}`);
      console.log(`    yours:     built ${local.builtUtc} from ${short(local.sourceCommit)}` +
        `${local.sourceDescribe ? ` (${local.sourceDescribe})` : ''}`);
    } else {
      console.log(`[${local.kbName}] UP TO DATE (built ${local.builtUtc || '?'} from ${short(local.sourceCommit)})`);
    }
  }

  if (!APPLY) {
    if (anyBehind) {
      console.log(`\nA newer build exists. Run:  node kb-update.mjs --apply   to self-update.`);
      process.exit(10); // distinct non-zero code so a cron/script can detect "behind"
    }
    console.log(`\nAll stores current. Nothing to do.`);
    process.exit(0);
  }

  // ---- --apply path ----
  if (!anyBehind) {
    console.log(`\nNothing to apply — already current.`);
    process.exit(0);
  }

  for (const { local } of behindStores) {
    const bundleUrl = local.canonicalBundleUrl || source.canonicalBundleUrl;
    if (!bundleUrl) die(`[${local.kbName}] no canonicalBundleUrl in SOURCE.json — cannot self-update this store.`);
    console.log(`\n[${local.kbName}] downloading ${bundleUrl} ...`);
    const buf = await fetchBuffer(bundleUrl);

    // Stage in a temp dir; only touch the real files once the download + extract succeed.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kb-update-${local.kbName}-`));
    const zipPath = path.join(tmp, 'bundle.zip');
    const extractDir = path.join(tmp, 'extracted');
    fs.writeFileSync(zipPath, buf);
    fs.mkdirSync(extractDir, { recursive: true });
    console.log(`  downloaded ${(buf.length / 1e6).toFixed(1)} MB; extracting...`);
    try {
      execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], { stdio: 'inherit' });
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      die(`[${local.kbName}] unzip failed: ${e.message} — local files untouched.`);
    }

    // Back up the whole local KB dir BEFORE clobbering (timestamped, beside it).
    const backup = path.join(path.dirname(KB_DIR), `${path.basename(KB_DIR)}.bak-${stamp()}`);
    console.log(`  backing up current copy -> ${backup}`);
    fs.cpSync(KB_DIR, backup, { recursive: true });

    // Copy every extracted file over the local ones (preserving subdirs).
    copyTree(extractDir, KB_DIR);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`  files replaced.`);
  }

  // Re-verify with the bundled guard (now the freshly-applied one). Verify ONLY the stores we
  // actually updated — guard-check.mjs takes a store name as argv[2]; with no arg it checks
  // BOTH stores, which would spuriously fail when this copy only holds one store's files.
  const guard = path.join(KB_DIR, 'guard-check.mjs');
  if (fs.existsSync(guard)) {
    for (const { local } of behindStores) {
      console.log(`\nre-verifying [${local.kbName}] with guard-check.mjs ...`);
      try {
        execFileSync(process.execPath, [guard, local.kbName], { cwd: KB_DIR, stdio: 'inherit' });
      } catch {
        die(`guard-check FAILED for [${local.kbName}] after update. Your previous copy is backed up ` +
            `beside kb/ (kb.bak-*). Restore it if needed; do not trust this updated copy until the guard passes.`);
      }
    }
  } else {
    console.log(`\n(no guard-check.mjs found to re-verify — skipped)`);
  }

  console.log(`\n=== DONE — KB updated to the canonical build (${canon.generated}). ===`);
  process.exit(0);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function copyTree(srcDir, dstDir) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

main().catch((e) => die(`unexpected: ${e.message}`));
