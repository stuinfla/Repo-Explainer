// The brain cost ledger: one rate table (MODEL_RATES), derived Anthropic cost, measured OpenRouter cost,
// and an UNKNOWN model is reported UNPRICED, never silently $0.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, getBrainSpend, MODEL_RATES, priceUsd, DEFAULT_MODEL } from '../src/claude.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const anthropic = (usage) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }], usage }) });

test('priceUsd: exact arithmetic from the one table, cache multipliers applied', () => {
  assert.deepEqual(MODEL_RATES['claude-sonnet-5-5'], [2, 10]);
  assert.equal(priceUsd('claude-sonnet-5-5', { in: 1_000_000, out: 1_000_000 }), 12);
  // 1M cache-write at 1.25x input rate + 1M cache-read at 0.1x input rate = 2.5 + 0.2
  assert.ok(Math.abs(priceUsd('claude-sonnet-5-5', { cacheWrite: 1_000_000, cacheRead: 1_000_000 }) - 2.7) < 1e-9);
  assert.equal(priceUsd('no-such-model', { in: 5, out: 5 }), null, 'unknown model → null (UNPRICED), not 0');
  assert.equal('claude-haiku-4.5' in MODEL_RATES, false, 'the malformed dotted haiku id is gone');
});

test('a call is priced from usage and recorded in the ledger', async () => {
  const before = getBrainSpend();
  globalThis.fetch = anthropic({ input_tokens: 1000, output_tokens: 500 });
  await callClaude({ apiKey: 'k', model: DEFAULT_MODEL, system: 's', user: 'u' });
  const after = getBrainSpend();
  assert.ok(Math.abs((after.usd - before.usd) - 0.007) < 1e-6, `1000 in x $2/M + 500 out x $10/M = $0.007, got ${after.usd - before.usd}`);
  assert.equal(after.calls, before.calls + 1);
});

test('an unknown model is listed as UNPRICED in the ledger (never reported as free)', async () => {
  globalThis.fetch = anthropic({ input_tokens: 10, output_tokens: 10 });
  await callClaude({ apiKey: 'k', model: 'claude-mystery-9', system: 's', user: 'u' });
  assert.ok(getBrainSpend().unpriced.includes('claude-mystery-9'));
});
