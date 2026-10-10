// src/outreach-cli.mjs — `npx explainmyrepo outreach [status | open-pr <owner/name>]` (ADR-0015).
//
//   status   poll GitHub for every message we've sent and say who responded — the owner's "make sure
//            you always track these and see if people respond and react to them".
//   open-pr  the second step of issue-first: after a maintainer says yes, send the PR that was offered.
//            Deliberately a HUMAN step: reading "sure, go ahead" is a judgement, so we flag the reply
//            and the owner decides. (A wrong auto-PR on a "no, thanks" is exactly the harm to avoid.)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ledgerPath, readLedger, appendLedger, classifyResponse, summarize } from './outreach.mjs';

const POSITIVE = new Set(['THUMBS_UP', 'HEART', 'HOORAY', 'ROCKET', 'EYES']);
const NEGATIVE = new Set(['THUMBS_DOWN', 'CONFUSED']);

/**
 * Map `gh issue|pr view --json state,createdAt,closedAt,mergedAt,comments,reactionGroups` to the shape
 * classifyResponse() reads. `ownerLogin` is the repo owner, whose replies count as "the maintainer".
 */
export function snapshotFromGh(j, ownerLogin) {
  const owner = String(ownerLogin || '').toLowerCase();
  const comments = Array.isArray(j.comments) ? j.comments : [];
  const rg = Array.isArray(j.reactionGroups) ? j.reactionGroups : [];
  const count = (set) => rg.filter((g) => set.has(g.content)).reduce((n, g) => n + ((g.users && g.users.totalCount) || 0), 0);
  return {
    state: j.state, mergedAt: j.mergedAt || null, closedAt: j.closedAt || null, createdAt: j.createdAt,
    comments: comments.length,
    ownerComments: comments.filter((c) => c.author && String(c.author.login).toLowerCase() === owner).length,
    positiveReactions: count(POSITIVE), negativeReactions: count(NEGATIVE),
  };
}

function ghView(entry) {
  const sub = entry.kind === 'pr' ? 'pr' : 'issue';
  const fields = entry.kind === 'pr'
    ? 'state,createdAt,closedAt,mergedAt,comments,reactionGroups'
    : 'state,createdAt,closedAt,comments,reactionGroups';
  const out = execFileSync('gh', [sub, 'view', entry.url, '--json', fields], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

export async function statusCommand({ env = process.env, view = ghView, write = (s) => process.stdout.write(s) } = {}) {
  const file = ledgerPath(env);
  const sent = readLedger(file).filter((e) => e.type === 'sent');
  if (!sent.length) { write(`No outreach sent yet (ledger: ${file}).\n`); return { rows: [], totals: summarize([]) }; }
  const rows = [];
  for (const e of sent) {
    let label = 'unknown', days = null;
    try {
      const snap = snapshotFromGh(view(e), String(e.repo).split('/')[0]);
      const c = classifyResponse(snap);
      label = c.label; days = c.days;
      appendLedger(file, { type: 'status', ts: new Date().toISOString(), url: e.url, label, days });
    } catch (err) { label = `unreachable (${String(err.message).split('\n')[0].slice(0, 40)})`; }
    rows.push({ repo: e.repo, kind: e.kind, url: e.url, label, days });
  }
  write(`\n${pad('REPO', 34)}${pad('KIND', 7)}${pad('STATUS', 20)}${pad('DAYS', 6)}URL\n`);
  for (const r of rows) write(`${pad(r.repo, 34)}${pad(r.kind, 7)}${pad(r.label, 20)}${pad(r.days == null ? '-' : r.days, 6)}${r.url}\n`);
  const t = summarize(rows);
  write(`\nSent ${t.sent} · responded ${t.responded} (${t.responseRate}%) — merged ${t.merged}, replied ${t.replied}, reacted ${t.reacted}, `
    + `closed ${t.closed}, thumbs-down ${t.negative}, waiting ${t.waiting}\n`);
  const needs = rows.filter((r) => r.label === 'replied' || r.label === 'reacted');
  for (const r of needs) write(`  → ${r.repo} responded. If it's a yes: npx explainmyrepo outreach open-pr ${r.repo}\n`);
  return { rows, totals: t };
}

export function openPrCommand(repoFull, { env = process.env, repoRoot, write = (s) => process.stdout.write(s) } = {}) {
  const file = ledgerPath(env);
  const entries = readLedger(file).filter((e) => e.type === 'sent' && String(e.repo).toLowerCase() === String(repoFull).toLowerCase());
  const issue = entries.filter((e) => e.kind === 'issue').pop();
  if (!issue) { write(`No issue on record for ${repoFull}. Nothing to follow up.\n`); return 1; }
  if (entries.some((e) => e.kind === 'pr')) { write(`A PR for ${repoFull} was already sent: ${entries.find((e) => e.kind === 'pr').url}\n`); return 1; }
  if (!issue.buildDir || !fs.existsSync(path.join(issue.buildDir, 'build.json'))) {
    write(`The build directory for ${repoFull} is gone (${issue.buildDir}). Re-run the explainer for it first.\n`);
    return 1;
  }
  const tool = path.join(repoRoot, 'tools', 'readme-enhance.mjs');
  const r = spawnSync(process.execPath, [tool, issue.buildDir], {
    stdio: 'inherit',
    env: { ...env, README_OUTREACH: 'pr', README_ENHANCE_ISSUE: String(issue.number || '') },
  });
  return r.status || 0;
}
