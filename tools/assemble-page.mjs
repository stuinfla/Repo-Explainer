#!/usr/bin/env node
// assemble-page.mjs — Station 6 (ADR-0005): THE central render.
//
// Compose BuildContext.content + the per-repo theme (concept "expression knobs") + every asset path
// onto the shared assets/design-system/design-system.css + its section archetypes -> ONE
// self-contained, accessible site/ (index.html · styles.css · sitemap.xml · robots.txt · llms.txt).
// Rendered ONCE from typed slots — no string-coupled HTML markers (INV-10). Pure + fail-loud
// (tools/CONTRACT.md (a)/(b)/(c); ADR-0005 D4 / Station 6; DDD §8.6, INV-09/10/13/14/15).
//
//   Usage:  node tools/assemble-page.mjs <build-dir>
//
//   Reads  (declared inputs, read-only):
//     <build-dir>/build.json  slices →  repo · concept · content · visuals · brand · kb.primerPath
//                                       (+ pack.zipPath if present, for the download link only)
//     assets/design-system/design-system.css   (the shared recipe stylesheet — fixed dependency)
//     the asset files named in visuals.* / brand.* / kb.primerPath (copied into site/, never mutated)
//
//   Writes (outputs):
//     <build-dir>/site/{index.html, styles.css, sitemap.xml, robots.txt, llms.txt}
//     <build-dir>/site/assets/*   (copies of the referenced images / SVGs / favicons / social card)
//     merges ONLY the `page` slot back into build.json (every other slot byte-for-byte untouched)
//
//   stdout: ONE JSON result object.  stderr: diagnostics.  exit 0 iff ok:true; any failure → exit!=0.
//
//   ── content schema this renderer expects (the brain/render contract; missing essentials fail loud) ──
//     concept:  { metaphor, tagline, copyVoice?, heroConcept?,
//                 palette:{ <knob>:value, … }            // knob ∈ design-system expression knobs
//                 typePersonality?:{ display?,sans?,mono?,fontHref?,
//                                    displayWeight?,displayCase?,displayTracking? } }
//     content.sections:
//       hero:        { eyebrow?, headline | headlineHtml, lede, sub?, ctas?[{label,href,ghost?}],
//                      meta?[{label,value}], plain? }
//       problem:     { title, lead?, paragraphs?, note?:{kind?,label?,text} }
//       whatItIs:    { title, lead?, paragraphs?, table?:{caption?,head[],rows[][]} }
//       insight:     { title, lead?, paragraphs?, oh }
//       howItWorks:  { title, lead?, paragraphs? }                 // arch + flow SVGs are MANDATORY
//       useCases:    { title, intro?, cases:[{title,tag?,paragraphs?|body?,code?,dl?[{term,desc}]}] }
//       getStarted:  { title, intro?, install?, steps:[ string | {strong,text} ] }
//       pack:        { title, intro?, tree?, downloadLabel? }      // human primer SHIPS IN the pack zip, never inlined
//     content.arc?: [{ question, section, altitude }]              // per-section arc question override

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // tools/
const REPO_ROOT = path.resolve(HERE, '..');
const DS_CSS = path.join(REPO_ROOT, 'assets', 'design-system', 'design-system.css');

// ── result / failure plumbing (CONTRACT (b)·5/6) ─────────────────────────────────────────────
function ok(outputs) {
  process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n');
  process.exit(0);
}
function fail(error) {
  process.stderr.write(`assemble-page: ${error}\n`);
  process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: String(error) }) + '\n');
  process.exit(1);
}

// ── small helpers (kb/ style) ────────────────────────────────────────────────────────────────
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`cannot read JSON ${p}: ${e.message}`); }
}
function must(p, what) { if (!p || !fs.existsSync(p)) throw new Error(`missing ${what || 'input'}: ${p}`); return p; }
function reqStr(v, name) { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required (non-empty string)`); return v; }
function reqArr(v, name) { if (!Array.isArray(v) || v.length === 0) throw new Error(`${name} is required (non-empty array)`); return v; }
function reqObj(v, name) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} is required (object)`); return v; }

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// minimal, SAFE inline markdown: `code`, [text](url), **bold**, *italic*. Everything escaped first.
function inline(s) {
  let t = esc(String(s));
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const safe = /^(https?:|#|\/|mailto:)/.test(url) ? url : '#';
    const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${esc(safe)}"${ext}>${txt}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}
function paras(x) {
  if (!x) return '';
  const arr = Array.isArray(x) ? x : String(x).split(/\n\s*\n/);
  return arr.filter((s) => String(s).trim()).map((s) => `<p>${inline(String(s).trim())}</p>`).join('\n      ');
}

// resolve an asset path from build.json (absolute, or relative to the build dir) → copy into site/assets.
function copyAsset(rawPath, buildDir, siteAssets, what) {
  const src = path.isAbsolute(rawPath) ? rawPath : path.resolve(buildDir, rawPath);
  must(src, what);
  const base = path.basename(src);
  fs.copyFileSync(src, path.join(siteAssets, base));
  return base;
}

// ── theme block: concept.palette / typePersonality → :root expression-knob overrides ───────────
const KNOBS = new Set([
  'bg', 'bg-2', 'surface', 'surface-2', 'ridge', 'ink', 'ink-2', 'muted', 'faint', 'on-accent',
  'accent', 'accent-2', 'accent-3', 'spectrum', 'ok', 'warn', 'bad',
  'display', 'sans', 'mono', 'display-weight', 'display-case', 'display-tracking',
  'radius', 'radius-s', 'ease', 'hero-grad-angle',
]);
function normKnob(k) { return String(k).replace(/^--/, '').trim().toLowerCase(); }
function safeCssValue(v, knob) {
  const val = String(v).trim();
  if (!val) throw new Error(`concept.palette['${knob}'] is empty`);
  if (/[;{}<>]/.test(val) || /javascript:/i.test(val) || /url\(/i.test(val)) {
    throw new Error(`concept.palette['${knob}'] contains a disallowed value: ${val}`);
  }
  return val;
}
function buildTheme(concept) {
  const palette = reqObj(concept.palette, 'concept.palette');
  const decls = [];
  const tokensUsed = [];
  let colorScheme = null;
  for (const [rawK, rawV] of Object.entries(palette)) {
    const k = normKnob(rawK);
    if (k === 'color-scheme' || k === 'colorscheme') { colorScheme = safeCssValue(rawV, 'color-scheme'); continue; }
    if (!KNOBS.has(k)) { process.stderr.write(`assemble-page: ignoring unknown palette knob '${rawK}'\n`); continue; }
    decls.push([`--${k}`, safeCssValue(rawV, k)]);
    tokensUsed.push(`--${k}`);
  }
  if (!tokensUsed.includes('--accent')) throw new Error("concept.palette must define 'accent' (the cohesion anchor)");

  const tp = concept.typePersonality;
  let fontHref = null;
  if (tp && typeof tp === 'object') {
    const map = { display: 'display', sans: 'sans', mono: 'mono', displayWeight: 'display-weight', displayCase: 'display-case', displayTracking: 'display-tracking' };
    for (const [key, knob] of Object.entries(map)) {
      if (tp[key] != null && String(tp[key]).trim()) { decls.push([`--${knob}`, safeCssValue(tp[key], knob)]); tokensUsed.push(`--${knob}`); }
    }
    const fh = tp.fontHref || tp.fontImport;
    if (fh) {
      const m = String(fh).match(/https:\/\/[^\s'")]+/);
      if (!m) throw new Error('concept.typePersonality.fontHref must be an https font URL');
      fontHref = m[0];
    }
  }
  const rootBlock = [
    '/* ── per-repo THEME (expression knobs only — skeleton untouched) ── */',
    ':root {',
    colorScheme ? `  color-scheme: ${colorScheme};` : null,
    ...decls.map(([k, v]) => `  ${k}: ${v};`),
    '}',
  ].filter(Boolean).join('\n');

  return { css: rootBlock, tokensUsed, fontHref, accent: (decls.find(([k]) => k === '--accent') || [])[1] };
}

// ── section render helpers ─────────────────────────────────────────────────────────────────────
const ARC = {
  problem:    { id: 'problem',      q: 'Why does this exist?' },
  whatItIs:   { id: 'what-it-is',   q: 'What does it actually do?' },
  insight:    { id: 'the-insight',  q: 'Why is it elegant?' },
  howItWorks: { id: 'how-it-works', q: 'How is it built?' },
  useCases:   { id: 'use-cases',    q: 'Could I use this?' },
  getStarted: { id: 'get-started',  q: 'How do I start?' },
  pack:       { id: 'the-pack',     q: 'Does my AI get it too?' },
};
function noteHtml(n) {
  if (!n || !n.text) return '';
  const kind = n.kind === 'warn' ? ' warn' : n.kind === 'honest' ? ' honest' : '';
  const lab = n.label ? `<span class="lab">${esc(n.label)}</span>` : '';
  return `\n      <p class="note${kind}">${lab}${inline(n.text)}</p>`;
}
function figureHtml(base, alt, caption, opts = {}) {
  const cls = opts.diagram ? (opts.concept ? 'figure diagram concept' : 'figure diagram') : 'figure';
  const tier = opts.tier ? `\n        <span class="tier ${opts.tier.cls}">${esc(opts.tier.label)}</span>` : '';
  const cap = caption ? `\n        <figcaption>${inline(caption)}</figcaption>` : '';
  return `\n      <figure class="${cls}">${tier}\n        <img src="assets/${esc(base)}" alt="${esc(alt)}" loading="lazy">${cap}\n      </figure>`;
}
function tableHtml(t) {
  if (!t || !Array.isArray(t.head) || !Array.isArray(t.rows)) return '';
  const head = `<tr>${t.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n        ');
  const cap = t.caption ? `<caption class="visually-hidden">${esc(t.caption)}</caption>` : '';
  return `\n      <table class="tbl">${cap}\n        <thead>${head}</thead>\n        <tbody>\n        ${body}\n        </tbody>\n      </table>`;
}
function sectionShell(key, num, sec, arcQ, bodyHtml) {
  const meta = ARC[key];
  const q = arcQ || meta.q;
  return `
    <details class="section" id="${meta.id}" open>
      <summary>
        <span class="num">${num}</span>
        <span class="head-text">
          <h2>${inline(sec.title)}</h2>
          <span class="q">${esc(q)}</span>
        </span>
        <span class="chev" aria-hidden="true">&rsaquo;</span>
      </summary>
      <div class="body">
      ${bodyHtml}
      </div>
    </details>`;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────────────────
function main() {
  const buildDirArg = process.argv[2];
  if (!buildDirArg) throw new Error('usage: node tools/assemble-page.mjs <build-dir>');
  const buildDir = path.resolve(process.cwd(), buildDirArg);
  must(buildDir, 'build directory');
  const buildJsonPath = path.join(buildDir, 'build.json');
  const ctx = readJSON(must(buildJsonPath, 'build.json'));

  // --- declared inputs (read-only) ---
  const repo = reqObj(ctx.repo, 'repo');
  const slug = reqStr(repo.slug, 'repo.slug');
  const owner = reqStr(repo.owner, 'repo.owner');
  const repoName = reqStr(ctx.content?.meta?.repoName || repo.name, 'repo.name');
  const repoUrl = reqStr(repo.url, 'repo.url');

  const concept = reqObj(ctx.concept, 'concept');
  const tagline = reqStr(concept.tagline, 'concept.tagline');
  reqStr(concept.metaphor, 'concept.metaphor');

  const content = reqObj(ctx.content, 'content');
  const S = reqObj(content.sections, 'content.sections');
  const arcQ = {};
  if (Array.isArray(content.arc)) for (const a of content.arc) if (a && a.section) arcQ[a.section] = a.question;

  const visuals = reqObj(ctx.visuals, 'visuals');
  const brand = reqObj(ctx.brand, 'brand');
  // validate the authored human primer exists — it SHIPS INSIDE the pack zip (it is NOT inlined into
  // the page body; inlining it produced a multi-screen wall of text — the Generation-1 height defect).
  must(path.isAbsolute(ctx.kb?.primerPath || '')
    ? ctx.kb.primerPath
    : path.resolve(REPO_ROOT, ctx.kb?.primerPath || `kb/stores/${slug}/${slug}-primer.md`), 'kb.primerPath (authored primer, shipped in the pack)');

  must(DS_CSS, 'design-system.css');

  // --- prepare site/ + site/assets/ (idempotent: overwrite, never append) ---
  const siteDir = path.join(buildDir, 'site');
  const siteAssets = path.join(siteDir, 'assets');
  fs.mkdirSync(siteAssets, { recursive: true });

  // --- theme + stylesheet (design-system base + per-repo theme override) ---
  const theme = buildTheme(concept);
  const dsCss = fs.readFileSync(DS_CSS, 'utf8');
  fs.writeFileSync(path.join(siteDir, 'styles.css'), `${dsCss}\n\n${theme.css}\n`);

  // --- copy mandatory + optional visual assets (fail loud on a declared-but-broken file) ---
  const heroFile = copyAsset(reqStr(visuals.hero?.file, 'visuals.hero.file'), buildDir, siteAssets, 'hero image');
  const heroAlt = visuals.hero?.altText || visuals.hero?.alt || `${repoName}: ${concept.heroConcept || concept.metaphor}`;

  const arch = reqObj(visuals.architectureDiagram, 'visuals.architectureDiagram (MANDATORY)');
  const archFile = copyAsset(reqStr(arch.svgPath, 'visuals.architectureDiagram.svgPath'), buildDir, siteAssets, 'architecture diagram');
  const archAlt = reqStr(arch.altText, 'visuals.architectureDiagram.altText');

  // flow diagram is OPTIONAL — a pure library repo (no runtime entrypoints) has no flow; make-diagrams skips it there
  const flow = (visuals.flowDiagram && typeof visuals.flowDiagram === 'object') ? visuals.flowDiagram : null;
  const flowFile = (flow && flow.svgPath) ? copyAsset(reqStr(flow.svgPath, 'visuals.flowDiagram.svgPath'), buildDir, siteAssets, 'flow diagram') : null;
  const flowAlt = flow ? (flow.altText || '') : '';

  // optional ladder rungs — rendered only when present (no silent placeholder; broken file = loud)
  const optDiagram = (d) => (d && d.svgPath) ? { file: copyAsset(d.svgPath, buildDir, siteAssets, 'diagram'), alt: d.altText || '' } : null;
  const bigIdea = optDiagram(visuals.bigIdeaDiagram);
  const insightDia = optDiagram(visuals.insightDiagram);
  const rungs = Array.isArray(visuals.sections) ? visuals.sections : [];
  const findRung = (re) => rungs.find((r) => re.test(String(r.id || '')) || re.test(String(r.role || '')));
  const problemRung = findRung(/problem/i);
  const useCaseRung = findRung(/use.?case|scenario/i);
  const problemImg = problemRung?.file ? { file: copyAsset(problemRung.file, buildDir, siteAssets, 'problem illustration'), alt: problemRung.alt || problemRung.altText || `${repoName}: the problem` } : null;
  const useCaseImg = useCaseRung?.file ? { file: copyAsset(useCaseRung.file, buildDir, siteAssets, 'use-case scenario'), alt: useCaseRung.alt || useCaseRung.altText || `${repoName} in use` } : null;

  // --- social card + favicons ---
  const card = reqObj(brand.socialCard, 'brand.socialCard');
  const cardFile = copyAsset(reqStr(card.file, 'brand.socialCard.file'), buildDir, siteAssets, 'social card');
  const fav = reqObj(brand.favicon, 'brand.favicon');
  const favSet = reqArr(fav.set, 'brand.favicon.set');
  const favItems = [...favSet];
  if (fav.appleTouchIcon) favItems.push(fav.appleTouchIcon);
  const favLinks = [];
  for (const item of favItems) {
    const base = copyAsset(path.isAbsolute(item) ? item : path.join(buildDir, 'assets', item), buildDir, siteAssets, 'favicon');
    if (/apple/i.test(base)) favLinks.push(`<link rel="apple-touch-icon" href="assets/${base}">`);
    else if (/\.ico$/i.test(base)) favLinks.push(`<link rel="icon" href="assets/${base}" sizes="any">`);
    else { const sz = (base.match(/(\d{2,3})/) || [])[1]; favLinks.push(`<link rel="icon" type="image/png"${sz ? ` sizes="${sz}x${sz}"` : ''} href="assets/${base}">`); }
  }

  // --- SEO surface (INV-13/14) ---
  const BASE = `https://${slug}-explainer.netlify.app`;
  const canonical = `${BASE}/`;
  const cardUrl = `${BASE}/assets/${cardFile}`;
  const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
  const seoTitle = clip(content.meta?.title || `${repoName} — ${tagline}`, 70);
  const seoDesc = clip(content.meta?.description || tagline, 158);
  const packZip = (ctx.pack && ctx.pack.zipPath) ? path.basename(ctx.pack.zipPath) : `${slug}-knowledge-pack.zip`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: repoName,
    description: seoDesc,
    url: canonical,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform',
    image: cardUrl,
    author: { '@type': 'Person', name: owner },
    codeRepository: repoUrl,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  const jsonLdScript = JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c');

  // ── <head> ────────────────────────────────────────────────────────────────────────────────
  const fontPreconnect = theme.fontHref
    ? `\n  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link rel="stylesheet" href="${esc(theme.fontHref)}">`
    : '';
  const themeColor = theme.accent && /^#/.test(theme.accent) ? `\n  <meta name="theme-color" content="${esc(theme.accent)}">` : '';
  const head = `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(seoTitle)}</title>
  <meta name="description" content="${esc(seoDesc)}">
  <meta name="author" content="Independent explainer for ${esc(owner)}'s ${esc(repoName)} — built by Stuart Kerr at ISOvision.ai">
  <link rel="canonical" href="${esc(canonical)}">${themeColor}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(seoTitle)}">
  <meta property="og:description" content="${esc(tagline)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(cardUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(seoTitle)}">
  <meta name="twitter:description" content="${esc(tagline)}">
  <meta name="twitter:image" content="${esc(cardUrl)}">
  ${favLinks.join('\n  ')}${fontPreconnect}
  <link rel="stylesheet" href="styles.css">
  <script type="application/ld+json">
${jsonLdScript}
  </script>
</head>`;

  // ── header: provenance band + sticky nav ────────────────────────────────────────────────────
  const logo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="var(--accent)" stroke-width="2"></rect>
        <rect x="9" y="9" width="14" height="14" rx="4" fill="var(--accent-2)"></rect>
        <circle cx="16" cy="16" r="3" fill="var(--on-accent)"></circle>
      </svg>`;
  const header = `
  <div class="prov-banner">
    <div class="wrap prov-banner-inner">
      <p class="prov-attr">An independent explainer for <strong>${esc(owner)}</strong>'s <a href="${esc(repoUrl)}" target="_blank" rel="noopener">${esc(repoName)}</a> — built to help you actually implement it.</p>
      <p class="prov-live"><span class="prov-dot" aria-hidden="true">&#9679;</span> source <code>${esc(repoUrl.replace(/^https?:\/\//, ''))}</code></p>
    </div>
  </div>
  <header class="site-head">
    <div class="wrap">
      <a class="brand" href="#top" aria-label="${esc(repoName)} explainer home">
        ${logo}
        <span>${esc(repoName)}</span>
      </a>
      <nav class="nav-links" aria-label="Sections">
        <a href="#what-it-is">What it is</a>
        <a href="#how-it-works">How it works</a>
        <a href="#use-cases">Use cases</a>
        <a href="#get-started">Get started</a>
        <a href="#the-pack">AI pack</a>
        <a href="${esc(repoUrl)}" target="_blank" rel="noopener">GitHub &#8599;</a>
      </nav>
    </div>
  </header>`;

  // ── hero ────────────────────────────────────────────────────────────────────────────────────
  const hero = reqObj(S.hero, 'content.sections.hero');
  const headline = hero.headlineHtml ? hero.headlineHtml : inline(reqStr(hero.headline, 'content.sections.hero.headline'));
  reqStr(hero.lede, 'content.sections.hero.lede');
  const ctas = Array.isArray(hero.ctas) && hero.ctas.length ? hero.ctas : [
    { label: 'See how it works →', href: '#how-it-works' },
    { label: 'View the source ↗', href: repoUrl, ghost: true },
  ];
  const ctaHtml = ctas.map((c) => {
    const ext = /^https?:/.test(c.href || '') ? ' target="_blank" rel="noopener"' : '';
    return `<a class="cta${c.ghost ? ' ghost' : ''}" href="${esc(c.href || '#')}"${ext}>${inline(c.label)}</a>`;
  }).join('\n          ');
  const metaRow = Array.isArray(hero.meta) && hero.meta.length
    ? `\n        <div class="meta-row">${hero.meta.map((m) => `<span><b>${esc(m.label)}</b> ${esc(m.value)}</span>`).join('')}</div>` : '';
  const plainBand = hero.plain ? `
    <div class="wrap">
      <div class="plainband"><p>${inline(hero.plain)}</p></div>
    </div>` : '';
  const heroSection = `
  <a id="top"></a>
  <section class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          ${hero.eyebrow ? `<span class="eyebrow">${inline(hero.eyebrow)}</span>` : `<span class="eyebrow">${esc(concept.metaphor)}</span>`}
          <h1>${headline}</h1>
          <p class="lede">${inline(hero.lede)}</p>
          ${hero.sub ? `<p class="sub">${inline(hero.sub)}</p>` : ''}
          <p class="attrib-lede">An <strong>independent explainer</strong> for <strong>${esc(owner)}</strong>'s <a href="${esc(repoUrl)}" target="_blank" rel="noopener">${esc(repoName)}</a> — built to take you from "never seen it" to "ready to implement".</p>
          <div class="cta-row">
          ${ctaHtml}
          </div>${metaRow}
        </div>
        <figure class="hero-art">
          <img src="assets/${esc(heroFile)}" alt="${esc(heroAlt)}">
          <figcaption>${esc(concept.heroConcept || concept.metaphor)}</figcaption>
        </figure>
      </div>
    </div>${plainBand}
  </section>`;

  // ── arc sections ────────────────────────────────────────────────────────────────────────────
  const out = [];

  // 1 · problem
  const problem = reqObj(S.problem, 'content.sections.problem');
  reqStr(problem.title, 'content.sections.problem.title');
  out.push(sectionShell('problem', '01', problem, arcQ.problem, [
    problem.lead ? `<p class="lead-in">${inline(problem.lead)}</p>` : '',
    paras(problem.paragraphs),
    problemImg ? figureHtml(problemImg.file, problemImg.alt, problemRung?.caption, { tier: { cls: 'friendly', label: 'The problem' } }) : '',
    noteHtml(problem.note),
  ].filter(Boolean).join('\n      ')));

  // 2 · what it is  (big-idea diagram)
  const whatItIs = reqObj(S.whatItIs, 'content.sections.whatItIs');
  reqStr(whatItIs.title, 'content.sections.whatItIs.title');
  out.push(sectionShell('whatItIs', '02', whatItIs, arcQ.whatItIs, [
    whatItIs.lead ? `<p class="lead-in">${inline(whatItIs.lead)}</p>` : '',
    paras(whatItIs.paragraphs),
    bigIdea ? figureHtml(bigIdea.file, bigIdea.alt || `${repoName}: the whole idea in one picture`, whatItIs.figureCaption, { diagram: true, concept: true, tier: { cls: 'tech', label: 'The big idea' } }) : '',
    tableHtml(whatItIs.table),
  ].filter(Boolean).join('\n      ')));

  // 3 · insight  (the "oh" + insight diagram)
  const insight = reqObj(S.insight, 'content.sections.insight');
  reqStr(insight.title, 'content.sections.insight.title');
  reqStr(insight.oh, 'content.sections.insight.oh');
  out.push(sectionShell('insight', '03', insight, arcQ.insight, [
    insight.lead ? `<p class="lead-in">${inline(insight.lead)}</p>` : '',
    paras(insight.paragraphs),
    insightDia ? figureHtml(insightDia.file, insightDia.alt || `${repoName}: the one clever move`, insight.figureCaption, { diagram: true, concept: true, tier: { cls: 'tech', label: 'The aha' } }) : '',
    `<p class="oh">${inline(insight.oh)}</p>`,
  ].filter(Boolean).join('\n      ')));

  // 4 · how it works  (MANDATORY architecture + flow, side by side)
  const howItWorks = reqObj(S.howItWorks, 'content.sections.howItWorks');
  reqStr(howItWorks.title, 'content.sections.howItWorks.title');
  out.push(sectionShell('howItWorks', '04', howItWorks, arcQ.howItWorks, [
    howItWorks.lead ? `<p class="lead-in">${inline(howItWorks.lead)}</p>` : '',
    paras(howItWorks.paragraphs),
    flowFile
      ? `<div class="dual">${
          figureHtml(archFile, archAlt, 'Architecture — modules, components and how they depend on each other.', { diagram: true, tier: { cls: 'tech', label: 'Architecture' } })
        }${
          figureHtml(flowFile, flowAlt, 'Data flow — how a request moves through the system at runtime.', { diagram: true, tier: { cls: 'tech', label: 'Data flow' } })
        }\n      </div>`
      : figureHtml(archFile, archAlt, 'Architecture — modules, components and how they depend on each other.', { diagram: true, tier: { cls: 'tech', label: 'Architecture' } }),
  ].filter(Boolean).join('\n      ')));

  // 5 · use cases  (collapsible cases + scenario raster)
  const useCases = reqObj(S.useCases, 'content.sections.useCases');
  reqStr(useCases.title, 'content.sections.useCases.title');
  const cases = reqArr(useCases.cases, 'content.sections.useCases.cases');
  const casesHtml = cases.map((c, i) => {
    reqStr(c.title, `content.sections.useCases.cases[${i}].title`);
    const dl = Array.isArray(c.dl) && c.dl.length
      ? `\n          <dl>${c.dl.map((d) => `<dt>${esc(d.term)}</dt><dd>${inline(d.desc)}</dd>`).join('\n          ')}</dl>` : '';
    const code = c.code ? `\n          <pre class="code-block"><code>${esc(c.code)}</code></pre>` : '';
    return `
      <details class="case" open>
        <summary>
          <span class="uc-num">${i + 1}</span>
          <span class="uc-title">${inline(c.title)}</span>
          ${c.tag ? `<span class="uc-tag">${esc(c.tag)}</span>` : ''}
          <span class="chev" aria-hidden="true">&rsaquo;</span>
        </summary>
        <div class="uc-body">
          ${paras(c.paragraphs || c.body)}${code}${dl}
        </div>
      </details>`;
  }).join('');
  out.push(sectionShell('useCases', '05', useCases, arcQ.useCases, [
    useCases.intro ? `<p class="lead-in">${inline(useCases.intro)}</p>` : '',
    useCaseImg ? figureHtml(useCaseImg.file, useCaseImg.alt, useCaseRung?.caption, { tier: { cls: 'friendly', label: 'In the real world' } }) : '',
    `<div class="gallery"><div class="grid">${casesHtml}\n      </div></div>`,
  ].filter(Boolean).join('\n      ')));

  // 6 · get started  (install block + numbered steps)
  const getStarted = reqObj(S.getStarted, 'content.sections.getStarted');
  reqStr(getStarted.title, 'content.sections.getStarted.title');
  const steps = reqArr(getStarted.steps, 'content.sections.getStarted.steps');
  const stepsHtml = steps.map((s) => {
    if (s && typeof s === 'object') return `<li>${s.strong ? `<strong>${inline(s.strong)}</strong> ` : ''}${inline(s.text || '')}</li>`;
    return `<li>${inline(s)}</li>`;
  }).join('\n        ');
  out.push(sectionShell('getStarted', '06', getStarted, arcQ.getStarted, [
    getStarted.intro ? `<p class="lead-in">${inline(getStarted.intro)}</p>` : '',
    getStarted.install ? `<div class="install-block"><pre class="code-block"><code>${esc(getStarted.install)}</code></pre></div>` : '',
    `<ol class="steps">\n        ${stepsHtml}\n      </ol>`,
  ].filter(Boolean).join('\n      ')));

  // 7 · the AI pack  — a TIGHT, visual DOWNLOAD block: a file-tree TEASER of what's inside
  // (for-ai/ KB + search + MCP · for-humans/ primer) + the download CTA + dropzone. The full
  // human primer SHIPS INSIDE the zip; it is deliberately NOT inlined here (inlining it made the
  // page a multi-screen wall of text — the Generation-1 height defect this fix removes).
  const pack = reqObj(S.pack, 'content.sections.pack');
  reqStr(pack.title, 'content.sections.pack.title');
  // white-space:pre keeps the file-tree teaser an actual TREE (the .tree class ships
  // overflow-x:auto for exactly this but omits white-space:pre — set it inline so the
  // teaser reads as a tree instead of a run-on line; .tree's overflow-x:auto contains it).
  const tree = pack.tree ? `<div class="tree" style="white-space:pre">${esc(pack.tree)}</div>` : `<div class="tree" style="white-space:pre"><span class="cmt"># ${esc(packZip)}</span>
<span class="d">for-ai/</span>            <span class="cmt"># wire this into your agent</span>
  <span class="f">${esc(slug)}-kb.rvf</span>            <span class="cmt"># 384-dim vector brain (semantic search)</span>
  <span class="f">${esc(slug)}-kb.passages.jsonl</span> <span class="cmt"># full passage text (search returns TEXT)</span>
  <span class="f">${esc(slug)}-symbols.json</span>      <span class="cmt"># exact public API</span>
  <span class="f">${esc(slug)}-dep-graph.json</span>    <span class="cmt"># what depends on what</span>
  <span class="f">${esc(slug)}-entrypoints.json</span>  <span class="cmt"># build / test / run commands</span>
  <span class="f">ask-kb.mjs</span> · <span class="f">kb-mcp-server.mjs</span>  <span class="cmt"># CLI + MCP search server</span>
<span class="d heart">for-humans/</span>        <span class="cmt"># read first</span>
  <span class="f heart">${esc(slug)}-primer.md</span>      <span class="cmt"># the human orientation</span></div>`;
  out.push(sectionShell('pack', '07', pack, arcQ.pack, [
    pack.intro ? `<p class="lead-in">${inline(pack.intro)}</p>` : '',
    tree,
    `<div class="dl-cta"><a class="cta" href="${esc(packZip)}" download>${inline(pack.downloadLabel || 'Download the AI knowledge pack')}</a><span class="dl-meta">RVF vector KB + MCP server — drop it into your own agent.</span></div>`,
    `<a class="dropzone" href="${esc(packZip)}" download><span class="dz-icon" aria-hidden="true">&darr;</span><strong>Give your AI the same understanding</strong><span class="dz-hint">${esc(packZip)}</span></a>`,
  ].filter(Boolean).join('\n      ')));

  // ── mandated ISOvision attribution + CTA footer (verbatim per design-system §16b) ─────────────
  const footer = `
  <footer class="explainer-footer" role="contentinfo">
    <div class="wrap explainer-footer-inner">
      <p class="ef-credit">
        Explainer page created by <strong><a href="https://stuart-kerr-card.netlify.app" rel="author noopener" target="_blank">Stuart Kerr</a></strong> at
        <a href="https://isovision.ai" rel="noopener" target="_blank">ISOvision</a>
      </p>
      <a class="ef-cta" href="https://explainmyrepo.isovision.ai" target="_blank" rel="noopener">
        <span class="ef-cta-lead">Would you like your own repo explainer page?</span>
        <strong>Generate one here</strong>
        <span class="ef-arrow" aria-hidden="true">&rarr;</span>
      </a>
    </div>
  </footer>`;

  // ── assemble the single HTML document (rendered ONCE — INV-10) ───────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
${head}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
${header}
  <main id="main">
${heroSection}
    <div class="sections">
      <div class="wrap">${out.join('\n')}
      </div>
    </div>
  </main>
${footer}
</body>
</html>
`;

  // ── guard: zero template tokens / dangling refs (CONTRACT (b)·6, Station-6 cue) ───────────────
  // Mask legit escaped code/pre content before scanning: author code samples and the inlined primer
  // routinely contain `${...}` template literals and `{ ... }` JSON braces — that is CONTENT, never a
  // render leak. For this renderer a literal `${` in the output can ONLY come from esc()'d data (every
  // `${x}` in the renderer's own template strings is evaluated when the HTML is built), so masking the
  // <pre>/<code> regions removes the false positives while still catching real leaks in prose/markup.
  const scannable = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '');
  const leakRe = /\{\{|\}\}|\$\{|\[object Object\]|(?:^|[\s">])(?:undefined|NaN)(?:[\s"<]|$)|lorem ipsum|\bTODO\b|\bPLACEHOLDER\b/i;
  const leak = scannable.match(leakRe);
  if (leak) throw new Error(`unresolved token / placeholder leaked into the page: "${leak[0].trim()}"`);
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) {
    const ref = path.join(siteDir, m[1]);
    if (!fs.existsSync(ref)) throw new Error(`dangling asset reference: ${m[1]} (no file at ${ref})`);
  }

  // ── write the page + the site-level discovery files ──────────────────────────────────────────
  const htmlPath = path.join(siteDir, 'index.html');
  fs.writeFileSync(htmlPath, html);

  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${canonical}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`);
  fs.writeFileSync(path.join(siteDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
  fs.writeFileSync(path.join(siteDir, 'llms.txt'),
    `# ${repoName}\n\n> ${tagline}\n\n${seoDesc}\n\nThis is an independent, art-directed explainer for ${owner}'s ${repoName} — it takes a newcomer from "never seen it" to "ready to implement", grounded in a real RVF knowledge base of the source.\n\n## What it is\n${repoName}: ${concept.metaphor}\n\n## For your AI\nA downloadable knowledge pack (RVF vector KB + MCP server) ships with this page so your agent can search the source too: ${BASE}/${packZip}\n\n## Links\n- Live explainer: ${canonical}\n- Source repository: ${repoUrl}\n- AI knowledge pack: ${BASE}/${packZip}\n`);

  // ── merge ONLY the page slot back into build.json (read-modify-write; others untouched) ───────
  const pageSlot = {
    dir: siteDir,
    htmlPath,
    cssPath: path.join(siteDir, 'styles.css'),
    tokensUsed: theme.tokensUsed,
    seo: {
      title: seoTitle,
      description: seoDesc,
      canonical,
      jsonLd: 'SoftwareApplication',
      sitemap: 'sitemap.xml',
      robots: 'robots.txt',
      llmsTxt: 'llms.txt',
    },
    social: {
      og: { title: seoTitle, description: tagline, image: cardUrl, url: canonical },
      twitter: { card: 'summary_large_image', image: cardUrl },
    },
  };
  const fresh = readJSON(buildJsonPath);
  fresh.page = pageSlot;
  fs.writeFileSync(buildJsonPath, JSON.stringify(fresh, null, 2) + '\n');

  ok({
    dir: siteDir,
    htmlPath,
    cssPath: pageSlot.cssPath,
    sitemap: path.join(siteDir, 'sitemap.xml'),
    robots: path.join(siteDir, 'robots.txt'),
    llmsTxt: path.join(siteDir, 'llms.txt'),
    tokensUsed: theme.tokensUsed,
    slot: 'page',
  });
}

try { main(); } catch (e) { fail(e.message || e); }
