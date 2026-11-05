// tests/review-p6-smtp-injection.test.mjs — SMTP header/command injection (audit R5 D2).
// Every payload is a CR/LF smuggled into an address. Nothing here touches a real SMTP server: sockets are
// stubs, and the CLI children point at 127.0.0.1:1 (connection refused), so a missing guard shows up as a
// DIFFERENT error ("could not send"), never as a sent mail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { buildMessage, sendMail, isSafeAddress } from '../src/smtp.mjs';
import { composeFailureMail } from '../tools/notify-failure.mjs';
import { composeOwnerAlert } from '../tools/alert-owner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PAYLOADS = [
  'victim@example.com\r\nBcc: attacker@evil.test',
  'victim@example.com>\r\nRCPT TO:<attacker@evil.test',
  'victim@example.com\nBcc: attacker@evil.test',
  'a@b.co,attacker@evil.test',
  'a@b.co attacker@evil.test',
  '<a@b.co>',
  '',
  'no-at-sign',
];

test('isSafeAddress: accepts ordinary addresses, rejects every injection shape', () => {
  for (const ok of ['stuart@isovision.ai', 'jo.smith+tag@mail.example.co.uk', "o'brien@x.io"]) assert.equal(isSafeAddress(ok), true, ok);
  for (const bad of PAYLOADS) assert.equal(isSafeAddress(bad), false, JSON.stringify(bad));
  assert.equal(isSafeAddress('a'.repeat(250) + '@b.co'), false, 'length is bounded');
});

test('buildMessage: a CRLF in `to` or `from` throws instead of being flattened into a header', () => {
  for (const bad of PAYLOADS) {
    assert.throws(() => buildMessage({ from: 'me@x.io', to: bad, subject: 's', text: 't' }), /invalid to address/, JSON.stringify(bad));
    assert.throws(() => buildMessage({ from: bad, to: 'you@x.io', subject: 's', text: 't' }), /invalid from address/, JSON.stringify(bad));
  }
});

test('buildMessage: a hostile subject / display name can never add a header line', () => {
  const m = buildMessage({ from: 'me@x.io', fromName: 'N\r\nBcc: a@b.co', to: 'you@x.io', subject: 'S\r\nBcc: a@b.co', text: 'hi' });
  const headerBlock = m.split('\r\n\r\n')[0];
  assert.equal(headerBlock.split('\r\n').filter((l) => /^Bcc:/i.test(l)).length, 0);
});

function fakeSocket(wire) {
  const s = new EventEmitter();
  s.setEncoding = () => {}; s.setTimeout = () => {}; s.end = () => {};
  s.write = (line) => { wire.push(line); };
  return s;
}

test('sendMail: an injected recipient is rejected BEFORE any socket is opened', async () => {
  for (const bad of PAYLOADS) {
    let connected = 0;
    await assert.rejects(
      sendMail({ user: 'me@x.io', pass: 'p', to: bad, subject: 's', text: 't', connect: () => { connected++; const sock = fakeSocket([]); setImmediate(() => sock.emit('error', new Error('socket was reached'))); return sock; } }),
      /invalid to address/);
    assert.equal(connected, 0, `no connection for ${JSON.stringify(bad)}`);
  }
});

test('sendMail: a clean address drives exactly one RCPT TO with that address', async () => {
  const wire = [];
  const sock = fakeSocket(wire);
  const p = sendMail({ user: 'me@x.io', pass: 'p', to: 'you@x.io', subject: 's', text: 't', connect: () => sock });
  const replies = ['220 hi', '250 ok', '334 u', '334 p', '235 auth', '250 ok', '250 ok', '354 go', '250 queued', '221 bye'];
  for (const r of replies) { await new Promise((res) => setImmediate(res)); sock.emit('data', `${r}\r\n`); }
  await p;
  const rcpts = wire.filter((l) => /^RCPT TO:/.test(l));
  assert.deepEqual(rcpts, ['RCPT TO:<you@x.io>\r\n']);
});

test('composed failure mails survive the wire: non-ASCII text is base64-encoded, not raw 8-bit', () => {
  const { subject, text } = composeFailureMail({ repo: 'a/b', message: 'Budget used — try again' });
  const msg = buildMessage({ from: 'me@x.io', fromName: 'Stuart Kerr — explainmyrepo', to: 'you@x.io', subject, text });
  assert.ok(/^[\x00-\x7f]*$/.test(msg), 'every byte on the wire is 7-bit ASCII');
  const body = Buffer.from(msg.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.ok(body.includes('Budget used — try again'));
  const alert = composeOwnerAlert({ repo: 'a/b', submitter: 's@x.io', buildId: '1', runUrl: 'u', reason: 'r — x', elapsedMin: '5' });
  assert.match(alert.subject, /FAILED — a\/b/);
  assert.match(alert.text, /elapsed:\s+5 min/);
});

function runCli(script, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', script), ...args], {
    encoding: 'utf8', timeout: 20_000,
    env: { PATH: process.env.PATH, SMTP_USER: 'me@x.io', SMTP_PASS: 'p', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', ...env },
  });
  return { status: r.status, out: JSON.parse(r.stdout.trim().split('\n').pop()) };
}

test('notify-failure CLI: a CRLF recipient is refused as invalid, never attempted', () => {
  for (const bad of PAYLOADS.filter(Boolean)) {
    const r = runCli('notify-failure.mjs', ['--repo', 'a/b', '--to', bad]);
    assert.equal(r.status, 1);
    assert.match(r.out.error, /invalid recipient/, JSON.stringify(bad));
  }
  const ok = runCli('notify-failure.mjs', ['--repo', 'a/b', '--to', 'you@x.io']);
  assert.match(ok.out.error, /could not send the failure notice/, 'a clean address gets as far as the (refused) connection');
});

test('alert-owner CLI: a hostile ALERT_TO is refused, a clean one reaches the (refused) connection', () => {
  const bad = runCli('alert-owner.mjs', ['--repo', 'a/b'], { ALERT_TO: 'o@x.io\r\nBcc: z@evil.test' });
  assert.equal(bad.status, 1);
  assert.match(bad.out.error, /invalid to address/);
  const ok = runCli('alert-owner.mjs', ['--repo', 'a/b'], { ALERT_TO: 'o@x.io' });
  assert.match(ok.out.error, /could not send the failure alert: .*(ECONNREFUSED|connect)/);
});

test('landing build.js: a CRLF email is a 400 at the boundary, before any GitHub call', async () => {
  const { handler } = createRequire(import.meta.url)('../landing/netlify/functions/build.js');
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response('{}', { status: 404 }); };
  process.env.EXPLAINER_GH_TOKEN = 'stub';
  try {
    for (const bad of ['a@b.co\r\nBcc: z@evil.test', 'a@b.co,z@evil.test', 'a b@c.co', '<a@b.co>']) {
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ url: 'o/r', email: bad }) });
      assert.equal(res.statusCode, 400, JSON.stringify(bad));
      assert.match(JSON.parse(res.body).error, /email/i);
    }
    assert.equal(fetches, 0, 'rejected before touching the network');
    // blank email stays allowed (it is optional): it proceeds to the repo lookup, which the stub 404s.
    const blank = await handler({ httpMethod: 'POST', body: JSON.stringify({ url: 'o/r', email: '' }) });
    assert.equal(blank.statusCode, 404);
    assert.equal(fetches, 1);
  } finally { globalThis.fetch = realFetch; delete process.env.EXPLAINER_GH_TOKEN; }
});

test('alert-owner and notify-failure: an UNEXPECTED error still yields {ok:false} JSON and exit 1, not a stack trace', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-boom-'));
  const stub = path.join(tmp, 'boom.mjs');
  // make String#replace throw for the sentinel password: that call sits in main(), outside its try/catch
  fs.writeFileSync(stub, `const r = String.prototype.replace;
String.prototype.replace = function (...a) { if (String(this).includes('BOOM_PASS')) throw new Error('injected'); return r.apply(this, a); };\n`);
  for (const [script, args] of [['alert-owner.mjs', ['--repo', 'a/b']], ['notify-failure.mjs', ['--repo', 'a/b', '--to', 'you@x.io']]]) {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, path.join(ROOT, 'tools', script), ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, SMTP_USER: 'me@x.io', SMTP_PASS: 'BOOM_PASS' },
    });
    assert.equal(r.status, 1, script);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(out.ok, false);
    assert.match(out.error, /unexpected: injected/);
  }
});
