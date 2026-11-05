// Builds a REAL, decodable PNG (8-bit greyscale) of any size, synchronously, with no image library.
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** `noise` > 0 appends that many incompressible bytes as a trailing ancillary chunk (to reach a target file size). */
export function pngBuffer(w, h, { noise = 0 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 0x40);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw))];
  if (noise) parts.push(chunk('teXt', Buffer.alloc(noise, 0x61)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

import fs from 'node:fs';
import path from 'node:path';
/** Writes site/assets/card.png and returns `html` with valid share meta tags prepended (deploy's site-check requires them). */
export function withShareCard(siteDir, html, host = 'r-explainer.netlify.app') {
  fs.mkdirSync(path.join(siteDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'assets', 'card.png'), pngBuffer(1200, 630));
  const img = `https://${host}/assets/card.png`;
  const m = (k, v) => `<meta property="${k}" content="${v}">`;
  return `${m('og:title', 'r — A test page')}${m('og:url', `https://${host}/`)}${m('og:image', img)}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="r — A test page"><meta name="twitter:image" content="${img}">${html}`;
}
