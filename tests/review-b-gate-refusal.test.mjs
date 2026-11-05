// tests/review-b-gate-refusal.test.mjs — review 3.0.1 finding #2.
// A deterministic reader pre-check (INV-20 acronyms / INV-24 reading level) that refuses on a FIRST
// grade left `scorecard: []` with no recorded reason, so deploy refused "no scorecard" and the local
// door reported "the mandatory diagrams did not render". One long sentence stopped a finished page,
// contrary to ADR-0011. These run the real tools; the pre-check fires before any network call, and the
// key/base URL are fakes pointed at a closed port so nothing can reach a real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { belowBarVerdict } from '../src/orchestrator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QG = path.join(ROOT, 'tools', 'quality-grade.mjs');
const DEPLOY = path.join(ROOT, 'tools', 'deploy.mjs');
const OFFLINE = { OPENAI_API_KEY: 'sk-test-offline', OPENAI_BASE_URL: 'http://127.0.0.1:9' };

const LONG = 'This library takes every single request that arrives from the outside world and quietly routes it '
  + 'through a long chain of careful little checks and helpers before it finally decides what the answer should be today.';

function buildDir(html, quality) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-b-refusal-'));
  const site = path.join(dir, 'site');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/o/r', slug: 'r' },
    page: { dir: site, htmlPath: path.join(site, 'index.html') },
    ...(quality ? { quality } : {}),
  }));
  return dir;
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
function run(tool, dir, env = {}) {
  const e = { ...process.env, ...OFFLINE, ...env };
  delete e.NETLIFY_AUTH_TOKEN; delete e.EXPLAINER_SUBMITTED_REPO; delete e.DEPLOY_FORCE;
  return spawnSync(process.execPath, [tool, dir], { env: e, encoding: 'utf8' });
}

test('#2 quality-grade records WHY a first grade has no scorecard (INV-24 reading level)', () => {
  const dir = buildDir(`<!doctype html><title>Test explainer page</title><section class="hero"><p>${LONG}</p></section>`);
  const r = run(QG, dir);
  assert.equal(r.status, 0, r.stderr);
  const q = read(dir).quality;
  assert.deepEqual(q.scorecard, []);
  assert.equal(q.iterations, 0, 'a $0 refusal must not spend a grade');
  assert.match(q.gateRefusal, /^INV-24 /);
  assert.match(q.gateRefusal, /\d+-word sentence/, 'the reason names the measured problem');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#2 quality-grade records WHY a first grade has no scorecard (INV-20 acronyms)', () => {
  const dir = buildDir('<!doctype html><title>Test explainer page</title><section class="hero"><p>It speaks GDN to the core.</p></section>');
  const r = run(QG, dir);
  assert.equal(r.status, 0, r.stderr);
  const q = read(dir).quality;
  assert.deepEqual(q.scorecard, []);
  assert.equal(q.gateRefusal, 'INV-20 unexplained acronym(s): GDN');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#2 deploy DELIVERS a pre-check refusal with disclosure instead of refusing "no scorecard"', () => {
  const dir = buildDir(`<!doctype html><title>Test explainer page</title><section class="hero"><p>${LONG}</p></section>`);
  assert.equal(run(QG, dir).status, 0);
  const r = run(DEPLOY, dir);
  assert.doesNotMatch(r.stdout, /no quality scorecard/, 'a recorded refusal is a known reason, not an unrun station');
  assert.match(r.stdout, /NETLIFY_AUTH_TOKEN/, 'must get all the way to the provider step');
  assert.match(r.stderr, /failed a deterministic pre-check before vision grading \(INV-24 /);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#2 deploy still REFUSES an empty scorecard with no recorded reason (unrun station)', () => {
  const dir = buildDir('<!doctype html><title>Test explainer page</title>', { scorecard: [], passed: false });
  const r = run(DEPLOY, dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no quality scorecard and no recorded grader failure/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#2 local door: a pre-check refusal or grader outage is delivered, never blamed on the diagrams', () => {
  const refusal = belowBarVerdict({ scorecard: [], gateRefusal: 'INV-20 unexplained acronym(s): GNU' });
  assert.equal(refusal.action, 'deliver-ungraded');
  assert.match(refusal.why, /reader check .*INV-20 unexplained acronym\(s\): GNU/);
  assert.doesNotMatch(refusal.why, /diagram/);
  const outage = belowBarVerdict({ scorecard: [], graderUnavailable: true, graderError: 'grader response for mobile(390) missing gateA' });
  assert.equal(outage.action, 'deliver-ungraded');
  assert.match(outage.why, /grader was unavailable \(grader response for mobile\(390\) missing gateA\)/);
  // the real integrity holds are unchanged
  assert.equal(belowBarVerdict({ scorecard: [] }).action, 'hold');
  assert.match(belowBarVerdict(null).why, /no quality scorecard/);
  const noDiagrams = belowBarVerdict({ scorecard: [{ inv18: { passed: false } }, { inv18: { passed: false } }] });
  assert.deepEqual(noDiagrams, { action: 'hold', why: 'the mandatory diagrams did not render' });
  assert.equal(belowBarVerdict({ scorecard: [{ inv18: { passed: true } }] }).action, 'deliver');
});
