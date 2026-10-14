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

// ── follow-up, contact line, review mail (owner's rules 2026-10-14) ──────────────────────────────────────
import { followupsDue as fuDue, lastContact, renderFollowup as fuRender } from '../src/outreach-followup.mjs';
import { pickMaintainerEmail as pickMail, renderEmail as mailRender } from '../src/outreach-mail.mjs';
import { followupCommand } from '../src/outreach-cli.mjs';
import { buildPrBody } from '../src/readme-pr.mjs';
import { test as t2 } from 'node:test';
import a2 from 'node:assert/strict';
import fs2 from 'node:fs';
import os2 from 'node:os';
import path2 from 'node:path';

const DAY = 86_400_000;
const mkSent = (repo, n, daysAgo, now, extra = {}) => ({ type: 'sent', ts: new Date(now - daysAgo * DAY).toISOString(), repo, kind: 'issue', url: `https://github.com/${repo}/issues/${n}`, number: n, liveUrl: 'https://x.netlify.app', ...extra });

t2('followupsDue: waits a week from the LAST message, once, issues only', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const rows = [
    mkSent('a/young', 1, 3, now), mkSent('a/old', 2, 8, now), mkSent('a/pr', 3, 9, now, { kind: 'pr' }),
    mkSent('a/updated', 4, 10, now),
    { type: 'update', ts: new Date(now - 2 * DAY).toISOString(), url: 'https://github.com/a/updated/issues/4', repo: 'a/updated' },
    mkSent('a/done', 5, 20, now), { type: 'followup', url: 'https://github.com/a/done/issues/5' },
  ];
  a2.deepEqual(fuDue(rows, now).map((d) => d.repo), ['a/old']);
  a2.equal(lastContact(rows).find((c) => c.repo === 'a/updated').lastTs, now - 2 * DAY);
});

t2('followupCommand: posts one note when unanswered, stays quiet when answered, never twice', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'fu-'));
  const file = path2.join(dir, 'outreach.jsonl');
  fs2.writeFileSync(file, [mkSent('o/quiet', 7, 8, now), mkSent('o/talked', 8, 8, now)].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const posted = [];
  const view = (e) => (e.repo === 'o/talked'
    ? { state: 'OPEN', createdAt: new Date(now - 8 * DAY).toISOString(), comments: [{ author: { login: 'o' } }], reactionGroups: [] }
    : { state: 'OPEN', createdAt: new Date(now - 8 * DAY).toISOString(), comments: [], reactionGroups: [] });
  const env = { EMR_OUTREACH_LEDGER: file, OUTREACH_CONTACT: 'Jo · +1 555 0100 · jo@example.com' };
  const r1 = followupCommand({ env, view, post: (e, b) => posted.push({ url: e.url, b }), now, write: () => {} });
  a2.equal(r1.posted.length, 1);
  a2.equal(r1.quiet.length, 1);
  a2.ok(posted[0].b.includes('jo@example.com') && posted[0].b.includes('only trying to be helpful'));
  const r2 = followupCommand({ env, view, post: (e, b) => posted.push({ url: e.url, b }), now, write: () => {} });
  a2.equal(r2.due, 0);
  a2.equal(posted.length, 1, 'never posts twice');
});

t2('copy: contact line appears, and no message vouches for itself', () => {
  const contact = 'Jo · +1 555 0100 · jo@example.com';
  const issue = buildPrBody({ repoName: 'x', liveUrl: 'https://l', readmeUrl: 'https://r', mode: 'link-only', addedLines: 3, files: [], kind: 'issue', signoff: 'Jo', contact });
  const fu = fuRender({ repoName: 'x', liveUrl: 'https://l', contact });
  const mail = mailRender({ name: 'x', to: 'm@e.co', liveUrl: 'https://l', fromName: 'Jo', contact }).body;
  for (const t of [issue, fu, mail]) {
    a2.ok(t.includes('jo@example.com'));
    for (const w of ['safe', 'clean', 'secure', 'trusted', 'virus', 'malware-free', "don't worry", 'no risk']) a2.ok(!t.toLowerCase().includes(w), `banned: ${w}`);
  }
  a2.ok(!buildPrBody({ repoName: 'x', liveUrl: 'https://l', readmeUrl: 'https://r', mode: 'link-only', addedLines: 3, files: [], kind: 'issue' }).includes('Questions are welcome'), 'no contact, no line');
});

t2('pickMaintainerEmail skips noreply and bots', () => {
  const c = (e) => ({ commit: { author: { email: e } } });
  a2.equal(pickMail([c('1+x@users.noreply.github.com'), c('dev@x.io'), c('dev@x.io'), c('bot@y.io')]), 'dev@x.io');
  a2.equal(pickMail([c('noreply@github.com')]), null);
});

import { rewriteReadme as rw2 } from '../src/readme-ascii.mjs';
t2('rewriteReadme: hero image sits under the explainer link and strips cleanly on a re-run', () => {
  const md = '# Proj\n\nIntro text.\n';
  const a = rw2(md, { liveUrl: 'https://l.app', repoName: 'Proj', svgDir: 'docs/explainer', hero: { rel: 'docs/explainer/overview.jpg', alt: 'How Proj works' } });
  a2.ok(a.markdown.includes('[![How Proj works](docs/explainer/overview.jpg)](https://l.app)'));
  a2.ok(a.markdown.indexOf('overview.jpg') < a.markdown.indexOf('Intro text.'));
  const again = rw2(a.markdown, { liveUrl: 'https://l.app', repoName: 'Proj', svgDir: 'docs/explainer', hero: { rel: 'docs/explainer/overview.jpg', alt: 'How Proj works' } });
  a2.equal((again.markdown.match(/overview\.jpg/g) || []).length, 1, 'one hero, not two');
  const none = rw2(md, { liveUrl: 'https://l.app', repoName: 'Proj', svgDir: 'docs/explainer' });
  a2.ok(!none.markdown.includes('overview.jpg'));
});
