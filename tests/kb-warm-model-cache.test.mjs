// The embedding-model release asset is only unpacked when its sha256 equals the pin (fail closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchFromRelease, digestMatches, sha256Hex } from '../kb/warm-model-cache.mjs';

const MODEL = 'Xenova/bge-small-en-v1.5';

function fakeArchive(dir) {
  const src = path.join(dir, 'src', 'bge-small-en-v1.5', 'onnx');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'model_quantized.onnx'), 'fake-weights');
  const tgz = path.join(dir, 'asset.tgz');
  const r = spawnSync('tar', ['czf', tgz, '-C', path.join(dir, 'src'), 'bge-small-en-v1.5']);
  assert.equal(r.status, 0);
  return fs.readFileSync(tgz);
}
const serving = (bytes) => async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

test('digestMatches: only an exact 64-hex pin equal to the bytes passes', () => {
  const b = Buffer.from('abc');
  assert.equal(digestMatches(b, sha256Hex(b)), true);
  assert.equal(digestMatches(b, sha256Hex(Buffer.from('abd'))), false);
  assert.equal(digestMatches(b, ''), false, 'an empty pin never matches');
  assert.equal(digestMatches(b, sha256Hex(b).toUpperCase()), false, 'malformed pin is not trusted');
});

test('a release asset whose sha256 does not match the pin is discarded, nothing is unpacked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-warm-'));
  try {
    const bytes = fakeArchive(dir);
    const cache = path.join(dir, 'cache');
    fs.mkdirSync(cache);
    const out = await fetchFromRelease(cache, { fetchImpl: serving(bytes), pin: sha256Hex(Buffer.from('some other archive')), model: MODEL });
    assert.equal(out, false);
    assert.deepEqual(fs.readdirSync(cache), [], 'neither the tarball nor its contents touched the cache');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no pin configured: the release asset is not even downloaded', async () => {
  let fetched = 0;
  const out = await fetchFromRelease(os.tmpdir(), { fetchImpl: async () => { fetched++; throw new Error('must not fetch'); }, pin: '', model: MODEL });
  assert.equal(out, false);
  assert.equal(fetched, 0);
});

test('an asset matching the pin is unpacked into the cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-warm-'));
  try {
    const bytes = fakeArchive(dir);
    const cache = path.join(dir, 'cache');
    fs.mkdirSync(cache);
    const out = await fetchFromRelease(cache, { fetchImpl: serving(bytes), pin: sha256Hex(bytes), model: MODEL });
    assert.equal(out, true);
    assert.equal(fs.readFileSync(path.join(cache, MODEL, 'onnx', 'model_quantized.onnx'), 'utf8'), 'fake-weights');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
