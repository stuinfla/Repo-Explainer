#!/usr/bin/env node
// Phase 9 — Send the "your explainer is ready" notification over Gmail SMTP.
//
// Zero npm dependencies: speaks SMTP directly over an implicit-TLS socket
// (smtp.gmail.com:465) using Node 20+ built-ins only. Authenticates with a
// Google app-specific password via AUTH LOGIN.
//
// Required environment variables:
//   GMAIL_USER          — the authenticated sender, e.g. stuart@isovision.ai
//   GMAIL_APP_PASSWORD  — a 16-character Google app password (spaces tolerated)
//   EMAIL_TO            — recipient address
//   EMAIL_SUBJECT       — message subject line
//   EMAIL_HTML          — message body (HTML)
//
// Exits 0 on a successful hand-off to Gmail, non-zero (with a clear reason) on
// any failure — the pipeline must never fail silently.

import tls from 'node:tls';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;

function fail(message) {
  console.error(`[phase9-email] ${message}`);
  process.exit(1);
}

const user = process.env.GMAIL_USER;
const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const to = process.env.EMAIL_TO;
const subject = process.env.EMAIL_SUBJECT || 'Your Repo Explainer is ready';
const html = process.env.EMAIL_HTML || '<p>Your Repo Explainer is ready.</p>';

if (!user) fail('GMAIL_USER is not set.');
if (!pass) fail('GMAIL_APP_PASSWORD is not set.');
if (!to) fail('EMAIL_TO is not set.');

// Run an ordered SMTP conversation. Each step sends a line, then waits for a
// reply whose three-digit status code must start with `expect`.
function sendMail() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () => reject(new Error('SMTP connection timed out.')));

    const crlf = '\r\n';
    const date = new Date().toUTCString();
    const message = [
      `From: Repo Explainer <${user}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join(crlf);

    // SMTP body dot-stuffing: a line that is just "." would end DATA early.
    const dotStuffed = message.replace(/\r\n\./g, '\r\n..');

    const steps = [
      { expect: '220', send: null }, // server greeting
      { expect: '250', send: `EHLO repo-explainer` },
      { expect: '334', send: 'AUTH LOGIN' },
      { expect: '334', send: Buffer.from(user).toString('base64') },
      { expect: '235', send: Buffer.from(pass).toString('base64') },
      { expect: '250', send: `MAIL FROM:<${user}>` },
      { expect: '250', send: `RCPT TO:<${to}>` },
      { expect: '354', send: 'DATA' },
      { expect: '250', send: `${dotStuffed}${crlf}.` },
      { expect: '221', send: 'QUIT' },
    ];

    let i = 0;
    let buffer = '';

    function pump() {
      // SMTP multi-line replies use "250-" for continuations and "250 " for the
      // final line. Only act once a complete final line has arrived.
      const lines = buffer.split(crlf).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return; // wait for more data
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
      if (next.send !== null) socket.write(next.send + crlf);
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
  console.log(`[phase9-email] Notification sent to ${to}.`);
} catch (err) {
  fail(err.message);
}
