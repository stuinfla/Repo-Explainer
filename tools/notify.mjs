#!/usr/bin/env node
// notify.mjs — Station 9: email the owner the scorecard, both screenshots and all links; also return the
// same summary inline. Pure SMTP over implicit TLS, zero npm dependencies.
//
// FAIL-LOUD: no creds, no recipient, nothing to notify, or SMTP refused exits NON-ZERO with a reason and
// never writes a partial notify slot. The brain treats that as a NON-BLOCKING warning (INV-04): a notify
// failure never inverts a live, graded, deployed build.
//
// Usage: node tools/notify.mjs <build-dir>
// Reads:  publish { liveUrl, http200, explainerRepoUrl, ownerInvited, sourceRepoSeoSuggested, belowBar,
//                   graderUnavailable, gateRefusal, weakest }, quality { scorecard[], passed },
//         pack.zipPath, readmePr { prUrl }
// env:    EMAIL_TO | NOTIFY_TO | OWNER_EMAIL (recipient), SMTP_USER | GMAIL_USER, SMTP_PASS | GMAIL_APP_PASSWORD,
//         SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465, implicit TLS), EMAIL_FROM_NAME
// Writes: build.json notify { emailSent, smtp250, inlineReturned }

import fs from 'node:fs';
import path from 'node:path';
import { sendMail } from '../src/smtp.mjs';
import { buildNotifyMime } from '../src/notify-mime.mjs';
import { esc, disclosureNotes } from '../src/disclosure.mjs';

const TOOL = 'notify';

// stdout carries ONLY the single JSON result object; all diagnostics go to stderr.
function emit(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}
function log(msg) {
  process.stderr.write(`[${TOOL}] ${msg}\n`);
}
function fail(message) {
  log(message);
  emit({ ok: false, outputs: {}, error: message });
  process.exit(1);
}

function resolveIn(buildDir, p) {
  return path.isAbsolute(p) ? p : path.resolve(buildDir, p);
}

const buildDir = process.argv[2];
if (!buildDir) fail('usage: node tools/notify.mjs <build-dir>');

const buildJsonPath = path.join(buildDir, 'build.json');
let ctx;
try {
  ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
} catch (err) {
  fail(`cannot read ${buildJsonPath}: ${err.message}`);
}

// ── Credentials + recipient (env only) ────────────────────────────────────────────────────────────
const to = (process.env.EMAIL_TO || process.env.NOTIFY_TO || process.env.OWNER_EMAIL || '').trim();
const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const port = Number(process.env.SMTP_PORT || 465);
const fromName = (process.env.EMAIL_FROM_NAME || 'Stuart Kerr — explainmyrepo').trim();

if (!to) fail('no recipient — set EMAIL_TO (or NOTIFY_TO / OWNER_EMAIL).');
if (!user) fail('no SMTP user — set SMTP_USER (or GMAIL_USER).');
if (!pass) fail('no SMTP password — set SMTP_PASS (or GMAIL_APP_PASSWORD).');
if (!Number.isInteger(port) || port <= 0) fail(`invalid SMTP_PORT: ${process.env.SMTP_PORT}`);

// ── Declared slice: publish + quality (+ pack, readmePr) ──────────────────────────────────────────
const publish = ctx.publish || {};
const quality = ctx.quality || {};
const scorecard = Array.isArray(quality.scorecard) ? quality.scorecard : [];
if (!publish.liveUrl && scorecard.length === 0) {
  fail('nothing meaningful to notify — neither publish.liveUrl nor a quality.scorecard is present.');
}

// Screenshot paths come ONLY from the quality slot: each scorecard entry's `screenshot`. A declared path
// that is missing on disk is a loud stop.
function collectScreenshots(q) {
  const raw = (Array.isArray(q.scorecard) ? q.scorecard : [])
    .map((e) => e?.screenshot)
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim());
  return [...new Set(raw)];
}

const declaredShots = collectScreenshots(quality);
const attachments = [];
for (const rel of declaredShots) {
  const abs = resolveIn(buildDir, rel);
  if (!fs.existsSync(abs)) {
    fail(`declared screenshot not found on disk: ${abs} (quality slot referenced it).`);
  }
  attachments.push({ path: abs, name: path.basename(abs) });
}
if (attachments.length === 0) {
  log('no screenshot paths recorded in the quality slot — sending links + scorecard only.');
}

// ── Compose the email body ────────────────────────────────────────────────────────────────────────
const overallPassed = quality.passed === true;
const scoreRows = scorecard.map((e) => {
  const device = esc(e.device || 'unknown');
  const score = e.headlineScore ?? '—';
  const passed = e.passed === true ? '✅' : '❌';
  return `<tr><td style="padding:4px 12px 4px 0">${device}</td>`
    + `<td style="padding:4px 12px 4px 0;text-align:right"><b>${esc(score)}</b></td>`
    + `<td style="padding:4px 0">${passed}</td></tr>`;
}).join('');

const links = [];
if (publish.liveUrl) {
  links.push(`<li><b>Live explainer:</b> <a href="${esc(publish.liveUrl)}">${esc(publish.liveUrl)}</a>`
    + `${publish.http200 === true ? ' (200 ✓)' : ''}</li>`);
}
if (publish.explainerRepoUrl) {
  links.push(`<li><b>Explainer repo:</b> <a href="${esc(publish.explainerRepoUrl)}">${esc(publish.explainerRepoUrl)}</a>`
    + `${publish.ownerInvited === true ? ' — you were invited as a collaborator ✓' : ' — collaborator invite not confirmed'}</li>`);
}
if (ctx.pack?.zipPath) {
  links.push(`<li><b>AI knowledge pack:</b> ${esc(path.basename(ctx.pack.zipPath))} (ships with the explainer site)</li>`);
}
const prUrl = ctx.readmePr?.prUrl;
if (prUrl && prUrl !== 'declined') {
  links.push(`<li><b>README pull request (optional):</b> <a href="${esc(prUrl)}">${esc(prUrl)}</a></li>`);
}
// Every success email carries a one-click grade link: ratings land in the build-rating form and the learning store.
{
  const repoSlug = `${ctx.repo?.owner || ''}/${ctx.repo?.name || ''}`.replace(/^\/$/, '');
  const rateUrl = `https://explainmyrepo.isovision.ai/rate.html?repo=${encodeURIComponent(repoSlug)}&build=${encodeURIComponent(process.env.BUILD_ID || ctx.buildId || '')}`;
  links.push(`<li><b>Grade this page (30 seconds):</b> <a href="${esc(rateUrl)}">${esc(rateUrl)}</a> — your 1–100 + a sentence directly shapes how the next pages get made.</li>`);
}

const seo = publish.sourceRepoSeoSuggested;
let seoBlock = '';
if (seo && (seo.topics?.length || seo.description)) {
  const topics = Array.isArray(seo.topics) ? seo.topics.map(esc).join(', ') : '';
  seoBlock = `<h3 style="margin:20px 0 6px">Suggested SEO for your source repo (optional)</h3>`
    + `${topics ? `<p style="margin:4px 0"><b>Topics:</b> ${topics}</p>` : ''}`
    + `${seo.description ? `<p style="margin:4px 0"><b>Description:</b> ${esc(seo.description)}</p>` : ''}`;
}

const { ungradedNote, belowBarNote } = disclosureNotes(publish, scorecard);

const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5;max-width:640px">
<div style="border-bottom:2px solid #0e111b;padding:0 0 12px;margin:0 0 20px">
  <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em">explainmyrepo</span>
  <span style="font-size:12px;color:#888;margin-left:8px">by ISOVision &middot; complex repos deserve clear introductions</span>
</div>
<h2 style="margin:0 0 8px">Your repo explainer is ready ${overallPassed ? '✅' : '⚠️'}</h2>
<p style="margin:0 0 16px;color:#555">${overallPassed ? 'It passed our dual quality gate on both mobile and desktop — an independent vision critic graded the real rendered page before we let it ship.' : 'See the scorecard below for any line flagged honestly under the bar — we show you the real grades, never a rubber stamp.'}</p>
${ungradedNote}${belowBarNote}
${scoreRows ? `<h3 style="margin:16px 0 6px">Scorecard</h3>
<table style="border-collapse:collapse;font-size:14px"><thead><tr>
<th style="text-align:left;padding:4px 12px 4px 0">Device</th>
<th style="text-align:right;padding:4px 12px 4px 0">Headline (MIN)</th>
<th style="text-align:left;padding:4px 0">Pass</th></tr></thead>
<tbody>${scoreRows}</tbody></table>` : ''}
${links.length ? `<h3 style="margin:20px 0 6px">Links</h3><ul style="margin:4px 0;padding-left:20px">${links.join('')}</ul>` : ''}
${seoBlock}
${attachments.length ? `<p style="margin:16px 0 0;color:#555">Mobile + desktop screenshots are attached.</p>` : ''}
<p style="margin:20px 0 0;color:#555">If this was worth your time, <a href="https://github.com/stuinfla/Repo-Explainer">a star on GitHub</a> genuinely helps other people find it. Something off? <a href="https://github.com/stuinfla/Repo-Explainer/issues">Tell me</a> and I'll fix it.</p>
<p style="margin:20px 0 0;color:#333">This page was researched, written, illustrated, and quality-graded by an agentic pipeline I built — and I read every piece of feedback personally. If you're building something and want a hand telling its story, just reply to this email.</p>
<p style="margin:16px 0 0;color:#333">Here to help you build great things,<br><b>Stuart Kerr</b> &middot; <a href="https://isovision.ai" style="color:#555">ISOVision</a></p>
<p style="margin:24px 0 0;color:#999;font-size:12px">Sent by the explainmyrepo pipeline &middot; <a href="https://explainmyrepo.isovision.ai" style="color:#999">explainmyrepo.isovision.ai</a></p>
</body></html>`;

const subject = `Your repo explainer is ready${ctx.repo?.name ? ` — ${ctx.repo.name}` : ''}`;

// ── Build the MIME message (src/notify-mime.mjs validates every address) and send via src/smtp.mjs ──
let message;
try {
  message = buildNotifyMime({ from: user, fromName, to, subject, html, attachments, readFile: (p) => fs.readFileSync(p) });
  await sendMail({ host, port, user, pass, from: user, fromName, to, subject, raw: message });
} catch (err) {
  fail(err.message);
}

// ── Merge ONLY the notify slot back; leave every other slot untouched ─────────────────────────────
ctx.notify = { emailSent: true, smtp250: true, inlineReturned: true };
fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n');

log(`notification sent to ${to} (${attachments.length} screenshot attachment(s)).`);
emit({
  ok: true,
  outputs: {
    notify: ctx.notify,
    to,
    subject,
    attachments: attachments.map((a) => a.name),
    links: {
      liveUrl: publish.liveUrl || null,
      explainerRepoUrl: publish.explainerRepoUrl || null,
      ownerInvited: publish.ownerInvited === true,
      readmePr: prUrl && prUrl !== 'declined' ? prUrl : null,
    },
  },
  error: null,
});
process.exit(0);
