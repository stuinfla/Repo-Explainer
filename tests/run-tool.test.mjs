// tests/run-tool.test.mjs — src/run-tool.mjs, the uniform station-invocation contract (CONTRACT §b).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../src/run-tool.mjs';

function fixtureRepo(tools) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'tools'));
  for (const [name, src] of Object.entries(tools)) {
    fs.writeFileSync(path.join(repoRoot, 'tools', `${name}.mjs`), src);
  }
  return repoRoot;
}
const buildDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-build-'));

test('runTool: unknown tool name → ok:false, code 127, no child process spawned', () => {
  const repoRoot = fixtureRepo({});
  const r = runTool('does-not-exist', buildDir(), { repoRoot, env: process.env });
  assert.equal(r.ok, false);
  assert.equal(r.code, 127);
  assert.match(r.error, /tool not found: tools\/does-not-exist\.mjs/);
});

test('runTool: exit 0 + {"ok":true} on stdout → ok:true, result parsed', () => {
  const repoRoot = fixtureRepo({ 'ok-tool': "console.log(JSON.stringify({ ok: true, outputs: { x: 1 } }));" });
  const r = runTool('ok-tool', buildDir(), { repoRoot, env: process.env });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result, { ok: true, outputs: { x: 1 } });
  assert.equal(r.error, null);
});

test('runTool: exit 0 but the tool itself reports {"ok":false} → the JSON verdict overrides the exit code', () => {
  const repoRoot = fixtureRepo({ 'fail-tool': "console.log(JSON.stringify({ ok: false, error: 'boom' }));" });
  const r = runTool('fail-tool', buildDir(), { repoRoot, env: process.env });
  assert.equal(r.ok, false);
  assert.equal(r.code, 0);
  assert.equal(r.error, 'boom');
});

test('runTool: non-zero exit with no parseable JSON on stdout → ok:false, code passed through', () => {
  const repoRoot = fixtureRepo({ 'crash-tool': "console.error('boom'); process.exit(1);" });
  const r = runTool('crash-tool', buildDir(), { repoRoot, env: process.env });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.match(r.error, /exited 1 \(no JSON result on stdout\)/);
});

test('runTool: a tool that outlives timeoutMs is killed and reported as a timeout, not a hang', () => {
  const repoRoot = fixtureRepo({ 'slow-tool': "await new Promise((r) => setTimeout(r, 2000));" });
  const r = runTool('slow-tool', buildDir(), { repoRoot, env: process.env, timeoutMs: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out after 100ms/);
});

test('runTool: exit 0 with non-JSON stdout is NOT a pass (a tool with no result object has no verdict)', () => {
  const repoRoot = fixtureRepo({ 'silent-tool': "console.log('not json, just noise');" });
  const r = runTool('silent-tool', buildDir(), { repoRoot, env: process.env });
  assert.equal(r.ok, false, 'a tool that produced no usable JSON output must not be reported as a pass');
  assert.equal(r.code, 0);
  assert.match(r.error, /exited 0 \(no JSON result on stdout\)/);
});

test('runTool: exit 0 with NO stdout at all is not a pass either', () => {
  const repoRoot = fixtureRepo({ 'mute-tool': 'process.exit(0);' });
  assert.equal(runTool('mute-tool', buildDir(), { repoRoot, env: process.env }).ok, false);
});

test('runTool: a bare JSON scalar or array on stdout is not a result object', () => {
  const repoRoot = fixtureRepo({ 'num-tool': 'console.log("42");', 'arr-tool': 'console.log("[1,2]");' });
  assert.equal(runTool('num-tool', buildDir(), { repoRoot, env: process.env }).ok, false);
  assert.equal(runTool('arr-tool', buildDir(), { repoRoot, env: process.env }).ok, false);
});

test('runTool: a JSON result object without an ok field still passes on exit 0', () => {
  const repoRoot = fixtureRepo({ 'plain-tool': 'console.log(JSON.stringify({ outputs: {} }));' });
  assert.equal(runTool('plain-tool', buildDir(), { repoRoot, env: process.env }).ok, true);
});
