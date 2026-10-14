#!/usr/bin/env node
// make-overview.mjs — Station 6b (OPTIONAL, NON-BLOCKING, LOCAL-DOOR-ONLY): a SHORT narrated video
// overview of the repo, made with Google NotebookLM (`nlm` CLI), embedded in the page before grading.
//
// Why short: the default NotebookLM explainer runs ~7 minutes; Stuart's standard is under two.
// The tool enforces it — a render longer than MAX_SECONDS is discarded, never shipped.
//
// CONTRACT: node tools/make-overview.mjs <build-dir>
//   Reads:  repo{name,url}, concept{metaphor,palette}, page{dir}
//   Writes: <page.dir>/assets/overview.mp4 + overview-poster.jpg, a <section data-overview> in
//           index.html (if absent), and the `overview` slot in build.json.
//   stdout = ONE JSON result object; diagnostics -> stderr; exit 0 (a skip is not a failure).
//
// The look is derived per-repo from the build's own concept (metaphor + palette). There is no
// house style: a different repo gets a different brief.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX_SECONDS = 120;
const POLL_MS = 15000, TIMEOUT_MS = 20 * 60 * 1000;
const log = (m) => process.stderr.write(`[make-overview] ${m}\n`);
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim();

if (process.env.CI || process.env.GITHUB_ACTIONS) { log('refusing to run in CI — local-door-only.'); emit({ ok: false, outputs: {}, error: 'local-door-only' }); process.exit(1); }
const buildDir = process.argv[2];
if (!buildDir) { emit({ ok: false, outputs: {}, error: 'usage: node tools/make-overview.mjs <build-dir>' }); process.exit(1); }
const bjPath = path.join(buildDir, 'build.json');
const ctx = JSON.parse(fs.readFileSync(bjPath, 'utf8'));
function done(slot) {
  const cur = JSON.parse(fs.readFileSync(bjPath, 'utf8'));
  cur.overview = slot;
  fs.writeFileSync(bjPath, JSON.stringify(cur, null, 2) + '\n');
  emit({ ok: true, outputs: { overview: slot }, error: null });
  process.exit(0);
}
const skip = (why) => { log(`SKIPPED — ${why}`); done({ skipped: why }); };

if (/^(0|false|no|off)$/i.test(String(process.env.OVERVIEW || '').trim())) skip('OVERVIEW=0');
const { name, url } = ctx.repo || {};
const pageDir = ctx.page?.dir;
if (!name || !url) skip('repo slot incomplete');
if (!pageDir || !fs.existsSync(path.join(pageDir, 'index.html'))) skip('page not assembled yet');
try { sh('nlm', ['login', '--check']); } catch { skip('nlm missing or not authenticated (run `nlm login`)'); }
try { sh('ffprobe', ['-version']); } catch { skip('ffprobe missing'); }

// Per-repo brief: the page's own metaphor and palette, never a fixed house style.
const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].slice(0, 220);
const pal = ctx.concept?.palette || {};
const stylePrompt = `${firstSentence(ctx.concept?.metaphor) || `A visual language that fits what ${name} is.`} ` +
  `Colors: ${pal.bg || 'a calm neutral'} background with ${pal.accent || 'one restrained accent'}. Calm, precise, no clutter.`;
const focus = `A tight under-two-minute explainer of ${name} for a developer: the problem it solves, the one idea that makes it work, and how to start. ` +
  `Plain words. Say it is an independent explainer, not made by the author.`;

const uuid = (s) => (String(s).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
let nb;
try {
  if (process.env.OVERVIEW_NOTEBOOK) nb = process.env.OVERVIEW_NOTEBOOK;    // re-use an existing notebook (no new sources)
  else {
    nb = uuid(sh('nlm', ['notebook', 'create', `${name} explained (explainmyrepo)`, '--json']));
    if (!nb) throw new Error('no notebook id in output');
    const sources = [url]; if (ctx.publish?.liveUrl) sources.push(ctx.publish.liveUrl);
    sh('nlm', ['source', 'add', nb, ...sources.flatMap((u) => ['--url', u]), '--wait', '--json'], { timeout: 12 * 60 * 1000 });
  }
} catch (e) { skip(`could not create the notebook: ${String(e.stderr || e.message).slice(0, 160)}`); }

const formats = (process.env.OVERVIEW_FORMAT ? [process.env.OVERVIEW_FORMAT] : ['brief', 'short']);
const work = path.join(buildDir, 'overview'); fs.mkdirSync(work, { recursive: true });
let result = null;
for (const format of formats) {
  try {
    const created = sh('nlm', ['video', 'create', nb, '--format', format, '--focus', focus, '--style-prompt', stylePrompt, '-y', '--json']);
    const aid = uuid(created); if (!aid) throw new Error('no artifact id');
    log(`${format}: queued ${aid}`);
    const t0 = Date.now(); let state = '';
    while (Date.now() - t0 < TIMEOUT_MS) {
      await sleep(POLL_MS);
      const list = JSON.parse(sh('nlm', ['studio', 'status', nb]));
      const a = list.find((x) => x.id === aid || x.artifact_id === aid);
      state = a?.status || '';
      if (state === 'completed' || state === 'failed') break;
    }
    if (state !== 'completed') { log(`${format}: ended as "${state || 'timeout'}"`); continue; }
    const mp4 = path.join(work, `${format}.mp4`);
    sh('nlm', ['download', 'video', nb, '--id', aid, '-o', mp4, '--no-progress']);
    const dur = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]));
    log(`${format}: ${dur.toFixed(1)}s`);
    if (!(dur > 0) || dur > MAX_SECONDS) { log(`${format}: over ${MAX_SECONDS}s — discarded, never shipped`); continue; }
    result = { format, aid, mp4, dur };
    break;
  } catch (e) { log(`${format}: ${String(e.stderr || e.message).slice(0, 160)}`); }
}
if (!result) skip(`no format produced a video under ${MAX_SECONDS}s`);

const assets = path.join(pageDir, 'assets'); fs.mkdirSync(assets, { recursive: true });

// Detailed infographic from the same notebook. Optional: any failure just leaves the video on its own.
let info = null;
if (!/^(0|false|no|off)$/i.test(String(process.env.OVERVIEW_INFOGRAPHIC || '').trim())) {
  try {
    const created = sh('nlm', ['infographic', 'create', nb, '--detail', 'detailed', '--orientation', 'landscape', '--focus',
      `The one idea that makes ${name} work, in a few large labelled steps. Short words only; every label spelled exactly and fully legible.`, '-y', '--json']);
    const aid = uuid(created); if (!aid) throw new Error('no artifact id');
    log(`infographic: queued ${aid}`);
    const t0 = Date.now(); let state = '';
    while (Date.now() - t0 < TIMEOUT_MS) {
      await sleep(POLL_MS);
      const a = JSON.parse(sh('nlm', ['studio', 'status', nb])).find((x) => x.id === aid || x.artifact_id === aid);
      state = a?.status || '';
      if (state === 'completed' || state === 'failed') break;
    }
    if (state !== 'completed') throw new Error(`ended as "${state || 'timeout'}"`);
    const png = path.join(work, 'infographic.png');
    sh('nlm', ['download', 'infographic', nb, '--id', aid, '-o', png, '--no-progress']);
    // 4 MB PNG is too heavy for a page; 1800px JPEG is ~10x smaller and still crisp at text size.
    sh('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=1800:-2', '-q:v', '3', path.join(assets, 'overview-infographic.jpg')]);
    info = { artifactId: aid, path: 'assets/overview-infographic.jpg' };
    log('infographic: saved');
  } catch (e) { log(`infographic skipped: ${String(e.stderr || e.message).slice(0, 160)}`); }
}
fs.copyFileSync(result.mp4, path.join(assets, 'overview.mp4'));
sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(1, result.dur * 0.25)), '-i', result.mp4, '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '4', path.join(assets, 'overview-poster.jpg')]);

const htmlPath = path.join(pageDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8'), injected = false;
if (!/data-overview/.test(html)) {
  const secs = Math.round(result.dur);
  const block = `<section class="overview-band" data-overview aria-label="A ${secs}-second narrated overview of ${name}">
    <div class="wrap"><figure class="overview-fig">
      <video controls preload="metadata" playsinline poster="assets/overview-poster.jpg" width="1280" height="720"><source src="assets/overview.mp4" type="video/mp4">Your browser can't play this video. <a href="assets/overview.mp4" target="_blank" rel="noopener">Open the ${secs}-second overview</a>.</video>
      <figcaption>The ${secs}-second narrated overview, made with Google NotebookLM from the project's README. It is a machine-made summary, so treat the sections below and <a href="${url}" target="_blank" rel="noopener">the repo</a> as the source of truth.</figcaption>
    </figure>${info ? `
    <figure class="overview-fig"><img src="${info.path}" alt="Infographic summarising how ${name} works" loading="lazy" style="width:100%;height:auto;border-radius:18px;margin-top:18px"></figure>` : ''}</div>
  </section>
  <style>.overview-band{padding:0 0 28px}.overview-fig{margin:0}.overview-fig video{display:block;width:100%;height:auto;border-radius:18px;background:#000}.overview-fig figcaption{font-size:.95rem;margin-top:10px;opacity:.8}</style>
  `;
  const anchor = html.indexOf('<div class="sections">');
  if (anchor > -1) { html = html.slice(0, anchor) + block + html.slice(anchor); fs.writeFileSync(htmlPath, html); injected = true; }
  else log('no <div class="sections"> anchor — video copied but not embedded');
}
done({ notebookId: nb, infographic: info, artifactId: result.aid, format: result.format, durationSec: +result.dur.toFixed(1), path: 'assets/overview.mp4', injected, stylePrompt });
