// What the deploy boundary enforces: it refuses an ungraded or wrong-repo page; a low score is disclosed,
// never refused (ADR-0011). These run the real tool against temp build dirs; no token, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withShareCard } from './helpers/png.mjs';

// fileURLToPath, not URL.pathname: pathname percent-encodes (a checkout under a directory
// with a space yields ".../Ruv%20Explainer/..." and spawning the tool fails).
const DEPLOY = fileURLToPath(new URL('../tools/deploy.mjs', import.meta.url));

function runDeploy(buildJson, envOverrides = {}, html = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-bar-'));
  fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), withShareCard(path.join(dir, 'site'), html ?? '<!doctype html><title>Test explainer page</title>'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/o/r', slug: 'r' },
    page: { dir: path.join(dir, 'site') },
    ...buildJson,
  }));
  const env = { ...process.env, ...envOverrides };
  delete env.NETLIFY_AUTH_TOKEN; // proves the decision happens before any provider/network step
  const res = spawnSync(process.execPath, [DEPLOY, dir], { env, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

// The exact shape that used to be destroyed: one weak axis (B5=58), everything else strong.
const belowBarScorecard = [{
  device: 'mobile(390)',
  gateA: { A1: 87, A2: 94, A3: 95, A4: 92, A5: 95, A6: 97 },
  gateB: { B1: 91, B2: 94, B3: 89, B4: 89, B5: 58 },
  operatorQuestions: { makesMeSmile: false },
}];

test('ADR-0011 — deploy DELIVERS a below-bar build instead of destroying it', () => {
  const res = runDeploy({ quality: { passed: false, scorecard: belowBarScorecard } });
  // It still exits 1 here ONLY because no NETLIFY_AUTH_TOKEN exists in the test env — the point is
  // that it got all the way to the provider instead of refusing on the score.
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'a below-bar build must reach the provider step');
});

test('ADR-0011 — a below-bar delivery ANNOUNCES the weakest axis in human terms (the honest note)', () => {
  const res = runDeploy({ quality: { passed: false, scorecard: belowBarScorecard } });
  assert.match(res.stderr, /BELOW THE BAR/, 'must say plainly that this is below the bar');
  assert.match(res.stderr, /B5=58/, 'must name the weakest axis and its score');
  assert.match(res.stderr, /diagrams and imagery/, 'must translate the axis into words a requester understands');
});

test('INTEGRITY — deploy still REFUSES an ungraded build (we never ship what we cannot describe)', () => {
  const res = runDeploy({});
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no quality scorecard/, 'an ungraded page cannot be honestly disclosed, so it never ships');
});

// A RECORDED grader outage still delivers: the judge must not hold a veto by being offline.
test('OUTAGE — a RECORDED grader failure still delivers (the judge cannot veto by being offline)', () => {
  const res = runDeploy({ quality: { graderUnavailable: true, graderError: 'openai 503' } });
  assert.doesNotMatch(res.stdout, /INTEGRITY: refusing/, 'a recorded grader outage must not block delivery');
  assert.match(res.stderr, /delivering UNGRADED/, 'must announce that this page is going out ungraded');
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'must reach the provider step');
});

test('a passed build clears the boundary (fails later on the missing token, not on quality)', () => {
  const res = runDeploy({ quality: { passed: true, scorecard: belowBarScorecard } });
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'should reach the provider step');
});

test('SITE INTEGRITY — deploy refuses a page that links a file it does not ship, before touching any provider', () => {
  const res = runDeploy({ quality: { passed: true, scorecard: belowBarScorecard } }, {}, '<!doctype html><title>Test explainer page</title><img src="assets/never-shipped.png">');
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /SITE INTEGRITY/);
  assert.match(res.stdout + res.stderr, /never-shipped\.png/);
});
