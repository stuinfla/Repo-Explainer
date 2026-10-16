// ask.mjs — give an assembled explainer an "Ask this project" box.
//
// WHAT SHIPS INTO THE SITE (pure static files — the explainer stays a zip deploy):
//   ask/index.json  page sections + the knowledge pack's passages (the ONLY text the ask service will ever use)
//   ask/ask.js, ask/ask.css, and a section in index.html placed after the story, plus a floating button.
// The page asks a central service (ASK_ENDPOINT, default the explainmyrepo ask service) to write a cited answer.
// That service trusts nothing from the browser except a question and passage ids: it verifies the signed token
// for this site's host, fetches this site's own ask/index.json, and builds the passages itself.
//
// The token needs the final host, which is only known when deploy resolves the Netlify site name, so inject()
// leaves a placeholder and finalize() (called by deploy.mjs just before upload) fills it in. With no signing
// secret the box still works in "closest passages" mode and says so honestly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signAskToken, isHost } from './ask-token.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'tools', 'ask');
export const DEFAULT_ENDPOINT = 'https://explainmyrepo-ask.netlify.app/api/ask';
const MAX_TEXT = 1100, MAX_DOCS = 6000;
export const PLACEHOLDER = '__ASK_TOKEN__';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();

/** The page's own sections, in document order — the first thing the Ask box searches. */
export function extractSections(html) {
  const out = [];
  for (const m of html.matchAll(/<details class="section"[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/details>/g)) {
    const [, id, inner] = m;
    const h = (inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const q = (inner.match(/<span class="q">([\s\S]*?)<\/span>/) || [])[1];
    const body = (inner.match(/<div class="body">([\s\S]*)$/) || [null, inner])[1];
    const paras = [...body.matchAll(/<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/g)].map((x) => text(x[1])).filter((t) => t.length > 40);
    const code = (body.match(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>/) || [])[1];
    if (!h) continue;
    out.push({ id, h: text(h), q: q ? text(q) : '', text: paras.join(' ').slice(0, 2500), code: code ? text(code).slice(0, 200) : '' });
  }
  return out;
}

export function readPassages(passagesPath) {
  const docs = [];
  for (const line of fs.readFileSync(passagesPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.text || !r.path) continue;
    docs.push({ p: r.path, t: (r.title || '').slice(0, 120), x: r.text.slice(0, MAX_TEXT) });
    if (docs.length >= MAX_DOCS) break;
  }
  return docs;
}

export const genericStarters = (name) => [`What does ${name} do?`, 'How do I get started?', 'What does it need to run?', 'What can it not do?'];

/** Questions a first-time reader would ask that the page does NOT already answer; falls back to generic ones. */
export async function authorStarters({ name, sections, docs, ask }) {
  if (!ask) return genericStarters(name);
  try {
    const titles = [...new Set(docs.map((d) => d.t).filter(Boolean))].slice(0, 60).join('; ');
    const covered = sections.map((s) => `${s.h} (${s.q})`).join('; ');
    const r = await ask({
      system: 'You write starter questions for a "Ask this project" box on an explainer page. A first-time reader who is not an engineer would type them. Reply with JSON: {"questions": ["...", "...", "...", "..."]}. Exactly 4 questions, 3 to 10 words each, plain words, each ending in "?". They must be things the project’s own documents can answer but the page sections listed do NOT already cover. No jargon, no marketing words, no yes/no-only questions like "Is it elegant?".',
      user: `PROJECT: ${name}\nPAGE ALREADY COVERS: ${covered}\nDOCUMENT TITLES IN THE REPO: ${titles}`,
    });
    const qs = (r?.questions || []).map((x) => String(x).trim()).filter((x) => x.endsWith('?') && x.split(/\s+/).length >= 3 && x.split(/\s+/).length <= 12 && x.length < 90);
    return qs.length >= 3 ? qs.slice(0, 4) : genericStarters(name);
  } catch { return genericStarters(name); }
}

const glass = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

/** Writes the index + assets and patches index.html. Idempotent. Returns a result object. */
export function inject({ siteDir, passagesPath, repo, name, starters, endpoint = DEFAULT_ENDPOINT }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error(`bad repo "${repo}"`);
  const htmlPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(htmlPath)) throw new Error(`no index.html in ${siteDir}`);
  let html = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<!-- ask:begin -->[\s\S]*?<!-- ask:end -->\n?/g, '')
    .replace(/<link rel="stylesheet" href="ask\/ask\.css">\n?/g, '')
    .replace(/<script src="ask\/ask\.js" defer><\/script>\n?/g, '')
    .replace(/<a href="#ask">Ask<\/a>\s*/g, '');
  const sections = extractSections(html);
  const docs = readPassages(passagesPath);
  if (docs.length < 50) throw new Error(`only ${docs.length} usable passages — refusing to ship a thin Ask box`);
  if (!sections.length) throw new Error('found no page sections to index');

  fs.mkdirSync(path.join(siteDir, 'ask'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'ask', 'index.json'), JSON.stringify({ repo, docs, sections }));
  for (const f of ['ask.js', 'ask.css']) fs.copyFileSync(path.join(ASSETS, f), path.join(siteDir, 'ask', f));

  const qs = (starters && starters.length ? starters : genericStarters(name)).slice(0, 4);
  const section = `<!-- ask:begin -->
<section class="ask" id="ask" aria-labelledby="ask-h" data-index="ask/index.json" data-repo="${esc(repo)}" data-name="${esc(name)}" data-fn="${esc(endpoint)}" data-token="${PLACEHOLDER}">
  <div class="ask-card">
    <span class="ask-eyebrow">Still curious?</span>
    <h2 id="ask-h">Ask ${esc(name)} a question.</h2>
    <p class="ask-sub">Ask in your own words. You get a short written answer, with links to the exact files it used.</p>
    <form class="ask-form" role="search">${glass}<input class="ask-input" type="text" aria-label="Ask a question about ${esc(name)}" placeholder="Try: ${esc(qs[0])}" autocomplete="off" enterkeyhint="search"><button class="ask-go" type="submit">Ask</button></form>
    <div class="ask-chips">${qs.map((s) => `<button type="button" class="ask-chip">${esc(s)}</button>`).join('')}</div>
    <div class="ask-out" aria-live="polite"><div class="ask-scan"><i></i><span></span></div><div class="ask-ans"></div></div>
  </div>
</section>
<button class="ask-fab" type="button" aria-label="Ask a question about ${esc(name)}">${glass}<span>Ask</span></button>
<!-- ask:end -->
`;
  const at = html.indexOf('<footer class="explainer-footer"');
  if (at < 0) throw new Error('could not find the page footer to place the Ask section before');
  html = html.slice(0, at) + section + html.slice(at);
  html = html.replace('</head>', '  <link rel="stylesheet" href="ask/ask.css">\n</head>')
    .replace('</body>', '  <script src="ask/ask.js" defer></script>\n</body>')
    .replace(/(<nav class="nav-links"[^>]*>\s*)/, '$1<a href="#ask">Ask</a>\n        ');
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(siteDir, 'ask', 'pending.json'), JSON.stringify({ endpoint }));
  return { passages: docs.length, sections: sections.length, starters: qs };
}

/** Called by deploy.mjs once the final host is known, before upload. Never throws; reports what it did. */
export function finalize(siteDir, host, secret) {
  const pending = path.join(siteDir, 'ask', 'pending.json');
  if (!fs.existsSync(pending)) return { ask: 'absent' };
  const htmlPath = path.join(siteDir, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  fs.rmSync(pending, { force: true });
  let token = null;
  try { if (secret && isHost(host)) token = signAskToken(host, secret); } catch { token = null; }
  if (token) { html = html.replace(PLACEHOLDER, token); fs.writeFileSync(htmlPath, html); return { ask: 'written-answers', host }; }
  // no secret (or an unusable host): ship the box in closest-passages mode, honestly
  html = html.replace(` data-fn="${esc(DEFAULT_ENDPOINT)}"`, '').replace(/ data-fn="[^"]*"/, '').replace(` data-token="${PLACEHOLDER}"`, '');
  fs.writeFileSync(htmlPath, html);
  return { ask: 'closest-passages-only', reason: secret ? `unusable host ${host}` : 'ASK_SIGNING_SECRET not set' };
}
