// Preloaded (node --import) into a tool process: replaces tls.connect with a scripted SMTP server that accepts
// everything and appends every client write to $FAKE_SMTP_OUT (one JSON string per line). No network, no certs.
import tls from 'node:tls';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

const REPLIES = ['250', '334', '334', '235', '250', '250', '354', '250', '221'];
tls.connect = () => {
  const s = new EventEmitter();
  let n = 0;
  s.setEncoding = () => {};
  s.setTimeout = () => {};
  s.destroy = () => {};
  s.end = () => { setImmediate(() => s.emit('end')); };
  s.write = (chunk) => {
    fs.appendFileSync(process.env.FAKE_SMTP_OUT, JSON.stringify(String(chunk)) + '\n');
    const code = REPLIES[n++] || '250';
    setImmediate(() => s.emit('data', `${code} ok\r\n`));
    return true;
  };
  setImmediate(() => s.emit('data', '220 ready\r\n'));
  return s;
};
