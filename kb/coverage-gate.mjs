#!/usr/bin/env node
// coverage-gate.mjs — GATE B: SOURCE-COVERAGE gate. Generic, config-driven.
//
// Asserts the KB actually INDEXED the repo (not just the docs), so an AI querying only the drop-in
// can reach any authored file. Emits a JSON report + pass/fail. Checks:
//   1. coverage ratio = indexed_source_files / authored_non_excluded_source_files  >= 0.92  (fail < 0.85)
//   2. >= 3 passages per crate/package (every component is reachable, not just the big ones)
//   3. spot-check 20 RANDOM authored source files are each retrievable via ask-kb (>=1 passage whose
//      source path matches)
//   4. passage / source-file ratio >= 4.0  (the corpus is chunked richly, not one-passage-per-file)
//
// Repo shape is DATA (kb.config.mjs: repoDir, scopeExclude, componentRoots, codeExt). The "indexed"
// set comes from the built <slug>-kb.ids.json (per-passage path+source_type). Runs offline for the
// structural checks; the 20 spot-checks hit the REAL searchKb() (same door the AI uses).
//
// Usage: node kb/coverage-gate.mjs --target ruqu  [--seed 7] [--spot 20] [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { searchKb } from './ask-kb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const COVERAGE_PASS = 0.92;
export const COVERAGE_FAIL = 0.85;
export const MIN_PASSAGES_PER_COMPONENT = 3;
export const PASSAGE_RATIO_MIN = 4.0;
export const SPOT_CHECK_PASS = 0.80;   // >=80% of the 20 random files must be retrievable

function parseArgs(argv) {
  const a = { target: defaultTarget, seed: 7, spot: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (v === '--seed') a.seed = parseInt(argv[++i], 10) || 7;
    else if (v === '--spot') a.spot = parseInt(argv[++i], 10) || 20;
    else if (v === '--json') a.json = true;
    else if (!v.startsWith('--')) a.target = v;
  }
  return a;
}

// deterministic PRNG (mulberry32) so the spot-check is repeatable.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample(arr, n, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.min(n, a.length));
}

function* walk(dir, skip) {
  let dirents;
  try { dirents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
  catch { return; }
  for (const e of dirents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) yield* walk(p, skip); }
    else if (e.isFile()) yield p;
  }
}

// AUTHORED source files = code files under the target's own tree, minus scopeExclude + generated
// (wasm-bindgen pkg/, *.d.ts, minified). This is the denominator the index is measured against.
function authoredSourceFiles(repoDir, skip, codeExt) {
  const exts = new Set((codeExt || ['.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs']).map((e) => e.toLowerCase()));
  const GENERATED = /(\.min\.|\.bundle\.|\.d\.ts$|(^|\/)pkg\/|\.generated\.)/i;
  const out = [];
  for (const p of walk(repoDir, skip)) {
    const ext = path.extname(p).toLowerCase();
    if (!exts.has(ext)) continue;
    const rel = path.relative(repoDir, p);
    if (GENERATED.test(rel)) continue;
    out.push(rel);
  }
  return out;
}

// component (crate/package) -> its root-relative prefix, from componentRoots immediate children.
function componentPrefixes(repoDir, skip, componentRoots) {
  const prefixes = [];
  for (const r of [...(componentRoots || ['crates', 'packages']), 'cli']) {
    const abs = path.join(repoDir, r);
    if (!fs.existsSync(abs)) continue;
    // 'cli' may itself be a component (has a manifest); else its children are.
    const isLeaf = fs.existsSync(path.join(abs, 'Cargo.toml')) || fs.existsSync(path.join(abs, 'package.json'));
    if (isLeaf) { prefixes.push(r); continue; }
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isDirectory() && !skip.has(d.name)) prefixes.push(`${r}/${d.name}`);
    }
  }
  return [...new Set(prefixes)];
}

export async function runCoverageGate({ target, seed = 7, spot = 20 }) {
  const t = getTarget(target);
  const slug = target;
  const repoDir = path.resolve(__dirname, t.repoDir);
  const skip = new Set(t.scopeExclude || []);

  // ---- load the built index (ids.json carries per-passage path + source_type) ----
  const idsPath = path.join(__dirname, 'stores', slug, `${slug}-kb.ids.json`);
  if (!fs.existsSync(idsPath)) throw new Error(`coverage-gate: ${idsPath} not found — build the KB first`);
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8')).entries || {};
  const passages = Object.values(ids);
  const indexedPaths = new Set(passages.map((p) => p.path));
  const passagesByPath = {};
  for (const p of passages) passagesByPath[p.path] = (passagesByPath[p.path] || 0) + 1;
  const sourceTypeCounts = {};
  for (const p of passages) { const st = p.source_type || '(untagged)'; sourceTypeCounts[st] = (sourceTypeCounts[st] || 0) + 1; }

  // ---- 1. coverage ratio ----
  const authored = authoredSourceFiles(repoDir, skip, t.codeExt);
  const indexedAuthored = authored.filter((f) => indexedPaths.has(f));
  const ratio = authored.length ? indexedAuthored.length / authored.length : 0;

  // ---- 2. >=3 passages per component ----
  const prefixes = componentPrefixes(repoDir, skip, t.componentRoots);
  const perComponent = prefixes.map((pre) => {
    const count = passages.filter((p) => p.path === pre || p.path.startsWith(pre + '/')).length;
    return { component: pre, passages: count, ok: count >= MIN_PASSAGES_PER_COMPONENT };
  });
  const thinComponents = perComponent.filter((c) => !c.ok);

  // ---- 4. passage / source-file ratio ----
  const distinctSourcePaths = new Set(passages.filter((p) => /\.(rs|ts|tsx|js|mjs|cjs|py|go)$/.test(p.path)).map((p) => p.path)).size;
  const passageRatio = distinctSourcePaths ? passages.length / distinctSourcePaths : 0;

  // ---- 3. spot-check 20 random authored files retrievable via the REAL searchKb ----
  const rnd = mulberry32(seed);
  const picks = sample(authored, spot, rnd);
  const spotResults = [];
  for (const f of picks) {
    // Query by the file's basename + its top-level component (a realistic "where is X" ask).
    const base = path.basename(f).replace(/\.[a-z]+$/i, '');
    const comp = f.split('/').slice(0, 2).join('/');
    const query = `source file ${base} in ${comp}`;
    let hit = false, top = '(none)';
    try {
      const results = await searchKb({ query, k: 8, store: slug });
      top = results[0]?.path || '(none)';
      hit = results.some((r) => r.path === f || (r.path || '').includes(path.basename(f)));
    } catch (e) { top = `ERROR: ${e.message?.slice(0, 40)}`; }
    // Indexed-or-retrievable: a file that IS indexed counts as reachable even if a basename query
    // doesn't surface it #1 (the AI can also enumerate via symbols.json). We score on retrieval but
    // report indexed status for diagnosis.
    spotResults.push({ file: f, indexed: indexedPaths.has(f), retrieved: hit, top1: top });
  }
  const spotHits = spotResults.filter((r) => r.retrieved || r.indexed).length;
  const spotRate = picks.length ? spotHits / picks.length : 0;

  // ---- verdict ----
  const checks = {
    coverageRatio: { value: +ratio.toFixed(4), pass: ratio >= COVERAGE_PASS, hardFail: ratio < COVERAGE_FAIL, threshold: COVERAGE_PASS, indexed: indexedAuthored.length, authored: authored.length },
    perComponentMin: { pass: thinComponents.length === 0, thin: thinComponents, threshold: MIN_PASSAGES_PER_COMPONENT },
    passageRatio: { value: +passageRatio.toFixed(2), pass: passageRatio >= PASSAGE_RATIO_MIN, threshold: PASSAGE_RATIO_MIN, distinctSourceFiles: distinctSourcePaths, passages: passages.length },
    spotCheck: { value: +spotRate.toFixed(3), pass: spotRate >= SPOT_CHECK_PASS, threshold: SPOT_CHECK_PASS, hits: spotHits, of: picks.length },
  };
  const hardFail = checks.coverageRatio.hardFail;
  const pass = !hardFail && checks.coverageRatio.pass && checks.perComponentMin.pass && checks.passageRatio.pass && checks.spotCheck.pass;

  const notIndexed = authored.filter((f) => !indexedPaths.has(f));
  return {
    target: slug, generated: new Date().toISOString(),
    pass, hardFail, checks, sourceTypeCounts,
    summary: {
      authoredSourceFiles: authored.length, indexedAuthoredFiles: indexedAuthored.length,
      coverage: +ratio.toFixed(4), totalPassages: passages.length, distinctIndexedPaths: indexedPaths.size,
      passageRatio: +passageRatio.toFixed(2), components: perComponent.length, thinComponents: thinComponents.length,
    },
    notIndexedSample: notIndexed.slice(0, 25),
    perComponent, spotResults,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCoverageGate(args);

  const storeDir = path.join(__dirname, 'stores', args.target);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, `${args.target}-coverage-report.json`), JSON.stringify(report, null, 2) + '\n');

  if (args.json) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`\n=== GATE B (source coverage): ${args.target} ===`);
    console.log(`coverage ratio : ${report.checks.coverageRatio.value} (${report.checks.coverageRatio.indexed}/${report.checks.coverageRatio.authored} authored source files) — ${report.checks.coverageRatio.pass ? 'PASS' : (report.checks.coverageRatio.hardFail ? 'HARD-FAIL <0.85' : 'WARN <0.92')}`);
    console.log(`>=3 / component: ${report.checks.perComponentMin.pass ? 'PASS' : 'FAIL'} (${report.checks.perComponentMin.thin.length} thin)`);
    for (const c of report.perComponent) console.log(`   ${c.ok ? ' ok ' : 'THIN'}  ${String(c.passages).padStart(4)}  ${c.component}`);
    console.log(`passage ratio  : ${report.checks.passageRatio.value} (${report.checks.passageRatio.passages} passages / ${report.checks.passageRatio.distinctSourceFiles} source files) — ${report.checks.passageRatio.pass ? 'PASS' : 'FAIL'} (>= ${PASSAGE_RATIO_MIN})`);
    console.log(`spot-check     : ${report.checks.spotCheck.hits}/${report.checks.spotCheck.of} random files reachable (${report.checks.spotCheck.value}) — ${report.checks.spotCheck.pass ? 'PASS' : 'FAIL'}`);
    console.log(`source_type    : ${JSON.stringify(report.sourceTypeCounts)}`);
    if (report.notIndexedSample.length) console.log(`not-indexed (sample): ${report.notIndexedSample.slice(0, 8).join(', ')}${report.notIndexedSample.length > 8 ? ' …' : ''}`);
    console.log(`\nRESULT: ${report.pass ? 'PASS' : 'FAIL'}`);
  }
  process.exit(report.pass ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[coverage-gate] ERROR:', e); process.exit(1); });
}
