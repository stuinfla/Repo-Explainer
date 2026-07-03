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
