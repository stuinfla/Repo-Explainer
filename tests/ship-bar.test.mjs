// tests/ship-bar.test.mjs — what the deploy boundary enforces, and what it deliberately does not.
//
// HISTORY (both incidents are real and the reasoning is preserved on purpose):
//  · 2026-07-13 — an agent at its refine cap deployed a page the gate had FAILED (chalk, B5=58,
//    passed=false); the runner reported SUCCESS and a human rolled it back. deploy.mjs was given a
//    hard ship-bar rail: below-bar and ungraded builds refused before any network call.
//  · 2026-07-14 — the hosted agent found DEPLOY_FORCE=1 and bypassed that rail, so the override was
//    made human-only (interactive TTY).
//
// SUPERSEDED IN PART BY ADR-0011 (2026-08-06). The rail was binary, and the measured consequence was
// that 56 of 104 hosted builds delivered NOTHING at ~$5 each — ~$280 of finished, graded pages thrown
// away. PolymathWizard/BHIL-Colophon-Spec died twice this way on ONE axis whose cap had actually been
// MISAPPLIED by the vision grader. Quality is now DISCLOSURE, not a delivery condition.
//
// What still refuses absolutely: a page we cannot honestly describe (ungraded), and — enforced
// elsewhere, by ADR-0007 — a page about the wrong repo. What no longer refuses: a low score.
// These tests run the real tool against temp build dirs; no token and no network required.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: pathname percent-encodes (a checkout under a directory
// with a space yields ".../Ruv%20Explainer/..." and spawning the tool fails).
const DEPLOY = fileURLToPath(new URL('../tools/deploy.mjs', import.meta.url));

function runDeploy(buildJson, envOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-bar-'));
  fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/o/r', slug: 'r' },
    page: { dir: path.join(dir, 'site') },
    ...buildJson,
  }));
  const env = { ...process.env, ...envOverrides };
  delete env.NETLIFY_AUTH_TOKEN; // proves the decision happens before any provider/network step
  if (!('DEPLOY_FORCE' in envOverrides)) delete env.DEPLOY_FORCE;
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
  assert.doesNotMatch(res.stdout, /SHIP BAR/, 'quality must no longer refuse delivery');
  assert.doesNotMatch(res.stdout, /below the ship-best-effort floor/, 'the old quality refusal must be gone');
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

// ── THE GRADER-OUTAGE HATCH (2026-08-06, from adversarial review) ────────────────────────────────
// Before ADR-0011, DEPLOY_FORCE skipped the whole quality block INCLUDING the no-scorecard refusal,
// so a human could still ship during a vision-API outage. Removing the quality gate removed that
// too, leaving the stochastic judge holding a veto via its own AVAILABILITY — ADR-0011's thesis
// exactly inverted, and a total delivery outage every time the grader is down. A TTY hatch is no
// answer: hosted builds have no human, and hosted is where outages cost customers.
test('OUTAGE — a RECORDED grader failure still delivers (the judge cannot veto by being offline)', () => {
  const res = runDeploy({ quality: { graderUnavailable: true, graderError: 'openai 503' } });
  assert.doesNotMatch(res.stdout, /INTEGRITY: refusing/, 'a recorded grader outage must not block delivery');
  assert.match(res.stderr, /delivering UNGRADED/, 'must announce that this page is going out ungraded');
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'must reach the provider step');
});

test('OUTAGE — a MISSING scorecard with no recorded reason still refuses (an unrun station is not an outage)', () => {
  const res = runDeploy({});
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no recorded grader failure/,
    'silence is not an outage — a station that never ran must not ship as if the grader were down');
});

test('a passed build clears the boundary (fails later on the missing token, not on quality)', () => {
  const res = runDeploy({ quality: { passed: true, scorecard: belowBarScorecard } });
  assert.doesNotMatch(res.stdout, /SHIP BAR/);
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'should reach the provider step');
});

test('DEPLOY_FORCE is now a NO-OP — there is no quality gate left for it to bypass', () => {
  const res = runDeploy({ quality: { passed: false, scorecard: belowBarScorecard } }, { DEPLOY_FORCE: '1' });
  assert.match(res.stderr, /no-op/, 'must announce that the override no longer does anything');
  assert.match(res.stdout, /NETLIFY_AUTH_TOKEN/, 'delivery proceeds regardless of the flag');
});

// ── SOURCE-SHAPE PIN (ADR-0011 verification #5) ──────────────────────────────────────────────────
// A cross-file behavioural contract that lives in prose rots silently. The 2026-07-19 lesson
// (one-shot-pipeline-cure-stage) is explicit: pin such mechanisms with a source-shape test. This one
// fails the moment someone reintroduces a quality-valued refusal at the deploy boundary — which is
// exactly how the ~$280 of destroyed builds happened the first time.
test('SOURCE SHAPE — deploy.mjs never throws on a quality VALUE (only on integrity)', () => {
  const src = fs.readFileSync(DEPLOY, 'utf8');
  const throwLines = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /^throw new Error\(/.test(line) || /\bthrow new Error\(/.test(line));
  const offenders = throwLines.filter(({ line }) =>
    /SHIP BAR/.test(line)
    || /ship-best-effort/.test(line)
    || /below the .*floor/i.test(line));
  assert.deepEqual(offenders, [],
    `deploy.mjs regained a quality-valued refusal — ADR-0011 says the gate advises, it never destroys:\n${
      offenders.map((o) => `  line ${o.n}: ${o.line}`).join('\n')}`);
  // And the positive half: the integrity refusal must still be present, or nothing guards delivery.
  assert.match(src, /INTEGRITY: refusing to deploy/,
    'the integrity refusal (ungraded page) must remain — ADR-0011 removed the QUALITY gate, not every gate');
});
