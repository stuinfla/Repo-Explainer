// tests/review-c-cure-and-budget.test.mjs — cure-lane envelope, gate-refusal repair, rollback of a rejected cure, the $ ceiling, receipts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeRun, createStreamHandler, scorecardOf, disclosureOf, buildAgentPrompt, elapsedMinutes, classifyFailure, agentReportOf, liveUrlOf } from '../bin/runner-lib.mjs';
import { recordClaims } from '../src/claims-record.mjs';
import { MAX_QUALITY_ITERATIONS } from '../tools/quality-grade.mjs';
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
  passed: false, iterations: 0, scorecard: [], gateRefusal: 'INV-20 unexplained acronym(s): SSG, CRDT',
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
  assert.match(p, /INV-20 unexplained acronym\(s\): SSG, CRDT/);
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

// ── the runner's after-agent decisions, as the real functions ────────────────────────────────────────
const END = { exitCode: 0, killedForBudget: false, killedForUsd: null, spawnErrorMsg: null, agentReported: null, liveUrl: 'https://x.netlify.app',
  finalCtx: { repo: { url: 'https://github.com/a/b' } }, submittedRepoId: 'a/b', budgetMin: 20, budgetUsd: 8, totalCostUsd: 3.456 };

test('finalizeRun: ok needs a clean exit, no budget kill, a live URL and the right repo', () => {
  assert.equal(finalizeRun(END).ok, true);
  assert.equal(finalizeRun({ ...END, exitCode: 1 }).ok, false);
  assert.equal(finalizeRun({ ...END, liveUrl: null }).ok, false);
  assert.equal(finalizeRun({ ...END, killedForBudget: true }).ok, false, 'a wall-clock kill is never ok, even with a live URL');
  assert.equal(finalizeRun({ ...END, killedForUsd: 'backstop' }).ok, false, 'a $ kill is never ok, even with a live URL');
});

test('finalizeRun: the failure reason names the real cause, in priority order', () => {
  assert.match(finalizeRun({ ...END, liveUrl: null, exitCode: -1, spawnErrorMsg: 'spawn claude ENOENT' }).reason, /could not start the claude binary: spawn claude ENOENT/);
  assert.match(finalizeRun({ ...END, exitCode: 0, killedForUsd: 'native' }).reason, /\$8 dollar budget.*~\$3\.46 spent; stopped by Claude Code --max-budget-usd/);
  assert.match(finalizeRun({ ...END, killedForUsd: 'backstop' }).reason, /streamed-usage backstop/);
  assert.match(finalizeRun({ ...END, killedForBudget: true }).reason, /exceeded its 20-minute budget/);
  assert.equal(finalizeRun({ ...END, liveUrl: null, agentReported: { ok: false, reason: 'repo is empty' } }).reason, 'repo is empty');
  assert.match(finalizeRun({ ...END, liveUrl: null, exitCode: 2 }).reason, /exited 2/);
  assert.match(finalizeRun({ ...END, liveUrl: null }).reason, /no verified live URL/);
});

test('classifyFailure: the submitter hears an honest category, never the raw reason', () => {
  assert.match(classifyFailure('exceeded its $8 dollar budget before finishing'), /free per-build budget/);
  assert.match(classifyFailure('exceeded its 20-minute budget'), /more time/);
  assert.match(classifyFailure('Credit balance is too low'), /community budget/);
  assert.doesNotMatch(classifyFailure('TypeError: x is not a function'), /TypeError/);
});

test('agent report + live URL: build.json is the truth; the agent RESULT line never supplies a URL', () => {
  const rep = agentReportOf('did stuff\nRESULT: {"ok": true, "liveUrl": "https://agent.example"}');
  assert.deepEqual(rep, { ok: true, liveUrl: 'https://agent.example' });
  assert.equal(liveUrlOf({ publish: { liveUrl: 'https://real.example', http200: true } }), 'https://real.example');
  assert.equal(liveUrlOf({ publish: { liveUrl: 'https://real.example', http200: false } }), null, 'an unverified URL is not a live URL');
  assert.equal(liveUrlOf({ publish: { liveUrl: 'https://real.example' } }), null, 'no http200 flag, no live URL');
  assert.equal(liveUrlOf(null), null, 'nothing in build.json, nothing live — whatever the agent printed');
  assert.equal(agentReportOf('RESULT: {not json}'), null);
});

test('elapsedMinutes reports real elapsed time (the alert used to send the BUDGET as elapsed)', () => {
  assert.equal(elapsedMinutes(0, 7 * 60_000 + 20_000), 7);
  assert.equal(elapsedMinutes(1_000_000, 1_000_000), 0);
  assert.equal(elapsedMinutes(5000, 0), 0, 'never negative');
});

// The $ ceiling: a replayed stream drives the real handler and its stop callback.
test('stream handler: the streamed backstop stops an agent that ignores the native cap; the native stop is recorded', () => {
  let stops = 0;
  const h = createStreamHandler({ costMeter: createCostMeter('claude-sonnet-5-5'), budgetUsd: 8.1, stop: () => { stops++; } });
  const line = (id) => JSON.stringify(asst(id, { input_tokens: 100_000, output_tokens: 20_000 })) + '\n'; // $0.40 per message
  for (let i = 1; i <= 25; i++) h.feed(line(`m${i}`));
  assert.equal(stops, 0, 'turn 25 = $10.00, under the $10.125 backstop');
  assert.equal(h.state.killedForUsd, null);
  h.feed(line('m26'));
  assert.equal(h.state.killedForUsd, 'backstop');
  assert.equal(stops, 1);
  h.feed(line('m27'));
  assert.equal(stops, 1, 'the stop fires once');

  const n = createStreamHandler({ costMeter: createCostMeter('claude-sonnet-5-5'), budgetUsd: 8 });
  n.feed(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 8.3, result: 'stopped' }) + '\n');
  assert.equal(n.state.killedForUsd, 'native');
  assert.equal(n.state.totalCostUsd, 8.3);
  assert.equal(n.state.sawResultEvent, true);
});

test('stream handler: lines split across chunks reassemble, junk lines are skipped, tool calls surface', () => {
  const tools = [];
  const h = createStreamHandler({ costMeter: createCostMeter('claude-sonnet-5-5'), budgetUsd: 8, onToolUse: (b) => tools.push(b.name) });
  const evt = JSON.stringify({ type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }], usage: {} } });
  h.feed('not json at all\n' + evt.slice(0, 20));
  h.feed(evt.slice(20) + '\n');
  assert.deepEqual(tools, ['Bash']);
  h.feed(JSON.stringify({ type: 'result', result: 'RESULT: {"ok":true}', total_cost_usd: 1.5 }) + '\n');
  assert.equal(h.state.finalResultText, 'RESULT: {"ok":true}');
  assert.equal(h.state.totalCostUsd, 1.5);
});

// ── the receipt that travels with the build ─────────────────────────────────────────────────────────
test('ADR-0011 D4 / 0012 D4: the receipt records the below-bar disclosure and the FORM each diagram took', () => {
  const ctx = {
    publish: { belowBar: true, weakest: 'the diagrams and imagery' },
    visuals: { architectureDiagram: { form: 'radial', formVariant: 'orbit' }, flowDiagram: { form: 'flow' } },
    quality: { passed: false, exemplary: false, iterations: 3, scorecard: [device('mobile', { a: 88, b: 64 })] },
  };
  const d = disclosureOf(ctx);
  assert.deepEqual(d.publishDisclosure, { belowBar: true, graderUnavailable: false, weakest: 'the diagrams and imagery' });
  assert.deepEqual(d.diagramForms, { architectureDiagram: { form: 'radial', variant: 'orbit' }, flowDiagram: { form: 'flow', variant: null } });
  const sc = scorecardOf(ctx, 'openrouter');
  assert.equal(sc.executor, 'openrouter');
  assert.equal(sc.iterations, 3);
  assert.deepEqual(sc.devices[0].gateA, { a: 88, b: 64 });
  assert.deepEqual(sc.belowBarDelivery, d.publishDisclosure);
  assert.equal(scorecardOf({ quality: { scorecard: [] } }, 'anthropic'), null, 'nothing graded, no scorecard');
});

// ── the brief the hosted agent runs on ──────────────────────────────────────────────────────────────
test('the agent brief: refine cap equals the tool\'s MAX_QUALITY_ITERATIONS, deploy at the cap, scorecard is disclosure, no retired protocol', () => {
  const p = buildAgentPrompt({ repoUrl: 'https://github.com/a/b', buildDir: '/tmp/b', budgetMin: 17, budgetUsd: 6 });
  assert.match(p, new RegExp(`capped at ${MAX_QUALITY_ITERATIONS} total quality-grade calls \\(1 initial \\+ ${MAX_QUALITY_ITERATIONS - 1} refines\\)`));
  assert.match(p, /RUN DEPLOY AND YOU ARE DONE/);
  assert.match(p, /ADR-0011/);
  assert.match(p, /DISCLOSURE/);
  assert.match(p, /approximate budget of 17 minutes and \$6/);
  assert.doesNotMatch(p, /postCapManualFix|ship-best-effort|capReached, ship immediately/);
});

// ── advisory claims check ───────────────────────────────────────────────────────────────────────────
test('recordClaims writes the advisory result into build.json `claims` and never touches the other slots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/a/b' }, kb: {},
    content: { citations: [{ claim: 'it is fast', passageId: 'p-missing' }] },
    quality: { passed: true },
  }));
  const res = recordClaims(dir, { root: ROOT, log: () => {} });
  const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.equal(ctx.claims.advisory, true);
  assert.equal(ctx.claims.citations.total, 1);
  assert.equal(ctx.claims.citations.missing.length, 1, 'a citation with no passage in the KB is reported');
  assert.equal(ctx.claims.ok, false);
  assert.equal(res.findings, ctx.claims.findings);
  assert.equal(ctx.claims.commands.checked, undefined, 'the bulky checked list is not persisted');
  assert.deepEqual(ctx.quality, { passed: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
