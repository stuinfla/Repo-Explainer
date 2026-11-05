// tests/review-c-cure-and-budget.test.mjs — code-review findings 2b, 4, 8 and 9a (3.0.0 review).
//
//  9a  A DELIVERED below-bar page used to go to the cure agent whatever its shape (10 min + a full
//      regrade), skipping the near-miss envelope that held pages get. Same limits now apply.
//  2b  A deterministic pre-check refusal (quality.gateRefusal) left no scorecard and was classed
//      'unbuilt' — no repair — although the page exists and the blocker is fixable copy.
//  4   When the cure did not replace the live page, site/, assets/ and build.json kept the REJECTED
//      repair, so the status gist and requester email showed a page nobody deployed.
//  8   --budget-usd was never enforced during the main run (cost only arrives on the final
//      `result` event). Native --max-budget-usd + a streamed-usage backstop now enforce it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyEndState, buildCurePrompt, CURE, cureImproved,
  snapshotForCure, restoreCureSnapshot, discardCureSnapshot, shouldRestoreAfterCure,
  maxBudgetArgs, createCostMeter, overUsdBackstop, isNativeBudgetStop, rateFor, USD_BACKSTOP_FACTOR,
} from '../bin/cure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const device = (label, axes, operators = { explainsToNovice: true }) => ({ deviceLabel: label, gateA: axes, gateB: {}, operatorQuestions: operators, inv18: { passed: true } });
const live = { exitCode: 0, killedForBudget: false, identityViolation: null, spawnError: null, liveUrl: 'https://x.netlify.app', siteExists: true };
const held = { ...live, liveUrl: null };

// ── 9a ──────────────────────────────────────────────────────────────────────────────────────────
test('9a — a delivered page with a slop axis (48) is NOT sent to the cure agent', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 90, b: 48 }), device('desktop', { a: 91, b: 90 })], refineNotes: [] };
  const r = classifyEndState({ ...live, quality: q });
  assert.equal(r.cls, 'shipped-below-bar');
  assert.equal(r.cure, false);
  assert.equal(r.weaknesses.length, 1, 'the weakness is still reported for the record');
});

test('9a — a delivered, diffusely mediocre page (device mean 74.75 < 82, one axis at 65) is NOT sent to the cure agent', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 75, b: 65, c: 80, d: 79 }), device('desktop', { a: 90, b: 90, c: 90, d: 90 })], refineNotes: [] };
  const r = classifyEndState({ ...live, quality: q });
  assert.equal(r.weaknesses.length, 1, 'there IS a nameable weakness — the envelope, not its absence, is what refuses');
  assert.equal(r.cure, false);
});

test(`9a — a delivered page with more than ${CURE.MAX_WEAKNESSES} named weaknesses is NOT sent to the cure agent`, () => {
  const ops = { o1: false, o2: false, o3: false, o4: false, o5: false };
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 95, b: 95 }, ops), device('desktop', { a: 95, b: 95 })], refineNotes: [] };
  assert.equal(classifyEndState({ ...live, quality: q }).cure, false);
});

test('9a — a delivered near-miss (inside the envelope) still gets improve-and-redeploy, and held pages are unchanged', () => {
  const q = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 95, b: 92, c: 88 }, { explainsToNovice: false }), device('desktop', { a: 97, b: 95, c: 84 })], refineNotes: [] };
  const r = classifyEndState({ ...live, quality: q });
  assert.equal(r.cure, 'improve-and-redeploy');
  assert.equal(r.weaknesses.length, 1);
  assert.equal(classifyEndState({ ...held, quality: q }).cure, 'fix-and-regrade');
});

// ── 2b ──────────────────────────────────────────────────────────────────────────────────────────
const refused = {
  passed: false, iterations: 0, scorecard: [], gateRefusal: 'INV-20 UnexplainedAcronymZero: SSG, CRDT unexplained',
  refineNotes: [{ device: 'both', criterion: 'operator:zeroKnowledgeReader', score: 0, note: 'define each term inline' }],
};

test('2b — a quality pre-check refusal is its own REPAIRABLE class, not "unbuilt"', () => {
  const r = classifyEndState({ ...held, quality: refused });
  assert.equal(r.cls, 'gate-refusal');
  assert.equal(r.cure, 'fix-and-regrade');
  assert.equal(r.weaknesses.length, 1);
  assert.equal(r.weaknesses[0].name, refused.gateRefusal);
  assert.equal(r.weaknesses[0].saw, 'define each term inline');
  const p = buildCurePrompt({ repoUrl: 'https://github.com/a/b', buildDir: '/tmp/b', weaknesses: r.weaknesses, quality: refused });
  assert.match(p, /INV-20 UnexplainedAcronymZero/);
  assert.match(p, /define each term inline/);
});

test('2b — no gateRefusal, no site, crash or budget kill still never cure', () => {
  assert.equal(classifyEndState({ ...held, quality: { ...refused, gateRefusal: undefined } }).cls, 'unbuilt');
  assert.equal(classifyEndState({ ...held, quality: { ...refused, gateRefusal: '   ' } }).cls, 'unbuilt');
  assert.equal(classifyEndState({ ...held, siteExists: false, quality: refused }).cls, 'unbuilt');
  assert.equal(classifyEndState({ ...held, exitCode: 1, quality: refused }).cls, 'crash');
  assert.equal(classifyEndState({ ...held, killedForBudget: true, quality: refused }).cls, 'budget-exhausted');
});

test('2b — a gate-refused page that deploy.mjs DELIVERED still reaches the cure (not "shipped, nothing to fix")', () => {
  const r = classifyEndState({ ...live, quality: refused });
  assert.equal(r.cls, 'shipped-gate-refusal');
  assert.equal(r.cure, 'improve-and-redeploy');
  assert.equal(r.weaknesses[0].name, refused.gateRefusal);
});

test('2b — the ratchet lets a cured page replace a live gate-refused one only if it now grades cleanly', () => {
  const graded = { passed: false, scorecard: [device('mobile', { a: 84, b: 72 })] };
  assert.equal(cureImproved(refused, graded).improved, true, 'refused (no scores) -> real vision grade is better');
  assert.equal(cureImproved(refused, refused).improved, false, 'still refused is not better');
  assert.equal(cureImproved(refused, { ...graded, gateRefusal: 'INV-24 reads above age 15' }).improved, false, 'a regrade that is itself refused never replaces anything');
  assert.equal(cureImproved({ scorecard: [] }, graded).improved, false, 'an ungraded live page with no recorded refusal keeps the old rule');
  // the pre-existing ratchet, unchanged
  const pre = { scorecard: [device('m', { a: 90, b: 64 })] };
  assert.equal(cureImproved(pre, { scorecard: [device('m', { a: 80, b: 66 })] }).improved, true, 'higher min wins');
  assert.equal(cureImproved(pre, { scorecard: [device('m', { a: 99, b: 63 })] }).improved, false, 'lower min loses whatever the mean');
  assert.equal(cureImproved(pre, { scorecard: [device('m', { a: 91, b: 64 })] }).improved, false, 'mean +0.5 is not enough');
  assert.equal(cureImproved(pre, { scorecard: [device('m', { a: 92, b: 64 })] }).improved, true, 'same min, mean +1 wins');
});

// ── 4 ───────────────────────────────────────────────────────────────────────────────────────────
function makeBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-c-build-'));
  fs.mkdirSync(path.join(dir, 'site'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), 'LIVE v1');
  fs.writeFileSync(path.join(dir, 'assets', 'screenshot-mobile-390.png'), 'SHOT v1');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/a/b' },
    publish: { liveUrl: 'https://x.netlify.app', http200: true },
    quality: { passed: false, iterations: 3, scorecard: [device('mobile', { a: 88, b: 64 })] },
  }));
  return dir;
}

test('4 — a rejected cure is rolled back: site/, screenshots and build.json describe the LIVE page again', () => {
  const dir = makeBuild();
  const snap = snapshotForCure(dir);
  // Simulate cure agent + regrade + failed/withheld redeploy.
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), 'REPAIRED v2');
  fs.writeFileSync(path.join(dir, 'site', 'extra.svg'), '<svg/>');
  fs.writeFileSync(path.join(dir, 'assets', 'screenshot-mobile-390.png'), 'SHOT v2');
  const repaired = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  repaired.quality = { passed: false, iterations: 3, scorecard: [device('mobile', { a: 70, b: 60 })] };
  repaired.publish.http200 = false;
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(repaired));

  restoreCureSnapshot(dir, snap, { endState: 'shipped-below-bar', outcome: 'not-deployed' });
  assert.equal(fs.readFileSync(path.join(dir, 'site', 'index.html'), 'utf8'), 'LIVE v1');
  assert.equal(fs.existsSync(path.join(dir, 'site', 'extra.svg')), false, 'files the cure added must not survive');
  assert.equal(fs.readFileSync(path.join(dir, 'assets', 'screenshot-mobile-390.png'), 'utf8'), 'SHOT v1');
  const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.deepEqual(ctx.quality.scorecard[0].gateA, { a: 88, b: 64 }, 'the scores must be the live page\'s');
  assert.equal(ctx.publish.http200, true);
  assert.equal(ctx.quality.cure.outcome, 'not-deployed', 'the attempt stays on record');
  discardCureSnapshot(snap);
  assert.equal(fs.existsSync(snap), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('4 — restore exactly when a live page was NOT replaced', () => {
  assert.equal(shouldRestoreAfterCure({ wasLive: true, redeployed: false }), true);
  assert.equal(shouldRestoreAfterCure({ wasLive: true, redeployed: true }), false);
  assert.equal(shouldRestoreAfterCure({ wasLive: false, redeployed: false }), false);
  assert.equal(shouldRestoreAfterCure({ wasLive: null, redeployed: true }), false);
});

test('4/8 — the runner wires the snapshot and both $ guards (complements the behaviour tests above)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin/agentic-runner.mjs'), 'utf8');
  assert.match(src, /cureSnapshot = snapshotForCure\(buildDir\)/);
  assert.match(src, /shouldRestoreAfterCure\(\{ wasLive: liveBeforeCure, redeployed: cureRedeployed \}\)/);
  assert.match(src, /\.\.\.budgetArgs,/);
  assert.match(src, /costMeter\.add\(evt\)/);
  assert.match(src, /isNativeBudgetStop\(evt\)/);
});

// ── 8 ───────────────────────────────────────────────────────────────────────────────────────────
const asst = (id, usage) => ({ type: 'assistant', message: { id, usage, content: [] } });

test('8 — repeated stream events for ONE message are counted once (no double counting)', () => {
  const m = createCostMeter('claude-sonnet-5-5');
  const u = { input_tokens: 1000, output_tokens: 500 };
  m.add(asst('msg_1', u)); m.add(asst('msg_1', u)); m.add(asst('msg_1', u));
  assert.ok(Math.abs(m.usd - 0.007) < 1e-12, `expected $0.007 (1000*2+500*10)/1e6, got ${m.usd}`);
  m.add(asst('msg_2', u));
  assert.ok(Math.abs(m.usd - 0.014) < 1e-12, `two distinct messages sum, got ${m.usd}`);
});

test('8 — cache tokens are priced (Claude Code spends mostly on cached input)', () => {
  const m = createCostMeter('claude-sonnet-5-5');
  m.add(asst('a', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6 }));
  assert.ok(Math.abs(m.usd - 0.2) < 1e-9, `1M cache-read tokens at 0.1x $2 = $0.20, got ${m.usd}`);
  m.add(asst('b', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1e6 }));
  assert.ok(Math.abs(m.usd - 2.7) < 1e-9, `+1M cache-write at 1.25x $2 = $2.70 total, got ${m.usd}`);
});

test('8 — the OpenRouter lane id resolves to the same rate; unknown models disable the backstop', () => {
  assert.deepEqual(rateFor('anthropic/claude-sonnet-5.5'), [2, 10]);
  assert.deepEqual(rateFor('claude-sonnet-5-5'), [2, 10]);
  const u = createCostMeter('some-other-model');
  u.add(asst('x', { input_tokens: 1e9, output_tokens: 1e9 }));
  assert.equal(u.known, false);
  assert.equal(u.usd, 0);
});

test('8 — a replayed stream trips the backstop on the turn that crosses budget x factor, not before', () => {
  const budget = 8.1; // threshold $10.125 — away from float-equality edges
  const m = createCostMeter('claude-sonnet-5-5');
  let trippedAt = null;
  // each turn: 100k fresh input ($0.20) + 20k output ($0.20) = $0.40, each emitted as 2 events
  for (let turn = 1; turn <= 40 && trippedAt === null; turn++) {
    const u = { input_tokens: 100_000, output_tokens: 20_000 };
    m.add(asst(`msg_${turn}`, u)); m.add(asst(`msg_${turn}`, u));
    if (overUsdBackstop(m.usd, budget)) trippedAt = turn;
  }
  assert.equal(USD_BACKSTOP_FACTOR, 1.25);
  assert.equal(trippedAt, 26, `$0.40/turn: turn 25 = $10.00 (under $10.125), turn 26 = $10.40 (over), got ${trippedAt}`);
  assert.equal(overUsdBackstop(9.99, 8), false);
  assert.equal(overUsdBackstop(10.01, 8), true);
  assert.equal(overUsdBackstop(1e6, 0), false, 'no budget configured = no backstop kill');
});

test('8 — the native cap is passed to claude and its stop is recognised', () => {
  assert.deepEqual(maxBudgetArgs(8), ['--max-budget-usd', '8']);
  assert.deepEqual(maxBudgetArgs('6'), ['--max-budget-usd', '6']);
  assert.deepEqual(maxBudgetArgs(2.345), ['--max-budget-usd', '2.35']);
  assert.deepEqual(maxBudgetArgs(0.004), ['--max-budget-usd', '0.01'], 'the CLI rejects 0');
  assert.deepEqual(maxBudgetArgs(0), []);
  assert.deepEqual(maxBudgetArgs(NaN), []);
  assert.deepEqual(maxBudgetArgs(-1), []);
  assert.equal(isNativeBudgetStop({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 8.3 }), true);
  assert.equal(isNativeBudgetStop({ type: 'result', subtype: 'success' }), false);
  assert.equal(isNativeBudgetStop({ type: 'assistant', subtype: 'error_max_budget_usd' }), false);
});
