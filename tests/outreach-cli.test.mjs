// tests/outreach-cli.test.mjs — `outreach status` and `outreach open-pr`, against a fake GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotFromGh, statusCommand, openPrCommand } from '../src/outreach-cli.mjs';
import { readLedger } from '../src/outreach.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ocli-'));
const URL1 = 'https://github.com/realiti4/claude-swap/issues/9';
const URL2 = 'https://github.com/sindresorhus/p-map/issues/4';
const sent = (repo, url, extra = {}) => ({ type: 'sent', ts: new Date().toISOString(), repo, kind: 'issue', url, number: 9, ...extra });

test('snapshot: counts only the OWNER\'s comments as the maintainer replying', () => {
  const s = snapshotFromGh({
    state: 'OPEN', createdAt: '2026-10-01T00:00:00Z',
    comments: [{ author: { login: 'someoneElse' } }, { author: { login: 'realiti4' } }],
    reactionGroups: [],
  }, 'realiti4');
  assert.equal(s.comments, 2);
  assert.equal(s.ownerComments, 1);
});

test('snapshot: reactions are split into positive and negative', () => {
  const s = snapshotFromGh({
    state: 'OPEN', comments: [],
    reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 2 } }, { content: 'HEART', users: { totalCount: 1 } },
      { content: 'THUMBS_DOWN', users: { totalCount: 1 } }, { content: 'LAUGH', users: { totalCount: 5 } }],
  }, 'x');
  assert.equal(s.positiveReactions, 3);
  assert.equal(s.negativeReactions, 1);
});

test('snapshot: missing fields do not throw', () => {
  assert.doesNotThrow(() => snapshotFromGh({ state: 'OPEN' }, 'x'));
});

test('status: empty ledger says so plainly', async () => {
  const env = { EMR_OUTREACH_LEDGER: path.join(tmp(), 'l.jsonl') };
  let out = '';
  const r = await statusCommand({ env, write: (s) => { out += s; } });
  assert.match(out, /No outreach sent yet/);
  assert.equal(r.rows.length, 0);
});

test('status: reports each message, the response rate, and flags replies for a human decision', async () => {
  const f = path.join(tmp(), 'l.jsonl');
  fs.writeFileSync(f, [sent('realiti4/claude-swap', URL1), sent('sindresorhus/p-map', URL2)].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const fake = {
    [URL1]: { state: 'OPEN', createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), comments: [{ author: { login: 'realiti4' } }], reactionGroups: [] },
    [URL2]: { state: 'OPEN', createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(), comments: [], reactionGroups: [] },
  };
  let out = '';
  const r = await statusCommand({ env: { EMR_OUTREACH_LEDGER: f }, view: (e) => fake[e.url], write: (s) => { out += s; } });
  assert.equal(r.totals.sent, 2);
  assert.equal(r.totals.responded, 1);
  assert.equal(r.totals.responseRate, 50);
  assert.match(out, /replied/);
  assert.match(out, /waiting/);
  assert.match(out, /outreach open-pr realiti4\/claude-swap/);
  assert.doesNotMatch(out, /outreach open-pr sindresorhus\/p-map/, 'silence is never a yes');
});

test('status: records what it saw in the ledger, and an unreachable item is reported, not fatal', async () => {
  const f = path.join(tmp(), 'l.jsonl');
  fs.writeFileSync(f, JSON.stringify(sent('a/b', URL1)) + '\n');
  let out = '';
  await statusCommand({ env: { EMR_OUTREACH_LEDGER: f }, view: () => { throw new Error('HTTP 404: Not Found'); }, write: (s) => { out += s; } });
  assert.match(out, /unreachable/);
  const f2 = path.join(tmp(), 'l2.jsonl');
  fs.writeFileSync(f2, JSON.stringify(sent('a/b', URL1)) + '\n');
  await statusCommand({ env: { EMR_OUTREACH_LEDGER: f2 }, view: () => ({ state: 'CLOSED', comments: [], reactionGroups: [] }), write: () => {} });
  assert.equal(readLedger(f2).filter((e) => e.type === 'status')[0].label, 'closed');
});

test('open-pr: refuses when there is no issue on record', () => {
  const env = { EMR_OUTREACH_LEDGER: path.join(tmp(), 'l.jsonl') };
  let out = '';
  assert.equal(openPrCommand('a/b', { env, repoRoot: '/x', write: (s) => { out += s; } }), 1);
  assert.match(out, /No issue on record/);
});

test('open-pr: refuses a second PR', () => {
  const f = path.join(tmp(), 'l.jsonl');
  fs.writeFileSync(f, [sent('a/b', URL1), { ...sent('a/b', 'https://github.com/a/b/pull/2'), kind: 'pr' }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  let out = '';
  assert.equal(openPrCommand('a/b', { env: { EMR_OUTREACH_LEDGER: f }, repoRoot: '/x', write: (s) => { out += s; } }), 1);
  assert.match(out, /already sent/);
});

test('open-pr: a vanished build directory is a clear message, not a crash', () => {
  const f = path.join(tmp(), 'l.jsonl');
  fs.writeFileSync(f, JSON.stringify(sent('a/b', URL1, { buildDir: '/nonexistent/build' })) + '\n');
  let out = '';
  assert.equal(openPrCommand('a/b', { env: { EMR_OUTREACH_LEDGER: f }, repoRoot: '/x', write: (s) => { out += s; } }), 1);
  assert.match(out, /build directory .* is gone/);
});
