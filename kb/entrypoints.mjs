#!/usr/bin/env node
// entrypoints.mjs — GENERIC, config-driven entrypoint/command extractor.
//
// Emits kb/stores/<slug>/<slug>-entrypoints.json: the build/test/run commands + the main
// crates/binaries/packages an AI needs to actually USE a repo. Parsed from Cargo.toml
// (workspace + per-crate [[bin]]/[[example]]), package.json (bin/scripts), and the README
// (fenced shell command lines: cargo/npx/npm/wasm-pack/pnpm/yarn/make/docker).
//
// Repo shape is DATA (kb.config.mjs target: repoDir, scopeExclude, componentRoots). NO repo
// name is baked in here — the same script runs for ruqu / photonlayer / ruvn / metaharness.
//
// This file ships in the drop-in for-ai/ so the AI gets EXACT entrypoint lookups (how do I
// build / test / run / install this) instead of guessing from semantic search.
//
// Usage: node kb/entrypoints.mjs --target ruqu
//        node kb/entrypoints.mjs ruqu

import fs from 'node:fs';
import path from 'node:path';
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

// Walk the target's own tree, honoring scopeExclude (shared convention with build-kb.mjs).
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

// Extract fenced shell command lines that look like real entrypoint commands.
const CMD_RE = /^\s*(?:\$\s*)?((?:cargo|npx|npm|pnpm|yarn|wasm-pack|make|docker|node|deno|bun|python3?|uv|go)\b[^\n#]*)/;
function commandsFromMarkdown(text) {
  const cmds = [];
  // Only look inside fenced code blocks (```...```), where commands live.
  const fences = text.match(/```[\s\S]*?```/g) || [];
  for (const block of fences) {
    for (const rawLine of block.split('\n')) {
      const m = rawLine.match(CMD_RE);
      if (!m) continue;
      const cmd = m[1].replace(/\s+#.*$/, '').trim();   // strip trailing comment
      if (cmd.length < 4) continue;
      // trailing inline comment as a description (after the command, before fences)
      const cmtMatch = rawLine.match(/#\s*(.+?)\s*$/);
      cmds.push({ cmd, note: cmtMatch ? cmtMatch[1].trim() : null });
    }
  }
  return cmds;
}

// Classify a command into a category so an AI can ask "how do I test/build/run/install".
function classify(cmd) {
  if (/\b(test|vitest|jest|cargo test|nextest)\b/.test(cmd)) return 'test';
  if (/\b(build|tsc|wasm-pack build|cargo build|compile)\b/.test(cmd)) return 'build';
  if (/\b(add|install|npm i|npm install|pnpm add|yarn add|cargo add)\b/.test(cmd)) return 'install';
  if (/\b(bench|criterion)\b/.test(cmd)) return 'bench';
  if (/\b(run|simulate|exec|start|dev|serve|doctor|init)\b/.test(cmd) || /^npx /.test(cmd)) return 'run';
  return 'other';
}

// Parse a Cargo.toml for name, [[bin]] and [[example]] targets (cheap line scan; no TOML dep).
function parseCargo(text) {
  const name = (text.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1] || null;
  const desc = (text.match(/^\s*description\s*=\s*"([^"]*)"/m) || [])[1] || null;
  const bins = [];
  const examples = [];
  // [[bin]] / [[example]] blocks: capture the name = "..." within each block.
  for (const m of text.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[|\n*$)/g)) {
    const bn = (m[1].match(/name\s*=\s*"([^"]+)"/) || [])[1];
    if (bn) bins.push(bn);
  }
  for (const m of text.matchAll(/\[\[example\]\]([\s\S]*?)(?=\n\[|\n*$)/g)) {
    const en = (m[1].match(/name\s*=\s*"([^"]+)"/) || [])[1];
    if (en) examples.push(en);
  }
  return { name, desc, bins, examples };
}

function main() {
  const { target: slug } = parseArgs(process.argv.slice(2));
  const target = getTarget(slug);
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) { console.error(`[entrypoints] repoDir not found: ${repoDir}`); process.exit(1); }
  const skip = new Set(target.scopeExclude || []);
  const rel = (p) => path.relative(repoDir, p);

  const out = {
    target: slug,
    metaName: target.metaName,
    generated: new Date().toISOString(),
    repo: target.bundle?.blurb ? undefined : undefined,
    workspace: { kind: null, members: [] }, // rust workspace | npm | mixed
    components: [],          // { name, path, kind:'crate'|'package', description, bins, examples, scripts, deps }
    binaries: [],            // { name, component, path }
    commands: [],            // { cmd, category, source, note }
    install: [],             // dedup'd install commands (convenience subset)
    quickstart: [],          // README "run"-category commands (convenience subset)
  };

  // ---- Rust workspace + per-crate Cargo.toml ----
  const rootCargo = tryRead(path.join(repoDir, 'Cargo.toml'));
  if (rootCargo) {
    out.workspace.kind = 'rust';
    const members = [...rootCargo.matchAll(/members\s*=\s*\[([\s\S]*?)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    out.workspace.members = members;
  }

  // Component roots (e.g. ['crates']) — each immediate child with a manifest is a component.
  const roots = (target.componentRoots && target.componentRoots.length) ? target.componentRoots : ['crates', 'packages'];
  // Always also consider the CLI dir + npm/packages if present (real-world mixed monorepos), AND
  // the repo root '.' so a single-package-at-root repo (ruvn: one top-level package.json with the
  // `bin`, scripts, and deps) is captured as a component too.
  const extraDirs = ['cli', 'npm/packages', 'packages', 'apps', '.'];
  const compDirs = new Set();
  for (const r of [...roots, ...extraDirs]) {
    const abs = path.join(repoDir, r);
    if (!fs.existsSync(abs)) continue;
    // A componentRoot holds child dirs; a leaf like 'cli' may itself be a component.
    const cargoHere = tryRead(path.join(abs, 'Cargo.toml'));
    const pkgHere = tryRead(path.join(abs, 'package.json'));
    if (cargoHere || pkgHere) { compDirs.add(abs); continue; }
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isDirectory() && !skip.has(d.name)) compDirs.add(path.join(abs, d.name));
    }
  }

  for (const cdir of [...compDirs].sort()) {
    const cargo = tryRead(path.join(cdir, 'Cargo.toml'));
    const pkgRaw = tryRead(path.join(cdir, 'package.json'));
    if (cargo) {
      const { name, desc, bins, examples } = parseCargo(cargo);
      out.components.push({ name: name || path.basename(cdir), path: rel(cdir), kind: 'crate', description: desc, bins, examples });
      for (const b of bins) out.binaries.push({ name: b, component: name, path: rel(cdir), kind: 'rust-bin' });
    } else if (pkgRaw) {
      try {
        const j = JSON.parse(pkgRaw);
        const scripts = j.scripts || {};
        const binNames = j.bin ? (typeof j.bin === 'string' ? [j.name] : Object.keys(j.bin)) : [];
        out.components.push({
          name: j.name || path.basename(cdir), path: rel(cdir), kind: 'package',
          description: j.description || null, scripts, bins: binNames,
          deps: Object.keys(j.dependencies || {}),
        });
        for (const b of binNames) out.binaries.push({ name: b, component: j.name, path: rel(cdir), kind: 'npm-bin' });
        for (const [k, v] of Object.entries(scripts)) out.commands.push({ cmd: `npm run ${k}`, raw: v, category: classify(`${k} ${v}`), source: rel(path.join(cdir, 'package.json')), note: null });
      } catch { /* unparseable */ }
    }
  }
  if (out.components.some((c) => c.kind === 'package') && out.components.some((c) => c.kind === 'crate')) out.workspace.kind = 'mixed';
  else if (!out.workspace.kind && out.components.some((c) => c.kind === 'package')) out.workspace.kind = 'npm';

  // ---- README + key docs: real command lines (the AI's quickstart) ----
  const docCandidates = new Set(['README.md', 'cli/README.md', 'docs/README.md', 'docs/USAGE.md', 'docs/QUICKSTART.md', 'CONTRIBUTING.md']);
  // Plus any top-level *.md (cheap, deduped).
  for (const p of walk(repoDir, skip)) {
    if (path.extname(p) === '.md' && rel(p).split('/').length <= 2) docCandidates.add(rel(p));
  }
  const seenCmd = new Set();
  for (const d of docCandidates) {
    const text = tryRead(path.join(repoDir, d));
    if (!text) continue;
    for (const { cmd, note } of commandsFromMarkdown(text)) {
      const key = cmd.toLowerCase();
      if (seenCmd.has(key)) continue;
      seenCmd.add(key);
      out.commands.push({ cmd, category: classify(cmd), source: d, note });
    }
  }

  // Convenience subsets (deduped, first-seen order).
  const seenInstall = new Set(), seenRun = new Set();
  for (const c of out.commands) {
    if (c.category === 'install' && !seenInstall.has(c.cmd)) { seenInstall.add(c.cmd); out.install.push(c.cmd); }
    if (c.category === 'run' && !seenRun.has(c.cmd) && out.quickstart.length < 12) { seenRun.add(c.cmd); out.quickstart.push(c.cmd); }
  }

  // ---- write ----
  const storeDir = path.join(__dirname, 'stores', slug);
  fs.mkdirSync(storeDir, { recursive: true });
  const outFile = path.join(storeDir, `${slug}-entrypoints.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`[entrypoints] ${slug}: ${out.components.length} components, ${out.binaries.length} binaries, ${out.commands.length} commands`);
  console.log(`[entrypoints] install: ${out.install.length} | quickstart(run): ${out.quickstart.length}`);
  console.log(`[entrypoints] wrote ${path.relative(__dirname, outFile)}`);
}

main();
