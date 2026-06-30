#!/usr/bin/env node
// build-kb.mjs — Station 1 (UNDERSTAND): build the REAL RVF KB + structured extraction.
//
// Thin wrapper over the existing, already-working kb/ engine (ADR-0005 D3). It runs, in order:
//   1. kb/build-kb.mjs       --target <slug>  -> the real RVF store (HNSW, local 384-dim embeds)
//   2. kb/extract-symbols.mjs        <slug>   -> <slug>-symbols.json     (public API surface)
//   3. kb/dep-graph.mjs              <slug>    -> <slug>-dep-graph.json   (component/dep graph)
//   4. kb/entrypoints.mjs           <slug>     -> <slug>-entrypoints.json (build/test/run commands)
// (2–4 feed the INV-18 architecture + flow diagrams and the Station-6 pack. The authored primer
// and its index-primer step are a later, brain-owned deliverable — NOT this tool's job.)
//
// Uniform tool convention (tools/CONTRACT.md §b): `node tools/build-kb.mjs <build-dir>`.
//   reads  : <build-dir>/build.json -> repo.slug, repo.clonePath, repo.name
//   writes : the `understanding` + `kb` slots; the real store files under kb/stores/<slug>/
//   stdout : exactly ONE JSON result object; child engine output is routed to stderr; exit 0 iff ok.
//
// PURE: reads only its declared build.json slice + its own freshly-produced outputs. FAIL LOUD: a
// failed RVF build, a missing/empty store, or a non-canonical .small.rvf (a missing `embed` block)
// all stop non-zero with a clear reason — NEVER a JSON-only fallback (INV-06) and never a placeholder.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));   // tools/
const REPO_ROOT = path.resolve(__dirname, '..');                 // Ruv-Explainer/
const KB_DIR = path.join(REPO_ROOT, 'kb');

// ---------- uniform result protocol ----------
function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(error) { console.error(`[build-kb] FAIL: ${error}`); emit({ ok: false, outputs: {}, error }); process.exit(1); }
function done(outputs) { emit({ ok: true, outputs, error: null }); process.exit(0); }

// Run a kb/ engine script; child stdout + stderr are routed to OUR stderr (fd 2) so our stdout
// stays a single clean JSON object. A non-zero child exit throws -> we fail loud.
// extraEnv is merged into process.env — used to forward KB_REPO_DIR so all scripts index the
// correct build-dir clone instead of the hardcoded repoDir in kb/kb.config.mjs (Blocker-1 fix).
function runKbScript(script, args, timeout, extraEnv = {}) {
  const scriptPath = path.join(KB_DIR, script);
  if (!fs.existsSync(scriptPath)) fail(`kb engine script missing: ${path.relative(REPO_ROOT, scriptPath)}`);
  console.error(`[build-kb] run: node kb/${script} ${args.join(' ')}`);
  try {
    execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 2, 2], timeout, maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const why = e && e.signal ? `timed out / killed (${e.signal})` : `exit ${e && e.status}`;
    fail(`kb/${script} failed for target "${args[args.length - 1]}" (${why}) — is the target registered in kb/kb.config.mjs with an \`embed\` block? (repoDir forwarded via KB_REPO_DIR: ${extraEnv.KB_REPO_DIR || 'not set'}) (${e && e.message ? e.message.split('\n')[0] : ''})`);
  }
}

function countJsonlLines(file) {
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) n++;
  return n;
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function main() {
  const buildDir = process.argv[2];
  if (!buildDir) fail('usage: node tools/build-kb.mjs <build-dir>  (missing build dir argument)');
  const buildJsonPath = path.join(path.resolve(buildDir), 'build.json');
  if (!fs.existsSync(buildJsonPath)) fail(`build.json not found at ${buildJsonPath} — run clone-repo first`);

  let ctx;
  try { ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); }
  catch (e) { fail(`build.json is not valid JSON: ${e.message}`); }

  const slug = ctx?.repo?.slug;
  const clonePath = ctx?.repo?.clonePath;
  const repoName = ctx?.repo?.name || slug;
  if (!slug) fail('build.json has no repo.slug — run clone-repo first');
  if (!clonePath || !fs.existsSync(clonePath) || !fs.statSync(clonePath).isDirectory()) {
    fail(`repo.clonePath is missing or not a directory: ${clonePath} — run clone-repo first`);
  }

  // ---- run the real kb/ engine (build first, then the three structured extractors) ----
  // Forward clonePath via KB_REPO_DIR so all four scripts index THIS build dir's clone,
  // not the hardcoded repoDir in kb/kb.config.mjs (CONTRACT §b build-dir guarantee, Blocker-1 fix).
  const kbEnv = { KB_REPO_DIR: clonePath };
  runKbScript('build-kb.mjs', ['--target', slug], 1_200_000, kbEnv);   // embeds every chunk; allow time
  runKbScript('extract-symbols.mjs', [slug], 600_000, kbEnv);           // rustdoc-json can be slow
  runKbScript('dep-graph.mjs', [slug], 300_000, kbEnv);
  runKbScript('entrypoints.mjs', [slug], 300_000, kbEnv);

  // ---- verify the real outputs exist (no fake KB, no silent partial) ----
  const storeDir = path.join(KB_DIR, 'stores', slug);
  const f = {
    rvf: path.join(storeDir, `${slug}-kb.rvf`),
    smallRvf: path.join(storeDir, `${slug}-kb.small.rvf`),
    passages: path.join(storeDir, `${slug}-kb.passages.jsonl`),
    ids: path.join(storeDir, `${slug}-kb.ids.json`),
    symbols: path.join(storeDir, `${slug}-symbols.json`),
    depGraph: path.join(storeDir, `${slug}-dep-graph.json`),
    entrypoints: path.join(storeDir, `${slug}-entrypoints.json`),
  };

  if (!fs.existsSync(f.rvf)) {
    if (fs.existsSync(f.smallRvf)) {
      fail(`build-kb wrote ${slug}-kb.small.rvf instead of the canonical ${slug}-kb.rvf — the target "${slug}" is missing an \`embed\` block in kb/kb.config.mjs (ADR-0005 D3). make-pack globs <slug>-kb.rvf and cannot find a .small.rvf store.`);
    }
    fail(`RVF build produced no store at ${path.relative(REPO_ROOT, f.rvf)} — the real KB build failed (INV-06: no JSON fallback)`);
  }
  for (const [key, file] of [['passages', f.passages], ['ids', f.ids], ['symbols', f.symbols], ['dep-graph', f.depGraph], ['entrypoints', f.entrypoints]]) {
    if (!fs.existsSync(file)) fail(`expected ${key} output missing: ${path.relative(REPO_ROOT, file)} — structured extraction did not complete`);
  }

  // ---- passageCount > 0 (INV-06) ----
  let passageCount;
  try { passageCount = countJsonlLines(f.passages); }
  catch (e) { fail(`could not read passages file ${path.relative(REPO_ROOT, f.passages)}: ${e.message}`); }
  if (!(passageCount > 0)) fail(`KB has ${passageCount} passages — an empty corpus is not a real KB (INV-06)`);

  // ---- embed model: read the sidecar the engine wrote next to the canonical .rvf ----
  const embedCfg = readJsonSafe(`${f.rvf}.embed.json`);
  const embedModel = (embedCfg && embedCfg.model) || 'Xenova/bge-small-en-v1.5';
  if (!embedCfg) console.error(`[build-kb] warning: no ${slug}-kb.rvf.embed.json sidecar; reporting default embedModel ${embedModel}`);

  // ---- mechanical (non-judgment) facts for the understanding slot ----
  const dep = readJsonSafe(f.depGraph) || {};
  const sym = readJsonSafe(f.symbols) || {};
  const ent = readJsonSafe(f.entrypoints) || {};
  const ecosystems = Array.isArray(dep.ecosystems) && dep.ecosystems.length ? dep.ecosystems.join('+') : 'unknown';
  const componentCount = typeof dep.componentCount === 'number' ? dep.componentCount : (Array.isArray(dep.nodes) ? dep.nodes.length : 0);
  const symbolCount = typeof sym.count === 'number' ? sym.count : (Array.isArray(sym.symbols) ? sym.symbols.length : 0);
  const commandCount = Array.isArray(ent.commands) ? ent.commands.length : 0;
  const summary = `${repoName} — ${ecosystems} repository indexed into a 384-dim RVF knowledge base: `
    + `${passageCount} passages, ${componentCount} components, ${symbolCount} public symbols, ${commandCount} entrypoint commands.`;

  // ---- assemble the two slots; paths are repo-root-relative (matching CONTRACT §a) ----
  const rel = (p) => path.relative(REPO_ROOT, p);
  const understanding = { repoName, summary, passageCount };
  const kb = {
    slug,
    storeDir: rel(storeDir),
    rvfPath: rel(f.rvf),
    passagesPath: rel(f.passages),
    idsPath: rel(f.ids),
    embedModel,
    primerPath: rel(path.join(storeDir, `${slug}-primer.md`)),   // authored later by the brain (S1)
    symbolsPath: rel(f.symbols),
    depGraphPath: rel(f.depGraph),
    entrypointsPath: rel(f.entrypoints),
  };

  ctx.understanding = { ...(ctx.understanding || {}), ...understanding };
  ctx.kb = { ...(ctx.kb || {}), ...kb };
  try { fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n'); }
  catch (e) { fail(`could not write build.json: ${e.message}`); }

  console.error(`[build-kb] OK ${slug}: ${passageCount} passages, ${symbolCount} symbols, ${componentCount} components (${ecosystems})`);
  done({ slot: ['understanding', 'kb'], understanding, kb, passageCount });
}

main();
