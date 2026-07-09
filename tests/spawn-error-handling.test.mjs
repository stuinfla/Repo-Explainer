// tests/spawn-error-handling.test.mjs — coverage for confirmed bug #2 in memory test-coverage-gap-2026-07-09:
// bin/agentic-runner.mjs has zero `.on('error', ...)` listeners across its 4 spawn() call sites. A
// missing/misconfigured binary (most severe: the `claude` binary at the main agent spawn) crashes the
// whole process with a raw Node stack trace — directly contradicting the file's own "never fail
// silently" comment (L23-24) and the standing deploy-safety-incident mandate (FAIL LOUD, always notify).
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
const SRC = fs.readFileSync(path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'utf8');

test('sanity — agentic-runner.mjs still has exactly the 4 known spawn() call sites', () => {
  const count = (SRC.match(/\bspawn\(/g) || []).length;
  assert.equal(count, 4, 'if this changed, the bug-#2 line citations in memory test-coverage-gap-2026-07-09 need re-verifying');
});

test(
  'KNOWN BUG — none of the 4 spawn() calls register an .on(\'error\', ...) listener',
  { skip: "confirmed bug — a missing/misconfigured binary (esp. the claude spawn, the main agent process) crashes the process with a raw Node stack trace instead of a caught, FAIL-LOUD-but-clean failure; unskip once every spawn() call site pairs with a .on('error', ...) handler" },
  () => {
    const errorListenerCount = (SRC.match(/\.on\(\s*['"]error['"]/g) || []).length;
    assert.ok(errorListenerCount >= 4,
      `expected an .on('error', ...) listener for each of the 4 spawn() call sites, found ${errorListenerCount}`);
  }
);
