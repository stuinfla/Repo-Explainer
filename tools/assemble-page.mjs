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
//       hero:        { eyebrow?, headline, lede, sub?, ctas?[{label,href,ghost?}],
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
import { makeVariants, pictureHtml } from '../src/image-variants.mjs';
import { injectOverview } from '../src/overview-block.mjs';

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
const SAFE_HREF = /^(https?:|#|\/(?!\/)|mailto:)/i;
function safeCssValue(v, knob) {
  const val = String(v).trim();
  if (!val) throw new Error(`concept.palette['${knob}'] is empty`);
  if (/[;{}<>"]/.test(val) || /javascript:/i.test(val) || /url\(/i.test(val)) {
    throw new Error(`concept.palette['${knob}'] contains a disallowed value: ${val}`);
  }
  return val;
}
// ── CTA legibility: derive --on-accent from the ACTUAL button fill (WCAG AA). The skeleton's near-black
// default is invisible on a dark brain-chosen accent, so measure the contrast and pick the legible ink.
const ON_ACCENT_DARK = '#0a0a12';
const ON_ACCENT_LIGHT = '#f7f8fc';
const AA_CONTRAST = 4.5;                    // WCAG AA for normal-weight label text

function parseColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  const hex = s.match(/^#?([0-9a-f]{3,8})$/i) || s.match(/#([0-9a-f]{3,8})\b/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return null;
  }
  const rgb = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}
// A gradient carries several stops; the label must stay readable over EVERY one of them.
function parseColors(v) {
  if (!v) return [];
  const s = String(v);
  const found = [...(s.match(/#[0-9a-f]{3,8}\b/gi) || []), ...(s.match(/rgba?\([^)]*\)/gi) || [])];
  return found.map(parseColor).filter(Boolean);
}
const srgb = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => { const [r, g, b] = rgb.map(srgb); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
// Pick the ink whose WORST-CASE contrast across all fill stops is highest.
function bestOnAccent(fills) {
  let best = ON_ACCENT_DARK, bestMin = -1;
  for (const cand of [ON_ACCENT_DARK, ON_ACCENT_LIGHT]) {
    const rgb = parseColor(cand);
    const min = Math.min(...fills.map((f) => contrast(f, rgb)));
    if (min > bestMin) { bestMin = min; best = cand; }
  }
  return { color: best, minRatio: bestMin };
}

// A bare colour list is not a valid `background` through a custom property (the browser drops it and the
// CTA paints no fill), so a bare list is wrapped in linear-gradient().
const GRADIENT_FN = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
const COLOR_TOKEN = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;
function normalizeSpectrum(val) {
  if (GRADIENT_FN.test(val)) return val;
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of val) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.length >= 2 && parts.every((p) => COLOR_TOKEN.test(p)) ? `linear-gradient(96deg, ${parts.join(', ')})` : val;
}

// ── theme completeness: a palette that sets bg/ink must not inherit the skeleton's DARK siblings ─────────────
// The skeleton's defaults (--bg-2, --surface-2, --ridge, --ink-2, --muted, --faint) belong to a dark theme. A light
// palette that sets only bg/surface/ink would paint body copy (--ink-2, pale lavender) on a cream card and end the
// page background in near-black. Derive every missing sibling from the colours the palette DID set, and hold the
// text tokens to AA against every surface they can sit on.
const toHex = (rgb) => '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
const mixRgb = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);   // t=0 -> a, t=1 -> b
function holdAA(rgb, toward, grounds) {            // move `rgb` toward `toward` until every ground reaches AA
  let c = rgb;
  for (let i = 0; i < 40 && Math.min(...grounds.map((g) => contrast(c, g))) < AA_CONTRAST; i++) c = mixRgb(c, toward, 0.08);
  return c;
}
function completeTheme(decls, tokensUsed, note = (m) => process.stderr.write(m)) {
  const get = (t) => (decls.find(([k]) => k === t) || [])[1];
  const bg = parseColor(get('--bg')), ink = parseColor(get('--ink'));
  if (!bg || !ink) return;
  const surface = parseColor(get('--surface')) || bg;
  const put = (k, rgb, why) => {
    const v = toHex(rgb), cur = decls.find(([d]) => d === k);
    if (cur) cur[1] = v; else { decls.push([k, v]); tokensUsed.push(k); }
    note(`assemble-page: ${why} ${k} ${v}\n`);
  };
  const surface2 = parseColor(get('--surface-2')) || mixRgb(surface, ink, 0.05);
  if (!get('--bg-2')) put('--bg-2', mixRgb(bg, ink, 0.04), 'derived');
  if (!get('--surface-2')) put('--surface-2', surface2, 'derived');
  if (!get('--ridge')) put('--ridge', mixRgb(surface, ink, 0.14), 'derived');
  const grounds = [bg, surface, surface2, parseColor(get('--bg-2')) || bg];
  for (const [k, t] of [['--ink-2', 0.22], ['--muted', 0.42]]) {
    const given = parseColor(get(k));
    const want = holdAA(given || mixRgb(ink, bg, t), ink, grounds);
    if (!given) put(k, want, 'derived');
    else if (Math.min(...grounds.map((g) => contrast(given, g))) < AA_CONTRAST) put(k, want, `raised to AA (${AA_CONTRAST}:1)`);
  }
  if (!get('--faint')) put('--faint', mixRgb(ink, bg, 0.6), 'derived');
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
    decls.push([`--${k}`, k === 'spectrum' ? normalizeSpectrum(safeCssValue(rawV, k)) : safeCssValue(rawV, k)]);
    tokensUsed.push(`--${k}`);
  }
  if (!tokensUsed.includes('--accent')) throw new Error("concept.palette must define 'accent' (the cohesion anchor)");

  // `.cta` paints its label with --on-accent over --spectrum (falling back to --accent). Derive the
  // ink from whichever of those the theme actually set; refuse to ship a sub-AA explicit choice.
  const get = (t) => (decls.find(([k]) => k === t) || [])[1];
  let fillSrc = get('--spectrum');
  let fills = parseColors(fillSrc);
  if (!fills.length) { fillSrc = get('--accent'); fills = parseColors(fillSrc); }
  if (fills.length) {
    const { color: want, minRatio } = bestOnAccent(fills);
    const explicit = get('--on-accent');
    const explicitRgb = parseColor(explicit);
    const explicitMin = explicitRgb ? Math.min(...fills.map((f) => contrast(f, explicitRgb))) : null;
    if (!explicit) {
      decls.push(['--on-accent', want]); tokensUsed.push('--on-accent');
      process.stderr.write(`assemble-page: derived --on-accent ${want} for fill ${fillSrc} (${minRatio.toFixed(2)}:1)\n`);
    } else if (explicitMin !== null && explicitMin < AA_CONTRAST) {
      for (const d of decls) if (d[0] === '--on-accent') d[1] = want;
      process.stderr.write(`assemble-page: concept.palette['on-accent']=${explicit} is only ${explicitMin.toFixed(2)}:1 on ${fillSrc} (below AA ${AA_CONTRAST}) — overriding with ${want} (${minRatio.toFixed(2)}:1)\n`);
    }
  }

  completeTheme(decls, tokensUsed);

  const tp = concept.typePersonality;
  let fontHref = null;
  if (tp && typeof tp === 'object') {
    const map = { display: 'display', sans: 'sans', mono: 'mono', displayWeight: 'display-weight', displayCase: 'display-case', displayTracking: 'display-tracking' };
    for (const [key, knob] of Object.entries(map)) {
      if (tp[key] != null && String(tp[key]).trim()) { decls.push([`--${knob}`, safeCssValue(tp[key], knob)]); tokensUsed.push(`--${knob}`); }
    }
    const fh = tp.fontHref;
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

// ── share text: never clipped mid-phrase, never an ellipsis ───────────────────────────────────
const DANGLING = /(?:\s+(?:and|or|but|the|a|an|of|to|in|on|for|with|by|at|from|into|as|is|are|—|–|-))+$/i;
const tidyEnd = (t) => t.replace(DANGLING, '').replace(/[\s,;:—–-]+$/, '').trim();
/** Longest prefix of `text` that fits `max`: whole sentences first, else a word boundary. No ellipsis. */
export function fitText(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  let acc = '';
  for (const sn of sentences) { const next = (acc ? `${acc} ` : '') + sn.trim(); if (next.length > max) break; acc = next; }
  if (acc.length >= 20) return acc;
  const words = t.slice(0, max + 1).split(' ');
  if (words.length > 1) words.pop();               // the last word may be cut by the slice
  const cut = tidyEnd(words.join(' '));
  return cut || t.slice(0, max);
}
/** `<repo name> — <short tagline>` (or the authored title when it already fits), ≤ 70 chars, word-boundary cut. */
export function fitTitle(repoName, tagline, authored, max = 70) {
  const a = authored && String(authored).replace(/\s+/g, ' ').trim();
  if (a && a.length <= max && !/(?:…|\.{3})$/.test(a)) return a;
  const name = String(repoName).replace(/\s+/g, ' ').trim();
  const head = `${name} — `;
  if (head.length + 12 > max) return fitText(name, max);
  let tag = fitText(tagline, max - head.length).replace(/[.]$/, '');
  return `${head}${tag}`;
}

// ── mobile-first page CSS, appended AFTER the design system + theme ──────────────────────────────
// Facts text takes an ink derived from the theme's real background (≥ 4.5:1), never a 60%-opacity mono.
const ctrOn = (ink, bg) => contrast(parseColor(ink), bg);
export function factsInk(bgValue, candidates) {
  const bg = parseColor(bgValue);
  if (!bg) return candidates[0];
  const ok = candidates.find((c) => parseColor(c) && ctrOn(c, bg) >= AA_CONTRAST);
  return ok || bestOnAccent([bg]).color;
}
function pageCss(factsColor) {
  return `
/* ── page layer: mobile-first (appended by assemble-page) ── */
html { overflow-x: clip; }
img, svg, video { max-width: 100%; }
.meta-row, .meta-row span, .dl-cta .dl-meta, .attrib-lede .attrib-handle { color: ${factsColor}; opacity: 1; font-size: max(13px, var(--step--2, 13px)); }
.meta-row b { color: var(--accent-2); }
.cmd-block { position: relative; margin: 14px 0; max-width: 100%; min-width: 0; }
.cmd-block pre.code-block { margin: 0; max-width: 100%; padding-right: 92px; }
.cmd-block .cmd-note { margin: 0 0 6px; font-size: 13px; color: ${factsColor}; }
.copy-btn { position: absolute; top: 6px; right: 6px; min-width: 44px; min-height: 44px; padding: 0 12px; border-radius: 10px;
  border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--ink); font: 600 13px var(--mono); cursor: pointer; }
.copy-btn:hover, .copy-btn:focus-visible { border-color: var(--accent); }
.hero-refusal .rf-m { display: none; }
.gallery .grid > .case.has-code { grid-column: 1 / -1; }
.steps.has-code { grid-template-columns: 1fr; }
@media (max-width: ${PHONE_MAX}px) { .hero-refusal .rf-d { display: none; } .hero-refusal .rf-m { display: block; } }
@media print{.site-head,video,.cta-row,.dl-cta,.dropzone{display:none!important}details.section>summary .chev{display:none}details.section{break-inside:avoid-page}body{background:#fff!important}}
`;
}

// A code sample becomes ONE command per full-width block (comment lines ride along, never copied).
export function commandBlocks(code) {
  const lines = String(code).replace(/\r/g, '').split('\n');
  const cmds = [];
  let notes = [], cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (cur) { cur.cmd += `\n${line}`; if (!/\\$/.test(line)) { cmds.push(cur); cur = null; } continue; }
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) { notes.push(line.replace(/^\s*#\s?/, '')); continue; }
    cur = { cmd: line, notes }; notes = [];
    if (!/\\$/.test(line)) { cmds.push(cur); cur = null; }
  }
  if (cur) cmds.push(cur);
  return cmds.map((c) => `<div class="cmd-block">${c.notes.length ? `<p class="cmd-note">${esc(c.notes.join(' '))}</p>` : ''}<pre class="code-block"><code>${esc(c.cmd)}</code></pre><button type="button" class="copy-btn" data-copy="${esc(c.cmd)}" aria-label="Copy command" hidden>Copy</button></div>`).join('\n          ');
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
export const PHONE_MAX = 640;
const FIGURE_SIZES = `(max-width: ${PHONE_MAX}px) calc(100vw - 32px), 720px`;
const HERO_SIZES = `(max-width: ${PHONE_MAX}px) calc(100vw - 32px), 560px`;
/** Which file the lightbox shows: the phone twin when the phone query matches and a twin exists. */
export function pickLightboxSrc(phoneMatches, srcMobile, src) { return (phoneMatches && srcMobile) || src; }

function figureHtml(base, alt, caption, opts = {}) {
  const cls = opts.diagram ? (opts.concept ? 'figure diagram concept' : 'figure diagram') : 'figure';
  const tier = opts.tier ? `\n        <span class="tier ${opts.tier.cls}">${esc(opts.tier.label)}</span>` : '';
  const cap = caption ? `\n        <figcaption>${inline(caption)}</figcaption>` : '';
  // Every figure image is click-to-enlarge (rasters included); the build-time guard below enforces it.
  // A phone twin (opts.mobile) swaps in under 640px, both in the page and in the enlarged view.
  const m = opts.mobile ? ` data-src-m="assets/${esc(opts.mobile)}"` : '';
  // A raster with responsive variants is a <picture> (AVIF + JPEG, explicit width/height, lazy); the full-size original stays the lightbox target.
  const tag = opts.variants ? pictureHtml(opts.variants, { alt, sizes: FIGURE_SIZES, esc }) : `<img src="assets/${esc(base)}" alt="${esc(alt)}" loading="lazy">`;
  const pic = opts.mobile ? `<picture><source media="(max-width: ${PHONE_MAX}px)" srcset="assets/${esc(opts.mobile)}">${tag}</picture>` : tag;
  const img = `<button type="button" class="diagram-zoom" data-src="assets/${esc(base)}"${m} data-alt="${esc(alt)}" aria-label="Enlarge: ${esc(alt)}">${pic}</button>`;
  return `\n      <figure class="${cls}">${tier}\n        ${img}${cap}\n      </figure>`;
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
async function main() {
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
  // Credit the person when clone-repo resolved a real name; orgs and unnamed profiles fall back to the handle.
  const author = repo.author || null;
  const authorCredit = author?.name && author.type !== 'Organization'
    ? `${esc(author.name)} <span class="attrib-handle">(${esc(owner)})</span>`
    : esc(owner);

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
  const dsDefault = (k) => (dsCss.match(new RegExp(`--${k}:\\s*([^;]+);`)) || [])[1];
  const themed = (k) => (theme.css.match(new RegExp(`--${k}:\\s*([^;]+);`)) || [])[1] || dsDefault(k);
  const factsColor = factsInk(themed('bg'), [themed('muted') || '#8e93ad', themed('ink-2') || '#c4c8de', themed('ink') || '#eef0fb']);
  fs.writeFileSync(path.join(siteDir, 'styles.css'), `${dsCss}\n\n${theme.css}\n${pageCss(factsColor)}`);

  // --- copy mandatory visual assets (fail loud). Generated explainers always carry meaningful
  // raster imagery. Previously the renderer treated every raster as optional, so a skipped image
  // station or a missing file still produced a polished page with no visible images. That is a
  // silent partial build. The image generator already fails loudly; assembly must enforce its output.
  const heroVisual = reqObj(visuals.hero, 'visuals.hero (MANDATORY generated image)');
  // hero.rasterSkipped === 'scene': a valid animated hero scene IS the hero (no raster is shown; the static backdrop only feeds the favicon/social card).
  const heroIsScene = heroVisual.rasterSkipped === 'scene';
  const heroFile = heroIsScene ? null : copyAsset(reqStr(heroVisual.file, 'visuals.hero.file'), buildDir, siteAssets, 'hero image');
  // Responsive AVIF/JPEG variants for every raster that is shown. A failure degrades to the plain <img>, never to a broken page.
  const variantsOf = async (file, what) => {
    try { return await makeVariants(path.join(siteAssets, file), siteAssets); }
    catch (e) { process.stderr.write(`assemble-page: no responsive variants for ${what} (${e?.message || e}) — serving the original\n`); return null; }
  };
  const heroVariants = heroFile ? await variantsOf(heroFile, 'hero') : null;
  const heroAlt = visuals.hero?.altText || visuals.hero?.alt || `${repoName}: ${concept.heroConcept || concept.metaphor}`;

  const arch = reqObj(visuals.architectureDiagram, 'visuals.architectureDiagram (MANDATORY)');
  const twin = (d, what) => (d && d.mobileSvgPath) ? copyAsset(d.mobileSvgPath, buildDir, siteAssets, `${what} (phone twin)`) : null;
  const archFile = copyAsset(reqStr(arch.svgPath, 'visuals.architectureDiagram.svgPath'), buildDir, siteAssets, 'architecture diagram');
  const archM = twin(arch, 'architecture diagram');
  const archAlt = reqStr(arch.altText, 'visuals.architectureDiagram.altText');

  // flow diagram is OPTIONAL — a pure library repo (no runtime entrypoints) has no flow; make-diagrams skips it there
  const flow = (visuals.flowDiagram && typeof visuals.flowDiagram === 'object') ? visuals.flowDiagram : null;
  const flowFile = (flow && flow.svgPath) ? copyAsset(reqStr(flow.svgPath, 'visuals.flowDiagram.svgPath'), buildDir, siteAssets, 'flow diagram') : null;
  const flowAlt = flow ? (flow.altText || '') : '';
  const flowM = flowFile ? twin(flow, 'flow diagram') : null;

  // optional ladder rungs — rendered only when present (no silent placeholder; broken file = loud)
  const optDiagram = (d) => (d && d.svgPath) ? { file: copyAsset(d.svgPath, buildDir, siteAssets, 'diagram'), alt: d.altText || '', mobile: twin(d, 'diagram') } : null;
  const bigIdea = optDiagram(visuals.bigIdeaDiagram);
  const insightDia = optDiagram(visuals.insightDiagram);
  const rungs = reqArr(visuals.sections, 'visuals.sections (at least one generated section image is MANDATORY)');
  for (const [i, rung] of rungs.entries()) {
    reqObj(rung, `visuals.sections[${i}]`);
    copyAsset(reqStr(rung.file, `visuals.sections[${i}].file`), buildDir, siteAssets, `section image ${i + 1}`);
  }
  const findRung = (re) => rungs.find((r) => re.test(String(r.id || '')) || re.test(String(r.role || '')));
  const problemRung = findRung(/problem/i);
  const useCaseRung = findRung(/use.?case|scenario/i);
  if (!problemRung && !useCaseRung) throw new Error('visuals.sections must include a visible problem or use-case generated image; arbitrary generated files do not satisfy the page image contract');
  const problemImg = problemRung?.file ? { file: copyAsset(problemRung.file, buildDir, siteAssets, 'problem illustration'), alt: problemRung.alt || problemRung.altText || `${repoName}: the problem` } : null;
  const useCaseImg = useCaseRung?.file ? { file: copyAsset(useCaseRung.file, buildDir, siteAssets, 'use-case scenario'), alt: useCaseRung.alt || useCaseRung.altText || `${repoName} in use` } : null;
  if (problemImg) problemImg.variants = await variantsOf(problemImg.file, 'problem illustration');
  if (useCaseImg) useCaseImg.variants = await variantsOf(useCaseImg.file, 'use-case scenario');

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
  const seoTitle = fitTitle(repoName, tagline, content.meta?.title);
  const seoDesc = fitText(content.meta?.description || tagline, 200);
  const shareDesc = fitText(tagline, 200);
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
  <meta property="og:description" content="${esc(shareDesc)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(cardUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(seoTitle)}">
  <meta name="twitter:description" content="${esc(shareDesc)}">
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
      <p class="prov-live"><span class="prov-dot" aria-hidden="true">&#9679;</span> source <a href="${esc(repoUrl)}" target="_blank" rel="noopener"><code>${esc(repoUrl.replace(/^https?:\/\//, ''))}</code></a></p>
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
  const headline = inline(reqStr(hero.headline, 'content.sections.hero.headline'));   // always escaped: no raw-HTML escape hatch

  // The hero animation is INLINED (not <img>) so it is crisp at any width and its <style> joins the page.
  let refusalHtml = '';
  let refusalRaw = '';
  const refusalAria = esc(visuals.heroAnim?.altText || 'The one idea, in motion');
  {
    const rp = visuals.heroAnim && visuals.heroAnim.svgPath;
    if (rp && fs.existsSync(rp)) {
      const readSvg = (f) => fs.readFileSync(f, 'utf8').replace(/<\?xml[^>]*\?>\s*/i, '');
      refusalRaw = readSvg(rp);
      const mp = visuals.heroAnim.mobileSvgPath;
      const phone = mp ? readSvg(must(path.isAbsolute(mp) ? mp : path.resolve(buildDir, mp), 'visuals.heroAnim.mobileSvgPath (phone twin)')) : '';
      const inner = phone ? `<div class="rf-d">${refusalRaw}</div><div class="rf-m" aria-hidden="true">${phone}</div>` : refusalRaw;
      if (refusalRaw) refusalHtml = `\n      <div class="hero-refusal" role="img" aria-label="${refusalAria}">${inner}</div>`;
    }
  }
  if (heroIsScene && !refusalHtml) throw new Error('visuals.hero.rasterSkipped is "scene" but visuals.heroAnim has no scene file on disk — refusing to ship a page with no hero');
  // ── OPTIONAL 3D HERO (visuals.hero3d): an ENHANCEMENT, never the page. The SVG scene / raster hero renders
  // first and stays in the DOM; the module paints over it only with WebGL, no reduced-motion request, and a
  // successful load. Any failure leaves the page exactly as it was.
  let hero3dHtml = '';
  if (visuals.hero3d && visuals.hero3d.module) {
    const src = path.isAbsolute(visuals.hero3d.module) ? visuals.hero3d.module : path.join(buildDir, visuals.hero3d.module);
    if (!fs.existsSync(src)) throw new Error(`visuals.hero3d.module not found: ${src} — author the scene before assembling, or drop the slot`);
    const modName = copyAsset(src, buildDir, siteAssets, '3D hero module');
    const label = esc(visuals.hero3d.altText || refusalAria);
    hero3dHtml = `
      <div class="hero-3d" data-hero-3d aria-hidden="true" style="position:absolute;inset:0;opacity:0;transition:opacity .9s ease;pointer-events:none"></div>
      <script type="module">
        (async () => {
          const host = document.querySelector('[data-hero-3d]');
          if (!host) return;
          if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          try {
            const probe = document.createElement('canvas');
            if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;   // no WebGL: keep the flat scene
            const scene = await import('./assets/${modName}');
            if (typeof scene.mount !== 'function') return;
            await scene.mount(host, { label: ${JSON.stringify(label)} });
            host.style.opacity = '1';
            // The flat scene stays in the DOM (fallback + screen readers) but stops drawing over the 3D one.
            const flat = host.parentElement && host.parentElement.querySelector('.hero-refusal');
            // A filled CSS animation beats an inline style: clear it and set opacity !important.
            if (flat) {
              flat.style.animation = 'none';
              flat.style.transition = 'opacity .9s ease';
              flat.style.setProperty('opacity', '0', 'important');
            }
          } catch (err) { /* blocked CDN, WebGL loss, scene throw — the page below is already correct */ }
        })();
      </script>`;
  }

  reqStr(hero.lede, 'content.sections.hero.lede');
  const ctas = Array.isArray(hero.ctas) && hero.ctas.length ? hero.ctas : [
    { label: 'See how it works →', href: '#how-it-works' },
    { label: 'View the source ↗', href: repoUrl, ghost: true },
  ];
  const ctaHtml = ctas.map((c) => {
    // only web, in-page, site-relative or mail links: a javascript:/data: href from the brain must never ship
    const href = SAFE_HREF.test(String(c.href || '').trim()) ? String(c.href).trim() : '#';
    const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
    return `<a class="cta${c.ghost ? ' ghost' : ''}" href="${esc(href)}"${ext}>${inline(c.label)}</a>`;
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
          <p class="attrib-lede">An <strong>independent explainer</strong> for <strong>${authorCredit}</strong>'s <a href="${esc(repoUrl)}" target="_blank" rel="noopener">${esc(repoName)}</a> — built to take you from "never seen it" to "ready to implement".</p>
          <div class="cta-row">
          ${ctaHtml}
          </div>${metaRow}
        </div>
        <figure class="hero-art">
          ${heroIsScene ? `<div class="hero-motion" style="position:relative">${refusalHtml}${hero3dHtml}</div>`
            : `<button type="button" class="diagram-zoom" data-src="assets/${esc(heroFile)}" data-alt="${esc(heroAlt)}" aria-label="Enlarge: ${esc(heroAlt)}">${heroVariants ? pictureHtml(heroVariants, { alt: heroAlt, sizes: HERO_SIZES, eager: true, esc }) : `<img src="assets/${esc(heroFile)}" alt="${esc(heroAlt)}">`}</button>`}
        </figure>
      </div>${!heroIsScene && refusalHtml ? `<div class="hero-motion" style="position:relative">${refusalHtml}${hero3dHtml}</div>` : (heroIsScene ? '' : hero3dHtml)}
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
    problemImg ? figureHtml(problemImg.file, problemImg.alt, problemRung?.caption, { variants: problemImg.variants, tier: { cls: 'friendly', label: 'The problem' } }) : '',
    noteHtml(problem.note),
  ].filter(Boolean).join('\n      ')));

  // 2 · what it is  (big-idea diagram)
  const whatItIs = reqObj(S.whatItIs, 'content.sections.whatItIs');
  reqStr(whatItIs.title, 'content.sections.whatItIs.title');
  out.push(sectionShell('whatItIs', '02', whatItIs, arcQ.whatItIs, [
    whatItIs.lead ? `<p class="lead-in">${inline(whatItIs.lead)}</p>` : '',
    paras(whatItIs.paragraphs),
    bigIdea ? figureHtml(bigIdea.file, bigIdea.alt || `${repoName}: the whole idea in one picture`, whatItIs.figureCaption, { diagram: true, concept: true, mobile: bigIdea.mobile, tier: { cls: 'tech', label: 'The big idea' } }) : '',
    tableHtml(whatItIs.table),
  ].filter(Boolean).join('\n      ')));

  // 3 · insight  (the "oh" + insight diagram)
  const insight = reqObj(S.insight, 'content.sections.insight');
  reqStr(insight.title, 'content.sections.insight.title');
  reqStr(insight.oh, 'content.sections.insight.oh');
  out.push(sectionShell('insight', '03', insight, arcQ.insight, [
    insight.lead ? `<p class="lead-in">${inline(insight.lead)}</p>` : '',
    paras(insight.paragraphs),
    insightDia ? figureHtml(insightDia.file, insightDia.alt || `${repoName}: the one clever move`, insight.figureCaption, { diagram: true, concept: true, mobile: insightDia.mobile, tier: { cls: 'tech', label: 'The aha' } }) : '',
    `<p class="oh">${inline(insight.oh)}</p>`,
  ].filter(Boolean).join('\n      ')));

  // 4 · how it works  (MANDATORY architecture + flow, side by side)
  const howItWorks = reqObj(S.howItWorks, 'content.sections.howItWorks');
  reqStr(howItWorks.title, 'content.sections.howItWorks.title');
  out.push(sectionShell('howItWorks', '04', howItWorks, arcQ.howItWorks, [
    howItWorks.lead ? `<p class="lead-in">${inline(howItWorks.lead)}</p>` : '',
    paras(howItWorks.paragraphs),
    flowFile
      ? `<div class="dual">${figureHtml(archFile, archAlt, 'Architecture — modules, components and how they depend on each other.', { diagram: true, mobile: archM, tier: { cls: 'tech', label: 'Architecture' } })}${figureHtml(flowFile, flowAlt, 'Data flow — how a request moves through the system at runtime.', { diagram: true, mobile: flowM, tier: { cls: 'tech', label: 'Data flow' } })}\n      </div>`
      : figureHtml(archFile, archAlt, 'Architecture — modules, components and how they depend on each other.', { diagram: true, mobile: archM, tier: { cls: 'tech', label: 'Architecture' } }),
  ].filter(Boolean).join('\n      ')));

  // 5 · use cases  (collapsible cases + scenario raster)
  const useCases = reqObj(S.useCases, 'content.sections.useCases');
  reqStr(useCases.title, 'content.sections.useCases.title');
  const cases = reqArr(useCases.cases, 'content.sections.useCases.cases');
  const casesHtml = cases.map((c, i) => {
    reqStr(c.title, `content.sections.useCases.cases[${i}].title`);
    const dl = Array.isArray(c.dl) && c.dl.length
      ? `\n          <dl>${c.dl.map((d) => `<dt>${esc(d.term)}</dt><dd>${inline(d.desc)}</dd>`).join('\n          ')}</dl>` : '';
    const code = c.code ? `\n          ${commandBlocks(c.code)}` : '';
    return `
      <details class="case${c.code ? ' has-code' : ''}" open>
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
    useCaseImg ? figureHtml(useCaseImg.file, useCaseImg.alt, useCaseRung?.caption, { variants: useCaseImg.variants, tier: { cls: 'friendly', label: 'In the real world' } }) : '',
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
    getStarted.install ? `<div class="install-block">${commandBlocks(getStarted.install)}</div>` : '',
    `<ol class="steps${steps.some((x) => /`/.test(typeof x === 'object' ? `${x.strong || ''}${x.text || ''}` : String(x))) ? ' has-code' : ''}">\n        ${stepsHtml}\n      </ol>`,
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

  // ── mandated ISOvision attribution + CTA footer (design-system §16b) ─────────────────────────────
  const footer = `
  <footer class="explainer-footer" role="contentinfo">
    <div class="wrap explainer-footer-inner">
      <p class="ef-credit">
        Explainer page created by <strong><a href="https://stuart-kerr-card.netlify.app" rel="author noopener" target="_blank">Stuart Kerr</a></strong> at
        <a href="https://isovision.ai" rel="noopener" target="_blank">ISOvision</a>
        <span class="ef-fine">Built with the open-source <a href="https://github.com/stuinfla/Repo-Explainer" rel="noopener" target="_blank">explainmyrepo</a> engine.
        Found this valuable? <a href="https://github.com/stuinfla/Repo-Explainer" rel="noopener" target="_blank">A star on GitHub</a> genuinely helps &mdash;
        and if something's off, <a href="https://github.com/stuinfla/Repo-Explainer/issues" rel="noopener" target="_blank">open an issue</a>: happy to help fix it.</span>
      </p>
      <a class="ef-cta" href="https://explainmyrepo.isovision.ai" target="_blank" rel="noopener">
        <span class="ef-cta-lead">Would you like your own repo explainer page?</span>
        <strong>Generate one here</strong>
        <span class="ef-arrow" aria-hidden="true">&rarr;</span>
      </a>
    </div>
  </footer>`;

  // ── assemble the single HTML document (rendered ONCE — INV-10) ───────────────────────────────
  let html = `<!DOCTYPE html>
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
  <dialog class="diagram-lightbox" id="diagram-lightbox" aria-label="Enlarged diagram">
    <button type="button" class="lightbox-close" data-close aria-label="Close">&times;</button>
    <img id="diagram-lightbox-img" src="" alt="">
  </dialog>
  <script>
  (function () {
    document.querySelectorAll('.copy-btn').forEach(function (b) {
      b.hidden = false;
      b.addEventListener('click', function () {
        var text = b.getAttribute('data-copy') || '';
        var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () {}); return; }
        var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(t);
      });
    });
  })();
  </script>
  <script>
  ${pickLightboxSrc.toString()}
  (function () {
    var dlg = document.getElementById('diagram-lightbox');
    if (!dlg || typeof dlg.showModal !== 'function') return;
    var img = document.getElementById('diagram-lightbox-img');
    document.querySelectorAll('.diagram-zoom').forEach(function (btn) {
      btn.addEventListener('click', function () {
        img.src = pickLightboxSrc(window.matchMedia('(max-width: ${PHONE_MAX}px)').matches, btn.getAttribute('data-src-m'), btn.getAttribute('data-src'));
        img.alt = btn.getAttribute('data-alt') || '';
        dlg.showModal();
      });
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close();
    });
  })();
  </script>
</body>
</html>
`;

  // ── guard: zero template tokens / dangling refs (CONTRACT (b)·6). <pre>/<code>/<style> are masked first:
  // code samples legitimately hold `${...}` / `{ ... }`, and CSS legitimately ends in `}}`.
  const scannable = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // A cell whose ENTIRE content is a bare value is API documentation (p-map's `signal` default), not a leak.
    .replace(/<(td|dd)\b[^>]*>\s*(undefined|NaN|null)\s*<\/\1>/gi, '<$1>—</$1>');
  // Case matters: a genuine sentinel SCREAMS (TODO, PLACEHOLDER, FIXME) or is exactly a leaked JS value, so
  // those match case-SENSITIVELY ("no placeholder" is prose). A leaked `undefined`/`NaN` ends a phrase; the
  // prose word is followed by another word, hence the negative lookahead. Only "lorem ipsum" is /i.
  const leakCase = /\{\{|\}\}|\$\{|\[object Object\]|(?:^|[\s">:])(?:undefined|NaN)(?!\s+[a-z])(?:[\s"<.,;)]|$)|\bTODO\b|\bPLACEHOLDER\b|\bFIXME\b/;
  const leakAny = /lorem ipsum/i;
  const leak = scannable.match(leakCase) || scannable.match(leakAny);
  if (leak) {
    // Show WHERE: the surrounding markup names the section immediately.
    const at = leak.index ?? scannable.indexOf(leak[0]);
    const ctx = scannable.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, ' ').trim();
    throw new Error(`unresolved token / placeholder leaked into the page: "${leak[0].trim()}"\n`
      + `  …${ctx}…`);
  }
  // Every figure image must sit inside the click-to-enlarge button.
  for (const fig of html.matchAll(/<figure[\s\S]*?<\/figure>/g)) {
    if (/<img\b/.test(fig[0]) && !fig[0].includes('class="diagram-zoom"')) {
      throw new Error(`figure image shipped without click-to-enlarge: ${fig[0].slice(0, 140)}…`);
    }
  }
  // A re-assemble (refine pass, resumed build) rebuilds the HTML from scratch: put the narrated overview back when
  // make-overview already produced it, or the video silently disappears from the shipped page.
  const ov = ctx.overview;
  if (ov?.path && !ov.skipped && fs.existsSync(path.join(siteDir, ov.path)) && fs.existsSync(path.join(siteDir, 'assets', 'overview-poster.jpg'))) {
    const infographicPath = ov.infographic?.path && fs.existsSync(path.join(siteDir, ov.infographic.path)) ? ov.infographic.path : null;
    html = injectOverview(html, { name: repoName, url: repoUrl, secs: Math.round(ov.durationSec || 0), infographicPath }).html;
  }
  for (const m of [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g), ...[...html.matchAll(/srcset="([^"]+)"/g)].flatMap((x) => x[1].split(',').map((c) => [null, c.trim().split(/\s+/)[0]]))]) {
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
      og: { title: seoTitle, description: shareDesc, image: cardUrl, url: canonical },
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

// Import-safe entrypoint: run main() ONLY when invoked as a script, so the pure theme helpers can
// be unit-tested. run-tool.mjs spawns `node <abs tool path> <build-dir>` (CONTRACT §b), so argv[1]
// is this file and the CLI behaviour is unchanged. realpath-compared to survive symlinked paths;
// if we cannot tell, we run — never silently skip the tool (INV-04).
const isEntrypoint = (() => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return true; }
})();
if (isEntrypoint) { main().catch((e) => fail(e.message || e)); }

export { buildTheme, contrast, parseColors };
