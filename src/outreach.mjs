// src/outreach.mjs — the outreach ledger (ADR-0015).
//
// Every issue/PR the readme-enhance station sends is recorded, so that (a) we can see whether anyone
// responds, (b) a daily cap holds, and (c) we never contact the same repo twice. The owner's rule:
// "make sure you always track these and see if people respond and react to them."
//
// One append-only JSONL file. Entries are never edited; a later `status` record supersedes an earlier
// one for the same URL. Pure helpers + two tiny file functions (read/append) so the CLI and the
// station share ONE definition.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DAILY_CAP = 5;

/** Where the ledger lives: $EMR_OUTREACH_LEDGER, else <cwd>/explainer-builds/outreach.jsonl. */
export function ledgerPath(env = process.env, cwd = process.cwd()) {
  return env.EMR_OUTREACH_LEDGER || path.join(cwd, 'explainer-builds', 'outreach.jsonl');
}

export function readLedger(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line never poisons the rest */ }
  }
  return out;
}

export function appendLedger(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Messages actually sent in the 24h before `now` (skips and status records do not count). */
export function sentInLast24h(entries, now = Date.now()) {
  return entries.filter((e) => e.type === 'sent' && now - Date.parse(e.ts) < 86_400_000).length;
}

/** @returns {{ok:true}|{ok:false, reason:string}} */
export function underDailyCap(entries, cap = DEFAULT_DAILY_CAP, now = Date.now()) {
  const n = sentInLast24h(entries, now);
  return n < cap ? { ok: true } : { ok: false, reason: `daily-cap-reached (${n}/${cap} sent in the last 24h)` };
}

/** Everything we have EVER sent to this repo — the one-contact-per-repo rule reads this. */
export function priorContacts(entries, repoFull) {
  const key = String(repoFull).toLowerCase();
  return entries.filter((e) => e.type === 'sent' && String(e.repo).toLowerCase() === key);
}

/**
 * Classify what a recipient has done, from a snapshot of the item as GitHub reports it.
 * @param {{state:string, mergedAt?:string|null, closedAt?:string|null, comments?:number,
 *          ownerComments?:number, positiveReactions?:number, negativeReactions?:number,
 *          createdAt?:string}} snap
 * @param {number} [now]
 */
export function classifyResponse(snap, now = Date.now()) {
  const state = String(snap.state || '').toUpperCase();
  const days = snap.createdAt ? Math.max(0, Math.floor((now - Date.parse(snap.createdAt)) / 86_400_000)) : null;
  if (snap.mergedAt || state === 'MERGED') return { label: 'merged', positive: true, days };
  if (state === 'CLOSED') {
    const replied = (snap.ownerComments || 0) > 0;
    return { label: replied ? 'closed-after-reply' : 'closed', positive: false, days };
  }
  if ((snap.ownerComments || 0) > 0) return { label: 'replied', positive: true, days };
  if ((snap.positiveReactions || 0) > 0) return { label: 'reacted', positive: true, days };
  if ((snap.negativeReactions || 0) > 0) return { label: 'reacted-negative', positive: false, days };
  if ((snap.comments || 0) > 0) return { label: 'discussed', positive: null, days };
  return { label: 'waiting', positive: null, days };
}

/** Roll the latest classification per URL into totals — what "do people respond?" actually answers. */
export function summarize(rows) {
  const t = { sent: rows.length, merged: 0, replied: 0, reacted: 0, closed: 0, waiting: 0, negative: 0 };
  for (const r of rows) {
    const l = r.label;
    if (l === 'merged') t.merged++;
    else if (l === 'replied' || l === 'discussed') t.replied++;
    else if (l === 'reacted') t.reacted++;
    else if (l === 'closed' || l === 'closed-after-reply') t.closed++;
    else if (l === 'reacted-negative') t.negative++;
    else t.waiting++;
  }
  t.responded = t.merged + t.replied + t.reacted;
  t.responseRate = t.sent ? Math.round((t.responded / t.sent) * 100) : 0;
  return t;
}
