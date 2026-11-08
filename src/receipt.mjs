// src/receipt.mjs — what a local build prints at the end: timing table, cost receipt, summary, quality gap.
// The receipt prints on EVERY exit path including a held build, which still spent money.

import { readContext, mergeSlot } from './build-context.mjs';
import { getBrainSpend, isOpenRouterModel } from './claude.mjs';
import { C, log } from './runtime.mjs';

// Per-station wall-clock table. PURE: rows = runStations results.
export function stationTimingTable(rows = []) {
  const list = (rows || []).filter((r) => r && r.id);
  const w = Math.max('station'.length, 'total'.length, ...list.map((r) => String(r.id).length));
  const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0).toFixed(1);
  const lines = [`${'station'.padEnd(w)}  seconds`];
  for (const r of list) lines.push(`${String(r.id).padEnd(w)}  ${fmt(r.sec)}${r.ok ? '' : '  (failed)'}`);
  const total = Math.round(list.reduce((t, r) => t + (Number.isFinite(r.sec) ? r.sec : 0), 0) * 10) / 10;
  lines.push(`${'total'.padEnd(w)}  ${fmt(total)}`);
  return lines;
}

export function formatImagesCost(images = {}) {
  if (images && images.usd === null) return `images UNPRICED (${images.images || 0})`;
  return `images $${((images && images.usd) || 0).toFixed(4)} (${(images && images.images) || 0}, derived)`;
}

// quality-grade records usd:null (basis UNPRICED) for a vision model with no known rate — never print it as $0.
export function formatGradingCost(grading = {}) {
  const calls = (grading && grading.calls) || 0;
  if (grading && grading.usd === null) return `grading UNPRICED (${calls} calls, no known rate for the vision model)`;
  return `grading $${((grading && grading.usd) || 0).toFixed(4)} (${calls} calls, derived)`;
}

// How the brain figure was obtained, from the lane(s) that actually ran. OpenRouter reports a real charge per
// call; direct Anthropic calls are derived from rates; the Claude Code CLI lane records no spend at all.
export function brainBasis(brain = {}) {
  if (!brain.calls) return 'none recorded (the Claude Code CLI lane records no spend)';
  const models = Object.keys(brain.byModel || {});
  const measured = models.some(isOpenRouterModel);
  const derived = models.some((m) => !isOpenRouterModel(m));
  if (measured && derived) return 'mixed: OpenRouter usage.cost where that lane ran, otherwise derived from rates';
  return measured ? 'measured (OpenRouter usage.cost)' : 'derived from rates';
}

export function printTiming(outDir, stations) {
  if (!Array.isArray(stations) || !stations.length) return;
  try { mergeSlot(outDir, 'timing', { stations: stations.map((r) => ({ id: r.id, ok: r.ok, sec: r.sec })) }); } catch { /* best-effort */ }
  for (const line of stationTimingTable(stations)) log(`${C.dim}${line}${C.reset}`);
}

// Partial (--from/--only) runs print only timing: a slice's spend would understate the build's real total.
export function printReceipt(outDir, startedAt, stations = null) {
  try {
    const ctx = readContext(outDir);
    const brain = getBrainSpend();
    const basis = brainBasis(brain);
    const images = ctx.visuals?.cost || { usd: 0, images: 0 };
    const grading = ctx.quality?.cost || { usd: 0, calls: 0 };
    // generate-image records usd:null when any image has no known price — never print that as $0.
    const unpriced = [images.usd === null && 'images', grading.usd === null && 'grading'].filter(Boolean);
    const total = Math.round((brain.usd + (images.usd || 0) + (grading.usd || 0)) * 1e4) / 1e4;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    mergeSlot(outDir, 'cost', { totalUsd: total, brain: { ...brain, basis }, images, grading, elapsedSec });
    log('');
    log(`${C.bold}Cost:${C.reset} ${C.green}$${total.toFixed(4)}${unpriced.length ? ` + unpriced ${unpriced.join(' + ')}` : ''}${C.reset}  ${C.dim}= brain $${brain.usd.toFixed(4)} (${brain.calls} calls, ${basis})`
      + ` + ${formatImagesCost(images)}`
      + ` + ${formatGradingCost(grading)}${C.reset}`);
    log(`${C.bold}Time:${C.reset} ${elapsedSec}s`);
    printTiming(outDir, stations);
  } catch { /* a receipt must never be the thing that fails a good build */ }
}

export function finalSummary(outDir) {
  log(`\n${C.green}${C.bold}Done.${C.reset} build dir: ${outDir}`);
  try {
    const ctx = readContext(outDir);
    if (ctx.publish?.liveUrl) log(`${C.green}live: ${ctx.publish.liveUrl}${C.reset}`);
    if (ctx.publish?.explainerRepoUrl) log(`${C.dim}repo: ${ctx.publish.explainerRepoUrl}${C.reset}`);
    if (ctx.quality?.passed != null) log(`${C.dim}quality passed: ${ctx.quality.passed}${C.reset}`);
    // The one star ask, at the one moment it is earned: most npx users never see the GitHub page.
    log(`\n${C.dim}If this was worth your time, a star helps others find it: ${C.reset}https://github.com/stuinfla/Repo-Explainer`);
  } catch { /* best-effort summary */ }
}

export function reportQualityGap(quality) {
  if (!quality || !Array.isArray(quality.scorecard)) { log(`${C.red}quality gate: no scorecard available${C.reset}`); return; }
  log(`\n${C.bold}Quality scorecard — below the SHIP bar (need, on both devices: mean ≥ 82, worst axis ≥ 70, real legible architecture+flow diagrams, and the comprehension operators YES). World-class target is mean ≥ 90 / worst ≥ 85 / all 6 operators.${C.reset}`);
  for (const c of quality.scorecard) {
    log(`  ${C.bold}${c.device}${C.reset}: mean ${c.meanScore}, worst axis ${c.headlineScore}, diagrams ${c.inv18?.passed ? 'ok' : 'FAIL'}, passed ${c.passed ? C.green + 'yes' + C.reset : C.red + 'no' + C.reset}`);
  }
  const seen = new Set();
  for (const n of (quality.refineNotes || [])) {
    const k = n.device + n.criterion;
    if (seen.has(k)) continue; seen.add(k);
    log(`   ${C.yellow}• [${n.device}] ${n.criterion} (${n.score})${C.reset} ${C.dim}${String(n.saw || n.note || '').replace(/\s+/g, ' ').slice(0, 150)}${C.reset}`);
  }
}
