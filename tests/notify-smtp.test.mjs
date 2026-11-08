// The delivery email must not be a header-injection vector: a recipient with CR/LF/U+2028 is rejected
// before any socket opens, on the real send path (src/smtp.mjs via tools/notify.mjs). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMail } from '../src/smtp.mjs';
import { buildNotifyMime } from '../src/notify-mime.mjs';

const NOTIFY = fileURLToPath(new URL('../tools/notify.mjs', import.meta.url));
const PAYLOADS = [
  'victim@example.com\r\nBcc: attacker@evil.test',
  'victim@example.com\nBcc: attacker@evil.test',
  'victim@example.com Bcc: attacker@evil.test',
  'victim@example.com>\r\nRCPT TO:<attacker@evil.test',
  'a@example.com, b@example.com',
];
const neverConnect = () => { throw new Error('a socket was opened'); };

test('sendMail rejects every injection payload in `to`, with and without a prebuilt message, opening no socket', async () => {
  for (const to of PAYLOADS) {
    for (const extra of [{ text: 'hi' }, { raw: 'Subject: x\r\n\r\nhi' }]) {
      await assert.rejects(sendMail({ user: 'me@example.com', pass: 'x', to, subject: 's', connect: neverConnect, ...extra }),
        /invalid to address/, JSON.stringify(to));
    }
  }
});

test('buildNotifyMime rejects the same payloads and encodes a non-ASCII subject and sender name', () => {
  for (const to of PAYLOADS) assert.throws(() => buildNotifyMime({ from: 'me@example.com', to, subject: 's', html: '<p>x</p>' }), /invalid to address/);
  const m = buildNotifyMime({ from: 'me@example.com', fromName: 'Stuart — Kerr', to: 'v@example.com', subject: 'Votre explication — prête\r\nBcc: x@evil.test', html: '<p>é</p>' });
  const head = m.split('\r\n\r\n')[0];
  assert.match(head, /^To: <v@example\.com>$/m);
  assert.doesNotMatch(head, /^Bcc:/m);
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(head), 'headers are pure ASCII (RFC 2047 encoded)');
});

test('buildNotifyMime attaches PNGs as multipart with the file bytes', () => {
  const m = buildNotifyMime({ from: 'me@example.com', to: 'v@example.com', subject: 's', html: '<p>x</p>',
    attachments: [{ path: 'p', name: 'a"b.png' }], readFile: () => Buffer.from('PNGDATA') });
  assert.match(m, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(m, /filename="a_b\.png"/);
  assert.ok(m.includes(Buffer.from('PNGDATA').toString('base64')));
});

test('tools/notify.mjs refuses a CRLF recipient end to end (exit 1, nothing sent)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-smtp-'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { name: 'r' }, publish: { liveUrl: 'https://x.netlify.app' }, quality: { scorecard: [] } }));
  const r = spawnSync(process.execPath, [NOTIFY, dir], { encoding: 'utf8', timeout: 20000, env: {
    ...process.env, EMAIL_TO: 'v@example.com\r\nBcc: a@evil.test', SMTP_USER: 'me@example.com', SMTP_PASS: 'x', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /invalid to address/);
});

test('buildNotifyMime: a CR/LF in an attachment name cannot start a new header or MIME line', () => {
  const m = buildNotifyMime({ from: 'me@example.com', to: 'v@example.com', subject: 's', html: '<p>x</p>',
    attachments: [{ path: 'p', name: 'a.png"\r\nBcc: attacker@evil.test\r\nX-Y: z' }], readFile: () => Buffer.from('PNG') });
  const lines = m.split('\r\n');
  assert.equal(lines.some((l) => /^Bcc:/i.test(l)), false, 'no injected Bcc header');
  assert.equal(lines.some((l) => /^X-Y:/i.test(l)), false);
  assert.ok(lines.some((l) => l.startsWith('Content-Disposition: attachment; filename="a.png_ Bcc: attacker@evil.test X-Y: z"')), 'the name collapses onto ONE line');
});

test('tools/notify.mjs HTML-escapes the scorecard score and device in the email it actually sends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-esc-'));
  const out = path.join(dir, 'smtp-writes.jsonl');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { name: 'r' }, publish: { liveUrl: 'https://x.netlify.app' },
    quality: { scorecard: [{ device: '<b id=dev>', headlineScore: '<img src=x onerror=alert(1)>', passed: true }] },
  }));
  const r = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./helpers/fake-smtp-tls.mjs', import.meta.url)), NOTIFY, dir], { encoding: 'utf8', timeout: 20000, env: {
    ...process.env, FAKE_SMTP_OUT: out, EMAIL_TO: 'v@example.com', SMTP_USER: 'me@example.com', SMTP_PASS: 'x', SMTP_HOST: 'smtp.test', SMTP_PORT: '465' } });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const writes = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const data = writes.find((w) => w.includes('MIME-Version'));
    const b64 = data.split('\r\n\r\n')[1].split('\r\n.')[0].replace(/\s+/g, '');
    const html = Buffer.from(b64, 'base64').toString('utf8');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'score is escaped');
    assert.ok(html.includes('&lt;b id=dev&gt;'), 'device is escaped');
    assert.equal(html.includes('<img src=x'), false);
    assert.equal(html.includes('<b id=dev>'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
