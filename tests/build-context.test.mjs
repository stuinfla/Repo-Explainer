// tests/build-context.test.mjs — coverage for src/build-context.mjs, the BuildContext (build.json)
// read-modify-write lifecycle every station and the orchestrator share (CONTRACT §a). Previously
// zero test coverage despite being the single cross-tool data channel every station depends on
// (see memory test-coverage-gap-2026-07-09, pass 4).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildJsonPath, initBuildDir, readContext, mergeSlot, hasSlot } from '../src/build-context.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'build-context-'));

test('initBuildDir creates the build dir + assets/ + a seed build.json with repo.url', () => {
  const dir = path.join(tmp(), 'nested', 'build');
  const out = initBuildDir(dir, 'https://github.com/foo/bar');
  assert.equal(out, path.resolve(dir));
  assert.ok(fs.existsSync(path.join(dir, 'assets')));
  const ctx = JSON.parse(fs.readFileSync(buildJsonPath(dir), 'utf8'));
  assert.equal(ctx.repo.url, 'https://github.com/foo/bar');
});

test('initBuildDir is idempotent — an existing build.json is preserved, only repo.url refreshes', () => {
  const dir = tmp();
  initBuildDir(dir, 'https://github.com/foo/bar');
  mergeSlot(dir, 'concept', { metaphor: 'a lighthouse' });
  initBuildDir(dir, 'https://github.com/foo/bar-renamed');
  const ctx = readContext(dir);
  assert.equal(ctx.repo.url, 'https://github.com/foo/bar-renamed', 're-running a build must refresh repo.url');
  assert.deepEqual(ctx.concept, { metaphor: 'a lighthouse' }, "a resumed build must not wipe a prior station's slot");
});

test('readContext throws a clear error when build.json does not exist', () => {
  const dir = tmp();
  assert.throws(() => readContext(dir), /build\.json not found at/);
});

test('readContext throws a clear error on invalid JSON instead of a raw parser exception', () => {
  const dir = tmp();
  fs.writeFileSync(buildJsonPath(dir), '{ not: valid json');
  assert.throws(() => readContext(dir), /build\.json is not valid JSON/);
});

test('mergeSlot shallow-merges an object slot, preserving sibling keys from a partial author', () => {
  const dir = tmp();
  initBuildDir(dir, 'https://github.com/foo/bar');
  mergeSlot(dir, 'repo', { slug: 'bar', owner: 'foo' });
  mergeSlot(dir, 'repo', { name: 'bar' }); // a later station only ever sets `name`
  const ctx = readContext(dir);
  assert.deepEqual(ctx.repo, { url: 'https://github.com/foo/bar', slug: 'bar', owner: 'foo', name: 'bar' });
});

test('mergeSlot replaces (does not merge) a non-object slot value outright', () => {
  const dir = tmp();
  initBuildDir(dir, 'https://github.com/foo/bar');
  mergeSlot(dir, 'stations', ['clone', 'kb']);
  mergeSlot(dir, 'stations', ['clone', 'kb', 'assemble']);
  const ctx = readContext(dir);
  assert.deepEqual(ctx.stations, ['clone', 'kb', 'assemble']);
});

test('hasSlot: false for missing/empty object/empty array; true once populated', () => {
  const dir = tmp();
  initBuildDir(dir, 'https://github.com/foo/bar');
  assert.equal(hasSlot(dir, 'concept'), false, 'never-set slot');
  mergeSlot(dir, 'concept', {});
  assert.equal(hasSlot(dir, 'concept'), false, 'empty object slot');
  mergeSlot(dir, 'concept', { metaphor: 'x' });
  assert.equal(hasSlot(dir, 'concept'), true);
  mergeSlot(dir, 'tags', []);
  assert.equal(hasSlot(dir, 'tags'), false, 'empty array slot');
  mergeSlot(dir, 'tags', ['a']);
  assert.equal(hasSlot(dir, 'tags'), true);
});

test('hasSlot returns false (never throws) when build.json itself is missing', () => {
  const dir = tmp();
  assert.equal(hasSlot(dir, 'anything'), false);
});
