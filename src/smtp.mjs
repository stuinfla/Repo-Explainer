// smtp.mjs — minimal SMTP-over-implicit-TLS sender (same dialogue as tools/notify.mjs, no npm deps).
// Used by tools/outreach.mjs to mail the OWNER a review copy of the maintainer email draft.
import tls from 'node:tls';

const CRLF = '\r\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s) => s.replace(/(.{76})/g, '$1' + CRLF);

export function buildMessage({ from, fromName, to, subject, text }) {
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

export function sendMail({ host = 'smtp.gmail.com', port = 465, user, pass, from, fromName, to, subject, text }) {
  const message = buildMessage({ from: from || user, fromName, to, subject, text }).replace(/\r\n\./g, '\r\n..');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
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
