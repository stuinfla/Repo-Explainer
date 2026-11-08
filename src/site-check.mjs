// site-check.mjs — integrity checks on an assembled explainer site, run before it is published.
//
// Two classes of result, on purpose (the pattern from Mark Templeton's `check:standards`, narrowed to what
// has actually bitten explainers): `blocking` failures mean the page would ship broken — a missing local
// file, a dead Ask box, a localhost link — and stop the deploy; `advisory` ones are reported but never block.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PLACEHOLDER } from './ask.mjs';

const asset = (dir, rel) => fs.existsSync(path.join(dir, rel.split('?')[0]));

export const CARD_W = 1200, CARD_H = 630, CARD_MAX_BYTES = 1_500_000, TITLE_MAX = 70, DESC_MAX = 200;
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ELLIPSIS_END = /(?:…|\.{3})\s*$/;

/** Content of <meta property|name="key" content="…"> in either attribute order; null when absent. */
export function metaContent(html, key) {
  const tag = html.match(new RegExp(`<meta\\b[^>]*\\b(?:property|name)="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`, 'i'));
  const c = tag && tag[0].match(/\bcontent="([^"]*)"/i);
  return c ? unesc(c[1]) : null;
}

/** { w, h } from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// The share card is a REQUIRED deliverable: every check below blocks the deploy.
function shareCardChecks(dir, html, host, add) {
  const imgs = {};
  for (const k of ['og:image', 'twitter:image']) {
    const v = metaContent(html, k);
    let u = null; try { u = v ? new URL(v) : null; } catch { /* reported below */ }
    imgs[k] = u;
    add(true, !!u && u.protocol === 'https:' && /^\/assets\/[^/]+\.png$/i.test(u.pathname) && (!host || u.host === host),
      `${k} is an absolute https URL to /assets/<file>.png${host ? ` on ${host}` : ''}${v ? ` (${v})` : ' (tag missing)'}`);
  }
  const og = imgs['og:image'];
  const pageUrl = metaContent(html, 'og:url');
  let pageHost = null; try { pageHost = pageUrl ? new URL(pageUrl).host : null; } catch { /* none */ }
  add(true, !!og && !!imgs['twitter:image'] && og.href === imgs['twitter:image'].href && (!pageHost || og.host === pageHost),
    'og:image and twitter:image are the same file, on the same host as og:url');
  let buf = null;
  if (og) { try { buf = fs.readFileSync(path.join(dir, decodeURIComponent(og.pathname).replace(/^\/+/, ''))); } catch { /* reported below */ } }
  add(true, !!buf, 'Share card file exists in the build');
  const size = buf ? pngSize(buf) : null;
  add(true, !!size && size.w === CARD_W && size.h === CARD_H, `Share card is a real PNG of exactly ${CARD_W}x${CARD_H}${buf ? ` (found ${size ? `${size.w}x${size.h}` : 'not a PNG'})` : ''}`);
  add(true, !!buf && buf.length < CARD_MAX_BYTES, `Share card is under ${CARD_MAX_BYTES / 1e6} MB${buf ? ` (${(buf.length / 1e6).toFixed(2)} MB)` : ''}`);
  for (const k of ['og:title', 'twitter:title']) {
    const t = metaContent(html, k);
    add(true, t !== null && t.length > 0 && t.length <= TITLE_MAX && !ELLIPSIS_END.test(t), `${k} is 1-${TITLE_MAX} chars and not clipped with an ellipsis${t ? ` (${t.length}: "${t}")` : ' (tag missing)'}`);
  }
  add(true, metaContent(html, 'twitter:card') === 'summary_large_image', 'twitter:card is summary_large_image');
  const d = metaContent(html, 'og:description');
  add(false, d !== null && d.length > 0 && d.length <= DESC_MAX && !ELLIPSIS_END.test(d), `og:description is 1-${DESC_MAX} chars, unclipped`);
}

/**
 * After deploy: the card must be served from the LIVE host as 200 image/png of the right size.
 * Pure + injectable fetch (no network in tests). Returns { ok, msg }.
 */
export async function verifyLiveShareCard({ html, liveUrl, fetchImpl = globalThis.fetch }) {
  const v = metaContent(html, 'og:image');
  let u = null; try { u = v ? new URL(v) : null; } catch { /* below */ }
  if (!u) return { ok: false, msg: 'live share card: page has no valid og:image URL' };
  if (liveUrl && new URL(liveUrl).host !== u.host) return { ok: false, msg: `live share card: og:image points at ${u.host} but the page is served from ${new URL(liveUrl).host}` };
  let r;
  try { r = await fetchImpl(u.href, { redirect: 'follow' }); } catch (e) { return { ok: false, msg: `live share card: fetch failed (${e.message})` }; }
  if (!r.ok) return { ok: false, msg: `live share card: ${u.href} returned HTTP ${r.status}` };
  const type = (r.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/png') return { ok: false, msg: `live share card: content-type is "${type}", expected image/png` };
  const size = pngSize(Buffer.from(await r.arrayBuffer()));
  if (!size || size.w !== CARD_W || size.h !== CARD_H) return { ok: false, msg: `live share card: body is ${size ? `${size.w}x${size.h}` : 'not a PNG'}, expected ${CARD_W}x${CARD_H}` };
  return { ok: true, msg: `live share card OK: ${u.href}` };
}


// ── page weight budget ─────────────────────────────────────────────────────────────────────────
// First view = gzipped HTML + CSS + the images the browser fetches before any scroll (those without loading="lazy"),
// assuming a ~960px-class screen. Image total = every image the page can load (the largest candidate of each
// <picture>); the lightbox originals (data-src) are fetched only on click and are not counted.
export const FIRST_VIEW_WARN_BYTES = 300_000, IMAGE_TOTAL_FAIL_BYTES = 1_500_000;
const sizeOf = (dir, rel) => { try { return fs.statSync(path.join(dir, decodeURIComponent(rel.split('?')[0]))).size; } catch { return 0; } };
const gz = (dir, rel) => { try { return zlib.gzipSync(fs.readFileSync(path.join(dir, rel))).length; } catch { return 0; } };
function pickCandidate(srcset, want) {
  const c = [...srcset.matchAll(/(assets\/[^\s,]+)(?:\s+(\d+)w)?/g)].map((m) => ({ file: m[1], w: Number(m[2] || 0) })).sort((a, b) => a.w - b.w);
  return c.find((x) => x.w >= want) || c[c.length - 1] || null;
}
export function pageWeight(dir, html) {
  let firstView = gz(dir, 'index.html') + gz(dir, 'styles.css');
  let images = 0;
  const seen = new Set();
  const take = (file, eager) => {
    if (!file) return;
    const b = sizeOf(dir, file);
    if (!seen.has(`t:${file}`)) { seen.add(`t:${file}`); images += b; }
    if (eager && !seen.has(`f:${file}`)) { seen.add(`f:${file}`); firstView += b; }
  };
  const pictureRe = /<picture>[\s\S]*?<\/picture>/g;
  for (const pic of html.match(pictureRe) || []) {
    const eager = !/loading="lazy"/.test(pic);
    const avif = /<source[^>]*type="image\/avif"[^>]*srcset="([^"]+)"/.exec(pic);
    const img = /<img[^>]*\bsrcset="([^"]+)"/.exec(pic) || /<img[^>]*\bsrc="([^"]+)"/.exec(pic);
    const set = avif ? avif[1] : img ? img[1] : '';
    const big = pickCandidate(set, 1440), view = pickCandidate(set, 960);
    if (big) take(big.file, false);
    if (view && eager) { const b = sizeOf(dir, view.file); if (!seen.has(`f:${view.file}`)) { seen.add(`f:${view.file}`); firstView += b; } }
  }
  for (const m of html.replace(pictureRe, '').matchAll(/<img\b[^>]*\bsrc="(assets\/[^"]+)"[^>]*>/g)) take(m[1], !/loading="lazy"/.test(m[0]));
  return { firstView, images };
}

/** opts.host: the final deploy host (e.g. foo-explainer.netlify.app); when given, the share URLs must be on it.
 *  opts.allowAskPlaceholder: deploy fills the Ask credential in after this check, so the placeholder is allowed. */
export function checkSite(dir, opts = {}) {
  const results = [];
  const add = (blocking, ok, msg) => results.push({ blocking, ok, msg });
  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) return [{ blocking: true, ok: false, msg: `no index.html in ${dir}` }];
  const html = fs.readFileSync(htmlPath, 'utf8');

  add(true, /<title>[^<]{4,}<\/title>/.test(html), 'Page title');
  const refs = [...html.matchAll(/(?:href|src|poster)="([^"#:?]+\.[a-z0-9]+)"/gi)].map((m) => m[1]).filter((r) => !/^https?:|^\/\//.test(r));
  const missing = [...new Set(refs)].filter((r) => !asset(dir, r));
  add(true, !missing.length, `Every local file the page links exists${missing.length ? ` — missing: ${missing.slice(0, 6).join(', ')}` : ` (${new Set(refs).size} checked)`}`);
  // phone twins: the media-query <source> and the lightbox's data-src-m must name files that ship
  const twins = [...new Set([
    ...[...html.matchAll(/data-src-m="(assets\/[^"\s,]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<source\b[^>]*\bmedia="[^"]*"[^>]*\bsrcset="(assets\/[^"\s,]+)"/g)].map((m) => m[1]),
  ])];
  const lostTwins = twins.filter((r) => !asset(dir, r));
  add(true, !lostTwins.length, `Every phone-twin image the page names exists${lostTwins.length ? ` — missing: ${lostTwins.slice(0, 6).join(', ')}` : ` (${twins.length} checked)`}`);
  // responsive variants (AVIF / JPEG srcset candidates) are a different file family from the phone twins
  const variants = new Set();
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) for (const c of m[1].split(',')) { const f = c.trim().split(/\s+/)[0]; if (/^assets\//.test(f) && !twins.includes(f)) variants.add(f); }
  const lostVariants = [...variants].filter((f) => !asset(dir, f));
  add(true, !lostVariants.length, `Every responsive image variant (AVIF/JPEG srcset) the page names exists${lostVariants.length ? ` — missing: ${lostVariants.slice(0, 6).join(', ')}` : ` (${variants.size} checked)`}`);
  add(true, !/(?:href|src|action|poster)="(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)/i.test(html), 'No links or files pointing at localhost (page text may mention it)');

  add(false, /<meta name="description" content="[^"]{20,}"/.test(html), 'Meta description');
  shareCardChecks(dir, html, opts.host, add);
  const w = pageWeight(dir, html);
  add(false, w.firstView <= FIRST_VIEW_WARN_BYTES, `First view transfers at most ${FIRST_VIEW_WARN_BYTES / 1000} KB (${(w.firstView / 1000).toFixed(0)} KB: HTML + CSS + above-the-fold images)`);
  add(true, w.images <= IMAGE_TOTAL_FAIL_BYTES, `Page images total at most ${IMAGE_TOTAL_FAIL_BYTES / 1e6} MB (${(w.images / 1e6).toFixed(2)} MB; lightbox originals are not counted)`);
  add(false, /name="viewport"/.test(html), 'Mobile viewport');
  add(false, /<html[^>]*lang=/.test(html), 'Page language set');

  if (html.includes('id="ask"')) {
    let n = 0, sections = 0;
    try { const ix = JSON.parse(fs.readFileSync(path.join(dir, 'ask', 'index.json'), 'utf8')); n = ix.docs.length; sections = (ix.sections || []).length; } catch { /* reported below */ }
    add(true, n >= 50, `Ask index has real content (${n} passages, ${sections} page sections)`);
    add(true, asset(dir, 'ask/ask.js') && asset(dir, 'ask/ask.css'), 'Ask scripts shipped');
    add(true, !html.includes(PLACEHOLDER) || opts.allowAskPlaceholder === true, 'Ask credential resolved (no placeholder left in the page)');
  }
  return results;
}

export function formatResults(results) {
  return results.map((r) => `${r.ok ? 'PASS' : r.blocking ? 'FAIL' : 'WARN'} ${r.msg}`).join('\n');
}
export const blockingFailures = (results) => results.filter((r) => r.blocking && !r.ok);
