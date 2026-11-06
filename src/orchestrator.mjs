// src/orchestrator.mjs — the LOCAL door: run the explainer pipeline in order, with Claude in the loop.
//
// Station order, kinds and flags live in ONE table: src/stations.mjs. This file selects the slice to run,
// seeds the build dir (one build.json per build, CONTRACT §a), runs the stations, refines a below-bar page,
// then ships. The pieces: station-runners.mjs (what each station does), preflight.mjs (credentials),
// refine.mjs (the below-bar loop), receipt.mjs (cost and timing).

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, getSecret, redact } from './env.mjs';
import { initBuildDir, readContext } from './build-context.mjs';
import { resolveModel } from './claude.mjs';
import { selectStations } from './stations.mjs';
import { buildStations } from './station-runners.mjs';
import { recordClaims } from './claims-record.mjs';
import { preflight } from './preflight.mjs';
import { refineLoop, belowBarVerdict, readQuality } from './refine.mjs';
import { printReceipt, printTiming, finalSummary, reportQualityGap } from './receipt.mjs';
import { REPO_ROOT, C, log, step } from './runtime.mjs';

export { brainRun } from './station-runners.mjs';
export { upsertEnvFile, promptForMissingKeys } from './preflight.mjs';
export { refineBudget, iterationRank, contentFixable, refineLoop, belowBarVerdict } from './refine.mjs';
export { stationTimingTable, formatImagesCost, formatGradingCost } from './receipt.mjs';

// clone-repo's URL grammar (https | git@host:owner/name | bare host/owner/name), just enough to derive a
// default out-dir name before clone-repo runs.
export function parseRepoUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const scp = s.match(/^git@([^:]+):(.+)$/);
  if (scp) s = `https://${scp[1]}/${scp[2]}`;
  if (!/^[a-z]+:\/\//i.test(s)) {
    // bare "owner/name" (no host) → github.com; "host/owner/name" keeps its host
    s = /^[^/]+\.[^/]+\//.test(s) ? `https://${s}` : `https://github.com/${s}`;
  }
  s = s.replace(/\/+$/, '');
  let u; try { u = new URL(s); } catch { return null; }
  const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  return { owner, name, url: `https://${u.host}/${owner}/${name}` };
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// Run a sub-list of stations in order; stop on the first FATAL failure (non-fatal ones warn and continue).
async function runStations(subList, baseArgs, total, startIdx) {
  const results = [];
  let i = startIdx;
  for (const s of subList) {
    i++;
    step(i, total, s.id, s.kind);
    const t0 = Date.now();
    let r;
    try { r = await s.run(baseArgs); }
    catch (e) { r = { ok: false, error: e.message }; }
    const sec = Math.round((Date.now() - t0) / 100) / 10;
    if (r.ok) {
      log(`${C.green}✓ ${s.id}${C.reset} (${sec}s)${r.skipped ? ` ${C.dim}(${r.skipped})${C.reset}` : ''}`);
      results.push({ id: s.id, ok: true, sec });
    } else {
      results.push({ id: s.id, ok: false, error: r.error, sec });
      if (s.fatal) { log(`${C.red}✗ ${s.id} FAILED (${sec}s):${C.reset} ${r.error}`); return { ok: false, failedAt: s.id, error: r.error, results }; }
      log(`${C.yellow}⚠ ${s.id} failed (non-blocking) (${sec}s): ${r.error}${C.reset}`);
    }
  }
  return { ok: true, results };
}

const stopped = (id, outDir) => log(`\n${C.red}${C.bold}Build stopped at "${id}".${C.reset} Resume: ${C.cyan}--from ${id} --out ${outDir}${C.reset}`);
const meanPair = (q) => q.scorecard.map((c) => `${String(c.device).replace(/\(.*/, '')} ${c.meanScore}`).join(' / ');

export async function run(repoUrl, opts = {}) {
  const startedAt = Date.now();
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error(`not a parseable GitHub repo URL: "${repoUrl}"`);
  // A slug is an IDENTITY (build dir, kb store, kb.config target, {slug}-explainer.netlify.app). If a prior
  // build already owns this slug for a DIFFERENT owner's repo, reusing it would cross-contaminate stores and
  // deploy over the other repo's site (ADR-0007), so disambiguate to owner-name.
  let slug = slugify(parsed.name);
  const priorBuildJson = path.join(process.cwd(), 'explainer-builds', slug, 'build.json');
  try {
    const prior = JSON.parse(fs.readFileSync(priorBuildJson, 'utf8'));
    const priorId = `${prior?.repo?.owner}/${prior?.repo?.name}`.toLowerCase();
    if (prior?.repo?.owner && priorId !== `${parsed.owner}/${parsed.name}`.toLowerCase()) {
      slug = slugify(`${parsed.owner}-${parsed.name}`);
      log(`${C.yellow}slug "${slugify(parsed.name)}" already belongs to ${priorId} — using "${slug}" to keep identities separate.${C.reset}`);
    }
  } catch { /* no prior build under this slug — plain name slug is free */ }

  const env = loadEnv(REPO_ROOT);
  let apiKey = getSecret(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  const model = resolveModel(env, opts.model);

  const outDir = path.resolve(opts.out || path.join(process.cwd(), 'explainer-builds', slug));
  const list = selectStations(buildStations(opts), { from: opts.from, to: opts.to, only: opts.only });

  log(`${C.bold}explainmyrepo${C.reset} — ${C.cyan}${parsed.owner}/${parsed.name}${C.reset}`);
  log(`${C.dim}build dir : ${outDir}${C.reset}`);
  log(`${C.dim}model     : ${model}   anthropic key: ${redact(apiKey)}${C.reset}`);
  log(`${C.dim}stations  : ${list.map((s) => s.id).join(' → ')}${C.reset}`);

  if (opts.dryRun) { log(`\n${C.yellow}--dry-run: plan only, nothing executed.${C.reset}`); return { ok: true, dryRun: true, outDir, stations: list.map((s) => s.id) }; }

  await preflight(list, env, REPO_ROOT);
  apiKey = getSecret(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']); // may have just been entered + saved

  // Seed the build dir + build.json (idempotent). A slice that starts after clone-repo resumes an existing build.
  if (list.length > 0 && list[0].id === 'clone-repo') {
    initBuildDir(outDir, parsed.url || repoUrl);
  } else if (!fs.existsSync(path.join(outDir, 'build.json'))) {
    throw new Error(`--from/--only "${list[0]?.id}" needs an existing build at ${outDir} — start with clone-repo first`);
  } else {
    const c = readContext(outDir);
    c.repo = { ...(c.repo || {}), url: c.repo?.url || parsed.url || repoUrl };
    fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify(c, null, 2) + '\n');
  }

  const total = list.length;
  const baseArgs = { buildDir: outDir, env, model, apiKey, opts, startedAt };
  const qIdx = list.findIndex((s) => s.id === 'quality-grade');

  // No quality gate in this slice (--no-quality, or a partial --only/--from run): run linearly.
  if (qIdx === -1) {
    const r = await runStations(list, baseArgs, total, 0);
    if (!r.ok) { stopped(r.failedAt, outDir); printTiming(outDir, r.results); return { ok: false, failedAt: r.failedAt, error: r.error, outDir, results: r.results }; }
    finalSummary(outDir);
    printTiming(outDir, r.results);
    return { ok: true, outDir, results: r.results };
  }

  // Gated run: build through quality-grade, refine while below the bar, then ship what integrity allows.
  const pre = list.slice(0, qIdx + 1);
  const post = list.slice(qIdx + 1);
  const preR = await runStations(pre, baseArgs, total, 0);
  // A grader OUTAGE on the first grade is recorded (quality.graderUnavailable); ADR-0011 delivers such a
  // page ungraded with that said plainly.
  const outageOnly = !preR.ok && preR.failedAt === 'quality-grade' && readQuality(outDir)?.graderUnavailable === true;
  if (outageOnly) log(`${C.yellow}quality-grade: the grader was unavailable — continuing; the page is delivered ungraded and says so (ADR-0011).${C.reset}`);
  if (!preR.ok && !outageOnly) { stopped(preR.failedAt, outDir); printReceipt(outDir, startedAt, preR.results); return { ok: false, failedAt: preR.failedAt, error: preR.error, outDir, results: preR.results }; }

  let quality = readQuality(outDir);
  if (quality && !quality.passed && !opts.noRefine) {
    quality = await refineLoop({ buildDir: outDir, env, model, apiKey, opts });
    recordClaims(outDir); // the refine passes re-authored the copy; the claims slot must describe the final one
  }

  if (!(quality && quality.passed)) {
    // Delivery is gated on integrity, not score (ADR-0011); see belowBarVerdict.
    reportQualityGap(quality);
    const verdict = belowBarVerdict(quality);
    if (verdict.action === 'deliver-ungraded') {
      log(`\n${C.yellow}${C.bold}Not vision-graded — ${verdict.why}. Delivering anyway, with that stated plainly (ADR-0011).${C.reset}`);
      log(`${C.dim}No scorecard exists for this copy, so diagram legibility was not judged by the grader. Best local build: ${outDir}/site${C.reset}`);
    } else if (verdict.action === 'hold') {
      log(`\n${C.yellow}${C.bold}Held — ${verdict.why}. That is an INTEGRITY failure, not a low score.${C.reset}`);
      log(`${C.dim}Best local build: ${outDir}/site . This is the one thing we will not ship broken (ADR-0011 D1). Fix it, then: ${C.cyan}--from ${post[0] ? post[0].id : 'deploy'} --out ${outDir}${C.reset}`);
      printReceipt(outDir, startedAt, preR.results);
      return { ok: false, gated: true, quality, outDir, results: preR.results };
    } else {
      log(`\n${C.yellow}${C.bold}Below the bar (mean ${meanPair(quality)}) — delivering anyway, with the scorecard attached (ADR-0011).${C.reset}`);
      log(`${C.dim}Structurally sound (mandatory diagrams present). The per-axis gaps above are recorded in the scorecard and delivered honestly, not hidden. A stranger always gets a real page.${C.reset}`);
    }
  } else if (quality.exemplary) {
    log(`\n${C.green}${C.bold}Quality gate PASSED — world-class (mean ${meanPair(quality)}).${C.reset} Shipping.`);
  } else {
    log(`\n${C.green}${C.bold}Quality gate PASSED — ship-worthy (mean ${meanPair(quality)}).${C.reset} Shipping.`);
    log(`${C.dim}Genuinely good + no slop + real legible diagrams (INV-18). The world-class target (mean ≥ 90 / worst axis ≥ 85 / all 6 operators) is not fully reached — the per-axis gap is recorded in build.json refineNotes and travels with the scorecard.${C.reset}`);
  }
  const postR = post.length ? await runStations(post, baseArgs, total, qIdx + 1) : { ok: true, results: [] };
  return concludeShip({ outDir, startedAt, preResults: preR.results, postR });
}

// A fatal failure AFTER the grade (deploy, publish-repo, repo-seo) is a stopped build: say how to resume and
// never print the green "Done." summary over it.
export function concludeShip({ outDir, startedAt, preResults, postR }) {
  const results = [...preResults, ...postR.results];
  if (postR.ok === false) {
    stopped(postR.failedAt, outDir);
    printReceipt(outDir, startedAt, results);
    return { ok: false, failedAt: postR.failedAt, error: postR.error, outDir, results };
  }
  finalSummary(outDir);
  printReceipt(outDir, startedAt, results);
  return { ok: true, outDir, results };
}
