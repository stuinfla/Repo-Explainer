// The brain-lane predicate (issue #16) and callClaude's lane routing, exercised with a stubbed fetch and a
// fake `claude` binary. One predicate decides "can the brain run?"; callClaude must honour ALL of its answer.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveBrainLane, resolveModel, isOpenRouterModel, callClaude, AUTHORING_MODEL, DEFAULT_MODEL,
} from '../src/claude.mjs';

// No real `claude` on PATH: the CLI-availability probe is cached per process, so pin it to "absent" first.
const EMPTY_BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claude-'));
process.env.PATH = EMPTY_BIN;
for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENROUTER_API_KEY', 'EXPLAINMYREPO_BRAIN', 'EXPLAINMYREPO_AUTHORING', 'EXPLAINMYREPO_MODEL', 'ANTHROPIC_MODEL']) delete process.env[k];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; process.env.PATH = EMPTY_BIN; });

test('#16 — an API key alone satisfies the brain lane', () => {
  const r = resolveBrainLane({ apiKey: 'sk-ant-test', env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.useCli, false, 'a key present means no reason to shell out to the CLI');
});

test('#16 — NO api key but a logged-in Claude CLI is a VALID lane (the reported bug)', () => {
  const r = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'claude-cli' } });
  assert.equal(r.ok, true, 'a subscription user with no API key must NOT be refused at preflight');
  assert.equal(r.useCli, true);
});

test('#16 — no key and no CLI is correctly refused (the guard still guards)', () => {
  assert.equal(resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'api' } }).ok, false);
  assert.equal(resolveBrainLane({ apiKey: '', env: {} }).ok, false, 'with no CLI on PATH either');
});

test('#16 — EXPLAINMYREPO_BRAIN=api never silently falls back to the CLI', () => {
  assert.equal(resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'api' } }).useCli, false);
});

test('#16 — EXPLAINMYREPO_BRAIN=claude-cli wins even when a key exists', () => {
  const r = resolveBrainLane({ apiKey: 'sk-ant-test', env: { EXPLAINMYREPO_BRAIN: 'claude-cli' } });
  assert.equal(r.useCli, true);
  assert.equal(r.ok, true);
});

test('#16-redux — an OPENROUTER_API_KEY ALONE is a complete credential set', () => {
  const r = resolveBrainLane({ apiKey: '', env: { OPENROUTER_API_KEY: 'x' } });
  assert.equal(r.ok, true);
  assert.equal(r.useOpenRouter, true);
});

// ── model routing (the routing, not the A/B verdict: EXPLAINMYREPO_AUTHORING=anthropic must always undo it) ──
test('authoring — OpenRouter is the model ONLY when it is the sole credential', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x' }), AUTHORING_MODEL);
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', CLAUDE_API_KEY: 'k' }), DEFAULT_MODEL);
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', ANTHROPIC_API_KEY: 'k' }), DEFAULT_MODEL);
  assert.equal(resolveModel({}), DEFAULT_MODEL);
});

test('authoring — EXPLAINMYREPO_AUTHORING=openrouter opts in even with an Anthropic key; =anthropic pins back', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', CLAUDE_API_KEY: 'k', EXPLAINMYREPO_AUTHORING: 'openrouter' }), AUTHORING_MODEL);
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', EXPLAINMYREPO_AUTHORING: 'anthropic' }), DEFAULT_MODEL);
});

test('authoring — an explicit --model / env override beats everything', () => {
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x' }, DEFAULT_MODEL), DEFAULT_MODEL);
  assert.equal(resolveModel({ OPENROUTER_API_KEY: 'x', EXPLAINMYREPO_MODEL: 'z-ai/glm-5' }), 'z-ai/glm-5');
});

test('authoring — namespaced ids are OpenRouter, first-party ids are not', () => {
  assert.equal(isOpenRouterModel(AUTHORING_MODEL), true);
  assert.equal(isOpenRouterModel(DEFAULT_MODEL), false);
});

// ── callClaude routing (behaviour, not source shape) ─────────────────────────────────────────────
const orOk = (text) => ({ ok: true, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { cost: 0.001, prompt_tokens: 1, completion_tokens: 1 } }) });

test('SOL#6 — an OpenRouter-only user (no Anthropic key, no CLI) is served, not refused after preflight', async () => {
  let url;
  globalThis.fetch = async (u) => { url = String(u); return orOk('from openrouter'); };
  const text = await callClaude({ apiKey: '', model: AUTHORING_MODEL, system: 's', user: 'u', env: { OPENROUTER_API_KEY: 'or-key' } });
  assert.equal(text, 'from openrouter');
  assert.match(url, /openrouter\.ai/);
});

test('SOL#6 — a .env-only OpenRouter key (passed as env, absent from process.env) reaches the call', async () => {
  let auth;
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async (u, init) => { auth = init.headers.Authorization; return orOk('ok'); };
  await callClaude({ apiKey: '', model: AUTHORING_MODEL, system: 's', user: 'u', env: { OPENROUTER_API_KEY: 'only-in-dotenv' } });
  assert.equal(auth, 'Bearer only-in-dotenv');
});

test('no credentials at all → refused with the three ways out, before any request', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  await assert.rejects(() => callClaude({ apiKey: '', model: DEFAULT_MODEL, system: 's', user: 'u', env: {} }),
    (e) => /ANTHROPIC_API_KEY/.test(e.message) && /OPENROUTER_API_KEY/.test(e.message) && /Claude Code/.test(e.message) && !/glm-5\.2/.test(e.message));
});

test('SOL#6 — an explicit EXPLAINMYREPO_BRAIN=claude-cli, given only via the env override, outranks a namespaced model', async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'{"result":"from the cli"}\'\n', { mode: 0o755 });
  process.env.PATH = bin;
  globalThis.fetch = async () => { throw new Error('the CLI lane must not touch the network'); };
  try {
    const text = await callClaude({ apiKey: '', model: AUTHORING_MODEL, system: 's', user: 'u', env: { EXPLAINMYREPO_BRAIN: 'claude-cli', OPENROUTER_API_KEY: 'x' } });
    assert.equal(text, 'from the cli');
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

test('authoring — the fallback to the first-party lane is ANNOUNCED, never silent', async () => {
  const lines = [];
  const realErr = console.error;
  console.error = (m) => lines.push(String(m));
  globalThis.fetch = async (u) => (String(u).includes('openrouter.ai')
    ? { ok: false, status: 402, text: async () => 'no credits' }
    : { ok: true, json: async () => ({ content: [{ type: 'text', text: 'from anthropic' }] }) });
  try {
    const text = await callClaude({ apiKey: 'k', model: AUTHORING_MODEL, system: 's', user: 'u', env: { OPENROUTER_API_KEY: 'x' }, retryDelaysMs: [] });
    assert.equal(text, 'from anthropic');
  } finally { console.error = realErr; }
  assert.ok(lines.some((l) => l.includes(`FALLING BACK to ${DEFAULT_MODEL}`)), `lane switch must be logged, got: ${lines.join(' | ')}`);
});

test('an OpenRouter outage with NO first-party lane keeps the original error (no keyless Anthropic call)', async () => {
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return { ok: false, status: 402, text: async () => 'no credits' }; };
  await assert.rejects(() => callClaude({ apiKey: '', model: AUTHORING_MODEL, system: 's', user: 'u', env: { OPENROUTER_API_KEY: 'x' }, retryDelaysMs: [] }), /OpenRouter 402/);
  assert.ok(urls.every((u) => u.includes('openrouter.ai')), `no Anthropic request may be attempted, got ${urls.join(', ')}`);
});

test('SOL#6 — brainRun EXECUTES the env hand-off (merged env reaches ctx._env)', async () => {
  // Crosses the real boundary: a real build dir, a real call, the merged env observed inside the station.
  const { brainRun } = await import('../src/orchestrator.mjs');
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainrun-'));
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify({ repo: { name: 'fixture' } }));
  let seen;
  try {
    const r = await brainRun(async (ctx) => { seen = ctx._env; })({
      buildDir, env: { OPENROUTER_API_KEY: 'only-in-dotenv' }, apiKey: null, model: 'm',
    });
    assert.equal(r.ok, true);
    assert.equal(seen?.OPENROUTER_API_KEY, 'only-in-dotenv', 'the merged env must arrive in ctx._env');
  } finally { fs.rmSync(buildDir, { recursive: true, force: true }); }
});
