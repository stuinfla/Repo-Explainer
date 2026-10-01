// tests/local-source.test.mjs — a local filesystem path as the source repo.
//
// A repo with no reachable clone URL (private infra, air-gapped, or "I have the folder, not a
// public link") must still run the pipeline: an ABSOLUTE PATH is a valid source. parseRepoUrl
// maps it (parent dir = owner, last segment = name) and clone-repo COPIES the working tree
// (skipping .git and dependency cruft) instead of cloning a URL, keeping the INV-21 identity
// pin and the same contract output (reachable: true, clonePath, slug, build.json merge).
//
// No cloud calls, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRepoUrl } from '../src/orchestrator.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('local source — parseRepoUrl accepts an absolute path (parent dir = owner, last segment = name)', () => {
  const r = parseRepoUrl('/home/user/projects/my-service');
  assert.equal(r.name, 'my-service');
  assert.equal(r.owner, 'projects');
  assert.equal(r.url, '/home/user/projects/my-service');
});

test('local source — trailing slashes and a single-segment path are tolerated', () => {
  const r = parseRepoUrl('/tmp/somewhere/my-repo/');
  assert.equal(r.name, 'my-repo');
  assert.equal(r.owner, 'somewhere');
  const r2 = parseRepoUrl('/repo-only');
  assert.equal(r2.name, 'repo-only');
  assert.equal(r2.owner, 'local', 'no parent dir → the "local" stand-in');
});

test('local source — ordinary URLs are routed to the normal (non-local) grammar', () => {
  // A path-like string that is really a URL must not be treated as a local path.
  const r = parseRepoUrl('https://github.com/owner/cool-lib');
  assert.equal(r.owner, 'owner');
  assert.equal(r.name, 'cool-lib');
  assert.match(r.url, /^https:\/\/github\.com\/owner\/cool-lib$/);
});

test('local source — clone-repo COPIES the working tree, skipping .git and dependency cruft', () => {
  // The full local contract in one tmp tree: files arrive, cruft does not, the repo slot is the
  // same shape the URL clone produces (reachable: true, clonePath, slug), and build.json is merged.
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llsrc-'));
  fs.mkdirSync(path.join(srcRoot, 'sub'));
  fs.writeFileSync(path.join(srcRoot, 'README.md'), '# local repo\n');
  fs.writeFileSync(path.join(srcRoot, 'sub', 'module.py'), 'x = 1\n');
  fs.writeFileSync(path.join(srcRoot, 'sub', 'junk.pyc'), 'x');
  fs.mkdirSync(path.join(srcRoot, '.git'));
  fs.writeFileSync(path.join(srcRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(srcRoot, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(srcRoot, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1;');

  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llbuild-'));
  fs.writeFileSync(path.join(buildDir, 'build.json'),
    JSON.stringify({ repo: { url: srcRoot } }, null, 2));
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'clone-repo.mjs'), buildDir], {
    encoding: 'utf8',
    env: { ...process.env, EXPLAINER_SUBMITTED_REPO: '' },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, `local-source copy must succeed: ${r.stdout}\n${r.stderr}`);
  const repo = out.outputs.repo;
  assert.equal(repo.name, path.basename(srcRoot));
  assert.equal(repo.reachable, true, 'the contract output must be honest: a real tree now exists');
  assert.equal(repo.localSource, srcRoot);
  assert.ok(fs.existsSync(path.join(buildDir, 'repo', 'README.md')), 'real files are copied');
  assert.ok(fs.existsSync(path.join(buildDir, 'repo', 'sub', 'module.py')), 'nested files are copied');
  assert.ok(!fs.existsSync(path.join(buildDir, 'repo', '.git')), '.git must never be copied (the KB corpus would index it)');
  assert.ok(!fs.existsSync(path.join(buildDir, 'repo', 'node_modules')), 'dependency cruft must not bloat the corpus');
  assert.ok(!fs.existsSync(path.join(buildDir, 'repo', 'sub', 'junk.pyc')), 'build artefacts are skipped');
  // build.json is merged (repo slot + buildId), not clobbered.
  const merged = JSON.parse(fs.readFileSync(path.join(buildDir, 'build.json'), 'utf8'));
  assert.equal(merged.repo.url, srcRoot);
  assert.ok(merged.buildId, 'buildId must be set on a local-source run too');
});

test('local source — clone-repo still enforces the INV-21 identity pin', () => {
  // The source-identity guard must apply to LOCAL sources too: a swapped-in tree that does not
  // match the submitted repo is refused before anything is copied.
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llsrc-pinned-'));
  fs.writeFileSync(path.join(srcRoot, 'README.md'), '# not the submitted repo\n');
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llbuild-pinned-'));
  fs.writeFileSync(path.join(buildDir, 'build.json'),
    JSON.stringify({ repo: { url: srcRoot } }, null, 2));
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'clone-repo.mjs'), buildDir], {
    encoding: 'utf8',
    env: { ...process.env, EXPLAINER_SUBMITTED_REPO: 'someone/else-repo' },
  });
  assert.notEqual(r.status, 0, 'a mismatched local source must exit non-zero');
  assert.match(r.stdout, /SOURCE-IDENTITY VIOLATION/);
  assert.match(r.stdout, /someone\/else-repo/, 'the refusal must name the submitted repo');
  assert.ok(!fs.existsSync(path.join(buildDir, 'repo', 'README.md')), 'nothing may be copied before the pin is verified');
});
