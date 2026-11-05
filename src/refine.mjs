// src/refine.mjs — the self-correcting loop for a below-bar local build: hand the critic's content-fixable
// findings back to the brain, re-author, re-assemble, re-grade, and keep the BEST iteration.

import fs from 'node:fs';
import path from 'node:path';
import { readContext, mergeSlot } from './build-context.mjs';
import { runTool } from './run-tool.mjs';
import { authorContent } from './brain.mjs';
import { MAX_QUALITY_ITERATIONS, diagramsStructurallyPresent } from '../tools/quality-grade.mjs';
import { REPO_ROOT, C, log } from './runtime.mjs';

export const sumMean = (q) => (Array.isArray(q?.scorecard) ? q.scorecard.reduce((s, c) => s + (c.meanScore || 0), 0) : 0);
export function readQuality(buildDir) { try { return readContext(buildDir).quality; } catch { return null; } }

// How many content re-authors can still be GRADED: quality-grade refuses a grade past its cap and hands back
// the old scorecard, so a re-author beyond it is a paid brain call nobody reads.
export function refineBudget(asked, gradesUsed = 1) {
  return Math.max(0, Math.min(asked, MAX_QUALITY_ITERATIONS - 1, MAX_QUALITY_ITERATIONS - gradesUsed));
}

// Which iteration is "best": a real scorecard for THIS copy beats an ungraded copy that cleared the
// pre-checks, which beats a copy the pre-checks refused (fewer violations first).
export function iterationRank(q) {
  if (!q) return { tier: -1, score: 0 };
  const scored = Array.isArray(q.scorecard) && q.scorecard.length > 0;
  if (q.gateRefusal) {
    const n = (k) => (Array.isArray(q[k]?.violations) ? q[k].violations.length : 0);
    return { tier: 0, score: -(n('inv20') + n('inv24')) };
  }
  if (scored && q.graderUnavailable !== true) return { tier: 2, score: sumMean(q) };
  if (q.graderUnavailable === true) return { tier: 1, score: 0 };
  return { tier: -1, score: 0 };
}
const rankBetter = (a, b) => a.tier > b.tier || (a.tier === b.tier && a.score > b.score);

// Every grade rewrites the full-page screenshots in place; keep a copy for the best iteration.
function snapshotBest(q) {
  const copy = JSON.parse(JSON.stringify(q || {}));
  const keep = (p) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return p;
    const dest = path.join(path.dirname(p), `best-${path.basename(p)}`);
    try { fs.copyFileSync(p, dest); return dest; } catch { return p; }
  };
  if (copy.screenshots && typeof copy.screenshots === 'object') {
    for (const k of Object.keys(copy.screenshots)) copy.screenshots[k] = keep(copy.screenshots[k]);
  }
  for (const c of (Array.isArray(copy.scorecard) ? copy.scorecard : [])) if (c.screenshot) c.screenshot = keep(c.screenshot);
  return copy;
}

// A copy rewrite only helps when a copy-addressable weakness exists: an A* substance axis or an operator
// question. Design, imagery and diagram (B*, INV-18) failures need a different fix.
export function contentFixable(notes) {
  return (notes || []).some((n) => /^A\d|^operator:/.test(String(n?.criterion || '')));
}

// assemble-page rewrites index.html from scratch, which drops the Ask box make-ask put there. When the box
// shipped before this assemble, put it back (make-ask is idempotent) so a refined page keeps it.
export function reinjectAsk(buildDir, tool, env) {
  let ask; try { ask = readContext(buildDir).ask; } catch { return { ran: false }; }
  if (!ask || ask.skipped) return { ran: false };
  const r = tool('make-ask', buildDir, { repoRoot: REPO_ROOT, env });
  if (!r.ok) log(`${C.yellow}refine: could not restore the Ask box (${r.error}) — the page ships without it${C.reset}`);
  return { ran: true, ok: !!r.ok };
}

export async function refineLoop({ buildDir, env, model, apiKey, opts }, deps = {}) {
  const author = deps.authorContent || authorContent;
  const tool = deps.runTool || runTool;
  const cap = MAX_QUALITY_ITERATIONS;
  const asked = opts.maxRefine != null ? Math.max(0, parseInt(opts.maxRefine, 10) || 0) : 2;
  let q = readQuality(buildDir);
  const MAX = refineBudget(asked, q?.iterations);
  if (asked > cap - 1) {
    log(`${C.yellow}--max-refine ${asked} clamped to ${cap - 1}${C.reset} ${C.dim}— quality-grade allows ${cap} grades in total; passes beyond that are paid re-authors it will not read.${C.reset}`);
  }
  if (MAX < Math.min(asked, cap - 1)) {
    log(`${C.yellow}grader cap already spent (${q?.iterations}/${cap} grades)${C.reset} ${C.dim}— skipping refine passes.${C.reset}`);
  }
  const contentNow = () => { try { return readContext(buildDir).content; } catch { return null; } };
  let best = { rank: iterationRank(q), content: contentNow(), quality: snapshotBest(q) };
  let pass = 0;
  while (q && !q.passed && pass < MAX) {
    const fb = (q.refineNotes || []).filter((n) => /^A\d|^operator:|^MEAN$/.test(n.criterion));
    if (!contentFixable(fb)) {
      log(`${C.dim}refine skipped — every remaining weakness is design, imagery or diagrams; rewriting the copy cannot move those.${C.reset}`);
      break;
    }
    pass++;
    const axes = [...new Set(fb.map((f) => f.criterion))].join(', ') || 'the weak axes';
    log(`\n${C.bold}${C.cyan}Refine pass ${pass}/${MAX}${C.reset} ${C.dim}(re-authoring content to lift ${axes})${C.reset}`);
    const ctx = readContext(buildDir); ctx._repoRoot = REPO_ROOT; ctx._env = env;
    try { mergeSlot(buildDir, 'content', await author(ctx, { apiKey, model, feedback: fb })); }
    catch (e) { log(`${C.yellow}refine: content re-author failed (${e.message}) — stopping refine${C.reset}`); break; }
    const a = tool('assemble-page', buildDir, { repoRoot: REPO_ROOT, env });
    if (!a.ok) { log(`${C.yellow}refine: assemble-page failed (${a.error}) — stopping refine${C.reset}`); break; }
    reinjectAsk(buildDir, tool, env);
    const before = JSON.stringify(readQuality(buildDir));
    const g = tool('quality-grade', buildDir, { repoRoot: REPO_ROOT, env });
    q = readQuality(buildDir);
    // A grader outage quality-grade RECORDED for this copy still describes this copy (pre-checks passed,
    // ungraded) and is a candidate; any other failure leaves a slot about an older copy.
    const freshOutage = !g.ok && q?.graderUnavailable === true && JSON.stringify(q) !== before;
    if (g.ok || freshOutage) {
      const rank = iterationRank(q);
      if (rankBetter(rank, best.rank)) best = { rank, content: contentNow(), quality: snapshotBest(q) };
    }
    if (!g.ok) { log(`${C.yellow}refine: quality-grade failed (${g.error}) — stopping refine${C.reset}`); break; }
    log(`${C.dim}refine pass ${pass}: mean(sum of devices)=${sumMean(q)}  passed=${q?.passed}${C.reset}`);
  }
  // Not passing: restore the BEST iteration's content AND its own quality slot. Re-grading here would hit the
  // cap (the grader returns the LAST pass's scorecard) or overwrite the slot with a FRESH pre-check refusal (empty scorecard), which would erase the best grade.
  if (q && !q.passed && best.content) {
    const cur = readContext(buildDir);
    if (JSON.stringify(cur.content) !== JSON.stringify(best.content)) {
      log(`${C.dim}restoring the best iteration (tier ${best.rank.tier}, score ${best.rank.score}) — its content and its own grade${C.reset}`);
      mergeSlot(buildDir, 'content', best.content);
      tool('assemble-page', buildDir, { repoRoot: REPO_ROOT, env });
      reinjectAsk(buildDir, tool, env);
      const ctx2 = readContext(buildDir);
      ctx2.quality = {
        ...best.quality,
        // spend and the grade budget are facts about the BUILD, not about one iteration
        ...(Number.isInteger(cur.quality?.iterations) ? { iterations: cur.quality.iterations } : {}),
        ...(cur.quality?.cost ? { cost: cur.quality.cost } : {}),
        restoredBest: true,
      };
      fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(ctx2, null, 2) + '\n');
      q = readQuality(buildDir);
    }
  }
  return q;
}

// What a BELOW-BAR local build does next. An empty scorecard with a RECORDED reason (a pre-check refusal or
// a grader outage) is not a diagram failure: no vision verdict exists for this copy, and deploy delivers it
// with that disclosed (ADR-0011).
export function belowBarVerdict(quality) {
  const scored = !!(quality && Array.isArray(quality.scorecard) && quality.scorecard.length);
  if (!scored && quality?.gateRefusal) {
    return { action: 'deliver-ungraded', why: `the copy failed a deterministic reader check before the vision grade (${quality.gateRefusal})` };
  }
  if (!scored && quality?.graderUnavailable === true) {
    return { action: 'deliver-ungraded', why: `the vision grader was unavailable (${String(quality.graderError || 'no detail recorded').slice(0, 160)})` };
  }
  if (!scored) return { action: 'hold', why: 'no quality scorecard was produced and no reason was recorded' };
  if (!diagramsStructurallyPresent(quality.scorecard)) return { action: 'hold', why: 'the mandatory diagrams did not render' };
  return { action: 'deliver', why: 'below the bar, structurally sound' };
}
