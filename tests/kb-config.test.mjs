// The KB registry (kb/kb.config.mjs) and the builder's contract with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets } from '../kb/kb.config.mjs';
import { resolveEmbedder } from '../kb/build-kb.mjs';

const KB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'kb');

test('every registered target carries a usable embed block, and none embeds with a guessed model', () => {
  for (const [slug, t] of Object.entries(targets)) {
    const e = resolveEmbedder(t);
    assert.match(e.MODEL, /^Xenova\//, slug);
    assert.ok(Number.isInteger(e.DIM) && e.DIM > 0, `${slug} dim`);
  }
});

test('a target with no embed block (or no model/dim) is refused, not defaulted', () => {
  assert.throws(() => resolveEmbedder({ slug: 'x' }), /no embed block/);
  assert.throws(() => resolveEmbedder({ slug: 'x', embed: { model: 'Xenova/all-MiniLM-L6-v2' } }), /no embed block/);
  assert.throws(() => resolveEmbedder({ slug: 'x', embed: { dim: 384 } }), /no embed block/);
});

test('the published registry carries no machine-specific absolute repoDir', () => {
  for (const [slug, t] of Object.entries(targets)) {
    assert.ok(!path.isAbsolute(t.repoDir), `${slug}: ${t.repoDir}`);
    assert.doesNotMatch(t.repoDir, /Users|\/tmp|\/home/, slug);
  }
});

function run(code, env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('KB_TARGET_OVERLAY adds a per-build target without touching the tracked registry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-overlay-'));
  try {
    const overlay = path.join(dir, 'overlay.json');
    fs.writeFileSync(overlay, JSON.stringify({ 'zz-new-repo': { slug: 'zz-new-repo', metaName: 'ZZ', repoDir: '../x', embed: { model: 'Xenova/bge-small-en-v1.5', dim: 384 } } }));
    const code = `import { getTarget, targets } from ${JSON.stringify(path.join(KB, 'kb.config.mjs'))}; console.log(getTarget('zz-new-repo').metaName, Object.keys(targets).length);`;
    const withOverlay = run(code, { KB_TARGET_OVERLAY: overlay });
    assert.equal(withOverlay.status, 0, withOverlay.stderr);
    assert.match(withOverlay.stdout, /^ZZ \d+/);
    const without = run(code, { KB_TARGET_OVERLAY: '' });
    assert.notEqual(without.status, 0, 'unknown without the overlay');
    assert.match(without.stderr, /unknown target "zz-new-repo"/);
    assert.ok(!fs.readFileSync(path.join(KB, 'kb.config.mjs'), 'utf8').includes('zz-new-repo'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-kb exits non-zero, before loading any model, for an overlay target with no embed block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-overlay-'));
  try {
    const overlay = path.join(dir, 'overlay.json');
    fs.writeFileSync(overlay, JSON.stringify({ 'zz-noembed': { slug: 'zz-noembed', metaName: 'ZZ', repoDir: dir, include: [] } }));
    const r = spawnSync(process.execPath, [path.join(KB, 'build-kb.mjs'), '--target', 'zz-noembed'], { encoding: 'utf8', env: { ...process.env, KB_TARGET_OVERLAY: overlay, KB_STORE_DIR: dir }, timeout: 20000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no embed block/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
