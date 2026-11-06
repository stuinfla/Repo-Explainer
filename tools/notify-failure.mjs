#!/usr/bin/env node
// notify-failure.mjs — emails the SUBMITTER, honestly and briefly, when their build didn't finish
// (why: a silent failure leaves them watching a stuck status page; notify.mjs covers success,
// alert-owner.mjs covers the owner side). Sends through src/smtp.mjs.
//
// Uniform invocation: node tools/notify-failure.mjs --repo <owner/name> --to <email> --message <text>

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sendMail, isSafeAddress } from '../src/smtp.mjs';

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

/** Pure: the subject + plain-text body the submitter receives. */
export function composeFailureMail({ repo, message }) {
  return {
    subject: `Your repo explainer for ${repo} didn't finish`,
    text: [
      'Hi,',
      '',
      `We tried to build an explainer page for ${repo} and it didn't come together this time.`,
      '',
      message,
      '',
      "Sorry for the wait — genuinely didn't want to leave you staring at a stuck page with no explanation.",
      '',
      'Stuart',
      'explainmyrepo.isovision.ai',
    ].join('\r\n'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || 'your repo';
  const to = (args.to || '').trim();
  const bodyMessage = args.message || "It didn't complete this time — try again any time.";

  if (!to) fail('no recipient — pass --to <email>.');
  if (!isSafeAddress(to)) fail('invalid recipient — --to must be one plain email address.');

  const env = process.env;
  const user = (env.SMTP_USER || env.GMAIL_USER || '').trim();
  const pass = (env.SMTP_PASS || env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) fail('missing SMTP creds (SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD) — cannot send the failure notice.');

  const { subject, text } = composeFailureMail({ repo, message: bodyMessage });
  try {
    await sendMail({
      host: (env.SMTP_HOST || 'smtp.gmail.com').trim(), port: Number(env.SMTP_PORT || 465), user, pass,
      fromName: (env.EMAIL_FROM_NAME || 'Stuart Kerr — explainmyrepo').trim(), to, subject, text,
    });
  } catch (err) {
    fail(`could not send the failure notice: ${err.message}`);
  }
  log(`failure notice sent to ${to} for ${repo}.`);
  emit({ ok: true, outputs: { to, repo }, error: null });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main().catch((e) => fail(`unexpected: ${e && e.message}`));
