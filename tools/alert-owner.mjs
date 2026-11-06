#!/usr/bin/env node
// alert-owner.mjs — "never fail silently": emails the OWNER full particulars when a hosted build did not
// produce a working page (crash, timeout, or the agent giving up). Distinct from notify.mjs (success to the
// submitter) and notify-failure.mjs (failure to the submitter). Needs no build.json: every input is a CLI arg
// or env, because build.json may not exist yet at the moment of failure. Sends through src/smtp.mjs.
//
// Uniform invocation:  node tools/alert-owner.mjs --repo <owner/name> [--submitter <email>]
//                        [--build-id <id>] [--run-url <url>] [--reason <text>] [--elapsed-min <n>]
// Env: ALERT_TO (default stuart@isovision.ai) | SMTP_USER|GMAIL_USER | SMTP_PASS|GMAIL_APP_PASSWORD
//      SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
//
// FAIL-LOUD: missing creds exit non-zero with a clear reason; the workflow treats that as non-blocking.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sendMail } from '../src/smtp.mjs';

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

/** Pure: the subject + plain-text body the owner receives. */
export function composeOwnerAlert({ repo, submitter, buildId, runUrl, reason, elapsedMin }) {
  return {
    subject: `[explainmyrepo] build FAILED — ${repo}`,
    text: [
      'A hosted explainmyrepo build did not produce a working page.',
      '',
      `repo:          ${repo}`,
      `submitter:     ${submitter}`,
      `build id:      ${buildId}`,
      `elapsed:       ${elapsedMin} min`,
      `run log:       ${runUrl}`,
      `reason:        ${reason}`,
      '',
      'The submitter is emailed separately by notify-failure when an address was given. This alert exists so you can',
      "reach out directly if it's worth following up.",
    ].join('\r\n'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || 'unknown/unknown';
  const env = process.env;
  const to = (env.ALERT_TO || 'stuart@isovision.ai').trim();
  const user = (env.SMTP_USER || env.GMAIL_USER || '').trim();
  const pass = (env.SMTP_PASS || env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) fail('missing SMTP creds (SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD) — cannot send the failure alert.');

  const submitter = args.submitter || '(no email given)';
  const buildId = args['build-id'] || '(none)';
  const { subject, text } = composeOwnerAlert({
    repo, submitter, buildId, runUrl: args['run-url'] || '(no run URL)',
    reason: args.reason || 'no reason captured', elapsedMin: args['elapsed-min'] || '?',
  });
  try {
    await sendMail({
      host: (env.SMTP_HOST || 'smtp.gmail.com').trim(), port: Number(env.SMTP_PORT || 465), user, pass,
      fromName: 'explainmyrepo alerts', to, subject, text,
    });
  } catch (err) {
    fail(`could not send the failure alert: ${err.message}`);
  }
  log(`failure alert sent to ${to} for ${repo}.`);
  emit({ ok: true, outputs: { to, repo, submitter, buildId }, error: null });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main().catch((e) => fail(`unexpected: ${e && e.message}`));
