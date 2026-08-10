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

// ── THE AUTHORING CHAMPION (2026-08-08) ──────────────────────────────────────────────────────────
// A blind A/B on the real concept-authoring task scored z-ai/glm-5.2 at 95 vs claude-sonnet-5 at 89
// on art-direction merit, at 1/15th the cost. These tests pin the ROUTING, not the verdict — the
// verdict is evidence that can change, and EXPLAINMYREPO_AUTHORING=anthropic must always undo it.
import { resolveModel, isOpenRouterModel, AUTHORING_MODEL, DEFAULT_MODEL } from '../src/claude.mjs';

test('authoring — an OpenRouter key selects the measured champion', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x' }), AUTHORING_MODEL);
  assert.equal(AUTHORING_MODEL, 'z-ai/glm-5.2');
});

test('authoring — NO OpenRouter key leaves the old behaviour exactly as it was', () => {
  assert.equal(resolveModel({}), DEFAULT_MODEL, 'existing users must see no change at all');
});

test('authoring — EXPLAINMYREPO_AUTHORING=anthropic pins back without removing the key', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', EXPLAINMYREPO_AUTHORING: 'anthropic' }), DEFAULT_MODEL);
});

test('authoring — an explicit --model / env override still beats everything', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x' }, 'claude-opus-5'), 'claude-opus-5');
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', EXPLAINMYREPO_MODEL: 'z-ai/glm-5' }), 'z-ai/glm-5');
});

test('authoring — lane detection distinguishes namespaced OpenRouter ids from first-party ones', () => {
  assert.equal(isOpenRouterModel('z-ai/glm-5.2'), true);
  assert.equal(isOpenRouterModel('claude-sonnet-5'), false);
});

test('#16-redux — an OPENROUTER_API_KEY ALONE is a complete credential set', () => {
  // The default authoring model is now an OpenRouter one, so demanding an Anthropic key here would
  // re-create #16 in a new costume: refusing the very key we now tell people to bring.
  const r = resolveBrainLane({ apiKey: '', env: { OPENROUTER_API_KEY: 'x' } });
  assert.equal(r.ok, true, 'the newly-recommended key must not be refused at the door');
  assert.equal(r.useOpenRouter, true);
});

test('authoring — the fallback to Anthropic is ANNOUNCED, never silent', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'claude.mjs'), 'utf8');
  assert.match(src, /FALLING BACK to/, 'a lane switch must be visible in the log');
  assert.match(src, /FALLBACK, not a silent swap/, 'and the reasoning recorded for whoever reads it next');
});

// ── GPT-5.6-SOL REVIEW, 2026-08-10 — issue #16's shape, found twice more ─────────────────────────
// The second independent reviewer found that callClaude destructured only `useCli` and ignored
// `useOpenRouter`, so an OpenRouter-only user passed preflight and was rejected on the FIRST brain
// call. It hid on this machine because the claude CLI is installed (useCli true); a CI box with just
// OPENROUTER_API_KEY would have died. Third time this defect shape has appeared: a caller holding a
// stale copy of a decision the shared predicate had already been taught.
test('SOL#6 — callClaude asks the predicate for ALL of its answer, not just useCli', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'claude.mjs'), 'utf8');
  assert.match(src, /const \{ useCli, useOpenRouter \} = resolveBrainLane/,
    'both lanes must be read, or an OpenRouter-only user is refused after passing preflight');
  assert.match(src, /!apiKey && !useCli && !useOpenRouter/,
    'the refusal must require ALL three lanes to be absent');
});

test('SOL#6 — a .env-only OpenRouter key survives to execution', () => {
  // src/env.mjs loadEnv() "Returns a NEW object (does not mutate process.env)". The key therefore
  // reached preflight through the merged object and vanished at the call site, which read
  // process.env directly. Preflight saying yes and execution saying no is the worst failure shape.
  const src = fs.readFileSync(path.join(REPO, 'src', 'claude.mjs'), 'utf8');
  assert.match(src, /envOverride && envOverride\.OPENROUTER_API_KEY/,
    'an explicit env override must be honoured before the ambient process.env');
  const orch = fs.readFileSync(path.join(REPO, 'src', 'orchestrator.mjs'), 'utf8');
  assert.match(orch, /ctx\._env = env/, 'the orchestrator must hand the merged env to the brain');
  const brain = fs.readFileSync(path.join(REPO, 'src', 'brain.mjs'), 'utf8');
  assert.match(brain, /env: ctx\?\._env/, 'and every brain call site must pass it through');
});

test('SOL#6 — an explicit CLI lane choice outranks a namespaced model id', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'claude.mjs'), 'utf8');
  assert.match(src, /brainMode === 'claude-cli'/,
    'EXPLAINMYREPO_BRAIN=claude-cli must not be silently ignored because the model contains a slash');
});

test('SOL — the deploy boundary refuses to overwrite ANOTHER OWNER\'s live page', () => {
  // clone-repo sets `slug: name`, discarding the owner, so upstream/foo and attacker/foo both target
  // foo-explainer. The 90f16dc guard compares against a prior LOCAL build.json — and hosted builds
  // use a fresh timestamped dir every run, so it never fires on the path customers actually use.
  const src = fs.readFileSync(path.join(REPO, 'tools', 'deploy.mjs'), 'utf8');
  assert.match(src, /CROSS-OWNER COLLISION/, 'the collision must be detected and named');
  assert.match(src, /llms\.txt/, 'ownership is read from the LIVE site, which works on both doors');
  assert.match(src, /Refusing to overwrite another owner's live page/,
    'and it must refuse rather than silently replace');
});
