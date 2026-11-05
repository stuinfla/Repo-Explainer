// bin/cure.mjs — the recovery stage's brain: classify how a hosted build ENDED and, for a near-miss,
// build the narrow prompt that cures it. History: docs/adr/0011-the-gate-advises-never-destroys.md.
//
// TRUST: the agent may only DESCRIBE a fix; this deterministic classifier decides whether ONE
// verification grade is spent; tools/deploy.mjs refuses only on integrity (ADR-0011), so the ratchet
// below (cureImproved/decideCureDeploy) is what keeps a worse page from replacing a live one.
// Pure except runCureStage (its effects are injected), the snapshot/restore pair and the cost meter.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_RATES, priceUsd } from '../src/claude.mjs';

export const CURE = {
  // Near-miss envelope: every device already reads as a genuinely good page (mean at/above the
  // ship floor), no axis is true slop (a slop axis grades ≈50 per the rubric; structural caps
  // land 55-60), and the gate can NAME every blocker. Diffuse mediocrity is not a near-miss.
  MEAN_FLOOR: 82,
  MIN_AXIS_FLOOR: 55,
  MAX_WEAKNESSES: 4,
  // Wall-clock bounds for the whole cure cycle — must fit the dispatch buffer (build.js
  // budgetMin + 25) with margin, asserted by tests/review-f3a-budget.test.mjs.
  AGENT_WALL_MS: 10 * 60_000,
  GRADE_WALL_MS: 7 * 60_000,
  DEPLOY_WALL_MS: 3 * 60_000,
};

function deviceAxes(dev) {
  return [...Object.values(dev.gateA || {}), ...Object.values(dev.gateB || {})].filter((n) => typeof n === 'number');
}

// Every item that blocks the SHIP gate, by name — the cure may touch these and NOTHING else.
export function namedWeaknesses(quality) {
  quality = quality || {};
  const out = [];
  const saw = (deviceLabel, criterion) =>
    (quality.refineNotes || []).find((n) => n.device === deviceLabel && String(n.criterion).includes(criterion))?.saw || null;
  for (const dev of quality.scorecard || []) {
    const label = dev.deviceLabel || dev.device || 'unknown';
    for (const gate of ['gateA', 'gateB']) {
      for (const [name, score] of Object.entries(dev[gate] || {})) {
        if (typeof score === 'number' && score < 70) out.push({ device: label, kind: 'axis', name, score, saw: saw(label, name) });
      }
    }
    for (const [name, val] of Object.entries(dev.operatorQuestions || {})) {
      if (val !== true) out.push({ device: label, kind: 'operator', name, saw: saw(label, name) });
    }
    if (dev.inv18 && dev.inv18.passed === false) out.push({ device: label, kind: 'inv18', name: 'INV-18 diagrams', saw: saw(label, 'INV-18') });
  }
  return out;
}

// s: { exitCode, killedForBudget, identityViolation, spawnError, liveUrl, siteExists, quality }
// Returns { cls, cure, weaknesses? } — cure is false, 'redeploy', 'fix-and-regrade' (held page) or
// 'improve-and-redeploy' (delivered page; the ratchet decides whether the improved one replaces it).
export function classifyEndState(s) {
  if (s.identityViolation) return { cls: 'identity-violation', cure: false };
  // Delivery is unconditional on quality (ADR-0011), so a live URL no longer means "done": a below-bar
  // page is delivered first, then improved; the runner redeploys only on a strictly better verdict.
  if (s.liveUrl) {
    if (s.quality?.passed === true) return { cls: 'shipped', cure: false };
    // tools/deploy.mjs delivers a gate-refused page too (ADR-0011) — it must still reach the cure.
    const refusalLive = gateRefusalWeakness(s);
    if (refusalLive) return { cls: 'shipped-gate-refusal', cure: 'improve-and-redeploy', weaknesses: [refusalLive] };
    const weaknesses = namedWeaknesses(s.quality);
    if (!weaknesses.length) return { cls: 'shipped', cure: false };
    // Only a NEAR-MISS is repaired: diffuse mediocrity or a slop axis gets the same honest "no cure" a held
    // page gets, not a 10-minute cure agent plus a regrade the ratchet would almost always discard.
    if (!isNearMiss(s.quality, weaknesses)) return { cls: 'shipped-below-bar', cure: false, weaknesses };
    return { cls: 'shipped-below-bar', cure: 'improve-and-redeploy', weaknesses };
  }
  if (s.killedForBudget) return { cls: 'budget-exhausted', cure: false };
  if (s.spawnError || s.exitCode !== 0) return { cls: 'crash', cure: false };
  const q = s.quality;
  const refusal = gateRefusalWeakness(s);
  if (refusal) return { cls: 'gate-refusal', cure: 'fix-and-regrade', weaknesses: [refusal] };
  const ungraded = !q || !Array.isArray(q.scorecard) || q.scorecard.length === 0;
  // The page is built, the grader was recorded unavailable, nothing deployed: deploy accepts exactly
  // this (quality.graderUnavailable, ADR-0011), so one plain redeploy ships it, disclosed as ungraded.
  if (s.siteExists && ungraded && q?.graderUnavailable === true) return { cls: 'ungraded-undeployed', cure: 'redeploy' };
  if (!s.siteExists || ungraded) return { cls: 'unbuilt', cure: false }; // env/preflight failures: nothing graded to verify
  if (q.passed === true) return { cls: 'graded-pass-undeployed', cure: 'redeploy' };
  const weaknesses = namedWeaknesses(q);
  if (isNearMiss(q, weaknesses)) return { cls: 'near-miss', cure: 'fix-and-regrade', weaknesses };
  return { cls: 'below-bar', cure: false, weaknesses };
}

// A deterministic pre-check refusal (quality.gateRefusal — e.g. INV-20 acronyms, INV-24 reading
// level) leaves no scorecard because the vision pass never ran, but the page EXISTS and the
// blocker is named copy the cure agent can fix. Classing it 'unbuilt' threw that repair away.
function hasGateRefusal(q) {
  return Boolean(q && typeof q.gateRefusal === 'string' && q.gateRefusal.trim());
}
function gateRefusalWeakness(s) {
  const q = s.quality;
  if (!s.siteExists || !hasGateRefusal(q) || (Array.isArray(q.scorecard) && q.scorecard.length > 0)) return null;
  const note = (q.refineNotes || []).map((n) => n?.note || n?.saw).filter(Boolean).join(' ') || null;
  return { device: 'both', kind: 'gate-refusal', name: q.gateRefusal.trim(), saw: note };
}

function scoreOf(q) {
  const axes = (Array.isArray(q?.scorecard) ? q.scorecard : []).flatMap(deviceAxes);
  if (!axes.length) return null;
  return { min: Math.min(...axes), mean: axes.reduce((a, b) => a + b, 0) / axes.length };
}

// May the cured page REPLACE a live one? Only on a strictly better measured result. A live page
// delivered on a pre-check refusal has no scores to beat; a cure that clears the pre-check AND carries
// a real vision grade is the better page.
export function cureImproved(preQ, postQ) {
  const pre = scoreOf(preQ);
  const post = scoreOf(postQ);
  if (!post || hasGateRefusal(postQ)) return { improved: false, pre, post };
  if (!pre) return { improved: hasGateRefusal(preQ), pre, post };
  return { improved: post.min > pre.min || (post.min === pre.min && post.mean > pre.mean + 0.5), pre, post };
}

// THE RATCHET as one decision (ADR-0011): a page that is already live is replaced only by a strictly
// better measured one; a page that is not live is delivered whatever the fresh grade says.
export function decideCureDeploy({ wasLive, beforeQuality, afterQuality }) {
  const { improved, pre, post } = cureImproved(beforeQuality, afterQuality);
  return { deploy: !wasLive || improved, improved, pre, post };
}

function isNearMiss(q, weaknesses) {
  return (q.scorecard || []).every((dev) => {
    const axes = deviceAxes(dev);
    if (!axes.length) return false;
    const mean = axes.reduce((a, b) => a + b, 0) / axes.length;
    return mean >= CURE.MEAN_FLOOR && Math.min(...axes) >= CURE.MIN_AXIS_FLOOR;
  }) && weaknesses.length >= 1 && weaknesses.length <= CURE.MAX_WEAKNESSES;
}

export function buildCurePrompt({ repoUrl, buildDir, weaknesses, quality }) {
  const list = weaknesses.map((w, i) => {
    const score = w.kind === 'axis' ? ` (scored ${w.score}, ship floor is 70)` : '';
    const seen = w.saw ? `\n   What the grader saw: ${w.saw}` : '';
    return `${i + 1}. [${w.device}] ${w.kind === 'operator' ? `operator question "${w.name}" answered NO` : `${w.name}${score}`}${seen}`;
  }).join('\n');
  return `You are the CURE agent for an explainmyrepo build of ${repoUrl}. The page at ${buildDir}/site is FULLY BUILT and already graded; it failed the ship gate on ONLY the named weaknesses below (final mean ${meanLine(quality)}). Your entire job is to fix exactly these and nothing else:

${list}

Rules — narrower than a normal build, and absolute:
- Fix ONLY the named weaknesses, surgically. Route by criterion exactly as SKILL.md's refine loop does (a typography axis re-opens the page CSS; a content/operator miss re-opens that section's copy; an imagery/diagram axis re-opens the specific figure — skills/explainmyrepo/SKILL.md and skills/explainmyrepo/TOOLS-CONTRACT.md are the references). Never a broad reflow that could regress a passing axis.
- If two diagrams share one visual form (an imagery-craft repetition cap), regenerate the offending figure(s) with node tools/make-diagrams.mjs ${buildDir} — the archetype dispatcher guarantees distinct forms per slot.
- After any edit, re-run: node tools/assemble-page.mjs ${buildDir}
- Do NOT run quality-grade (the runner spends the one verification grade itself, after you finish).
- Do NOT run deploy (the runner deploys the cured page only if the fresh verdict is strictly better).
- Do NOT touch build.json's quality or repo slots, and never any file outside ${buildDir}.
- Budget: roughly 8 minutes. If a weakness genuinely cannot be fixed (the repo lacks what it asks for), say so honestly instead of faking it.

When done, print as your LAST line exactly:
RESULT: {"ok": true, "fixed": "<one factual sentence per weakness: what you changed and why it addresses it>"}
or RESULT: {"ok": false, "reason": "<why the cure is impossible>"}`;
}

function meanLine(quality) {
  const per = (quality.scorecard || []).map((dev) => {
    const axes = deviceAxes(dev);
    const mean = axes.length ? axes.reduce((a, b) => a + b, 0) / axes.length : 0;
    return `${dev.deviceLabel || dev.device}: ${mean.toFixed(0)}`;
  });
  return per.join(', ') || 'unknown';
}

// ── CURE SNAPSHOT ──────────────────────────────────────────────────────────────────────────────
// When the cure does NOT replace the live page, the build dir must describe the page that IS live
// (status gist and requester email read it). Snapshot before the cure agent edits; restore on any
// path that keeps the live page.
const SNAP_DIRS = ['site', 'assets'];

export function snapshotForCure(buildDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-snap-'));
  for (const d of SNAP_DIRS) {
    const src = path.join(buildDir, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, d), { recursive: true });
  }
  fs.copyFileSync(path.join(buildDir, 'build.json'), path.join(dir, 'build.json'));
  return dir;
}

// Restores site/, assets/ and build.json exactly as they were, then records what the cure tried
// (cureRecord) on quality.cure so the attempt stays visible without its scores masquerading as live.
export function restoreCureSnapshot(buildDir, snapDir, cureRecord = null) {
  for (const d of SNAP_DIRS) {
    const dst = path.join(buildDir, d);
    fs.rmSync(dst, { recursive: true, force: true });
    const src = path.join(snapDir, d);
    if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
  }
  const ctx = JSON.parse(fs.readFileSync(path.join(snapDir, 'build.json'), 'utf8'));
  if (cureRecord && ctx.quality && typeof ctx.quality === 'object') ctx.quality.cure = cureRecord;
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(ctx, null, 2) + '\n');
}

export function discardCureSnapshot(snapDir) {
  if (snapDir) fs.rmSync(snapDir, { recursive: true, force: true });
}

// The build dir must be rolled back exactly when a page was live before the cure and the cured
// version did not replace it.
export function shouldRestoreAfterCure({ wasLive, redeployed }) {
  return Boolean(wasLive) && !redeployed;
}

// ── $ BUDGET ───────────────────────────────────────────────────────────────────────────────────
// Primary stop: Claude Code's --max-budget-usd (final `result` subtype error_max_budget_usd). The
// streamed meter is the BACKSTOP: total_cost_usd only arrives on the final event.
export function maxBudgetArgs(usd) {
  const n = Number(usd);
  // Floor at one cent: the CLI rejects 0, and a sub-cent remainder must still be a ceiling.
  return Number.isFinite(n) && n > 0 ? ['--max-budget-usd', String(Math.max(0.01, Math.round(n * 100) / 100))] : [];
}

export const USD_BACKSTOP_FACTOR = 1.25; // fires only if the native cap failed to

// The OpenRouter lane names the same model 'anthropic/claude-sonnet-5.5'. Rates: src/claude.mjs MODEL_RATES.
const modelId = (model) => String(model || '').replace(/^anthropic\//, '').replace(/\./g, '-');
export function rateFor(model) {
  return MODEL_RATES[modelId(model)] || null;
}

// One API message can surface as several stream-json `assistant` events (one per content block),
// each carrying the SAME message.id and usage. Summing every event would double count, so cost is
// keyed by message.id and the largest figure seen for that id wins. Events with no id are summed
// (over-counting is the safe direction for a ceiling). Cache writes priced at 1.25x input and
// cache reads at 0.1x input (standard Anthropic prompt-caching multipliers).
export function createCostMeter(model) {
  const id = modelId(model);
  const rate = rateFor(model);
  const byId = new Map();
  let anon = 0;
  return {
    known: Boolean(rate),
    add(evt) {
      if (!rate || evt?.type !== 'assistant') return;
      const u = evt.message?.usage;
      if (!u) return;
      const usd = priceUsd(id, { in: u.input_tokens || 0, out: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 });
      const msgId = evt.message?.id;
      if (msgId) byId.set(msgId, Math.max(byId.get(msgId) || 0, usd));
      else anon += usd;
    },
    get usd() { let t = anon; for (const v of byId.values()) t += v; return t; },
  };
}

export function overUsdBackstop(estimateUsd, budgetUsd) {
  return Number(budgetUsd) > 0 && estimateUsd > budgetUsd * USD_BACKSTOP_FACTOR;
}

export function isNativeBudgetStop(evt) {
  return evt?.type === 'result' && evt.subtype === 'error_max_budget_usd';
}

// ── THE CURE STAGE ─────────────────────────────────────────────────────────────────────────────
// Did a deploy attempt put the new version in front of readers? tools/deploy.mjs can fail AFTER the zip
// reached Netlify (the share-card check records publish.shareCardError and exits non-zero), so the exit
// code alone would claim the old page is "still live and untouched". A success is exit 0 plus a verified
// record; the failure-after-landing signals are a new shareCardError or a deployId that changed.
export function deployLanded(status, beforePublish, afterPublish) {
  const b = beforePublish || {};
  const a = afterPublish || {};
  if (status === 0 && a.liveUrl && a.http200) return { landed: true, verified: true, liveUrl: a.liveUrl };
  if (a.liveUrl && a.http200 && a.shareCardError && a.shareCardError !== b.shareCardError) {
    return { landed: true, verified: false, liveUrl: a.liveUrl, why: `live but ${a.shareCardError}` };
  }
  if (a.liveUrl && a.deployId && a.deployId !== b.deployId) {
    return { landed: true, verified: false, liveUrl: a.http200 ? a.liveUrl : null, why: 'a new deploy reached Netlify but verification failed' };
  }
  return { landed: false, verified: false, liveUrl: null };
}

// Runs the whole cure cycle for a run that exited cleanly. All effects come in through `deps`, so the
// ratchet, the budget guard and the restore-after-reject decisions are exercised by tests with stubs:
//   readBuild() writeBuild(obj) siteExists() deploy()->{status} cureAgent({prompt, remainingUsd})->{status, stdout}
//   grade()->{status}, patchStatus(msg), log(msg), snapshot{take,restore,discard}
// Returns { liveUrl, totalCostUsd, cureRedeployed, cureRecord, endState }.
export async function runCureStage(s, deps) {
  const { readBuild, writeBuild, siteExists, deploy, cureAgent, grade, patchStatus = async () => {}, log = () => {},
    snapshot = { take: snapshotForCure, restore: restoreCureSnapshot, discard: discardCureSnapshot } } = deps;
  const { buildDir, repoUrl, budgetUsd } = s;
  let { liveUrl, totalCostUsd } = s;
  const liveBeforeCure = liveUrl;
  let cureSnapshot = null;
  let cureRedeployed = false;
  let cureRecord = null;
  let endState = null;
  const result = () => ({ liveUrl, totalCostUsd, cureRedeployed, cureRecord, endState });
  // A deploy attempt: run it, then judge from build.json whether it landed.
  const attemptDeploy = () => {
    const before = readBuild().publish;
    const d = deploy();
    const landing = deployLanded(d.status, before, readBuild().publish);
    return { d, landing };
  };

  if (!(s.exitCode === 0 && !s.killedForBudget && !s.killedForUsd && !s.identityViolation)) return result();
  try {
    const bc = readBuild();
    endState = classifyEndState({
      exitCode: s.exitCode, killedForBudget: s.killedForBudget, identityViolation: s.identityViolation, spawnError: s.spawnErrorMsg, liveUrl,
      siteExists: siteExists(), quality: bc.quality,
    });
    log(`cure stage: end-state classified as ${endState.cls}${endState.weaknesses ? ` (${endState.weaknesses.length} named weakness(es))` : ''}`);

    if (endState.cure === 'redeploy') {
      log(`cure stage: ${endState.cls} — retrying deploy once`);
      const { d, landing } = attemptDeploy();
      if (landing.landed && landing.liveUrl) {
        liveUrl = landing.liveUrl;
        log(`cure stage: redeploy ${landing.verified ? 'succeeded' : `landed but unverified (${landing.why})`} — ${liveUrl}`);
      } else log(`cure stage: redeploy failed too (exit ${d.status}) — leaving run as failed`);
    } else if ((endState.cure === 'fix-and-regrade' || endState.cure === 'improve-and-redeploy') && totalCostUsd < budgetUsd) {
      await patchStatus('One fix from passing — running the automatic cure…');
      log(`cure stage: spawning the narrow cure agent (fix ONLY: ${endState.weaknesses.map((w) => `${w.device}/${w.name}`).join(', ')})`);
      if (liveBeforeCure) cureSnapshot = snapshot.take(buildDir);
      // The cure agent ALWAYS runs: an agent-written note can never stand in for the independent fixer.
      const c = cureAgent({ prompt: buildCurePrompt({ repoUrl, buildDir, weaknesses: endState.weaknesses, quality: bc.quality }), remainingUsd: budgetUsd - totalCostUsd });
      try {
        const res = JSON.parse(String(c.stdout || '').trim().split('\n').pop());
        if (typeof res?.total_cost_usd === 'number') totalCostUsd += res.total_cost_usd;
        log(`cure stage: cure agent exit ${c.status}, cost +$${(res?.total_cost_usd || 0).toFixed(2)}`);
      } catch { log(`cure stage: cure agent exit ${c.status} (unparseable output — cost uncounted)`); }
      if (c.status !== 0) log('cure stage: cure agent failed — an unchanged page is not regraded (that would be dice-rolling, not verification)');
      else {
        const before = readBuild();
        // authorize exactly ONE verification grade (never below 0: a gate-refusal cure arrives uncharged)
        before.quality.iterations = Math.max(0, (Number.isInteger(before.quality.iterations) ? before.quality.iterations : 0) - 1);
        writeBuild(before);
        const g = grade();
        const after = readBuild();
        after.quality.cure = {
          authorizedBy: 'runner (deterministic near-miss classification, bin/cure.mjs)',
          endState: endState.cls, weaknesses: endState.weaknesses.length, cureAgentSpawned: true, gradeExit: g.status,
        };
        cureRecord = after.quality.cure;
        writeBuild(after);
        if (g.status !== 0) log(`cure stage: verification grade errored (exit ${g.status}) — run outcome unchanged`);
        else {
          const wasLive = Boolean(liveUrl);
          const { deploy: doDeploy, pre, post } = decideCureDeploy({ wasLive, beforeQuality: before.quality, afterQuality: after.quality });
          if (!doDeploy) {
            log(`cure stage: the cure did NOT improve the page (min ${pre?.min}→${post?.min}, mean ${pre?.mean?.toFixed(1)}→${post?.mean?.toFixed(1)}) — KEEPING the already-delivered version. A live page is never replaced by a worse one.`);
          } else {
            log(`cure stage: fresh verification grade complete (passed=${after.quality?.passed}${pre && post ? `, min ${pre.min}→${post.min}, mean ${pre.mean.toFixed(1)}→${post.mean.toFixed(1)}` : ''}) — delivering`);
            const { d, landing } = attemptDeploy();
            if (landing.landed) {
              cureRedeployed = true;
              if (landing.liveUrl) liveUrl = landing.liveUrl;
              log(`cure stage: ${wasLive ? 'IMPROVED AND REDEPLOYED' : 'CURED AND SHIPPED'}${landing.verified ? '' : ` (deploy exit ${d.status}: ${landing.why} — the cured page IS what is served)`} — ${liveUrl}`);
            } else if (wasLive) log(`cure stage: redeploy of the improved page failed (exit ${d.status}) — the originally delivered page is still live and untouched`);
            else log(`cure stage: deploy failed after the cure (exit ${d.status}) — integrity refusal stands, honestly`);
          }
        }
      }
    } else if (endState.cure === 'fix-and-regrade' || endState.cure === 'improve-and-redeploy') {
      log(`cure stage: near-miss but $ budget already spent ($${totalCostUsd.toFixed(2)} of $${budgetUsd}) — holding honestly instead of overspending`);
    }
  } catch (e) { log(`cure stage: skipped on error (${e?.message || e}) — run outcome unchanged`); }

  if (cureSnapshot) {
    // The cure did not replace the live page: put back exactly what IS live, so the status gist and the
    // requester email describe the deployed page, not the rejected repair.
    if (shouldRestoreAfterCure({ wasLive: liveBeforeCure, redeployed: cureRedeployed })) {
      try {
        snapshot.restore(buildDir, cureSnapshot, cureRecord ? { ...cureRecord, outcome: 'not-deployed — build dir restored to the live version' } : null);
        log('cure stage: restored site/, assets/ and build.json to the version that is actually live');
      } catch (e) { log(`cure stage: RESTORE FAILED (${e?.message || e}) — build.json/site may describe the rejected repair, not the live page`); }
    }
    snapshot.discard(cureSnapshot);
  }
  return result();
}
