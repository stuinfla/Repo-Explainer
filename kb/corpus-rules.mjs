// corpus-rules.mjs — config-driven corpus rule-type implementations.
//
// Each rule type is a pure function that takes a `ctx` (the shared build context: repo root,
// walk helper, exclusion set, chunker, addDoc collector, etc.) plus the rule's own config object
// (from `kb.config.mjs` target.include[]) and APPENDS entries to the corpus via ctx.addDoc(...).
//
// The mechanics are generalized from the proven Cognitum prototype (build-ruview-kb.mjs):
// repo-shape is now DATA (roots / exts / files / headLines) instead of hard-coded ruview/ruvector
// paths. NO repo name is baked in here. build-kb.mjs wires these rules together per config.
//
// Rule types (build-plan-metaharness.md §2a [D5]):
//   mdSweepFullText   — every *.md/.mdx/.txt under the given roots, verbatim (untruncated).
//   componentManifests— each component's package.json / Cargo.toml summarized (name/desc/scripts/deps).
//   componentLead     — each component's README / lead doc (full text) + lead source doc-block.
//   sourceBodies      — full file bodies of implementing source under the roots (chunked).
//   docCommentSweep   — leading doc comments only (//!, /** */, """...""", #-prefixed) from source.
//   literalFiles      — an explicit list of files, full text (guarantees key docs are present).
//   htmlText          — visible text of *.html under the roots (scripts/styles/tags stripped).
//   templates         — scaffolding templates (.tmpl/.hbs/...): first-N-lines + path, kind:'template'.
//
// A `kind` is attached to every entry so the intent layer (ask-kb) can route by content kind.

import fs from 'node:fs';
import path from 'node:path';

// ---------- small shared text helpers ----------
const read = (p) => fs.readFileSync(p, 'utf8');
const tryRead = (p) => { try { return read(p); } catch { return null; } };
const firstLines = (s, n) => s.split('\n').slice(0, n).join('\n');

export function titleOf(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).slice(0, 200).trim();
}

// Visible text of an HTML document (scripts/styles/comments/tags stripped, entities decoded).
export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Leading doc-comment block from the first N lines of a source file, language-aware.
//   Rust   //!  / ///        C-style /** ... */ or // leading run
//   Python/JS module docstring """ ... """  or  # leading run
// Returns '' when there is no leading doc block.
export function docBlock(text, n = 40) {
  const head = text.split('\n').slice(0, n);
  // Rust //! and /// runs
  const rust = head.filter((l) => /^\s*\/\/[!/]/.test(l))
    .map((l) => l.replace(/^\s*\/\/[!/]\s?/, '')).join('\n').trim();
  if (rust) return rust;
  // JSDoc / C-style /** ... */ at the very top
  const joined = head.join('\n');
  const block = joined.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (block) {
    return block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n').trim();
  }
  // Python / triple-quoted module docstring
  const py = joined.match(/^\s*(?:[rRbBuU]{0,2})("""|''')([\s\S]*?)\1/);
  if (py) return py[2].trim();
  // leading run of #-prefixed comment lines (shell / python / toml)
  const hash = head.filter((l) => /^\s*#/.test(l) && !/^\s*#!/.test(l))
    .map((l) => l.replace(/^\s*#\s?/, '')).join('\n').trim();
  return hash;
}

// Resolve a list of root-relative roots to absolute dirs that exist under the repo.
function resolveRoots(ctx, roots) {
  const out = [];
  for (const r of roots || []) {
    const abs = r === '.' ? ctx.repoDir : path.join(ctx.repoDir, r);
    if (fs.existsSync(abs)) out.push(abs);
  }
  return out;
}

const hasExt = (p, exts) => !exts || !exts.length || exts.includes(path.extname(p).toLowerCase());

// ============================ RULE TYPES ============================

// mdSweepFullText — every prose file under the roots, full text (untruncated). De-duped by
// absolute path so a file already ingested (e.g. by literalFiles) is not added twice.
export function mdSweepFullText(ctx, rule) {
  const exts = rule.ext || ['.md', '.mdx', '.txt'];
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      if (ctx.alreadyIngested(p)) continue;
      const rel = ctx.rel(p);
      const text = read(p);
      let kind = 'doc';
      if (/(^|\/)adrs?\//i.test(rel) || /(^|\/)adr[-_]/i.test(rel)) kind = 'adr';
      else if (/(^|\/)tutorials?\//i.test(rel)) kind = 'tutorial';
      ctx.addDoc(rel, kind, titleOf(text, path.basename(p)), text, p);
      n++;
    }
  }
  return n;
}

// componentManifests — each component's package.json (or Cargo.toml) summarized so "what packages
// make up X" and dependency questions resolve. Walks each componentRoot's immediate children.
export function componentManifests(ctx, rule) {
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const cdir = path.join(root, dirent.name);
      // npm manifest
      const pkgPath = path.join(cdir, 'package.json');
      const pkg = tryRead(pkgPath);
      if (pkg) {
        try {
          const j = JSON.parse(pkg);
          const scripts = j.scripts ? Object.entries(j.scripts).map(([k, v]) => `  ${k}: ${v}`).join('\n') : '';
          const bin = j.bin ? (typeof j.bin === 'string' ? j.bin : Object.keys(j.bin).join(', ')) : '';
          const deps = Object.keys(j.dependencies || {});
          const dev = Object.keys(j.devDependencies || {});
          const text =
            `npm package: ${j.name || dirent.name}\nVersion: ${j.version || ''}\nPath: ${ctx.rel(pkgPath)}\n` +
            `Description: ${j.description || ''}\n` +
            (bin ? `Bin: ${bin}\n` : '') +
            (j.type ? `Module type: ${j.type}\n` : '') +
            (scripts ? `Scripts:\n${scripts}\n` : '') +
            (deps.length ? `Dependencies: ${deps.join(', ')}\n` : '') +
            (dev.length ? `DevDependencies: ${dev.join(', ')}\n` : '') +
            (j.keywords?.length ? `Keywords: ${j.keywords.join(', ')}\n` : '');
          ctx.addDoc(ctx.rel(pkgPath), 'npm', j.name || dirent.name, text, pkgPath);
          n++;
        } catch {
          ctx.addDoc(ctx.rel(pkgPath), 'npm', dirent.name, `npm package manifest (unparseable) at ${ctx.rel(pkgPath)}`, pkgPath);
          n++;
        }
      }
      // Cargo manifest (mixed monorepos)
      const cargoPath = path.join(cdir, 'Cargo.toml');
      const cargo = tryRead(cargoPath);
      if (cargo) {
        const name = (cargo.match(/^name\s*=\s*"([^"]*)"/m) || [])[1] || dirent.name;
        const desc = (cargo.match(/^description\s*=\s*"([^"]*)"/m) || [])[1] || '';
        ctx.addDoc(ctx.rel(cargoPath), 'crate', name,
          `Crate: ${name}\nDescription: ${desc}\nPath: ${ctx.rel(cargoPath)}\n\n${cargo}`, cargoPath);
        n++;
      }
    }
  }
  return n;
}

// componentLead — each component's README (full text) + the leading doc block of its lead source
// file (index/lib/main). Gives every component an orientation entry under componentRoots.
export function componentLead(ctx, rule) {
  const leadCandidates = rule.leads || [
    'README.md', 'readme.md', 'src/index.ts', 'src/index.js', 'src/lib.rs', 'src/main.rs',
    'index.ts', 'index.js', 'lib.rs', 'main.rs',
  ];
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const cdir = path.join(root, dirent.name);
      // README full text
      for (const rd of ['README.md', 'readme.md', 'README.mdx']) {
        const rp = path.join(cdir, rd);
        if (fs.existsSync(rp) && !ctx.alreadyIngested(rp)) {
          const text = read(rp);
          ctx.addDoc(ctx.rel(rp), 'doc', titleOf(text, dirent.name), text, rp);
          n++;
          break;
        }
      }
      // lead source doc-block (orientation, not full body — sourceBodies covers bodies)
      const lead = leadCandidates.map((f) => path.join(cdir, f)).find((p) => fs.existsSync(p));
      if (lead) {
        const text = read(lead);
        const doc = docBlock(text, 200);
        if (doc) {
          ctx.addDoc(ctx.rel(lead), 'crate-src', `${dirent.name} ${path.basename(lead)}`,
            `Component ${dirent.name} — ${path.basename(lead)} leading doc:\n${doc}`, /*absPath*/ undefined);
          n++;
        }
      }
    }
  }
  return n;
}

// sourceBodies — full file bodies of implementing source under the roots, chunked like docs.
// SCOPE: files under any `/src/` dir, or crate/module roots (lib/main/mod/index). Excludes
// tests/benches and minified output. Tagged kind:'source'.
export function sourceBodies(ctx, rule) {
  const exts = (rule.ext || ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.py', '.go']).map((e) => e.toLowerCase());
  const ROOTS_FILE = /(^|\/)(lib\.rs|main\.rs|mod\.rs|index\.ts|index\.js|index\.mjs)$/i;
  const MINIFIED = /\.(min|bundle)\.(js|css|mjs)$/i;
  const TESTY = /(^|\/)(tests?|benches?|__tests__|__mocks__|spec)\//i;
  const inScope = (rel) => {
    if (MINIFIED.test(rel)) return false;
    if (TESTY.test(rel)) return false;
    if (/(^|\/)src\//.test(rel)) return true;
    return ROOTS_FILE.test(rel);
  };
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      const rel = ctx.rel(p);
      if (!inScope(rel)) continue;
      if (ctx.isFullBody(p)) continue;
      const body = read(p);
      if (!body.trim()) continue;
      ctx.markFullBody(p);
      ctx.addDoc(rel, 'source', path.basename(p), `Source ${rel} (full):\n${body}`, /*absPath*/ undefined);
      n++;
    }
  }
  return n;
}

// testsAndExamples — full bodies of TEST / EXAMPLE / BENCH source files under the roots. These are
// the single best USAGE documentation a repo has (real call sites + expected results), so they are
// ingested deliberately (sourceBodies excludes them on purpose; this rule is the complement). The
// source_type tagger in build-kb.mjs marks each as 'test' or 'example' from its path. kind stays
// 'source' so the existing source-routing/reranking treats them like code.
export function testsAndExamples(ctx, rule) {
  const exts = (rule.ext || ['.rs', '.ts', '.tsx', '.js', '.mjs']).map((e) => e.toLowerCase());
  const IS_TEST_OR_EX = /(^|\/)(tests?|benches?|examples?|__tests__|spec)\//i;
  const NAMED_TEST = /[._-](test|spec)\.[a-z]+$|\.test$/i;
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      const rel = ctx.rel(p);
      if (!IS_TEST_OR_EX.test(rel) && !NAMED_TEST.test(rel)) continue;
      if (ctx.isFullBody(p)) continue;        // already ingested (shouldn't happen — sourceBodies skips these)
      const body = read(p);
      if (!body.trim()) continue;
      ctx.markFullBody(p);
      const isEx = /(^|\/)(examples?|demos?)\//i.test(rel);
      const label = isEx ? 'Example' : 'Test';
      ctx.addDoc(rel, 'source', path.basename(p), `${label} ${rel} (full):\n${body}`, /*absPath*/ undefined);
      n++;
    }
  }
  return n;
}

// docCommentSweep — leading doc comment ONLY from every source file under the roots that has one
// and is NOT already indexed as a full body. Cheap orientation breadcrumbs across the whole tree.
export function docCommentSweep(ctx, rule) {
  const exts = (rule.ext || ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.py', '.go']).map((e) => e.toLowerCase());
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      if (ctx.isFullBody(p)) continue;   // already ingested in full by sourceBodies
      const doc = docBlock(firstLines(read(p), 40), 40);
      if (!doc) continue;
      const rel = ctx.rel(p);
      ctx.addDoc(rel, 'crate-src', path.basename(p), `Module ${rel} — doc comment:\n${doc}`, /*absPath*/ undefined);
      n++;
    }
  }
  return n;
}

// literalFiles — an explicit list of root-relative files, full text. Guarantees key docs (README,
// OVERVIEW, ARCHITECTURE, …) are in the corpus regardless of the sweep roots. De-duped by path.
export function literalFiles(ctx, rule) {
  let n = 0;
  for (const f of rule.files || []) {
    const abs = path.join(ctx.repoDir, f);
    if (!fs.existsSync(abs) || ctx.alreadyIngested(abs)) continue;
    const text = read(abs);
    const rel = ctx.rel(abs);
    let kind = 'doc';
    if (/(^|\/)adrs?\//i.test(rel) || /(^|\/)adr[-_]/i.test(rel)) kind = 'adr';
    ctx.addDoc(rel, kind, titleOf(text, path.basename(abs)), text, abs);
    n++;
  }
  return n;
}

// htmlText — visible text content of *.html under the roots. Tagged kind:'ui'.
export function htmlText(ctx, rule) {
  const exts = ['.html', '.htm'];
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      const text = htmlToText(read(p));
      if (!text) continue;
      const rel = ctx.rel(p);
      ctx.addDoc(rel, 'ui', path.basename(p), `UI page ${rel} full text content:\n${text}`, p);
      n++;
    }
  }
  return n;
}

// templates — scaffolding templates (.tmpl/.hbs/.handlebars): path + first-N-lines, kind:'template'.
// These are the bulk of "what does a generated harness contain" — neither prose nor runnable source,
// so we index a head sample + the path (decided IN, not skipped — plan top risk #2).
export function templates(ctx, rule) {
  const exts = (rule.ext || ['.tmpl', '.hbs', '.handlebars']).map((e) => e.toLowerCase());
  const headLines = rule.headLines || 40;
  let n = 0;
  for (const root of resolveRoots(ctx, rule.roots)) {
    for (const p of ctx.walk(root)) {
      if (!hasExt(p, exts)) continue;
      const rel = ctx.rel(p);
      const body = read(p);
      const head = firstLines(body, headLines);
      ctx.addDoc(rel, 'template', path.basename(p),
        `Template ${rel} (first ${headLines} lines):\n${head}`, p);
      n++;
    }
  }
  return n;
}

// Registry: rule name -> implementation. build-kb.mjs dispatches config.include[] through this.
export const RULE_IMPLS = {
  mdSweepFullText,
  componentManifests,
  componentLead,
  sourceBodies,
  testsAndExamples,
  docCommentSweep,
  literalFiles,
  htmlText,
  templates,
};

export default RULE_IMPLS;
