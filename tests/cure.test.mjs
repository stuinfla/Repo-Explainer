// tests/cure.test.mjs — bin/cure.mjs: the end-state classifier, the ratchet decision and the cure prompt.
// Fixtures are shaped like the real incidents (66HEX/frame, supertone-inc/supertonic, bissanmu/spring3).

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEndState, namedWeaknesses, buildCurePrompt, decideCureDeploy } from '../bin/cure.mjs';

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

// A built page whose grader was recorded unavailable (quality.graderUnavailable, empty scorecard) is
// deliverable ungraded (deploy accepts it): one plain redeploy, not 'unbuilt'.
test('built + grader unavailable + not deployed classifies ungraded-undeployed -> redeploy; never without a site or the flag', () => {
  const q = { passed: false, iterations: 1, scorecard: [], graderUnavailable: true, graderError: 'vision API 529' };
  const r = classifyEndState({ ...baseState, quality: q });
  assert.equal(r.cls, 'ungraded-undeployed');
  assert.equal(r.cure, 'redeploy');
  assert.equal(classifyEndState({ ...baseState, siteExists: false, quality: q }).cls, 'unbuilt', 'no page, nothing to deploy');
  assert.equal(classifyEndState({ ...baseState, quality: { ...q, graderUnavailable: false } }).cls, 'unbuilt', 'a missing scorecard with no recorded reason is an unrun station');
  assert.equal(classifyEndState({ ...baseState, exitCode: 1, quality: q }).cls, 'crash');
  assert.equal(classifyEndState({ ...baseState, liveUrl: 'https://x.netlify.app', quality: q }).cure, false, 'already live: nothing to redeploy');
});

test('terminal states never cure: shipped, identity violation, budget kill, crash, graded-pass-undeployed routes to redeploy', () => {
  // A live URL is terminal only when the page PASSED. Below-bar-but-delivered is handled by the
  // improve-and-redeploy lane below (ADR-0011) — see the next test.
  assert.equal(classifyEndState({ ...baseState, liveUrl: 'https://x.netlify.app', quality: { ...q66hex, passed: true } }).cls, 'shipped');
  assert.equal(classifyEndState({ ...baseState, identityViolation: 'swap', quality: q66hex }).cls, 'identity-violation');
  assert.equal(classifyEndState({ ...baseState, killedForBudget: true, quality: q66hex }).cls, 'budget-exhausted');
  assert.equal(classifyEndState({ ...baseState, exitCode: 1, quality: q66hex }).cls, 'crash');
  const passing = { ...q66hex, passed: true };
  const r = classifyEndState({ ...baseState, quality: passing });
  assert.equal(r.cls, 'graded-pass-undeployed');
  assert.equal(r.cure, 'redeploy');
});

// ADR-0011: a live URL must not short-circuit the cure lane (the near-miss repair stays reachable after delivery).
test('ADR-0011 — a DELIVERED but below-bar page still reaches the cure lane (deliver, THEN improve)', () => {
  const r = classifyEndState({ ...baseState, liveUrl: 'https://x.netlify.app', quality: q66hex });
  assert.equal(r.cls, 'shipped-below-bar',
    'a live URL must no longer short-circuit the cure — that silently killed the whole repair lane');
  assert.equal(r.cure, 'improve-and-redeploy');
  assert.ok(r.weaknesses.length >= 1, 'the cure agent needs named weaknesses to work on');
});

test('ADR-0011 — a delivered page with nothing nameable to fix is left alone (no pointless cure spend)', () => {
  const noNamedWeakness = { passed: false, iterations: 3, scorecard: [], refineNotes: [] };
  const r = classifyEndState({ ...baseState, liveUrl: 'https://x.netlify.app', quality: noNamedWeakness });
  assert.equal(r.cure, false, 'without a named weakness there is nothing for a cure agent to act on');
});

test('RATCHET — a live page is replaced only by a strictly better verdict; an unpublished one is always delivered', () => {
  const pre = { scorecard: [device('m', { a: 90, b: 64 })] };
  const worse = { scorecard: [device('m', { a: 99, b: 60 })] };
  const better = { scorecard: [device('m', { a: 92, b: 66 })] };
  assert.equal(decideCureDeploy({ wasLive: true, beforeQuality: pre, afterQuality: worse }).deploy, false, 'a worse cure must never replace the delivered page');
  assert.equal(decideCureDeploy({ wasLive: true, beforeQuality: pre, afterQuality: pre }).deploy, false, 'no change is not an improvement');
  assert.equal(decideCureDeploy({ wasLive: true, beforeQuality: pre, afterQuality: better }).deploy, true);
  assert.equal(decideCureDeploy({ wasLive: false, beforeQuality: pre, afterQuality: worse }).deploy, true, 'nothing is live: deliver whatever the fresh grade says');
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
