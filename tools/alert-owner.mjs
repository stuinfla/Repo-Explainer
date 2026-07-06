#!/usr/bin/env node
// alert-owner.mjs — the hard failure-escalation valve (Stuart's mandate: "never fail silently").
//
// Distinct from notify.mjs (which emails the SUBMITTER a successful build's scorecard/links).
// This tool fires ONLY when a hosted build did not produce a working page — crash, timeout, or the
// agent explicitly giving up — and emails the OWNER directly with full particulars so a human can
// reach out to the affected person. It has no build.json dependency (a build.json may not even exist
// yet, or may be mid-write, at the moment of failure) — every input comes from CLI args / env.
//
// Uniform invocation:  node tools/alert-owner.mjs --repo <owner/name> [--submitter <email>]
//                        [--build-id <id>] [--run-url <url>] [--reason <text>] [--elapsed-min <n>]
//
// Env (SMTP creds — never from build.json):
//   ALERT_TO (default stuart@isovision.ai) | SMTP_USER|GMAIL_USER | SMTP_PASS|GMAIL_APP_PASSWORD
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
//
// FAIL-LOUD like every other tool (CONTRACT (b)·6): if creds are missing this exits non-zero with a
// clear reason — the workflow treats that as non-blocking (an alert failure must never mask itself
// as build success, but it also can't retroactively invert the failure it's reporting).

import tls from 'node:tls';

const TOOL = 'alert-owner';
function emit(result) { process.stdout.write(JSON.stringify(result) + '\n'); }
function log(msg) { process.stderr.write(`[${TOOL}] ${msg}\n`); }
function fail(message) { log(message); emit({ ok: false, outputs: {}, error: message }); process.exit(1); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] ?? ''; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const repo = args.repo || 'unknown/unknown';
const submitter = args.submitter || '(no email given)';
const buildId = args['build-id'] || '(none)';
const runUrl = args['run-url'] || '(no run URL)';
const reason = args.reason || 'no reason captured';
const elapsedMin = args['elapsed-min'] || '?';

const to = (process.env.ALERT_TO || 'stuart@isovision.ai').trim();
const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const port = Number(process.env.SMTP_PORT || 465);

if (!user || !pass) fail('missing SMTP creds (SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD) — cannot send the failure alert.');

const CRLF = '\r\n';
const date = new Date().toUTCString();
const subject = `[explainmyrepo] build FAILED — ${repo}`;
const body = [
  `A hosted explainmyrepo build did not produce a working page.`,
  ``,
  `repo:          ${repo}`,
  `submitter:     ${submitter}`,
  `build id:      ${buildId}`,
  `elapsed:       ${elapsedMin} min`,
  `run log:       ${runUrl}`,
  `reason:        ${reason}`,
  ``,
  `The submitter was told it didn't complete and to try again later. This alert exists so you can`,
  `reach out directly if it's worth following up.`,
].join(CRLF);

const message = [
  `From: "explainmyrepo alerts" <${user}>`,
  `To: <${to}>`,
  `Subject: ${subject}`,
  `Date: ${date}`,
  `MIME-Version: 1.0`,
  `Content-Type: text/plain; charset=utf-8`,
  ``,
  body,
].join(CRLF);
const dotStuffed = message.replace(/\r\n\./g, '\r\n..');

function sendMail() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(60000, () => { reject(new Error(`SMTP connection to ${host}:${port} timed out.`)); socket.destroy(); });

    const steps = [
      { expect: '220', send: null },
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
      const lines = buffer.split(CRLF).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      buffer = '';
      const step = steps[i];
      const code = last.slice(0, 3);
      if (code !== step.expect) { reject(new Error(`SMTP expected ${step.expect} but got "${last}" (step ${i}).`)); socket.end(); return; }
      i += 1;
      if (i >= steps.length) { resolve(); socket.end(); return; }
      const next = steps[i];
      if (next.send !== null) socket.write(next.send + CRLF);
    }
    socket.on('data', (chunk) => { buffer += chunk; pump(); });
    socket.on('error', reject);
    socket.on('end', () => { if (i < steps.length) reject(new Error('SMTP connection closed before completion.')); });
  });
}

try {
  await sendMail();
} catch (err) {
  fail(`could not send the failure alert: ${err.message}`);
}

log(`failure alert sent to ${to} for ${repo}.`);
emit({ ok: true, outputs: { to, repo, submitter, buildId }, error: null });
