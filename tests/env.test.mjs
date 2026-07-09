// tests/env.test.mjs — coverage for src/env.mjs, the .env + secret loading every station and the
// orchestrator's own Claude calls depend on. Previously zero test coverage, including the one
// regression that actually broke a live deploy: a stale ambient NETLIFY_AUTH_TOKEN silently
// overriding a freshly-updated .env (2026-06-30 incident). loadEnv was rewritten so the .env file
// wins; until now nothing pinned that fix in place (see memory test-coverage-gap-2026-07-09, pass 4).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotenv, loadEnv, getSecret, redact } from '../src/env.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); }
  finally { if (prev === undefined) delete process.env[key]; else process.env[key] = prev; }
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

test('parseDotenv: KEY=value, export KEY=value, quoted values, comments and blanks', () => {
  const dir = tmp();
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, [
    '# a comment',
    '',
    'PLAIN=value',
    'export EXPORTED=value2',
    'DOUBLE="quoted value"',
    "SINGLE='quoted value2'",
    'NO_EQUALS_SIGN_IS_SKIPPED',
  ].join('\n'));
  assert.deepEqual(parseDotenv(file), {
    PLAIN: 'value',
    EXPORTED: 'value2',
    DOUBLE: 'quoted value',
    SINGLE: 'quoted value2',
  });
});

test('parseDotenv: a missing file returns {} instead of throwing', () => {
  const dir = tmp();
  assert.deepEqual(parseDotenv(path.join(dir, 'does-not-exist.env')), {});
});

test('loadEnv: the .env file overrides a stale ambient process.env value (2026-06-30 NETLIFY_AUTH_TOKEN regression)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), 'NETLIFY_AUTH_TOKEN=fresh-from-file\n');
  withEnv('NETLIFY_AUTH_TOKEN', 'stale-ambient-token', () => {
    withCwd(dir, () => {
      const merged = loadEnv(dir);
      assert.equal(merged.NETLIFY_AUTH_TOKEN, 'fresh-from-file', '.env must win over a stale ambient env var');
    });
  });
});

test('loadEnv: ambient process.env fills in a key the .env file does not define', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), 'SOME_OTHER_KEY=x\n');
  withEnv('AMBIENT_ONLY_KEY', 'from-shell', () => {
    withCwd(dir, () => {
      const merged = loadEnv(dir);
      assert.equal(merged.AMBIENT_ONLY_KEY, 'from-shell');
    });
  });
});

test('loadEnv: backfills the canonical ANTHROPIC_API_KEY from the CLAUDE_API_KEY alias when the canonical is unset', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), 'CLAUDE_API_KEY=sk-alias-value\n');
  withEnv('ANTHROPIC_API_KEY', undefined, () => {
    withEnv('CLAUDE_API_KEY', undefined, () => { // ambient must not also carry it, or the file's own value gets masked
      withCwd(dir, () => {
        const merged = loadEnv(dir);
        assert.equal(merged.ANTHROPIC_API_KEY, 'sk-alias-value');
      });
    });
  });
});

test('loadEnv: an already-set canonical ANTHROPIC_API_KEY is never overwritten by the CLAUDE_API_KEY alias', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-real\nCLAUDE_API_KEY=sk-alias-should-be-ignored\n');
  const merged = withCwd(dir, () => loadEnv(dir));
  assert.equal(merged.ANTHROPIC_API_KEY, 'sk-real');
});

test('getSecret: returns the first non-empty value among the given names, else null', () => {
  assert.equal(getSecret({ A: '', B: '  ', C: 'value' }, ['A', 'B', 'C']), 'value');
  assert.equal(getSecret({}, ['A', 'B']), null);
});

test('redact: masks a long secret to first/last 3 chars; fully masks short ones; labels unset', () => {
  assert.equal(redact('sk-abcdefghijklmnop'), 'sk-…nop (len 19)');
  assert.equal(redact('short'), '***');
  assert.equal(redact(''), '(unset)');
  assert.equal(redact(undefined), '(unset)');
});
