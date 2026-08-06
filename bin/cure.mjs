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
    const weaknesses = namedWeaknesses(s.quality);
    if (!weaknesses.length) return { cls: 'shipped', cure: false };
    return { cls: 'shipped-below-bar', cure: 'improve-and-redeploy', weaknesses };
  }
  if (s.killedForBudget) return { cls: 'budget-exhausted', cure: false };
  if (s.spawnError || s.exitCode !== 0) return { cls: 'crash', cure: false };
  const q = s.quality;
  if (!s.siteExists || !q || !Array.isArray(q.scorecard) || q.scorecard.length === 0) {
    return { cls: 'unbuilt', cure: false }; // env/preflight failures land here — nothing graded to verify
  }
  if (q.passed === true) return { cls: 'graded-pass-undeployed', cure: 'redeploy' };
  const weaknesses = namedWeaknesses(q);
  const inEnvelope = (q.scorecard || []).every((dev) => {
    const axes = deviceAxes(dev);
    if (!axes.length) return false;
    const mean = axes.reduce((a, b) => a + b, 0) / axes.length;
    return mean >= CURE.MEAN_FLOOR && Math.min(...axes) >= CURE.MIN_AXIS_FLOOR;
  }) && weaknesses.length >= 1 && weaknesses.length <= CURE.MAX_WEAKNESSES;
  // An agent-documented post-cap fix is honored even outside the envelope (427ffbb behavior):
  // there is something concrete and new to verify, which is the whole test.
  if (inEnvelope || (q.postCapManualFix && Number.isInteger(q.iterations) && q.iterations >= 3)) {
    return { cls: 'near-miss', cure: 'fix-and-regrade', weaknesses };
  }
  return { cls: 'below-bar', cure: false, weaknesses };
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
