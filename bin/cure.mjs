// bin/cure.mjs — the recovery stage's brain: classify how a build ENDED, and when the ending is
// a near-miss, build the narrow prompt that cures it.
//
// WHY THIS EXISTS (2026-07-19, after three straight public failures 07/15–07/17): the pipeline
// was one-shot — no component owned recovery after the agent stopped, so ANY unforeseen last-mile
// condition became a terminal user-visible "failed", even with a finished floor-clearing page on
// disk. This module generalizes the 427ffbb operator-grade block from "fires only on a confession
// key the agent was never taught" to "fires on any deterministically-classified near-miss."
//
// TRUST STRUCTURE (non-negotiable, from the DEPLOY_FORCE incident): the agent may only DESCRIBE
// a fix; this classifier (deterministic, agent-untouchable) decides whether ONE verification
// grade is spent; the ship-bar rail in tools/deploy.mjs stays the ONLY judge of publishability.
// Nothing here bypasses, weakens, or pre-judges the rail.
//
// Pure module: no I/O, no env, fully unit-tested in tests/cure.test.mjs against fixtures shaped
// like the three real incidents (66HEX/frame, supertone-inc/supertonic, bissanmu/spring3).
// Two exceptions, both at the bottom and both tested in tests/review-c-*.test.mjs: the cure
// snapshot/restore pair (file I/O by necessity) and the streamed-cost meter (pure).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CURE = {
  // Near-miss envelope: every device already reads as a genuinely good page (mean at/above the
  // ship floor), no axis is true slop (a slop axis grades ≈50 per the rubric; structural caps
  // land 55-60), and the gate can NAME every blocker. Diffuse mediocrity is not a near-miss.
  MEAN_FLOOR: 82,
  MIN_AXIS_FLOOR: 55,
  MAX_WEAKNESSES: 4,
  // Wall-clock bounds for the whole cure cycle — must fit the dispatch buffer (build.js
  // budgetMin + 25) with margin, asserted by tests/cure.test.mjs.
  AGENT_WALL_MS: 10 * 60_000,
  GRADE_WALL_MS: 7 * 60_000,
  DEPLOY_WALL_MS: 3 * 60_000,
};

function deviceAxes(dev) {
  return [...Object.values(dev.gateA || {}), ...Object.values(dev.gateB || {})].filter((n) => typeof n === 'number');
}

// Every item that blocks the SHIP gate, by name — the cure may touch these and NOTHING else.
export function namedWeaknesses(quality) {
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
// Returns { cls, cure, weaknesses? } — cure is false, 'redeploy', or 'fix-and-regrade'.
export function classifyEndState(s) {
  if (s.identityViolation) return { cls: 'identity-violation', cure: false };
  // ADR-0011 (2026-08-06) — a live URL no longer means "done". Delivery is now unconditional on
  // quality, so EVERY below-bar ending arrives here with liveUrl set. Short-circuiting on liveUrl
  // therefore made the whole fix-and-regrade lane — the deterministic near-miss cure built
  // 2026-07-19 as the systemic fix for the 07/15-07/17 streak, unit-tested against three real
  // incidents — unreachable overnight. A near-miss that used to be repaired to ~90 for ~$1 would
  // have shipped at 84 with an email offering the customer a full-cost manual rebuild: replacing an
  // automatic repair that already exists, is already tested, and is already paid for.
  // Caught in adversarial review the same day, before any customer build ran.
  //
  // The order is DELIVER, THEN IMPROVE. The page is already live and the customer already has it —
  // that floor is never given back. The cure can only raise the page from there, and the runner
  // redeploys ONLY on a strictly better verdict, so this can never downgrade what was delivered.
  if (s.liveUrl) {
    if (s.quality?.passed === true) return { cls: 'shipped', cure: false };
    // tools/deploy.mjs delivers a gate-refused page too (ADR-0011) — it must still reach the cure.
    const refusalLive = gateRefusalWeakness(s);
    if (refusalLive) return { cls: 'shipped-gate-refusal', cure: 'improve-and-redeploy', weaknesses: [refusalLive] };
    const weaknesses = namedWeaknesses(s.quality);
    if (!weaknesses.length) return { cls: 'shipped', cure: false };
    // The lane ADR-0011 review row 1 restored is the NEAR-MISS repair ("a near-miss that used to be
    // auto-repaired to ~90 for ~$1"), not a repair of every delivered page: diffuse mediocrity or a
    // slop axis gets the same honest "no cure" a held page gets, instead of a 10-minute cure agent
    // plus a full regrade that the ratchet will almost always throw away.
    if (!isNearMiss(s.quality, weaknesses)) return { cls: 'shipped-below-bar', cure: false, weaknesses };
    return { cls: 'shipped-below-bar', cure: 'improve-and-redeploy', weaknesses };
  }
  if (s.killedForBudget) return { cls: 'budget-exhausted', cure: false };
  if (s.spawnError || s.exitCode !== 0) return { cls: 'crash', cure: false };
  const q = s.quality;
  const refusal = gateRefusalWeakness(s);
  if (refusal) return { cls: 'gate-refusal', cure: 'fix-and-regrade', weaknesses: [refusal] };
  if (!s.siteExists || !q || !Array.isArray(q.scorecard) || q.scorecard.length === 0) {
    return { cls: 'unbuilt', cure: false }; // env/preflight failures land here — nothing graded to verify
  }
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

// THE RATCHET's verdict (ADR-0011): may the cured page REPLACE a live one? Only on a strictly better
// measured result. A live page that was delivered on a pre-check refusal has no scores to beat; a
// cured version that now clears the pre-check AND carries a real vision grade is the better page.
export function cureImproved(preQ, postQ) {
  const pre = scoreOf(preQ);
  const post = scoreOf(postQ);
  if (!post || hasGateRefusal(postQ)) return { improved: false, pre, post };
  if (!pre) return { improved: hasGateRefusal(preQ), pre, post };
  return { improved: post.min > pre.min || (post.min === pre.min && post.mean > pre.mean + 0.5), pre, post };
}

function isNearMiss(q, weaknesses) {
  const inEnvelope = (q.scorecard || []).every((dev) => {
    const axes = deviceAxes(dev);
    if (!axes.length) return false;
    const mean = axes.reduce((a, b) => a + b, 0) / axes.length;
    return mean >= CURE.MEAN_FLOOR && Math.min(...axes) >= CURE.MIN_AXIS_FLOOR;
  }) && weaknesses.length >= 1 && weaknesses.length <= CURE.MAX_WEAKNESSES;
  // An agent-documented post-cap fix is honored even outside the envelope (427ffbb behavior):
  // there is something concrete and new to verify, which is the whole test.
  return inEnvelope || Boolean(q.postCapManualFix && Number.isInteger(q.iterations) && q.iterations >= 3);
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
- Do NOT run deploy (the runner deploys through the ship-bar rail on the fresh verdict).
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

// ── CURE SNAPSHOT (review finding 4, 2026-11-05) ─────────────────────────────────────────────────
// When the page is already live and the cure does NOT replace it (not improved, cure agent failed,
// grade errored, redeploy failed), the build dir must describe the page that is actually live.
// Before this, site/, the regrade's screenshots (assets/) and build.json kept the REPAIRED
// version, so the status gist and the requester email reported scores and screenshots of a page
// nobody deployed. Snapshot right before the cure agent touches anything; restore on those paths.
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

// ── $ BUDGET (review finding 8, 2026-11-05) ──────────────────────────────────────────────────────
// The primary stop is Claude Code's own --max-budget-usd (present in the CI-pinned 2.1.201: it
// ends the run with a `result` event of subtype "error_max_budget_usd"). The streamed meter below
// is a BACKSTOP in case that flag is ignored: total_cost_usd only arrives on the final `result`
// event, so without it the $ ceiling was never enforced during the main run.
export function maxBudgetArgs(usd) {
  const n = Number(usd);
  // Floor at one cent: the CLI rejects 0, and a sub-cent remainder must still be a ceiling.
  return Number.isFinite(n) && n > 0 ? ['--max-budget-usd', String(Math.max(0.01, Math.round(n * 100) / 100))] : [];
}

// $/Mtok [input, output], mirrored from src/claude.mjs RATES (claude-sonnet-5-5 = [2, 10]).
const STREAM_RATES = { 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-fable-5-1': [10, 50], 'claude-opus-5': [5, 25], 'claude-haiku-5-5': [0.1, 0.5] };
export const USD_BACKSTOP_FACTOR = 1.25; // fires only if the native cap failed to

export function rateFor(model) {
  // The OpenRouter lane names the same model 'anthropic/claude-sonnet-5.5'.
  const id = String(model || '').replace(/^anthropic\//, '').replace(/\./g, '-');
  return STREAM_RATES[id] || null;
}

// One API message can surface as several stream-json `assistant` events (one per content block),
// each carrying the SAME message.id and usage. Summing every event would double count, so cost is
// keyed by message.id and the largest figure seen for that id wins. Events with no id are summed
// (over-counting is the safe direction for a ceiling). Cache writes priced at 1.25x input and
// cache reads at 0.1x input (standard Anthropic prompt-caching multipliers).
export function createCostMeter(model) {
  const rate = rateFor(model);
  const byId = new Map();
  let anon = 0;
  return {
    known: Boolean(rate),
    add(evt) {
      if (!rate || evt?.type !== 'assistant') return;
      const u = evt.message?.usage;
      if (!u) return;
      const [rin, rout] = rate;
      const usd = ((u.input_tokens || 0) * rin + (u.cache_creation_input_tokens || 0) * rin * 1.25
        + (u.cache_read_input_tokens || 0) * rin * 0.1 + (u.output_tokens || 0) * rout) / 1e6;
      const id = evt.message?.id;
      if (id) byId.set(id, Math.max(byId.get(id) || 0, usd));
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
