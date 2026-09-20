#!/usr/bin/env node
// dep-graph.mjs — GENERIC, config-driven dependency-graph extractor.
//
// Emits kb/stores/<slug>/<slug>-dep-graph.json: how the repo's components depend on each other
// + their external deps. An AI uses this to reason about layering / blast-radius before editing.
//
// Strategy:
//   Rust:  `cargo metadata --format-version 1` → workspace crate graph (internal edges between
//          workspace members + each crate's external dependencies).
//   TS/JS: import scan of the source tree (no madge dependency required) → module/package graph
//          (internal edges between componentRoots packages via workspace imports + external deps
//          from each package.json).
//   Python: pyproject.toml workspace/member discovery + import scan → package dependency graph.
//           This matters for repos such as the-goodies: treating an unsupported ecosystem as an
//           empty graph used to force an authored list into a nested-box renderer, which looked like
//           random concentric boxes rather than architecture.
//
// Repo shape is DATA (kb.config.mjs target: repoDir, scopeExclude, componentRoots). Ships in the
// drop-in for-ai/. NO repo name is baked in here.
//
// Usage: node kb/dep-graph.mjs --target ruqu  | node kb/dep-graph.mjs ruqu

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTarget, defaultTarget } from './kb.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { target: defaultTarget };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (!v.startsWith('--')) a.target = v;
  }
  return a;
}

const tryRead = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

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

// ---------------- Rust: cargo metadata ----------------
function rustGraph(repoDir) {
  let raw;
  try {
    raw = execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'],
      { cwd: repoDir, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }).toString();
  } catch (e) {
    return { ok: false, reason: `cargo metadata failed: ${e.message?.slice(0, 80)}` };
  }
  const m = JSON.parse(raw);
  const wsNames = new Set(m.packages.map((p) => p.name));
  const nodes = [];
  const internalEdges = [];   // { from, to }  (workspace member -> workspace member)
  const externalDeps = {};    // pkg -> [ {name, req, kind} ] (non-workspace)
  for (const p of m.packages) {
    const targets = (p.targets || []).map((t) => ({ name: t.name, kinds: t.kind }));
    nodes.push({
      name: p.name, version: p.version, description: p.description || null,
      manifest: path.relative(repoDir, p.manifest_path),
      targets,
      isLib: (p.targets || []).some((t) => t.kind.includes('lib')),
      bins: (p.targets || []).filter((t) => t.kind.includes('bin')).map((t) => t.name),
    });
    const ext = [];
    for (const d of p.dependencies || []) {
      if (wsNames.has(d.name)) internalEdges.push({ from: p.name, to: d.name, kind: d.kind || 'normal' });
      else ext.push({ name: d.name, req: d.req, kind: d.kind || 'normal' });
    }
    externalDeps[p.name] = ext;
  }
  // unique external deps across the workspace
  const allExternal = [...new Set(Object.values(externalDeps).flat().map((d) => d.name))].sort();
  return { ok: true, ecosystem: 'rust', nodes, internalEdges, externalDeps, externalDepNames: allExternal };
}

// ---------------- Python: pyproject.toml + import scan ----------------
// Deliberately small TOML reader: we only need [project].name and its dependencies array. Keeping
// this extractor dependency-free makes it usable in the hosted runner before target code is installed.
function pyProject(file) {
  const text = tryRead(file); if (!text) return null;
  const project = (text.match(/^\[project\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m) || [])[1];
  if (!project) return null;
  const name = (project.match(/^name\s*=\s*["']([^"']+)["']/m) || [])[1];
  if (!name) return null;
  const depsBlock = (project.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m) || [])[1] || '';
  const deps = [...depsBlock.matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^"']*\])?[^"']*["']/g)].map((m) => m[1]);
  return { name, deps };
}
const pyNorm = (s) => String(s).toLowerCase().replace(/[-.]+/g, '_');
export function pyGraph(repoDir, skip = new Set(), componentRoots = []) {
  const roots = [...new Set([...(componentRoots || []), '.'])];
  // Also inspect one level down. Python workspaces commonly keep each member at the root without a
  // shared packages/ directory (the-goodies: funkygibbon/, inbetweenies/, blowing-off/, oook/).
  try { for (const d of fs.readdirSync(repoDir, { withFileTypes: true })) if (d.isDirectory() && !skip.has(d.name)) roots.push(d.name); } catch {}
  const projects = [];
  for (const r of [...new Set(roots)]) {
    const dir = path.resolve(repoDir, r); const manifest = path.join(dir, 'pyproject.toml');
    if (!fs.existsSync(manifest)) continue;
    const meta = pyProject(manifest); if (meta) projects.push({ ...meta, dir, manifest });
  }
  // A root pyproject in a multi-member workspace is usually a development aggregator, not a runtime
  // component. Draw the members and their real edges; keep the root only for a single-package repo.
  const members = projects.filter((p) => path.resolve(p.dir) !== path.resolve(repoDir));
  const shown = members.length ? members : projects;
  if (!shown.length) return { ok: false, reason: 'no Python projects found' };
  const nodes = shown.map((p) => ({ name: p.name, version: null, description: null,
    manifest: path.relative(repoDir, p.manifest), deps: p.deps }));
  const aliases = new Map();
  for (const p of shown) {
    aliases.set(pyNorm(p.name), p.name);
    // Distribution names can differ from import names (blowing-off -> blowingoff). Learn actual
    // top-level package directories as aliases rather than guessing only from punctuation.
    try { for (const d of fs.readdirSync(p.dir, { withFileTypes: true })) if (d.isDirectory() && fs.existsSync(path.join(p.dir, d.name, '__init__.py'))) aliases.set(pyNorm(d.name), p.name); } catch {}
    if (fs.existsSync(path.join(p.dir, '__init__.py'))) aliases.set(pyNorm(path.basename(p.dir)), p.name);
  }
  const internalEdges = [], seen = new Set(), externalDeps = {};
  const addEdge = (from, to, kind) => { if (!to || from === to) return; const k = `${from}->${to}`; if (!seen.has(k)) { seen.add(k); internalEdges.push({ from, to, kind }); } };
  for (const p of shown) {
    externalDeps[p.name] = [];
    for (const d of p.deps) { const to = aliases.get(pyNorm(d)); if (to) addEdge(p.name, to, 'dependency'); else externalDeps[p.name].push({ name: d, req: '*', kind: 'normal' }); }
    for (const file of walk(p.dir, skip)) {
      if (!/\.py$/.test(file)) continue; const text = tryRead(file); if (!text) continue;
      for (const m of text.matchAll(/^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/gm)) {
        const top = (m[1] || m[2]).split('.')[0]; addEdge(p.name, aliases.get(pyNorm(top)), 'import');
      }
    }
  }
  const externalDepNames = [...new Set(Object.values(externalDeps).flat().map((d) => d.name))].sort();
  return { ok: true, ecosystem: 'python', nodes, internalEdges, externalDeps, externalDepNames };
}

// ---------------- TS/JS: import scan + package.json ----------------
const IMPORT_RE = /(?:import\s[^'"]*from\s*|import\s*|require\(\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/g;
function tsGraph(repoDir, skip, componentRoots) {
  // discover packages under componentRoots (+ cli/apps) AND the repo root itself ('.'), so a
  // single-package-at-root repo (e.g. ruvn: one package.json at the top, no packages/ dir) is
  // discovered too — not just a multi-package monorepo.
  const pkgDirs = [];
  for (const r of [...(componentRoots || ['packages']), 'cli', 'apps', 'npm/packages', '.']) {
    const abs = path.join(repoDir, r);
    // componentRoots can be AI-authored (kb:register) and may name a FILE (execa's "index.js"
    // crashed readdirSync here, run 28666874765) — only directories are scannable roots.
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    if (fs.existsSync(path.join(abs, 'package.json'))) { pkgDirs.push(abs); continue; }
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isDirectory() && !skip.has(d.name) && fs.existsSync(path.join(abs, d.name, 'package.json'))) pkgDirs.push(path.join(abs, d.name));
    }
  }
  const nodes = [];
  const nameToDir = new Map();
  for (const dir of pkgDirs) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      nodes.push({ name: j.name || path.basename(dir), version: j.version, description: j.description || null, manifest: path.relative(repoDir, path.join(dir, 'package.json')), deps: Object.keys(j.dependencies || {}) });
      if (j.name) nameToDir.set(j.name, dir);
    } catch { /* skip */ }
  }
  const wsNames = new Set(nodes.map((n) => n.name));
  const internalEdges = [];
  const externalDeps = {};
  const seenEdge = new Set();
  for (const n of nodes) {
    externalDeps[n.name] = (n.deps || []).filter((d) => !wsNames.has(d)).map((d) => ({ name: d, req: '*', kind: 'normal' }));
    for (const d of n.deps || []) {
      if (wsNames.has(d)) { const k = `${n.name}->${d}`; if (!seenEdge.has(k)) { seenEdge.add(k); internalEdges.push({ from: n.name, to: d, kind: 'normal' }); } }
    }
  }
  // Also scan source imports of workspace package names (covers monorepos without explicit deps).
  for (const [pkgName, dir] of nameToDir) {
    for (const p of walk(dir, skip)) {
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(p)) continue;
      const text = tryRead(p); if (!text) continue;
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1];
        for (const w of wsNames) {
          if (w !== pkgName && (spec === w || spec.startsWith(w + '/'))) {
            const k = `${pkgName}->${w}`;
            if (!seenEdge.has(k)) { seenEdge.add(k); internalEdges.push({ from: pkgName, to: w, kind: 'import' }); }
          }
        }
      }
    }
  }
  const allExternal = [...new Set(Object.values(externalDeps).flat().map((d) => d.name))].sort();
  return { ok: true, ecosystem: 'npm', nodes, internalEdges, externalDeps, externalDepNames: allExternal };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = getTarget(args.target);
  const slug = args.target;
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) { console.error(`[dep-graph] repoDir not found: ${repoDir}`); process.exit(1); }
  const skip = new Set(target.scopeExclude || []);

  const graphs = [];
  if (tryRead(path.join(repoDir, 'Cargo.toml'))) {
    const g = rustGraph(repoDir);
    if (g.ok) graphs.push(g); else console.warn(`[dep-graph] ${g.reason}`);
  }
  // npm graph too (mixed monorepos like ruqu have BOTH a Cargo workspace + a cli/ package).
  // Honor the target's componentRoots and the repo root ('.') so a single-package-at-root repo
  // (ruvn: just a top-level package.json) flips hasNpm, not only the conventional monorepo dirs.
  const npmRoots = [...new Set([...(target.componentRoots || []), 'packages', 'cli', 'apps', 'npm/packages', '.'])];
  const hasNpm = npmRoots.some((r) => {
    const abs = path.join(repoDir, r);
    return fs.existsSync(abs) && (fs.existsSync(path.join(abs, 'package.json')) ||
      (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).some((d) => { try { return fs.existsSync(path.join(abs, d, 'package.json')); } catch { return false; } })));
  });
  if (hasNpm) { const g = tsGraph(repoDir, skip, target.componentRoots); if (g.ok && g.nodes.length) graphs.push(g); }
  const hasPython = fs.existsSync(path.join(repoDir, 'pyproject.toml'))
    || (() => { try { return fs.readdirSync(repoDir, { withFileTypes: true }).some((d) => d.isDirectory() && !skip.has(d.name) && fs.existsSync(path.join(repoDir, d.name, 'pyproject.toml'))); } catch { return false; } })();
  if (hasPython) { const g = pyGraph(repoDir, skip, target.componentRoots); if (g.ok && g.nodes.length) graphs.push(g); else console.warn(`[dep-graph] ${g.reason}`); }

  // Merge ecosystems into one report.
  const nodes = graphs.flatMap((g) => g.nodes.map((n) => ({ ...n, ecosystem: g.ecosystem })));
  const internalEdges = graphs.flatMap((g) => g.internalEdges);
  const externalDeps = Object.assign({}, ...graphs.map((g) => g.externalDeps));
  const externalDepNames = [...new Set(graphs.flatMap((g) => g.externalDepNames))].sort();

  const out = {
    target: slug, metaName: target.metaName, generated: new Date().toISOString(),
    ecosystems: graphs.map((g) => g.ecosystem),
    componentCount: nodes.length, internalEdgeCount: internalEdges.length, externalDepCount: externalDepNames.length,
    nodes, internalEdges, externalDeps, externalDepNames,
  };
  const storeDir = path.join(__dirname, 'stores', slug);
  fs.mkdirSync(storeDir, { recursive: true });
  const outFile = path.join(storeDir, `${slug}-dep-graph.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`[dep-graph] ${slug}: ${nodes.length} components, ${internalEdges.length} internal edges, ${externalDepNames.length} external deps (${out.ecosystems.join('+')})`);
  console.log(`[dep-graph] wrote ${path.relative(__dirname, outFile)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
