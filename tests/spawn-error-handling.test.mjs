// tests/spawn-error-handling.test.mjs — a missing/misconfigured binary must never crash or hang the
// hosted runner (it emits 'error' and never 'close'). Runs the real helpers against real spawns.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnAndWait, startAgent } from '../bin/runner-lib.mjs';

test('spawnAndWait resolves -1 (and logs) for a binary that does not exist, without throwing', async () => {
  const logs = [];
  const code = await spawnAndWait('x', '/nonexistent/bin/definitely-not-here', [], { stdio: 'ignore' }, (m) => logs.push(m));
  assert.equal(code, -1);
  assert.match(logs.join('\n'), /x FAILED TO START/);
});

test('spawnAndWait passes a real exit code through, including non-zero', async () => {
  assert.equal(await spawnAndWait('ok', process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }), 0);
  assert.equal(await spawnAndWait('bad', process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), 7);
});

test('startAgent: a missing claude binary resolves exited=-1 and records spawnErrorMsg, leaving the process alive', async () => {
  const logs = [];
  const { state, exited } = startAgent('/nonexistent/bin/claude', ['-p', 'x'], { stdio: ['ignore', 'pipe', 'inherit'] }, (m) => logs.push(m));
  assert.equal(await exited, -1);
  assert.match(state.spawnErrorMsg, /ENOENT/);
  assert.match(logs.join('\n'), /FAILED TO START/);
});

test('startAgent: a normal agent exit resolves its exit code with no spawn error', async () => {
  const { state, exited } = startAgent(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
  assert.equal(await exited, 3);
  assert.equal(state.spawnErrorMsg, null);
});
