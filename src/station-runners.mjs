// src/station-runners.mjs — turns the STATIONS table into runnable stations: spawned tools, brain calls,
// the gated kb:register step, the advisory check-claims step and the post-ship re-deploy gates.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readContext, mergeSlot } from './build-context.mjs';
import { runTool } from './run-tool.mjs';
import { stationsFor } from './stations.mjs';
import { recordClaims } from './claims-record.mjs';
import {
  authorConcept, authorContent, authorVisualBrief, visualsSlotFromBrief,
  authorPrimer, authorKbTarget,
} from './brain.mjs';
import { REPO_ROOT, C, log } from './runtime.mjs';

// ── kb:register — only when the repo is not already a kb.config target ─────────────────────────────
// A new target is written to a per-BUILD overlay (<build>/kb-targets.overlay.json, a JSON {slug: entry}) and
// pointed at by KB_TARGET_OVERLAY, which kb/kb.config.mjs merges into `targets` at load. The tracked
// kb/kb.config.mjs is never edited (a local build used to dirty the user's checkout).
export const OVERLAY_NAME = 'kb-targets.overlay.json';
export async function kbRegisterStation({ buildDir }, { apiKey, model }, { repoRoot = REPO_ROOT, author = authorKbTarget } = {}) {
  const ctx = readContext(buildDir);
  ctx._repoRoot = repoRoot;
  const slug = ctx.repo?.slug;
  if (!slug) throw new Error('kb:register — no repo.slug yet (clone-repo must run first)');

  const cfgPath = path.join(repoRoot, 'kb', 'kb.config.mjs');
  const overlayPath = path.resolve(buildDir, OVERLAY_NAME);
  if (fs.existsSync(overlayPath)) process.env.KB_TARGET_OVERLAY = overlayPath;   // a resumed build keeps its own entry
  const lookup = async () => { const m = await import(pathToFileURL(cfgPath).href + `?t=${Date.now()}${Math.random()}`); return m.getTarget(slug); };
  let existing = null;
  try { existing = await lookup(); } catch { existing = null; }
  if (existing) {
    if (!existing.embed) throw new Error(`kb:register — kb target "${slug}" has no \`embed\` block; the store's embedder would be a silent default (ADR-0005 D3)`);
    log(`${C.dim}kb target "${slug}" already registered — using it.${C.reset}`);
    return { ok: true, skipped: 'already-registered' };
  }

  log(`${C.yellow}kb target "${slug}" is NOT registered in kb/kb.config.mjs.${C.reset}`);
  const entry = await author(ctx, { apiKey, model });
  if (!entry || typeof entry !== 'object' || !entry.embed) throw new Error(`kb:register — the authored target for "${slug}" has no \`embed\` block; refusing to build a store with an unnamed embedder`);
  const genPath = path.join(buildDir, `kb-target.${slug}.generated.mjs`);
  fs.writeFileSync(genPath, `// GENERATED kb.config target entry for "${slug}" — paste into kb/kb.config.mjs targets{} to keep it.\nexport default ${JSON.stringify({ [slug]: entry }, null, 2)};\n`);

  let overlay = {};
  try { overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8')); } catch { overlay = {}; }
  overlay[slug] = entry;
  fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
  process.env.KB_TARGET_OVERLAY = overlayPath;
  log(`${C.yellow}registered "${slug}" for this build only (${path.relative(process.cwd(), overlayPath)}); kb/kb.config.mjs is untouched.${C.reset}`);
  try { await lookup(); } catch (e) { throw new Error(`kb:register — the overlay did not take: ${e.message}`); }
  return { ok: true, registered: true };
}

// A brain station reads fresh ctx, calls `fn`, and fn merges its slot. ctx._env is the MERGED env so keys that
// exist only in .env reach the brain client.
export function brainRun(fn) {
  return async ({ buildDir, env, apiKey, model }) => {
    const ctx = readContext(buildDir);
    ctx._repoRoot = REPO_ROOT;
    ctx._env = env;
    await fn(ctx, { buildDir, apiKey, model });
    return { ok: true };
  };
}

// ── concept: tournament first, single-shot fallback ───────────────────────────────────────────────────
// concept-tournament fails open: with fewer than 2 candidate models or no judge it prints
// {"ok":true,"outputs":{},"skipped":"<why>","error":null} and exits 0. That is a skip, not a failure: the
// `concept` station below then authors the concept. A real failure (ok:false) stays a failure.
export function tournamentOutcome(r) {
  if (r.ok) return r.result?.skipped ? { ok: true, skipped: `tournament not run: ${r.result.skipped}` } : { ok: true };
  return { ok: false, error: r.error };
}

// Why the single-shot concept station should not run, or null when it should. A concept chosen by a tournament
// in THIS run stands (hosted: the agent validates it, never discards it); an older one is re-authored.
export function conceptSkipReason(ctx, { startedAt = 0, only } = {}) {
  const ranAt = Date.parse(ctx.concept?.tournament?.ranAt || '');
  if (only === 'concept' || !Number.isFinite(ranAt) || ranAt < startedAt) return null;
  return `the concept tournament already chose it (winner ${ctx.concept.tournament.winnerModel})`;
}

// ── index-primer — put the authored primer into the KB so retrieval returns the orientation layer ────────
export async function indexPrimerStation({ buildDir }, { index } = {}) {
  const slug = readContext(buildDir).repo?.slug;
  if (!slug) throw new Error('index-primer — no repo.slug yet (clone-repo must run first)');
  const run = index || (await import('../kb/index-primer.mjs')).indexPrimer;
  const r = await run(slug, { log: (m) => log(`${C.dim}${m}${C.reset}`) });
  return { ok: true, indexed: r };
}

// ── post-ship follow-ups ────────────────────────────────────────────────────────────────────────────
// True when make-overview put something on the page (a video or an infographic), so a re-deploy has a point.
export function overviewAddedToPage(overview) {
  if (!overview || overview.skipped) return false;
  return Boolean(overview.injected || overview.infographic);
}
// Why a post-ship re-deploy / re-publish should not run, or null when it should.
export function followUpSkipReason(ctx, id) {
  if (!overviewAddedToPage(ctx.overview)) return 'make-overview added nothing to the page';
  if (!ctx.publish?.liveUrl) return 'nothing was deployed, so there is nothing to refresh';
  if (id === 'republish' && !ctx.publish?.explainerRepoUrl) return 'no explainer repo was published';
  return null;
}

// ── the runnable station list ───────────────────────────────────────────────────────────────────────
const BRAIN = {
  primer: async (ctx, { apiKey, model }) => { await authorPrimer(ctx, { apiKey, model, repoRoot: REPO_ROOT }); },
  concept: async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'concept', await authorConcept(ctx, { apiKey, model })); },   // see runnerFor: skipped after a tournament win
  content: async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'content', await authorContent(ctx, { apiKey, model })); },
  'visual-brief': async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'visuals', visualsSlotFromBrief(await authorVisualBrief(ctx, { apiKey, model }))); },
};

function runnerFor(s) {
  if (s.id === 'kb:register') return (a) => kbRegisterStation(a, a);
  if (s.id === 'concept-tournament') return ({ buildDir, env }) => tournamentOutcome(runTool(s.tool, buildDir, { repoRoot: REPO_ROOT, env }));
  if (s.id === 'index-primer') return (a) => indexPrimerStation(a);
  if (s.id === 'concept') {
    const author = brainRun(BRAIN.concept);
    return (a) => {
      const why = conceptSkipReason(readContext(a.buildDir), { startedAt: a.startedAt, only: a.opts?.only });
      return why ? { ok: true, skipped: why } : author(a);
    };
  }
  if (BRAIN[s.id]) return brainRun(BRAIN[s.id]);
  if (s.id === 'check-claims') return ({ buildDir }) => { recordClaims(buildDir); return { ok: true }; };
  if (s.phase === 'post-ship' && s.tool !== 'make-overview') {
    return ({ buildDir, env }) => {
      const why = followUpSkipReason(readContext(buildDir), s.id);
      return why ? { ok: true, skipped: why } : runTool(s.tool, buildDir, { repoRoot: REPO_ROOT, env });
    };
  }
  return ({ buildDir, env }) => runTool(s.tool, buildDir, { repoRoot: REPO_ROOT, env });
}

export function buildStations(opts) {
  return stationsFor(opts).map((s) => ({ ...s, run: runnerFor(s) }));
}
