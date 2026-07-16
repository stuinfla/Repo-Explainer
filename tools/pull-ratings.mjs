#!/usr/bin/env node
// pull-ratings.mjs — the closing arc of the feedback loop (owner ask 2026-07-15: "capture their
// 1-100 and comments in a closed loop you use to get smarter").
//
// Reads submitter ratings from the build-rating Netlify form (/rate.html) and stores each one
// into the local learning store's `feedback` namespace via the GLOBAL ruflo binary — the same
// namespace the ADR-174 distiller judges as oracle:test-exec (execution-observed ground truth),
// so HUMAN verdicts mint promoted patterns exactly like measured gate outcomes do.
//
// Idempotent by construction: the AgentDB key is rating-<netlify-submission-id> and the store
// enforces (namespace,key) uniqueness — a re-run skips everything already ingested.
//
// Usage: node tools/pull-ratings.mjs        (run after ships / at session start; safe anytime)
// Env:   NETLIFY_AUTH_TOKEN (or repo .env)  — local-machine tool; NOT part of the CI runner.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function envOrDotenv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=("?)(.*?)\\1\\s*$`, 'm'));
    return m?.[2] || null;
  } catch { return null; }
}
// Verify-driven resolution (stored lesson, 2026-07-14 — and immediately violated by this tool's
// first version, which grabbed a dead shell token over the live .env one): probe every candidate
// source and use the first token that actually WORKS, never the first that merely exists.
const SITE_ID = 'df4e3cd8-a71e-4668-8da7-c8d168edd341'; // the landing site (explainmyrepo.isovision.ai)
function dotenvVal(name) {
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=("?)(.*?)\\1\\s*$`, 'm'));
    return m?.[2] || null;
  } catch { return null; }
}
const candidates = [process.env.NETLIFY_AUTH_TOKEN, dotenvVal('NETLIFY_AUTH_TOKEN')].filter(Boolean);
if (!candidates.length) { console.error('pull-ratings: no NETLIFY_AUTH_TOKEN in env or .env'); process.exit(1); }
let token = null, forms = null;
for (const cand of candidates) {
  const r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/forms`, { headers: { Authorization: `Bearer ${cand}` } });
  if (r.ok) { token = cand; forms = await r.json(); break; }
  console.error(`pull-ratings: candidate token rejected (HTTP ${r.status}) — trying next source`);
}
if (!token) { console.error('pull-ratings: every token candidate is dead'); process.exit(1); }
const form = Array.isArray(forms) ? forms.find((f) => f.name === 'build-rating') : null;
if (!form) { console.log(JSON.stringify({ ok: true, outputs: { ingested: 0, note: 'build-rating form not registered yet' } })); process.exit(0); }

const rows = await (await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } })).json();
let ingested = 0, skipped = 0, failed = 0;
for (const s of rows) {
  const rec = {
    kind: 'human-rating',
    repo: s.data?.repo || null,
    buildId: s.data?.build_id || null,
    score: s.data?.score != null ? Number(s.data.score) : null,
    thoughts: (s.data?.thoughts || '').slice(0, 2000) || null,
    email: s.data?.email || null,
    at: s.created_at,
  };
  if (rec.score == null) { skipped++; continue; }
  const r = spawnSync('ruflo', ['memory', 'store', '-k', `rating-${s.id}`, '--value', JSON.stringify(rec), '--namespace', 'feedback'],
    { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) ingested++;
  else if (/UNIQUE constraint/.test(out)) skipped++; // already ingested on a prior run
  else { failed++; console.error(`store failed for ${s.id}: ${out.trim().slice(0, 200)}`); }
}
console.log(JSON.stringify({ ok: failed === 0, outputs: { total: rows.length, ingested, skippedOrDup: skipped, failed } }));
process.exit(failed === 0 ? 0 : 1);
