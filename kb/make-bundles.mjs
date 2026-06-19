#!/usr/bin/env node
// make-bundles.mjs — build the SELF-CONTAINED, RUNNABLE download zips (one per repo).
//
// Each bundle ships BOTH variants of that repo's KB (big 768-dim + small 384-dim) plus the
// ONE shared passages/metadata sidecar (the big variant re-uses the small build's passages,
// so we never double the ~92 MB text in the download), the runnable tools, the evergreen
// self-updater, a full README, BOTH primers (ruvector + ruview — two halves of one Seed), and a
// repo-specific START-HERE.md generated below.
//
// Usage: node kb/make-bundles.mjs           (both repos)
//        node kb/make-bundles.mjs ruvector  (one)
// Uses the system `zip` (present on macOS + ubuntu-latest runners).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { targets } from './kb.config.mjs';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Canonical hosts. The MANIFEST (.last-built.json) is small + lives in the repo, served raw.
// The BUNDLES are large (the big .rvf alone > GitHub's 100MB file limit), so they're hosted as
// assets on the ROLLING `kb-latest` GitHub Release — a permanent URL CI keeps current.
// The GitHub slug is configurable via KB_GH_SLUG (env) so this is NOT repo-baked; default is the
// live MetaHarness artifact repo from the build plan.
const GH_SLUG = process.env.KB_GH_SLUG || 'stuinfla/ruv-explainer-agent-harness-generator';
const CANON_BASE = `https://raw.githubusercontent.com/${GH_SLUG}/main/kb`;
const MANIFEST_URL = `${CANON_BASE}/.last-built.json`;
const RELEASE_BASE = `https://github.com/${GH_SLUG}/releases/download/kb-latest`;

// files shared by every bundle (the runnable shim + setup + integrity check + evergreen + README).
// kb.config.mjs ships so the unzipped ask-kb/kb-mcp-server can resolve per-store config; README is
// optional (a generated START-HERE.md always ships) so a not-yet-authored README never blocks.
const SHARED = ['ask-kb.mjs', 'kb-mcp-server.mjs', 'resolve-deps.mjs', 'guard-check.mjs',
  'kb.config.mjs', 'kb-update.mjs', 'SOURCE.json', 'package.json'];
const SHARED_OPTIONAL = ['README.md'];

// The primer(s) that ship in every bundle — one per configured target, sourced from each store dir.
// (dest inside the zip is the flat <slug>-primer.md the unzipped tools resolve.)
const ALL_PRIMERS = Object.keys(targets).map((slug) => [
  `stores/${slug}/${slug}-primer.md`, `${slug}-primer.md`,
]);

// Regenerate SOURCE.json from .last-built.json so embedded provenance never drifts from the manifest.
function writeSourceJson() {
  const manifestPath = path.join(KB_DIR, '.last-built.json');
  if (!fs.existsSync(manifestPath)) throw new Error('cannot write SOURCE.json: .last-built.json missing (build first)');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const builtUtc = m.generated;
  const stores = {};
  for (const [kbName, s] of Object.entries(m.stores || {})) {
    stores[kbName] = {
      kbName,
      sourceRepo: s.sourceRepo || null,
      sourceCommit: s.sha || null,
      sourceDescribe: s.describe || null,
      builtUtc,
      builder: 'rvf-kb-forge',
      canonicalManifestUrl: MANIFEST_URL,
      canonicalBundleUrl: `${RELEASE_BASE}/${kbName}-kb-bundle.zip`,
      selfUpdate: `node kb-update.mjs ${kbName}`,
    };
  }
  fs.writeFileSync(path.join(KB_DIR, 'SOURCE.json'), JSON.stringify({
    builder: 'rvf-kb-forge', builtUtc, canonicalManifestUrl: MANIFEST_URL,
    selfUpdate: 'node kb-update.mjs', stores,
  }, null, 2) + '\n');
  console.log('regenerated SOURCE.json from .last-built.json');
}
writeSourceJson();

// BUNDLES is DERIVED from the config registry — NO hard-coded repo names. For each target slug:
//   dataFiles  = the small store + its sidecars (generic builder writes <slug>-kb.ids.json)
//   bigFiles   = the big variant trio (included only when present)
//   scriptFiles= the generic build chain (build-kb + corpus-rules + big-variant + index-primer)
//   blurb/questions come from the target's bundle config; label = slug; primer ships via ALL_PRIMERS.
const BUNDLES = Object.fromEntries(Object.keys(targets).map((slug) => {
  const t = targets[slug];
  const b = t.bundle || {};
  return [slug, {
    zip: `${slug}-kb-bundle.zip`,
    label: slug,
    blurb: b.blurb || `${t.metaName || slug} knowledge base.`,
    // per-repo DATA files (live in stores/<slug>/, staged FLAT into the zip)
    dataFiles: [`${slug}-kb.small.rvf`, `${slug}-kb.small.rvf.idmap.json`,
      `${slug}-kb.passages.jsonl`, `${slug}-kb.ids.json`],
    // big (optional — included only if all are present; also in stores/<slug>/)
    bigFiles: [`${slug}-kb.big.rvf`, `${slug}-kb.big.rvf.idmap.json`, `${slug}-kb.big.rvf.embed.json`],
    // build scripts (live in kb/, staged preserving their path)
    scriptFiles: ['build-kb.mjs', 'corpus-rules.mjs', 'build-big-variant.mjs', 'index-primer.mjs'],
    // NotebookLM Studio extras are layered later (P12); set studioDir per target when authored.
    studioDir: b.studioDir || null,
    questions: (b.questions && b.questions.length) ? b.questions : [`What is ${t.metaName || slug}?`],
  }];
}));

// Recursively collect [absPath, relPath] for every file under absDir (relPath rooted at relBase).
// Used to sweep a bundle's studio/ tree so new Studio outputs are picked up without editing lists.
function walkDir(absDir, relBase) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.posix.join(relBase, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(abs, rel));
    else if (entry.isFile() && !entry.name.startsWith('.')) out.push([abs, rel]);
  }
  return out;
}

// A tailored one-page intro generated INTO each zip so a first-timer knows exactly what they have.
// Fully target-driven (label/blurb/questions/primers from config) — NO hard-coded repo names.
function startHere(b, hasBig) {
  const q = b.questions.map((x) => `- "${x}"`).join('\n');
  const primerList = ALL_PRIMERS.map(([, dst]) => `- 📘 **${dst}** — the primer for this knowledge base`).join('\n');
  const studio = b.studioDir ? `

## Bonus: NotebookLM Studio media (in \`studio/\`)
This bundle also ships an AI-generated media pack, split by audience:
- 👤 **\`studio/for-humans/\`** — watch/listen/read: a video explainer, an audio overview, a slide deck, and infographics.
- 🤖 **\`studio/for-ai/\`** — plain text for assistants to ingest: transcripts + a machine-readable notebook-summary.
` : '';
  return `# START HERE — the ${b.label} knowledge base

**What you just unzipped:** a searchable "brain" for **${b.blurb}**

You don't need to understand vector databases to use this. Two things:

## 1. Which file do I use?
You got **two versions of the same knowledge**:
- 🖥️ **BIG** \`${b.label}-kb.big.rvf\` → **use on your Mac/PC** (sharper answers).${hasBig ? '' : '  *(not included in this copy — build it with `node build-big-variant.mjs both`)*'}
- 🌱 **SMALL** \`${b.label}-kb.small.rvf\` → lighter; runs anywhere Node 18+ does.

The tools auto-pick BIG if it's here, else SMALL. You don't have to choose by hand.

## 2. Try it in 2 commands
\`\`\`bash
npm i                                              # one time (needs Node 18+)
node ask-kb.mjs ${b.label} "${b.questions[0]}" 5
\`\`\`

## The best use: point your AI assistant at it
Connect it to Claude Code / Cursor / VS Code via the bundled \`kb-mcp-server.mjs\` so your assistant
answers from the REAL ${b.label} sources instead of guessing.

## Questions this KB answers well
${q}

## Primer included
${primerList}
${studio}`;
}

function build(name) {
  const b = BUNDLES[name];
  const storeDir = path.join(KB_DIR, 'stores', name);   // per-repo data lives here
  // include big files only if they all exist (so the script works before/without a big build)
  const bigPresent = b.bigFiles.every((f) => fs.existsSync(path.join(storeDir, f)));
  const dataNames = bigPresent ? [...b.dataFiles, ...b.bigFiles] : b.dataFiles;

  // (src absolute path, dest path-inside-zip) pairs. Data + shared go FLAT; scripts keep their path.
  const studioPairs = b.studioDir ? walkDir(path.join(storeDir, b.studioDir), b.studioDir) : [];
  // Guard: a bundle that DECLARES studio media must not ship without it. Catches an accidental
  // gitignore / missing checkout in CI BEFORE make-bundles produces a studio-less zip that would
  // clobber the good Release. Fail RED instead of silently shipping an incomplete download.
  if (b.studioDir && studioPairs.filter(([, rel]) => rel.includes('for-humans/')).length === 0) {
    throw new Error(`${name}: studioDir '${b.studioDir}' is set but no for-humans/ media was found under ` +
      `${path.join(storeDir, b.studioDir)}. Refusing to build a studio-less bundle — are the studio ` +
      `files committed and checked out? (If you truly want to drop studio, remove studioDir from BUNDLES.)`);
  }
  // Optional shared files (e.g. README.md) ship only if present — never block the bundle.
  const optionalPairs = SHARED_OPTIONAL
    .map((f) => [path.join(KB_DIR, f), f])
    .filter(([src]) => fs.existsSync(src));
  const pairs = [
    ...dataNames.map((f) => [path.join(storeDir, f), f]),
    ...b.scriptFiles.map((f) => [path.join(KB_DIR, f), f]),
    ...SHARED.map((f) => [path.join(KB_DIR, f), f]),
    ...optionalPairs,
    ...ALL_PRIMERS.map(([src, dst]) => [path.join(KB_DIR, src), dst]),  // the primer(s) in every bundle
    ...studioPairs,  // NotebookLM Studio extras (when a target sets studioDir): studio/for-humans|for-ai/**
  ];
  const missing = pairs.filter(([src]) => !fs.existsSync(src)).map(([src]) => src);
  if (missing.length) throw new Error(`${name}: missing files for bundle:\n  ${missing.join('\n  ')}`);

  // Stage into a temp dir so subdir paths (.build-ruvector-kb/build.mjs) survive inside the zip.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `kb-bundle-${name}-`));
  for (const [src, rel] of pairs) {
    const dst = path.join(stage, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  // write the generated, repo-specific one-pager
  fs.writeFileSync(path.join(stage, 'START-HERE.md'), startHere(b, bigPresent));

  const out = path.join(KB_DIR, b.zip);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-r', '-X', out, '.'], { cwd: stage, stdio: 'inherit' });
  fs.rmSync(stage, { recursive: true, force: true });
  const size = fs.statSync(out).size;
  console.log(`built ${b.zip} (${(size / 1e6).toFixed(1)} MB, ${pairs.length + 1} files, big=${bigPresent ? 'YES' : 'no'})`);
}

const which = process.argv[2];
const toBuild = which ? [which] : Object.keys(BUNDLES);
for (const name of toBuild) {
  if (!BUNDLES[name]) { console.error(`unknown bundle '${name}' (known: ${Object.keys(BUNDLES).join(', ')})`); process.exit(2); }
  build(name);
}
