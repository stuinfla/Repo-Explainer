#!/usr/bin/env node
// extract-symbols.mjs — GENERIC, config-driven symbol/API index extractor.
//
// Emits kb/stores/<slug>/<slug>-symbols.json: every public symbol an AI needs to USE the
// repo — name, kind, signature, module/crate path, doc summary, source location.
//
// Strategy (best-available, graceful fallback):
//   Rust:  prefer `cargo +nightly rustdoc -p <crate> -- -Z unstable-options --output-format json`
//          (rich: real signatures + docs). If nightly/rustdoc-json is unavailable OR the build
//          fails, fall back to a ripgrep-style source scan of `pub fn|struct|enum|trait|mod` +
//          the leading doc-comment.
//   TS/JS: ripgrep-style scan of `export ...` (function/class/interface/type/const) + JSDoc.
//
// Repo shape is DATA (kb.config.mjs target: repoDir, scopeExclude, componentRoots, codeExt). NO
// repo name is baked in here. Ships in the drop-in for-ai/ so the AI gets EXACT API lookups.
//
// Usage: node kb/extract-symbols.mjs --target ruqu  [--no-rustdoc]
//        node kb/extract-symbols.mjs ruqu

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTarget, defaultTarget } from './kb.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { target: defaultTarget, rustdoc: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (v === '--no-rustdoc') a.rustdoc = false;
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

// First sentence/line of a doc string, normalized to one line.
function docSummary(doc) {
  if (!doc) return null;
  const firstPara = doc.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return firstPara.slice(0, 280) || null;
}

// ---------------- rustdoc-json type rendering ----------------
// Render a rustdoc `type` node into a readable, lossy-but-useful Rust-ish string.
function renderType(t) {
  if (t == null) return '_';
  if (typeof t === 'string') return t;
  const k = Object.keys(t)[0];
  const v = t[k];
  switch (k) {
    case 'primitive': return v;
    case 'generic': return v;
    case 'resolved_path': {
      const name = (v.path || '').split('::').pop() || v.path;
      const args = v.args && v.args.angle_bracketed && v.args.angle_bracketed.args || [];
      const inner = args.map((a) => (a.type ? renderType(a.type) : (a.lifetime || ''))).filter(Boolean);
      return inner.length ? `${name}<${inner.join(', ')}>` : name;
    }
    case 'borrowed_ref': return `&${v.is_mutable ? 'mut ' : ''}${renderType(v.type)}`;
    case 'tuple': return `(${(v || []).map(renderType).join(', ')})`;
    case 'slice': return `[${renderType(v)}]`;
    case 'array': return `[${renderType(v.type)}; ${v.len}]`;
    case 'raw_pointer': return `*${v.is_mutable ? 'mut ' : 'const '}${renderType(v.type)}`;
    case 'qualified_path': return v.name || 'Self::_';
    case 'impl_trait': return 'impl _';
    case 'dyn_trait': return 'dyn _';
    default: return '_';
  }
}

function renderFnSig(name, fn) {
  const inputs = (fn.sig?.inputs || []).map(([pn, pt]) => `${pn}: ${renderType(pt)}`).join(', ');
  const out = fn.sig?.output ? ` -> ${renderType(fn.sig.output)}` : '';
  const asyncK = fn.header?.is_async ? 'async ' : '';
  const unsafeK = fn.header?.is_unsafe ? 'unsafe ' : '';
  return `${asyncK}${unsafeK}fn ${name}(${inputs})${out}`;
}

// Extract symbols from a single rustdoc-json file (local crate items only). Expands struct FIELDS
// and impl METHODS so "what are the fields of X" / "what methods does Y have" resolve exactly.
function symbolsFromRustdoc(jsonPath, crateName) {
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const idx = j.index || {};
  const paths = j.paths || {};
  const out = [];
  const get = (id) => idx[id];

  // Render a struct's fields into a compact "{ name: Type, … }" string + emit per-field symbols.
  const renderStructFields = (st, parentName) => {
    const k = st.kind || {};
    const fieldIds = k.plain ? (k.plain.fields || []) : (Array.isArray(k.fields) ? k.fields : []);
    const fields = [];
    for (const fid of fieldIds) {
      const f = get(fid);
      if (!f || !f.name) continue;
      const ty = f.inner && f.inner.struct_field ? renderType(f.inner.struct_field) : '_';
      fields.push(`${f.name}: ${ty}`);
    }
    return fields;
  };

  // Collect impl methods for a type id (its inherent + trait impls), as fn symbols on the type.
  const methodsForType = (st, parentName, parentSpanFile) => {
    const methods = [];
    for (const implId of (st.impls || [])) {
      const im = get(implId);
      if (!im || !im.inner || !im.inner.impl) continue;
      const impl = im.inner.impl;
      // skip auto/blanket trait impls without our crate's items
      for (const mid of (impl.items || [])) {
        const m = get(mid);
        if (!m || !m.name || !m.inner || !m.inner.function) continue;
        if (m.crate_id !== 0) continue;
        const sig = renderFnSig(m.name, m.inner.function);
        methods.push({
          name: m.name, kind: 'method', signature: `${parentName}::${sig}`,
          module: `${crateName}::${parentName}`, crate: crateName, doc: docSummary(m.docs),
          file: m.span ? m.span.filename : parentSpanFile, line: m.span && m.span.begin ? m.span.begin[0] : null,
          source: 'rustdoc-json',
        });
      }
    }
    return methods;
  };

  for (const [id, it] of Object.entries(idx)) {
    if (it.crate_id !== 0) continue;            // local crate only
    if (!it.name || !it.span) continue;         // authored item with a source span
    const inner = it.inner || {};
    const kind = Object.keys(inner)[0];
    if (!['function', 'struct', 'enum', 'trait', 'module', 'type_alias', 'constant'].includes(kind)) continue;
    if (it.visibility && it.visibility !== 'public' && it.visibility !== 'default') continue;
    const modPath = (paths[id] && paths[id].path) ? paths[id].path.join('::') : `${crateName}::${it.name}`;
    let signature;
    if (kind === 'function') signature = renderFnSig(it.name, inner.function);
    else if (kind === 'struct') {
      const fields = renderStructFields(inner.struct, it.name);
      signature = fields.length ? `struct ${it.name} { ${fields.join(', ')} }` : `struct ${it.name}`;
    } else if (kind === 'enum') {
      const variants = (inner.enum.variants || []).map((vid) => { const v = get(vid); return v && v.name; }).filter(Boolean);
      signature = variants.length ? `enum ${it.name} { ${variants.join(', ')} }` : `enum ${it.name}`;
    } else if (kind === 'trait') signature = `trait ${it.name}`;
    else if (kind === 'module') signature = `mod ${it.name}`;
    else if (kind === 'type_alias') signature = `type ${it.name}`;
    else signature = `const ${it.name}`;
    out.push({
      name: it.name,
      kind: kind === 'function' ? 'fn' : kind,
      signature,
      module: modPath,
      crate: crateName,
      doc: docSummary(it.docs),
      file: it.span.filename,
      line: it.span.begin ? it.span.begin[0] : null,
      source: 'rustdoc-json',
    });
    // emit impl methods for structs/enums so "X's methods" resolves.
    if (kind === 'struct') out.push(...methodsForType(inner.struct, it.name, it.span.filename));
    else if (kind === 'enum') out.push(...methodsForType(inner.enum, it.name, it.span.filename));
  }
  return out;
}

// ---------------- ripgrep-style source fallback ----------------
// Leading doc-comment ABOVE a line index (Rust /// //!, or JSDoc /** */).
function leadingDoc(lines, i) {
  const acc = [];
  let j = i - 1;
  // JSDoc block
  if (/^\s*\*\//.test(lines[j] || '')) {
    const block = [];
    while (j >= 0 && !/\/\*\*/.test(lines[j])) { block.unshift(lines[j]); j--; }
    return block.map((l) => l.replace(/^\s*\*\s?/, '').replace(/\*\/\s*$/, '')).join('\n').trim();
  }
  while (j >= 0 && /^\s*\/\/[!/]/.test(lines[j])) { acc.unshift(lines[j].replace(/^\s*\/\/[!/]\s?/, '')); j--; }
  return acc.join('\n').trim();
}

const RUST_SYM = /^\s*pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(fn|struct|enum|trait|mod|type|union)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const TS_SYM = /^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

function symbolsFromSourceScan(repoDir, skip, rel, codeExt) {
  const out = [];
  const exts = new Set((codeExt || ['.rs', '.ts', '.tsx', '.js', '.mjs']).map((e) => e.toLowerCase()));
  for (const p of walk(repoDir, skip)) {
    const ext = path.extname(p).toLowerCase();
    if (!exts.has(ext)) continue;
    const text = tryRead(p);
    if (!text) continue;
    const lines = text.split('\n');
    const isRust = ext === '.rs';
    const re = isRust ? RUST_SYM : TS_SYM;
    // crate = first path segment under componentRoots (best-effort)
    const relp = rel(p);
    const crate = relp.split('/').slice(0, 2).join('/');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      let [, kw, name] = m;
      const kindMap = { fn: 'fn', function: 'fn', struct: 'struct', class: 'class', enum: 'enum', trait: 'trait', interface: 'interface', mod: 'module', type: 'type_alias', union: 'struct', const: 'const' };
      const kind = kindMap[kw] || kw;
      const signature = lines[i].trim().replace(/\s*\{?\s*$/, '').slice(0, 240);
      out.push({
        name, kind, signature,
        module: crate.replace(/\//g, '::'),
        crate, doc: docSummary(leadingDoc(lines, i)),
        file: relp, line: i + 1, source: 'source-scan',
      });
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = getTarget(args.target);
  const slug = args.target;
  const repoDir = path.resolve(__dirname, target.repoDir);
  if (!fs.existsSync(repoDir)) { console.error(`[symbols] repoDir not found: ${repoDir}`); process.exit(1); }
  const skip = new Set(target.scopeExclude || []);
  const rel = (p) => path.relative(repoDir, p);

  let symbols = [];
  let method = 'source-scan';

  // ---- Rust: try rustdoc-json per workspace crate ----
  const rootCargo = tryRead(path.join(repoDir, 'Cargo.toml'));
  const isRust = !!rootCargo;
  if (isRust && args.rustdoc) {
    const members = [...(rootCargo.matchAll(/members\s*=\s*\[([\s\S]*?)\]/g))]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const crateNames = [];
    for (const mem of members) {
      const cargo = tryRead(path.join(repoDir, mem, 'Cargo.toml'));
      const name = cargo && (cargo.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1];
      if (name) crateNames.push(name);
    }
    var rustdocCrates = new Set();   // crate dirs (member paths) rustdoc actually covered
    let anyDoc = false;
    for (let mi = 0; mi < members.length; mi++) {
      const cn = crateNames[mi];
      if (!cn) continue;
      try {
        execFileSync('cargo', ['+nightly', 'rustdoc', '-p', cn, '--', '-Z', 'unstable-options', '--output-format', 'json'],
          { cwd: repoDir, stdio: ['ignore', 'ignore', 'ignore'], timeout: 240000 });
      } catch (e) {
        console.warn(`[symbols] rustdoc failed for ${cn} (${e.message?.slice(0, 60)}); will source-scan that crate instead`);
        continue;
      }
      const docJson = path.join(repoDir, 'target', 'doc', `${cn.replace(/-/g, '_')}.json`);
      if (fs.existsSync(docJson)) {
        const syms = symbolsFromRustdoc(docJson, cn);
        symbols.push(...syms);
        anyDoc = true;
        rustdocCrates.add(members[mi]);   // e.g. "crates/ruqu-core"
        console.log(`[symbols] rustdoc ${cn}: ${syms.length} symbols`);
      }
    }
    if (anyDoc) method = symbols.length ? 'rustdoc-json' : 'source-scan';
    var rustdocMemberSet = rustdocCrates;
  }

  // ---- Fallback / complement: source scan for any file type not covered by rustdoc-json ----
  // Always run the source scan for NON-.rs files (TS/JS), and for .rs files if rustdoc produced
  // nothing. De-dup by (file,name,kind) so rustdoc wins where it ran.
  const seen = new Set(symbols.map((s) => `${s.file}|${s.name}|${s.kind}`));
  const scan = symbolsFromSourceScan(repoDir, skip, rel, target.codeExt);
  const haveRustdoc = method === 'rustdoc-json';
  const coveredByRustdoc = (typeof rustdocMemberSet !== 'undefined') ? rustdocMemberSet : new Set();
  // A .rs file is authoritatively covered ONLY if its crate member dir was rustdoc'd. Crates whose
  // rustdoc failed (e.g. a build error) still get their public symbols from the source scan.
  const fileCoveredByRustdoc = (relp) => {
    for (const mem of coveredByRustdoc) { if (relp === mem || relp.startsWith(mem + '/')) return true; }
    return false;
  };
  for (const s of scan) {
    if (haveRustdoc && s.file.endsWith('.rs') && fileCoveredByRustdoc(s.file)) continue;
    const key = `${s.file}|${s.name}|${s.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    symbols.push(s);
  }
  if (!haveRustdoc) method = 'source-scan';

  // Sort: by crate, then file, then line.
  symbols.sort((a, b) => (a.crate || '').localeCompare(b.crate || '') || (a.file || '').localeCompare(b.file || '') || (a.line || 0) - (b.line || 0));

  // Stats by kind + by crate.
  const byKind = {}, byCrate = {};
  for (const s of symbols) { byKind[s.kind] = (byKind[s.kind] || 0) + 1; byCrate[s.crate] = (byCrate[s.crate] || 0) + 1; }

  const out = {
    target: slug, metaName: target.metaName, generated: new Date().toISOString(),
    method, count: symbols.length, byKind, byCrate, symbols,
  };
  const storeDir = path.join(__dirname, 'stores', slug);
  fs.mkdirSync(storeDir, { recursive: true });
  const outFile = path.join(storeDir, `${slug}-symbols.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`[symbols] ${slug}: ${symbols.length} symbols via ${method}`);
  console.log(`[symbols] byKind ${JSON.stringify(byKind)}`);
  console.log(`[symbols] wrote ${path.relative(__dirname, outFile)}`);
}

main();
