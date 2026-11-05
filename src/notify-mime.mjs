// notify-mime.mjs — the delivery email's MIME (HTML body + PNG attachments). Pure; transport is src/smtp.mjs.
// Every address is validated and every header value is encoded, so no input can inject a header.
import { assertAddress } from './smtp.mjs';

const CRLF = '\r\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1' + CRLF);
const oneLine = (v) => String(v).replace(/[\r\n\u2028\u2029]+/g, ' ');

export function buildNotifyMime({ from, fromName, to, subject, html, attachments = [], readFile } ) {
  assertAddress('from', from); assertAddress('to', to);
  const read = readFile || (() => { throw new Error('readFile required for attachments'); });
  const headers = [
    `From: =?UTF-8?B?${b64(oneLine(fromName || from))}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(oneLine(subject))}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  const htmlPart = ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html, 'utf8'))];
  if (!attachments.length) return [...headers, ...htmlPart].join(CRLF);
  const boundary = `=_rx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const parts = [`--${boundary}`, ...htmlPart];
  for (const att of attachments) {
    const name = oneLine(att.name).replace(/["\\]/g, '_');
    parts.push(`--${boundary}`, `Content-Type: image/png; name="${name}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`, '', wrap(read(att.path)));
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join(CRLF);
}
