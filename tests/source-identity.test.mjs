// INV-21 source identity (docs/adr/0007): clone-repo and deploy refuse a swapped repo.url, and the
// hosted runner pins the identity, scrubs the agent env, and re-checks at the exit boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_ENV_ALLOWLIST, AGENT_ALLOWED_TOOLS, AGENT_DISALLOWED_TOOLS, buildAgentEnv, buildAgentPrompt, finalizeRun, mainAgentSpawn, cureAgentSpawn } from '../bin/runner-lib.mjs';

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
  assert.match(r.stdout, /repo not reachable unauthenticated: Mamd69\/SONA-Trader — /, 'it must fail on REACHABILITY of the correctly parsed owner/name (.git stripped), proving the gate was passed');
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

test('clone-repo is immune to an inherited AUTHORIZATION extraheader in the invoking checkout (CI)', () => {
  // On CI clone-repo runs inside the checkout whose local git config carries an AUTHORIZATION extraheader; runGit must not stack it.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inv21-poisoned-'));
  spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
  spawnSync('git', ['-C', cwd, 'config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic Ym9ndXM6Ym9ndXM='], { encoding: 'utf8' });
  const dir = tmpBuildDir({ repo: { url: 'https://github.com/octocat/Hello-World' } });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'clone-repo.mjs'), dir], {
    cwd,   // invoke FROM the poisoned checkout, exactly like the CI runner does
    env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', EXPLAINER_SUBMITTED_REPO: 'octocat/hello-world' },
    encoding: 'utf8', timeout: 120000,
  });
  assert.doesNotMatch(r.stdout + r.stderr, /Duplicate header/i, 'the inherited extraheader must not stack');
  assert.equal(r.status, 0, `public clone from a poisoned cwd must succeed (got: ${r.stdout} ${r.stderr.slice(-300)})`);
});

test('INV-21 — the runner accepts the bare owner/name form the workflow actually passes (fails on ACCESS, not parse)', () => {
  // The workflow passes bare owner/name, not a full URL; parsing it must not fail closed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv21-runner-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'no-such-user-xyz123/no-such-repo', '--build-dir', dir], {
    env: { PATH: process.env.PATH, HOME: dir },   // scrubbed: no tokens, no SMTP — alert-owner fails harmlessly
    encoding: 'utf8', timeout: 60000,
  });
  assert.notEqual(r.status, 0, 'an inaccessible repo must still exit non-zero');
  assert.doesNotMatch(r.stderr, /cannot parse owner\/name/, 'bare owner/name must parse');
  assert.match(r.stderr, /PREFLIGHT FAILED/, 'the failure must be the access preflight, pre-agent');
});

test('a preflight failure alerts the OWNER and tells the SUBMITTER by email (not only the status page)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv21-notify-'));
  const run = (extra) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'no-such-user-xyz123/no-such-repo', '--build-dir', dir, ...extra], {
    env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8', timeout: 60000,
  });
  const withSubmitter = run(['--submitter', 'me@example.com']);
  assert.match(withSubmitter.stderr, /\[alert-owner\]/, 'the owner is alerted');
  assert.match(withSubmitter.stderr, /\[notify-failure\]/, 'the submitter is told');
  const without = run([]);
  assert.match(without.stderr, /\[alert-owner\]/);
  assert.doesNotMatch(without.stderr, /\[notify-failure\]/, 'no submitter email, nobody to tell');
});

test('INV-21 — the agent env is the allowlist: GitHub/SMTP/Grok secrets never reach it, the identity pin does', () => {
  const proc = {
    PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', NETLIFY_AUTH_TOKEN: 'n',
    GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'ghp_y', EXPLAINER_GH_TOKEN: 'ghp_z', SMTP_PASS: 'p', GMAIL_APP_PASSWORD: 'g', GROK_AI_KEY: 'x', OPENROUTER_API_KEY: 'or',
  };
  const env = buildAgentEnv(proc, { submittedRepoId: 'mamd69/sona-trader', executor: { lane: 'anthropic', baseUrl: null } });
  for (const secret of ['GITHUB_TOKEN', 'GH_TOKEN', 'EXPLAINER_GH_TOKEN', 'SMTP_PASS', 'GMAIL_APP_PASSWORD', 'GROK_AI_KEY', 'OPENROUTER_API_KEY']) {
    assert.equal(secret in env, false, `${secret} must not reach the agent`);
  }
  assert.equal(env.EXPLAINER_SUBMITTED_REPO, 'mamd69/sona-trader');
  assert.equal(env.ANTHROPIC_API_KEY, 'a');
  assert.ok(!AGENT_ENV_ALLOWLIST.some((k) => /GITHUB|GH_TOKEN|SMTP|GMAIL/.test(k)), 'the allowlist itself must stay free of GitHub/SMTP names');
  assert.equal(buildAgentEnv(proc, { submittedRepoId: 'a/b', executor: {}, subscription: true }).ANTHROPIC_API_KEY, undefined, 'subscription mode strips the API key');
});

test('INV-21 — the agent may never read .env, and its tool list is exactly the six file/shell tools', () => {
  assert.deepEqual(AGENT_ALLOWED_TOOLS, ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
  for (const p of ['Read(./.env)', 'Read(./.env.*)', 'Read(**/.env)', 'Read(**/.env.*)']) assert.ok(AGENT_DISALLOWED_TOOLS.includes(p), p);
});

test('INV-21 — the brief states the source-identity law and the clone is already done by the harness', () => {
  const p = buildAgentPrompt({ repoUrl: 'https://github.com/a/b', buildDir: '/tmp/b', budgetMin: 20, budgetUsd: 8 });
  assert.match(p, /SOURCE-IDENTITY LAW/);
  assert.match(p, /Do NOT re-run clone-repo, and do NOT touch repo\.url/);
});

test('INV-21 — the agent spawn spec carries the scrubbed env, never process.env (the wiring, not just buildAgentEnv)', () => {
  const procEnv = { PATH: '/bin', ANTHROPIC_API_KEY: 'a', GITHUB_TOKEN: 'ghp_x', EXPLAINER_GH_TOKEN: 'ghp_z', SMTP_PASS: 'p' };
  const ctx = { claudeBin: 'claude', prompt: 'p', executor: { model: 'm', lane: 'anthropic' }, procEnv, submittedRepoId: 'a/b', cwd: '/r' };
  for (const sp of [mainAgentSpawn({ ...ctx, budgetUsd: 5 }), cureAgentSpawn({ ...ctx, remainingUsd: 2 })]) {
    assert.notEqual(sp.opts.env, procEnv);
    for (const k of ['GITHUB_TOKEN', 'EXPLAINER_GH_TOKEN', 'SMTP_PASS']) assert.equal(k in sp.opts.env, false, `${k} reached the agent`);
    assert.equal(sp.opts.env.EXPLAINER_SUBMITTED_REPO, 'a/b');
    assert.equal(sp.opts.env.CI, '1');
  }
});

test('INV-21 — the exit boundary rejects a build that ENDED on a different repo (and accepts case/.git/slash variants)', () => {
  const base = { exitCode: 0, killedForBudget: false, killedForUsd: null, spawnErrorMsg: null, agentReported: { ok: true }, liveUrl: 'https://x.netlify.app', submittedRepoId: 'mamd69/sona-trader', budgetMin: 20, budgetUsd: 8, totalCostUsd: 1 };
  const swapped = finalizeRun({ ...base, finalCtx: { repo: { url: 'https://github.com/Dar-41/Virtual-Trader-SONA-AI-' } } });
  assert.equal(swapped.ok, false, 'a swapped repo must fail the run even with a live URL and a clean exit');
  assert.match(swapped.reason, /SOURCE-IDENTITY VIOLATION.*Dar-41/);
  const same = finalizeRun({ ...base, finalCtx: { repo: { url: 'https://github.com/Mamd69/SONA-Trader.git/' } } });
  assert.equal(same.ok, true);
  assert.equal(same.identityViolation, null);
  assert.equal(finalizeRun({ ...base, finalCtx: { repo: {} } }).ok, false, 'a build.json with no repo.url is not the submitted repo');
});
