// tests/deploy-site-collision.test.mjs — coverage for confirmed bug #4 in memory test-coverage-gap-2026-07-09:
// tools/deploy.mjs's Netlify site lookup (deployNetlify, ~L85-92) matches an existing site BY NAME ONLY
// and reuses whatever it finds — no ownership/account-scope check, and nothing cross-checks the
// looked-up site against the INV-21-validated repo.url before reusing it. Two repos that sanitize to
// the same slug would silently deploy into each other's site — the same failure shape as the
// documented 2026-06-30 Vercel shared-site incident (see memory deploy-safety-incident), just on an
// unguarded path.
//
// deployNetlify() is not exported and talks to the real Netlify API — exercising it live would mean
// hitting production Netlify or refactoring for dependency injection. Consistent with this repo's
// established convention (source-identity.test.mjs's final case; also spawn-error-handling.test.mjs
// in this same pass), a static source-shape check pins the actual invariant without either cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'tools', 'deploy.mjs'), 'utf8');

test('sanity — deployNetlify still looks up existing sites by name only (find s.name === name)', () => {
  assert.match(SRC, /\.find\(\s*\(?\s*s\s*\)?\s*=>\s*s\.name === name\s*\)/,
    'if this changed, the bug-#4 line citations in memory test-coverage-gap-2026-07-09 need re-verifying');
});

test(
  'KNOWN BUG — the Netlify site lookup has no ownership/account-scope check before reusing a same-name site',
  { skip: 'confirmed bug, tools/deploy.mjs ~L85-92 — two repos whose slugs sanitize to the same name would silently deploy into the same site (the 2026-06-30 shared-site incident, on an unguarded path); unskip once the lookup cross-checks the found site against something more than name (e.g. a stored repo.url/owner tag on the site, verified before reuse)' },
  () => {
    assert.match(SRC, /site\.(?:build_settings\.repo_url|repo\?\.\w+|metadata)/,
      'expected the site lookup to verify SOME identity signal on the matched site before reusing it');
  }
);
