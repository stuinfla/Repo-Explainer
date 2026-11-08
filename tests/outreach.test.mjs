// tests/outreach.test.mjs — the outreach ledger: cap, one-contact-per-repo, and response tracking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ledgerPath, readLedger, appendLedger, sentInLast24h, underDailyCap, priorContacts, classifyResponse, summarize,
} from '../src/outreach.mjs';
import { followupsDue as fuDue, lastContact, renderFollowup as fuRender } from '../src/outreach-followup.mjs';
import { pickMaintainerEmail as pickMail, renderEmail as mailRender } from '../src/outreach-mail.mjs';
import { followupCommand, snapshotFromGh } from '../src/outreach-cli.mjs';
import { buildPrBody } from '../src/readme-pr.mjs';

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

// ── follow-up, contact line, review mail ──────────────────────────────────────
const DAY = 86_400_000;
const mkSent = (repo, n, daysAgo, now, extra = {}) => ({ type: 'sent', ts: new Date(now - daysAgo * DAY).toISOString(), repo, kind: 'issue', url: `https://github.com/${repo}/issues/${n}`, number: n, liveUrl: 'https://x.netlify.app', ...extra });

test('followupsDue: waits a week from the LAST message, once, issues only', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const rows = [
    mkSent('a/young', 1, 3, now), mkSent('a/old', 2, 8, now), mkSent('a/pr', 3, 9, now, { kind: 'pr' }),
    mkSent('a/updated', 4, 10, now),
    { type: 'update', ts: new Date(now - 2 * DAY).toISOString(), url: 'https://github.com/a/updated/issues/4', repo: 'a/updated' },
    mkSent('a/done', 5, 20, now), { type: 'followup', url: 'https://github.com/a/done/issues/5' },
  ];
  assert.deepEqual(fuDue(rows, now).map((d) => d.repo), ['a/old']);
  assert.equal(lastContact(rows).find((c) => c.repo === 'a/updated').lastTs, now - 2 * DAY);
});

test('followupCommand: posts one note when unanswered, stays quiet when answered, never twice', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-'));
  const file = path.join(dir, 'outreach.jsonl');
  fs.writeFileSync(file, [mkSent('o/quiet', 7, 8, now), mkSent('o/talked', 8, 8, now)].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const posted = [];
  const view = (e) => (e.repo === 'o/talked'
    ? { state: 'OPEN', createdAt: new Date(now - 8 * DAY).toISOString(), comments: [{ author: { login: 'o' } }], reactionGroups: [] }
    : { state: 'OPEN', createdAt: new Date(now - 8 * DAY).toISOString(), comments: [], reactionGroups: [] });
  const env = { EMR_OUTREACH_LEDGER: file, OUTREACH_CONTACT: 'Jo · +1 555 0100 · jo@example.com' };
  const r1 = followupCommand({ env, view, post: (e, b) => posted.push({ url: e.url, b }), now, write: () => {} });
  assert.equal(r1.posted.length, 1);
  assert.equal(r1.quiet.length, 1);
  assert.ok(posted[0].b.includes('jo@example.com') && posted[0].b.includes('only trying to be helpful'));
  const r2 = followupCommand({ env, view, post: (e, b) => posted.push({ url: e.url, b }), now, write: () => {} });
  assert.equal(r2.due, 0);
  assert.equal(posted.length, 1, 'never posts twice');
});

test('copy: contact line appears, and no message vouches for itself', () => {
  const contact = 'Jo · +1 555 0100 · jo@example.com';
  const issue = buildPrBody({ repoName: 'x', liveUrl: 'https://l', readmeUrl: 'https://r', mode: 'link-only', addedLines: 3, files: [], kind: 'issue', signoff: 'Jo', contact });
  const fu = fuRender({ repoName: 'x', liveUrl: 'https://l', contact });
  const mail = mailRender({ name: 'x', to: 'm@e.co', liveUrl: 'https://l', fromName: 'Jo', contact }).body;
  for (const t of [issue, fu, mail]) {
    assert.ok(t.includes('jo@example.com'));
    for (const w of ['safe', 'clean', 'secure', 'trusted', 'virus', 'malware-free', "don't worry", 'no risk']) assert.ok(!t.toLowerCase().includes(w), `banned: ${w}`);
  }
  assert.ok(!buildPrBody({ repoName: 'x', liveUrl: 'https://l', readmeUrl: 'https://r', mode: 'link-only', addedLines: 3, files: [], kind: 'issue' }).includes('Questions are welcome'), 'no contact, no line');
});

test('pickMaintainerEmail skips noreply and bots', () => {
  const c = (e) => ({ commit: { author: { email: e } } });
  assert.equal(pickMail([c('1+x@users.noreply.github.com'), c('dev@x.io'), c('dev@x.io'), c('bot@y.io')]), 'dev@x.io');
  assert.equal(pickMail([c('noreply@github.com')]), null);
});

test('pickMaintainerEmail: EVERY bot pattern is individually load-bearing (the bot is the most frequent author)', () => {
  const c = (e) => ({ commit: { author: { email: e } } });
  const bots = ['noreply@x.io', 'no-reply@x.io', '123+someone@users.noreply.github.com', '49699333+dependabot[bot]@users.noreply.github.com',
    'thing[bot]@x.io', 'bot@y.io', 'dependabot-preview@x.io', 'renovate@x.io', 'github-actions@x.io'];
  for (const bot of bots) {
    const commits = [c(bot), c(bot), c(bot), c('dev@x.io')];
    assert.equal(pickMail(commits), 'dev@x.io', `${bot} outnumbers the human 3:1 yet must be skipped`);
  }
  assert.equal(pickMail([c('not-an-email'), c('')]), null);
});

test('our own update/follow-up comments never count as a reply', () => {
  const j = { state: 'OPEN', createdAt: '2026-10-13T00:00:00Z', comments: [{ author: { login: 'stuinfla' } }, { author: { login: 'StuInfla' } }], reactionGroups: [] };
  const mine = snapshotFromGh(j, 'morluto', 'stuinfla');
  assert.equal(mine.comments, 0);
  assert.equal(classifyResponse(mine, Date.parse('2026-10-14T00:00:00Z')).label, 'waiting');
  const theirs = snapshotFromGh({ ...j, comments: [...j.comments, { author: { login: 'morluto' } }] }, 'morluto', 'stuinfla');
  assert.equal(classifyResponse(theirs).label, 'replied');
});
