// Brain-call resilience (src/claude.mjs): transient failures (network throw, 429/5xx) are retried with
// backoff, permanent ones (401/400) are not, and an OpenRouter lane that cannot serve us falls back to
// the first-party lane instead of killing the build.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, AUTHORING_MODEL } from '../src/claude.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const okResponse = (text = 'hello') => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text }] }),
});

const baseOpts = { apiKey: 'test-key', system: 's', user: 'u', retryDelaysMs: [1, 1] };

test('retries a transient network failure ("fetch failed") and succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return okResponse('recovered');
  };
  const text = await callClaude(baseOpts);
  assert.equal(text, 'recovered');
  assert.equal(calls, 2, 'expected exactly one retry after the transient failure');
});

test('retries 429/5xx (rate limit / server / overloaded), then succeeds', async () => {
  let calls = 0;
  const statuses = [529, 500];
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= statuses.length) {
      return { ok: false, status: statuses[calls - 1], text: async () => 'overloaded' };
    }
    return okResponse('recovered');
  };
  const text = await callClaude(baseOpts);
  assert.equal(text, 'recovered');
  assert.equal(calls, 3, 'expected retries through both transient HTTP failures');
});

test('does NOT retry a permanent 401 — fails immediately', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 401, text: async () => 'invalid x-api-key' };
  };
  await assert.rejects(() => callClaude(baseOpts), /401/);
  assert.equal(calls, 1, 'a permanent auth error must not be retried');
});

test('gives up after exhausting retries and surfaces the last error', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
  await assert.rejects(() => callClaude(baseOpts), /Anthropic request failed: fetch failed/);
  assert.equal(calls, 3, 'expected initial attempt + 2 retries');
});

// A lane that cannot serve us (no credits 402, bad key 401/403, retired model 404) hands over to the other lane.
const openRouterDown = (status) => async (url) => (String(url).includes('openrouter.ai')
  ? { ok: false, status, text: async () => `{"error":{"message":"status ${status}"}}` }
  : okResponse('from anthropic'));

for (const status of [401, 402, 403, 404]) {
  test(`OpenRouter ${status} falls back to the Anthropic lane instead of killing the build`, async () => {
    let orCalls = 0;
    const down = openRouterDown(status);
    globalThis.fetch = async (url) => { if (String(url).includes('openrouter.ai')) orCalls += 1; return down(url); };
    const text = await callClaude({ ...baseOpts, model: AUTHORING_MODEL, env: { OPENROUTER_API_KEY: 'or-key' } });
    assert.equal(text, 'from anthropic');
    assert.equal(orCalls, 1, 'a lane that cannot serve us must not be retried');
  });
}

test('an OpenRouter 400 is OUR bug, not a lane outage — it must surface, not be papered over', async () => {
  globalThis.fetch = openRouterDown(400);
  await assert.rejects(() => callClaude({ ...baseOpts, model: AUTHORING_MODEL, env: { OPENROUTER_API_KEY: 'or-key' } }), /OpenRouter 400/);
});
