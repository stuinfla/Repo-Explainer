// Conformance test — transient-failure resilience in the brain-call seam (src/claude.mjs).
//
// 2026-07-03 incident: hosted build 28663699020 (lattice) died at step 4/17 with
// "Anthropic request failed: fetch failed" — ONE transient network blip on the runner killed an
// otherwise-perfect 13-minute build. The seam must retry transient failures (network throw,
// HTTP 429/5xx) with backoff, and must NOT retry permanent ones (401/400). FAILS RED until
// callClaude carries a retry loop.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../src/claude.mjs';

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

// 2026-09-17: OpenRouter ran out of credits (HTTP 402) and the very first brain step of a build died
// with it — while a working Anthropic key and a logged-in CLI sat right there. The comment above the
// fallback in callClaude says an OpenRouter outage "must never take the build down", but only RETRYABLE
// errors ever reached it; a 402 is "permanent", so it was rethrown on the spot. A lane that cannot
// serve us (no credits, bad key, retired model) is exactly when the OTHER lane should take over.
const openRouterDown = (status) => async (url) => (String(url).includes('openrouter.ai')
  ? { ok: false, status, text: async () => `{"error":{"message":"status ${status}"}}` }
  : okResponse('from anthropic'));

for (const status of [401, 402, 403, 404]) {
  test(`OpenRouter ${status} falls back to the Anthropic lane instead of killing the build`, async () => {
    let orCalls = 0;
    const down = openRouterDown(status);
    globalThis.fetch = async (url) => { if (String(url).includes('openrouter.ai')) orCalls += 1; return down(url); };
    const text = await callClaude({ ...baseOpts, model: 'z-ai/glm-5.2', env: { OPENROUTER_API_KEY: 'or-key' } });
    assert.equal(text, 'from anthropic');
    assert.equal(orCalls, 1, 'a lane that cannot serve us must not be retried');
  });
}

test('an OpenRouter 400 is OUR bug, not a lane outage — it must surface, not be papered over', async () => {
  globalThis.fetch = openRouterDown(400);
  await assert.rejects(() => callClaude({ ...baseOpts, model: 'z-ai/glm-5.2', env: { OPENROUTER_API_KEY: 'or-key' } }), /OpenRouter 400/);
});
