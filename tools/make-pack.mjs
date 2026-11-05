#!/usr/bin/env node
// make-pack.mjs — Station 6 (ASSEMBLE + PACK): build the downloadable AI knowledge pack.
//
// One zip: a for-humans primer and a for-ai half (the single-store KB + the kb/ engine that queries it).
//
// CONTRACT (tools/CONTRACT.md):
//   invocation : node tools/make-pack.mjs <build-dir>
//   reads      : <build-dir>/build.json → kb slot, repo.{slug,url,sha,clonePath}
//   writes     : <build-dir>/site/<slug>-knowledge-pack.zip; merges ONLY the `pack` slot ({ zipPath })
//   stdout     : EXACTLY one JSON result object — { ok, outputs, error }; stderr: diagnostics
//   exit code  : 0 iff ok:true
// Fail loud (INV-04): missing inputs, an empty pack, an unregistered store, or a zip that does not open.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOL_DIR, '..');
const KB_DIR = path.join(ROOT, 'kb');
const log = (...a) => console.error(...a);

const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
function must(p) { if (!fs.existsSync(p)) throw new Error(`missing required input: ${p}`); return p; }
const countPassages = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;

/** The pack's kb.config.mjs: ONLY this pack's own store. repoDir is dropped (a build-machine path). */
export function singleStoreConfigSource(slug, target) {
  const { repoDir, ...t } = target;
  return `// kb.config.mjs — the one store in this pack.
export const targets = { ${JSON.stringify(slug)}: ${JSON.stringify(t, null, 2)} };
export const defaultTarget = ${JSON.stringify(slug)};
export function getTarget(slug = defaultTarget) {
  const t = targets[slug];
  if (!t) throw new Error(\`unknown store "\${slug}" — this pack holds only "\${defaultTarget}"\`);
  return t;
}
export default { targets, defaultTarget, getTarget };
`;
}

// Every ./file.mjs the shipped engine files import (transitively) must ride in the zip too.
export function localImportClosure(dir, entries) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = fs.readFileSync(must(path.join(dir, name)), 'utf8');
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)['"]\.\/([\w.-]+\.mjs)['"]/g)) visit(m[1]);
  };
  entries.forEach(visit);
  return [...seen];
}

const gitHead = (dir) => {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
};

export async function buildPack(buildDir) {
  const buildRoot = path.resolve(buildDir);
  const buildJsonPath = must(path.join(buildRoot, 'build.json'));
  const ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
  const slug = ctx?.repo?.slug;
  const kb = ctx?.kb;
  if (!slug) throw new Error('build.json: repo.slug is required (Station 0–1 must have run)');
  if (!kb || !kb.storeDir) throw new Error('build.json: kb.storeDir is required (Station 1 must have run)');

  const storeDir = must(resolveFromRoot(kb.storeDir));

  // for-ai/ KB core (required) and structured indexes (shipped when present)
  const FOR_AI = ['kb.rvf', 'kb.rvf.idmap.json', 'kb.rvf.embed.json', 'kb.passages.jsonl', 'kb.ids.json']
    .map((s) => [path.join(storeDir, `${slug}-${s}`), `for-ai/${slug}-${s}`]);
  const STRUCTURED = ['symbols', 'dep-graph', 'entrypoints']
    .map((s) => [path.join(storeDir, `${slug}-${s}.json`), `for-ai/${slug}-${s}.json`]).filter(([src]) => fs.existsSync(src));
  // the kb/ engine the pack ships (NOT @ruvector/rvf-mcp-server); kb.config.mjs is generated below
  const engine = localImportClosure(KB_DIR, ['ask-kb.mjs', 'kb-mcp-server.mjs', 'resolve-deps.mjs']).filter((f) => f !== 'kb.config.mjs');
  const TOOLS = engine.map((f) => [path.join(KB_DIR, f), `for-ai/${f}`]);
  const primerSrc = must(path.join(storeDir, `${slug}-primer.md`));

  // empty-pack guard: the pack's whole point is a loadable, searchable KB
  const rvfSrc = must(FOR_AI[0][0]);
  const passagesSrc = must(FOR_AI[3][0]);
  if (fs.statSync(rvfSrc).size === 0) throw new Error(`empty pack: ${path.relative(ROOT, rvfSrc)} is zero bytes — no vectors to ship`);
  const passageCount = countPassages(passagesSrc);
  if (passageCount === 0) throw new Error(`empty pack: ${path.relative(ROOT, passagesSrc)} has no passages — search would return nothing`);
  for (const [src] of FOR_AI) must(src);

  // A build registered by kb:register keeps its target in a per-build overlay, not in the tracked config.
  const overlay = path.join(buildRoot, 'kb-targets.overlay.json');
  if (!process.env.KB_TARGET_OVERLAY && fs.existsSync(overlay)) process.env.KB_TARGET_OVERLAY = overlay;
  // the store must be registered in the engine's registry — the pack carries ONLY that entry
  const registry = await import(pathToFileURL(path.join(KB_DIR, 'kb.config.mjs')).href);
  const target = registry.targets[slug];
  if (!target) throw new Error(`kb/kb.config.mjs has no target "${slug}" (known: ${Object.keys(registry.targets).join(', ')}) — the pack cannot be configured`);
  const configSrc = singleStoreConfigSource(slug, target);

  const rootDeps = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {};
  const forAiPkg = {
    name: `${slug}-dropin-kb`, version: '0.1.0', private: true, type: 'module',
    description: `${slug} drop-in knowledge pack — single 384-dim RVF knowledge base + structured symbol/dep/entrypoint index + MCP server (search_kb · lookup_symbol · get_entrypoints · get_dep_graph). Run \`npm i\` then \`node ask-kb.mjs ${slug} "your question"\` or \`node ask-kb.mjs ${slug} --symbol <name>\`.`,
    scripts: { ask: `node ask-kb.mjs ${slug}`, mcp: 'node kb-mcp-server.mjs' },
    dependencies: { '@ruvector/rvf': rootDeps['@ruvector/rvf'], '@xenova/transformers': rootDeps['@xenova/transformers'] },
    engines: { node: '>=18' },
  };

  const forAiNames = [...FOR_AI, ...STRUCTURED, ...TOOLS].map(([, d]) => d.replace('for-ai/', '')).concat(['kb.config.mjs', 'package.json']);
  const has = (s) => (STRUCTURED.some(([, d]) => d.endsWith(`-${s}.json`)) ? `${slug}-${s}.json` : null);
  const sha = ctx.repo.sha || (ctx.repo.clonePath ? gitHead(ctx.repo.clonePath) : null);
  const manifest = {
    name: `${slug}-dropin`,
    builtAt: new Date().toISOString(),
    source: { url: ctx.repo.url || null, sha },
    embedder: kb.embedModel || null,
    passageCount,
    contents: { 'for-ai': forAiNames, 'for-humans': [`${slug}-primer.md`] },
    structured: { symbols: has('symbols'), depGraph: has('dep-graph'), entrypoints: has('entrypoints') },
  };

  // Only the structured indexes that actually ride in the zip (manifest.structured is the truth).
  const STRUCTURED_BLURB = { symbols: 'exact public API: every symbol + signature + doc + location', depGraph: 'component dependency graph (what depends on what)', entrypoints: 'build/test/run commands + binaries' };
  const structuredLines = Object.entries(manifest.structured).filter(([, f]) => f)
    .map(([k, f]) => `    ${f.padEnd(`${slug}-entrypoints.json`.length)}  — ${STRUCTURED_BLURB[k]}\n`).join('');

  const readme = `# ${slug} Drop-in

One zip. Two halves: a for-humans primer and a for-ai searchable knowledge base.

## What's inside

\`\`\`
${slug}-dropin/
  for-humans/   — read first
    ${slug}-primer.md         — top-down orientation: what it is, why, how it works
  for-ai/       — the searchable knowledge pack (wire this into your agent)
    ${slug}-kb.rvf            — single 384-dim vector DB (the "brain")
    ${slug}-kb.passages.jsonl — full passage text (${passageCount} passages; search returns TEXT, not {id,distance})
    ${slug}-kb.ids.json       — id → passage index
${structuredLines}    ask-kb.mjs · kb-mcp-server.mjs · kb.config.mjs · resolve-deps.mjs · package.json
  README.md     — this file
  manifest.json — build metadata
\`\`\`

## Three steps to wire the AI half in
\`\`\`bash
# 1 — unzip + install (two deps, Node 18+)
unzip ${slug}-knowledge-pack.zip && cd ${slug}-dropin/for-ai && npm install

# 2 — ask the brain a question straight away
node ask-kb.mjs ${slug} "what does ${slug} actually do"

# 3 — point your AI host at it with a .mcp.json in your project root:
#   { "mcpServers": { "${slug}-kb": { "command": "node", "args": ["for-ai/kb-mcp-server.mjs"] } } }
\`\`\`

Built with the Repo-Primer recipe (ADR-0001 / ADR-0005).${manifest.embedder ? ` Embedder: ${manifest.embedder}.` : ''}
`;

  const siteDir = path.join(buildRoot, 'site');
  fs.mkdirSync(siteDir, { recursive: true });
  const OUT = path.join(siteDir, `${slug}-knowledge-pack.zip`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `pack-${slug}-`));
  try {
    for (const [src, dst] of [...FOR_AI, ...STRUCTURED, ...TOOLS, [primerSrc, `for-humans/${slug}-primer.md`]]) {
      const d = path.join(stage, dst);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(src, d);
    }
    fs.writeFileSync(path.join(stage, 'for-ai/kb.config.mjs'), configSrc);
    fs.writeFileSync(path.join(stage, 'for-ai/package.json'), JSON.stringify(forAiPkg, null, 2) + '\n');
    fs.writeFileSync(path.join(stage, 'README.md'), readme);
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.rmSync(OUT, { force: true });
    // zip's progress goes to stderr (stdout is the JSON result channel)
    execFileSync('zip', ['-r', '-X', OUT, '.'], { cwd: stage, stdio: ['ignore', process.stderr, process.stderr] });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  // verify the pack OPENS and carries the KB artifacts (never a silent green)
  let listing = '';
  try { listing = execFileSync('unzip', ['-l', OUT], { encoding: 'utf8' }); }
  catch (e) { throw new Error(`pack does not open: unzip -l failed on ${path.relative(ROOT, OUT)} (${e.message})`); }
  const required = [`for-ai/${slug}-kb.rvf`, `for-ai/${slug}-kb.passages.jsonl`, 'for-ai/ask-kb.mjs', 'for-ai/kb-mcp-server.mjs', 'for-ai/kb.config.mjs', `for-humans/${slug}-primer.md`];
  const missing = required.filter((e) => !listing.includes(e));
  if (missing.length) throw new Error(`pack is missing required entries after zip: ${missing.join(', ')}`);

  const pack = { zipPath: OUT };
  const fresh = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
  fresh.pack = pack;
  fs.writeFileSync(buildJsonPath, JSON.stringify(fresh, null, 2) + '\n');

  log(`built ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB) — ${passageCount} passages, ${forAiNames.length} for-ai files`);
  return { zipPath: OUT, pack, passageCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const buildDir = process.argv[2];
    if (!buildDir) throw new Error('usage: node tools/make-pack.mjs <build-dir>');
    const outputs = await buildPack(buildDir);
    process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: err.message }) + '\n');
    log(err.stack || err.message);
    process.exit(1);
  }
}
