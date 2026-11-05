// src/brain.mjs — the BRAIN authors (CONTRACT §a: the slots with "no tool"): concept, content, the visual
// brief (image prompts + concept-diagram rows) and the for-humans primer. Each gathers a compact,
// GROUNDED brief from the real KB, hands it to Claude, and returns a typed object the orchestrator merges
// into the owning slot. Grounding is the guardrail (INV-06): the prompts forbid invented facts/benchmarks.
// authorKbTarget emits a kb.config.mjs entry; kb:register (src/station-runners.mjs) writes it to a per-build overlay.

import fs from 'node:fs';
import path from 'node:path';
import { callClaudeJSON, callClaude } from './claude.mjs';
import { validateHeroScene, sceneAltText, MAX_SCENE_BYTES } from '../tools/diagrams/scene.mjs';

// ── grounding: assemble a bounded text brief from the real KB artifacts ────────────────────────
function readJsonRel(repoRoot, rel) {
  if (!rel) return null;
  const p = path.isAbsolute(rel) ? rel : path.resolve(repoRoot, rel);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
// Which passages the writer sees: a deterministic, offline ranking, never file order. Root README, then
// docs, then source, then ADRs, then the rest; agent boilerplate (AGENTS.md / CLAUDE.md / tool dirs) and loop ledgers (*STATUS.md) are
// skipped, and no file gets more than `perFile` slots until every file has had its turn.
const BOILERPLATE_RE = /(^|\/)(AGENTS|CLAUDE|GEMINI|CODEX)\.md$|(^|\/)\.(claude|codex|cursor|github|windsurf|roo|clinerules)\/|(^|\/)(\.cursorrules|copilot-instructions\.md)$|(^|\/)[\w.-]*STATUS\.md$|(^|\/)[\w.-]*(ledger|LEDGER|Ledger)[\w.-]*\.md$/;
export function passageTier(rec) {
  const p = String(rec?.path || '');
  if (BOILERPLATE_RE.test(p)) return 9;
  if (/^readme(\.[a-z]+)?$/i.test(p)) return 0;
  const kind = String(rec?.kind || '');
  if (kind === 'adr' || /(^|\/)adrs?\//i.test(p)) return 3;
  if (kind === 'doc' && rec?.source_type === 'doc') return 1;
  if (kind === 'source' || kind === 'crate-src') return 2;   // 'crate-src' is the Rust source tag (kb/corpus-rules.mjs)
  return 4;
}
export function selectPassages(records, { maxChars = 12_000, perFile = 3 } = {}) {
  let usable = records.map((rec, i) => ({ rec, i, body: String(rec.text || rec.passage || rec.body || '').trim() }))
    .filter((r) => r.body);
  // Boilerplate is skipped outright unless it is all the repo has.
  if (usable.some((r) => passageTier(r.rec) < 9)) usable = usable.filter((r) => passageTier(r.rec) < 9);
  const ordered = usable.sort((a, b) => passageTier(a.rec) - passageTier(b.rec) || a.i - b.i);
  const seen = new Map();
  const first = [], rest = [];
  for (const r of ordered) {
    const k = r.rec.path || '?';
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    (n < perFile ? first : rest).push(r);
  }
  const out = [];
  let used = 0;
  for (const r of [...first, ...rest]) {
    const snippet = r.body.slice(0, 600);
    if (used + snippet.length > maxChars) break;
    out.push({ rec: r.rec, snippet });
    used += snippet.length;
  }
  return out;
}
function readPassageSample(repoRoot, rel, maxChars = 12_000) {
  if (!rel) return '';
  const p = path.isAbsolute(rel) ? rel : path.resolve(repoRoot, rel);
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return ''; }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip a bad line */ }
  }
  return selectPassages(records, { maxChars })
    .map(({ rec, snippet }) => `• [${rec.id || rec.path || '?'}] ${snippet}`).join('\n');
}
// The repo's own framing of itself (same source + size as the concept-tournament digest).
function readReadmeHead(repoRoot, clonePath, maxChars = 6000) {
  if (!clonePath) return '';
  const dir = path.isAbsolute(clonePath) ? clonePath : path.resolve(repoRoot || '.', clonePath);
  for (const f of ['README.md', 'readme.md', 'README.rst']) {
    try { return fs.readFileSync(path.join(dir, f), 'utf8').slice(0, maxChars).trim(); } catch { /* next */ }
  }
  return '';
}

export function gatherBrief(ctx, repoRoot) {
  const kb = ctx.kb || {};
  const dep = readJsonRel(repoRoot, kb.depGraphPath) || {};
  const ent = readJsonRel(repoRoot, kb.entrypointsPath) || {};
  const sym = readJsonRel(repoRoot, kb.symbolsPath) || {};
  const passages = readPassageSample(repoRoot, kb.passagesPath);
  const readme = readReadmeHead(repoRoot, ctx.repo?.clonePath);
  const components = Array.isArray(dep.nodes) ? dep.nodes.map((n) => n.name || n).slice(0, 40) : [];
  const edges = Array.isArray(dep.internalEdges) ? dep.internalEdges.map((e) => `${e.from}->${e.to}`).slice(0, 60) : [];
  const install = Array.isArray(ent.install) ? ent.install : [];
  const commands = Array.isArray(ent.commands) ? ent.commands.map((c) => `${c.category}: ${c.cmd}`) : [];
  const quickstart = Array.isArray(ent.quickstart) ? ent.quickstart : [];
  return [
    `REPO: ${ctx.repo?.owner || '?'}/${ctx.repo?.name || ctx.repo?.slug || '?'}  (${ctx.repo?.url || ''})`,
    `SUMMARY: ${ctx.understanding?.summary || '(none)'}`,
    `ECOSYSTEMS: ${(dep.ecosystems || []).join(', ') || 'unknown'}`,
    `COMPONENTS (${dep.componentCount ?? components.length}): ${components.join(', ') || '(none)'}`,
    `INTERNAL DEPS: ${edges.join(', ') || '(none)'}`,
    `EXTERNAL DEPS: ${(dep.externalDepNames || []).slice(0, 30).join(', ') || '(none)'}`,
    `PUBLIC SYMBOLS: ${sym.count ?? (Array.isArray(sym.symbols) ? sym.symbols.length : 0)}`,
    `INSTALL: ${install.join(' ; ') || '(none)'}`,
    `COMMANDS: ${commands.join(' ; ') || '(none)'}`,
    `QUICKSTART: ${quickstart.join(' ; ') || '(none)'}`,
    '',
    ...(readme ? ['README (head — the project\'s own framing of itself):', readme, ''] : []),
    'KB PASSAGE SAMPLE (ground every claim in these — do NOT invent facts, numbers, or benchmarks):',
    passages || '(no passages available)',
  ].join('\n');
}

const GROUNDING_RULE = 'Ground every claim in the brief below. Never invent facts, metrics, benchmarks, or version numbers. If something is unknown, omit it rather than guessing.';

// A refine pass hands the brain the harsh critic's per-criterion findings so the rewrite fixes the
// NAMED weaknesses instead of re-rolling blindly. Empty/absent feedback → no block (first authoring).
function revisionBlock(feedback) {
  if (!Array.isArray(feedback) || !feedback.length) return '';
  const lines = feedback.slice(0, 14).map((f) => {
    const what = String(f.saw || f.note || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    return `- ${f.criterion}${f.score != null ? ` (scored ${f.score})` : ''}: ${what}`;
  });
  return `REVISION PASS — a demanding critic graded your previous version and flagged these SPECIFIC weaknesses. `
    + `Fix EACH one concretely in this rewrite; keep what already works. Do not regress strong sections.\n${lines.join('\n')}\n\n`;
}

// ── Station 2: concept (the art-direction brief) ───────────────────────────────────────────────
// Palette knobs MUST be from assemble-page's allow-list; values must avoid ; { } < > url( javascript:
const PALETTE_KNOBS = 'bg, bg-2, surface, surface-2, ridge, ink, ink-2, muted, faint, on-accent, accent (REQUIRED), accent-2, accent-3, spectrum, ok, warn, bad, radius, radius-s, ease, hero-grad-angle';

export async function authorConcept(ctx, { apiKey, model }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const system = `You are an award-winning art director + brand designer. You invent a SPECIFIC visual metaphor for ONE software repo and express it as design tokens. ${GROUNDING_RULE}`;
  const user = `${brief}

Author the "concept" slot for this repo's explainer page. Return JSON:
{
  "metaphor": "a concrete visual metaphor SPECIFIC to this repo (e.g. prism, dossier, orb, lattice) — not generic",
  "heroConcept": "one sentence describing the emotional opening image",
  "copyVoice": "the tone/register for all authored text",
  "tagline": "ONE punchy line (<= 70 chars) for the social card + og:description",
  "palette": { /* keys from this allow-list only: ${PALETTE_KNOBS}. Values are CSS colors/sizes WITHOUT ; { } < > url() . MUST include "accent". Choose colors that carry the metaphor and read well. */ },
  "typePersonality": { "display": "a Google font family name", "sans": "a Google font family name", "mono": "a mono font family name", "fontHref": "https://fonts.googleapis.com/css2?... for the chosen families" }
}`;
  const out = await callClaudeJSON({ apiKey, env: ctx?._env, model, system, user, maxTokens: 6000 });
  if (!out || typeof out !== 'object') throw new Error('authorConcept: model did not return an object');
  if (!out.palette || typeof out.palette !== 'object') throw new Error('authorConcept: missing palette');
  if (!('accent' in out.palette) && !('--accent' in out.palette)) throw new Error("authorConcept: palette must define 'accent'");
  if (!out.tagline) throw new Error('authorConcept: missing tagline');
  return out;
}

// The reader bar both doors write to (ADR-0006 v1.2.0, enforced by the INV-24 reads-at-fifteen gate).
// Exported so a behaviour test can assert the real authorContent request carries it verbatim.
export const READER_STANDARD = `WHO YOU ARE WRITING FOR (ADR-0006 v1.2.0): a curious FIFTEEN-YEAR-OLD.
Not a developer from another field — a bright teenager who has never built software. They must finish
the first four sections able to say, in their own words: what this is, what it would do FOR THEM, why
the trick is clever, and roughly how it works. Three hard rules, measured by a deterministic gate
(INV-24) that fails the build before any vision pass:
  1. SHAPE: one idea per sentence. Most sentences under 20 words, none over 30. The two pages that
     triggered this rule averaged 25 and 39 words per sentence and read at grade 11 and grade 16.
  2. PLAIN WORDS OVER GLOSSED JARGON: prefer "the same login you already use to reach the machine"
     over "SSH session (a secure shell login)". A gloss keeps the jargon; plain words remove it.
     Insider nouns (protocol, endpoint, transport, runtime, schema, stateless, client, server) do not
     belong in rungs 1-4 at all unless the whole page collapses without them.
  3. SAY WHAT IT DOES FOR THEM, AND WHY IT IS CLEVER. "It is a virtual desktop" is a category, not an
     explanation. The reader wants: what can I now do that I could not before, and what is the neat
     idea that makes it work? Name the clever move in one plain sentence a teenager would repeat.
Use everyday comparisons (a vending machine, a locked door with one key, a hotel phone line) instead
of category vocabulary. Never show a file path, a code identifier or a command in rungs 1-4.`;

// ── Station 3: content (the eight authored sections) ───────────────────────────────────────────
export async function authorContent(ctx, { apiKey, model, feedback }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const voice = ctx.concept?.copyVoice || 'clear, confident, technical-but-human';
  const system = `You are a senior technical writer + narrative designer. You write the copy for a repo explainer page in this voice: ${voice}.

${READER_STANDARD}

LEAD WITH WHY IT EXISTS, NOT WITH WHAT IT TECHNICALLY IS. Two failures make a repo look like a
low-level utility, and both are banned:
  - Naming the CATEGORY instead of the point. "It is a virtual desktop" / "it is a starter kit" is a
    shelf label. Open with the change it makes for the reader: what they can now do that they could
    not before, in their own terms.
  - Explaining the ENABLER as if it were the product. The repo's cleverest mechanism is usually what
    makes the real use case possible, not the use case itself. Say what the thing is FOR first, then
    name the trick that makes it work — and say the trick in one sentence a teenager would repeat.
Read the repo's own framing of itself (its README's opening lines) before you decide the thesis: if
the project calls itself one thing and your page sells something smaller, your page is wrong. State
the PRIMARY use case explicitly — the one job a real person would hand it — and be honest about
which parts are real today and which are still planned.

THE COMPREHENSION LADDER (ADR-0006 — non-negotiable altitude control). Your reader is the one defined
above: intelligent and curious, knowing NOTHING about this project's field. The page must carry them
from "never heard of it" to "I could run this now".
- hero, problem, whatItIs, insight (rungs 1-4): assume ZERO domain knowledge. No acronym or term
  of art may appear without a plain-words gloss at first use — better still, just use the plain
  words. A deterministic linter FAILS the build on any unglossed acronym in these four sections.
- problem works from FIRST PRINCIPLES: make the reader FEEL the pain in human, consequence terms
  BEFORE any category vocabulary. Never name the solution's category before the reader feels the
  problem it kills.
- howItWorks may descend ONE technical level — every term still defined at first use.
- useCases and getStarted return to the reader's own world: how THEY would use it, and exactly
  what the experience looks like.
- CONCEPT BUDGET (rungs 1-4): a gloss is not a free pass — ten glossed terms is still ten new
  ideas. Across hero+problem+whatItIs+insight, introduce AT MOST THREE domain concepts, each
  earning a full plain-language sentence; every other technical term either moves down to
  howItWorks or is cut. Before glossing a term, ask whether the reader needs the term at all —
  prefer dropping it. One idea, felt deeply, beats ten ideas named.
Define every acronym at first use EVERYWHERE, like "SSG (pre-building pages as plain files)".

${GROUNDING_RULE} Grounding supplies the FACTS, not the VOCABULARY: translate the repo's insider
terms into plain language — cite the passage, don't parrot its jargon.`;
  // A revision pass must see its previous version, or each rewrite reintroduces fixed weaknesses.
  const prior = (Array.isArray(feedback) && feedback.length && ctx.content)
    ? `YOUR PREVIOUS VERSION (the one the critic graded):\n${JSON.stringify(ctx.content)}\n\nThis is a REVISION, not a rewrite: reproduce the previous version faithfully and change ONLY what the flagged weaknesses require. Keep every sentence that was not flagged.\n\n`
    : '';
  const user = `${brief}

${revisionBlock(feedback)}${prior}Author the "content" slot. The page renders these sections from typed fields — match the shapes EXACTLY. Return JSON:
{
  "arc": [ { "question": "What world am I in?", "section": "hero", "altitude": "high" } ],
  "sections": {
    "hero":       { "eyebrow": "short kicker", "headline": "the big headline", "lede": "one strong paragraph", "sub": "optional supporting line", "ctas": [ { "label": "Get started", "href": "#get-started" }, { "label": "View on GitHub", "href": "${ctx.repo?.url || '#'}", "ghost": true } ], "meta": [ { "label": "Language", "value": "…" } ] },
    "problem":    { "title": "…", "lead": "…", "paragraphs": ["…","…"] },
    "whatItIs":   { "title": "…", "lead": "…", "paragraphs": ["…"], "table": { "caption": "optional", "head": ["Aspect","Detail"], "rows": [["…","…"]] } },
    "insight":    { "title": "…", "lead": "…", "paragraphs": ["…"], "oh": "the one-line aha" },
    "howItWorks": { "title": "…", "lead": "…", "paragraphs": ["…"] },
    "useCases":   { "title": "…", "intro": "…", "cases": [ { "title": "…", "tag": "…", "paragraphs": ["…"] } ] },
    "getStarted": { "title": "…", "intro": "…", "install": "the real install command from the brief", "steps": [ "step one", { "strong": "step", "text": "detail" } ] },
    "pack":       { "title": "…", "intro": "…", "downloadLabel": "Download the knowledge pack" }
  },
  "citations": [ { "claim": "a claim you made", "passageId": "the [id] from the brief that supports it" } ]
}
Rules: 2-4 paragraphs max per section; useCases has 2-3 cases; getStarted.install + steps must come from the brief's INSTALL/COMMANDS/QUICKSTART; cite real passage ids.
GET-STARTED must give real IMPLEMENTATION CONFIDENCE (this is the most-failed axis): the steps must include (a) any PREREQUISITES (toolchain/version), (b) the EXACT command(s) to run, copyable and grounded in the brief, (c) WHAT THE READER WILL SEE when it succeeds (the concrete result/output), (d) what they HAVE at the end, and (e) the NEXT step. Prefer { "strong": "...", "text": "..." } steps so each has a bolded action + concrete detail. If the repo genuinely has no install command or CLI (a pure library), SAY so honestly, then give the real clone → build → test commands and what each produces — never a vague "just explore the code".`;
  // 32k tokens / 300s: a thinking block shares max_tokens with the ~12k JSON answer (#17.2).
  const out = await callClaudeJSON({ apiKey, env: ctx?._env, model, system, user, maxTokens: 32000, timeoutMs: 300_000 });
  const need = ['hero', 'problem', 'whatItIs', 'insight', 'howItWorks', 'useCases', 'getStarted', 'pack'];
  if (!out?.sections) throw new Error('authorContent: missing sections');
  for (const s of need) if (!out.sections[s]) throw new Error(`authorContent: missing section "${s}"`);
  return out;
}


// ── the hero scene (INV-23 / ADR-0013): motion that PERFORMS the repo's central argument ─────────
// Mirrors the hosted door's SKILL.md rules. ONE scene serves phone and desktop, so it is authored on a
// narrow viewBox: the validator (tools/diagrams/scene.mjs) measures text at 390px and refuses < 11px.
export const HERO_SCENE_RULES = `HERO SCENE (heroAnim) — one bespoke animated SVG that PERFORMS this repo's central argument (INV-23).
It replaces the raster hero, so it must carry the page's first impression. Animate the ARGUMENT, never the chrome:
a value changes, something crosses (or pointedly refuses to cross) a boundary, a state flips. Banned as "motion": a dot sliding
along a line, pulsing glows, crawling dashes. Echo the page metaphor so the scene and the palette read as one design.
Hard rules (a validator rejects the scene otherwise; you get ONE repair pass, then the page ships without a scene):
- Root: <svg xmlns="http://www.w3.org/2000/svg" id="hs" viewBox="0 0 400 W" ...> with a unique short id, a <title> and a <desc> (the desc is the alt text). Use viewBox width 400 and height 400-520: ONE scene must work on a 390px phone AND a desktop column.
- All text is real <text>, at least 14 units (a 400-wide scene is ~1x on a phone; smaller text becomes unreadable). No label wider than ~340 units. Sentence case, plain words a fifteen-year-old knows, never ALL-CAPS.
- Animation: CSS @keyframes on opacity/transform only (or <animate>), loop 8-14s. Every CSS selector starts with #<id>, every @keyframes name and every inner id starts with <id> (e.g. #hs .cell, @keyframes hs-snap, id="hs-a"): the SVG is inlined in the page.
- The default (no-animation) render IS the finished static end state; put motion inside @media (prefers-reduced-motion: no-preference){...} so reduced-motion viewers see the complete picture.
- Colours from the page palette (hex values are fine). No <script>, <foreignObject>, event handlers, external urls or images, fonts by name only. Under ${Math.round(MAX_SCENE_BYTES / 1000)} KB.`;

/**
 * Validate the authored scene; ONE repair pass through `repair(defects, svg)`; otherwise fall back to NO scene
 * with the reason disclosed (the build ships with the raster hero instead — never a broken scene).
 * @returns {{ heroAnim: object } | { skipped: string }}
 */
export async function settleHeroScene(raw, repair) {
  const svg = raw && typeof raw === 'object' && typeof raw.sceneSvg === 'string' ? raw.sceneSvg.trim() : '';
  if (!svg) return { skipped: 'the brain authored no hero scene' };
  let defects = validateHeroScene(svg);
  let final = svg;
  if (defects.length) {
    let fixed = null;
    try { fixed = await repair(defects, svg); } catch (e) { return { skipped: `hero scene invalid (${defects.slice(0, 3).join('; ')}); repair call failed: ${e?.message || e}` }; }
    final = typeof fixed?.sceneSvg === 'string' ? fixed.sceneSvg.trim() : '';
    defects = final ? validateHeroScene(final) : ['repair returned no sceneSvg'];
    if (defects.length) return { skipped: `hero scene still invalid after one repair pass: ${defects.slice(0, 4).join('; ')}` };
  }
  return { heroAnim: {
    sceneMarkup: final,
    altText: String(raw.altText || '').trim() || sceneAltText(final),
    caption: typeof raw.caption === 'string' ? raw.caption.trim() : '',
    metaphorTie: typeof raw.metaphorTie === 'string' ? raw.metaphorTie.trim() : '',
  } };
}

async function repairHeroScene(callJSON, base, defects, svg) {
  const system = `You repair ONE animated SVG scene so it passes a validator. Change only what the defects require; keep the idea and the story it performs.\n\n${HERO_SCENE_RULES}`;
  const user = `DEFECTS:\n${defects.map((d) => `- ${d}`).join('\n')}\n\nSCENE:\n${svg}\n\nReturn JSON: { "sceneSvg": "<the corrected full <svg>…</svg> markup>" }`;
  return callJSON({ ...base, system, user, maxTokens: 12000 });
}

// ── Station 4 brief: image prompts + concept-diagram rows (the brain half of VISUALIZE) ────────
// Returns the brain content; visualsSlotFromBrief stamps fixed, valid px sizes. arch/flow are drawn by
// make-diagrams from the real kb graph; the rows authored here are their fallback + the two judgment
// diagrams (big-idea, insight).
export async function authorVisualBrief(ctx, { apiKey, model, callJSON = callClaudeJSON }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const metaphor = ctx.concept?.metaphor || 'a clean technical metaphor';
  const palette = ctx.concept?.palette ? JSON.stringify(ctx.concept.palette) : '(none)';
  const system = `You are an award-winning art director (think Stripe, Linear, Vercel brand work) writing image-generation prompts + concept diagrams for a repo explainer. The page's visual metaphor is: ${metaphor}. Palette: ${palette}. ${GROUNDING_RULE}

ART DIRECTION — non-negotiable, this is what separates a memorable hero from generic AI slop:
- BAN these clichés outright: glowing neural-network trees, generic floating DNA helixes, holographic "cyber" grids, neon circuit boards, abstract particle clouds, faceless hooded hackers, glowing brains, "matrix" rain. If the metaphor is the obvious one (e.g. DNA for genomics), find a FRESH, specific, unexpected angle on it — never the postcard version.
- Anchor every image to a CONCRETE, specific scene or object grounded in what THIS repo actually does — a real moment, material, or mechanism — not a vague mood. Specificity is what reads as "designed," not "generated."
- Direct it like a real photo/render: name the exact subject, the camera angle, the lighting (e.g. raking low light, soft studio, single hard key), the material/texture, depth of field, and one surprising compositional choice. Editorial photography or refined cinematic 3D — not "digital art."
- NO ROOMS, NO PROPS, NO PEOPLE.
  Banned outright from every raster: desks, offices, cafes, windows, plants, coffee cups, notebooks,
  pens, books, phones lying around, sticky notes as set dressing, hands, and any person or part of one.
  A photo of a workspace is scenery: it teaches nothing and could ship on any product's page. Compose
  from the SUBJECT ITSELF — the screens, the artifacts, the object the repo is about — filling the frame.
- EVERY RASTER CARRIES A "takeaway:" LINE as the first line of its prompt: the one sentence a stranger
  should be able to say about THIS repo after looking at the finished pixels. If you cannot write that
  sentence, do not brief an image — say so and let the section carry a diagram instead.
- THE SWAP TEST IS THE BAR: if the finished image could ship unchanged on a different repo's page, it
  has failed. Legible, project-specific text inside the image (a real label, a real value, a real state)
  is the cheapest way to pass it — the image models render short text crisply, so use it.
- It must feel bespoke to this repo: someone who knows the project should think "yes, that's exactly it," and a stranger should think "that's striking."

${HERO_SCENE_RULES}`;
  const user = `${brief}

Author the visual brief. Return JSON:
{
  "hero": { "prompt": "a rich, SPECIFIC, art-directed text-to-image prompt for the HERO image — a concrete subject + camera angle + lighting + material + one unexpected compositional idea, embodying the metaphor WITHOUT the banned clichés; editorial/cinematic quality. MUST include ONE legible, project-specific written artifact (see THE SWAP TEST below)" },
  "sections": [
    { "id": "problem", "role": "problem illustration", "prompt": "a specific, art-directed image prompt for the PROBLEM this repo solves — a concrete before-state scene, not an abstract mood. MUST include ONE legible, project-specific written artifact (see THE SWAP TEST below)" },
    { "id": "useCase", "role": "scenario", "prompt": "a specific, art-directed image prompt for a concrete real-world use-case scenario shown through the SUBJECT ITSELF — the screen, output, or artifact at the moment this repo does its job for someone (no people, hands, desks, or rooms). MUST include ONE legible, project-specific written artifact (see THE SWAP TEST below)" }
  ],
  "heroAnim": { "sceneSvg": "the full animated <svg>…</svg> markup, per the HERO SCENE rules (omit the whole key only if the repo's idea genuinely cannot be shown in motion)", "altText": "one sentence describing what the scene shows happening", "caption": "optional one line under the scene", "metaphorTie": "one sentence: how this scene performs the repo's central argument and echoes the page metaphor" },
  "diagrams": {
    "bigIdea": {
      "title": "a 3-5 word heading for the big-idea diagram (e.g. 'How it all fits together')",
      "rows": [ { "items": ["3 to 6 SHORT concept-card labels (<=42 chars each), in order", "..."], "connect": true } ],
      "altText": "one-line takeaway describing the big idea"
    },
    "insight": {
      "title": "a 3-5 word heading for the insight diagram (e.g. 'The clever move')",
      "rows": [ { "items": ["2 to 4 SHORT concept-card labels (<=42 chars each)"], "connect": true } ],
      "altText": "one-line takeaway describing the key insight"
    },
    "architecture":{
      "altText": "one-line description of the architecture diagram",
      "rows": [ { "items": ["3 to 5 SHORT labels naming the CONCEPTUAL parts a reader must hold in their head, in order", "..."], "connect": true } ]
    },
    "flow":        {
      "altText": "one-line description of the runtime/process flow diagram",
      "rows": [ { "items": ["3 to 5 SHORT labels naming the runtime steps, in order", "..."], "connect": true } ]
    },
    "systemMap": "OPTIONAL — omit this key unless the brief shows a real inputs -> one engine -> surfaces pipeline. Shape: { \"title\": \"What X plugs into\", \"subtitle\": \"...\", \"inputs\": { \"label\": \"YOUR ACCOUNTS\", \"items\": [{ \"name\": \"<=40 chars\", \"sub\": \"...\" }] (1-5), \"note\": \"optional, 2 short lines separated by a newline\" }, \"engine\": { \"name\": \"...\", \"sub\": \"...\", \"steps\": [{ \"title\": \"<=30\", \"sub\": \"<=80\" }] (2-4) }, \"outputs\": { \"label\": \"THREE WAYS TO DRIVE IT\", \"streamLabel\": \"one event stream\", \"items\": [{ \"name\": \"...\", \"cmd\": \"a real command\", \"sub\": \"...\" }] (1-4) }, \"worksWith\": { \"items\": [ { \"name\": \"Claude Code CLI\", \"status\": \"yes\", \"file\": \"README.md\", \"quote\": \"a VERBATIM line from that file, copied from the brief\" }, { \"name\": \"Codex\", \"status\": \"no\", \"terms\": [\"codex\"] } ] (1-6), \"noNote\": \"not mentioned anywhere in the README or source\", \"runsOn\": [\"macOS\", \"Windows\"] } }",
    "decision": "OPTIONAL — omit this key unless the repo visibly CHOOSES among candidates by a rule (picks, ranks, routes, selects). Shape: { \"title\": \"The moment X picks one\", \"subtitle\": \"Illustrative numbers. ...\", \"threshold\": { \"value\": 90, \"label\": \"switch point\" }, \"qualify\": { \"value\": 83, \"label\": \"to qualify\" } or null, \"candidates\": [{ \"name\": \"<=24\", \"value\": 0-100, \"status\": \"active|skipped|picked|eligible\", \"note\": \"short\" }] (2-6, at most one active and one picked), \"steps\": [{ \"title\": \"<=40\", \"sub\": \"<=60\" }] (2-4), \"caption\": \"one line\", \"rule\": { \"file\": \"path\", \"quote\": \"a VERBATIM line of source that defines the rule, copied from the brief\" } }"
  }
}
THE SWAP TEST — the single rule that decides whether an image ships (INV-22 / ADR-0008):
Every raster is judged on two questions. (a) TAKEAWAY: what does a stranger learn about THIS project
from the pixels alone, with the caption covered? (b) SWAP: could this exact image ship unchanged on a
different project's page? An image that fails BOTH caps the whole page's imagery score at 55 — below
the ship floor — however beautiful it is.
- THEREFORE EVERY IMAGE MUST CARRY ONE LEGIBLE, PROJECT-SPECIFIC WRITTEN ARTIFACT: a label on a crate,
  a stamped word, a tag on the object, a screen readout, a chalked number — bearing a real term from
  THIS repo (a module name, a command, an option, an error, a domain noun from the brief). Keep it to
  1-4 words so it renders cleanly. That artifact is what makes the image un-swappable: these props,
  with THESE words, cannot ship on another project's page.
- Put the label on the subject itself (a screen, a stamped artifact, a tag on the object the repo is
  about), never on office set dressing, which stays banned above. A beautiful, wordless image that could
  illustrate any project is exactly what caps a page at 55.
- Still banned: decorative gibberish text, lorem ipsum, invented UI chrome, watermarks, long
  paragraphs, and any word not grounded in the brief. One real term, legibly rendered, is the whole ask.
- The scene itself must still be concrete and art-directed. The artifact EARNS the specificity; it does
  not excuse a generic photograph with a sticker on it.

DIAGRAM RULES (bigIdea + insight are DRAWN as real glassmorphic concept-cards joined by glowing arrows — NEVER ASCII):
- Each "items" entry is ONE short card label: a concrete noun-phrase grounded in the brief (a real component, artifact, or step), <= 42 characters. NO ASCII art, NO box-drawing or pipe characters, NO arrows inside a label.
- Use ONE row with "connect": true for a SEQUENCE (cards joined top-to-bottom by arrows). Use MULTIPLE rows (each "connect": false) for parallel/grouped ideas drawn without an arrow between groups.
- bigIdea = the central mechanism in 3-6 cards (how the pieces combine to do the one big thing). insight = the single clever move in 2-4 cards. Keep BOTH distinct from the architecture diagram — do not just relist every module.
- architecture.rows and flow.rows are a REQUIRED FALLBACK, not decoration (issue #17.4, pacphi). Those two diagrams are normally drawn from the real KB dep-graph and entrypoints. But when a repo's dependency graph is TRIVIAL (a docs vault, a single-module tool — 0 internal edges), a dependency map would be a picture of nothing, so make-diagrams REFUSES to draw one and falls back to your rows instead. Without them the build stops dead at Station 4. Author them for every repo; they cost you two lines and they are the difference between a page and a crash.
- architecture.rows = the CONCEPT of how the thing is built (the 3-5 parts a reader must hold in their head), NOT the package wiring — the wiring is what the grounded renderer already draws when it can. flow.rows = the runtime steps in order.
- systemMap and decision (ADR-0014) are the BETTER answer to "what does it plug into / how does it decide" and REPLACE the architecture / flow drawing when present and verified. They are optional: omit rather than invent. THE TOOL VERIFIES EVERY CLAIM against the real repo and silently drops what it cannot confirm: a "yes"/"partial" must carry a file and a VERBATIM quote that is in that file in the brief; a "no" must list the search terms the tool will grep (use the other hosts / editors / platforms a reader would wonder about — the tool performs the search, you do not assert the absence). Use real commands and real numbers from the source; never paraphrase a quote.`;
  const base = { apiKey, env: ctx?._env, model };
  const out = await callJSON({ ...base, system, user, maxTokens: 24000, timeoutMs: 300_000 });
  if (!out?.hero?.prompt) throw new Error('authorVisualBrief: missing hero.prompt');
  const okRows = (d) => d && Array.isArray(d.rows) && d.rows.length
    && d.rows.every((r) => r && Array.isArray(r.items) && r.items.length
      && r.items.every((s) => (typeof s === 'string' ? s.trim() : (s && String(s.label || '').trim()))));
  if (!okRows(out?.diagrams?.bigIdea) || !okRows(out?.diagrams?.insight)) {
    throw new Error('authorVisualBrief: bigIdea/insight must each provide non-empty rows[].items (short concept-card labels, not ASCII)');
  }
  const scene = await settleHeroScene(out.heroAnim, (defects, svg) => repairHeroScene(callJSON, base, defects, svg));
  delete out.heroAnim;
  if (scene.heroAnim) out.heroAnim = scene.heroAnim; else out.heroAnimSkipped = { reason: scene.skipped };
  return out;
}

// Shape the visuals slot from the brain brief + FIXED deterministic px/engine (CONTRACT §a visuals).
export function visualsSlotFromBrief(brief) {
  // big-idea / insight are now STRUCTURED concept models (rows of short card labels) that make-diagrams
  // DRAWS with the glass-card renderer — never typeset ASCII. Normalise each row to { items:[string], connect }.
  const conceptModel = (d, fallbackTitle) => ({
    rows: (Array.isArray(d?.rows) ? d.rows : []).map((r) => ({
      items: (Array.isArray(r.items) ? r.items : [])
        .map((s) => (typeof s === 'string' ? s : (s && s.label) || '')).map((s) => String(s).trim()).filter(Boolean),
      connect: r && r.connect !== false,
    })).filter((r) => r.items.length),
    title: (d && typeof d.title === 'string' && d.title.trim()) ? d.title.trim() : fallbackTitle,
    altText: (d && typeof d.altText === 'string') ? d.altText : '',
  });
  return {
    hero: { role: 'metaphor', prompt: brief.hero.prompt, px: '1536x1024' },
    sections: (brief.sections || []).slice(0, 3).map((s) => ({
      id: s.id, role: s.role || 'illustration', prompt: s.prompt, px: '1024x1024',
    })),
    bigIdeaDiagram: conceptModel(brief.diagrams.bigIdea, 'How it all fits together'),
    insightDiagram: conceptModel(brief.diagrams.insight, 'The clever move'),
    // #17.4: the brain's rows ride through as the fallback make-diagrams needs when the KB graph is trivial.
    architectureDiagram: conceptModel(brief.diagrams.architecture, 'How it is built'),
    flowDiagram: conceptModel(brief.diagrams.flow, 'What happens to your data'),
    // ADR-0014: optional evidence-backed story models. Carried through UNCHANGED — make-diagrams
    // validates and VERIFIES them against the cloned repo before anything is drawn.
    // The validated hero scene (the raster hero is then skipped by generate-image) or the disclosed reason there is none.
    ...(brief.heroAnim?.sceneMarkup ? { heroAnim: brief.heroAnim } : { heroAnimSkipped: { reason: brief.heroAnimSkipped?.reason || 'no hero scene authored' } }),
    ...(brief.diagrams.systemMap && typeof brief.diagrams.systemMap === 'object' ? { systemMap: brief.diagrams.systemMap } : {}),
    ...(brief.diagrams.decision && typeof brief.diagrams.decision === 'object' ? { decision: brief.diagrams.decision } : {}),
  };
}

// ── Station 1 brain deliverable: the for-humans primer markdown (make-pack requires it) ──
export async function authorPrimer(ctx, { apiKey, model, repoRoot }) {
  const brief = gatherBrief(ctx, repoRoot);
  const name = ctx.understanding?.repoName || ctx.repo?.name || ctx.repo?.slug;
  const system = `You write a top-down, for-humans primer for a code repo — the human half of an AI knowledge pack. Plain markdown, ## section headers, honest and specific. ${GROUNDING_RULE}`;
  const user = `${brief}

Write a primer for "${name}" as markdown. Use these ## sections, in order:
## 1. What is ${name}
## 2. What can it do for you
## 3. What is it made of (the components)
## 4. How it works
## 5. How do I install and use it
## 6. Honest scope and limits
Keep it tight and real; ground every statement in the brief above.`;
  const md = await callClaude({ apiKey, env: ctx?._env, model, system, user, maxTokens: 9000, timeoutMs: 300_000 });
  const primerRel = ctx.kb?.primerPath;
  if (!primerRel) throw new Error('authorPrimer: build.json has no kb.primerPath (run build-kb first)');
  const primerAbs = path.isAbsolute(primerRel) ? primerRel : path.resolve(repoRoot, primerRel);
  fs.mkdirSync(path.dirname(primerAbs), { recursive: true });
  fs.writeFileSync(primerAbs, md.trim() + '\n');
  return primerAbs;
}

// ── Author a kb.config.mjs target entry for an unregistered repo ────────────────────────────────
// build-kb needs the slug registered (embed block + repoDir + corpus rules). The embed block is fixed
// (384-dim bge-small); the corpus rules are judgment, so the brain authors them. Returned as a plain
// object; kb:register writes it to this build's overlay (the tracked kb.config.mjs is never edited).
export async function authorKbTarget(ctx, { apiKey, model }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const slug = ctx.repo?.slug;
  const clonePath = ctx.repo?.clonePath;
  const system = `You configure a code-indexing corpus for one repo. Decide which roots/extensions to walk and which files matter most. ${GROUNDING_RULE}`;
  const user = `${brief}

Return JSON for this repo's corpus config (only these keys):
{
  "metaName": "display name",
  "productNames": ["key public names / API verbs from the brief"],
  "componentRoots": ["top-level source dirs, e.g. src, bin, examples, crates"],
  "codeExt": [".ts",".js",".mjs"],
  "scopeExclude": ["node_modules","dist","target",".git","coverage","pkg",".next"],
  "include": [
    { "rule": "mdSweepFullText", "roots": ["."] },
    { "rule": "literalFiles", "files": ["README.md","package.json"] },
    { "rule": "sourceBodies", "roots": ["src"], "ext": [".ts",".js",".mjs"] }
  ]
}`;
  const rules = await callClaudeJSON({ apiKey, env: ctx?._env, model, system, user, maxTokens: 5000 });
  return {
    slug,
    metaName: rules.metaName || ctx.understanding?.repoName || slug,
    embed: {
      model: 'Xenova/bge-small-en-v1.5', dim: 384, pooling: 'mean',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      rankScale: 0.6, rvfSuffix: '.rvf',
    },
    productNames: rules.productNames || [],
    repoDir: clonePath,
    scopeExclude: rules.scopeExclude || ['node_modules', 'dist', 'target', '.git', 'coverage', 'pkg', '.next'],
    codeExt: rules.codeExt || ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    componentRoots: rules.componentRoots || ['src'],
    componentWord: ['crate', 'package', 'module', 'component'],
    include: rules.include || [
      { rule: 'mdSweepFullText', roots: ['.'] },
      { rule: 'literalFiles', files: ['README.md', 'package.json'] },
      { rule: 'sourceBodies', roots: ['src'], ext: ['.ts', '.js', '.mjs'] },
    ],
  };
}
