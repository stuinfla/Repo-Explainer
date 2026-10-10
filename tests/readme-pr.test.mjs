// tests/readme-pr.test.mjs — the PR the station sends: tone, structure, and who it must NOT be sent to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrTitle, buildIssueTitle, buildPrBody, decideSend, readmePrEnabled } from '../src/readme-pr.mjs';

const README_URL = 'https://github.com/stuinfla/claude-swap/blob/docs/add-visual-explainer/README.md';
const LIVE = 'https://claude-swap-explainer.netlify.app';
const BASE = {
  repoName: 'claude-swap', liveUrl: LIVE, readmeUrl: README_URL, mode: 'fallback', addedLines: 24,
  files: ['docs/explainer/architecture.svg', 'docs/explainer/flow.svg'],
  images: {
    architecture: 'https://raw.githubusercontent.com/stuinfla/x/main/readme-pr/architecture.png',
    flow: 'https://raw.githubusercontent.com/stuinfla/x/main/readme-pr/flow.png',
    hero: 'https://raw.githubusercontent.com/stuinfla/x/main/assets/hero.png',
  },
};
const urlsInOrder = (s) => [...s.matchAll(/\]\((https?:\/\/[^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)\]]+)/g)].map((m) => m[1] || m[2]);

test('tone: opens with thanks, not a diff report', () => {
  const body = buildPrBody(BASE);
  assert.match(body, /^## 👋 Thank you for claude-swap/);
  assert.match(body, /thank you for building claude-swap/i);
  assert.match(body, /genuinely good work/);
});

test('lead: the one-click README link is the FIRST link in the body (the owner\'s "burying the lead" note)', () => {
  const body = buildPrBody(BASE);
  assert.equal(urlsInOrder(body)[0], README_URL);
  assert.ok(body.indexOf('See the new README in one click') < body.indexOf(LIVE));
});

test('lead: the README image comes BEFORE the explainer page section', () => {
  const body = buildPrBody(BASE);
  assert.ok(body.indexOf('readme-pr/architecture.png') < body.indexOf('And a page that tells the story'));
});

test('images: embedded when given, and clicking them goes somewhere useful', () => {
  const body = buildPrBody(BASE);
  assert.equal((body.match(/!\[/g) || []).length, 3);
  assert.match(body, /\]\(https:\/\/raw\.githubusercontent\.com\/stuinfla\/x\/main\/assets\/hero\.png\)\]\(https:\/\/claude-swap-explainer\.netlify\.app\)/);
});

test('images: missing images degrade to links, never to broken markup', () => {
  const body = buildPrBody({ ...BASE, images: {} });
  assert.equal((body.match(/!\[/g) || []).length, 0);
  assert.match(body, /Open the proposed README, rendered/);
});

test('honesty: says nothing was removed and states the real number of added lines', () => {
  const body = buildPrBody(BASE);
  assert.match(body, /24 lines added, \*\*0 removed\*\*/);
  assert.match(body, /Nothing you wrote has been changed/);
});

test('honesty: asks for an accuracy check and promises not to re-send', () => {
  const body = buildPrBody(BASE);
  assert.match(body, /accuracy check/);
  assert.match(body, /closing this is completely fine, and I won't send another/);
});

test('privacy: no private session links, and no co-author trailer', () => {
  const body = buildPrBody(BASE);
  assert.doesNotMatch(body, /claude\.ai\/code|session_[0-9A-Za-z]+/);
  assert.doesNotMatch(body, /Co-Authored-By/i);
});

test('voice: the default opening makes no claim about the runner\'s personal experience', () => {
  const body = buildPrBody(BASE);
  assert.doesNotMatch(body, /\bI (really )?found\b|\bI use\b|\bI've been using\b/);
});

test('voice: a runner can supply their own first-person intro and sign-off', () => {
  const body = buildPrBody({ ...BASE, intro: 'I really found {repo} helpful.\n\nIt saved me real time.', signoff: 'Stuart' });
  assert.match(body, /I really found claude-swap helpful\./);
  assert.doesNotMatch(body, /genuinely good work/, 'the default opening is replaced, not appended');
  assert.match(body, /\nStuart\n/);
});

test('mode: ascii mode says the originals are kept; link-only makes no promise about diagrams', () => {
  assert.match(buildPrBody({ ...BASE, mode: 'ascii' }), /ASCII diagrams drawn as clean, animated graphics just above the originals/);
  assert.doesNotMatch(buildPrBody({ ...BASE, mode: 'link-only' }), /two diagrams just after|ASCII diagrams drawn/);
});

test('issue: asks first — says nothing was touched, offers the PR, keeps the README link first', () => {
  const body = buildPrBody({ ...BASE, kind: 'issue' });
  assert.match(body, /^## 👋 Thank you for claude-swap/);
  assert.match(body, /I haven't touched your repo/);
  assert.match(body, /say the word and I'll open a pull request/);
  assert.match(body, /## What I'd change/);
  assert.doesNotMatch(body, /What's in this PR|before merging/);
  assert.equal(urlsInOrder(body)[0], README_URL);
  assert.match(body, /closing this is completely fine, and I won't send another/);
});

test('issue: the default kind is still the PR wording (back-compat)', () => {
  assert.match(buildPrBody(BASE), /What's in this PR/);
});

test('issue title: stable and friendly (the station finds its own earlier issue by it)', () => {
  assert.equal(buildIssueTitle('claude-swap'), 'A visual README for claude-swap? (happy to send a PR)');
});

test('title: friendly and specific', () => {
  assert.equal(buildPrTitle('claude-swap'), 'docs: a visual README to help more people discover claude-swap');
});

// ── who it is sent to ──────────────────────────────────────────────────────────────────────────
const ME = { owner: 'realiti4', ghLogin: 'stuinfla', liveUrl: LIVE };

test('send: a public repo someone else owns, no prior PR', () => {
  assert.deepEqual(decideSend({ ...ME, existing: [] }), { action: 'send' });
});

test('GUARD: never re-send to someone who closed it — "no pressure" is a promise', () => {
  const r = decideSend({ ...ME, existing: [{ state: 'CLOSED', url: 'u', author: 'stuinfla' }] });
  assert.deepEqual(r, { action: 'skip', reason: 'already-responded' });
});

test('GUARD: a merged PR is also a finished conversation', () => {
  assert.equal(decideSend({ ...ME, existing: [{ state: 'MERGED', url: 'u', author: 'stuinfla' }] }).action, 'skip');
});

test('reuse: an open PR of ours is updated, not duplicated', () => {
  assert.deepEqual(decideSend({ ...ME, existing: [{ state: 'OPEN', url: 'https://x/pull/9', author: 'stuinfla' }] }),
    { action: 'reuse', url: 'https://x/pull/9' });
});

test('a stranger\'s PR on the same branch name is not ours and does not block us', () => {
  assert.equal(decideSend({ ...ME, existing: [{ state: 'CLOSED', url: 'u', author: 'someoneelse' }] }).action, 'send');
});

test('GUARD: no PR to your own repo, to a private repo, or without a live page', () => {
  assert.equal(decideSend({ ...ME, owner: 'StuInfla' }).reason, 'own-repo');
  assert.equal(decideSend({ ...ME, isPrivate: true }).reason, 'private-source-repo');
  assert.equal(decideSend({ ...ME, liveUrl: '' }).reason, 'no-live-url');
});

test('opt-out: default ON; only an explicit off value disables it', () => {
  assert.equal(readmePrEnabled({}), true);
  assert.equal(readmePrEnabled({ README_ENHANCE: '' }), true);
  assert.equal(readmePrEnabled({ README_ENHANCE: '1' }), true);
  for (const v of ['0', 'false', 'No', 'OFF']) assert.equal(readmePrEnabled({ README_ENHANCE: v }), false, v);
});
