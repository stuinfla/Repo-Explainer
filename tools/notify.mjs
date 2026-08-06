#!/usr/bin/env node
// notify.mjs — Station 9, tool #14 of tools/CONTRACT.md (the terminal step).
//
// JOB (one mechanical thing): email the owner the SCORECARD + BOTH SCREENSHOTS + ALL LINKS (live URL,
// explainer repo + collaborator-invite status, knowledge pack, and any optional README PR /
// source-repo SEO suggestions); also return the same summary inline. Pure SMTP over implicit TLS,
// zero npm dependencies — it absorbs the old `scripts/phase9-send-email.mjs` and adds multipart MIME
// so the two screenshots ride along as attachments.
//
// FAIL-LOUD: a genuine failure (no creds, no recipient, nothing meaningful to notify, SMTP refused)
// exits NON-ZERO with a clear reason (per CONTRACT (b)·6) — it never writes a placeholder/partial
// notify slot. Per ADR-0005 Station 9 / INV-04 the BRAIN treats that non-zero as a NON-BLOCKING
// WARNING: "a notify failure degrades to a warning — it never inverts a live, graded, deployed
// build." Notify failure never inverts a good build; it only ever fails to announce it.
//
// Uniform invocation:  node tools/notify.mjs <build-dir>
//
// Reads (declared inputs only — CONTRACT roster row 14):
//   build.json: publish { liveUrl, http200, explainerRepoUrl, ownerInvited, repoTopics,
//                         repoDescription, sourceRepoSeoSuggested },
//               quality { scorecard[], passed } (+ the two screenshot paths recorded in that slot),
//               pack.zipPath,
//               readmePr { prUrl, svgsShared[] }
//   env (SMTP creds + recipient — never from build.json):
//     EMAIL_TO | NOTIFY_TO | OWNER_EMAIL          recipient (required)
//     SMTP_USER | GMAIL_USER                      authenticated sender (required)
//     SMTP_PASS | GMAIL_APP_PASSWORD              app password (required)
//     SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465, implicit TLS), EMAIL_FROM_NAME
// Writes (its own slot only):
//   build.json: notify { emailSent, smtp250, inlineReturned }

import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

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

// Minimal HTML escaping for values interpolated into the email body.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Wrap a base64 string to 76-char lines (RFC 2045).
function b64wrap(buf) {
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
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

// Screenshot paths come ONLY from the quality slot (never guessed from a sibling tool's files).
// Liberal field detection; each declared path MUST exist on disk or it is a loud stop.
function collectScreenshots(q) {
  const raw = [];
  const push = (p) => { if (typeof p === 'string' && p.trim()) raw.push(p.trim()); };
  if (Array.isArray(q.screenshots)) q.screenshots.forEach(push);
  if (q.screenshot && typeof q.screenshot === 'object') Object.values(q.screenshot).forEach(push);
  for (const entry of Array.isArray(q.scorecard) ? q.scorecard : []) {
    push(entry?.screenshot);
    push(entry?.screenshotPath);
    if (entry?.screenshots) {
      const list = Array.isArray(entry.screenshots) ? entry.screenshots : Object.values(entry.screenshots);
      list.forEach(push);
    }
  }
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
// The closed loop (owner ask 2026-07-15: "capture their 1-100 and comments so you get smarter"):
// every success email carries a one-click grade link; ratings land in the build-rating Netlify
// form, show next to OUR grades on /admin, and feed the learning store as human ground truth.
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

// ── ADR-0011 D2 — THE HONEST NOTE ────────────────────────────────────────────────────────────────
// A below-bar page now SHIPS (the gate advises, it never destroys), so this email has to say plainly
// where it landed. Rules of tone, in order: lead with the fact that it is live and theirs; name the
// weakest thing in WORDS a requester understands (never "B5"); state that the rest graded well when
// it did; offer the re-run. No apology, no disclaimer, no hedging — a craftsperson's note. The
// requester is better placed than a vision model to judge whether it is good enough for their purpose.
const w = publish.weakest || null;
// "the rest scored well" MUST be conditional. Written unconditionally on 2026-08-06 and caught the
// same day in adversarial review: a half-broken render (mean 45, several axes in the 40s) would ship
// with an email naming ONE axis and asserting everything else was fine. This is the sole disclosure
// channel — a template that lies precisely when the page is worst is worse than no note at all.
// So: derive the real shape of the scorecard and describe THAT.
const allAxes = scorecard.flatMap((d) => [...Object.values(d.gateA || {}), ...Object.values(d.gateB || {})])
  .filter((n) => typeof n === 'number');
const weakAxisCount = allAxes.filter((n) => n < 70).length;
const overallMean = allAxes.length ? allAxes.reduce((a, b) => a + b, 0) / allAxes.length : null;
const restLine = weakAxisCount > 1
  ? `${weakAxisCount} areas came in under our bar${typeof overallMean === 'number' ? `, and the page averaged ${Math.round(overallMean)} out of 100` : ''} — this one needs another pass more than most`
  : (typeof overallMean === 'number' && overallMean >= 82)
    ? 'the rest of the page scored well'
    : 'the rest of the page is solid but not our best work';
const belowBarNote = publish.belowBar ? `
<div style="border-left:3px solid #d9822b;background:#fdf6ee;padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0">
  <p style="margin:0 0 8px;font-weight:600;color:#8a5620">Honest note — this one came through below the level we love.</p>
  <p style="margin:0;color:#5c4630">It's live and it's yours, and everything in it is real. The part that let it down was
  <b>${esc(w?.label || 'one area of the page')}</b>${typeof w?.score === 'number' ? ` — graded ${esc(w.score)} out of 100${w.device ? ` on ${esc(w.device)}` : ''}` : ''}; ${esc(restLine)}.
  Have a look, and if that matters for how you plan to use it, just reply to this email and I'll rebuild it with a different approach. No charge.</p>
</div>` : '';

const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5;max-width:640px">
<div style="border-bottom:2px solid #0e111b;padding:0 0 12px;margin:0 0 20px">
  <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em">explainmyrepo</span>
  <span style="font-size:12px;color:#888;margin-left:8px">by ISOVision &middot; complex repos deserve clear introductions</span>
</div>
<h2 style="margin:0 0 8px">Your repo explainer is ready ${overallPassed ? '✅' : '⚠️'}</h2>
<p style="margin:0 0 16px;color:#555">${overallPassed ? 'It passed our dual quality gate on both mobile and desktop — an independent vision critic graded the real rendered page before we let it ship.' : 'See the scorecard below for any line flagged honestly under the bar — we show you the real grades, never a rubber stamp.'}</p>
${belowBarNote}
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

// ── Build the MIME message (multipart/mixed when there are attachments) ───────────────────────────
const CRLF = '\r\n';
const date = new Date().toUTCString();
const headerLines = [
  `From: ${fromName} <${user}>`,
  `To: ${to}`,
  `Subject: ${subject}`,
  `Date: ${date}`,
  'MIME-Version: 1.0',
];

let message;
if (attachments.length === 0) {
  message = [
    ...headerLines,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(Buffer.from(html, 'utf8')),
  ].join(CRLF);
} else {
  const boundary = `=_rx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(Buffer.from(html, 'utf8')),
  ];
  for (const att of attachments) {
    const data = fs.readFileSync(att.path);
    parts.push(
      `--${boundary}`,
      `Content-Type: image/png; name="${att.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.name}"`,
      '',
      b64wrap(data),
    );
  }
  parts.push(`--${boundary}--`);
  message = [
    ...headerLines,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
  ].join(CRLF);
}

// SMTP body dot-stuffing: a line that is just "." would terminate DATA early.
const dotStuffed = message.replace(/\r\n\./g, '\r\n..');

// ── Ordered SMTP conversation over implicit TLS (absorbed from phase9-send-email.mjs) ─────────────
function sendMail() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(60000, () => {
      reject(new Error(`SMTP connection to ${host}:${port} timed out.`));
      socket.destroy();
    });

    const steps = [
      { expect: '220', send: null }, // server greeting
      { expect: '250', send: 'EHLO explainmyrepo' },
      { expect: '334', send: 'AUTH LOGIN' },
      { expect: '334', send: Buffer.from(user).toString('base64') },
      { expect: '235', send: Buffer.from(pass).toString('base64') },
      { expect: '250', send: `MAIL FROM:<${user}>` },
      { expect: '250', send: `RCPT TO:<${to}>` },
      { expect: '354', send: 'DATA' },
      { expect: '250', send: `${dotStuffed}${CRLF}.` },
      { expect: '221', send: 'QUIT' },
    ];

    let i = 0;
    let buffer = '';

    function pump() {
      // Multi-line replies use "250-" for continuations and "250 " for the final line.
      const lines = buffer.split(CRLF).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return; // wait for the final line
      buffer = '';

      const step = steps[i];
      const code = last.slice(0, 3);
      if (code !== step.expect) {
        reject(new Error(`SMTP expected ${step.expect} but got "${last}" (step ${i}).`));
        socket.end();
        return;
      }

      i += 1;
      if (i >= steps.length) {
        resolve();
        socket.end();
        return;
      }
      const next = steps[i];
      if (next.send !== null) socket.write(next.send + CRLF);
    }

    socket.on('data', (chunk) => {
      buffer += chunk;
      pump();
    });
    socket.on('error', reject);
    socket.on('end', () => {
      if (i < steps.length) reject(new Error('SMTP connection closed before completion.'));
    });
  });
}

try {
  await sendMail();
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
