#!/usr/bin/env node
// ask-kb.mjs — self-contained CLI to query a Cognitum RVF knowledge base and print
// the FULL top-k passages (not previews). Joins .rvf vector hits to the full-text
// passages sidecar (.passages.jsonl) by id.
//
// Usage:
//   node kb/ask-kb.mjs <store-slug> "your question" [k]   (store slugs come from kb.config.mjs)
//
// Deps: @ruvector/rvf + @xenova/transformers (resolved PORTABLY — see resolve-deps.mjs:
// project node_modules first, then RVF_MODULE_PATH/XENOVA_PATH env, then author Mac paths)
// + the bundled kb/*.rvf and kb/*.passages.jsonl files. So `cd kb && npm i` then run.
// Model cache is configurable via KB_MODEL_CACHE (offline if cached, else downloads MiniLM
// from HuggingFace — works on a fresh machine).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel } from './resolve-deps.mjs';
import { targets as CONFIG_TARGETS, defaultTarget as CONFIG_DEFAULT } from './kb.config.mjs';

const { mod: rvfMod, via: rvfVia } = loadRvf();
const { RvfDatabase } = rvfMod;
if (process.env.KB_DEBUG) console.error(`[ask-kb] @ruvector/rvf via: ${rvfVia}`);

const __filename = fileURLToPath(import.meta.url); // decodes %20 etc.
const KB_DIR = path.dirname(__filename);

// ===================================================================================
// CONFIG BRIDGE — per-store config is read from kb.config.mjs (NO hard-coded repo names).
// Everything the intent/rerank layer needs that used to be a hard-coded ruvector/ruview map is
// now derived here from the target entry: metaName, productNames, componentRoots, componentWord,
// disambiguation, offtopicMagnets, primerSlugs (auto = discovered from the live sidecar at query
// time). knownStore() replaces the hard-coded `store !== 'ruvector' && store !== 'ruview'` checks.
// ===================================================================================
const KNOWN_STORES = new Set(Object.keys(CONFIG_TARGETS));
function knownStore(store) { return KNOWN_STORES.has(store); }
function cfgFor(store) { return CONFIG_TARGETS[store] || null; }

// componentWord synonym group (e.g. ['crate','package','module','component']) — injected into the
// intent regexes so an npm-package repo (packages/<name>) fires the same routes a crate repo did.
function componentWords(store) {
  const t = cfgFor(store);
  const w = (t && t.componentWord && t.componentWord.length) ? t.componentWord : ['crate', 'package', 'module', 'component'];
  return w.map((x) => String(x).toLowerCase());
}
// Regex alternation of the component words, e.g. (?:crate|package|module|component).
function componentWordAlt(store) {
  return `(?:${componentWords(store).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
}
// componentRoots (e.g. ['packages'] or ['crates']) — the directory segment(s) that hold components.
// A component path looks like `<root>/<name>` (optionally under a `vN/` prefix, legacy crates case).
function componentRoots(store) {
  const t = cfgFor(store);
  return (t && t.componentRoots && t.componentRoots.length) ? t.componentRoots : ['crates', 'packages'];
}
// Build a regex SOURCE that matches `(?:vN/)?<root>/<NAME>` for the store's componentRoots, with the
// component-name capture being `nameSrc` (caller supplies a literal token or a generic name pattern).
function componentPrefixSrc(store, nameSrc) {
  const rootsAlt = componentRoots(store).map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return `(?:^|/)(?:v\\d+/)?(?:${rootsAlt})/${nameSrc}`;
}
// A regex testing whether `path` lives inside a SPECIFIC named component (token may itself be a
// prefix, e.g. "ruvector-core" matches "crates/ruvector-core/..." or "packages/ruvector-core/...").
function inComponentRe(store, token) {
  const tok = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(componentPrefixSrc(store, `${tok}(?:-[a-z0-9-]+)?/`), 'i');
}
// The product-name matcher for a store, built from config.productNames (escaped, word-ish bounded).
// Used by isProductOverviewQuery / conceptNouns. Falls back to the store slug.
function productNameRe(store) {
  const t = cfgFor(store);
  const names = (t && t.productNames && t.productNames.length) ? t.productNames : [store];
  const alt = names
    .map((n) => String(n).trim())
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?'))
    .sort((a, b) => b.length - a.length)        // longest-first so "create-agent-harness" beats a prefix
    .join('|');
  return new RegExp(`\\b(?:${alt})\\b`, 'i');
}

// ---------- variant-aware store resolution ----------
// Two builds ship per repo (same passages, different embedder):
//   small (384-dim MiniLM)  — the Seed-compatible default; files: <store>-kb.rvf
//   big   (768-dim bge)     — sharper, for Mac/PC;        files: <store>-kb.big.rvf
// One tool serves both: the embedder for a query is read from the <rvf>.embed.json
// sidecar the build wrote next to each .rvf, so the query is always embedded with the
// SAME model the corpus was. Absent that sidecar we fall back to MiniLM (the small build).
const MINILM_CFG = { model: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean', normalize: true, queryPrefix: '' };

// KB data files live in kb/stores/<store>/ when organized that way (clear, per-repo), and
// fall back to a flat kb/ layout otherwise (bundles unzip flat). One rule, both layouts.
function storeDir(store) {
  const sub = path.join(KB_DIR, 'stores', store);
  return fs.existsSync(sub) ? sub : KB_DIR;
}

function variantPaths(store, variant) {
  const dir = storeDir(store);
  const base = path.join(dir, `${store}-kb`);
  // metadata sidecar (per-path `kind`): the generic builder writes *.ids.json; legacy stores used
  // *.meta.json. Prefer ids.json, fall back to the legacy name when only it exists. (No repo baked in.)
  const idsName = `${store}-kb.ids.json`;
  const legacyName = `${store}-kb.meta.json`;
  const metaFile = fs.existsSync(path.join(dir, idsName)) ? idsName
    : (fs.existsSync(path.join(dir, legacyName)) ? legacyName : idsName);
  // BOTH versions are explicitly named: .big.rvf (768-dim) and .small.rvf (384-dim).
  // passages + metadata are SHARED (un-tagged) — built once, used by both.
  const tag = variant === 'big' ? '.big' : '.small';
  const rvf = `${base}${tag}.rvf`;
  return {
    rvf,
    passages: `${base}.passages.jsonl`,
    meta: path.join(dir, metaFile),
    embedCfgPath: `${rvf}.embed.json`,
  };
}

// Resolve the file set + embedder config for a (store, variant). variant defaults to
// 'big' when a big build is present (best answers), else 'small' — so a fresh checkout
// with only the Seed build still works, and a Mac bundle auto-uses the sharp one.
function resolveConf(store, variant) {
  if (!knownStore(store)) throw new Error(`unknown store: ${store} (use ${[...KNOWN_STORES].join('|')})`);
  if (variant !== 'big' && variant !== 'small') {
    variant = fs.existsSync(path.join(storeDir(store), `${store}-kb.big.rvf`)) ? 'big' : 'small';
  }
  const p = variantPaths(store, variant);
  // The big variant indexes the SAME passages/metadata as the small build (only the embedder
  // differs), so a bundle ships ONE copy. If the big-tagged sidecars are absent, fall back to
  // the small (untagged) ones — same content, ~115 MB smaller download per repo.
  if (variant === 'big') {
    const small = variantPaths(store, 'small');
    if (!fs.existsSync(p.passages)) p.passages = small.passages;
    if (!fs.existsSync(p.meta)) p.meta = small.meta;
  }
  let embedCfg = { ...MINILM_CFG };
  if (fs.existsSync(p.embedCfgPath)) {
    try { embedCfg = { ...MINILM_CFG, ...JSON.parse(fs.readFileSync(p.embedCfgPath, 'utf8')) }; }
    catch (e) { if (process.env.KB_DEBUG) console.error(`[ask-kb] bad embed.json (${p.embedCfgPath}): ${e.message}`); }
  }
  return { ...p, embedCfg, variant };
}

// ---------- embedder (lazy, per-model, offline-first with remote fallback) ----------
// Cached per model name so a single process can serve both the small (MiniLM) and big
// (bge) builds without reloading. Remote download is allowed only when THAT model isn't
// already cached locally (so a Seed-only box never reaches for the network).
const _feCache = new Map();
async function getEmbedder(model) {
  if (_feCache.has(model)) return _feCache.get(model);
  const { T, modelCache, via } = await loadTransformers();
  T.env.localModelPath = modelCache;
  T.env.allowRemoteModels = !fs.existsSync(path.join(modelCache, model));
  if (process.env.KB_DEBUG) {
    console.error(`[ask-kb] transformers via: ${via} | model ${model} | cache: ${modelCache} `
      + `(${T.env.allowRemoteModels ? 'remote download' : 'local'})`);
  }
  const fe = await T.pipeline('feature-extraction', model, { quantized: true });
  _feCache.set(model, fe);
  return fe;
}

// Embed a QUERY with the build's embedder config. bge-style builds carry a queryPrefix
// (asymmetric retrieval — passages were embedded with NO prefix at build time, queries
// get the instruction prefix here); MiniLM uses no prefix and mean pooling.
async function embed(text, cfg = MINILM_CFG) {
  const fe = await getEmbedder(cfg.model || MINILM_CFG.model);
  const out = await fe([(cfg.queryPrefix || '') + text], {
    pooling: cfg.pooling || 'mean',
    normalize: cfg.normalize !== false,
  });
  return Float32Array.from(out.data);
}

// ---------- passages sidecar loader ----------
// Returns { byId, byPath } where:
//   byId   : Map id(str) -> { id(num), text, path, title }
//   byPath : Map path     -> [ {id,text,...}, ... ] sorted by numeric id (== chunk order)
// Numeric id order reconstructs document chunk order: the builder assigns ids sequentially
// while walking a document, so a path's chunks are id-ordered (verified on both KBs).
function loadPassages(file) {
  return new Promise((resolve, reject) => {
    const byId = new Map();
    const byPath = new Map();
    if (!fs.existsSync(file)) return reject(new Error(`passages sidecar not found: ${file}`));
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const o = JSON.parse(line);
        const rec = { id: Number(o.id), text: o.text || '', path: o.path || '(unknown path)', title: o.title || '(unknown title)' };
        byId.set(String(o.id), rec);
        if (!byPath.has(rec.path)) byPath.set(rec.path, []);
        byPath.get(rec.path).push(rec);
      } catch { /* skip malformed line */ }
    });
    rl.on('close', () => {
      for (const arr of byPath.values()) arr.sort((a, b) => a.id - b.id);
      resolve({ byId, byPath });
    });
    rl.on('error', reject);
  });
}

// ---------- kind metadata sidecar loader ----------
// The passages sidecar (.passages.jsonl) carries only {id,text,path,title}. The per-chunk
// `kind` (source / crate-src / adr / doc / doc-deep / primer-orientation / …) lives in the
// build metadata sidecar (.ids.json / .meta.json) keyed by the SAME numeric id. The intent
// layer (code-vs-doc routing, ADR-vs-code pairing, PRIMER detection) needs `kind`, so we load
// it once and fold it down to a per-PATH kind. If the sidecar is missing the layer degrades
// gracefully (kind unknown -> no kind-based adjustments; vector+rerank still works).
function loadKinds(file) {
  const byPathKind = new Map(); // path -> representative kind (the doc's dominant content kind)
  try {
    if (!file || !fs.existsSync(file)) return byPathKind;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = j.entries || {};
    const counts = new Map(); // path -> Map(kind -> n)
    for (const v of Object.values(entries)) {
      if (!v || !v.path || !v.kind) continue;
      if (!counts.has(v.path)) counts.set(v.path, new Map());
      const m = counts.get(v.path);
      m.set(v.kind, (m.get(v.kind) || 0) + 1);
    }
    for (const [p, m] of counts) {
      let best = null, bestN = -1;
      for (const [kind, n] of m) { if (n > bestN) { best = kind; bestN = n; } }
      byPathKind.set(p, best);
    }
  } catch { /* sidecar unreadable -> empty map, graceful degrade */ }
  return byPathKind;
}

// A path is "source code" if its dominant kind is a code kind.
const SOURCE_KINDS = new Set(['source', 'crate-src', 'example']);
function isSourceKind(kind) { return SOURCE_KINDS.has(kind); }

// ===================================================================================
// SPECIFIC-ENTITY DETECTION (FIX 1 — orientation over-fire). A query that names a SPECIFIC
// entity (a crate, an ADR id, a filename/.rs token, or a Capitalized multiword proper noun)
// is NOT a generic product-orientation question, even if it begins "what does …". For such a
// query we suppress the generic PRIMER-orientation lift AND demote primer-orientation docs so a
// vector-closer deep doc (source / adr / crate-src / doc) wins. The crate-INVENTORY archetype
// ("which crates make up X") is handled separately (it carries no hyphen-crate token) and still
// routes to the inventory PRIMER.
// ===================================================================================

// Build the set of component-style path prefixes actually present in the KB (data-driven, so the
// detector never fires on a generic hyphenated word like "end-to-end" — only on real components).
// Prefixes are taken from the store's componentRoots segments (e.g. `packages/<name>` for AHG,
// `crates/<name>` / `v2/crates/<name>` for a Rust monorepo) — NO hard-coded root name.
function crateTokenSet(byPath, store) {
  const set = new Set();
  const re = new RegExp(componentPrefixSrc(store, '([a-z0-9][a-z0-9-]+)'), 'i');
  for (const p of byPath.keys()) {
    const m = p.match(re);
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

// A capitalized multiword proper noun, e.g. "Coherent Human Channel" / "RuvSense Domain".
const PROPER_NOUN_RE = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,})\b/g;
// A file / .rs token, e.g. "lib.rs", "main.rs", "versioning.rs", "config.toml".
const FILE_TOKEN_RE = /\b[a-z0-9_]+\.(rs|toml|md|ts|js|mjs|py|json|yaml|yml)\b/i;
// Common English / orientation words that may appear Title-Cased ("How Complete Is RuVector",
// "Getting Started Guide") — a proper-noun candidate built ONLY from these is NOT a named entity, so
// Title-Cased orientation queries still route correctly. (The product name is also a common word, so
// "RuVector"/"RuView" alone in a Title-Cased orientation query doesn't count as a specific entity.)
const COMMON_TITLE_WORDS = new Set(['how','what','when','where','why','which','who','is','are','the','a','an',
  'and','or','of','to','in','for','on','with','do','does','complete','mature','maturity','production',
  'ready','overview','introduction','getting','started','start','guide','setup','install','use','using',
  'core','capabilities','capability','feature','features','concept','concepts','docs','documentation',
  'tutorial','tutorials','example','examples','crate','crates','inventory','about','it','this','that',
  'ruvector','ruview','playbook','quickstart','end','reference',
  // Product feature names / host names that appear capitalized in orientation queries but do NOT
  // indicate a specific-entity deep-dive (MetaHarness orientation queries often say "Darwin Mode",
  // "Claude Code", "Rust Core", "Mode", "Claude", "Code", "Layer" etc. — treat as orientation terms).
  'darwin','mode','claude','code','harness','metaharness','layer','layers','surface','rust','rust core',
  'host','hosts','adapter','adapters','kernel','wizard','composer','scaffold','stage','stages','genome',
  'router','factory','framework','model','wrapper','account','server','threat','scan','posture']);

// Does the query name a SPECIFIC entity? Returns the matched hyphen-crate token(s) (lowercased)
// plus a boolean. Used to (a) suppress generic orientation lift, (b) demote primer-orientation,
// (c) drive the crate-overview README/BENCHMARK boost (FIX 2).
function specificEntity(query, crateTokens) {
  const hyphenTokens = (query.match(/\b[a-z][a-z0-9]+-[a-z0-9][a-z0-9-]*\b/gi) || [])
    .map((t) => t.toLowerCase());
  // Keep only hyphen tokens that ARE a known crate (or a known crate's prefix) — this excludes
  // generic words like "end-to-end", "step-by-step", "real-time" while catching "ruvector-snapshot".
  const crates = hyphenTokens.filter((t) =>
    crateTokens.has(t) || [...crateTokens].some((c) => c.startsWith(t + '-') || t.startsWith(c)));
  // A Title-Cased multiword phrase counts as a proper noun ONLY if it contains a token that is NOT a
  // common English/orientation word (so "How Complete Is RuVector" / "Getting Started Guide" do NOT
  // misfire, but "Coherent Human Channel" / "Tauri Desktop Frontend" do).
  let hasProperNoun = false;
  for (const m of query.matchAll(PROPER_NOUN_RE)) {
    const toks = m[1].split(/\s+/);
    if (toks.some((w) => !COMMON_TITLE_WORDS.has(w.toLowerCase()))) { hasProperNoun = true; break; }
  }
  const hasAdr  = /\badr[-\s_]?\d{1,4}\b/i.test(query);
  const hasFile = FILE_TOKEN_RE.test(query);
  const named = crates.length > 0 || hasAdr || hasFile || hasProperNoun;
  return { named, crates };
}

// Demotion penalty added to a primer-orientation doc when the query names a specific entity.
// Pushes primer-orientation BELOW source/adr/crate-src/doc for that query (FIX 1). Large enough to
// out-weigh the (now-suppressed) generic lift but applied as a positive penalty on eff distance.
const PRIMER_DEMOTE_WHEN_SPECIFIC = 0.60;

// ===================================================================================
// Retrieval-quality layer (retrieval-only; KBs are NOT rebuilt).
// FIX 1 whole-document return, FIX 2 demote low-signal files,
// FIX 3 exact-term/ADR/title boost, FIX 4 "Cognitum Seed" disambiguation.
// ===================================================================================

const MAX_DOC_CHARS = 12000;            // cap for an assembled full document
// Chunks fetched from the vector index to group into documents and rerank. Kept generous so the
// small TOP-DOWN ORIENTATION LAYER (a few dozen `PRIMER#` section chunks) reliably enters the
// candidate pool for orientation queries — a tiny synthesized section can sit just outside a
// narrow window yet be the correct whole-document answer once reranked (FIX 5). Reranking is
// order-stable for the closest deep docs, so widening does not disturb non-orientation results.
const RAW_HITS = 96;

// FIX 2 — low-signal path patterns and the query keyword that *re-enables* each.
// A penalty is added to a doc's effective distance UNLESS the query mentions the kind.
const LOW_SIGNAL = [
  { re: /(^|\/)readme[^/]*$/i,                       pen: 0.18, allow: /\breadme\b/i },
  { re: /-checklist\.md$/i,                          pen: 0.15, allow: /\bchecklist\b/i },
  { re: /overview[^/]*\.md$/i,                       pen: 0.10, allow: /\boverview\b/i },     // TOC / link-list pages
  { re: /(^|\/)(index|toc|table-of-contents)[^/]*\.md$/i, pen: 0.10, allow: /\b(index|toc|contents)\b/i },
  { re: /(^|\/)archive\//i,                          pen: 0.20, allow: /\barchiv/i },
  { re: /(^|\/)examples?\/.*\.rs$/i,                 pen: 0.18, allow: /\bexamples?\b/i },
  { re: /(^|\/)benches?\//i,                         pen: 0.22, allow: /\b(bench|benchmark)/i },
  { re: /(^|\/)tests?\//i,                           pen: 0.16, allow: /\btest/i },
  { re: /(_test\.rs|\.test\.[jt]s|_spec\.rb)$/i,    pen: 0.16, allow: /\btest/i },
];

// FIX 4 — "Cognitum Seed" product disambiguation. When the query is about the Seed
// product/onboarding, bias toward onboarding/Seed docs and away from RNG/pretraining seeds.
const SEED_QUERY_RE = /\b(cognitum\s+seed|seed\s+(onboard\w*|pipeline|product)|onboard\w*\s+seed)\b/i;
const SEED_GOOD_RE  = /(adr[-_]?069|adr[-_]?116|(^|\/)seed|onboard|(^|\/)cog-)/i;
const SEED_BAD_RE   = /(rng|random|pretrain|nvsim|prng|np\.random|torch\.manual_seed)/i;

// FIX 5 — TOP-DOWN ORIENTATION LAYER. The primers are indexed as synthetic `PRIMER#<section>`
// documents (kind 'primer-orientation') that synthesize the answers to the six comprehension-
// journey archetypes a raw repo lacks: what-is-it / concepts / how-each-works / maturity /
// where-are-the-docs / how-to-use-end-to-end. When a query is one of those top-down orientation
// questions, bias toward the matching PRIMER section so the SYNTHESIZED answer wins over a deep
// ADR/source fragment. Deep ADR/source still wins for narrow how-X-works questions (no orient cue).
const PRIMER_PATH_RE = /^PRIMER#/;
// Generic orientation cue: the query is asking to be oriented to the product as a whole.
const ORIENT_QUERY_RE = new RegExp([
  'what\\s+(is|are|does)\\b',                       // "what is X" / "what does X do" / "what are the concepts"
  '\\bwhat\\s+can\\b',
  '\\bcore\\s+(capabilit|concept|feature)',          // "core capabilities/concepts"
  '\\bcapabilit(y|ies)\\b',
  '\\bhow\\s+(mature|complete)\\b',                  // maturity archetype
  '\\b(production|experimental)\\b',
  '\\bwhat\\s+works\\b',
  '\\bwhere\\s+(is|are)\\b.*\\b(doc|documentation|adr)', // docs/ADR-location archetype
  '\\bdocumentation\\b.*\\badr',
  '\\badr\\s+index\\b',
  '\\b(install|set\\s*up|setup|use)\\b.*\\bend[\\s-]*to[\\s-]*end\\b', // end-to-end usage
  '\\bend[\\s-]*to[\\s-]*end\\b',
  '\\bget(ting)?\\s+started\\b',
  '\\boverview\\b',
].join('|'), 'i');

// Archetype → words that, when present in BOTH the query and a PRIMER section's title/path, mean
// THIS section is the better-routed orientation answer (e.g. "where are the ADRs" -> the section
// titled "ADR index"). Used to nudge between competing PRIMER sections so the closest-titled one
// wins, without overriding the generic orientation lift. Each matched cue adds a small extra boost.
const PRIMER_ROUTE_CUES = [
  { q: /\b(adr|decision\s+record)/i,                        sec: /\badr\b|decision/i,                       w: 0.20 },
  { q: /\b(doc|documentation)/i,                            sec: /\bdoc|where everything lives|tutorial/i,  w: 0.10 },
  { q: /\b(mature|maturity|complete|production|experimental|works|graded|honest)/i, sec: /matur|gotcha|graded|honest|complete/i, w: 0.18 },
  { q: /\b(capabilit|concept|feature)/i,                    sec: /capabilit|concept|crate inventory|big/i,  w: 0.16 },
  { q: /\b(install|set\s*up|setup|quickstart|get\s*started|use|end[\s-]*to[\s-]*end|playbook)/i, sec: /executive summary|install|quickstart|playbook|knowledge base|use it/i, w: 0.14 },
  { q: /\b(crate|inventory)/i,                              sec: /crate inventory|inventory/i,              w: 0.16 },
];

// Returns a NON-NEGATIVE amount to SUBTRACT from a PRIMER document's effective distance when the
// query is an orientation question. The generic lift makes the synthesized layer beat a vector-
// closer deep doc; the route cues then nudge between PRIMER sections toward the best-titled one.
// Gentle enough that a clearly-better deep match still wins for narrow how-X-works questions.
function orientationBoost(query, path, title = '', suppressGeneric = false) {
  if (!PRIMER_PATH_RE.test(path)) return 0;
  // For a concept what-is query the generic orientation lift is suppressed: we do NOT want every
  // PRIMER (especially the thin product blurb) lifted over the real defining doc. Only the targeted
  // route cues (if any) apply. (FIX 1)
  const generic = suppressGeneric ? 0 : (ORIENT_QUERY_RE.test(query) ? 0.55 : 0.12);
  let route = 0;
  const hay = `${path} ${title}`;
  for (const c of PRIMER_ROUTE_CUES) {
    if (c.q.test(query) && c.sec.test(hay)) route += c.w;
  }
  return generic + route;
}

// ===================================================================================
// INTENT ROUTING LAYER (the second structural fix). MiniLM collapses every top-down
// "orientation" query onto the generic "what X is" PRIMER section, and implementation
// queries don't reliably surface code. This adds DETERMINISTIC intent classification on
// top of the vector+rerank pipeline: it (a) detects an orientation archetype and force-routes
// to the matching PRIMER#<slug> for that store, (b) hard-routes an exact "ADR-NNN" query to
// the real ADR document (beating the index table), (c) tilts ranking toward code or toward
// design docs by intent, and (d) guarantees an ADR proposal is paired with its built source.
// All of this is layered as effective-distance adjustments / hard rank overrides — no rebuild.
// ===================================================================================

// Per-store map of orientation archetype -> the EXACT PRIMER# slug that answers it. Slugs were
// discovered from the live sidecars (grep 'PRIMER#…' on the ids/meta files); only real slugs are
// listed. `adr` is the docs-location archetype's ADR-specific sub-target (the ADR index table).
// Legacy hard-coded PRIMER slug maps are kept ONLY as a fallback for the prototype stores so an old
// ruvector/ruview KB still routes; new targets supply slugs via config (an explicit per-archetype
// map) or use primerSlugs:'auto' (slugs discovered from the live sidecar at query time — see
// resolvePrimerSlug). NO new repo names are added here.
const LEGACY_PRIMER_SLUGS = {
  ruvector: {
    maturity:     'PRIMER#8-maturity-gotchas',
    capabilities: 'PRIMER#2-the-big-capabilities-and-how-to-actually-call-them',
    docs:         'PRIMER#5-docs-tutorials-examples-skills',
    adr:          'PRIMER#4-adr-index-the-complete-table-208-main-series-files-in-docs-adr-54-in-4-sub-ser',
    playbook:     'PRIMER#0-executive-summary-which-crate-do-i-need',
    whatis:       'PRIMER#1-what-ruvector-is',
    crates:       'PRIMER#3-complete-crate-inventory',
    hardware:     null,
    glossary:     null,
  },
  ruview: {
    maturity:     'PRIMER#7-capabilities-graded-honestly',
    capabilities: 'PRIMER#7-capabilities-graded-honestly',
    docs:         'PRIMER#9-docs-tutorials-scripts-firmware-where-everything-lives',
    adr:          'PRIMER#8-the-complete-adr-index-160-adr-numbered-files-156-unique-numbers',
    playbook:     'PRIMER#0-1-instant-playbooks-task-exact-steps',
    whatis:       'PRIMER#1-what-ruview-is',
    crates:       'PRIMER#3-the-crates-v2-workspace-39-incl-the-ruv-neural-git-submodule-and-homecore-plug',
    hardware:     'PRIMER#10-hardware-matrix',
    glossary:     'PRIMER#0-3-glossary-so-terms-are-never-guessed',
  },
};

// Keyword cues per archetype used by 'auto' slug discovery (matched against a PRIMER#<slug> path).
// First section whose slug matches the archetype's cues wins; whatis prefers an early "what-is"/#1.
const AUTO_SLUG_CUES = {
  whatis:       [/what[-\s]?is/i, /#?1[-\b]/i, /overview/i, /introduction/i],
  capabilities: [/capabilit/i, /feature/i, /what.*can/i],
  crates:       [/inventory/i, /package/i, /crate/i, /module/i, /component/i],
  maturity:     [/matur/i, /gotcha/i, /graded/i, /honest/i, /production/i, /limit/i],
  docs:         [/docs?/i, /where.*live/i, /tutorial/i, /reference/i],
  adr:          [/\badr\b/i, /decision/i, /index/i],
  playbook:     [/playbook/i, /quickstart/i, /get[-\s]?started/i, /executive/i, /usage/i, /how[-\s]?to/i],
  hardware:     [/hardware/i, /board/i, /device/i],
  glossary:     [/glossary/i, /terms/i],
};

// Resolve the PRIMER#<slug> for an archetype, store, and the live sidecar paths.
//   1. explicit config map (target.primerSlugs is an object): use it.
//   2. legacy hard-coded map (ruvector/ruview): use it.
//   3. 'auto' (or anything else): discover from byPath PRIMER#… keys via AUTO_SLUG_CUES.
function resolvePrimerSlug(archetype, store, byPath) {
  if (!archetype) return null;
  const t = cfgFor(store);
  const ps = t && t.primerSlugs;
  if (ps && typeof ps === 'object') return ps[archetype] ?? null;
  if (LEGACY_PRIMER_SLUGS[store]) return LEGACY_PRIMER_SLUGS[store][archetype] ?? null;
  // 'auto' discovery from the live sidecar.
  const cues = AUTO_SLUG_CUES[archetype];
  if (!cues || !byPath) return null;
  const primerPaths = [...byPath.keys()].filter((p) => PRIMER_PATH_RE.test(p)).sort();
  for (const p of primerPaths) {
    if (cues.some((re) => re.test(p))) return p;
  }
  return null;
}

// The store's PRODUCT NAME matcher, built from config.productNames (see productNameRe above). A
// what-is/concept query naming ONLY the product (no other concrete concept noun) is a product
// overview -> force-route to the "what X is" primer; a query carrying a concrete concept noun is
// NOT a product overview -> let vector+rerank find the DEFINING doc.
const _productReCache = new Map();
function productRe(store) {
  if (!_productReCache.has(store)) _productReCache.set(store, productNameRe(store));
  return _productReCache.get(store);
}

// Archetype detectors, ORDERED most-specific-first (first match wins). Each regex tests the raw
// query. Patterns mirror the spec's intent buckets. `adr` is folded into `docs` but additionally
// flips the docs target to the ADR-index slug when the query is specifically about ADRs.
const ARCHETYPE_RES = [
  // maturity / production-readiness / "how good/solid/reliable" / works-today-vs-experiment /
  // host counts / release status / should-I / which-are-newer / what-is-NOT.
  // NOTE: "not a" is intentionally NARROW — only specific maturity-context negations to avoid
  // catching "why is it called a factory and NOT a framework" (a whatis query).
  // The \bNOT[?!]?\s*$ tail catches "What is metaharness NOT?" (query ends in NOT + punctuation).
  { name: 'maturity', re: /(\b(mature|maturity|production[- ]?ready|production\b|how (good|solid|reliable|complete)|how complete|is it (ready|done|complete)|works?\b.*\b(experiment|stub|today|yet)|ready for production|battle[- ]?tested|graded honestly|how many\b.*(stable|newer|addition|host)|which\b.*(stable|newer|addition)|release status|release pipeline|what release|not a (?:chatbot|no[- ]code|hosted service|fine[- ]?tune)|should i assert|fixed test count|honest limits|posture\b|default[- ]deny)\b|\bNOT[?!]?\s*$)/i },
  // capabilities / features / "what can it do" / tool actions / sub-commands / specific tools
  // (score, genome, mcp-scan, threat-model, Darwin Mode, router, execute, cost, npm audit).
  // Capabilities BEFORE composer/crates so "What does Darwin Mode do" / "What does genome report"
  // / "What is the npm audit for agent tools command" routes here, not to whatis or composer.
  { name: 'capabilities', re: /\b(capabilit(y|ies)|what can (it|the tool) do|what can ruv\w+ do|features?\b|what does it (do|offer)|what does ruv\w+ (do|offer)|big (capabilities|features)|does\b.*\bexecute\b|ever execute|how does\b.*\bcut\b|how (do i |to )?score\b|genome\b.*\breport|what does\b.*(genome|darwin|threat[- ]?model|mcp[- ]scan|router|mode) (do|report|produce)|what artifact\b|what can the\b|\bgenome\b|\bdarwin mode\b|mcp[- ]scan\b|threat[- ]model\b|npm audit\b|audit for agent\b)\b/i },
  // docs / tutorials / examples / ADRs / "where do I find/read" / "which doc covers/gives/lives" /
  // "where is X described/documented". BEFORE composer and crates so "where is the composer 9-stage
  // flow documented" / "where is the three-layer model described" route to docs (PRIMER#6), not
  // composer (PRIMER#4) or crates (PRIMER#3).
  { name: 'docs', re: /\b(where (are|is|can i find|do i find|do i read).*(doc|documentation|tutorial|example|adr|guide|find|live|architecture|exist|why|described|documented)|documentation\b|tutorials?\b|list of adrs?|adr index|where everything lives|where.*\b(docs?|guides?)\b|which doc\b|where is.*\b(documented|described)\b|where does.*live\b|read[- ]in[- ]order\b|adr (series|index)\b|plain[- ]language usage\b)\b/i },
  // composer / scaffold stages / overlays / HarnessChoice / template selection — PRIMER#4.
  // "scaffold" only matches when NOT preceded by "one-liner" or "show" (those are playbook).
  // "composer" without "where" context to avoid catching "where is the composer flow documented".
  { name: 'composer', re: /\b(how does\b.*\b(composer\b.*scaffold|scaffold\b.*\bharness)\b|how many stages\b|template overlays?\b|overlay\b.*merge|merge\b.*overlay|default agents?\b|default skills?\b|harnesschoice\b|which (composer )?stage\b|toggles? kernel\b|7[- ]arc\b|teaching outline\b|last\b.*\bstage\b|stage\b.*\bgeneration\b|primitives\b.*\btoggle\b|9 stages?\b|what object drives\b|drives template\b)\b/i },
  // hardware / boards / devices — enumeration of supported physical hardware
  { name: 'hardware', re: /\b(hardware|boards?|devices?|which (chip|board|sensor)|supported (hardware|board|device))\b/i },
  // component inventory — enumeration of the components that make up the workspace / a domain.
  // NOTE: this static entry only covers the literal "crate" word; the store-aware
  // componentInventoryRe(store) (injected with the componentWord synonym group: crate|package|
  // module|component) is checked FIRST in classifyArchetype so an npm-package repo fires too.
  // Broadened to also catch: "what are the layers", "which host adapter packages", subsystems,
  // kernel boundary, which packages (surface/layer), model router package, kernel subsystems.
  // "three-layer" is excluded here (handled by docs) for "where is the three-layer model described".
  { name: 'crates', re: /\b(which crates|crate inventory|what crates|crates (that |which )?(make up|in|for|comprise)|list of crates|\w+ domain crates|what are the (layers?|three layers?|subsystems?|adapters?)\b|which (host |adapter )?(packages?|adapters?)\b|kernel (boundary|subsystems?)\b|what is (in |the )?the kernel\b|what is the kernel\b|subsystems? (bundled|in)\b|surface layer\b|user[- ]facing (surface|layer|packages?)\b|model router (package|component)\b)\b/i },
  // playbook / setup / onboarding / end-to-end usage / wizard / publish / scaffold health /
  // fastest-path / one-liner / after-scaffolding / own-files / release-gate.
  { name: 'playbook', re: /\b(how (do i |to )?(use|set ?up|onboard|get started|getting started|start|deploy|build|run|publish|check|generate)|end[- ]to[- ]end|end to end|quick ?start|playbook|walkthrough|step[- ]by[- ]step|get up and running|wizard\b|what does the wizard\b|fastest path\b|one[- ]liner\b|after scaffolding\b|own the files\b|what command\b.*\brelease\b|release gate\b|scaffold is healthy\b|harness doctor\b|harness validate\b|publish my harness\b|what do my users run\b|users run\b)\b/i },
  // what-is / overview / introduce / what-does-produce / is-X-a-Y / why-called / do-I-need.
  // "not another" catches "not another agent framework" (product identity). "why.*factory|framework"
  // catches "why is it called a factory and not a framework" without matching generic maturity.
  { name: 'whatis', re: /\b(what is|what'?s |overview of|introduce|introduction to|tell me about|difference between|role of|what does\b.*\b(produce|turn|make into|forbid|mean)\b|is\b.*\b(model|wrapper|framework|factory|account|server)\b|why (is it|called|a factory)\b|do i need\b|in one line\b|called a factory\b|not another\b|why.*\bfactory\b|why.*\bframework\b)\b/i },
];

// Strong playbook verbs — when present, the playbook force-route fires EVEN for a long query
// (the word-count cap is bypassed). These signal an end-to-end "do this from scratch" walkthrough.
const STRONG_PLAYBOOK_RE = /\b(set ?up|end[- ]to[- ]end|get started|getting started|from scratch|walk ?through|unbox|first time|step by step)\b/i;

// A query is "clearly orientation" only when it is short & conceptual: no concrete symbol, file
// path, ADR number, code-y token, or function/struct reference. This keeps the force-route from
// firing on a deep how-X-works-in-the-code question that happens to contain "how to".
const SPECIFIC_SIGNAL_RE = /(\badr[-\s_]?\d|[a-z_]+\.[a-z]{1,4}\b|\bfn\b|\bstruct\b|\bimpl\b|::|\/|\b[a-z_]+\(\)|\bcrate::|\bsrc\b)/i;
function isOrientationQuery(query) {
  // A strong playbook verb (set up / end-to-end / from scratch / walkthrough …) marks an
  // end-to-end "do this from scratch" request. These run long ("set up a single sensor node end to
  // end and see data in home assistant" = 16 words) yet should still force-route to the playbook
  // PRIMER, so bypass the word-count cap when one is present (FIX 3).
  if (!STRONG_PLAYBOOK_RE.test(query)) {
    const words = (query.trim().match(/\S+/g) || []).length;
    if (words > 14) return false;               // long queries are usually specific
  }
  if (SPECIFIC_SIGNAL_RE.test(query)) return false;
  return true;
}

// Is a what-is/concept query about the PRODUCT ITSELF (force PRIMER#1) vs about a CONCRETE concept
// noun (let vector+rerank find the defining doc)? Product-only: names the store product (ruvector/
// ruview) and contains NO other concrete concept noun, OR is literally "what is this / it". A query
// carrying any concept noun OTHER than the product name (rvf, witness, hnsw, gnn, segment, presence,
// occupancy, quantization, …) is a concept query, not a product overview. (FIX 1)
function isProductOverviewQuery(query, store) {
  const prod = productRe(store);
  // strip the product name, then see whether any meaningful concept term remains.
  const stripped = prod ? query.replace(prod, ' ') : query;
  const rest = queryTerms(stripped).filter((t) => t !== store && t !== 'product' && t !== 'overview');
  if (prod && prod.test(query) && rest.length === 0) return true;   // "what is <product>"
  if (/\bwhat'?s?\s+(is\s+)?(this|it)\b/i.test(query) && rest.length === 0) return true; // "what is this"
  return false;
}

// Store-aware component-inventory detector — the componentWord synonym group (crate|package|module|
// component, from config) is injected so "what packages make up X" / "which modules comprise Y" fire
// the SAME 'crates' archetype the prototype only fired for "which crates". Cached per store.
const _compInvCache = new Map();
function componentInventoryRe(store) {
  if (_compInvCache.has(store)) return _compInvCache.get(store);
  const w = componentWordAlt(store);            // e.g. (?:crate|package|module|component)
  const wp = `${w}s?`;                          // allow plural
  const re = new RegExp(
    `\\b(which ${wp}|${w} inventory|what ${wp}|${wp} (that |which )?(make up|in|for|comprise|comprise)|`
    + `list of ${wp}|\\w+ domain ${wp})\\b`, 'i');
  _compInvCache.set(store, re);
  return re;
}

// Patterns in the whatis archetype that are ALWAYS a product-overview (force PRIMER#1), regardless
// of whether other concept nouns appear. These paraphrased forms ("what does X produce", "is it a
// wrapper", "why called a factory", "do I need an account", "in one line") are orientation queries
// about the product as a whole, not about a sub-concept. They bypass the isProductOverviewQuery
// concept-noun strip so they force-route to PRIMER#1 rather than falling to whatis-concept.
const WHATIS_FORCE_RE = /\b(what does\b.*\b(produce|turn into|make into|forbid)\b|is\b.*\b(model|wrapper|framework|factory|account|server)\b|why (is it |a )?called\b|do i need\b|in one line\b|not another\b|called a factory\b|why a factory\b|published cli\b|cli name\b.*versus|versus\b.*cli name|what.*\bversus\b.*\balias\b)\b/i;

// Classify the orientation archetype (most-specific-first). Returns archetype name or null.
// `store` lets the what-is split distinguish a product-overview query from a concept query, and
// drives the componentWord synonym injection for the component-inventory archetype.
function classifyArchetype(query, store) {
  if (!isOrientationQuery(query)) return null;
  // Component-inventory FIRST, with the componentWord synonym group injected (config-driven), so a
  // package/module repo fires the inventory route exactly like a crate repo did.
  if (componentInventoryRe(store).test(query)) return 'crates';
  for (const a of ARCHETYPE_RES) {
    if (a.re.test(query)) {
      // The docs archetype splits: if the query is specifically about ADRs, target the ADR index.
      if (a.name === 'docs' && /\b(adr|decision record)\b/i.test(query)) return 'adr';
      // The what-is archetype splits: product-overview -> PRIMER#1; concept query -> no force-route
      // (let vector+rerank find the DEFINING doc; a mild concept boost is applied downstream).
      // WHATIS_FORCE_RE patterns are always product-overview (bypass the concept-noun strip).
      if (a.name === 'whatis') {
        if (WHATIS_FORCE_RE.test(query) || isProductOverviewQuery(query, store)) return 'whatis';
        return 'whatis-concept';
      }
      return a.name;
    }
  }
  return null;
}

// Code-vs-doc intent. Returns 'code' | 'design' | null.
const CODE_INTENT_RE = /\b(in (the )?code|in source|implementation|how is .*(computed|implemented|calculated|done)|\bfunction\b|\bstruct\b|signature|source code|actual code|which file|in the source|the (rust|code))\b/i;
const DESIGN_INTENT_RE = /\b(why\b|rationale|design decision|design choice|proposed\b|proposal\b|trade[- ]?off|tradeoff|motivation|reasoning behind|the decision to)\b/i;
function codeDocIntent(query) {
  // Code intent takes priority when both fire (explicit "in the code" beats a stray "why").
  if (CODE_INTENT_RE.test(query)) return 'code';
  if (DESIGN_INTENT_RE.test(query)) return 'design';
  return null;
}

// ===================================================================================
// FIX A — "how-works-in-code" / implementation intent (RETRIEVAL POLISH). A query that asks
// how something is IMPLEMENTED/coded ("how is X implemented", "how does X work in code",
// "implementation of X", "where is X coded") wants the REAL algorithm source in the crate's
// own src/ — NOT a vendored/copied dependency, NOT the CLI entrypoint, NOT the manifest. So we:
//   • DEMOTE wrong-file types: vendored/patched dep copies (patches/** + any hnsw_rs-style
//     copied-dep tree), bare entrypoints (**/main.rs, **/bin/**), and Cargo.toml.
//   • PROMOTE the crate's own src/**/*.rs (excluding main.rs) — with an EXTRA promotion for a
//     file whose name token-matches the named operation (e.g. "insert" -> *insert*.rs,
//     "count/counting" -> *count*.rs), so the operation's implementation module wins.
// Scoped to the named crate(s) from the query (entity.crates) where possible; the vendored-dep
// demotion is global (a copied dep is never the answer to "how is X implemented HERE").
// ===================================================================================
const IMPL_INTENT_RE = new RegExp([
  '\\bimplement(ed|ation)?\\b',                       // "X implemented", "implementation of X"
  '\\bhow\\s+(is|does)\\b.*\\b(work|works|coded|done)\\b.*\\bin\\s+(the\\s+)?(code|source)\\b',
  '\\bhow\\s+\\w+\\s+(is|works?)\\s+coded\\b',
  '\\bwhere\\s+is\\s+\\w+\\s+(coded|implemented)\\b',
].join('|'), 'i');
function isImplIntent(query) { return IMPL_INTENT_RE.test(query); }

// Vendored / copied-dependency trees that are NEVER the answer to "how is X implemented here".
// patches/** is the explicit vendored-patch tree; the hnsw_rs token catches the copied upstream
// HNSW crate wherever it lands (e.g. scripts/patches/hnsw_rs/**). Kept conservative.
const VENDORED_DEP_RE = /(^|\/)(patches)\/|(^|\/)hnsw_rs\//i;

// The operation noun(s) the impl query is about: meaningful terms MINUS the named crate token(s)
// MINUS generic impl words. Used to give an extra promotion to a src file whose name token-matches
// the operation (e.g. "insert" -> insert.rs / *insert*.rs).
const IMPL_STOP = new Set(['how','does','work','works','implement','implemented','implementation',
  'code','coded','source','where','the','rust','module','crate','function','method','logic']);
function implOperationNouns(query, crates) {
  const crateSet = new Set((crates || []).map((c) => c.toLowerCase()));
  return queryTerms(query)
    .filter((t) => !crateSet.has(t) && !IMPL_STOP.has(t)
      && !(crates || []).some((c) => t === c || c.includes(t)));
}

// Implementation-intent path adjustment (negative = promote, positive = demote). `crateTok` is the
// named crate the query is about (or null for unscoped). `opNouns` are the operation tokens.
function implAdjust(path, crateTok, opNouns, store) {
  let adj = 0;
  // Global: a vendored/copied-dep tree is never the real implementation of "X here".
  if (VENDORED_DEP_RE.test(path)) adj += 0.55;

  const slug = (path.split('/').pop() || '').toLowerCase();
  const isMain = /(^|\/)main\.rs$/i.test(path);
  const isBin  = /(^|\/)bin\//i.test(path);
  const isCargo = /(^|\/)cargo\.toml$/i.test(path);
  // Bare entrypoints + manifest are not the algorithm (apply globally for impl intent).
  if (isMain || isBin) adj += 0.30;
  if (isCargo) adj += 0.30;

  if (crateTok) {
    const inCrate = inComponentRe(store, crateTok).test(path);
    if (inCrate) {
      // Real source body of the named crate: src/**/*.rs that is NOT main.rs / a module-stub dir.
      const isSrcRs = /(?:^|\/)src\/.+\.rs$/i.test(path);
      if (isSrcRs && !isMain) {
        adj -= 0.40;                                   // promote the crate's own algorithm source
        // Extra promotion when the filename token-matches the named operation.
        if (opNouns && opNouns.some((t) => t.length >= 3 && slug.includes(t))) adj -= 0.30;
      }
    }
  }
  return adj;
}

// FIX D — NAMED-CRATE source boost (no rebuild). A query that explicitly names a real crate but
// carries NO implementation verb ("HNSW index in ruvector-core", "ruvector-mmwave radar parser")
// got no crate scoping before — so a sibling crate / example / bridge could outrank the named
// crate's own source. When the query names crate(s) AND it is not an impl query (implAdjust already
// covers those), GENTLY promote the named crate's own src/**/*.rs (a little extra when the filename
// token-matches an operation noun). Gentle enough that a clearly-better vector match still wins.
function namedCrateAdjust(path, crateToks, opNouns, store) {
  if (!crateToks || !crateToks.length) return 0;
  for (const c of crateToks) {
    const inCrate = inComponentRe(store, c).test(path);
    if (!inCrate) continue;
    const isSrcRs = /(?:^|\/)src\/.+\.rs$/i.test(path) && !/(?:^|\/)main\.rs$/i.test(path);
    if (isSrcRs) {
      let adj = -0.28;                               // promote the named crate's own source
      const slug = (path.split('/').pop() || '').toLowerCase();
      if (opNouns && opNouns.some((t) => t.length >= 3 && slug.includes(t))) adj -= 0.22;
      return adj;
    }
    return -0.10;                                    // mild lift for anything else in the named crate
  }
  return 0;
}

// Exact ADR-by-number, e.g. "ADR-027" / "adr 27" -> zero-padded "027". Returns [nums] or [].
function adrNumbers(query) {
  return (query.match(/\badr[-\s_]?(\d{1,4})\b/gi) || [])
    .map((m) => m.replace(/[^0-9]/g, '').padStart(3, '0'));
}
// Does a path point at the REAL ADR doc for this number (not the index table / a passing mention)?
function pathIsAdrDoc(p, num) {
  return new RegExp(`(^|/)adr[-_]?0*${num}\\b`, 'i').test(p) || new RegExp(`adr[-_]?0*${num}[-_]`, 'i').test(p);
}

// FIX 4 — parse an ADR's Status (Proposed / Accepted / Implemented / Superseded / Rejected /
// Deprecated) from the top of the document. ADRs in this corpus carry the status in any of:
//   a metadata table row:  | **Status** | Proposed |   or   | Status | Proposed |
//   an inline header:       **Status**: Proposed       or   Status: Proposed
//   a section + bold value: ## Status\n**Proposed**
// Returns the normalized UPPERCASE status string, or null if none is found. We scan the doc's
// first chunk(s) where the header lives.
const ADR_STATUS_WORDS = '(proposed|accepted|implemented|superseded|rejected|deprecated|draft|in[\\s-]?progress)';
function parseAdrStatus(chunks) {
  if (!chunks || !chunks.length) return null;
  const head = chunks.slice(0, 2).map((c) => c.text).join('\n');
  const patterns = [
    // table row: | **Status** | Proposed |   /   | Status | Accepted |
    new RegExp(`\\|\\s*\\**\\s*status\\s*\\**\\s*\\|\\s*\\**\\s*${ADR_STATUS_WORDS}`, 'i'),
    // inline: **Status**: Proposed   /   Status: Proposed
    new RegExp(`\\**status\\**\\s*:\\s*\\**\\s*${ADR_STATUS_WORDS}`, 'i'),
    // section: ## Status\n**Proposed**
    new RegExp(`#+\\s*status\\b[^\\n]*\\n+\\s*\\**\\s*${ADR_STATUS_WORDS}`, 'i'),
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m && m[1]) return m[1].toUpperCase().replace(/[\s-]+/g, '-');
  }
  return null;
}
// A status that means "design intent, not confirmed shipped" (vs ACCEPTED/IMPLEMENTED = built).
function statusIsProposed(status) {
  return !!status && /^(PROPOSED|DRAFT|IN-PROGRESS|REJECTED|DEPRECATED|SUPERSEDED)$/i.test(status);
}
// Back-compat: does the doc carry ANY status header? (trigger for INTENT(4) ADR-vs-code pairing.)
function adrHasStatus(chunks) {
  if (!chunks || !chunks.length) return false;
  const head = chunks.slice(0, 2).map((c) => c.text).join('\n');
  return parseAdrStatus(chunks) !== null
    || /(^|\n)\s*(#+\s*status\b|\*\*status\*\*\s*:|status\s*:|\|\s*\**status)/i.test(head);
}

const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','for','on','with','how','do','i','is','are',
  'what','when','where','why','it','this','that','kb','query','question','search','find','show','me','please','about']);

// Tokenize a query into meaningful lexical terms (FIX 3 hybrid lexical).
function queryTerms(q) {
  return (q.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Concept nouns from a concept what-is query (FIX 1). The query's meaningful terms MINUS the
// product name MINUS generic question words = the concrete concept(s) being asked about (rvf,
// witness, hnsw, gnn, segment, presence, occupancy, …). A doc whose title/path token-overlaps one
// of these is more likely to DEFINE it, so it gets a mild boost (below) — letting the real defining
// ADR/source/doc out-rank the thin product blurb without a hard force-route.
const CONCEPT_STOP = new Set(['what','difference','between','role','format','file','files','does',
  'store','stores','support','supported','index','indices','chain','segment','detection','counting',
  'augmented','work','works']);
function conceptNouns(query, store) {
  const prod = productRe(store);
  const stripped = prod ? query.replace(prod, ' ') : query;
  return queryTerms(stripped).filter((t) => t !== store && !CONCEPT_STOP.has(t));
}

// Concept boost: SUBTRACT from a doc that names a concept noun from a concept what-is query.
// FIX 3 — the DEFINING doc must beat an ADJACENT one. A concept noun that appears in the doc's
// FILENAME SLUG or TITLE is a strong "this doc DEFINES the concept" signal (e.g. the file
// `ADR-029-ruvsense-multistatic-sensing-mode.md` / title containing "multistatic" defines
// "multistatic", while a sibling ADR that merely mentions it in the body does not). So we weight
// a filename-slug / title hit FAR above a bare path-substring hit, which makes the title/slug-exact
// defining doc out-rank an adjacent ADR. PRIMER#1 (thin product blurb) is excluded. NON-NEGATIVE.
function conceptBoost(nouns, path, title) {
  if (!nouns || !nouns.length) return 0;
  if (PRIMER_PATH_RE.test(path) && /what\b.*\bis\b|#1-/i.test(`${path} ${title}`)) return 0;
  const slug = (path.split('/').pop() || '').toLowerCase();   // filename slug (the defining signal)
  const titleL = String(title || '').toLowerCase();
  const hay = `${path} ${title}`.toLowerCase();
  let strong = 0;   // concept noun present in the filename slug or the title (defining)
  let weak = 0;     // concept noun present elsewhere in the path (adjacent / mention)
  for (const t of nouns) {
    if (slug.includes(t) || titleL.includes(t)) strong += 1;
    else if (hay.includes(t)) weak += 1;
  }
  if (strong === 0 && weak === 0) return 0;
  // Strong (slug/title) hits dominate so the defining doc clears any adjacent doc's vector lead.
  const b = 0.30 * strong + 0.06 * weak;
  // Glossary section (ruview) is a legitimate concept target and benefits via the same rule; a real
  // defining doc with a slug/title hit out-scores it.
  return Math.min(0.62, b);
}

// FIX 2 — crate-overview / metric intent. "what does crate X do" or "X compression ratio /
// throughput / benchmark" should surface the crate's README.md / BENCHMARK.md / docs (where the
// headline numbers live) ABOVE its benches/ + main.rs harness + bare Cargo.toml. Returns the crate
// token the query is about, or null. (Distinct from the crate-INVENTORY archetype "which crates…".)
const CRATE_METRIC_RE = /\b(compression(\s+ratio)?|throughput|benchmark|latency|qps|recall|speed ?up|ops\/s|ratio|perf(ormance)?)\b/i;
const CRATE_OVERVIEW_RE = /\b(what (does|is)|overview of|tell me about|describe)\b/i;
function crateOverviewTarget(query, entityCrates) {
  if (!entityCrates || !entityCrates.length) return null;
  if (CRATE_METRIC_RE.test(query) || CRATE_OVERVIEW_RE.test(query)) return entityCrates[0];
  return null;
}
// Boost for a README/BENCHMARK/docs path of the targeted crate; mild penalty for that crate's
// harness (benches/ + main.rs) and bare Cargo.toml so the prose with the numbers wins. NON-NEGATIVE
// return = subtract from eff distance; harness/Cargo handled as a separate positive penalty.
function crateOverviewAdjust(crateTok, path, store) {
  if (!crateTok) return 0;
  const inCrate = inComponentRe(store, crateTok).test(path);
  if (!inCrate) return 0;
  let adj = 0;
  if (/\/(readme|benchmark)\.md$/i.test(path) || /\/docs\//i.test(path)) adj -= 0.45;  // prose w/ numbers
  if (/\/benches?\//i.test(path) || /\/main\.rs$/i.test(path)) adj += 0.20;             // harness
  if (/\/cargo\.toml$/i.test(path)) adj += 0.18;                                         // bare manifest
  return adj;
}

// ===================================================================================
// FIX B — targeted off-topic-magnet down-weight (RETRIEVAL POLISH). A specific document that
// keeps surfacing as off-topic noise on UNRELATED queries gets a mild penalty UNLESS the query is
// actually about that document's subject. General mechanism (a small allow-listed down-weight
// table); currently a single entry for ADR-096 (rvCSI crate layout), which intruded on unrelated
// queries (e.g. worldgraph spatial relationships). The penalty is mild so an on-topic query
// (about rvCSI crate layout / structure) still surfaces it normally via its allow regex.
// ===================================================================================
// Legacy default magnet table (ruvector/ruview only): ADR-096 (rvCSI crate layout) intruded on
// unrelated queries. New targets supply their own via config.offtopicMagnets (filled during gate-A
// tuning, P6a) — each entry { re|reSource, pen, allow|allowSource }.
const LEGACY_OFFTOPIC_MAGNETS = {
  ruvector: [
    { re: /(^|\/)adr[-_]?0*96\b/i, pen: 0.22,
      allow: /\b(rvcsi|rv[-_]?csi|crate\s+layout|crate\s+structure|crate\s+organi|workspace\s+layout|adr[-\s_]?0*96)\b/i },
  ],
  ruview: [
    { re: /(^|\/)adr[-_]?0*96\b/i, pen: 0.22,
      allow: /\b(rvcsi|rv[-_]?csi|crate\s+layout|crate\s+structure|crate\s+organi|workspace\s+layout|adr[-\s_]?0*96)\b/i },
  ],
};
// Compile a config magnet entry (which may carry string sources or RegExp objects) into a usable
// { re, pen, allow } triple. Cached per store so we don't recompile each call.
const _magnetCache = new Map();
function magnetsFor(store) {
  if (_magnetCache.has(store)) return _magnetCache.get(store);
  const t = cfgFor(store);
  let list = (t && Array.isArray(t.offtopicMagnets) && t.offtopicMagnets.length) ? t.offtopicMagnets : null;
  if (!list) list = LEGACY_OFFTOPIC_MAGNETS[store] || [];
  const compiled = list.map((m) => ({
    re: m.re instanceof RegExp ? m.re : new RegExp(m.reSource || String(m.re || ''), 'i'),
    allow: m.allow instanceof RegExp ? m.allow : (m.allow || m.allowSource ? new RegExp(m.allowSource || String(m.allow), 'i') : null),
    pen: typeof m.pen === 'number' ? m.pen : 0.22,
  }));
  _magnetCache.set(store, compiled);
  return compiled;
}
function offtopicMagnetPenalty(query, path, store) {
  let pen = 0;
  for (const m of magnetsFor(store)) {
    if (m.re.test(path) && !(m.allow && m.allow.test(query))) pen += m.pen;
  }
  return pen;
}

// ===================================================================================
// FIX C — crate-specific maturity → the crate's OWN README/BENCHMARK (RETRIEVAL POLISH). A query
// like "is <crate> production-ready / experimental / complete" is answered by that crate's OWN
// README.md / BENCHMARK.md (which usually carry a status/maturity note), NOT by the global
// capabilities-graded primer or a cross-crate benchmark doc. Returns the named crate token when
// the query is a crate-scoped maturity question, else null.
const MATURITY_QUERY_RE = /\b(production[- ]?ready|production\b|experimental|prototype|complete|completeness|mature|maturity|stable|ready\s+for\s+production|battle[- ]?tested|is\s+it\s+(done|ready))\b/i;
function crateMaturityTarget(query, entityCrates) {
  if (!entityCrates || !entityCrates.length) return null;
  if (MATURITY_QUERY_RE.test(query)) return entityCrates[0];
  return null;
}
// Boost the named crate's OWN README.md / BENCHMARK.md for a crate-maturity query (negative = boost).
function crateMaturityAdjust(crateTok, path, store) {
  if (!crateTok) return 0;
  const own = new RegExp(componentPrefixSrc(store, `${crateTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-[a-z0-9-]+)?/(?:readme|benchmark)\\.md$`), 'i');
  return own.test(path) ? -0.50 : 0;
}

// FIX 3 — lexical boost: ADR-number exact hit, then proper-noun/title token overlap on
// the doc's path+title. Returns a NON-NEGATIVE amount to SUBTRACT from effective distance.
function lexicalBoost(query, terms, path, title) {
  let boost = 0;
  const hay = `${path} ${title}`.toLowerCase();

  // ADR id in query that the doc carries (e.g. "ADR-027" -> path adr/ADR-027-*.md)
  const adrIds = (query.match(/adr[-\s_]?(\d{1,4})/gi) || [])
    .map((m) => m.replace(/[^0-9]/g, '').padStart(3, '0'));
  for (const num of adrIds) {
    if (new RegExp(`adr[-_]?0*${num}\\b`, 'i').test(hay)) { boost += 0.30; break; }
  }

  // Title / path token overlap (proper-noun & multiword title tokens count strongest).
  let overlap = 0;
  for (const t of terms) {
    if (hay.includes(t)) overlap += 1;
  }
  if (overlap > 0) boost += Math.min(0.18, 0.06 * overlap);

  return boost;
}

// FIX 2 — demotion penalty for a path given the query (skipped if query references the kind).
function demotionPenalty(query, path) {
  let pen = 0;
  for (const ls of LOW_SIGNAL) {
    if (ls.re.test(path) && !ls.allow.test(query)) pen += ls.pen;
  }
  return pen;
}

// Substance boost — a self-contained answer-bearing document (multiple chunks / real length)
// should not be out-ranked by a vector-closer but tiny one-line doc-comment fragment. This
// keeps results SELF-CONTAINED (the grading bar) without re-embedding. Capped & gentle so it
// only breaks near-ties, never overrides a clearly-better match.
function substanceBoost(chunks) {
  if (!chunks || !chunks.length) return 0;
  const totalChars = chunks.reduce((s, c) => s + c.text.length, 0);
  let b = 0;
  if (chunks.length >= 2) b += 0.06;
  if (chunks.length >= 4) b += 0.06;
  if (totalChars >= 4000) b += 0.06;
  if (totalChars < 400) b -= 0.06;          // a sub-400-char stub is a fragment, demote it
  return Math.max(-0.06, Math.min(0.18, b));
}

// Disambiguation adjustment (negative = boost a "good" path, positive = penalize a "bad" path) for
// queries matching a config disambiguation entry. Each entry: { whenSource|when, goodSource|good,
// badSource|bad, goodBoost?, badPenalty? }. New targets fill target.disambiguation during gate-A
// tuning (P6a). Legacy ruvector/ruview keep the hard-coded "Cognitum Seed" rule as a fallback only.
const _disambigCache = new Map();
function disambigFor(store) {
  if (_disambigCache.has(store)) return _disambigCache.get(store);
  const t = cfgFor(store);
  let list = (t && Array.isArray(t.disambiguation) && t.disambiguation.length) ? t.disambiguation : null;
  if (!list) {
    // legacy fallback: the prototype's "Cognitum Seed" product disambiguation.
    if (store === 'ruvector' || store === 'ruview') {
      list = [{ when: SEED_QUERY_RE, good: SEED_GOOD_RE, bad: SEED_BAD_RE, goodBoost: 0.25, badPenalty: 0.30 }];
    } else {
      list = [];
    }
  }
  const compiled = list.map((d) => ({
    when: d.when instanceof RegExp ? d.when : new RegExp(d.whenSource || String(d.when || ''), 'i'),
    good: d.good instanceof RegExp ? d.good : (d.good || d.goodSource ? new RegExp(d.goodSource || String(d.good), 'i') : null),
    bad: d.bad instanceof RegExp ? d.bad : (d.bad || d.badSource ? new RegExp(d.badSource || String(d.bad), 'i') : null),
    goodBoost: typeof d.goodBoost === 'number' ? d.goodBoost : 0.25,
    badPenalty: typeof d.badPenalty === 'number' ? d.badPenalty : 0.30,
  }));
  _disambigCache.set(store, compiled);
  return compiled;
}
function seedAdjust(query, path, store) {
  let adj = 0;
  for (const d of disambigFor(store)) {
    if (!d.when.test(query)) continue;
    if (d.good && d.good.test(path)) adj -= d.goodBoost;
    if (d.bad && d.bad.test(path))  adj += d.badPenalty;
  }
  return adj;
}

// The KB builder emits OVERLAPPING chunks (a sliding window repeats ~half of each neighbour).
// Naively concatenating them duplicates paragraphs. stitch() drops the longest suffix of the
// running text that is also a prefix of the next chunk, so the document reads cleanly as one.
function stitch(prevTail, next) {
  const maxOv = Math.min(prevTail.length, next.length, 2000);
  for (let len = maxOv; len >= 24; len--) {
    if (prevTail.slice(prevTail.length - len) === next.slice(0, len)) {
      return next.slice(len); // drop the duplicated overlap
    }
  }
  return next;
}

// Assemble the FULL document from its chunks (id-ordered), de-overlapping as we go so it reads
// as one clean document. If the stitched text fits under MAX_DOC_CHARS, the whole document is
// returned. If it exceeds the cap, the window is CENTERED on the matched chunk (the chunk that
// actually scored the hit) and expanded outward — alternating following then preceding chunks —
// so the answer-bearing region is ALWAYS included, even when the match is a late chunk in a long
// document. (The old behavior counted from chunk 0 and could truncate the answer.) De-overlap
// stitching is preserved across the contiguous kept window.
function assembleDocument(chunks, matchedId) {
  const SEP = '\n\n';
  if (!chunks.length) return { fullText: '', chunksJoined: 0, truncated: false };

  // Locate the matched chunk; default to the first chunk if not found (back-compat).
  let center = 0;
  if (matchedId != null) {
    const idx = chunks.findIndex((c) => c.id === matchedId);
    if (idx >= 0) center = idx;
  }

  // Grow a contiguous [lo, hi] window outward from `center` while it fits under the cap.
  // Always include the matched chunk itself first, then expand following, then preceding.
  let lo = center, hi = center;
  let budget = chunks[center].text.length;
  let nextLo = center - 1, nextHi = center + 1;
  let toggle = 1; // 1 = try to extend forward first, then backward
  while (nextLo >= 0 || nextHi < chunks.length) {
    let extended = false;
    const tryHi = () => {
      if (nextHi < chunks.length) {
        const cost = SEP.length + chunks[nextHi].text.length;
        if (budget + cost <= MAX_DOC_CHARS) { budget += cost; hi = nextHi; nextHi++; return true; }
        nextHi = chunks.length; // stop growing forward once it no longer fits
      }
      return false;
    };
    const tryLo = () => {
      if (nextLo >= 0) {
        const cost = SEP.length + chunks[nextLo].text.length;
        if (budget + cost <= MAX_DOC_CHARS) { budget += cost; lo = nextLo; nextLo--; return true; }
        nextLo = -1; // stop growing backward once it no longer fits
      }
      return false;
    };
    if (toggle === 1) { extended = tryHi() || tryLo(); } else { extended = tryLo() || tryHi(); }
    toggle ^= 1;
    if (!extended) break;
  }

  // Stitch the kept contiguous window [lo..hi] into one clean document.
  let out = '';
  let joined = 0;
  for (let i = lo; i <= hi; i++) {
    const piece = out ? stitch(out.slice(-2000), chunks[i].text) : chunks[i].text;
    out = out ? out + (piece ? SEP + piece : '') : piece;
    joined++;
  }

  const omitted = chunks.length - joined;
  if (omitted > 0) {
    const before = lo, after = chunks.length - 1 - hi;
    const parts = [];
    if (before > 0) parts.push(`${before} earlier`);
    if (after > 0) parts.push(`${after} later`);
    const note = `${SEP}${SEP}[... ${parts.join(' + ')} chunk(s) omitted; window centered on the `
      + `matched section, capped at ${MAX_DOC_CHARS} chars ...]`;
    return { fullText: out + note, chunksJoined: joined, truncated: true };
  }
  return { fullText: out, chunksJoined: joined, truncated: false };
}

// ---------- core search: returns whole-document results ----------
// Each result: { path, title, fullText, bestDistance, effDistance, chunksJoined, truncated,
//                distance (alias of bestDistance), text (alias of fullText) }.
export async function searchKb({ query, k = 6, store, n, variant }) {
  const conf = resolveConf(store, variant);
  if (!fs.existsSync(conf.rvf)) throw new Error(`rvf not found: ${conf.rvf} (variant=${conf.variant}; run \`npm i\` then build, or copy the bundle in)`);
  const topN = Math.max(1, n || 5);
  const [qv, { byId, byPath }] = await Promise.all([embed(query, conf.embedCfg), loadPassages(conf.passages)]);
  const byPathKind = loadKinds(conf.meta);          // intent layer: per-path content kind
  const terms = queryTerms(query);

  // ---- INTENT CLASSIFICATION (deterministic, computed once per query) ----
  // FIX 1 — specific-entity detection. If the query names a crate / ADR id / file / proper noun it
  // is NOT a generic product-orientation question: suppress the orientation force-route + generic
  // PRIMER lift and demote primer-orientation docs. The crate-INVENTORY archetype ("which crates…")
  // is exempt (carries no hyphen-crate token) so it still routes to the inventory PRIMER.
  const crateTokens = crateTokenSet(byPath, store);
  const entity = specificEntity(query, crateTokens);
  let archetype = classifyArchetype(query, store);            // 'maturity'|'capabilities'|…|'whatis-concept'|null
  // Suppress force-routing archetypes when a specific entity is named — EXCEPT:
  //   (a) the crate inventory archetype ('crates') — a legitimate enumeration even with a hyphen token.
  //   (b) a product-overview 'whatis' query that names a product alias (e.g. "CLI name versus
  //       create-agent-harness") — the alias IS the product, so the orientation PRIMER should still win.
  const isProductWhatis = archetype === 'whatis' && WHATIS_FORCE_RE.test(query);
  if (entity.named && archetype && archetype !== 'crates' && archetype !== 'whatis-concept' && !isProductWhatis) {
    archetype = null;
  }
  // 'whatis-concept' is a NON-routing archetype: no force-route to a PRIMER, instead a mild concept
  // boost (below) lets the vector+rerank pipeline surface the true DEFINING doc. Other archetypes
  // force-route to their PRIMER slug (null slug -> no force-route, e.g. ruvector hardware).
  const targetPrimerSlug = (archetype && archetype !== 'whatis-concept')
    ? resolvePrimerSlug(archetype, store, byPath)
    : null;
  // FIX 2 — crate-overview / metric target: the crate whose README/BENCHMARK/docs should win.
  const crateOverviewTok = crateOverviewTarget(query, entity.crates);
  // Concept nouns drive the mild concept boost for concept what-is queries (FIX 1).
  const concepts = archetype === 'whatis-concept' ? conceptNouns(query, store) : [];
  // FIX 3 — DEFINING-DOC nouns: a concept/topic query that is NOT a product-overview, NOT a
  // force-routed orientation archetype, and NOT a specific-entity query should still surface the
  // DEFINING doc (e.g. "multistatic vs monostatic sensing" -> the ADR whose filename slug names
  // "multistatic"). These nouns drive the slug/title concept boost AND pull a slug-named defining
  // doc into the candidate pool, so a title/slug-exact doc beats an adjacent one. The whatis-concept
  // nouns are folded in so that path keeps its existing behavior.
  const definingNouns = (concepts.length)
    ? concepts
    : (!entity.named && !targetPrimerSlug && archetype !== 'crates'
        ? conceptNouns(query, store)
        : []);
  // For ruview, a concept what-is query may also softly boost the glossary section (a real defining
  // doc still wins when present, because the glossary is short/synthesized with a worse distance).
  const glossarySlug = archetype === 'whatis-concept' ? resolvePrimerSlug('glossary', store, byPath) : null;
  const adrNums = adrNumbers(query);
  const intent = codeDocIntent(query);                        // 'code' | 'design' | null
  // FIX A — implementation ("how is X coded") intent: demote wrong-file types (vendored deps,
  // bare entrypoints, manifests), promote the named crate's own src/**/*.rs.
  const implIntent = isImplIntent(query);
  const implCrateTok = (implIntent && entity.crates.length) ? entity.crates[0] : null;
  const implOpNouns = implIntent ? implOperationNouns(query, entity.crates) : [];
  // FIX D — named crate(s) WITHOUT impl intent: gently scope to the named crate's own source.
  // BUT NOT for a definitional "what is X" / overview query: there the user wants the concept doc,
  // and a crate-family token in the name (e.g. "wifi-densepose") must NOT boost crate src over the
  // plain-answer PRIMER. So suppress on the whatis-concept archetype + product-overview queries.
  const definitionalQ = archetype === 'whatis-concept' || isProductOverviewQuery(query, store);
  const namedCrateToks = (!implIntent && !definitionalQ && entity.crates.length) ? entity.crates : [];
  const namedOpNouns = namedCrateToks.length ? implOperationNouns(query, entity.crates) : [];
  // FIX C — crate-scoped maturity question: prefer the crate's OWN README/BENCHMARK over the
  // global capabilities primer / cross-crate benchmark doc.
  const crateMaturityTok = crateMaturityTarget(query, entity.crates);

  const db = await RvfDatabase.openReadonly(conf.rvf);
  let hits;
  try {
    // Fetch plenty of raw chunk hits so we have material to group into documents and rerank.
    hits = await db.query(qv, Math.max(RAW_HITS, k * 4));
  } finally {
    await db.close();
  }

  // FIX 1 — collapse chunk hits into documents keyed by path; doc score = best (min) distance.
  const docs = new Map(); // path -> { path, title, bestDistance, matchedId }
  for (const h of hits) {
    const rec = byId.get(String(h.id));
    if (!rec) continue;
    const cur = docs.get(rec.path);
    if (!cur || h.distance < cur.bestDistance) {
      docs.set(rec.path, { path: rec.path, title: rec.title, bestDistance: h.distance, matchedId: rec.id });
    }
  }

  // INTENT: ensure force-routed targets are IN the candidate pool even if MiniLM ranked them out
  // of the raw window. (a) the target PRIMER slug for an orientation archetype; (b) the real ADR
  // document for an exact ADR-NNN query. We synthesize a doc entry from byPath so it can be ranked
  // and then hard-boosted below. Without this, a force-route could point at a doc not in `docs`.
  const ensureDoc = (p) => {
    if (!p || docs.has(p)) return;
    const chunks = byPath.get(p);
    if (!chunks || !chunks.length) return;
    docs.set(p, { path: p, title: chunks[0].title, bestDistance: 1.0, matchedId: chunks[0].id });
  };
  if (targetPrimerSlug) ensureDoc(targetPrimerSlug);
  if (glossarySlug) ensureDoc(glossarySlug);   // concept query: glossary may softly win for ruview
  // For an exact ADR query, find the real ADR doc path(s) by scanning the passages index.
  const adrDocPaths = [];
  if (adrNums.length) {
    for (const num of adrNums) {
      for (const p of byPath.keys()) {
        if (pathIsAdrDoc(p, num) && !PRIMER_PATH_RE.test(p)) { adrDocPaths.push(p); ensureDoc(p); }
      }
    }
  }
  // FIX 3 — a concept what-is query's DEFINING doc may sit OUTSIDE the raw vector window (the defining
  // ADR can be titled by its codename, not the concept). Pull any doc whose FILENAME SLUG names a
  // concept noun into the candidate pool so the strengthened concept boost can rank it; the boost
  // (not a hard route) decides whether it actually wins. Capped scan to stay cheap.
  if (definingNouns.length) {
    let added = 0;
    for (const p of byPath.keys()) {
      if (docs.has(p) || PRIMER_PATH_RE.test(p)) continue;
      const slug = (p.split('/').pop() || '').toLowerCase();
      if (definingNouns.some((t) => slug.includes(t))) { ensureDoc(p); if (++added >= 40) break; }
    }
  }
  // FIX 2 — ensure the targeted crate's README/BENCHMARK/docs are in the pool even if MiniLM ranked
  // them out (the harness file is often the closer vector match).
  if (crateOverviewTok) {
    const esc = crateOverviewTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cre = new RegExp(componentPrefixSrc(store, `${esc}(?:-[a-z0-9-]+)?/(?:readme|benchmark)\\.md$`), 'i');
    for (const p of byPath.keys()) { if (cre.test(p)) ensureDoc(p); }
  }
  // FIX A — for an implementation query naming a component, pull that component's own src/** source
  // into the pool so the real algorithm source can be promoted above a vendored copy / entrypoint.
  if (implCrateTok) {
    const esc = implCrateTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const srcRe = new RegExp(componentPrefixSrc(store, `${esc}(?:-[a-z0-9-]+)?/src/.+\\.(?:rs|ts|tsx|js|mjs|py)$`), 'i');
    let added = 0;
    for (const p of byPath.keys()) {
      if (docs.has(p) || /(?:^|\/)main\.rs$/i.test(p)) continue;
      if (srcRe.test(p)) { ensureDoc(p); if (++added >= 40) break; }
    }
  }
  // FIX D — for a (non-impl) query naming component(s), pull each named component's own src/** into
  // the pool so the named component's source can be promoted above a sibling / example / bridge.
  for (const c of namedCrateToks) {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const srcRe = new RegExp(componentPrefixSrc(store, `${esc}(?:-[a-z0-9-]+)?/src/.+\\.(?:rs|ts|tsx|js|mjs|py)$`), 'i');
    let added = 0;
    for (const p of byPath.keys()) {
      if (docs.has(p) || /(?:^|\/)main\.rs$/i.test(p)) continue;
      if (srcRe.test(p)) { ensureDoc(p); if (++added >= 40) break; }
    }
  }
  // FIX C — for a component-maturity query, ensure the component's own README/BENCHMARK are pooled.
  if (crateMaturityTok) {
    const esc = crateMaturityTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cre = new RegExp(componentPrefixSrc(store, `${esc}(?:-[a-z0-9-]+)?/(?:readme|benchmark)\\.md$`), 'i');
    for (const p of byPath.keys()) { if (cre.test(p)) ensureDoc(p); }
  }

  // FIXes 2/3/4 + INTENT — compute effective distance per document.
  // Hard routes use a large negative adjustment so the routed doc wins decisively; intent tilts
  // are gentle (break ties / nudge) so they don't override a clearly-better vector match.
  const HARD_WIN = 5.0;     // dominates any plausible distance + penalty (force #1)
  const ranked = [...docs.values()].map((d) => {
    const dkind = byPathKind.get(d.path) || null;
    const pen = demotionPenalty(query, d.path);
    const boost = lexicalBoost(query, terms, d.path, d.title);
    const seed = seedAdjust(query, d.path, store);
    const sub = substanceBoost(byPath.get(d.path));
    // FIX 1 — when a specific entity is named, the generic orientation lift is suppressed AND
    // primer-orientation docs are demoted below source/adr/crate-src/doc for this query.
    const suppressOrient = entity.named || archetype === 'whatis-concept';
    const orient = orientationBoost(query, d.path, d.title, suppressOrient);  // FIX 5 — top-down orientation layer
    const primerDemote = (entity.named && dkind === 'primer-orientation') ? PRIMER_DEMOTE_WHEN_SPECIFIC : 0;
    // FIX 2 — crate-overview / metric: boost the crate's README/BENCHMARK/docs, demote its harness.
    const crateAdj = crateOverviewAdjust(crateOverviewTok, d.path, store);  // negative=boost, positive=demote
    // FIX A — implementation intent: demote vendored deps / entrypoints / manifest, promote the
    // named component's own src/**/* (extra for an operation-token-matching filename).
    const implAdj = implIntent ? implAdjust(d.path, implCrateTok, implOpNouns, store) : 0;
    // FIX D — named component (no impl verb): gently promote the named component's own source.
    const namedCrateAdj = namedCrateToks.length ? namedCrateAdjust(d.path, namedCrateToks, namedOpNouns, store) : 0;
    // FIX B — targeted off-topic-magnet down-weight (config disambiguation/offtopicMagnets).
    const magnetPen = offtopicMagnetPenalty(query, d.path, store);
    // FIX C — crate-maturity: boost the named component's OWN README/BENCHMARK.
    const matAdj = crateMaturityAdjust(crateMaturityTok, d.path, store);   // negative=boost
    // FIX 1/3 — concept boost: nudge docs whose slug/title names the concept (defining doc beats
    // adjacent); extra nudge for the glossary section on a whatis-concept query.
    let concept = conceptBoost(definingNouns, d.path, d.title);
    if (glossarySlug && d.path === glossarySlug && concepts.length) concept += 0.06;
    let intentAdj = 0;

    // INTENT (1) — orientation archetype force-route to the matching PRIMER slug.
    if (targetPrimerSlug && d.path === targetPrimerSlug) intentAdj += HARD_WIN;

    // INTENT (2) — exact ADR-by-number hard route to the real ADR doc (must beat the index table).
    if (adrDocPaths.includes(d.path)) intentAdj += HARD_WIN;

    // INTENT (3) — code-vs-doc tilt. Use the doc's content kind from the metadata sidecar.
    if (intent) {
      const kind = byPathKind.get(d.path);
      if (intent === 'code'   && isSourceKind(kind)) intentAdj += 0.30;   // prefer real code body
      if (intent === 'design' && kind === 'adr')     intentAdj += 0.22;   // prefer the ADR/doc
    }

    // RANK SCALE — the additive offsets below were calibrated against MiniLM's distance scale
    // (relevant ~0.9–1.1). bge-base packs relevant docs much tighter (~0.4–0.8), so the same
    // raw offset over-corrects and inverts good raw rankings. Scale the WHOLE offset bundle by
    // the per-variant rankScale (small=1.0 → unchanged; big<1 → gentler, trusts bge's raw order).
    const RANK_SCALE = conf.embedCfg.rankScale ?? 1;
    const offsets = pen - boost + seed - sub - orient - concept - intentAdj
      + primerDemote + crateAdj + implAdj + namedCrateAdj + magnetPen + matAdj;
    const effDistance = d.bestDistance + RANK_SCALE * offsets;
    return { ...d, effDistance, kind: dkind };
  }).sort((a, b) => a.effDistance - b.effDistance);

  // INTENT (4) — ADR-vs-code pairing for completeness. If #1 is an ADR carrying a Status: header
  // (a proposal/decision = intent, not built reality) and NO source doc is in the top-N, pull the
  // best-matching source doc into the returned set so the reader sees proposal vs built code. We
  // only ADD a result (and tag it); we never displace the routed #1 or break whole-doc return.
  let pairedSource = null;
  if (ranked.length) {
    const top = ranked[0];
    const topKind = top.kind || byPathKind.get(top.path);
    if (topKind === 'adr' && adrHasStatus(byPath.get(top.path))) {
      const inTop = ranked.slice(0, topN).some((d) => isSourceKind(d.kind));
      if (!inTop) {
        pairedSource = ranked.find((d) => isSourceKind(d.kind)) || null;
      }
    }
  }

  // FIX 1 — assemble the FULL document for the top-N distinct documents.
  const assemble = (d, label) => {
    const chunks = byPath.get(d.path) || [];
    const { fullText, chunksJoined, truncated } = chunks.length
      ? assembleDocument(chunks, d.matchedId)
      : { fullText: '(NO PASSAGE TEXT — path not found in sidecar)', chunksJoined: 0, truncated: false };
    // FIX 4 — parse + surface the ADR Status (Proposed/Accepted/Implemented/…) for ADR docs (or any
    // doc whose head carries a Status block). `adrStatus` rides the result object so the MCP path
    // carries it too; `statusLabel` is the human-visible header tag.
    const kind = d.kind || byPathKind.get(d.path) || null;
    const adrStatus = (kind === 'adr' || adrHasStatus(chunks)) ? parseAdrStatus(chunks) : null;
    const statusLabel = adrStatus
      ? `ADR STATUS: ${adrStatus}${statusIsProposed(adrStatus)
          ? ' — design intent, NOT confirmed shipped'
          : ' — accepted/implemented'}`
      : null;
    return {
      path: d.path,
      title: d.title,
      fullText,
      bestDistance: d.bestDistance,
      effDistance: d.effDistance,
      kind,
      adrStatus,                       // FIX 4 — parsed ADR status (null if none) — carried to MCP
      statusLabel,                     // FIX 4 — human-visible "[ADR STATUS: …]" tag
      label: label || null,            // intent label (e.g. 'paired-source') for callers/UI
      chunksJoined,
      truncated,
      // back-compat aliases for callers that still read .text / .distance
      text: fullText,
      distance: d.bestDistance,
    };
  };

  const out = ranked.slice(0, topN).map((d) => assemble(d));

  // INTENT (4) — append the paired implementing source so proposal-vs-built-reality is visible.
  // Appended (not inserted) so the routed/ranked order — including the whole-doc #1 ADR — is intact.
  if (pairedSource && !out.some((r) => r.path === pairedSource.path)) {
    out.push(assemble(pairedSource, 'paired-source (implements the ADR above)'));
  }

  // FIX 4 — proposal-as-reality guard. If the #1 result is a Proposed/not-yet-Implemented ADR (or a
  // design/DDD doc with no parseable status) AND no kind:'source' implementing file is in the set,
  // attach a clear design-intent warning so the reader never treats a proposal as shipped reality.
  if (out.length) {
    const top = out[0];
    const isDesignTop = top.kind === 'adr'
      || top.kind === 'doc' || top.kind === 'doc-deep' || top.kind === 'ddd';
    const proposed = top.adrStatus ? statusIsProposed(top.adrStatus) : (top.kind !== 'source' && top.kind !== 'crate-src');
    const hasSource = out.some((r) => isSourceKind(r.kind));
    if (isDesignTop && proposed && !hasSource) {
      const st = top.adrStatus || 'unstated (design/DDD doc)';
      top.designIntentWarning =
        `⚠ This is design intent (ADR status: ${st}); no implementing source was retrieved — `
        + `treat as proposed, not confirmed built.`;
    }
  }

  return out;
}

// ---------- CLI ----------
async function main() {
  const argv = process.argv.slice(2);
  // optional trailing [big|small] variant selector; default auto-picks big if present
  let variant;
  const vIdx = argv.findIndex((a) => a === 'big' || a === 'small');
  if (vIdx !== -1) variant = argv.splice(vIdx, 1)[0];
  const [store, query, kArg] = argv;
  if (!store || !query) {
    console.error(`Usage: node kb/ask-kb.mjs <${[...KNOWN_STORES].join('|')}> "question" [k] [big|small]`);
    process.exit(2);
  }
  const k = Math.max(1, parseInt(kArg || '6', 10) || 6);
  const conf = resolveConf(store, variant);
  const results = await searchKb({ query, k, store, variant });
  console.log(`\n=== ${store} KB (${conf.variant} · ${conf.embedCfg.model}) — "${query}" — top ${results.length} documents ===\n`);
  results.forEach((r, i) => {
    console.log(`#${i + 1}  distance=${r.bestDistance.toFixed(4)} (eff=${r.effDistance.toFixed(4)})`
      + `${r.kind ? `  kind=${r.kind}` : ''}${r.label ? `  [${r.label}]` : ''}`
      + `${r.statusLabel ? `  [${r.statusLabel}]` : ''}`);   // FIX 4 — surface ADR status in the header
    console.log(`path : ${r.path}`);
    console.log(`title: ${r.title}`);
    if (r.designIntentWarning) console.log(r.designIntentWarning);   // FIX 4 — proposal-as-reality guard
    console.log(`chars: ${r.fullText.length} | chunks: ${r.chunksJoined}${r.truncated ? ' (truncated)' : ''}`);
    console.log('----- full document -----');
    console.log(r.fullText);
    console.log('===================================================================\n');
  });
}

// Run as CLI when invoked directly (compare decoded real paths; handles spaces in path).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
