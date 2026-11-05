// tests/review-p6-publish-guard.test.mjs — publish-repo must never force-push over a repo that is not this
// source's explainer (audit R5 D1) and must redact the token everywhere (D4). `gh` is a stub that answers
// like the real CLI: `gh api repos/x` prints JSON, `--jq .description` would print RAW text (the old bug).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRepo, decideOverwrite, redactToken, writeMarker, explainerRepoNames, resolveTarget, MARKER_FILE } from '../tools/publish-repo.mjs';
import { parseRepoUrl } from '../tools/repo-seo.mjs';

const SOURCE = 'realiti4/claude-swap';
const FULL = 'stuinfla/realiti4-claude-swap-explainer';
const notFound = () => Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

// A fake gh: `repo` is the repository JSON (or null = 404), `marker` the marker file content (or null = 404).
const fakeGh = ({ repo, marker }) => (args) => {
  const url = args[1];
  if (url === `repos/${FULL}`) { if (!repo) throw notFound(); return JSON.stringify(repo); }
  if (url === `repos/${FULL}/contents/${MARKER_FILE}`) { if (!marker) throw notFound(); return JSON.stringify({ content: b64(marker) }); }
  throw new Error(`unexpected gh call: ${args.join(' ')}`);
};

test('inspectRepo: a repo that does not exist is null (so it gets created)', () => {
  assert.equal(inspectRepo(FULL, fakeGh({ repo: null })), null);
});

test('inspectRepo: reads the description from the JSON body — a free-text description cannot break it (old bug)', () => {
  const info = inspectRepo(FULL, fakeGh({ repo: { description: 'Rust: a fast thing — see docs', topics: ['explainer'] }, marker: null }));
  assert.equal(info.description, 'Rust: a fast thing — see docs');
  assert.deepEqual(info.topics, ['explainer']);
  assert.equal(info.marker, null);
});

test('inspectRepo: a non-404 gh failure is loud, never treated as "absent"', () => {
  const boom = () => { throw Object.assign(new Error('x'), { stderr: 'HTTP 500 server error' }); };
  assert.throws(() => inspectRepo(FULL, boom), /gh api repos\/.* failed: HTTP 500/);
});

test('guard: an unrelated repo that happens to have the name is REFUSED (the D1 hole)', () => {
  const info = inspectRepo(FULL, fakeGh({ repo: { description: 'My personal dotfiles', topics: ['dotfiles'] }, marker: null }));
  const v = decideOverwrite(info, SOURCE);
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not look like an explainer repo/);
});

test('guard: a marker naming ANOTHER source is refused even if the topics look like ours', () => {
  const info = inspectRepo(FULL, fakeGh({ repo: { description: 'x', topics: ['explainer'] }, marker: { tool: 'explainmyrepo', source: 'someone/else' } }));
  const v = decideOverwrite(info, SOURCE);
  assert.equal(v.ok, false);
  assert.match(v.reason, /belongs to someone\/else/);
});

test('guard: our marker passes, case-insensitively, and survives repo-seo rewriting description + topics', () => {
  const rewritten = { description: 'A tagline — and a summary that repo-seo wrote', topics: ['whatever'] };
  const info = inspectRepo(FULL, fakeGh({ repo: rewritten, marker: { tool: 'explainmyrepo', source: 'Realiti4/Claude-Swap' } }));
  assert.equal(decideOverwrite(info, SOURCE).ok, true);
});

test('guard: a legacy repo (no marker) is accepted only when it still looks like ours', () => {
  const byDesc = inspectRepo(FULL, fakeGh({ repo: { description: `Explainer site for ${SOURCE}`, topics: [] }, marker: null }));
  const byTopic = inspectRepo(FULL, fakeGh({ repo: { description: 'seo text', topics: ['explainer', 'documentation'] }, marker: null }));
  assert.equal(decideOverwrite(byDesc, SOURCE).ok, true);
  assert.equal(decideOverwrite(byTopic, SOURCE).ok, true);
});

test('redactToken: EVERY occurrence goes, not just the first (D4)', () => {
  const out = redactToken('fatal: https://x-access-token:SECRET@github.com/o/r.git and again SECRET end', 'SECRET');
  assert.equal(out.includes('SECRET'), false);
  assert.equal((out.match(/\*\*\*/g) || []).length, 2);
  assert.equal(redactToken('plain', ''), 'plain');
});

test('round trip: the marker publish-repo WRITES is the one the guard READS back as ours (and only ours)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-marker-'));
  writeMarker(dir, SOURCE);
  const written = JSON.parse(fs.readFileSync(path.join(dir, MARKER_FILE), 'utf8'));
  const info = inspectRepo(FULL, fakeGh({ repo: { description: 'rewritten by repo-seo', topics: [] }, marker: written }));
  assert.equal(decideOverwrite(info, SOURCE).ok, true);
  assert.equal(decideOverwrite(info, 'someone/else').ok, false);
});

test('naming is injective: sources whose sanitized names used to collide get distinct repos', () => {
  const pairs = [[['foo-bar', 'baz'], ['foo', 'bar-baz']], [['a', 'b.c'], ['a', 'b-c']], [['a', 'b_c'], ['a', 'b-c']]];
  for (const [x, y] of pairs) {
    const nx = explainerRepoNames(...x), ny = explainerRepoNames(...y);
    assert.equal(nx.legacy, ny.legacy, 'precondition: the OLD scheme collides');
    assert.notEqual(nx.primary, ny.primary, `${x} vs ${y}`);
  }
});

test('naming: plain-alphanumeric sources keep the exact old name, so published repos are found', () => {
  assert.equal(explainerRepoNames('ruvnet', 'ruvllm').primary, 'ruvnet-ruvllm');
  assert.equal(explainerRepoNames('stuinfla', 'Helix').primary, 'stuinfla-helix');
  assert.equal(explainerRepoNames('ruvnet', 'ruvllm').primary, explainerRepoNames('ruvnet', 'ruvllm').legacy);
});

test('collision pairs are REFUSED: a marker-less repo with only the topic is not claimable under the old ambiguous name', () => {
  const squatted = inspectRepo(FULL, fakeGh({ repo: { description: 'seo text', topics: ['explainer'] }, marker: null }));
  // the legacy candidate of an ambiguous source (injective:false): topic alone refused...
  assert.equal(decideOverwrite(squatted, 'foo/bar-baz', { injective: false }).ok, false);
  assert.equal(decideOverwrite(squatted, 'foo-bar/baz', { injective: false }).ok, false);
  // ...unless the operator opts in
  assert.equal(decideOverwrite(squatted, 'foo/bar-baz', { injective: false, claimLegacy: true }).ok, true);
  // a marker for the OTHER colliding source refuses both directions
  const other = inspectRepo(FULL, fakeGh({ repo: { description: 'x', topics: ['explainer'] }, marker: { source: 'foo-bar/baz' } }));
  assert.equal(decideOverwrite(other, 'foo/bar-baz', { injective: false }).ok, false);
  assert.equal(decideOverwrite(other, 'foo-bar/baz', { injective: false }).ok, true);
  // exact description marker is always enough
  const exact = inspectRepo(FULL, fakeGh({ repo: { description: 'Explainer site for foo/bar-baz', topics: [] }, marker: null }));
  assert.equal(decideOverwrite(exact, 'foo/bar-baz', { injective: false }).ok, true);
  assert.equal(decideOverwrite(exact, 'foo-bar/baz', { injective: false }).ok, false);
});

// ---- resolveTarget: the main() decision loop (hyphenated legacy repos must not silently fork) ----
const target = (source, repos, extra = {}) => {
  const [owner, name] = source.split('/');
  const { primary, legacy } = explainerRepoNames(owner, name);
  return resolveTarget({ explainerOwner: 'stuinfla', source, primary, legacy, inspect: (full) => repos[full] ?? null, ...extra });
};

test('resolveTarget: a topic-only legacy repo for a hyphenated source STOPS loudly, naming PUBLISH_CLAIM_LEGACY=1 (no second repo)', () => {
  const repos = { 'stuinfla/stuinfla-agentic-kit-explainer': { description: 'seo text', topics: ['explainer'], marker: null } };
  assert.throws(() => target('stuinfla/agentic-kit', repos), /PUBLISH_CLAIM_LEGACY=1/);
  assert.throws(() => target('stuinfla/agentic-kit', repos), /stuinfla-agentic-kit-explainer/);
});

test('resolveTarget: with PUBLISH_CLAIM_LEGACY=1 the existing legacy repo is updated in place', () => {
  const repos = { 'stuinfla/stuinfla-agentic-kit-explainer': { description: 'x', topics: ['explainer'], marker: null } };
  const r = target('stuinfla/agentic-kit', repos, { claimLegacy: true });
  assert.deepEqual(r, { full: 'stuinfla/stuinfla-agentic-kit-explainer', exists: true });
});

test('resolveTarget: a legacy repo with a marker for ANOTHER source or an unrelated legacy-named repo falls through to a fresh primary repo', () => {
  const legacyName = 'stuinfla/foo-bar-baz-explainer';
  const other = { [legacyName]: { description: 'x', topics: ['explainer'], marker: { source: 'foo-bar/baz' } } };
  assert.deepEqual(target('foo/bar-baz', other), { full: 'stuinfla/foo--bar-baz-explainer', exists: false });
  const unrelated = { [legacyName]: { description: 'dotfiles', topics: ['dotfiles'], marker: null } };
  assert.deepEqual(target('foo/bar-baz', unrelated), { full: 'stuinfla/foo--bar-baz-explainer', exists: false });
});

test('resolveTarget: our legacy repo with a matching marker is reused; plain names resolve to the single primary', () => {
  const repos = { 'stuinfla/foo-bar-baz-explainer': { description: 'x', topics: [], marker: { source: 'foo/bar-baz' } } };
  assert.deepEqual(target('foo/bar-baz', repos), { full: 'stuinfla/foo-bar-baz-explainer', exists: true });
  assert.deepEqual(target('ruvnet/ruvllm', {}), { full: 'stuinfla/ruvnet-ruvllm-explainer', exists: false });
});

test('resolveTarget: an unrelated repo squatting the PRIMARY name is refused', () => {
  const repos = { 'stuinfla/ruvnet-ruvllm-explainer': { description: 'dotfiles', topics: [], marker: null } };
  assert.throws(() => target('ruvnet/ruvllm', repos), /refusing to publish/);
});

// ---- dotted owner/name end to end (repo-seo must parse what publish-repo names) ----
test('dotted source: the repo URL publish-repo produces parses back to the same owner/repo in repo-seo', () => {
  const { primary } = explainerRepoNames('vercel', 'next.js');
  assert.equal(primary, 'vercel--next.js');
  const url = `https://github.com/stuinfla/${primary}-explainer`;
  assert.deepEqual(parseRepoUrl(url), { owner: 'stuinfla', repo: 'vercel--next.js-explainer' });
  assert.deepEqual(parseRepoUrl('git@github.com:a/b.c.git'), { owner: 'a', repo: 'b.c' });
  assert.deepEqual(parseRepoUrl('https://github.com/a/plain/'), { owner: 'a', repo: 'plain' });
  assert.throws(() => parseRepoUrl('https://example.com/x'), /cannot parse/);
});
