// tests/brain-lane.test.mjs — issue #16 (ciprianmelian, 2026-08-06).
//
// THE BUG: `npx explainmyrepo <repo> --no-deploy` failed at preflight with
// "ANTHROPIC_API_KEY MISSING" for a user running on a Claude Code SUBSCRIPTION and no API key —
// even though src/claude.mjs has always routed to the logged-in CLI in exactly that case. The brain
// would have worked; the gatekeeper in front of it refused to let anyone try.
//
// THE REAL DEFECT was duplication: the "can the brain run?" decision lived in TWO places
// (callClaude and orchestrator's preflight) and only one of them was ever taught about the CLI lane.
// The fix is a single exported predicate both callers ask. These tests pin the predicate's truth
// table AND pin that the orchestrator still delegates to it — because a correct predicate nobody
// calls is exactly the state this bug was already in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrainLane } from '../src/claude.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('#16 — an API key alone satisfies the brain lane', () => {
  const r = resolveBrainLane({ apiKey: 'sk-ant-test', env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.useCli, false, 'a key present means no reason to shell out to the CLI');
});

test('#16 — NO api key but a logged-in Claude CLI is a VALID lane (the reported bug)', () => {
  // Simulate CLI availability by forcing the explicit mode, which is the same lane the auto-detect
  // reaches. The auto-detect itself shells out to `claude`, which a test must not depend on.
  const r = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'claude-cli' } });
  assert.equal(r.ok, true, 'a subscription user with no API key must NOT be refused at preflight');
  assert.equal(r.useCli, true);
});

test('#16 — no key and no CLI is correctly refused (the guard still guards)', () => {
  const r = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'api' } });
  assert.equal(r.ok, false, 'forcing the api lane with no key must still fail loudly');
});

test('#16 — EXPLAINMYREPO_BRAIN=api never silently falls back to the CLI', () => {
  const r = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'api' } });
  assert.equal(r.useCli, false, 'an explicit lane choice must be honoured, not overridden');
});

test('#16 — EXPLAINMYREPO_BRAIN=claude-cli wins even when a key exists', () => {
  const r = resolveBrainLane({ apiKey: 'sk-ant-test', env: { EXPLAINMYREPO_BRAIN: 'claude-cli' } });
  assert.equal(r.useCli, true, 'an explicit CLI choice must be honoured');
  assert.equal(r.ok, true);
});

// ── SOURCE-SHAPE PIN ─────────────────────────────────────────────────────────────────────────────
// The predicate being right is only half of it. This bug existed because the orchestrator answered
// the question ITSELF. If it ever goes back to doing that, this fails.
test('#16 — the orchestrator DELEGATES the decision instead of re-deriving it', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'orchestrator.mjs'), 'utf8');
  assert.match(src, /resolveBrainLane/, 'preflight must ask the shared predicate');
  const preflight = src.slice(src.indexOf('async function preflight('), src.indexOf('async function preflight(') + 2000);
  assert.doesNotMatch(preflight, /brainIds\.some\([^)]*\) && !has\(\['ANTHROPIC_API_KEY'/,
    'preflight must not re-implement the key-only test that caused #16');
});

test('#16 — the refusal message names BOTH lanes, so a subscription user knows the way out', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'orchestrator.mjs'), 'utf8');
  assert.match(src, /logged-in Claude Code CLI/, 'the error must tell the user the CLI is an option');
  assert.match(src, /no API key at all/, 'and that it needs no key — the thing the reporter had to discover by reading source');
});
