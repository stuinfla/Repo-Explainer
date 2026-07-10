#!/usr/bin/env node
// notify-failure.mjs — tells the SUBMITTER, by email, when their build didn't finish.
//
// Owner mandate (2026-07-10): "if somebody goes to use it and there's no dollars left, don't
// just fail silently — let them know [...] and point them at npx." Before this tool existed, a
// failed build emailed ONLY the owner (alert-owner.mjs); the submitter's sole channel was their
// own status page, which most people stop watching well before a 20-45 minute build finishes.
//
// Distinct from notify.mjs (SUCCESS — full scorecard/links) and alert-owner.mjs (failure, but TO
// THE OWNER with technical particulars). This is the honest, short, human failure message for
// the person who submitted the repo. Zero-dep raw SMTP, same proven pattern as alert-owner.mjs.
//
// Uniform invocation: node tools/notify-failure.mjs --repo <owner/name> --to <email> --message <text>

import tls from 'node:tls';

const TOOL = 'notify-failure';
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
const repo = args.repo || 'your repo';
const to = (args.to || '').trim();
const bodyMessage = args.message || "It didn't complete this time — try again any time.";

if (!to) fail('no recipient — pass --to <email>.');

const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const port = Number(process.env.SMTP_PORT || 465);
const fromName = (process.env.EMAIL_FROM_NAME || 'Stuart Kerr — explainmyrepo').trim();

if (!user || !pass) fail('missing SMTP creds (SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD) — cannot send the failure notice.');

const CRLF = '\r\n';
const date = new Date().toUTCString();
const subject = `Your repo explainer for ${repo} didn't finish`;
const body = [
  `Hi,`,
  ``,
  `We tried to build an explainer page for ${repo} and it didn't come together this time.`,
  ``,
  bodyMessage,
  ``,
  `Sorry for the wait — genuinely didn't want to leave you staring at a stuck page with no explanation.`,
  ``,
  `Stuart`,
  `explainmyrepo.isovision.ai`,
].join(CRLF);

const message = [
  `From: "${fromName}" <${user}>`,
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
  fail(`could not send the failure notice: ${err.message}`);
}

log(`failure notice sent to ${to} for ${repo}.`);
emit({ ok: true, outputs: { to, repo }, error: null });
