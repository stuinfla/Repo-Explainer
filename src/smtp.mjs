// smtp.mjs — the ONE minimal SMTP-over-implicit-TLS sender (no npm deps). Callers: tools/notify.mjs (delivery email,
// raw MIME), tools/readme-enhance.mjs (owner review copy), tools/notify-failure.mjs, tools/alert-owner.mjs.
// Every address that reaches a header or an SMTP command is validated here, so a CR/LF can never inject one.
import tls from 'node:tls';

const CRLF = '\r\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s) => s.replace(/(.{76})/g, '$1' + CRLF);

// Strict single-mailbox address: no whitespace, no angle brackets, no commas, no CR/LF. Defence in depth —
// the landing form validates too, but this is the last line before a socket write.
const ADDRESS = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export function isSafeAddress(v) { return typeof v === 'string' && v.length <= 254 && ADDRESS.test(v); }
export function assertAddress(label, v) {
  if (!isSafeAddress(v)) throw new Error(`invalid ${label} address (must be a single plain email address)`);
  return v;
}

export function buildMessage({ from, fromName, to, subject, text }) {
  assertAddress('from', from); assertAddress('to', to);
  const safe = (v) => String(v).replace(/[\r\n]+/g, ' ');   // header-injection guard
  return [
    `From: =?UTF-8?B?${b64(safe(fromName || from))}?= <${safe(from)}>`,
    `To: <${safe(to)}>`,
    `Subject: =?UTF-8?B?${b64(safe(subject))}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
  ].join(CRLF);
}

// `connect` is injectable so tests drive the dialogue with a stub socket instead of the network.
export function sendMail({ host = 'smtp.gmail.com', port = 465, user, pass, from, fromName, to, subject, text, raw, connect = tls.connect }) {
  // `raw`: a caller-built MIME message (notify's multipart/attachments). Addresses are validated here either way.
  let message;
  try {
    assertAddress('user', user);
    assertAddress('to', to);
    message = (raw ?? buildMessage({ from: from || user, fromName, to, subject, text })).replace(/\r\n\./g, '\r\n..');
  } catch (e) { return Promise.reject(e); }
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(60000, () => { reject(new Error(`SMTP connection to ${host}:${port} timed out.`)); socket.destroy(); });
    const steps = [
      { expect: '220', send: null },
      { expect: '250', send: 'EHLO explainmyrepo' },
      { expect: '334', send: 'AUTH LOGIN' },
      { expect: '334', send: b64(user) },
      { expect: '235', send: b64(pass) },
      { expect: '250', send: `MAIL FROM:<${user}>` },
      { expect: '250', send: `RCPT TO:<${to}>` },
      { expect: '354', send: 'DATA' },
      { expect: '250', send: `${message}${CRLF}.` },
      { expect: '221', send: 'QUIT' },
    ];
    let i = 0, buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(CRLF).filter(Boolean), last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      buf = '';
      if (last.slice(0, 3) !== steps[i].expect) { reject(new Error(`SMTP expected ${steps[i].expect} but got "${last}" (step ${i})`)); socket.end(); return; }
      if (++i >= steps.length) { resolve(); socket.end(); return; }
      if (steps[i].send !== null) socket.write(steps[i].send + CRLF);
    });
    socket.on('error', reject);
    socket.on('end', () => { if (i < steps.length) reject(new Error('SMTP connection closed before completion.')); });
  });
}
