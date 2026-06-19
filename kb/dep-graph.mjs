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

// ---------------- TS/JS: import scan + package.json ----------------
const IMPORT_RE = /(?:import\s[^'"]*from\s*|import\s*|require\(\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/g;
function tsGraph(repoDir, skip, componentRoots) {
  // discover packages under componentRoots (+ cli/apps) AND the repo root itself ('.'), so a
  // single-package-at-root repo (e.g. ruvn: one package.json at the top, no packages/ dir) is
  // discovered too — not just a multi-package monorepo.
  const pkgDirs = [];
  for (const r of [...(componentRoots || ['packages']), 'cli', 'apps', 'npm/packages', '.']) {
    const abs = path.join(repoDir, r);
    if (!fs.existsSync(abs)) continue;
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

main();
