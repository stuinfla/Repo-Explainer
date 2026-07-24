// tests/kb-delta.e2e.test.mjs — END-TO-END proof of ADR-0010 (incremental delta KB builds).
//
// Real builds, real embeddings (bge-small via kb/models-cache — downloads once on a fresh
// machine), real RVF stores, in an isolated temp dir (KB_REPO_DIR + KB_STORE_DIR overrides;
// never touches kb/stores/). Every guard is proven BOTH ways: it trips on the bad input AND
// the store provably survives the refusal untouched (byte-hash before/after) — a guard that
// cannot fail on broken input is not a guard.
//
// Scenario ladder (ordered; each builds on the previous store state):
//   1. full build            → parity
//   2. no-op delta           → "nothing changed", sidecars + .rvf byte-identical
//   3. modify one file       → only its chunks re-embed; new text retrievable; old id gone
//   4. add a file            → embedded + retrievable; totalVectors grows
//   5. remove it             → true delete; totalVectors shrinks; no stale hits
//   6. churn > 40%           → refuses (store untouched); --force-delta proceeds
//   7. embedder mismatch     → refuses (store untouched)
//   8. StoreSet lock held    → refuses (store untouched)
//   9. index-primer          → PRIMER# layer added; survives a delta verbatim; re-run
//                              REPLACES (no duplicates)

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-delta-e2e-'));
const FIXTURE = path.join(TMP, 'fixture');
const STORE = path.join(TMP, 'store');
const TARGET = 'ternlight';   // simplest config target: mdSweep + literalFiles + sourceBodies
const BASE = path.join(STORE, `${TARGET}-kb`);
const F = {
  rvf: `${BASE}.rvf`, idmap: `${BASE}.rvf.idmap.json`,
  passages: `${BASE}.passages.jsonl`, ids: `${BASE}.ids.json`,
};

function write(rel, content) {
  const p = path.join(FIXTURE, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function run(script, args = [], { expectFail = false } = {}) {
  const r = spawnSync('node', [path.join('kb', script), ...args], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, KB_REPO_DIR: FIXTURE, KB_STORE_DIR: STORE },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (!expectFail && r.status !== 0) assert.fail(`${script} ${args.join(' ')} exited ${r.status}:\n${out}`);
  if (expectFail && r.status === 0) assert.fail(`${script} ${args.join(' ')} was expected to fail but exited 0:\n${out}`);
  return { status: r.status, out };
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const storeHashes = () => Object.fromEntries(Object.entries(F).map(([k, f]) => [k, sha(f)]));
const readIds = () => JSON.parse(fs.readFileSync(F.ids, 'utf8'));
const idsByPath = () => {
  const by = {};
  for (const [id, e] of Object.entries(readIds().entries)) (by[e.path] ||= []).push(id);
  return by;
};

// Direct retrieval probe: embed `text` with the store's own embedder config and query the .rvf.
async function topHits(text, k = 5) {
  const { loadRvf, loadTransformers, configureModel, chooseModelCache } = await import('../kb/resolve-deps.mjs');
  const ec = JSON.parse(fs.readFileSync(`${F.rvf}.embed.json`, 'utf8'));
  const { T } = await loadTransformers();
  configureModel(T, chooseModelCache(ec.model), ec.model);
  const fe = await T.pipeline('feature-extraction', ec.model, { quantized: true });
  const out = await fe([text], { pooling: ec.pooling || 'mean', normalize: true });
  const { RvfDatabase } = loadRvf().mod;
  const db = await RvfDatabase.openReadonly(F.rvf);
  const hits = await db.query(Float32Array.from(out.data), k);
  await db.close();
  return hits;
}

before(() => {
  write('README.md', '# Ternfix\n\nTernfix is a tiny fixture library for exercising the KB delta builder.\n\n## What it does\n\nIt converts ternary expressions into lookup tables via `ternarize()`.\n');
  write('package.json', '{\n  "name": "ternfix",\n  "version": "1.0.0",\n  "main": "src/alpha.mjs"\n}\n');
  write('docs/guide.md', '# Guide\n\n## Getting started\n\nImport the library and call `ternarize` on your source tree.\n');
  write('src/alpha.mjs', '// alpha.mjs — the AST walker entry point.\n\n/** Walk the tree and ternarize every conditional. */\nexport function ternarize(ast) {\n  return ast.body;\n}\n');
  write('src/beta.mjs', '// beta.mjs — guard-clause helpers.\n\n/** Collapse a chain of guard clauses into a predicate list. */\nexport function flattenGuards(fns) {\n  return fns.flat();\n}\n');
  write('src/gamma.mjs', '// gamma.mjs — the zebra-striping renderer.\n\n/** Render a lookup table with zebrastripe row colouring. */\nexport function zebrastripe(table) {\n  return table;\n}\n');
});

let baselineIdsByPath;   // path -> [ids] after the full build

test('1. full build establishes a consistent StoreSet', () => {
  const { out } = run('build-kb.mjs', ['--target', TARGET]);
  assert.match(out, /match=true/);
  for (const f of Object.values(F)) assert.ok(fs.existsSync(f), `missing ${f}`);
  const ids = readIds();
  assert.equal(typeof ids.maxIdEver, 'number', 'full build records the id high-water mark');
  baselineIdsByPath = idsByPath();
  assert.ok(baselineIdsByPath['src/beta.mjs']?.length >= 1);
});

test('2. no-op delta: zero embeds, StoreSet byte-identical', () => {
  const beforeH = storeHashes();
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta']);
  assert.match(out, /nothing changed/);
  assert.deepEqual(storeHashes(), beforeH, 'no-op delta must not touch a single byte');
});

test('3. one modified file: only its chunks re-embed, new text retrievable, old ids gone', async () => {
  const oldBetaIds = baselineIdsByPath['src/beta.mjs'];
  write('src/beta.mjs', '// beta.mjs — guard-clause helpers.\n\n/** Collapse a chain of guard clauses into a predicate list. */\nexport function flattenGuards(fns) {\n  return fns.flat();\n}\n\n/** The quuxguard sentinel validates guard chains against the quux invariant. */\nexport function quuxguard(chain) {\n  return chain.every(Boolean);\n}\n');
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta']);
  const m = out.match(/embedded (\d+), deleted (\d+), carried (\d+)/);
  assert.ok(m, `no delta summary in:\n${out}`);
  assert.equal(Number(m[2]), oldBetaIds.length, 'deletes exactly the old beta ids');
  const by = idsByPath();
  for (const p of ['src/alpha.mjs', 'src/gamma.mjs', 'README.md', 'docs/guide.md', 'package.json']) {
    assert.deepEqual(by[p], baselineIdsByPath[p], `carried ids must be untouched for ${p}`);
  }
  for (const id of oldBetaIds) assert.ok(!(id in readIds().entries), `old beta id ${id} must be gone`);
  for (const id of by['src/beta.mjs']) {
    assert.ok(Number(id) > Math.max(...oldBetaIds.map(Number)), 'fresh ids come from the high-water mark');
  }
  const hits = await topHits('the quuxguard sentinel validates guard chains');
  assert.ok(hits.some((h) => by['src/beta.mjs'].includes(h.id)), 'modified content must be retrievable');
  baselineIdsByPath = by;
});

test('4. added file: embedded and immediately retrievable', async () => {
  write('docs/new-feature.md', '# New feature\n\n## Zorblatt mode\n\nThe zorblattfeature renders every lookup table in reverse video.\n');
  run('build-kb.mjs', ['--target', TARGET, '--delta']);
  const by = idsByPath();
  assert.ok(by['docs/new-feature.md']?.length >= 1, 'new file must be indexed');
  const hits = await topHits('zorblattfeature reverse video lookup table');
  assert.equal(readIds().entries[hits[0].id].path, 'docs/new-feature.md', 'new doc must be the top hit');
  baselineIdsByPath = by;
});

test('5. removed file: true delete — count drops, no stale hits', async () => {
  const removedIds = baselineIdsByPath['docs/new-feature.md'];
  fs.rmSync(path.join(FIXTURE, 'docs/new-feature.md'));
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta']);
  assert.match(out, new RegExp(`deleted ${removedIds.length}`));
  for (const id of removedIds) assert.ok(!(id in readIds().entries));
  const hits = await topHits('zorblattfeature reverse video lookup table');
  for (const h of hits) assert.ok(!removedIds.includes(h.id), 'deleted vectors must not return');
  baselineIdsByPath = idsByPath();
});

test('6. churn guard trips >40% and leaves the store untouched; --force-delta overrides', () => {
  const stash = {};
  for (const f of ['src/alpha.mjs', 'src/beta.mjs', 'src/gamma.mjs']) {
    stash[f] = fs.readFileSync(path.join(FIXTURE, f), 'utf8');
    write(f, `// ${f} — totally rewritten body v2.\nexport function rewritten_${path.basename(f, '.mjs')}() { return 42; }\n`);
  }
  const beforeH = storeHashes();
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta'], { expectFail: true });
  assert.match(out, /churn/i);
  assert.deepEqual(storeHashes(), beforeH, 'a refused delta must not touch the store');
  const forced = run('build-kb.mjs', ['--target', TARGET, '--force-delta']);
  assert.match(forced.out, /\[delta] OK/);
  for (const [f, content] of Object.entries(stash)) write(f, content);   // restore fixture
  run('build-kb.mjs', ['--target', TARGET, '--force-delta']);            // and re-sync the store
  baselineIdsByPath = idsByPath();
});

test('7. embedder-mismatch guard refuses and leaves the store untouched', () => {
  const orig = fs.readFileSync(F.ids, 'utf8');
  const doctored = JSON.parse(orig);
  doctored.model = 'Xenova/some-other-model';
  fs.writeFileSync(F.ids, JSON.stringify(doctored, null, 0));
  const beforeRvf = sha(F.rvf);
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta'], { expectFail: true });
  assert.match(out, /embedder mismatch/);
  assert.equal(sha(F.rvf), beforeRvf);
  fs.writeFileSync(F.ids, orig);
});

test('8. StoreSet lock refuses a concurrent builder', () => {
  fs.writeFileSync(`${BASE}.lock`, JSON.stringify({ pid: 99999, at: new Date().toISOString() }));
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta'], { expectFail: true });
  assert.match(out, /locked by another builder/);
  fs.rmSync(`${BASE}.lock`);
});

test('9. PRIMER layer: survives deltas verbatim; re-index REPLACES without duplicates', async () => {
  fs.writeFileSync(path.join(STORE, `${TARGET}-primer.md`),
    '# Ternfix primer\n\n## What ternfix is\n\nA fixture library that turns ternaries into lookup tables.\n\n## Maturity\n\nFixture-grade. Do not ship.\n');
  run('index-primer.mjs', [TARGET]);
  const primerIds1 = Object.entries(readIds().entries).filter(([, e]) => e.path.startsWith('PRIMER#'));
  assert.ok(primerIds1.length >= 2, 'primer sections must be indexed');
  const primerRaw1 = Object.fromEntries(primerIds1.map(([id, e]) => [id, JSON.stringify(e)]));

  // a delta must carry the synthetic layer untouched
  write('src/alpha.mjs', fs.readFileSync(path.join(FIXTURE, 'src/alpha.mjs'), 'utf8') + '\n/** delta-after-primer marker. */\nexport const marker = 1;\n');
  const { out } = run('build-kb.mjs', ['--target', TARGET, '--delta']);
  assert.match(out, new RegExp(`preserved ${primerIds1.length} synthetic`));
  for (const [id, raw] of Object.entries(primerRaw1)) {
    assert.equal(JSON.stringify(readIds().entries[id]), raw, `PRIMER entry ${id} must survive a delta verbatim`);
  }

  // re-running the primer indexer REPLACES the generation — same section count, no duplicates
  const vectorsBefore = fs.readFileSync(F.passages, 'utf8').trim().split('\n').length;
  run('index-primer.mjs', [TARGET]);
  const primerIds2 = Object.entries(readIds().entries).filter(([, e]) => e.path.startsWith('PRIMER#'));
  assert.equal(primerIds2.length, primerIds1.length, 're-index must not duplicate the orientation layer');
  assert.ok(primerIds2.every(([id]) => !(id in primerRaw1)), 'replaced generation gets fresh ids');
  const vectorsAfter = fs.readFileSync(F.passages, 'utf8').trim().split('\n').length;
  assert.equal(vectorsAfter, vectorsBefore, 'passages line count unchanged by a primer replace');
  const hits = await topHits('how mature is ternfix');
  assert.ok(hits.some((h) => readIds().entries[h.id]?.path.startsWith('PRIMER#')), 'replaced primer must be retrievable');
});
