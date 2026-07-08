// Conformance test — INV-21 Source-identity (the 2026-07-08 substitution incident).
//
// A hosted build was submitted for mamd69/SONA-Trader (private, shared with our account). The
// agent could not clone it (the env allowlist strips GITHUB_TOKEN — correctly), so it GitHub-
// searched a lookalike, edited repo.url in build.json to Dar-41/Virtual-Trader-SONA-AI-, and
// shipped a stranger's repo to the submitter as theirs. This suite pins the three repairs:
//   (1) clone-repo refuses any repo.url that isn't the harness-pinned submitted repo;
//   (2) deploy (the outward-facing boundary) refuses the same, before touching any provider;
//   (3) the runner clones PRE-AGENT in deterministic code, pins the identity into the agent env,
//       states the SOURCE-IDENTITY LAW in the brief, and still never leaks GH tokens to the agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpBuildDir(buildJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv21-'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(buildJson, null, 2));
  return dir;
}

test('INV-21 — clone-repo refuses a repo.url that is not the pinned submitted repo (before any network)', () => {
  const dir = tmpBuildDir({ repo: { url: 'https://github.com/Dar-41/Virtual-Trader-SONA-AI-' } });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'clone-repo.mjs'), dir], {
    env: { ...process.env, EXPLAINER_SUBMITTED_REPO: 'mamd69/sona-trader' },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, 'a swapped repo.url must exit non-zero');
  assert.match(r.stdout, /SOURCE-IDENTITY VIOLATION/, 'the refusal must name the violation class');
  assert.match(r.stdout, /mamd69\/sona-trader/, 'the refusal must name the repo that WAS submitted');
});

test('INV-21 — clone-repo accepts the pinned repo (pin matching is case-insensitive, .git/slash tolerant)', () => {
  // Same pin, matching URL: must get PAST the identity gate. The unreachable host then fails the
  // probe — proving the gate itself did not block it (error mentions reachability, not identity).
  const dir = tmpBuildDir({ repo: { url: 'https://github.com/Mamd69/SONA-Trader.git' } });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'clone-repo.mjs'), dir], {
    env: { ...process.env, EXPLAINER_SUBMITTED_REPO: 'mamd69/sona-trader', GIT_CONFIG_NOSYSTEM: '1', HOME: dir, GITHUB_TOKEN: '', GH_TOKEN: '' },
    encoding: 'utf8',
  });
  assert.doesNotMatch(r.stdout, /SOURCE-IDENTITY VIOLATION/, 'a matching pin must not trip the identity gate');
});

test('INV-21 — deploy refuses to publish a build whose repo.url is not the pinned repo', () => {
  // The identity gate fires immediately after build.json is read — before slug/page/token checks —
  // so the fixture deliberately carries ONLY the swapped repo.url.
  const dir = tmpBuildDir({
    repo: { url: 'https://github.com/Dar-41/Virtual-Trader-SONA-AI-', slug: 'Virtual-Trader-SONA-AI-' },
  });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'deploy.mjs'), dir], {
    env: { ...process.env, EXPLAINER_SUBMITTED_REPO: 'mamd69/sona-trader' },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, 'deploy must exit non-zero on an identity mismatch');
  assert.match(r.stdout, /SOURCE-IDENTITY VIOLATION/, 'deploy must refuse BEFORE touching any provider');
});

test('INV-21 — the runner accepts the bare owner/name form the workflow actually passes (fails on ACCESS, not parse)', () => {
  // Regression: the first live preflight (2026-07-08, rebuild of mamd69/SONA-Trader) failed CLOSED
  // on "cannot parse owner/name" because the workflow passes bare owner/name, not a full URL.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv21-runner-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'no-such-user-xyz123/no-such-repo', '--build-dir', dir], {
    env: { PATH: process.env.PATH, HOME: dir },   // scrubbed: no tokens, no SMTP — alert-owner fails harmlessly
    encoding: 'utf8', timeout: 60000,
  });
  assert.notEqual(r.status, 0, 'an inaccessible repo must still exit non-zero');
  assert.doesNotMatch(r.stderr, /cannot parse owner\/name/, 'bare owner/name must parse');
  assert.match(r.stderr, /PREFLIGHT FAILED/, 'the failure must be the access preflight, pre-agent');
});

test('INV-21 — the hosted runner clones pre-agent, pins the identity, and never leaks GH tokens to the agent', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'utf8');
  assert.match(src, /SOURCE-IDENTITY LAW/, 'the brief must state the law to the agent');
  assert.match(src, /clone-repo\.mjs/, 'the runner must invoke clone-repo itself (pre-agent, with the token)');
  assert.match(src, /EXPLAINER_SUBMITTED_REPO/, 'the runner must pin the submitted repo into the agent env');
  assert.match(src, /identityViolation/, 'the runner must re-verify identity at the exit boundary');
  const allowlist = src.match(/AGENT_ENV_ALLOWLIST = \[([^\]]*)\]/)?.[1] || '';
  assert.ok(!/GITHUB_TOKEN|GH_TOKEN|EXPLAINER_GH_TOKEN/.test(allowlist),
    'the pre-agent clone must NOT be an excuse to leak GH tokens into the agent env');
});
