// src/brain.mjs — the BRAIN authors (CONTRACT §a: the slots with "no tool").
//
// These are the steps the e2e run proved cannot be deterministic: concept (Station 2), content
// (Station 3), the Station-4 image briefs + diagram ASCII, and the for-humans primer. Each author
// gathers a compact, GROUNDED brief from the real KB the deterministic build-kb station produced
// (summary + dep-graph + entrypoints + symbols + a passage sample + README), hands it to Claude, and
// returns a typed object the orchestrator merges into the owning slot. Grounding is the guardrail:
// the prompt forbids invented facts/benchmarks (CONTRACT INV-06 — every claim traceable to the KB).
//
// STATUS: concept / content / visualBrief / primer authors are WORKING (real prompts, schema-checked
// output). authorKbTarget is the one GATED author — it emits a kb.config.mjs target entry but, by
// default, the orchestrator does NOT mutate the shared registry with it (see src/orchestrator.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { callClaudeJSON, callClaude } from './claude.mjs';

// ── grounding: assemble a bounded text brief from the real KB artifacts ────────────────────────
function readJsonRel(repoRoot, rel) {
  if (!rel) return null;
  const p = path.isAbsolute(rel) ? rel : path.resolve(repoRoot, rel);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function readPassageSample(repoRoot, rel, maxChars = 12_000) {
  if (!rel) return '';
  const p = path.isAbsolute(rel) ? rel : path.resolve(repoRoot, rel);
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return ''; }
  const out = [];
  let used = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const body = String(rec.text || rec.passage || rec.body || '').trim();
    if (!body) continue;
    const snippet = body.slice(0, 600);
    if (used + snippet.length > maxChars) break;
    out.push(`• [${rec.id || rec.path || '?'}] ${snippet}`);
    used += snippet.length;
  }
  return out.join('\n');
}

export function gatherBrief(ctx, repoRoot) {
  const kb = ctx.kb || {};
  const dep = readJsonRel(repoRoot, kb.depGraphPath) || {};
  const ent = readJsonRel(repoRoot, kb.entrypointsPath) || {};
  const sym = readJsonRel(repoRoot, kb.symbolsPath) || {};
  const passages = readPassageSample(repoRoot, kb.passagesPath);
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
  "typePersonality": { "display": "a Google font family name", "sans": "a Google font family name", "mono": "a mono font family name", "fontHref": "https://fonts.googleapis.com/css2?... for the chosen families" },
  "layoutRhythm": ["hero", "problem", "whatItIs", "insight", "howItWorks", "useCases", "getStarted", "pack"]
}`;
  const out = await callClaudeJSON({ apiKey, model, system, user, maxTokens: 2000, temperature: 0.8 });
  if (!out || typeof out !== 'object') throw new Error('authorConcept: model did not return an object');
  if (!out.palette || typeof out.palette !== 'object') throw new Error('authorConcept: missing palette');
  if (!('accent' in out.palette) && !('--accent' in out.palette)) throw new Error("authorConcept: palette must define 'accent'");
  if (!out.tagline) throw new Error('authorConcept: missing tagline');
  return out;
}

// ── Station 3: content (the eight authored sections) ───────────────────────────────────────────
export async function authorContent(ctx, { apiKey, model, feedback }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const voice = ctx.concept?.copyVoice || 'clear, confident, technical-but-human';
  const system = `You are a senior technical writer + narrative designer. You write the copy for a repo explainer page in this voice: ${voice}. ${GROUNDING_RULE}`;
  const user = `${brief}

${revisionBlock(feedback)}Author the "content" slot. The page renders these sections from typed fields — match the shapes EXACTLY. Return JSON:
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
  const out = await callClaudeJSON({ apiKey, model, system, user, maxTokens: 4000, temperature: 0.6 });
  const need = ['hero', 'problem', 'whatItIs', 'insight', 'howItWorks', 'useCases', 'getStarted', 'pack'];
  if (!out?.sections) throw new Error('authorContent: missing sections');
  for (const s of need) if (!out.sections[s]) throw new Error(`authorContent: missing section "${s}"`);
  return out;
}

// ── Station 4 brief: image prompts + diagram ASCII (the brain half of VISUALIZE) ───────────────
// Returns the brain content; the orchestrator stamps fixed, valid px sizes + engine ids so we never
// emit an invalid image size. arch/flow ASCII is grounded by make-diagrams from the real kb graph —
// here we only author their altText + the two judgment diagrams (big-idea, insight).
export async function authorVisualBrief(ctx, { apiKey, model }) {
  const brief = gatherBrief(ctx, ctx._repoRoot);
  const metaphor = ctx.concept?.metaphor || 'a clean technical metaphor';
  const palette = ctx.concept?.palette ? JSON.stringify(ctx.concept.palette) : '(none)';
  const system = `You are an award-winning art director (think Stripe, Linear, Vercel brand work) writing image-generation prompts + ASCII concept diagrams for a repo explainer. The page's visual metaphor is: ${metaphor}. Palette: ${palette}. ${GROUNDING_RULE}

ART DIRECTION — non-negotiable, this is what separates a memorable hero from generic AI slop:
- BAN these clichés outright: glowing neural-network trees, generic floating DNA helixes, holographic "cyber" grids, neon circuit boards, abstract particle clouds, faceless hooded hackers, glowing brains, "matrix" rain. If the metaphor is the obvious one (e.g. DNA for genomics), find a FRESH, specific, unexpected angle on it — never the postcard version.
- Anchor every image to a CONCRETE, specific scene or object grounded in what THIS repo actually does — a real moment, material, or mechanism — not a vague mood. Specificity is what reads as "designed," not "generated."
- Direct it like a real photo/render: name the exact subject, the camera angle, the lighting (e.g. raking low light, soft studio, single hard key), the material/texture, depth of field, and one surprising compositional choice. Editorial photography or refined cinematic 3D — not "digital art."
- It must feel bespoke to this repo: someone who knows the project should think "yes, that's exactly it," and a stranger should think "that's striking."`;
  const user = `${brief}

Author the visual brief. Return JSON:
{
  "hero": { "prompt": "a rich, SPECIFIC, art-directed text-to-image prompt for the HERO image — a concrete subject + camera angle + lighting + material + one unexpected compositional idea, embodying the metaphor WITHOUT the banned clichés; editorial/cinematic quality; no text/words/letters baked into the image" },
  "sections": [
    { "id": "problem", "role": "problem illustration", "prompt": "a specific, art-directed image prompt for the PROBLEM this repo solves — a concrete before-state scene, not an abstract mood; no baked-in text" },
    { "id": "useCase", "role": "scenario", "prompt": "a specific, art-directed image prompt for a concrete real-world use-case scenario — a real moment of someone/something using this; no baked-in text" }
  ],
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
    "architecture":{ "altText": "one-line description of the architecture diagram" },
    "flow":        { "altText": "one-line description of the runtime/process flow diagram" }
  }
}
DIAGRAM RULES (bigIdea + insight are DRAWN as real glassmorphic concept-cards joined by glowing arrows — NEVER ASCII):
- Each "items" entry is ONE short card label: a concrete noun-phrase grounded in the brief (a real component, artifact, or step), <= 42 characters. NO ASCII art, NO box-drawing or pipe characters, NO arrows inside a label.
- Use ONE row with "connect": true for a SEQUENCE (cards joined top-to-bottom by arrows). Use MULTIPLE rows (each "connect": false) for parallel/grouped ideas drawn without an arrow between groups.
- bigIdea = the central mechanism in 3-6 cards (how the pieces combine to do the one big thing). insight = the single clever move in 2-4 cards. Keep BOTH distinct from the architecture diagram — do not just relist every module.`;
  const out = await callClaudeJSON({ apiKey, model, system, user, maxTokens: 2000, temperature: 0.7 });
  if (!out?.hero?.prompt) throw new Error('authorVisualBrief: missing hero.prompt');
  const okRows = (d) => d && Array.isArray(d.rows) && d.rows.length
    && d.rows.every((r) => r && Array.isArray(r.items) && r.items.length
      && r.items.every((s) => (typeof s === 'string' ? s.trim() : (s && String(s.label || '').trim()))));
  if (!okRows(out?.diagrams?.bigIdea) || !okRows(out?.diagrams?.insight)) {
    throw new Error('authorVisualBrief: bigIdea/insight must each provide non-empty rows[].items (short concept-card labels, not ASCII)');
  }
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
    hero: { role: 'metaphor', prompt: brief.hero.prompt, px: '1536x1024', engine: 'gpt-image-2' },
    sections: (brief.sections || []).slice(0, 3).map((s) => ({
      id: s.id, role: s.role || 'illustration', prompt: s.prompt, px: '1024x1024', engine: 'gpt-image-2',
    })),
    bigIdeaDiagram: conceptModel(brief.diagrams.bigIdea, 'How it all fits together'),
    insightDiagram: conceptModel(brief.diagrams.insight, 'The clever move'),
    architectureDiagram: { altText: brief.diagrams.architecture?.altText || '' },
    flowDiagram: { altText: brief.diagrams.flow?.altText || '' },
  };
}

// ── Station 1 brain deliverable: the for-humans primer markdown (make-pack/make-dropin require it) ──
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
  const md = await callClaude({ apiKey, model, system, user, maxTokens: 3000, temperature: 0.4 });
  const primerRel = ctx.kb?.primerPath;
  if (!primerRel) throw new Error('authorPrimer: build.json has no kb.primerPath (run build-kb first)');
  const primerAbs = path.isAbsolute(primerRel) ? primerRel : path.resolve(repoRoot, primerRel);
  fs.mkdirSync(path.dirname(primerAbs), { recursive: true });
  fs.writeFileSync(primerAbs, md.trim() + '\n');
  return primerAbs;
}

// ── GATED: author a kb.config.mjs target entry for an unregistered repo ─────────────────────────
// build-kb wraps `kb/build-kb.mjs --target <slug>`, which requires the slug registered in
// kb/kb.config.mjs (embed block + repoDir -> the clone + corpus rules). The embed block is fixed
// (the project's standard 384-dim bge-small); the corpus rules are judgment, so the brain authors
// them. We return the entry as a plain object — the orchestrator decides whether to write it
// (default: NO, it stops loud; --register-kb: yes). This keeps the shared registry under explicit
// operator control rather than silently edited by a build.
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
  "fullTextExt": [".md",".mdx",".txt"],
  "scopeExclude": ["node_modules","dist","target",".git","coverage","pkg",".next"],
  "include": [
    { "rule": "mdSweepFullText", "roots": ["."] },
    { "rule": "literalFiles", "files": ["README.md","package.json"] },
    { "rule": "sourceBodies", "roots": ["src"], "ext": [".ts",".js",".mjs"] }
  ]
}`;
  const rules = await callClaudeJSON({ apiKey, model, system, user, maxTokens: 1500, temperature: 0.3 });
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
    fullTextExt: rules.fullTextExt || ['.md', '.mdx', '.txt'],
    templateExt: [],
    componentRoots: rules.componentRoots || ['src'],
    componentWord: ['crate', 'package', 'module', 'component'],
    include: rules.include || [
      { rule: 'mdSweepFullText', roots: ['.'] },
      { rule: 'literalFiles', files: ['README.md', 'package.json'] },
      { rule: 'sourceBodies', roots: ['src'], ext: ['.ts', '.js', '.mjs'] },
    ],
  };
}
