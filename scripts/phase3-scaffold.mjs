#!/usr/bin/env node
// phase3-scaffold.mjs -- Create explainer site directory structure from scratch.
// Runs in GitHub Actions after P2 produces kb-output/repo-analysis.json.
// Usage: node scripts/phase3-scaffold.mjs <repo-analysis.json> <output-dir>
// Zero npm dependencies -- uses only Node.js built-ins (fs, path).

import fs from 'node:fs';
import path from 'node:path';

const [analysisPath, outputDir] = process.argv.slice(2);
if (!analysisPath || !outputDir) {
  console.error('Usage: node scripts/phase3-scaffold.mjs <repo-analysis.json> <output-dir>');
  process.exit(1);
}
const absAnalysis = path.resolve(analysisPath);
const absOut = path.resolve(outputDir);
if (!fs.existsSync(absAnalysis)) {
  console.error(`Error: analysis file does not exist: ${absAnalysis}`);
  process.exit(1);
}

let analysis;
try { analysis = JSON.parse(fs.readFileSync(absAnalysis, 'utf8')); }
catch (err) { console.error(`Error: failed to parse JSON: ${err.message}`); process.exit(1); }

const repoName = analysis.name || 'project';
const repoDesc = analysis.description || 'A project explainer';
const safeName = repoName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
console.log(`Scaffolding explainer site for: ${repoName}\nOutput: ${absOut}`);

fs.mkdirSync(path.join(absOut, 'assets', 'img'), { recursive: true });

const sections = [
  { id: 'hero',            label: 'Hero' },
  { id: 'grounding',       label: 'What Is This Project?' },
  { id: 'problem',         label: 'The Problem' },
  { id: 'solution',        label: 'The Solution' },
  { id: 'how-it-works',    label: 'How It Works' },
  { id: 'use-cases',       label: 'Use Cases' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'gallery',         label: 'Gallery' },
  { id: 'provenance',      label: 'Provenance' },
];

// ── index.html ──────────────────────────────────────────────────────────────
const altSections = new Set(['problem', 'how-it-works', 'getting-started', 'gallery']);
const navLinks = sections.filter(s => s.id !== 'hero')
  .map(s => `        <a href="#${s.id}">${s.label}</a>`).join('\n');
const sectionBlocks = sections.map(s => {
  if (s.id === 'hero') return `  <section id="hero" class="hero" data-section="hero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <h1>${repoName}</h1>
      <p class="tagline">${repoDesc}</p>
      <div class="hero-actions">
        <a href="#getting-started" class="btn btn-primary">Get Started</a>
        <a href="#how-it-works" class="btn btn-secondary">Learn More</a>
      </div>
    </div>
  </section>`;
  const alt = altSections.has(s.id) ? ' section-alt' : '';
  // Gallery is populated by Phase 5 from generated images (no Phase 4 content).
  if (s.id === 'gallery') return `  <section id="gallery" class="section${alt}" data-section="gallery">
    <div class="wrap">
      <h2>${s.label}</h2>
      <div class="gallery-grid"><!-- IMG:gallery --></div>
    </div>
  </section>`;
  // Use cases: wrap the Phase 4 cards in a responsive grid container.
  if (s.id === 'use-cases') return `  <section id="use-cases" class="section${alt}" data-section="use-cases">
    <div class="wrap">
      <h2>${s.label}</h2>
      <div class="use-case-grid"><!-- CONTENT:use-cases --></div>
    </div>
  </section>`;
  // Heading first, then a single content marker Phase 4 replaces. No leftover
  // placeholder text, no duplicate headings.
  return `  <section id="${s.id}" class="section${alt}" data-section="${s.id}">
    <div class="wrap">
      <h2>${s.label}</h2>
      <!-- CONTENT:${s.id} -->
    </div>
  </section>`;
}).join('\n\n');

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${repoName} — Explainer</title>
  <meta name="description" content="${repoDesc}" />
  <meta name="color-scheme" content="light" />
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${repoName} — Explainer" />
  <meta property="og:description" content="${repoDesc}" />
  <meta property="og:image" content="assets/img/hero.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="assets/img/hero.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <nav class="site-nav" role="navigation" aria-label="Main">
    <div class="wrap nav-inner">
      <a href="#hero" class="nav-brand">${repoName}</a>
      <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-links">
${navLinks}
      </div>
    </div>
  </nav>

${sectionBlocks}

  <footer class="site-footer">
    <div class="wrap"><p>Built with care. View the source on GitHub.</p></div>
  </footer>
  <script src="main.js"></script>
</body>
</html>
`;

// ── styles.css ──────────────────────────────────────────────────────────────
const stylesCss = `/* Explainer Site — Warm Light Theme
   Inter body, Playfair Display headings, responsive single-page layout. */

:root {
  --bg: #ffffff; --bg-alt: #f7f5f2; --bg-warm: #faf8f5; --bg-hero: #1b1f2e;
  --ink: #1a1a2e; --ink-2: #3d3d56; --ink-muted: #6b6b80;
  --ink-faint: #9c9cb0; --ink-on-dark: #f0eee8;
  --accent: #3b4cc0; --accent-hover: #2d3da6;
  --accent-light: #e8ebf8; --accent-bg: rgba(59,76,192,0.06);
  --warm-100: #fdf6ee; --warm-200: #f5ead8; --warm-300: #e8d5b8;
  --card-bg: #ffffff; --card-border: #e8e4de;
  --card-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06);
  --card-shadow-lg: 0 4px 8px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.08);
  --code-bg: #f5f3ef; --code-border: #e2ddd5; --code-text: #2d2d44;
  --radius: 8px; --radius-lg: 12px; --max-w: 1120px; --nav-h: 64px;
  --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-display: "Playfair Display", Georgia, "Times New Roman", serif;
  --font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
  --sp-1: 0.25rem; --sp-2: 0.5rem; --sp-3: 0.75rem; --sp-4: 1rem;
  --sp-6: 1.5rem; --sp-8: 2rem; --sp-12: 3rem;
  --sp-16: 4rem; --sp-20: 5rem; --sp-24: 6rem;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; scroll-padding-top: calc(var(--nav-h) + var(--sp-4)); }
body {
  font-family: var(--font-body); font-size: 1rem; line-height: 1.7;
  color: var(--ink); background: var(--bg);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
img { max-width: 100%; height: auto; display: block; }
a { color: var(--accent); text-decoration: none; transition: color 0.2s; }
a:hover { color: var(--accent-hover); }

.wrap { max-width: var(--max-w); margin: 0 auto; padding: 0 var(--sp-6); }
@media (min-width: 768px) { .wrap { padding: 0 var(--sp-8); } }

h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 700; line-height: 1.2; color: var(--ink); }
h1 { font-size: clamp(2.25rem, 5vw, 3.5rem); letter-spacing: -0.02em; }
h2 { font-size: clamp(1.75rem, 3.5vw, 2.5rem); letter-spacing: -0.01em; margin-bottom: var(--sp-4); }
h3 { font-size: clamp(1.25rem, 2.5vw, 1.5rem); font-weight: 600; margin-bottom: var(--sp-3); }
p { margin-bottom: var(--sp-4); }
.tagline { font-size: clamp(1.125rem, 2vw, 1.375rem); line-height: 1.6; max-width: 640px; }

/* Navigation */
.site-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  height: var(--nav-h); background: rgba(255,255,255,0.92);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--card-border); transition: box-shadow 0.3s;
}
.site-nav.scrolled { box-shadow: 0 1px 8px rgba(0,0,0,0.06); }
.nav-inner { display: flex; align-items: center; justify-content: space-between; height: 100%; }
.nav-brand { font-family: var(--font-display); font-size: 1.25rem; font-weight: 700; color: var(--ink); }
.nav-brand:hover { color: var(--accent); }
.nav-links { display: flex; gap: var(--sp-6); align-items: center; }
.nav-links a {
  font-size: 0.875rem; font-weight: 500; color: var(--ink-2);
  padding: var(--sp-2) 0; border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}
.nav-links a:hover, .nav-links a.active { color: var(--accent); border-bottom-color: var(--accent); }
.nav-toggle {
  display: none; flex-direction: column; gap: 5px;
  background: none; border: none; cursor: pointer; padding: var(--sp-2);
}
.nav-toggle span { display: block; width: 22px; height: 2px; background: var(--ink); border-radius: 2px; transition: transform 0.3s, opacity 0.3s; }

@media (max-width: 767px) {
  .nav-toggle { display: flex; }
  .nav-links {
    position: fixed; top: var(--nav-h); left: 0; right: 0;
    flex-direction: column; background: rgba(255,255,255,0.98);
    backdrop-filter: blur(12px); padding: var(--sp-4) var(--sp-6); gap: 0;
    border-bottom: 1px solid var(--card-border);
    transform: translateY(-100%); opacity: 0; pointer-events: none;
    transition: transform 0.3s, opacity 0.3s;
  }
  .nav-links.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
  .nav-links a { padding: var(--sp-3) 0; font-size: 1rem; border-bottom: 1px solid var(--card-border); width: 100%; }
  .nav-links a:last-child { border-bottom: none; }
}

/* Hero */
.hero {
  position: relative; padding: calc(var(--nav-h) + var(--sp-16)) 0 var(--sp-20);
  background: var(--bg-hero); color: var(--ink-on-dark);
  overflow: hidden; min-height: 480px; display: flex; align-items: center;
}
.hero-bg {
  position: absolute; inset: 0; z-index: 0;
  background-image: url('assets/img/hero.png');
  background-size: cover; background-position: center; opacity: 0.4;
}
/* Scrim over the hero image so headline text is always legible. */
.hero::after {
  content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg, rgba(27,31,46,0.35) 0%, rgba(27,31,46,0.78) 100%);
}
.hero-inner { position: relative; z-index: 2; }
.hero h1 { color: var(--ink-on-dark); margin-bottom: var(--sp-4); }
.hero .tagline { color: rgba(240,238,232,0.85); margin-bottom: var(--sp-8); }
.hero-actions { display: flex; gap: var(--sp-4); flex-wrap: wrap; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-6); font-family: var(--font-body);
  font-size: 0.9375rem; font-weight: 600; border-radius: var(--radius);
  border: 2px solid transparent; cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
}
.btn:active { transform: translateY(1px); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
.btn-secondary { background: transparent; color: var(--ink-on-dark); border-color: rgba(240,238,232,0.4); }
.btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: rgba(240,238,232,0.7); color: #fff; }

/* Sections */
.section { padding: var(--sp-20) 0; }
.section-alt { background: var(--bg-alt); }

/* Cards */
.card {
  background: var(--card-bg); border: 1px solid var(--card-border);
  border-radius: var(--radius-lg); padding: var(--sp-8);
  box-shadow: var(--card-shadow); transition: box-shadow 0.3s, transform 0.3s;
}
.card:hover { box-shadow: var(--card-shadow-lg); transform: translateY(-2px); }
.card h3 { color: var(--ink); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--sp-6); margin-top: var(--sp-8); }
@media (max-width: 640px) { .card-grid { grid-template-columns: 1fr; } .card { padding: var(--sp-6); } }

/* Code blocks */
pre {
  background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: var(--radius); padding: var(--sp-4) var(--sp-6);
  overflow-x: auto; font-family: var(--font-mono); font-size: 0.875rem;
  line-height: 1.6; color: var(--code-text); margin-bottom: var(--sp-6);
  position: relative;
}
code { font-family: var(--font-mono); font-size: 0.875em; }
p code, li code {
  background: var(--code-bg); border: 1px solid var(--code-border);
  padding: 0.125em 0.375em; border-radius: 4px; font-size: 0.85em; color: var(--code-text);
}
.copy-btn {
  position: absolute; top: var(--sp-2); right: var(--sp-2);
  background: var(--bg); border: 1px solid var(--card-border); border-radius: 6px;
  padding: var(--sp-1) var(--sp-3); font-family: var(--font-body); font-size: 0.75rem;
  color: var(--ink-muted); cursor: pointer; opacity: 0; transition: opacity 0.2s, background 0.2s;
}
pre:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: var(--bg-alt); color: var(--ink); }
.copy-btn.copied { color: #2e7d32; }

/* Gallery */
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--sp-6); margin-top: var(--sp-8); }
.gallery-item {
  border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--card-border);
  background: var(--card-bg); box-shadow: var(--card-shadow); transition: box-shadow 0.3s, transform 0.3s;
}
.gallery-item:hover { box-shadow: var(--card-shadow-lg); transform: translateY(-2px); }
.gallery-item img { width: 100%; aspect-ratio: 16/10; object-fit: cover; }
.gallery-item figcaption { padding: var(--sp-3) var(--sp-4); font-size: 0.875rem; color: var(--ink-2); }

/* Use-case cards (Phase 4 emits a series of .use-case-card blocks) */
.use-case-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--sp-6); margin-top: var(--sp-8); }
.use-case-card {
  background: var(--card-bg); border: 1px solid var(--card-border);
  border-radius: var(--radius-lg); padding: var(--sp-6);
  box-shadow: var(--card-shadow); transition: box-shadow 0.3s, transform 0.3s;
}
.use-case-card:hover { box-shadow: var(--card-shadow-lg); transform: translateY(-2px); }
.use-case-card h3 { color: var(--ink); margin-bottom: var(--sp-3); }
.use-case-card p { margin-bottom: var(--sp-3); }
.use-case-card .audience { margin-bottom: 0; font-size: 0.875rem; color: var(--ink-muted); }
.use-case-card .audience strong { color: var(--accent); }
@media (max-width: 640px) { .use-case-grid { grid-template-columns: 1fr; } }

/* Graceful fallback when a section's content could not be generated */
.content-error { color: var(--ink-muted); font-style: italic; }

ul, ol { padding-left: var(--sp-6); margin-bottom: var(--sp-4); }
li { margin-bottom: var(--sp-2); }

/* Fade-in animation */
.fade-in { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease-out, transform 0.6s ease-out; }
.fade-in.visible { opacity: 1; transform: translateY(0); }

/* Footer */
.site-footer { padding: var(--sp-12) 0; background: var(--bg-hero); color: var(--ink-on-dark); text-align: center; }
.site-footer p { color: rgba(240,238,232,0.65); font-size: 0.875rem; }
.site-footer a { color: var(--ink-on-dark); }
.site-footer a:hover { color: #fff; }

/* Utility */
.text-center { text-align: center; }
.text-muted { color: var(--ink-muted); }
.mt-4 { margin-top: var(--sp-4); }
.mt-8 { margin-top: var(--sp-8); }
.mb-4 { margin-bottom: var(--sp-4); }
.mb-8 { margin-bottom: var(--sp-8); }

@media print {
  .site-nav, .nav-toggle, .copy-btn { display: none !important; }
  .hero { padding-top: var(--sp-8); min-height: auto; }
  .section { padding: var(--sp-8) 0; }
  body { font-size: 11pt; }
}
`;

// ── main.js ─────────────────────────────────────────────────────────────────
const mainJs = `/* Explainer Site — main.js
   Smooth scroll, nav highlights, copy buttons, fade-in animations.
   Page works with JS disabled. No dependencies. */
(function () {
  "use strict";

  /* 1. Smooth scroll for anchor links */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      var id = link.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", "#" + id);
      }
      var nl = document.querySelector(".nav-links");
      var tg = document.querySelector(".nav-toggle");
      if (nl && nl.classList.contains("open")) {
        nl.classList.remove("open");
        if (tg) tg.setAttribute("aria-expanded", "false");
      }
    });
  });

  /* 2. Active nav highlighting on scroll */
  var navAnchors = document.querySelectorAll(".nav-links a[href^=\\"#\\"]");
  var sectionEls = [];
  navAnchors.forEach(function (a) {
    var el = document.getElementById(a.getAttribute("href").slice(1));
    if (el) sectionEls.push({ el: el, link: a });
  });

  function updateActiveNav() {
    var scrollY = window.scrollY + 120, current = null;
    for (var i = 0; i < sectionEls.length; i++) {
      if (sectionEls[i].el.offsetTop <= scrollY) current = sectionEls[i];
    }
    navAnchors.forEach(function (a) { a.classList.remove("active"); });
    if (current) current.link.classList.add("active");
  }

  var nav = document.querySelector(".site-nav");
  function updateNavShadow() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 10);
  }

  window.addEventListener("scroll", function () {
    updateActiveNav(); updateNavShadow();
  }, { passive: true });
  updateActiveNav(); updateNavShadow();

  /* 3. Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var navLinks = document.querySelector(".nav-links");
  if (toggle && navLinks) {
    toggle.addEventListener("click", function () {
      toggle.setAttribute("aria-expanded", String(navLinks.classList.toggle("open")));
    });
  }

  /* 4. Copy-to-clipboard for code blocks */
  document.querySelectorAll("pre").forEach(function (pre) {
    var btn = document.createElement("button");
    btn.className = "copy-btn"; btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    pre.style.position = "relative"; pre.appendChild(btn);
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code");
      var text = (code || pre).textContent.replace(/Copy$/, "").trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!"; btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
        });
      }
    });
  });

  /* 5. Intersection Observer for fade-in animations */
  var fadeEls = document.querySelectorAll(".section > .wrap");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    fadeEls.forEach(function (el) { el.classList.add("fade-in"); observer.observe(el); });
  }
})();
`;

// ── Static files ────────────────────────────────────────────────────────────
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Code explainer icon">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#3b4cc0"/><stop offset="100%" stop-color="#6366f1"/>
  </linearGradient></defs>
  <rect width="32" height="32" rx="7" fill="url(#g)"/>
  <path d="M12 10L7 16l5 6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 10l5 6-5 6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="17.5" y1="9" x2="14.5" y2="23" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity="0.7"/>
</svg>
`;

const robotsTxt = `User-agent: *\nAllow: /\n`;

const vercelJson = JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  cleanUrls: true, trailingSlash: false,
  headers: [
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/(.*)\\.svg', headers: [{ key: 'Content-Type', value: 'image/svg+xml' }, { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/(.*)\\.css', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    { source: '/(.*)\\.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
  ],
}, null, 2) + '\n';

const packageJson = JSON.stringify({
  name: safeName, version: '0.1.0', private: true,
  description: repoDesc, scripts: {},
}, null, 2) + '\n';

// ── Write all files ─────────────────────────────────────────────────────────
const files = [
  ['index.html', indexHtml], ['styles.css', stylesCss], ['main.js', mainJs],
  ['favicon.svg', faviconSvg], ['robots.txt', robotsTxt],
  ['vercel.json', vercelJson], ['package.json', packageJson],
];

for (const [name, content] of files) {
  fs.writeFileSync(path.join(absOut, name), content);
  console.log(`  wrote ${name} (${content.length} bytes)`);
}

console.log(`  created assets/img/`);
console.log(`\nScaffold complete: ${absOut}`);
console.log(`  ${files.length} files + 1 directory`);
console.log(`  Repo: ${repoName}`);
console.log(`  Next: P4 fills <!-- CONTENT:* --> markers in index.html`);
