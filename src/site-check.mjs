// site-check.mjs — integrity checks on an assembled explainer site, run before it is published.
//
// Two classes of result, on purpose (the pattern from Mark Templeton's `check:standards`, narrowed to what
// has actually bitten explainers): `blocking` failures mean the page would ship broken — a missing local
// file, a dead Ask box, a localhost link — and stop the deploy; `advisory` ones are reported but never block.
import fs from 'node:fs';
import path from 'node:path';

const asset = (dir, rel) => fs.existsSync(path.join(dir, rel.split('?')[0]));

export function checkSite(dir) {
  const results = [];
  const add = (blocking, ok, msg) => results.push({ blocking, ok, msg });
  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) return [{ blocking: true, ok: false, msg: `no index.html in ${dir}` }];
  const html = fs.readFileSync(htmlPath, 'utf8');

  add(true, /<title>[^<]{4,}<\/title>/.test(html), 'Page title');
  const refs = [...html.matchAll(/(?:href|src|poster)="([^"#:?]+\.[a-z0-9]+)"/gi)].map((m) => m[1]).filter((r) => !/^https?:|^\/\//.test(r));
  const missing = [...new Set(refs)].filter((r) => !asset(dir, r));
  add(true, !missing.length, `Every local file the page links exists${missing.length ? ` — missing: ${missing.slice(0, 6).join(', ')}` : ` (${new Set(refs).size} checked)`}`);
  add(true, !/(?:href|src|action|poster)="(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)/i.test(html), 'No links or files pointing at localhost (page text may mention it)');

  add(false, /<meta name="description" content="[^"]{20,}"/.test(html), 'Meta description');
  for (const k of ['og:title', 'og:description', 'og:image', 'twitter:card']) add(false, html.includes(`"${k}"`), `Share tag ${k}`);
  add(false, /name="viewport"/.test(html), 'Mobile viewport');
  add(false, /<html[^>]*lang=/.test(html), 'Page language set');

  if (html.includes('id="ask"')) {
    let n = 0, sections = 0;
    try { const ix = JSON.parse(fs.readFileSync(path.join(dir, 'ask', 'index.json'), 'utf8')); n = ix.docs.length; sections = (ix.sections || []).length; } catch { /* reported below */ }
    add(true, n >= 50, `Ask index has real content (${n} passages, ${sections} page sections)`);
    add(true, asset(dir, 'ask/ask.js') && asset(dir, 'ask/ask.css'), 'Ask scripts shipped');
    add(true, !html.includes('__ASK_TOKEN__') || !!process.env.ASK_CHECK_ALLOW_PLACEHOLDER, 'Ask credential resolved (no placeholder left in the page)');
  }
  return results;
}

export function formatResults(results) {
  return results.map((r) => `${r.ok ? 'PASS' : r.blocking ? 'FAIL' : 'WARN'} ${r.msg}`).join('\n');
}
export const blockingFailures = (results) => results.filter((r) => r.blocking && !r.ok);
