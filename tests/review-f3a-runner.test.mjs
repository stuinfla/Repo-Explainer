// tests/review-f3a-runner.test.mjs — the hosted runner's decisions, driven through the real functions
// with stubbed effects: the cure stage (ratchet, restore, landed-deploy), the budget, the preflight,
// the dispatch buffer and the agent brief/env.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCureStage, deployLanded, classifyEndState, namedWeaknesses, CURE } from '../bin/cure.mjs';
import { probeEmbedding } from '../bin/runner-preflight.mjs';
import { agentWallMs, MIN_AGENT_WALL_MS, postAgentWorstCaseMin, buildAgentEnv, buildAgentPrompt } from '../bin/runner-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = (axes, ops = { explainsToNovice: true }) => ({ deviceLabel: 'mobile', gateA: axes, gateB: {}, operatorQuestions: ops, inv18: { passed: true } });
const NEAR_MISS = { passed: false, iterations: 3, scorecard: [dev({ a: 95, b: 92, c: 66 })], refineNotes: [] };   // one axis under 70
const BETTER = { passed: false, iterations: 3, scorecard: [dev({ a: 95, b: 92, c: 72 })], refineNotes: [] };
const WORSE = { passed: false, iterations: 3, scorecard: [dev({ a: 95, b: 92, c: 60 })], refineNotes: [] };
const LIVE = { liveUrl: 'https://x.netlify.app', http200: true };

// A fake world: build.json in memory, effects recorded. `deployResult` mutates the publish slot like deploy.mjs would.
function world({ quality = NEAR_MISS, publish = LIVE, regrade = BETTER, deployStatus = 0, deployPublish = {}, cureStatus = 0 } = {}) {
  const w = { build: { repo: { url: 'https://github.com/a/b' }, quality, publish }, deploys: 0, restored: null, discarded: 0, cureSpawns: 0, grades: 0, logs: [] };
  w.deps = {
    readBuild: () => JSON.parse(JSON.stringify(w.build)),
    writeBuild: (o) => { w.build = JSON.parse(JSON.stringify(o)); },
    siteExists: () => true,
    deploy: () => { w.deploys++; w.build.publish = { ...w.build.publish, ...deployPublish }; return { status: deployStatus }; },
    cureAgent: () => { w.cureSpawns++; return { status: cureStatus, stdout: JSON.stringify({ total_cost_usd: 0.5 }) }; },
    grade: () => { w.grades++; w.build.quality = JSON.parse(JSON.stringify(regrade)); return { status: 0 }; },
    snapshot: { take: () => 'SNAP', restore: (dir, snap, rec) => { w.restored = { dir, snap, rec }; }, discard: () => { w.discarded++; } },
    log: (m) => w.logs.push(m),
  };
  return w;
}
const STATE = { buildDir: '/b', repoUrl: 'https://github.com/a/b', exitCode: 0, killedForBudget: false, killedForUsd: null, identityViolation: null, spawnErrorMsg: null, liveUrl: LIVE.liveUrl, totalCostUsd: 3, budgetUsd: 8 };

test('ratchet: a cure that makes a LIVE page worse is never deployed and the live version is restored', async () => {
  const w = world({ regrade: WORSE });
  const r = await runCureStage(STATE, w.deps);
  assert.equal(w.cureSpawns, 1);
  assert.equal(w.grades, 1, 'exactly one verification grade');
  assert.equal(w.deploys, 0, 'a worse page must not be deployed');
  assert.equal(r.cureRedeployed, false);
  assert.ok(w.restored, 'build dir rolled back to the live version');
  assert.equal(w.restored.rec.outcome.startsWith('not-deployed'), true);
  assert.equal(w.discarded, 1);
});

test('ratchet: a strictly better cure IS deployed, nothing is restored, cost of the cure agent is added', async () => {
  const w = world({ regrade: BETTER, deployPublish: { liveUrl: LIVE.liveUrl, http200: true } });
  const r = await runCureStage(STATE, w.deps);
  assert.equal(w.deploys, 1);
  assert.equal(r.cureRedeployed, true);
  assert.equal(w.restored, null);
  assert.equal(r.totalCostUsd, 3.5);
  assert.equal(r.liveUrl, LIVE.liveUrl);
  assert.equal(w.build.quality.cure.cureAgentSpawned, true);
});

test('a deploy that dies AFTER reaching Netlify (share card) counts as landed: no restore, no "original untouched" claim', async () => {
  const w = world({ regrade: BETTER, deployStatus: 1, deployPublish: { liveUrl: LIVE.liveUrl, http200: true, shareCardError: 'og:image 404' } });
  const r = await runCureStage(STATE, w.deps);
  assert.equal(r.cureRedeployed, true, 'the cured page is what Netlify serves');
  assert.equal(w.restored, null, 'rolling back would make build.json describe a page that is no longer served');
  assert.ok(!w.logs.some((l) => /still live and untouched/.test(l)));
  assert.ok(w.logs.some((l) => /og:image 404/.test(l)));
});

test('a deploy that fails BEFORE landing (nothing new in the publish record) keeps the live page and restores', async () => {
  const w = world({ regrade: BETTER, deployStatus: 1 });
  const r = await runCureStage(STATE, w.deps);
  assert.equal(r.cureRedeployed, false);
  assert.ok(w.restored);
  assert.ok(w.logs.some((l) => /still live and untouched/.test(l)));
});

test('the $ budget guard: a near-miss with the budget already spent spawns no cure agent', async () => {
  const w = world();
  const r = await runCureStage({ ...STATE, totalCostUsd: 8 }, w.deps);
  assert.equal(w.cureSpawns, 0);
  assert.equal(r.cureRedeployed, false);
  assert.equal(w.restored, null);
});

test('no cure after a budget kill, a crash exit or an identity violation', async () => {
  for (const bad of [{ killedForBudget: true }, { killedForUsd: 'native' }, { exitCode: 1 }, { identityViolation: 'swap' }]) {
    const w = world();
    await runCureStage({ ...STATE, ...bad }, w.deps);
    assert.equal(w.cureSpawns + w.deploys + w.grades, 0, JSON.stringify(bad));
  }
});

test('a held graded-pass page gets one plain redeploy, which counts only when it landed', async () => {
  const w = world({ quality: { ...NEAR_MISS, passed: true }, publish: undefined, deployPublish: { liveUrl: 'https://new.netlify.app', http200: true } });
  const r = await runCureStage({ ...STATE, liveUrl: null }, w.deps);
  assert.equal(w.deploys, 1);
  assert.equal(r.liveUrl, 'https://new.netlify.app');
});

test('deployLanded: exit 0 + verified record, shareCardError that is NEW, or a changed deployId; nothing else', () => {
  assert.deepEqual(deployLanded(0, LIVE, LIVE), { landed: true, verified: true, liveUrl: LIVE.liveUrl });
  assert.equal(deployLanded(1, LIVE, LIVE).landed, false, 'a failed deploy that wrote nothing new did not land');
  assert.equal(deployLanded(1, LIVE, { ...LIVE, shareCardError: 'x' }).landed, true);
  assert.equal(deployLanded(1, { ...LIVE, shareCardError: 'x' }, { ...LIVE, shareCardError: 'x' }).landed, false, 'a stale error is not evidence');
  assert.equal(deployLanded(1, { ...LIVE, deployId: 'd1' }, { ...LIVE, deployId: 'd2' }).landed, true);
  assert.equal(deployLanded(1, { ...LIVE, deployId: 'd1' }, { ...LIVE, deployId: 'd1' }).landed, false);
  assert.equal(deployLanded(0, LIVE, { liveUrl: 'https://x', http200: false }).landed, false, 'exit 0 without a verified record is not a landing');
});

test('classifyEndState never throws on a live page with no quality record (reachable now that only build.json supplies the URL)', () => {
  const r = classifyEndState({ exitCode: 0, killedForBudget: false, identityViolation: null, spawnError: null, liveUrl: 'https://x', siteExists: true, quality: undefined });
  assert.equal(r.cls, 'shipped');
  assert.deepEqual(namedWeaknesses(undefined), []);
});

test('budget: pre-agent time is counted against the agent wall-clock', () => {
  const t0 = 1_000_000;
  assert.equal(agentWallMs({ budgetMin: 40, startedAt: t0, now: t0 }), 40 * 60_000);
  assert.equal(agentWallMs({ budgetMin: 40, startedAt: t0, now: t0 + 6 * 60_000 }), 34 * 60_000, 'a 6-minute tournament/setup leaves 34');
  assert.equal(agentWallMs({ budgetMin: 40, startedAt: t0, now: t0 + 40 * 60_000 - MIN_AGENT_WALL_MS + 1 }), 0, 'too little left = do not start the agent');
  assert.equal(agentWallMs({ budgetMin: 40, startedAt: t0, now: t0 - 5 }), 40 * 60_000, 'a clock skew never grants extra time');
});

test('dispatch buffer: build.js timeout is budget + 25 for every tier and covers the post-agent worst case', async () => {
  const require = createRequire(import.meta.url);
  const { handler } = require(path.join(ROOT, 'landing', 'netlify', 'functions', 'build.js'));
  const realFetch = globalThis.fetch;
  process.env.EXPLAINER_GH_TOKEN = 't';
  try {
    for (const [sizeKb, tier] of [[10, 'small'], [30_000, 'medium'], [300_000, 'large']]) {
      let dispatched = null;
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith('/actions/workflows/build-explainer.yml/dispatches')) { dispatched = JSON.parse(init.body).inputs; return { ok: true, status: 204, text: async () => '' }; }
        if (u === 'https://api.github.com/gists') return { ok: true, status: 201, json: async () => ({ id: 'g1' }), text: async () => '' };
        if (u.startsWith('https://api.github.com/repos/o/r')) return { ok: true, status: 200, json: async () => ({ private: false, size: sizeKb }), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      };
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ url: 'o/r' }) });
      assert.equal(res.statusCode, 200, `${tier}: ${res.body}`);
      assert.equal(Number(dispatched.timeout_min), Number(dispatched.budget_min) + 25, tier);
      assert.ok(postAgentWorstCaseMin() + 1 <= 25, `cure (${CURE.AGENT_WALL_MS / 60000}+${CURE.GRADE_WALL_MS / 60000}+${CURE.DEPLOY_WALL_MS / 60000}) + status retries = ${postAgentWorstCaseMin()} min must fit the 25 min buffer with a minute spare`);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('embedding preflight probes the source the build really uses (Hugging Face), not the release asset', async () => {
  const urls = [];
  const ok = async (u) => { urls.push(String(u)); return { ok: true, status: 200 }; };
  assert.equal((await probeEmbedding({ cachedModelExists: true, fetchFn: ok })).ok, true);
  assert.equal(urls.length, 0, 'a cached model needs no network');
  const r = await probeEmbedding({ cachedModelExists: false, fetchFn: ok });
  assert.equal(r.ok, true);
  assert.deepEqual(urls.map((u) => new URL(u).host), ['huggingface.co']);
  assert.doesNotMatch(r.why, /release asset/);
  const down = await probeEmbedding({ cachedModelExists: false, fetchFn: async () => ({ ok: false, status: 503 }) });
  assert.equal(down.ok, false);
  assert.match(down.why, /503/);
  const thrown = await probeEmbedding({ cachedModelExists: false, fetchFn: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(thrown.ok, false);
  assert.match(thrown.why, /ENOTFOUND/);
});

test('agent env carries CI=1 so the local-door-only companion tools refuse in the hosted agent; the brief has no contradictory ship mode', () => {
  assert.equal(buildAgentEnv({ PATH: '/bin' }, { submittedRepoId: 'a/b', executor: {} }).CI, '1');
  const p = buildAgentPrompt({ repoUrl: 'https://github.com/a/b', buildDir: '/tmp/b', budgetMin: 20, budgetUsd: 8 });
  assert.doesNotMatch(p, /Ship mode|SHIP_OPERATORS|hold rather than ship/);
  assert.match(p, /DELIVERY IS NOT CONDITIONAL ON THE SCORE/);
});
