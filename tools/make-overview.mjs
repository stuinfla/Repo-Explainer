#!/usr/bin/env node
// make-overview.mjs — FOLLOW-UP station (OPTIONAL, NON-BLOCKING, LOCAL-DOOR-ONLY): a short narrated video
// overview plus one detailed infographic of the repo, made with Google NotebookLM (`nlm` CLI) and embedded
// in the page. It runs AFTER the last station (notify), then deploy and publish-repo re-ship the page; nothing
// waits for it. It re-reads build.json fresh and touches only <page.dir>/assets, index.html and the
// `overview` slot.
//
// Why short: the default NotebookLM explainer runs ~7 minutes; the standard is under 90 seconds. The prompt asks
// for a ~75-second script, and the ffprobe duration is the hard gate (src/overview-cap.mjs): a render longer
// than MAX_SECONDS is discarded, never shipped.
//
// CONTRACT: node tools/make-overview.mjs <build-dir>
//   Reads:  repo{name,url}, concept{metaphor,palette}, page{dir}, publish.liveUrl (extra source, if shipped)
//   Writes: <page.dir>/assets/overview.mp4 + overview-poster.jpg (+ overview-infographic.jpg), a
//           <section data-overview> in index.html (if absent), and the `overview` slot (or { skipped }).
//   stdout = ONE JSON result object; diagnostics -> stderr; exit 0 (a skip is not a failure).
//
// Time: the video and the infographic are queued together and polled together, inside ONE budget
// (OVERVIEW_BUDGET_MS, default 25 min) that stays under run-tool's 30-minute kill. The notebook this run
// created is ALWAYS deleted on the way out (success, skip, error, SIGTERM); an OVERVIEW_NOTEBOOK the
// operator supplied is never touched.
// The look is derived per-repo from the build's own concept. There is no house style.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAX_SECONDS, withinCap } from '../src/overview-cap.mjs';
import { injectOverview } from '../src/overview-block.mjs';

const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const POLL_MS = num(process.env.OVERVIEW_POLL_MS, 15000);
const BUDGET_MS = num(process.env.OVERVIEW_BUDGET_MS, 25 * 60 * 1000);
const T0 = Date.now();
const left = () => BUDGET_MS - (Date.now() - T0);
const off = (v) => /^(0|false|no|off)$/i.test(String(v || '').trim());
const log = (m) => process.stderr.write(`[make-overview] ${m}\n`);
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...o }).trim();
const why = (e) => String(e?.stderr || e?.message || e).slice(0, 160);
const uuid = (s) => (String(s).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const terminal = (s) => s === 'completed' || s === 'failed';

const buildDir = process.argv[2];
if (!buildDir) { emit({ ok: false, outputs: {}, error: 'usage: node tools/make-overview.mjs <build-dir>' }); process.exit(1); }
const bjPath = path.join(buildDir, 'build.json');
const ctx = JSON.parse(fs.readFileSync(bjPath, 'utf8'));

function done(slot) {
  const cur = JSON.parse(fs.readFileSync(bjPath, 'utf8'));   // fresh: other stations wrote since we started
  cur.overview = slot;
  fs.writeFileSync(bjPath, JSON.stringify(cur, null, 2) + '\n');
  emit({ ok: true, outputs: { overview: slot }, error: null });
  process.exit(0);
}
class Skip extends Error {}
const skip = (m) => { throw new Skip(m); };

let nb = null, ownNotebook = false;
function deleteNotebook() {
  if (!ownNotebook || !nb) return;
  ownNotebook = false;
  try { sh('nlm', ['notebook', 'delete', nb, '-y']); log(`deleted notebook ${nb}`); }
  catch (e) { log(`WARNING: could not delete notebook ${nb} — remove it by hand: ${why(e)}`); }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log(`${sig}: cleaning up`); deleteNotebook(); process.exit(1); });

async function main() {
  if (process.env.CI || process.env.GITHUB_ACTIONS) skip('local-door-only (CI)');
  if (off(process.env.OVERVIEW)) skip('OVERVIEW=0');
  const { name, url } = ctx.repo || {};
  const pageDir = ctx.page?.dir;
  if (!name || !url) skip('repo slot incomplete');
  if (!pageDir || !fs.existsSync(path.join(pageDir, 'index.html'))) skip('page not assembled yet');
  try { sh('nlm', ['login', '--check']); } catch { skip('nlm missing or not authenticated (run `nlm login`)'); }
  try { sh('ffprobe', ['-version']); } catch { skip('ffprobe missing'); }

  // Per-repo brief: the page's own metaphor and palette.
  const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].slice(0, 220);
  const pal = ctx.concept?.palette || {};
  const stylePrompt = `${firstSentence(ctx.concept?.metaphor) || `A visual language that fits what ${name} is.`} ` +
    `Colors: ${pal.bg || 'a calm neutral'} background with ${pal.accent || 'one restrained accent'}. Calm, precise, no clutter.`;
  const focus = `A tight explainer of ${name} for a developer, about 75 seconds long (a script of about 190 spoken words, never more than 200): the problem it solves, the one idea that makes it work, and how to start. ` +
    `Plain words. Say it is an independent explainer, not made by the author.`;

  if (process.env.OVERVIEW_NOTEBOOK) nb = process.env.OVERVIEW_NOTEBOOK;   // operator's notebook: reuse, never delete
  else {
    try {
      nb = uuid(sh('nlm', ['notebook', 'create', `${name} explained (explainmyrepo)`, '--json']));
      if (!nb) throw new Error('no notebook id in output');
      ownNotebook = true;
      const sources = [url]; if (ctx.publish?.liveUrl) sources.push(ctx.publish.liveUrl);
      sh('nlm', ['source', 'add', nb, ...sources.flatMap((u) => ['--url', u]), '--wait', '--json'], { timeout: Math.max(1000, Math.min(12 * 60 * 1000, left())) });
    } catch (e) { skip(`could not create the notebook: ${why(e)}`); }
  }

  const work = path.join(buildDir, 'overview'); fs.mkdirSync(work, { recursive: true });
  const assets = path.join(pageDir, 'assets'); fs.mkdirSync(assets, { recursive: true });

  // ---- queue the video and the infographic together ----
  const formats = process.env.OVERVIEW_FORMAT ? [process.env.OVERVIEW_FORMAT] : ['brief', 'short'];
  let next = 0;
  const startVideo = () => {
    while (next < formats.length) {
      const format = formats[next++];
      try {
        const aid = uuid(sh('nlm', ['video', 'create', nb, '--format', format, '--focus', focus, '--style-prompt', stylePrompt, '-y', '--json']));
        if (!aid) throw new Error('no artifact id');
        log(`${format}: queued ${aid}`);
        return { format, aid };
      } catch (e) { log(`${format}: ${why(e)}`); }
    }
    return null;
  };
  let infoJob = null;
  if (!off(process.env.OVERVIEW_INFOGRAPHIC)) {
    try {
      const aid = uuid(sh('nlm', ['infographic', 'create', nb, '--detail', 'detailed', '--orientation', 'landscape', '--focus',
        `The one idea that makes ${name} work, in a few large labelled steps. Short words only; every label spelled exactly and fully legible.`, '-y', '--json']));
      if (!aid) throw new Error('no artifact id');
      log(`infographic: queued ${aid}`);
      infoJob = { aid };
    } catch (e) { log(`infographic skipped: ${why(e)}`); }
  }
  let video = startVideo();
  if (!video) skip('no video job could be queued');

  const fetchVideo = (job) => {
    try {
      const mp4 = path.join(work, `${job.format}.mp4`);
      sh('nlm', ['download', 'video', nb, '--id', job.aid, '-o', mp4, '--no-progress']);
      const dur = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]));
      log(`${job.format}: ${dur.toFixed(1)}s`);
      if (!withinCap(dur)) { log(`${job.format}: over ${MAX_SECONDS}s — discarded, never shipped`); return null; }
      return { format: job.format, mp4, dur };
    } catch (e) { log(`${job.format}: ${why(e)}`); return null; }
  };
  const fetchInfographic = (job) => {
    try {
      const png = path.join(work, 'infographic.png');
      sh('nlm', ['download', 'infographic', nb, '--id', job.aid, '-o', png, '--no-progress']);
      // 4 MB PNG is too heavy for a page; 1800px JPEG is ~10x smaller and still crisp at text size.
      sh('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=1800:-2', '-q:v', '3', path.join(assets, 'overview-infographic.jpg')]);
      log('infographic: saved');
      return { path: 'assets/overview-infographic.jpg' };
    } catch (e) { log(`infographic skipped: ${why(e)}`); return null; }
  };

  // ---- poll both jobs with one status call per tick ----
  let result = null, info = null, statusFails = 0;
  while ((video || infoJob) && left() > 0) {
    await sleep(Math.min(POLL_MS, Math.max(1, left())));
    let list;
    try { list = JSON.parse(sh('nlm', ['studio', 'status', nb])); statusFails = 0; }
    catch (e) { log(`status check failed: ${why(e)}`); if (++statusFails >= 5) break; continue; }
    const state = (j) => list.find((x) => x.id === j.aid || x.artifact_id === j.aid)?.status || '';
    if (video && terminal(state(video))) {
      const job = video;
      if (state(job) === 'completed') { result = fetchVideo(job); } else log(`${job.format}: ended as "failed"`);
      video = result ? null : startVideo();
    }
    if (infoJob && terminal(state(infoJob))) {
      if (state(infoJob) === 'completed') info = fetchInfographic(infoJob); else log('infographic: ended as "failed"');
      infoJob = null;
    }
    if (result && !infoJob) break;
    if (!video && !result) break;   // no format left to try
  }
  if (infoJob) log('infographic did not finish inside the budget — shipping the video alone');
  if (!result) skip(left() <= 0 ? `timed out after ${Math.round(BUDGET_MS / 60000)} min with no video` : `no format produced a video under ${MAX_SECONDS}s`);

  // ---- ship into the page ----
  sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(1, result.dur * 0.25)), '-i', result.mp4, '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '4', path.join(assets, 'overview-poster.jpg')]);
  fs.copyFileSync(result.mp4, path.join(assets, 'overview.mp4'));
  const htmlPath = path.join(pageDir, 'index.html');
  const placed = injectOverview(fs.readFileSync(htmlPath, 'utf8'), { name, url, secs: Math.round(result.dur), infographicPath: info?.path || null });
  if (placed.injected) fs.writeFileSync(htmlPath, placed.html);
  else if (placed.reason !== 'already present') log(`${placed.reason} — video copied but not embedded`);
  const injected = placed.injected;
  return { infographic: info, format: result.format, durationSec: +result.dur.toFixed(1), path: 'assets/overview.mp4', injected };
}

let slot;
try { slot = await main(); }
catch (e) {
  if (!(e instanceof Skip)) log(`failed: ${why(e)}`);
  slot = { skipped: e instanceof Skip ? e.message : `error: ${why(e)}` };
  log(`SKIPPED — ${slot.skipped}`);
} finally { deleteNotebook(); }
done(slot);
