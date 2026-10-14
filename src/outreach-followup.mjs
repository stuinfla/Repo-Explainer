// src/outreach-followup.mjs — one gentle check-in per issue (pure helpers; the CLI does the I/O).
//
// Owner's rule (2026-10-14): post the work, track it, and if nobody has answered after a week send ONE short
// note saying we are only trying to help and how to reach us. Never more than one. Silent if they replied
// or closed the issue. Reads the same ledger the readme-enhance station writes (src/outreach.mjs).

export const DEFAULT_FOLLOWUP_DAYS = 7;

/** Latest thing WE said on each issue: the original 'sent' record or a later 'update' comment. */
export function lastContact(entries) {
  const m = new Map();
  for (const e of entries) {
    if ((e.type !== 'sent' && e.type !== 'update') || !e.url) continue;
    const prev = m.get(e.url);
    const ts = Date.parse(e.ts);
    if (!prev) m.set(e.url, { url: e.url, repo: e.repo, kind: e.kind, number: e.number, liveUrl: e.liveUrl, lastTs: ts });
    else {
      if (e.type === 'sent') Object.assign(prev, { repo: e.repo || prev.repo, kind: e.kind || prev.kind, number: e.number || prev.number, liveUrl: e.liveUrl || prev.liveUrl });
      if (ts > prev.lastTs) prev.lastTs = ts;
    }
  }
  return [...m.values()];
}

/** Issues (never PRs) we spoke on at least `minDays` ago, with no follow-up yet and not withdrawn. */
export function followupsDue(entries, now = Date.now(), minDays = DEFAULT_FOLLOWUP_DAYS) {
  const done = new Set(entries.filter((e) => e.type === 'followup' && e.url).map((e) => e.url));
  const out = [];
  for (const c of lastContact(entries)) {
    if (c.kind && c.kind !== 'issue') continue;
    if (!c.number || done.has(c.url)) continue;
    const ageDays = (now - c.lastTs) / 86_400_000;
    if (ageDays >= minDays) out.push({ ...c, ageDays: Math.floor(ageDays) });
  }
  return out;
}

/** The note itself. Plain facts and a way to reach a person; no claims about ourselves. */
export function renderFollowup({ repoName, liveUrl, contact }) {
  return [
    `Hi again. I'm only trying to be helpful with the ${repoName} explainer${liveUrl ? ` (${liveUrl})` : ''}. Did you get a chance to see it, and was it any use?`,
    '',
    'A one-word answer is plenty, and no answer is fine too. I will not post again.',
    ...(contact && String(contact).trim() ? ['', `Questions are welcome: ${String(contact).trim()}`] : []),
  ].join('\n');
}
