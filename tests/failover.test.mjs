// tests/failover.test.mjs — the hosted executor failover lane, driven through the real
// probeCredentials with a stubbed fetch. Failover is for CAPACITY only: a usage-limited primary key
// plus a PROVEN-live OpenRouter completion. A merely-dead key is a config bug the operator must see.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCredentials, credCandidates, shouldFailOver } from '../bin/runner-preflight.mjs';
import { buildAgentEnv } from '../bin/runner-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = { ANTHROPIC_API_KEY: 'sk-primary', NETLIFY_AUTH_TOKEN: 'nl', OPENAI_API_KEY: 'oa', OPENROUTER_API_KEY: 'or-key' };
const res = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

// Routes by URL; `messages` decides the Anthropic spend probe, `orMessages` the OpenRouter one.
function stubFetch({ models = 200, messages = 200, messagesBody = '', orMessages = 200 } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    if (url === 'https://api.anthropic.com/v1/models') return res(models);
    if (url === 'https://api.anthropic.com/v1/messages') return res(messages, messagesBody);
    if (url === 'https://openrouter.ai/api/v1/messages') return res(orMessages, orMessages === 200 ? '' : 'credits exhausted');
    return res(200); // netlify + openai probes
  };
  fn.calls = calls;
  return fn;
}
const USAGE = 'You have reached your specified API usage limits. You will regain access on 2026-12-01.';

test('usage-limited primary + live OpenRouter lane: failover engages, same model, lane key handed to the agent', async () => {
  const fetchFn = stubFetch({ messages: 400, messagesBody: USAGE });
  const { a, executor } = await probeCredentials({ model: 'claude-sonnet-5-5', env: ENV, fetchFn });
  assert.equal(a.ok, true);
  assert.equal(a.usageLimited, true);
  assert.equal(executor.lane, 'openrouter');
  assert.equal(executor.baseUrl, 'https://openrouter.ai/api');
  assert.equal(executor.model, 'anthropic/claude-sonnet-5.5');
  assert.match(a.why, /FAILOVER ENGAGED/);
  const agentEnv = buildAgentEnv(ENV, { submittedRepoId: 'a/b', executor });
  assert.equal(agentEnv.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(agentEnv.ANTHROPIC_API_KEY, 'or-key');
  assert.equal(agentEnv.ANTHROPIC_AUTH_TOKEN, 'or-key');
});

test('a merely-DEAD primary key (HTTP 401) never fails over, even with a live OpenRouter key present', async () => {
  const fetchFn = stubFetch({ models: 401 });
  const { a, executor } = await probeCredentials({ model: 'claude-sonnet-5-5', env: ENV, fetchFn });
  assert.equal(a.ok, false);
  assert.equal(a.usageLimited, undefined);
  assert.equal(executor.lane, 'anthropic');
  assert.ok(!fetchFn.calls.some((c) => c.url.includes('openrouter.ai')), 'OpenRouter must not even be probed');
});

test('a non-usage-limit spend-probe failure (HTTP 500) is a failure, not a failover', async () => {
  const fetchFn = stubFetch({ messages: 500, messagesBody: 'internal error' });
  const { a, executor } = await probeCredentials({ model: 'claude-sonnet-5-5', env: ENV, fetchFn });
  assert.equal(a.ok, false);
  assert.match(a.why, /1-token completion on claude-sonnet-5-5 failed \(HTTP 500\)/);
  assert.equal(executor.lane, 'anthropic');
});

test('usage-limited and the OpenRouter lane is itself refused: the honest refusal stands', async () => {
  const fetchFn = stubFetch({ messages: 400, messagesBody: USAGE, orMessages: 402 });
  const { a, executor } = await probeCredentials({ model: 'claude-sonnet-5-5', env: ENV, fetchFn });
  assert.equal(a.ok, false);
  assert.equal(a.usageLimited, true);
  assert.equal(executor.lane, 'anthropic');
});

test('usage-limited with NO OpenRouter key: refusal stands, and the lane is read from .env text too', async () => {
  const { OPENROUTER_API_KEY, ...noOr } = ENV;
  const refused = await probeCredentials({ model: 'claude-sonnet-5-5', env: noOr, fetchFn: stubFetch({ messages: 400, messagesBody: USAGE }) });
  assert.equal(refused.a.ok, false);
  const viaDotenv = await probeCredentials({ model: 'claude-sonnet-5-5', env: noOr, dotenvText: 'OPENROUTER_API_KEY="or-from-file"\n', fetchFn: stubFetch({ messages: 400, messagesBody: USAGE }) });
  assert.equal(viaDotenv.executor.key, 'or-from-file');
});

test('shouldFailOver is true only for a not-ok, usage-limited probe', () => {
  assert.equal(shouldFailOver({ ok: false, usageLimited: true }), true);
  assert.equal(shouldFailOver({ ok: false }), false);
  assert.equal(shouldFailOver({ ok: true, usageLimited: true }), false);
});

test('credCandidates: process env first, then .env, deduped by value (a dead env key cannot shadow a live .env key)', () => {
  const c = credCandidates(['K'], { env: { K: 'dead' }, dotenvText: 'K=live\n' });
  assert.deepEqual(c.map((x) => x.val), ['dead', 'live']);
  assert.deepEqual(credCandidates(['K'], { env: { K: 'same' }, dotenvText: 'K=same\n' }).length, 1);
});

test('the workflow hands the runner the OpenRouter secret (empty when unset: the lane stays inert)', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-explainer.yml'), 'utf8');
  assert.match(workflow, /OPENROUTER_API_KEY:\s*\$\{\{\s*secrets\.OPENROUTER_API_KEY\s*\}\}/);
});
