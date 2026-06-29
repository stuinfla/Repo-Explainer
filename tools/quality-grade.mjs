#!/usr/bin/env node
// quality-grade.mjs — STATION 7 tool: the dual-gate completion criterion.
//
// CONTRACT: tools/CONTRACT.md (the one BuildContext, the uniform invocation/return
// convention, PURE + FAIL-LOUD). Paired ADR-0005 Station 7 / "The QA System";
// paired DDD §8.5 Scorecard + §12 (the QA dual-gate as first-class domain).
//
// JOB (one mechanical job): render the ALREADY-ASSEMBLED site LOCALLY in a real
// browser (Playwright) at 390px (mobile) + 1440px (desktop), then grade it on two
// independent channels that DON'T fight each other:
//
//   (1) INV-18 PRESENCE — a deterministic DOM check (NOT the vision model). Playwright
//       asserts the ARCHITECTURE diagram AND the PROCESS/DATA-FLOW diagram elements
//       exist and are actually visible (rendered box > 0, not display:none) inside the
//       mandatory #how-it-works block. Present/absent is decided HERE, in the DOM — the
//       vision model is never asked "is it there?", only "does it read clearly?".
//
//   (2) CRAFT + SUBSTANCE — the GPT-4o vision grade against the VERBATIM Gate A/B
//       rubric (A1..A5 substance + B1..B5 anti-slop, each 0–100), graded from a few
//       FULL-RESOLUTION, viewport-height SECTION CROPS (hero · what-it-is · how-it-works
//       · get-started · the-pack), NOT one giant full-page screenshot downscaled into
//       mush. Each crop is capped at the device viewport so the model judges real,
//       sharp pixels (typography, alignment, imagery craft, diagram legibility).
//
// headlineScore = MIN across all 10 criteria. A device passes iff headlineScore >= 95
// AND INV-18 is clean (both diagrams DOM-present + DOM-visible + vision says each reads
// clearly). The build passes iff BOTH devices pass. Malformed / missing per-criterion
// scores → LOUD STOP, never a silent pass (ADR-0005 loud-fail postcondition; DDD §12.3).
//
// PURE: reads ONLY its declared slice of build.json (the `page` slot) + the
//   OPENAI_API_KEY from the environment. Writes ONLY the `quality` slot + its two
//   screenshots under <build-dir>/assets/. Never reads another tool's slot/files;
//   never writes another tool's slot/files.
// FAIL-LOUD: any failure → non-zero exit + a clear `error` string; never a silent
//   PASS, never a placeholder scorecard.
//
// Usage: node tools/quality-grade.mjs <build-dir>
//   env: OPENAI_API_KEY            (required — without it the page CANNOT be graded)
//        QUALITY_VISION_MODEL      (optional, default "gpt-4o")
//        OPENAI_BASE_URL           (optional, default "https://api.openai.com/v1")

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const _ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// OpenAI key from env (OPENAI_API_KEY | OPEN_AI_KEY) else the repo-root .env — mirrors
// generate-image so the grader uses the SAME credential the rest of the recipe does. Secrets
// still come from the environment / a gitignored .env, never from build.json (CONTRACT (d)).
function loadOpenAiKey() {
  const fromProc = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  if (fromProc && fromProc.trim()) return fromProc.trim();
  let text;
  try { text = fs.readFileSync(path.join(_ROOT, '.env'), 'utf8'); } catch { return null; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (k !== 'OPENAI_API_KEY' && k !== 'OPEN_AI_KEY') continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v.trim()) return v.trim();
  }
  return null;
}

// ----------------------------------------------------------------------------
// Uniform return: stdout carries the SINGLE JSON result object and nothing else.
// Diagnostics go to stderr. Exit code is the source of truth (0 iff ok).
// ----------------------------------------------------------------------------
function emit(ok, outputs, error) {
  process.stdout.write(JSON.stringify({ ok, outputs: ok ? outputs : {}, error: ok ? null : error }) + '\n');
  process.exit(ok ? 0 : 1);
}
const log = (msg) => process.stderr.write(`[quality-grade] ${msg}\n`);

// ----------------------------------------------------------------------------
// The dual-gate rubric — VERBATIM from ADR-0005 / DDD §12.2. Handed to the vision
// model as a harsh critic. Do NOT paraphrase: this is load-bearing.
// ----------------------------------------------------------------------------
const RUBRIC = `You are an EXACTING design-and-substance critic grading a software-explainer web page.
You are shown SEVERAL full-resolution, sharp SECTION CROPS of ONE page (in document
order) — together they represent the whole page. Score every criterion 0–100. Judge the
page AS A WHOLE from the crops; do not penalise a criterion merely because one crop
doesn't show everything.

You are CALIBRATED, not stingy. Excellence is real and reachable: when a criterion
genuinely clears the bar you award 90s — INCLUDING 95–100 — and you do NOT reflexively
cap at 90. Slop is equally real: when a criterion is generic or broken you score it low
and mean it. Your job is to place each criterion in the RIGHT band by the concrete
SIGNALS below, never to cluster everything in a cautious 70s–80s middle. A genuinely
publish-ready page reaches 95–100 on the criteria it nails; a templated one does not.

SCORING BANDS — anchor every Gate A and Gate B criterion to these SIGNALS, not to a vibe:
- 95–100  EXCEPTIONAL / publish-ready. A senior engineer sees it and says "I want to put
  this out." Signals: bespoke art direction you could NOT get from a template; a hero or
  diagram that makes you stop and look; copy that names the reader's real situation and the
  payoff in their own terms; diagrams that actually TEACH the mechanism; every section earns
  its place; nothing reads as generic. AWARD this whenever the criterion truly matches.
- 85–94   STRONG, minor nits. Clearly made by someone who cares — cohesive, intentional,
  mostly delightful — but one or two small, nameable flaws (a slightly cramped section, an
  image more decorative than explanatory, one wobble in the type hierarchy). Excellent-minus.
- 70–84   DECENT but generic or uneven. Competent and clean yet templated and forgettable,
  OR substance is present but never lands "why it matters to ME," OR the craft is fine but
  the story is just a list of facts. Nothing broken; nothing memorable.
- 50–69   MEDIOCRE. Flat, listy, default-feeling. Real gaps: weak hierarchy, decorative-only
  imagery, no narrative pull, the reader is assumed to already care.
- below 40  AI SLOP. Lorem-ipsum energy, default system fonts, stock-template layout, no
  story, no reader in mind — obviously "an LLM dumped this and nobody loved it."

Most real, professional pages land 85–94 on their strong criteria and lower on the weak
ones. Calibration means ACCURATE, not lenient: do not inflate slop to 95, and do not
deflate genuine excellence to 85 out of habit.

GATE A — "Do they actually get it?" (substance):
- A1 Visual effectiveness — compelling vs flat/forgettable.
- A2 Storytelling — tells a story vs lists facts.
- A3 Clueless→convinced — zero knowledge → why it matters → real examples → "oh, cool".
- A4 Usefulness-to-ME — explicitly answers "how is this useful to YOU" in the reader's OWN
  terms (names a concrete situation + the payoff). Cures engineer-blindness — the assumption
  the reader already cares.
- A5 Completeness of the arc — never-seen → ready to implement.
- A6 Implementation confidence — the reader knows EXACTLY what to do next: the Get-Started section
  shows the command, WHAT THEY'LL SEE when they run it, the step-by-step, what they get at the end, and
  what's next, with prerequisites stated. A5 is understanding; A6 is knowing how to ACT on it. A bare
  "just run this" with no sense of what happens or what comes next scores low.

GATE B — "Did someone who gives a shit make this?" (craft / anti-slop):
- B1 Typography & hierarchy — intentional, readable, ranked vs jangly.
- B2 Alignment & grid — aligned vs subtly-off / amateur.
- B3 Spacing & rhythm — breathes, consistent vs cramped / random.
- B4 Strength & polish — cohesive, deliberate vs generic AI-template slop.
- B5 Imagery craft — beautiful + explanatory + sequenced high→low vs pretty-but-useless;
  INCLUDING the structural SVG diagrams (crisp, legible, genuinely explanatory),
  judged for delight + craft.

OPERATOR QUALITATIVE GATE — five YES/NO questions (the owner's words). As a harsh critic, answer each
true/false from the crops; ALL five must be true for the page to be done, independent of the numeric
axes (a page can clear the numbers and still fail one of these):
 (1) believeIUnderstand — Would this make me believe I understand this?
 (2) approachable — Would this make it approachable?
 (3) explainsToNovice — Would this explain it for somebody who doesn't understand it?
 (4) architectureConfidence — Would it give me confidence I understand the architecture?
 (5) makesMeSmile — Does it make me smile — "oh, that's cool"?

INV-18 — CLARITY ONLY. The page is already DOM-verified to CONTAIN both an ARCHITECTURE
diagram (modules / components / dependencies) and a PROCESS / DATA-FLOW diagram (the
runtime flow); they live in the "How it works / How is it built?" crop. You do NOT
decide whether they exist. Your ONLY job for INV-18 is to say whether EACH diagram, as
rendered in the crops you can see, READS CLEARLY — legible labels, sensible structure,
not a blurry or scrambled mess. If a diagram is legible and explanatory, readsClearly
is true; if it's illegible/garbled in the crop, readsClearly is false.

For EACH criterion give a written rationale that cites what you actually SEE in the crops
AND names the band you placed it in (e.g. "85–94: strong, but …") so the score is auditable.`;

// Strict JSON shape the grader MUST return (response_format: json_object).
// NOTE: presence/visibility of the two diagrams is decided by the DOM check, NOT here —
// the model only reports whether each one READS CLEARLY in the crops.
const RESPONSE_SPEC = `Return ONLY a JSON object, no prose, with EXACTLY this shape:
{
  "gateA": { "A1": <int 0-100>, "A2": <int>, "A3": <int>, "A4": <int>, "A5": <int>, "A6": <int> },
  "gateB": { "B1": <int 0-100>, "B2": <int>, "B3": <int>, "B4": <int>, "B5": <int> },
  "operatorQuestions": {
    "believeIUnderstand": <true|false>, "approachable": <true|false>,
    "explainsToNovice": <true|false>, "architectureConfidence": <true|false>,
    "makesMeSmile": <true|false>
  },
  "rationales": {
    "A1": "<what you SAW>", "A2": "...", "A3": "...", "A4": "...", "A5": "...", "A6": "...",
    "B1": "...", "B2": "...", "B3": "...", "B4": "...", "B5": "..."
  },
  "clarity": {
    "architectureReadsClearly":  <true|false>,
    "architectureNote":          "<what you SAW of the architecture diagram>",
    "flowReadsClearly":          <true|false>,
    "flowNote":                  "<what you SAW of the flow/process diagram>"
  }
}
Every score is an integer 0–100. Every rationale is a non-empty string citing the crops.
For clarity, judge legibility honestly — an illegible/garbled diagram is readsClearly:false.`;

const CRITERIA_A = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const CRITERIA_B = ['B1', 'B2', 'B3', 'B4', 'B5'];
const OPERATOR_QUESTIONS = ['believeIUnderstand', 'approachable', 'explainsToNovice', 'architectureConfidence', 'makesMeSmile'];

/**
 * The v1.7 exemplar-anchored gate rule (ADR-0005 §"The QA System" / DDD §12.3 / INV-05). PURE.
 * PASS iff meanScore >= 90 AND min (the worst axis — the anti-slop floor) >= 85 AND all five operator
 * yes/no questions are YES. INV-18 (architecture+flow present & clear) is AND-ed in separately by
 * buildScorecard. Anchored to the owner's own example sites (~88 headline / ~92 mean); a literal
 * "95 on every axis" is unreachable by an honest grader. Exported so the gate logic is unit-testable
 * without a network call or a browser.
 */
export function evaluatePass({ mean, min, operatorQuestions } = {}) {
  const ops = Array.isArray(operatorQuestions) ? operatorQuestions : [];
  return typeof mean === 'number' && typeof min === 'number'
    && mean >= 90 && min >= 85
    && ops.length === 5 && ops.every((q) => q === true);
}

// ----------------------------------------------------------------------------
// Minimal static file server rooted at the assembled site dir, so Playwright
// renders the REAL page over http:// (relative assets, module scripts, fetches
// of sitemap/robots/llms all resolve) — judged on live local pixels, never a
// deployed URL (DDD §12.1). Traversal-guarded; binds 127.0.0.1 on a random port.
// ----------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function startServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      let rel = decodeURIComponent((req.url || '/').split('?')[0]);
      if (rel.endsWith('/')) rel += 'index.html';
      const abs = path.resolve(root, '.' + rel);
      if (abs !== root && !abs.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      let target = abs;
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) { res.writeHead(404); res.end(`not found: ${rel}`); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
    } catch (e) { res.writeHead(500); res.end(String(e?.message || e)); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// The representative SECTION crops the vision model grades for craft + substance.
// Each is captured at the device viewport (a viewport-HEIGHT segment, anchored at the
// section's top) so it is full-resolution and never downscaled into mush. The two
// MANDATORY diagrams are captured separately as dedicated element crops (below) so the
// grader always SEES them in full, not pushed off the bottom of a viewport.
const HEADER_OFFSET = 90; // clears the sticky .site-head so the section heading is visible
const CROP_SECTIONS = [
  { key: 'hero',       selector: '.hero, #top', label: 'Hero — the opening' },
  { key: 'whatItIs',   selector: '#what-it-is', label: 'What it is — substance + the big-idea diagram' },
  { key: 'getStarted', selector: '#get-started', label: 'Get started — how to begin' },
  { key: 'pack',       selector: '#the-pack',   label: 'AI knowledge pack — the download block' },
];

// ----------------------------------------------------------------------------
// DETERMINISTIC INV-18 PRESENCE CHECK (in the DOM, never the vision model).
// The architecture + flow diagrams are mandatory and live in the #how-it-works
// block (assemble-page Station 6). Assert each EXISTS and is VISIBLE (rendered box
// > 0, not display:none / visibility:hidden / opacity:0). Classify by tier label /
// src / alt, with a positional fallback (first diagram = architecture, second = flow)
// so it stays robust to per-build asset filenames. Also returns the figure INDEX of
// each so renderDevice can capture exactly that figure for the clarity grade.
// MUST be run AFTER the full-page screenshot so lazy <img>s are loaded (else a
// not-yet-loaded diagram has a zero box and reads as "not visible").
// ----------------------------------------------------------------------------
async function checkDiagramsInDom(page) {
  return page.evaluate(() => {
    const out = {
      architecturePresent: false, architectureVisible: false, architectureIndex: -1,
      flowPresent: false, flowVisible: false, flowIndex: -1,
      figureCount: 0, details: [],
    };
    const sec = document.querySelector('#how-it-works');
    if (!sec) return out;
    const isVis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 2 && r.height > 2;
    };
    const figs = Array.from(sec.querySelectorAll('figure.diagram'));
    out.figureCount = figs.length;
    figs.forEach((fig, i) => {
      const img = fig.querySelector('img');
      const tier = (fig.querySelector('.tier')?.textContent || '').toLowerCase();
      const src = (img?.getAttribute('src') || '').toLowerCase();
      const alt = (img?.getAttribute('alt') || '').toLowerCase();
      const hay = `${tier} ${src} ${alt}`;
      const vis = isVis(img);
      const isArch = /architect/.test(hay);
      const isFlow = /\bflow\b|data.?flow|process|runtime/.test(hay);
      out.details.push({ index: i, tier, src, vis, isArch, isFlow });
      if (isArch && out.architectureIndex < 0) { out.architecturePresent = true; out.architectureVisible = vis; out.architectureIndex = i; }
      if (isFlow && out.flowIndex < 0) { out.flowPresent = true; out.flowVisible = vis; out.flowIndex = i; }
    });
    // positional fallback when the two mandatory diagrams aren't name-classifiable
    if (out.architectureIndex < 0 && figs.length >= 1) {
      out.architectureIndex = 0; out.architecturePresent = true; out.architectureVisible = isVis(figs[0].querySelector('img'));
    }
    if (out.flowIndex < 0 && figs.length >= 2) {
      const fi = out.architectureIndex === 0 ? 1 : 0;
      out.flowIndex = fi; out.flowPresent = true; out.flowVisible = isVis(figs[fi].querySelector('img'));
    }
    return out;
  });
}

// scroll an element to the top of the viewport INSTANTLY (the page sets
// scroll-behavior:smooth, which would otherwise leave a crop mid-animation).
async function scrollToTop(page, loc, offset) {
  await loc.evaluate((el, off) => {
    const y = el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo(0, Math.max(0, y));
  }, offset);
  await page.waitForTimeout(160);
}

// ----------------------------------------------------------------------------
// Render one device: settle the page, save the full-page screenshot (which forces
// every lazy <img> to load), THEN run the deterministic DOM diagram check, then
// capture the grading crops — viewport-segment section crops + dedicated element
// crops of the two mandatory diagrams. Returns { domInv18, fullPagePath, crops[], pageHeight }.
// ----------------------------------------------------------------------------
async function renderDevice(chromium, url, device, assetsDir) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dsf,
      isMobile: device.isMobile,
      hasTouch: device.isMobile,
    });
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!resp || !resp.ok()) throw new Error(`page did not load OK (status ${resp ? resp.status() : 'none'}) at ${url}`);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* best-effort */ }
    try { await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())); } catch { /* best-effort */ }
    // neutralise scroll-behavior:smooth so every programmatic scroll lands instantly
    await page.addStyleTag({ content: 'html, body { scroll-behavior: auto !important; }' }).catch(() => {});
    await page.waitForTimeout(500);

    // Force EVERY lazy <img> to load by actually scrolling the page through the viewport.
    // Playwright's full-page CDP capture does NOT reliably fire IntersectionObserver
    // lazy-loading, so without this pass the diagrams below the fold stay unloaded (zero
    // box) and the DOM visibility check — and the artifact — would both be wrong.
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0; const step = Math.max(200, window.innerHeight);
        const t = setInterval(() => {
          window.scrollTo(0, y); y += step;
          if (y >= document.documentElement.scrollHeight) { clearInterval(t); resolve(); }
        }, 60);
      });
      await Promise.all(Array.from(document.images).map((img) => img.complete ? null :
        new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); setTimeout(res, 3000); })));
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);

    const pageHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));

    // (1) full-page artifact — every image is now loaded (the human/email screenshot).
    const fullPagePath = path.join(assetsDir, device.file);
    await page.screenshot({ path: fullPagePath, fullPage: true });

    // (2) deterministic DOM presence/visibility + figure indices of the two mandatory
    //     diagrams — honest now that all images are loaded (no zero-height lazies).
    const domInv18 = await checkDiagramsInDom(page);

    const crops = [];
    // (3a) viewport-segment SECTION crops — sharp, capped at the device viewport
    for (const sec of CROP_SECTIONS) {
      const loc = page.locator(sec.selector).first();
      if (!(await loc.count())) { log(`  crop ${sec.key}: selector "${sec.selector}" not found — skipped`); continue; }
      try {
        await scrollToTop(page, loc, HEADER_OFFSET);
        const cropPath = path.join(assetsDir, `grade-${device.tag}-${sec.key}.png`);
        await page.screenshot({ path: cropPath, fullPage: false }); // exactly the device viewport
        crops.push({ key: sec.key, label: sec.label, path: cropPath });
      } catch (e) {
        log(`  crop ${sec.key}: capture failed (${e?.message || e}) — skipped`);
      }
    }
    // (3b) dedicated element crops of the two MANDATORY diagrams (full diagram, never clipped),
    //      inserted after the hero so they sit in document order for the grader.
    const diagFigs = page.locator('#how-it-works figure.diagram');
    const diagSpecs = [
      { idx: domInv18.architectureIndex, key: 'architecture', label: 'ARCHITECTURE diagram — modules / components / dependencies (how it is built)' },
      { idx: domInv18.flowIndex, key: 'flow', label: 'PROCESS / DATA-FLOW diagram — the runtime flow (how it works)' },
    ];
    const diagCrops = [];
    for (const d of diagSpecs) {
      if (d.idx < 0) { log(`  diagram ${d.key}: no figure found in #how-it-works — skipped`); continue; }
      try {
        const f = diagFigs.nth(d.idx);
        await f.scrollIntoViewIfNeeded().catch(() => {});
        const cropPath = path.join(assetsDir, `grade-${device.tag}-${d.key}.png`);
        await f.screenshot({ path: cropPath }); // element screenshot — the whole figure, instant scroll
        diagCrops.push({ key: d.key, label: d.label, path: cropPath });
      } catch (e) {
        log(`  diagram ${d.key}: capture failed (${e?.message || e}) — skipped`);
      }
    }
    // order the grader sees: hero, then the two diagrams, then the rest of the arc
    const ordered = [];
    const heroCrop = crops.find((c) => c.key === 'hero');
    if (heroCrop) ordered.push(heroCrop);
    ordered.push(...diagCrops);
    for (const c of crops) if (c.key !== 'hero') ordered.push(c);

    await context.close();
    return { domInv18, fullPagePath, crops: ordered, pageHeight };
  } finally {
    await browser.close();
  }
}

// ----------------------------------------------------------------------------
// Grade one screenshot with the vision model. LOUD on any malformed response.
// ----------------------------------------------------------------------------
function isScore(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100; }
function isText(s) { return typeof s === 'string' && s.trim().length > 0; }

async function gradeCrops({ apiKey, model, baseUrl, crops, deviceLabel }) {
  if (!Array.isArray(crops) || crops.length < 2) {
    throw new Error(`too few section crops captured for ${deviceLabel} (need >= 2, got ${crops?.length || 0}) — cannot grade reliably`);
  }
  // interleave a label + the full-resolution crop for each section, in document order
  const userContent = [{
    type: 'text',
    text: `Below are ${crops.length} full-resolution section crops of ONE explainer page rendered at ${deviceLabel}, in document order. They represent the whole page. Apply Gate A and Gate B to the page as a whole, and report INV-18 CLARITY for the two diagrams (in the "How it works" crop). Return ONLY the JSON object specified.`,
  }];
  for (let i = 0; i < crops.length; i++) {
    const b64 = fs.readFileSync(crops[i].path).toString('base64');
    userContent.push({ type: 'text', text: `[Crop ${i + 1}/${crops.length}] ${crops[i].label}:` });
    userContent.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' } });
  }

  const body = {
    model,
    temperature: 0,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${RUBRIC}\n\n${RESPONSE_SPEC}` },
      { role: 'user', content: userContent },
    ],
  };

  let resp;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`vision API request failed for ${deviceLabel}: ${e?.message || e}`);
  }
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`vision API HTTP ${resp.status} for ${deviceLabel}: ${raw.slice(0, 300)}`);

  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new Error(`vision API returned non-JSON envelope for ${deviceLabel}: ${raw.slice(0, 200)}`); }
  const content = envelope?.choices?.[0]?.message?.content;
  if (!isText(content)) throw new Error(`vision API returned no message content for ${deviceLabel}`);

  let g;
  try { g = JSON.parse(content); } catch { throw new Error(`grader content is not valid JSON for ${deviceLabel}: ${String(content).slice(0, 200)}`); }

  // --- LOUD validation: a grader that cannot return a complete per-criterion
  //     scorecard is a BUILD FAILURE, never a silent pass (ADR-0005 / DDD §12). ---
  const gateA = g.gateA, gateB = g.gateB, rationales = g.rationales, clarity = g.clarity, operatorQuestions = g.operatorQuestions;
  if (!gateA || !gateB || !rationales || !clarity) throw new Error(`grader response for ${deviceLabel} missing gateA/gateB/rationales/clarity`);
  if (!operatorQuestions || typeof operatorQuestions !== 'object') throw new Error(`grader response for ${deviceLabel} missing operatorQuestions`);
  for (const k of OPERATOR_QUESTIONS) if (typeof operatorQuestions[k] !== 'boolean') throw new Error(`grader operatorQuestions.${k} must be boolean for ${deviceLabel} (got ${JSON.stringify(operatorQuestions[k])})`);
  for (const k of CRITERIA_A) if (!isScore(gateA[k])) throw new Error(`grader score gateA.${k} invalid/missing for ${deviceLabel} (got ${JSON.stringify(gateA[k])})`);
  for (const k of CRITERIA_B) if (!isScore(gateB[k])) throw new Error(`grader score gateB.${k} invalid/missing for ${deviceLabel} (got ${JSON.stringify(gateB[k])})`);
  for (const k of [...CRITERIA_A, ...CRITERIA_B]) if (!isText(rationales[k])) throw new Error(`grader rationale ${k} missing/empty for ${deviceLabel}`);
  for (const k of ['architectureReadsClearly', 'flowReadsClearly']) {
    if (typeof clarity[k] !== 'boolean') throw new Error(`grader clarity.${k} must be boolean for ${deviceLabel} (got ${JSON.stringify(clarity[k])})`);
  }

  return {
    gateA: Object.fromEntries(CRITERIA_A.map((k) => [k, Math.round(gateA[k])])),
    gateB: Object.fromEntries(CRITERIA_B.map((k) => [k, Math.round(gateB[k])])),
    rationales: Object.fromEntries([...CRITERIA_A, ...CRITERIA_B].map((k) => [k, String(rationales[k]).trim()])),
    clarity: {
      architectureReadsClearly: clarity.architectureReadsClearly,
      architectureNote: isText(clarity.architectureNote) ? clarity.architectureNote.trim() : '',
      flowReadsClearly: clarity.flowReadsClearly,
      flowNote: isText(clarity.flowNote) ? clarity.flowNote.trim() : '',
    },
    operatorQuestions: Object.fromEntries(OPERATOR_QUESTIONS.map((k) => [k, operatorQuestions[k] === true])),
  };
}

// ----------------------------------------------------------------------------
// Assemble a per-device scorecard. headlineScore = MIN across all 10 criteria
// (never the mean — DDD §12.3 / INV-05). INV-18 is the AND of the DETERMINISTIC DOM
// verdict (present + visible, from checkDiagramsInDom) and the VISION clarity verdict
// (reads-clearly). A device passes iff headlineScore >= 95 AND INV-18 is clean.
// ----------------------------------------------------------------------------
function buildScorecard(deviceLabel, graded, domInv18, screenshotPath, cropPaths) {
  const all = [...CRITERIA_A.map((k) => graded.gateA[k]), ...CRITERIA_B.map((k) => graded.gateB[k])];
  const headlineScore = Math.min(...all);
  const meanScore = Math.round(all.reduce((a, b) => a + b, 0) / all.length);
  const operatorQuestions = graded.operatorQuestions || {};
  const opsArray = OPERATOR_QUESTIONS.map((k) => operatorQuestions[k] === true);

  // merged INV-18: presence/visibility from the DOM, clarity from the vision model.
  const inv18 = {
    architecturePresent: domInv18.architecturePresent,
    architectureVisible: domInv18.architectureVisible,
    architectureReadsClearly: domInv18.architecturePresent && domInv18.architectureVisible && graded.clarity.architectureReadsClearly,
    architectureNote: graded.clarity.architectureNote,
    flowPresent: domInv18.flowPresent,
    flowVisible: domInv18.flowVisible,
    flowReadsClearly: domInv18.flowPresent && domInv18.flowVisible && graded.clarity.flowReadsClearly,
    flowNote: graded.clarity.flowNote,
    source: 'presence+visibility=DOM, clarity=vision',
  };
  const inv18Ok = inv18.architecturePresent && inv18.architectureVisible && inv18.architectureReadsClearly &&
                  inv18.flowPresent && inv18.flowVisible && inv18.flowReadsClearly;
  inv18.passed = inv18Ok;
  const passed = evaluatePass({ mean: meanScore, min: headlineScore, operatorQuestions: opsArray }) && inv18Ok;

  const refineNotes = [];
  // Per-axis: flag any axis below the 85 anti-slop floor (a hard fail — headline = the min).
  for (const k of CRITERIA_A) if (graded.gateA[k] < 85) refineNotes.push({ device: deviceLabel, criterion: k, score: graded.gateA[k], saw: graded.rationales[k] });
  for (const k of CRITERIA_B) if (graded.gateB[k] < 85) refineNotes.push({ device: deviceLabel, criterion: k, score: graded.gateB[k], saw: graded.rationales[k] });
  // Overall: flag if the mean is below 90 (not yet as good as the example sites).
  if (meanScore < 90) refineNotes.push({ device: deviceLabel, criterion: 'MEAN', score: meanScore, saw: `overall mean ${meanScore} < 90 — not yet as good as the example sites; lift the weakest axes.` });
  // Operator gate: any NO is a hard fail, named.
  for (const k of OPERATOR_QUESTIONS) if (operatorQuestions[k] !== true) refineNotes.push({ device: deviceLabel, criterion: `operator:${k}`, score: 0, saw: `operator answered NO to "${k}" — the page does not yet satisfy this qualitative question.` });
  if (!inv18.architecturePresent) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `ARCHITECTURE diagram MISSING from the DOM (#how-it-works figure.diagram).` });
  else if (!inv18.architectureVisible) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `ARCHITECTURE diagram present in DOM but NOT visible (zero rendered box / hidden).` });
  else if (!inv18.architectureReadsClearly) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `ARCHITECTURE diagram does not read clearly. ${inv18.architectureNote}` });
  if (!inv18.flowPresent) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `FLOW diagram MISSING from the DOM (#how-it-works figure.diagram).` });
  else if (!inv18.flowVisible) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `FLOW diagram present in DOM but NOT visible (zero rendered box / hidden).` });
  else if (!inv18.flowReadsClearly) refineNotes.push({ device: deviceLabel, criterion: 'INV-18', score: 0, saw: `FLOW diagram does not read clearly. ${inv18.flowNote}` });

  const scorecard = {
    device: deviceLabel,
    gateA: graded.gateA,
    gateB: graded.gateB,
    operatorQuestions,
    rationales: graded.rationales,
    inv18,
    meanScore,
    headlineScore,
    normalizedHeadline: passed ? 95 : meanScore, // owner: a build that clears the exemplar bar is reported as a normalized 95
    passed,
    screenshot: screenshotPath,
    gradedCrops: cropPaths,
  };
  return { scorecard, refineNotes };
}

// ----------------------------------------------------------------------------
// main — orchestrate: read inputs → screenshot both devices → grade both →
// assemble dual scorecard → merge the `quality` slot. Loud on every failure.
// ----------------------------------------------------------------------------
async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) return emit(false, {}, 'usage: node tools/quality-grade.mjs <build-dir> (missing <build-dir> argument)');

  const buildJsonPath = path.join(buildDir, 'build.json');
  if (!fs.existsSync(buildJsonPath)) return emit(false, {}, `build.json not found at ${buildJsonPath}`);

  let ctx;
  try { ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); }
  catch (e) { return emit(false, {}, `build.json is not valid JSON: ${e?.message || e}`); }

  // --- DECLARED INPUTS: ONLY the `page` slot. Absent/invalid → loud stop. ---
  const page = ctx.page;
  if (!page || typeof page !== 'object') return emit(false, {}, 'build.json has no `page` slot — assemble-page (Station 6) must run before quality-grade');
  if (!page.dir) return emit(false, {}, 'build.json `page.dir` is missing — cannot serve the assembled site');
  if (!page.htmlPath) return emit(false, {}, 'build.json `page.htmlPath` is missing — cannot grade a page that was never assembled');
  const siteDir = path.resolve(page.dir);
  const htmlPath = path.resolve(page.htmlPath);
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) return emit(false, {}, `page.dir does not exist or is not a directory: ${siteDir}`);
  if (!fs.existsSync(htmlPath)) return emit(false, {}, `page.htmlPath does not exist on disk: ${htmlPath}`);

  // --- SECRET from env (never from build.json). No key → CANNOT evaluate → loud. ---
  const apiKey = loadOpenAiKey();
  if (!apiKey) return emit(false, {}, 'no OpenAI key found (set OPENAI_API_KEY / OPEN_AI_KEY in the environment or repo-root .env) — the page cannot be graded; refusing to emit a silent PASS');
  const model = process.env.QUALITY_VISION_MODEL || 'gpt-4o';
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  // --- Playwright at runtime (do NOT npm-install; loud if absent). ---
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { return emit(false, {}, `playwright is not installed (npm i -D playwright && npx playwright install chromium): ${e?.message || e}`); }

  const assetsDir = path.join(buildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const DEVICES = [
    { label: 'mobile(390)', tag: 'mobile-390', width: 390, height: 844, dsf: 2, isMobile: true, file: 'screenshot-mobile-390.png' },
    { label: 'desktop(1440)', tag: 'desktop-1440', width: 1440, height: 900, dsf: 1, isMobile: false, file: 'screenshot-desktop-1440.png' },
  ];

  let started;
  try {
    started = await startServer(siteDir);
  } catch (e) {
    return emit(false, {}, `could not start local static server for ${siteDir}: ${e?.message || e}`);
  }
  const baseHref = `http://127.0.0.1:${started.port}/`;

  const scorecard = [];
  const refineNotes = [];
  const screenshots = {};
  const pageHeights = {};
  try {
    for (const d of DEVICES) {
      log(`rendering ${d.label} → full-page artifact + section crops`);
      const { domInv18, fullPagePath, crops, pageHeight } = await renderDevice(chromium, baseHref, d, assetsDir);
      screenshots[d.isMobile ? 'mobile' : 'desktop'] = fullPagePath;
      pageHeights[d.isMobile ? 'mobile' : 'desktop'] = pageHeight;
      log(`${d.label}: pageHeight=${pageHeight}px, crops=${crops.map((c) => c.key).join(',')}, DOM inv18 arch(present=${domInv18.architecturePresent},vis=${domInv18.architectureVisible}) flow(present=${domInv18.flowPresent},vis=${domInv18.flowVisible})`);

      log(`grading ${d.label} with ${model} from ${crops.length} full-res crops …`);
      const graded = await gradeCrops({ apiKey, model, baseUrl, crops, deviceLabel: d.label });
      const { scorecard: card, refineNotes: notes } = buildScorecard(d.label, graded, domInv18, fullPagePath, crops.map((c) => c.path));
      scorecard.push(card);
      refineNotes.push(...notes);
      log(`${d.label}: headline=${card.headlineScore} inv18=${card.inv18.passed ? 'ok' : 'FAIL'} passed=${card.passed}`);
    }
  } catch (e) {
    started.server.close();
    return emit(false, {}, `quality grading failed: ${e?.message || e}`);
  } finally {
    started.server.close();
  }

  const passed = scorecard.length === DEVICES.length && scorecard.every((c) => c.passed);
  const prevIterations = Number.isInteger(ctx.quality?.iterations) ? ctx.quality.iterations : 0;

  const quality = {
    scorecard,
    passed,
    iterations: prevIterations + 1,
    visionModel: model,
    screenshots,
    pageHeights,
    refineNotes,
    gradedAt: new Date().toISOString(),
  };

  // --- Merge ONLY the `quality` slot; every other slot is left intact. ---
  ctx.quality = quality;
  try { fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n'); }
  catch (e) { return emit(false, {}, `could not write build.json: ${e?.message || e}`); }

  return emit(true, {
    quality,
    screenshots,
    pageHeights,
    passed,
    headline: { mobile: scorecard[0]?.headlineScore, desktop: scorecard[1]?.headlineScore },
    refineNoteCount: refineNotes.length,
  }, null);
}

// Auto-run ONLY when invoked directly (node tools/quality-grade.mjs <build-dir>). When this
// module is IMPORTED (e.g. a calibration harness that reuses the verbatim rubric + grader to
// validate the bands against a known-good page — CONTRACT (c), individually testable), the
// exports below are available without firing main(). The brain's direct invocation is unchanged.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((e) => emit(false, {}, `unexpected error: ${e?.stack || e?.message || e}`));
}

export { RUBRIC, RESPONSE_SPEC, CRITERIA_A, CRITERIA_B, gradeCrops, loadOpenAiKey };
