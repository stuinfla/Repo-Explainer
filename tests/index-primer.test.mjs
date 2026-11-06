// index-primer is a library function as well as a CLI: importing it must not run or exit the process,
// and a failure must throw (the local pipeline catches it) instead of calling process.exit.
// The embedding/ingest path itself is covered by tests-e2e/kb-delta.e2e.test.mjs (needs the model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexPrimer, splitSections, slugify, readEmbedConfig, planPrimerReplace } from '../kb/index-primer.mjs';

test('indexPrimer rejects with MISSING when the store does not exist (no process.exit)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-primer-'));
  process.env.KB_STORE_DIR = dir;
  try {
    await assert.rejects(() => indexPrimer('nosuch', { log: () => {} }), /MISSING: .*nosuch-primer\.md/);
    fs.writeFileSync(path.join(dir, 'nosuch-primer.md'), '## A\n\ntext\n');
    await assert.rejects(() => indexPrimer('nosuch', { log: () => {} }), /MISSING: .*nosuch-kb\.rvf/);
  } finally { delete process.env.KB_STORE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('indexPrimer requires a slug', async () => {
  await assert.rejects(() => indexPrimer(''), /slug is required/);
});

test('splitSections splits on level-2 headers only, fence-aware, and folds the preamble into section 1', () => {
  const md = '# Title\n\nintro\n\n## One\n\n```sh\n## not a header\n```\n\n### sub\n\n## Two\n\nbody\n';
  const s = splitSections(md);
  assert.deepEqual(s.map((x) => x.title), ['One', 'Two']);
  assert.match(s[0].body, /^# Title[\s\S]*## One[\s\S]*## not a header[\s\S]*### sub/);
  assert.doesNotMatch(s[1].body, /sub/);
  assert.equal(slugify('3. What `X` is!'), '3-what-x-is');
});

test('readEmbedConfig throws when the store has no .embed.json (no silent MiniLM fallback)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-embcfg-'));
  try {
    assert.throws(() => readEmbedConfig(path.join(dir, 'x.rvf.embed.json'), { model: 'Xenova/bge-small-en-v1.5' }), /MISSING: .*x\.rvf\.embed\.json/);
    const p = path.join(dir, 'y.rvf.embed.json');
    fs.writeFileSync(p, '{not json');
    assert.throws(() => readEmbedConfig(p, {}), /UNREADABLE/);
    fs.writeFileSync(p, JSON.stringify({ pooling: 'mean' }));
    assert.throws(() => readEmbedConfig(p, {}), /no model/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readEmbedConfig rejects a sidecar whose model differs from ids.json (same-dimension wrong-model vectors)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-embcfg-'));
  try {
    const p = path.join(dir, 'z.rvf.embed.json');
    fs.writeFileSync(p, JSON.stringify({ model: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean' }));
    assert.throws(() => readEmbedConfig(p, { model: 'Xenova/bge-small-en-v1.5' }), /embedder mismatch.*bge-small.*MiniLM/);
    const ok = readEmbedConfig(p, { model: 'Xenova/all-MiniLM-L6-v2' });
    assert.equal(ok.model, 'Xenova/all-MiniLM-L6-v2');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('planPrimerReplace drops exactly the old PRIMER# generation and never reuses an id (ADR-0010 D6)', () => {
  const row = (id, p) => ({ id: String(id), path: p, raw: JSON.stringify({ id: String(id), path: p }) });
  const prev = [row(1, 'README.md'), row(2, 'src/a.rs'), row(3, 'PRIMER#one'), row(4, 'PRIMER#two'), row(9, 'PRIMER#two')];
  const idx = { maxIdEver: 7, entries: { 1: {}, 2: {}, 3: {}, 4: {}, 9: {} } };
  const plan = planPrimerReplace(prev, idx);
  assert.deepEqual(plan.oldPrimer.map((r) => r.id), ['3', '4', '9']);
  assert.deepEqual(plan.keepLines.map((l) => JSON.parse(l).id), ['1', '2']);
  assert.deepEqual(Object.keys(idx.entries).sort(), ['1', '2'], 'old primer ids leave the index');
  assert.equal(plan.startId, 9, 'new ids start above the highest id ever seen, including the dropped ones');
  // a second run on the already-replaced store finds nothing to drop and keeps every corpus row
  const again = planPrimerReplace([row(1, 'README.md'), row(2, 'src/a.rs'), row(10, 'PRIMER#one')], { maxIdEver: 10, entries: {} });
  assert.equal(again.oldPrimer.length, 1);
  assert.equal(again.keepLines.length, 2);
});
