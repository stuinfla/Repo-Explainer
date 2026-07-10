// tests/spawn-error-handling.test.mjs — coverage for bug #2 in memory test-coverage-gap-2026-07-09
// (FIXED 2026-07-10): bin/agentic-runner.mjs had zero `.on('error', ...)` listeners across its spawn()
// call sites. A missing/misconfigured binary (most severe: the `claude` binary at the main agent
// spawn) crashed the whole process with a raw Node stack trace — directly contradicting the file's
// own "never fail silently" comment and the standing deploy-safety-incident mandate (FAIL LOUD,
// always notify).
//
// Fix: the four fire-and-forget notification spawns (alert-owner x2, notify, notify-failure) now
// route through a single spawnAndWait() helper that pairs 'close' and 'error' on the same resolve;
// the main `claude` agent spawn gets its own inline .on('error', ...) since it has bespoke stdout
// streaming. Real spawn() call sites dropped from 5 to 2 (the helper's internal one + the main one)
// — the count assertion tracks that consolidation, not an arbitrary number.
//
// Exercising the live crash would require a real network clone (the runner clones pre-agent, in
// module-level code, before it ever reaches the claude spawn — see clone-repo.mjs invocation ~L138) —
// consistent with this repo's existing convention (source-identity.test.mjs's final case), a static
// source-shape check is the right tool here: cheap, deterministic, and it pins the actual invariant
// (every spawn() has a paired error listener) rather than the network's ability to fail on cue.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = fs.readFileSync(path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'utf8');
// Strip // line comments so counts reflect real code shape, not comment prose (this file's own
// comments talk ABOUT spawn()/spawnAndWait(), which would otherwise inflate every count below).
const SRC = RAW.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('sanity — agentic-runner.mjs has exactly the 2 known spawn() call sites (helper + main agent)', () => {
  const count = (SRC.match(/\bspawn\(/g) || []).length;
  assert.equal(count, 2, 'if this changed, re-verify every spawn() call site still pairs with an error listener');
});

test('every spawn() call site pairs with an .on(\'error\', ...) listener', () => {
  const errorListenerCount = (SRC.match(/\.on\(\s*['"]error['"]/g) || []).length;
  assert.ok(errorListenerCount >= 2,
    `expected an .on('error', ...) listener for each of the 2 spawn() call sites, found ${errorListenerCount}`);
});

test('the 4 fire-and-forget notification spawns go through the guarded spawnAndWait() helper', () => {
  // -1 for the function's own definition line ("function spawnAndWait(...")
  const count = (SRC.match(/\bspawnAndWait\(/g) || []).length - 1;
  assert.equal(count, 4, 'expected 4 call sites: preflight alert-owner, success notify, failure alert-owner, failure notify-failure');
});
