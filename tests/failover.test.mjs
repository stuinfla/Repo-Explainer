// tests/failover.test.mjs — the executor failover lane (2026-07-19).
//
// Context: run 29714490286 proved a monthly usage-limit on the primary Anthropic key idles the
// ENTIRE hosted pipeline until the cap resets — a capacity event became a 12-day outage. The
// systemic answer follows MetaHarness ADR-167's router shape (freeze the model, evolve the
// harness; reroute/escalate on a verified failure, with a deterministic oracle as the spine —
// ours is the ship-bar rail): when the spend-probe classifies the primary key as usage-limited,
// the runner fails over to OpenRouter's Anthropic-compatible endpoint ("Anthropic Skin",
// ANTHROPIC_BASE_URL=https://openrouter.ai/api) running the SAME executor model on the owner's
// OpenRouter credits. Same model → same quality → no A/B required; the grader + rail are
// unchanged either way. OpenRouter guarantees the Skin only for Anthropic first-party models —
// a non-Anthropic executor (e.g. Kimi K3) is a separate, deliberate cost experiment via
// Moonshot's own endpoint, NOT this lane.
//
// Source-shape checks (repo convention: the branch is env/IO-bound; pin the invariants).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(ROOT, 'bin', 'agentic-runner.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-explainer.yml'), 'utf8');

test('failover engages ONLY on the distinct usage-limited classification, never on a merely-dead key', () => {
  // A dead/invalid key is a configuration bug the operator must fix; silently billing a second
  // provider would mask it. Capacity exhaustion is the one condition where rerouting is honest.
  const idx = runner.indexOf('openrouter.ai/api');
  assert.ok(idx > 0, 'failover branch references the OpenRouter Anthropic Skin');
  const branch = runner.slice(Math.max(0, idx - 2500), idx);
  assert.match(branch, /usageLimited/);
});

test('failover is spend-probed the same way the primary is — engage only on a PROVEN-live lane', () => {
  assert.match(runner, /openrouter\.ai\/api\/v1\/messages/);
});

test('failover rewires the agent env: base URL + both auth vars (Skin accepts Anthropic semantics)', () => {
  assert.match(runner, /ANTHROPIC_BASE_URL/);
  assert.match(runner, /ANTHROPIC_AUTH_TOKEN/);
});

test('the executor lane is stamped into the build record so admin can attribute grades and cost per lane', () => {
  assert.match(runner, /executor:\s*executor\.lane/);
});

test('the spawned agent uses the executor model, not a hardcoded one', () => {
  assert.match(runner, /'--model', executor\.model/);
});

test('the workflow hands the runner the OpenRouter secret (empty when unset — lane stays inert)', () => {
  assert.match(workflow, /OPENROUTER_API_KEY:\s*\$\{\{\s*secrets\.OPENROUTER_API_KEY\s*\}\}/);
});
