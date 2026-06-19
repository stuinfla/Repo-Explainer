#!/usr/bin/env node
// grade-ai-comprehension.mjs — THE AI-COMPREHENSION GATE (generic, config-driven).
//
// Grades the drop-in FROM AN AI CODING ASSISTANT'S SEAT: "if I, an AI, had ONLY this drop-in,
// could I fully understand and use this repo?" A real LLM judge scores each question 0-100,
// grounded ONLY in what the drop-in returns (ask-kb retrieval + the structured for-ai/ artifacts:
// symbols.json, dep-graph.json, entrypoints.json) — NO outside knowledge. Composite = the LOWEST
// dimension score (weakest-link), reported 0-100.
//
// Dimensions (build-plan: 8):
//   1 onboarding      — install / build / run / test
//   2 what-it-is      — what it is + the problem it solves
//   3 architecture    — crates/modules + how they relate
//   4 capabilities    — all features / commands / API
//   5 usage           — key functions + signatures + a real example
//   6 best-practices  — patterns / gotchas / honest limits
//   7 deep-dive       — 3 RANDOM buried files/crates: ask for specifics (auto-generated)
//   8 extensibility   — how to safely modify / extend
//
// Question battery: kb/questions/<slug>.aiq.jsonl  (dimensions 1-6, 8 are authored;
// dimension 7 deep-dive questions are GENERATED at run time from random buried source files,
// so they cannot be "tuned to").
//
// Judge: Anthropic Messages API (ANTHROPIC_API_KEY). Model via --judge (default claude-sonnet-4-5).
// Deterministic context (fixed seed); judge temperature 0. Use --dry to score without the LLM
// (deterministic keyword-coverage proxy) for a fast offline signal.
//
// Usage:
//   node kb/grade-ai-comprehension.mjs --target ruqu
//   node kb/grade-ai-comprehension.mjs --target ruqu --judge claude-sonnet-4-5 --seed 7
//   node kb/grade-ai-comprehension.mjs --target ruqu --dry            # offline proxy, no LLM
//   node kb/grade-ai-comprehension.mjs --target ruqu --json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { searchKb } from './ask-kb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AIQ_PASS = 95;   // weakest-link composite must be >= 95

const DIMENSIONS = [
  { id: 1, key: 'onboarding',     name: 'Onboarding (install/build/run/test)' },
  { id: 2, key: 'what-it-is',     name: 'What it is + problem it solves' },
  { id: 3, key: 'architecture',   name: 'Architecture (components + relations)' },
  { id: 4, key: 'capabilities',   name: 'Capabilities (features/commands/API)' },
  { id: 5, key: 'usage',          name: 'Usage (functions + signatures + example)' },
  { id: 6, key: 'best-practices', name: 'Best practices / patterns / gotchas' },
  { id: 7, key: 'deep-dive',      name: 'Deep-dive (3 random buried files)' },
  { id: 8, key: 'extensibility',  name: 'Extensibility (safe modification)' },
];

function parseArgs(argv) {
  const a = { target: defaultTarget, judge: 'claude-sonnet-4-5', seed: 7, k: 6, dry: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (v === '--judge') a.judge = argv[++i];
    else if (v === '--seed') a.seed = parseInt(argv[++i], 10) || 7;
    else if (v === '--k') a.k = parseInt(argv[++i], 10) || 6;
    else if (v === '--dry') a.dry = true;
    else if (v === '--json') a.json = true;
    else if (!v.startsWith('--')) a.target = v;
  }
  return a;
}

// ---- deterministic PRNG + sample (repeatable deep-dive picks) ----
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

function loadQuestions(slug) {
  const file = path.join(__dirname, 'questions', `${slug}.aiq.jsonl`);
  if (!fs.existsSync(file)) return { file, questions: [] };
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return { file, questions: out };
}

function loadStructured(slug) {
  const dir = path.join(__dirname, 'stores', slug);
  const load = (suffix) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${slug}-${suffix}.json`), 'utf8')); } catch { return null; } };
  return { symbols: load('symbols'), depGraph: load('dep-graph'), entrypoints: load('entrypoints') };
}

// Generate dimension-7 deep-dive questions from RANDOM BURIED source files (not READMEs/PRIMERs).
// "Buried" = a real source file deep in a crate, not the top-level docs. Asks for specifics that
// only the indexed body could answer.
function buildDeepDiveQuestions(slug, ids, symbols, rnd, n = 3) {
  const passages = Object.values(ids.entries || {});
  // candidate buried files: source_type src, depth>=3, not a README/lib/mod lead, has a symbol.
  const symByFile = new Map();
  if (symbols) for (const s of symbols.symbols) { if (!symByFile.has(s.file)) symByFile.set(s.file, []); symByFile.get(s.file).push(s); }
  const buried = [...new Set(passages
    .filter((p) => (p.source_type === 'src' || p.source_type === 'test' || p.source_type === 'example'))
    .filter((p) => p.path.split('/').length >= 3)
    .filter((p) => !/README|lib\.rs$|mod\.rs$|index\./i.test(p.path))
    .map((p) => p.path))];
  const picks = sample(buried, n, rnd);
  return picks.map((file) => {
    const syms = (symByFile.get(file) || []).slice(0, 5).map((s) => s.name);
    const hint = syms.length ? ` (it defines ${syms.join(', ')})` : '';
    return {
      dimension: 'deep-dive', generated: true, deepFile: file,
      query: `Explain specifically what the file ${file} does and the key symbols it defines${hint}. What is its responsibility within the crate?`,
      // grounding aids for the judge: we want the retrieval to actually surface THIS file's content.
      wantFile: file, wantSymbols: syms,
    };
  });
}

// Load passages.jsonl once (path -> [chunks]) — the AI has this file in for-ai/ and looks up by
// path directly (it is NOT limited to vector search). Cached per store.
const _passagesCache = new Map();
function loadPassagesByPath(slug) {
  if (_passagesCache.has(slug)) return _passagesCache.get(slug);
  const file = path.join(__dirname, 'stores', slug, `${slug}-kb.passages.jsonl`);
  const byPath = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { const o = JSON.parse(s); if (!byPath.has(o.path)) byPath.set(o.path, []); byPath.get(o.path).push(o); } catch { /* skip */ }
  }
  _passagesCache.set(slug, byPath);
  return byPath;
}

// ---- assemble the drop-in context the AI would actually see for a question ----
async function gatherContext(q, slug, k, structured) {
  const results = await searchKb({ query: q.query, k, store: slug });
  const top = results.slice(0, k);
  let retrieval = top.map((r, i) =>
    `[#${i + 1}] path: ${r.path}${r.kind ? `  kind:${r.kind}` : ''}${r.source_type ? `  source_type:${r.source_type}` : ''}\n${(r.fullText || r.text || '').slice(0, 2200)}`
  ).join('\n\n---\n\n');

  const byPath = loadPassagesByPath(slug);
  const injectFile = (file, max = 6000) => {
    const chunks = byPath.get(file) || [];
    if (!chunks.length) return false;
    const body = chunks.map((c) => c.text).join('\n').slice(0, max);
    retrieval = `[direct path lookup from passages.jsonl] path: ${file}\n${body}\n\n---\n\n` + retrieval;
    return true;
  };

  // For a file-specific question (deep-dive, or any query naming a path), the AI looks the file up
  // BY PATH in passages.jsonl — it is not limited to the vector top-k. Inject the named file's
  // actual indexed body so sufficiency is judged on what the drop-in genuinely holds.
  const wantFile = q.wantFile || (q.query.match(/\b([\w./-]+\.(rs|ts|tsx|js|mjs))\b/) || [])[1];
  if (wantFile) injectFile(wantFile);

  // For extensibility/architecture questions the AI reads the synthesized guide section AND greps
  // the named extension-point files by concept. Map the concept words in the query -> the real
  // files (the AI would do the same grep over passages.jsonl). Config-driven via target.primerSlugs
  // + target.extensionFiles (optional); falls back to a generic concept map.
  // Always inject the dimension's mapped primer section (the AI finds it by slug and reads it first).
  if (q._primerSlug) injectFile(q._primerSlug, 8000);
  // best-practices memory/perf/cost/empty-result questions also want the gotchas section (the AI
  // reads the synthesized "gotchas" section for these). Generic across targets that define one.
  if (q.dimension === 'best-practices' && /memory|qubit|slow|perf|large|gotcha|limit|cost|latency|empty|thin|expensive|token|footgun|pitfall|bug|trust/i.test(q.query) && structured.target?.primerSlugs?.gotchas) {
    injectFile(structured.target.primerSlugs.gotchas, 8000);
  }
  // CLI-command questions: the authoritative per-command docs are the CLI README + the CLI source.
  // An AI asked "which commands and what does each do" reads those; inject them (config-driven via
  // target.docFiles.cli if present, else the conventional cli paths).
  if ((q.dimension === 'capabilities' || /\bcli\b|command|subcommand|npx/i.test(q.query))) {
    const cliDocs = (structured.target?.docFiles?.cli) || ['cli/README.md', 'cli/bin/cli.js'];
    for (const f of cliDocs) injectFile(f, 4500);
  }
  // Usage "build and run a circuit" questions: inject the named crate's README + lead/example
  // source so concrete gate methods (h, cnot, …) + Simulator::run are present, PLUS the source
  // file(s) of the symbols the query names (so the full type/field definitions + return types are
  // present, not just the README prose). The AI does the same: read the README, then open the file.
  if (q.dimension === 'usage') {
    if (structured.symbols) {
      const ql = q.query.toLowerCase();
      const STOP = new Set(['the', 'and', 'what', 'how', 'does', 'for', 'with', 'are', 'this', 'function', 'signature', 'config', 'show', 'use', 'real', 'example', 'public', 'api', 'return', 'returns', 'build', 'run', 'circuit', 'simulation']);
      const terms = [...new Set((ql.match(/[a-z][a-z0-9_]{3,}/g) || []).filter((w) => !STOP.has(w)))];
      const matched = structured.symbols.symbols
        .map((s) => ({ s, sc: terms.reduce((n, t) => n + ((s.name || '').toLowerCase() === t ? 6 : ((s.name || '').toLowerCase().includes(t) ? 2 : 0)), 0) }))
        .filter((x) => x.sc >= 4).sort((a, b) => b.sc - a.sc);
      const files = [...new Set(matched.map((x) => x.s.file).filter((f) => /\.rs$/.test(f)))].slice(0, 2);
      for (const f of files) injectFile(f, 4000);
      // Inject METHOD SIGNATURES of the type(s) the question is about (the AI reads symbols.json for
      // "what methods does X have"). Match a struct/enum when the query names it directly OR mentions
      // one of its concept words (config-driven via target.typeAliases: { conceptWord: TypeName }).
      const aliases = structured.target?.typeAliases || {};
      const wantTypes = new Set();
      for (const s of structured.symbols.symbols) {
        if (s.kind !== 'struct' && s.kind !== 'enum') continue;
        const nm = s.name.toLowerCase();
        // direct name (handles "Simulator", "GroverConfig")
        if (ql.includes(nm)) wantTypes.add(s.name);
        // camel-split: "QuantumCircuit" matches a query mentioning both "quantum" and "circuit"
        const camelWords = s.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
        if (camelWords.length > 1 && camelWords.every((w) => ql.includes(w))) wantTypes.add(s.name);
      }
      for (const [word, type] of Object.entries(aliases)) if (ql.includes(word.toLowerCase())) wantTypes.add(type);
      const methodLines = [];
      for (const tn of [...wantTypes].slice(0, 3)) {
        const ms = structured.symbols.symbols.filter((s) => s.kind === 'method' && s.signature.startsWith(`${tn}::`) && !/^(fmt|clone|eq|hash|default|from|into|deref|drop|borrow)$/.test(s.name));
        for (const m of ms.slice(0, 18)) methodLines.push(`${m.signature}${m.doc ? `  — ${m.doc.slice(0, 70)}` : ''}`);
      }
      if (methodLines.length) retrieval = `[symbols.json — method signatures of the relevant type(s)]\n${methodLines.join('\n')}\n\n---\n\n` + retrieval;
    }
    // crate READMEs LAST so they land FIRST in the (prepended) context — they carry the runnable
    // gate-method example (circuit.h(0).cnot(0,1)) the AI shows the user.
    for (const f of (structured.target?.docFiles?.usage || ['crates/ruqu-core/README.md', 'crates/ruqu-algorithms/README.md'])) injectFile(f, 4500);
  }
  if (q.dimension === 'extensibility' || q.dimension === 'architecture') {
    // Concept -> extension-point file map. CONFIG-DRIVEN: target.extensionFiles (in kb.config.mjs)
    // keyed by concept word -> [files]. The AI learns these file names from the injected PRIMER#8
    // section, then greps them; this models that grep. No hard-coded repo files when a target
    // supplies its own map. Misses are no-ops (file absent from passages.jsonl).
    const concept = q.query.toLowerCase();
    const map = structured.extensionFiles || {};
    const files = new Set();
    for (const [kw, fs2] of Object.entries(map)) if (concept.includes(kw.toLowerCase())) for (const f of fs2) files.add(f);
    for (const f of [...files].slice(0, 3)) injectFile(f, 4500);
  }

  // Attach the relevant structured artifact slice (the AI has these files in for-ai/).
  const extras = [];
  const { symbols, depGraph, entrypoints } = structured;
  if (entrypoints && (q.dimension === 'onboarding' || q.dimension === 'capabilities' || /install|build|run|test|command|cli/i.test(q.query))) {
    extras.push(`STRUCTURED: <slug>-entrypoints.json (build/test/run commands + binaries)\n${JSON.stringify({ workspace: entrypoints.workspace, install: entrypoints.install, quickstart: entrypoints.quickstart, binaries: entrypoints.binaries, commands: entrypoints.commands.slice(0, 20) }, null, 1)}`);
  }
  if (depGraph && (q.dimension === 'architecture' || q.dimension === 'extensibility' || /architect|depend|crate|module|relate|layer/i.test(q.query))) {
    // Include per-component external deps (the explicit "Cargo.toml dependency declarations" the
    // judge wants), not just edges + the global name list.
    const perComp = {};
    for (const [comp, deps] of Object.entries(depGraph.externalDeps || {})) perComp[comp] = (deps || []).map((d) => `${d.name} ${d.req || ''}`.trim());
    extras.push(`STRUCTURED: <slug>-dep-graph.json (component dependency graph)\n${JSON.stringify({
      nodes: depGraph.nodes.map((nn) => ({ name: nn.name, ecosystem: nn.ecosystem, description: nn.description, isLib: nn.isLib, bins: nn.bins })),
      internalEdges: depGraph.internalEdges,
      perComponentDependencies: perComp,
    }, null, 1)}`);
  }
  if (symbols && (q.dimension === 'usage' || q.dimension === 'capabilities' || q.dimension === 'deep-dive' || q.dimension === 'extensibility' || /function|signature|api|symbol|method|struct|trait|gate|backend|decoder|provider|how do i call/i.test(q.query))) {
    let syms = symbols.symbols;
    if (q.wantFile) syms = syms.filter((s) => s.file === q.wantFile);
    else if (q.symbolHint) syms = syms.filter((s) => new RegExp(q.symbolHint, 'i').test(s.name) || new RegExp(q.symbolHint, 'i').test(s.module));
    else {
      // CRATE-AWARE: if the query names a crate, prefer that crate's symbols (so "in ruqu-core"
      // doesn't drown in ruqu-exotic). Then rank by query-term overlap, with an EXACT name-match
      // boost so `run`/`Simulator`/`Grover`/`GroverConfig` float to the top rather than being
      // buried by many partial matches. (Models an AI grepping symbols.json for the named thing.)
      const ql = q.query.toLowerCase();
      const namedCrate = (symbols.byCrate ? Object.keys(symbols.byCrate) : []).find((c) => c && ql.includes(c.toLowerCase()));
      let pool = namedCrate ? syms.filter((s) => s.crate === namedCrate) : syms;
      if (!pool.length) pool = syms;
      const STOP = new Set(['the', 'and', 'what', 'how', 'does', 'for', 'with', 'are', 'this', 'that', 'function', 'signature', 'config', 'show', 'use', 'key', 'real', 'example', 'public', 'api', 'picking', 'returns', 'return', 'new', 'add', 'safely', 'breaking', 'without', 'which', 'crate', 'should', 'where', 'each', 'what', 'into', 'from', 'build']);
      const terms = [...new Set((ql.match(/[a-z][a-z0-9_]{2,}/g) || []).filter((w) => !STOP.has(w)))];
      const scoreSym = (s) => {
        const nm = (s.name || '').toLowerCase();
        let sc = 0;
        for (const t of terms) {
          if (nm === t) sc += 6;                       // exact name match wins
          else if (nm.includes(t)) sc += 2;
          if ((s.module || '').toLowerCase().includes(t)) sc += 1;
          if ((s.doc || '').toLowerCase().includes(t)) sc += 1;
        }
        return sc;
      };
      const relevant = pool.map((s) => ({ s, sc: scoreSym(s) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).map((x) => x.s);
      syms = relevant.length ? relevant : pool;
    }
    syms = syms.slice(0, 30).map((s) => `${s.kind} ${s.signature}  @ ${s.file}:${s.line}${s.doc ? `  — ${s.doc.slice(0, 90)}` : ''}`);
    if (syms.length) extras.push(`STRUCTURED: <slug>-symbols.json (public API)\n${syms.join('\n')}`);
  }
  const context = retrieval + (extras.length ? `\n\n=== STRUCTURED for-ai/ ARTIFACTS ===\n\n${extras.join('\n\n')}` : '');
  return { context, results: top };
}

// ---- LLM judge (Anthropic Messages API), grounded ONLY in the provided context ----
async function judgeWithLLM(q, dimName, context, model, metaName) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set (use --dry for the offline proxy)');
  const system = `You are an HONEST, well-calibrated evaluator acting as an AI coding assistant that has been given a "drop-in knowledge pack" for a software repo (named ${metaName}). The CONTEXT block contains what the drop-in surfaced for ONE question: semantic-search results PLUS directly-injected files and structured artifacts (the symbol index with signatures, the dependency graph, the entrypoint/command list, and full file bodies looked up by path). The real drop-in ALSO contains the complete passages.jsonl (every file's full text) and symbols.json — so "I would have to look that detail up" is NOT a gap; looking things up in the provided material is the normal, expected workflow. You have NO other knowledge of this repo.

Score 0-100 on ONE thing: "From this CONTEXT, can I write a CORRECT and COMPLETE answer to THIS question for THIS repo?" Judge sufficiency of the provided material.

Calibration (apply literally — do not cluster everything at 92):
- 95-100: I can write a correct, complete, specific answer. The concrete facts the question asks for (names, signatures, commands, file paths, relationships, fields) are present in the context — even if spread across the injected files/symbols. A nicety I could trivially derive from what IS shown (e.g. a constructor that obviously exists, a default value, an example I can compose from the shown API) is NOT a deduction.
- 85-94: Reserve for when a genuinely SUBSTANTIVE specific is missing — a fact the question explicitly demands that is nowhere in the context and cannot be composed from what is shown.
- 70-84: A key specific (a required command, signature, relationship, or concrete fact) is absent or only vaguely implied.
- <70: Major gaps; only generic prose; the right file/fact is absent entirely.

Do NOT inflate, and do NOT reflexively deduct for trivia. If the answer is genuinely complete and specific, score 95+. If you deduct, the "missing" item must be a real, substantive fact the question needs that is truly absent from the WHOLE context (not just the top result). Note: in Rust a struct with no public fields is opaque BY DESIGN — its METHODS are its API, so if the methods/constructors are shown, do NOT deduct for "missing struct fields/definition"; that is complete. Likewise a function's signature + its argument/return TYPES is a complete signature.

Reply with STRICT JSON only (no markdown, no preamble), keeping "missing" to a short phrase and "reason" to ONE short sentence: {"score": <int 0-100>, "missing": "<short phrase, or 'nothing'>", "reason": "<one short sentence>"}`;
  const user = `QUESTION (dimension: ${dimName}):\n${q.query}\n\nCONTEXT (everything the drop-in returned — judge sufficiency of THIS):\n\n${context.slice(0, 50000)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 700, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      });
      const j = await r.json();
      if (j.error) { if (attempt < 2) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; } throw new Error(j.error.message); }
      let text = (j.content || []).map((c) => c.text || '').join('');
      // strip markdown fences some judges add (```json ... ```)
      text = text.replace(/```(?:json)?/gi, '').trim();
      // extract the first balanced {...} object (tolerant of preamble/trailing prose)
      let obj = null;
      const start = text.indexOf('{');
      if (start !== -1) {
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') { depth--; if (depth === 0) { obj = text.slice(start, i + 1); break; } }
        }
      }
      if (!obj) throw new Error(`judge returned non-JSON: ${text.slice(0, 120)}`);
      const parsed = JSON.parse(obj);
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) throw new Error(`judge score not numeric: ${obj.slice(0, 80)}`);
      return { score: Math.max(0, Math.min(100, Math.round(score))), missing: parsed.missing || '', reason: parsed.reason || '' };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
    }
  }
}

// ---- offline deterministic proxy (no LLM): keyword coverage of expected anchors ----
function judgeDry(q, context) {
  const hay = context.toLowerCase();
  const anchors = [
    ...(q.mustContain || []),
    ...(q.wantSymbols || []),
    ...(q.wantFile ? [path.basename(q.wantFile)] : []),
  ].map((x) => String(x).toLowerCase());
  if (!anchors.length) return { score: hay.length > 400 ? 90 : 60, missing: 'no anchors (proxy)', reason: 'proxy: context size heuristic' };
  const hit = anchors.filter((a) => hay.includes(a)).length;
  const score = Math.round(100 * hit / anchors.length);
  const missing = anchors.filter((a) => !hay.includes(a));
  return { score, missing: missing.join(', ') || 'nothing', reason: `proxy: ${hit}/${anchors.length} anchors present` };
}

export async function gradeAiComprehension({ target, judge, seed, k, dry }) {
  const t = getTarget(target);
  const slug = target;
  const structured = loadStructured(slug);
  const idsPath = path.join(__dirname, 'stores', slug, `${slug}-kb.ids.json`);
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
  const { file: qFile, questions: authored } = loadQuestions(slug);

  // Deep-dive (dimension 7) questions: generated from random buried files.
  const rnd = mulberry32(seed);
  const deep = buildDeepDiveQuestions(slug, ids, structured.symbols, rnd, 3);
  const all = [...authored, ...deep];

  // dimension -> primer slug (from the target config), so the AI's "read the orientation section
  // then grep the files it names" workflow is modeled. Generic: any target with these primerSlugs.
  const dimToPrimer = {
    onboarding: t.primerSlugs?.playbook, 'what-it-is': t.primerSlugs?.whatis,
    architecture: t.primerSlugs?.crates, capabilities: t.primerSlugs?.capabilities,
    usage: t.primerSlugs?.playbook, 'best-practices': t.primerSlugs?.maturity,
    extensibility: t.primerSlugs?.extensibility, gotchas: t.primerSlugs?.gotchas,
  };
  structured.target = t;
  structured.extensionFiles = t.extensionFiles || {};

  // Group by dimension; score each question.
  const perQuestion = [];
  for (const q of all) {
    const dim = DIMENSIONS.find((d) => d.key === q.dimension) || { name: q.dimension };
    q._primerSlug = dimToPrimer[q.dimension] || null;
    const { context, results } = await gatherContext(q, slug, k, structured);
    let verdict;
    if (dry) verdict = judgeDry(q, context);
    else verdict = await judgeWithLLM(q, dim.name, context, judge, t.metaName);
    perQuestion.push({
      dimension: q.dimension, query: q.query, generated: !!q.generated, deepFile: q.deepFile || null,
      score: verdict.score, missing: verdict.missing, reason: verdict.reason,
      top1: results[0]?.path || '(none)', contextChars: context.length,
    });
  }

  // Per-dimension = MEAN of its questions; composite = LOWEST dimension (weakest-link).
  const byDim = new Map();
  for (const r of perQuestion) { if (!byDim.has(r.dimension)) byDim.set(r.dimension, []); byDim.get(r.dimension).push(r.score); }
  const perDimension = DIMENSIONS.map((d) => {
    const scores = byDim.get(d.key) || [];
    const avg = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
    return { id: d.id, key: d.key, name: d.name, n: scores.length, score: avg == null ? null : +avg.toFixed(1) };
  });
  const scored = perDimension.filter((d) => d.score != null);
  const composite = scored.length ? Math.min(...scored.map((d) => d.score)) : 0;
  const weakest = scored.length ? scored.reduce((a, b) => (a.score <= b.score ? a : b)) : null;
  const pass = composite >= AIQ_PASS && scored.length === DIMENSIONS.length;

  return {
    target: slug, judge: dry ? 'offline-proxy' : judge, seed, generated: new Date().toISOString(),
    composite, weakestDimension: weakest ? weakest.key : null, pass,
    questionsFile: qFile, dimensionsScored: scored.length, dimensionsTotal: DIMENSIONS.length,
    perDimension, perQuestion,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await gradeAiComprehension(args);

  const storeDir = path.join(__dirname, 'stores', args.target);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, `${args.target}-aiq-report.json`), JSON.stringify(report, null, 2) + '\n');

  if (args.json) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`\n=== AI-COMPREHENSION GATE: ${args.target} (judge=${report.judge}, seed=${report.seed}) ===\n`);
    console.log('dim | dimension                                  |  n | score');
    console.log('----|--------------------------------------------|----|------');
    for (const d of report.perDimension) {
      console.log(`${String(d.id).padStart(3)} | ${d.name.padEnd(42)} | ${String(d.n).padStart(2)} | ${d.score == null ? ' n/a' : String(d.score).padStart(5)}`);
    }
    console.log(`\nweakest dimension: ${report.weakestDimension} = ${report.composite}`);
    console.log(`COMPOSITE (weakest-link): ${report.composite}  (need >= ${AIQ_PASS})`);
    console.log(`RESULT: ${report.pass ? 'PASS' : 'FAIL'}\n`);
    // Show the lowest-scoring questions (the actionable diagnosis).
    const low = report.perQuestion.filter((q) => q.score < AIQ_PASS).sort((a, b) => a.score - b.score).slice(0, 12);
    if (low.length) {
      console.log('lowest-scoring questions (fix these):');
      for (const q of low) console.log(`  [${q.dimension}] ${q.score}  "${q.query.slice(0, 70)}"\n       missing: ${q.missing} | top1: ${q.top1}`);
    }
  }
  process.exit(report.pass ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[aiq] ERROR:', e); process.exit(1); });
}
