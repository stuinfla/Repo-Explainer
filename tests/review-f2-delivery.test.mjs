// tests/review-f2-delivery.test.mjs — delivery/content tools: pull-ratings output contract and score parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function runPullRatings(rows, rufloExit = 0) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f2-pr-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ruflo'), `#!/bin/sh\nexit ${rufloExit}\n`, { mode: 0o755 });
    const stub = path.join(tmp, 'stub.mjs');
    fs.writeFileSync(stub, `const rows = ${JSON.stringify(rows)};
globalThis.fetch = async (u) => String(u).includes('/submissions')
  ? new Response(JSON.stringify(rows), { status: 200 })
  : new Response(JSON.stringify([{ id: 'f1', name: 'build-rating' }]), { status: 200 });\n`);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, path.join(ROOT, 'tools', 'pull-ratings.mjs')], {
      encoding: 'utf8', env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, NETLIFY_AUTH_TOKEN: 'stub' },
    });
    return { status: r.status, out: JSON.parse(r.stdout.trim().split('\n').pop()), stderr: r.stderr };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('pull-ratings: a non-numeric score is skipped, never counted as ingested; success carries error:null', () => {
  const r = runPullRatings([
    { id: 'a', created_at: 't', data: { repo: 'x/y', score: 'abc' } },
    { id: 'b', created_at: 't', data: { repo: 'x/y', score: '' } },
    { id: 'c', created_at: 't', data: { repo: 'x/y', score: '4' } },
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out.outputs, { total: 3, ingested: 1, skippedOrDup: 2, failed: 0 });
  assert.equal(r.out.error, null);
  assert.equal(r.out.ok, true);
});

test('pull-ratings: a failed store is ok:false WITH an error string', () => {
  const r = runPullRatings([{ id: 'c', created_at: 't', data: { score: '5' } }], 1);
  assert.equal(r.status, 1);
  assert.equal(r.out.ok, false);
  assert.match(r.out.error, /1 rating\(s\) failed/);
});
