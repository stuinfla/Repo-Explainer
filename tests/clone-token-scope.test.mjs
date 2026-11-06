// review 3.0.1 F6 (security): the GitHub token must reach ONLY github.com, and never via argv (visible in `ps`).
// A fake `git` on PATH records every invocation's argv + GIT_CONFIG_* env, so the real tools/clone-repo.mjs is exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_SECRETTOKEN123';
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');

function run(repoUrl, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cts-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const log = path.join(dir, 'git.log');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf 'ARGV:%s\\nENV:%s|%s|%s\\n' "$*" "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { url: repoUrl } }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'clone-repo.mjs'), dir], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_TOKEN: TOKEN, GH_TOKEN: '', EXPLAINER_SUBMITTED_REPO: '', ...extraEnv }, encoding: 'utf8',
  });
  return { r, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

test('token is NOT sent to a non-github host (neither argv nor env), and the clone is attempted unauthenticated', () => {
  const { log } = run('https://evil.example.com/owner/name');
  assert.ok(log.includes('evil.example.com'), 'git was invoked against the foreign host');
  assert.ok(!log.includes(TOKEN) && !log.includes(B64), 'no token material reached git for a foreign host');
  assert.match(log, /ENV:\|\|/, 'no GIT_CONFIG auth env for a foreign host');
});

test('on github.com the token travels in GIT_CONFIG_* env scoped to github.com, never in argv', () => {
  const { log } = run('https://github.com/owner/name');
  const argv = log.split('\n').filter((l) => l.startsWith('ARGV:')).join('\n');
  assert.ok(!argv.includes(B64) && !argv.includes(TOKEN) && !/extraheader/i.test(argv), `argv must not carry the credential: ${argv}`);
  assert.ok(log.includes(`ENV:1|http.https://github.com/.extraheader|AUTHORIZATION: basic ${B64}`), 'authenticated retry used the env-var header');
});

test('source-identity check compares the host: same owner/name on another host is a violation', () => {
  const { r, log } = run('https://gitlab.example.org/mamd69/sona-trader', { EXPLAINER_SUBMITTED_REPO: 'mamd69/sona-trader' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /SOURCE-IDENTITY VIOLATION/);
  assert.equal(log, '', 'refused before any git/network call');
});
