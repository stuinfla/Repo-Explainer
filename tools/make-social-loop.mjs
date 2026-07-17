#!/usr/bin/env node
// make-social-loop.mjs — the Alive Kit's social-loop capability (ADR-0009 §3, verified
// 2026-07-17: agentic-kit pilot — 10.0s 16:9 + 9:16 h264 pair, $0 render, worst-frame
// check passed in BOTH ratios by operator eyeball + gpt-5.6-sol on 1fps contact sheets).
//
// JOB: scaffold a ready-to-author HyperFrames motion-loop project from a FINISHED, GATED
// build — a ≤10s loop of the page's own hero animation, in 16:9 and 9:16. The authoring
// runs in YOUR local Claude Code session via the HyperFrames skills; this tool stages the
// source material and prints the exact prompt to paste.
//
// LOCAL-DOOR-ONLY (ADR-0009 §2 / INV-26, enforced): refuses to run in CI. Fail-open by
// placement (INV-27): never invoked by the pipeline. Read-only consumption (INV-28):
// outputs land under the build dir's loop-project/ and renders/ only.
//
// Usage: node tools/make-social-loop.mjs <build-dir>

import fs from 'node:fs';
import path from 'node:path';

if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.error('make-social-loop: refusing to run in CI — the Alive Kit is local-door-only (ADR-0009 §2).');
  process.exit(1);
}

const buildDir = path.resolve(process.argv[2] || '');
const bjPath = path.join(buildDir, 'build.json');
if (!process.argv[2] || !fs.existsSync(bjPath)) {
  console.error('usage: node tools/make-social-loop.mjs <build-dir>   (a completed build with build.json + site/)');
  process.exit(2);
}
const bc = JSON.parse(fs.readFileSync(bjPath, 'utf8'));
if (bc.quality?.passed !== true) {
  console.error('make-social-loop: this build has not passed the quality gate — companions consume GATED builds only (ADR-0009 §3).');
  process.exit(1);
}

const slug = bc.repo?.slug || path.basename(buildDir);
const liveUrl = bc.publish?.liveUrl || '(not deployed)';
const concept = bc.concept || {};
const proj = path.join(buildDir, 'loop-project');
fs.mkdirSync(path.join(proj, 'source-assets'), { recursive: true });

// Stage what the loop reuses (read-only): the animated hero SVG when it ships as an asset,
// plus the page itself (the animation is often inlined in index.html).
let staged = [];
for (const f of ['refusal.svg', 'hero.png', 'social-card.png']) {
  for (const base of [path.join(buildDir, 'assets', f), path.join(buildDir, 'site', 'assets', f)]) {
    if (fs.existsSync(base)) { fs.copyFileSync(base, path.join(proj, 'source-assets', f)); staged.push(f); break; }
  }
}
const pageSrc = path.join(buildDir, 'site', 'index.html');
if (fs.existsSync(pageSrc)) { fs.copyFileSync(pageSrc, path.join(proj, 'source-assets', 'page.html')); staged.push('page.html (hero animation may be inlined here)'); }

const brief = `# Social-loop brief — ${slug} (pre-seeded from the gated build)

Deliverable: a ≤10s silent motion loop of the page's hero animation, rendered TWICE:
- renders/social-loop-16x9.mp4 (1920x1080) — feeds, README embeds
- renders/social-loop-9x16.mp4 (1080x1920) — shorts/reels/stories

## The page's own creative truth (REUSE, don't reinvent)
- Thesis: ${(concept.story && concept.story.thesis) || concept.thesis || '(see build.json)'}
- Hero animation: the page's animated hero (look for .hero-refusal or assets/refusal.svg in
  ./source-assets/) — this IS the loop's content; do not invent new imagery.
- End the 16:9 with a 1-line closing caption; the 9:16 carries a persistent big title + the
  same caption.

## The proven recipe (agentic-kit pilot, 2026-07-17 — follow it, it earned its scars)
1. The hero animation uses wall-clock CSS/SMIL. Re-choreograph it onto ONE paused GSAP
   timeline (inline the SVG, strip its clocks, reproduce its @keyframes percentages as
   tweens) so every frame is seek-safe for the renderer.
2. NEVER scale-tween an SVG <g> that relies on transform-box:fill-box — the render harness
   collapses it to the canvas origin (a red ghost at top-left). Use opacity-only bursts, or
   tween attributes directly.
3. 9:16 is not a crop — it is a CAMERA. Keep the full stage for the story's wide beats, then
   zoom (~1.5x, transform on a wrapper layer, origin 0 0 with explicit x/y recentring) into
   2 story regions; aim every hold so crop edges fall in empty stage, never mid-card; fade
   any full-width caption text during zooms.
4. VERIFY with the worst-frame doctrine: ffmpeg 1fps contact sheet per ratio, eyeball every
   frame, then a vision-model pass/fail on BOTH sheets. Fix and re-run until both pass.

## Constraints (from ADR-0009)
- Silent. Local render only (hyperframes render -c <composition> — ~15s per ratio, $0).
- Never HeyGen cloud; zero paid media.
- Live page: ${liveUrl}
`;
fs.writeFileSync(path.join(proj, 'LOOP-BRIEF.md'), brief);

console.log(`loop project scaffolded: ${proj}`);
console.log(`  staged: ${staged.join(', ') || '(no assets found — the hero animation is likely inline in the page)'}`);
console.log('\nNext (in a LOCAL Claude Code session, with the HyperFrames skills installed):');
console.log('  paste →  Using /hyperframes (/motion-graphics), build the loop described in ' + path.join(proj, 'LOOP-BRIEF.md'));
console.log('\nOutputs land at <project>/renders/ — copy them to the build dir\'s renders/ when the worst-frame check passes in both ratios.');
