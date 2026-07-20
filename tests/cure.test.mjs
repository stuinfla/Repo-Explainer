// tests/cure.test.mjs — the systemic fix for the 07/15–07/17 hosted-failure streak.
//
// Diagnosis (2026-07-19, from the admin record + code): the pipeline was ONE-SHOT. Any
// unforeseen condition at the last mile became a terminal, user-visible "failed" — even with a
// finished, floor-clearing page on disk — because no component owned recovery after the agent
// stopped. The one cure mechanism that existed (agentic-runner's operator-grade block, 427ffbb)
// required `quality.postCapManualFix`, a key NOTHING ever taught the agent to write (it appeared
// in exactly one file), while the runner prompt said "when you see capReached, ship immediately"
// — marching the agent into the rail with no way to act on the refusal.
//
// The fix under test: bin/cure.mjs — a pure, deterministic end-state classifier + cure-prompt
// builder the runner uses to route every unshipped ending: near-miss → one bounded cure cycle
// (fix ONLY the named weaknesses → ONE fresh grade → the existing ship-bar rail judges);
// everything else → an honest hold. Fixtures below are shaped like the three real incidents.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyEndState, namedWeaknesses, buildCurePrompt, CURE } from '../bin/cure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Scorecard fixture helper: axes as {name: score}, operators as {name: bool}.
const device = (label, axes, operators, inv18Passed = true) => ({
  deviceLabel: label,
  gateA: axes,
  gateB: {},
  operatorQuestions: operators,
  inv18: { passed: inv18Passed },
});
const OPS_YES = { explainsToNovice: true, architectureConfidence: true };
const baseState = { exitCode: 0, killedForBudget: false, identityViolation: null, spawnError: null, liveUrl: null, siteExists: true };

// ---- the 66HEX/frame shape: mean 93/94, min 88/84, ONE operator boolean NO on mobile only ----
const q66hex = {
  passed: false,
  iterations: 3,
  scorecard: [
    device('mobile', { a: 95, b: 92, c: 88, d: 96 }, { ...OPS_YES, explainsToNovice: false }),
    device('desktop', { a: 97, b: 95, c: 84, d: 98 }, OPS_YES),
  ],
  refineNotes: [{ device: 'mobile', criterion: 'operator:explainsToNovice', score: 0, saw: 'operator answered NO' }],
};

test('66HEX shape (one operator NO, everything else clears) classifies near-miss with exactly that weakness', () => {
  const r = classifyEndState({ ...baseState, quality: q66hex });
  assert.equal(r.cls, 'near-miss');
  assert.equal(r.weaknesses.length, 1);
  assert.equal(r.weaknesses[0].kind, 'operator');
  assert.equal(r.weaknesses[0].name, 'explainsToNovice');
  assert.equal(r.weaknesses[0].device, 'mobile');
});

// ---- the supertonic shape: mean 87-88, B5-style axis at 60 on both devices, operators all YES ----
const qSupertonic = {
  passed: false,
  iterations: 3,
  scorecard: [
    device('mobile', { a: 94, b: 92, imagery: 60, d: 96 }, OPS_YES),
    device('desktop', { a: 95, b: 93, imagery: 60, d: 97 }, OPS_YES),
  ],
  refineNotes: [],
};

test('supertonic shape (one structural axis at 60 per device) classifies near-miss with both axes named', () => {
  const r = classifyEndState({ ...baseState, quality: qSupertonic });
  assert.equal(r.cls, 'near-miss');
  assert.equal(r.weaknesses.length, 2);
  assert.ok(r.weaknesses.every((w) => w.kind === 'axis' && w.name === 'imagery' && w.score === 60));
});

// ---- the bissanmu shape: environment failure pre-build — no graded site exists at all ----
test('bissanmu shape (env failure, nothing graded) classifies unbuilt — a cure has nothing to verify', () => {
  const r = classifyEndState({ ...baseState, siteExists: false, quality: undefined });
  assert.equal(r.cls, 'unbuilt');
  assert.equal(r.cure, false);
});

test('genuinely below-bar page (slop axis at 48) is NOT cured — the refusal stands honestly', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 90, b: 48 }, OPS_YES), device('desktop', { a: 91, b: 90 }, OPS_YES)], refineNotes: [] };
  const r = classifyEndState({ ...baseState, quality: q });
  assert.equal(r.cls, 'below-bar');
  assert.equal(r.cure, false);
});

test('a diffusely-mediocre page (mean below floor, no single nameable axis) is below-bar, not near-miss', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 75, b: 78, c: 80, d: 79 }, OPS_YES), device('desktop', { a: 90, b: 90, c: 90, d: 90 }, OPS_YES)], refineNotes: [] };
  assert.equal(classifyEndState({ ...baseState, quality: q }).cls, 'below-bar');
});

test('an agent-documented postCapManualFix is honored as near-miss even outside the envelope (427ffbb behavior preserved)', () => {
  const q = { passed: false, iterations: 3, postCapManualFix: 'raised the label staircase', scorecard: [device('mobile', { a: 90, b: 48 }, OPS_YES), device('desktop', { a: 91, b: 90 }, OPS_YES)], refineNotes: [] };
  assert.equal(classifyEndState({ ...baseState, quality: q }).cls, 'near-miss');
});

test('terminal states never cure: shipped, identity violation, budget kill, crash, graded-pass-undeployed routes to redeploy', () => {
  assert.equal(classifyEndState({ ...baseState, liveUrl: 'https://x.netlify.app', quality: q66hex }).cls, 'shipped');
  assert.equal(classifyEndState({ ...baseState, identityViolation: 'swap', quality: q66hex }).cls, 'identity-violation');
  assert.equal(classifyEndState({ ...baseState, killedForBudget: true, quality: q66hex }).cls, 'budget-exhausted');
  assert.equal(classifyEndState({ ...baseState, exitCode: 1, quality: q66hex }).cls, 'crash');
  const passing = { ...q66hex, passed: true };
  const r = classifyEndState({ ...baseState, quality: passing });
  assert.equal(r.cls, 'graded-pass-undeployed');
  assert.equal(r.cure, 'redeploy');
});

test('INV-18 failure is a named weakness', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 92, b: 90 }, OPS_YES, false), device('desktop', { a: 93, b: 91 }, OPS_YES)], refineNotes: [] };
  const w = namedWeaknesses(q);
  assert.ok(w.some((x) => x.kind === 'inv18' && x.device === 'mobile'));
});

test('cure prompt is narrow: names every weakness, forbids grading/deploying, requires re-assemble, attaches what the grader saw', () => {
  const p = buildCurePrompt({ repoUrl: 'https://github.com/66HEX/frame', buildDir: '/tmp/b', weaknesses: classifyEndState({ ...baseState, quality: q66hex }).weaknesses, quality: q66hex });
  assert.match(p, /explainsToNovice/);
  assert.match(p, /mobile/);
  assert.match(p, /operator answered NO/); // the grader's own rationale travels into the cure
  assert.match(p, /Do NOT run quality-grade/i);
  assert.match(p, /Do NOT run deploy/i);
  assert.match(p, /assemble-page/);
  assert.match(p, /ONLY/);
});

// ---- source-shape checks: the protocol's halves must live in EVERY file that speaks it. ----
// The 66HEX root cause was exactly this drift: a mechanism whose listener (runner) and speaker
// (agent instructions) disagreed because they lived in different files with no test pinning them.

test('agentic-runner imports and uses the classifier — the cure stage exists', () => {
  const src = read('bin/agentic-runner.mjs');
  assert.match(src, /from '\.\/cure\.mjs'/);
  assert.match(src, /classifyEndState\(/);
});

test('the runner prompt no longer says "ship immediately" and teaches quality.postCapManualFix', () => {
  const src = read('bin/agentic-runner.mjs');
  assert.doesNotMatch(src, /capReached, ship immediately/);
  assert.match(src, /postCapManualFix/);
});

test('SKILL.md documents the post-cap protocol (the agent-facing half)', () => {
  assert.match(read('skills/explainmyrepo/SKILL.md'), /postCapManualFix/);
});

test('quality-grade cap note points to the protocol instead of a dead-end "ship now"', () => {
  assert.match(read('tools/quality-grade.mjs'), /postCapManualFix/);
});

// 2026-07-19, run 29714490286 (the cure stage's own E2E proof run): the Anthropic key had hit its
// MONTHLY usage limit. The credential preflight probes GET /v1/models — a metadata endpoint that
// spends nothing — so authentication passed and the build died one step later with a generic
// message. The systemic principle applies to the fix itself: every new failure mode becomes a
// preflight, pinned here so the spend-probe can never silently regress to auth-only.
test('credential preflight proves the Anthropic key can SPEND (1-token completion), not just authenticate', () => {
  const src = read('bin/agentic-runner.mjs');
  assert.match(src, /api\.anthropic\.com\/v1\/messages/);
  assert.match(src, /max_tokens: 1/);
  assert.match(src, /usage limits\|regain access/i); // the distinct usage-limit classification
});

test('a mid-build usage-limit error reads as the honest budget message, not a generic snag', () => {
  const src = read('bin/agentic-runner.mjs');
  assert.match(src, /credit balance\|insufficient\.\*balance\|billing\|usage limits\|regain access/);
});

test('dispatch buffer covers the cure stage (agent + one grade + deploy) after a full-budget build', () => {
  assert.match(read('landing/netlify/functions/build.js'), /budgetMin \+ 25/);
  const wallMin = CURE.AGENT_WALL_MS / 60_000 + CURE.GRADE_WALL_MS / 60_000 + CURE.DEPLOY_WALL_MS / 60_000;
  assert.ok(wallMin <= 20, `cure worst case ${wallMin}min must fit the 25min buffer with margin`);
});
