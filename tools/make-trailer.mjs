#!/usr/bin/env node
// make-trailer.mjs — the Alive Kit's VERIFIED capability #1 (ADR-0009 §3, pilot receipts
// 2026-07-16: 38s 1080p, $0 render, embedded live on the agentic-kit page).
//
// JOB: scaffold a ready-to-author HyperFrames trailer project from a FINISHED, GATED build —
// reusing the expensive creative truth instead of regenerating it: the concept palette becomes
// the design tokens, the story arc becomes the storyboard skeleton, the page's gated assets
// (animated hero SVG, hero art, diagrams, social card) become the pre-staged asset inventory.
// The authoring itself runs in YOUR local Claude Code session (subscription-covered) via the
// HyperFrames skills; this tool prints the exact prompt to paste.
//
// LOCAL-DOOR-ONLY (ADR-0009 §2, enforced): refuses to run in CI. Fail-open by placement: this
// tool is never invoked by the pipeline — a trailer failure cannot touch a shipped page.
//
// Usage: node tools/make-trailer.mjs <build-dir>     e.g. node tools/make-trailer.mjs explainer-builds/agentic-kit

import fs from 'node:fs';
import path from 'node:path';

if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.error('make-trailer: refusing to run in CI — the Alive Kit is local-door-only (ADR-0009 §2).');
  process.exit(1);
}

const buildDir = path.resolve(process.argv[2] || '');
const bjPath = path.join(buildDir, 'build.json');
if (!process.argv[2] || !fs.existsSync(bjPath)) {
  console.error('usage: node tools/make-trailer.mjs <build-dir>   (a completed build with build.json + site/)');
  process.exit(2);
}
const bc = JSON.parse(fs.readFileSync(bjPath, 'utf8'));
if (bc.quality?.passed !== true) {
  console.error('make-trailer: this build has not passed the quality gate — companions consume GATED builds only (ADR-0009 §3).');
  process.exit(1);
}

const slug = bc.repo?.slug || path.basename(buildDir);
const liveUrl = bc.publish?.liveUrl || '(not deployed)';
const concept = bc.concept || {};
const story = concept.story || {};
const proj = path.join(buildDir, 'trailer-project');
fs.mkdirSync(path.join(proj, 'source-assets'), { recursive: true });

// Stage the gated assets the trailer will feature (read-only consumption; additive output).
const wanted = ['refusal.svg', 'hero.png', 'architecture.svg', 'flow.svg', 'big-idea.svg', 'insight.svg', 'social-card.png', 'problem.png'];
let staged = 0;
for (const f of wanted) {
  for (const base of [path.join(buildDir, 'assets', f), path.join(buildDir, 'site', 'assets', f)]) {
    if (fs.existsSync(base)) { fs.copyFileSync(base, path.join(proj, 'source-assets', f)); staged++; break; }
  }
}

// The pre-seeded brief: the tournament-winning concept IS the art direction; the story arc IS
// the storyboard spine. This is the whole economic trick — nothing creative is regenerated.
const brief = `# Trailer brief — ${slug} (pre-seeded from the gated build)

Deliverable: a 30–45s, 16:9, 1080p shareable trailer for ${liveUrl}
(a site tour/showcase built from the page's own captured visuals — the proven pilot shape).

## The page's own creative truth (REUSE, don't reinvent)
- Thesis: ${story.thesis || concept.thesis || '(see build.json concept)'}
- Metaphor: ${concept.metaphor || '(see build.json)'}
- Palette: ${typeof concept.palette === 'object' ? JSON.stringify(concept.palette).slice(0, 200) : (concept.palette || '(see build.json)')}
- Story arc: ${(story.arc || concept.arcBeats || []).slice(0, 6).map((b, i) => `\n  ${i + 1}. ${b}`).join('') || ' (see build.json)'}

## Star assets (pre-staged in ./source-assets/)
${wanted.filter((f) => fs.existsSync(path.join(proj, 'source-assets', f))).map((f) => `- ${f}`).join('\n')}
NOTE: the animated hero SVG uses wall-clock CSS/SMIL — it MUST be re-choreographed onto a paused
GSAP timeline (inline the SVG, strip its clocks, drive the same keyframe percentages). Proven
recipe in the ReasoningBank pattern "HyperFrames trailer production" and the agentic-kit pilot.

## Constraints (from ADR-0009)
- Silent (music: none + no SCRIPT.md) unless a $0 audio path exists; social feeds autoplay muted.
- Local render only — never HeyGen cloud. Zero paid media.
- End card: "${slug} — explained" + the live URL + small "built with explainmyrepo.isovision.ai".
- Every frame's labels width-budgeted; contrast gate must pass; eyeball the contact sheet.
`;
fs.writeFileSync(path.join(proj, 'TRAILER-BRIEF.md'), brief);

console.log(`trailer project scaffolded: ${proj}`);
console.log(`  assets staged: ${staged}/${wanted.length} · brief: TRAILER-BRIEF.md`);
console.log('\nNext (in a LOCAL Claude Code session, with the HyperFrames skills installed):');
console.log('  paste →  Using /hyperframes, build the trailer described in ' + path.join(proj, 'TRAILER-BRIEF.md'));
console.log('\nOutput lands at <project>/renders/video.mp4 — copy it to site/assets/trailer.mp4 and redeploy if you want it on the page.');
