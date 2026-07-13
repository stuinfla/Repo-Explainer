// tests/ship-bar.test.mjs — the deploy boundary enforces the gate's verdict (2026-07-13).
// Incident this guards: an agent at its refine cap deployed a page the gate had FAILED
// (chalk, B5=58, passed=false); the runner reported SUCCESS and a human rolled it back.
// deploy.mjs now refuses below-bar and ungraded builds BEFORE any network call — these
// tests run the real tool against temp build dirs and need no token and no network.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEPLOY = new URL('../tools/deploy.mjs', import.meta.url).pathname;

function runDeploy(buildJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-bar-'));
  fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/o/r', slug: 'r' },
    page: { dir: path.join(dir, 'site') },
    ...buildJson,
  }));
  const env = { ...process.env };
  delete env.NETLIFY_AUTH_TOKEN; // proves refusal happens before any provider/network step
  delete env.DEPLOY_FORCE;
  const res = spawnSync(process.execPath, [DEPLOY, dir], { env, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const failingScorecard = [{
  device: 'mobile(390)',
  gateA: { A1: 87, A2: 94, A3: 95, A4: 92, A5: 95, A6: 97 },
  gateB: { B1: 91, B2: 94, B3: 89, B4: 89, B5: 58 },
  operatorQuestions: { makesMeSmile: false },
}];

test('deploy REFUSES a gate-failed build (the chalk incident shape)', () => {
  const res = runDeploy({ quality: { passed: false, scorecard: failingScorecard } });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /SHIP BAR/, 'refusal must name the ship bar');
  assert.match(res.stdout, /min axis 58 < 70/, 'refusal must cite the failing axis');
});

test('deploy REFUSES an ungraded build (no quality slot)', () => {
  const res = runDeploy({});
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no quality scorecard/, 'ungraded pages never ship');
});

test('a passed build clears the rail (fails later on missing token, NOT on the ship bar)', () => {
  const res = runDeploy({ quality: { passed: true, scorecard: failingScorecard } });
  assert.equal(res.status, 1);
  assert.doesNotMatch(res.stdout, /SHIP BAR/, 'passed=true must not trip the rail');
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'should reach the provider step');
});
