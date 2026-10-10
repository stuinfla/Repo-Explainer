// tests/outreach.test.mjs — the outreach ledger: cap, one-contact-per-repo, and response tracking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ledgerPath, readLedger, appendLedger, sentInLast24h, underDailyCap, priorContacts, classifyResponse, summarize,
} from '../src/outreach.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const sent = (repo, h) => ({ type: 'sent', repo, kind: 'issue', url: `https://github.com/${repo}/issues/1`, ts: hoursAgo(h) });

test('ledger: append + read round-trips, and a torn line does not poison the rest', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ol-')), 'sub', 'outreach.jsonl');
  appendLedger(f, { type: 'sent', repo: 'a/b', ts: hoursAgo(1) });
  fs.appendFileSync(f, '{"type":"sent","repo":"c/d"\n');           // torn write
  appendLedger(f, { type: 'sent', repo: 'e/f', ts: hoursAgo(2) });
  assert.deepEqual(readLedger(f).map((e) => e.repo), ['a/b', 'e/f']);
});

test('ledger: a missing file is an empty ledger, not an error', () => {
  assert.deepEqual(readLedger('/nonexistent/outreach.jsonl'), []);
});

test('ledger path: env override wins, default lives under explainer-builds', () => {
  assert.equal(ledgerPath({ EMR_OUTREACH_LEDGER: '/x/y.jsonl' }, '/cwd'), '/x/y.jsonl');
  assert.equal(ledgerPath({}, '/cwd'), '/cwd/explainer-builds/outreach.jsonl');
});

test('cap: counts only SENT items from the last 24h', () => {
  const es = [sent('a/a', 1), sent('b/b', 23), sent('c/c', 25), { type: 'skipped', repo: 'd/d', ts: hoursAgo(1) },
    { type: 'status', url: 'u', ts: hoursAgo(1) }];
  assert.equal(sentInLast24h(es, NOW), 2);
});

test('GUARD: the daily cap actually stops sending (boundary: cap reached = refuse)', () => {
  const es = Array.from({ length: 5 }, (_, i) => sent(`o/r${i}`, i + 1));
  assert.equal(underDailyCap(es, 5, NOW).ok, false);
  assert.match(underDailyCap(es, 5, NOW).reason, /daily-cap-reached \(5\/5/);
  assert.equal(underDailyCap(es.slice(0, 4), 5, NOW).ok, true);
});

test('one contact per repo, ever — case-insensitive', () => {
  const es = [sent('Owner/Repo', 500), sent('other/thing', 1)];
  assert.equal(priorContacts(es, 'owner/repo').length, 1);
  assert.equal(priorContacts(es, 'nobody/none').length, 0);
});

test('classify: merged beats everything', () => {
  assert.equal(classifyResponse({ state: 'MERGED', mergedAt: hoursAgo(1) }, NOW).label, 'merged');
  assert.equal(classifyResponse({ state: 'CLOSED', mergedAt: hoursAgo(1) }, NOW).label, 'merged');
});

test('classify: closed without a word is a "no"; closed after a reply is recorded differently', () => {
  assert.deepEqual(classifyResponse({ state: 'CLOSED' }, NOW), { label: 'closed', positive: false, days: null });
  assert.equal(classifyResponse({ state: 'CLOSED', ownerComments: 1 }, NOW).label, 'closed-after-reply');
});

test('classify: an owner reply is a response; a thumbs-up is a response; silence is waiting', () => {
  assert.equal(classifyResponse({ state: 'OPEN', ownerComments: 1 }, NOW).label, 'replied');
  assert.equal(classifyResponse({ state: 'OPEN', positiveReactions: 2 }, NOW).label, 'reacted');
  const w = classifyResponse({ state: 'OPEN', createdAt: hoursAgo(72) }, NOW);
  assert.equal(w.label, 'waiting');
  assert.equal(w.days, 3);
});

test('classify: a thumbs-down is tracked as a negative signal, not silently dropped', () => {
  const r = classifyResponse({ state: 'OPEN', negativeReactions: 1 }, NOW);
  assert.equal(r.label, 'reacted-negative');
  assert.equal(r.positive, false);
});

test('classify: comments from other people are "discussed" — neither yes nor no', () => {
  const r = classifyResponse({ state: 'OPEN', comments: 2 }, NOW);
  assert.equal(r.label, 'discussed');
  assert.equal(r.positive, null);
});

test('summarize: a response rate that counts only real responses', () => {
  const s = summarize([{ label: 'merged' }, { label: 'replied' }, { label: 'reacted' }, { label: 'waiting' },
    { label: 'closed' }, { label: 'reacted-negative' }, { label: 'waiting' }, { label: 'waiting' }]);
  assert.equal(s.sent, 8);
  assert.equal(s.responded, 3);
  assert.equal(s.responseRate, 38);
  assert.equal(s.waiting, 3);
  assert.equal(s.negative, 1);
});

test('summarize: an empty ledger is 0%, never NaN', () => {
  assert.equal(summarize([]).responseRate, 0);
});
