// kb.config.mjs — Config registry for the generic, config-driven KB pipeline.
// P0 scaffold: the `agent-harness-generator` ("MetaHarness") target entry only.
// Binding: build-plan-metaharness.md §2a [D10, A]. ONE target until ≥98 + sign-off [L].
//
// Mechanics are preserved from the proven Cognitum prototype; repo-shape becomes DATA here.
// All on-page commands + KB `mustContain` facts use `metaharness` as PRIMARY,
// note `create-agent-harness` as the ALIAS (same tool; reconciliation note in the plan §0).

/**
 * componentWord synonym group — first-class config knob injected into every intent regex
 * in ask-kb.mjs. AHG is npm-package-based (`packages/<name>`), NOT crate-based, so the
 * hard-coded "crate" token in the prototype must be widened or Stage-3/4 retrieval under-fires.
 * (Top risk #1 in the plan.)
 */
const componentWord = ['crate', 'package', 'module', 'component'];

/** @type {Record<string, object>} keyed by target slug. */
export const targets = {
  'agent-harness-generator': {
    // ── Identity ────────────────────────────────────────────────────────────
    slug: 'agent-harness-generator',
    metaName: 'MetaHarness',
    // Canonical CLI is `npx metaharness`; `create-agent-harness` is the internal-package alias.
    productNames: [
      'metaharness',                    // canonical CLI (README header)
      'MetaHarness',                    // product / brand name
      'create-agent-harness',           // alias CLI (internal package packages/create-agent-harness)
      'agent-harness-generator',        // repo slug
      '@ruvnet/agent-harness-generator',// published library name
      '@metaharness/kernel',            // kernel package
      '@metaharness/router',            // model router package
      '@metaharness/darwin',            // Darwin Mode package
    ],
    // primer slug(s): EXPLICIT archetype -> PRIMER#<slug> map. Discovered from the live sidecar
    // (slugify of each ## section title). Explicit beats 'auto' because two arc titles
    // ("where do I read about the architecture", "how do I start the fastest") do not match the
    // generic AUTO_SLUG_CUES regexes, so auto-discovery would miss the docs/playbook routes.
    // ask-kb resolvePrimerSlug() consumes target.primerSlugs as an object first.
    primerSlugs: {
      whatis:       'PRIMER#1-what-is-metaharness',
      capabilities: 'PRIMER#2-what-can-the-tool-do-to-a-repo',
      crates:       'PRIMER#3-what-packages-make-up-metaharness',
      composer:     'PRIMER#4-how-does-the-composer-scaffold-a-harness',
      maturity:     'PRIMER#5-is-this-production-ready-maturity-and-honest-limits',
      docs:         'PRIMER#6-where-do-i-read-about-the-architecture',
      adr:          'PRIMER#6-where-do-i-read-about-the-architecture',
      playbook:     'PRIMER#7-how-do-i-start-the-fastest-end-to-end',
    },

    // ── Source scope (force-walk; NO .gitmodules in this repo → walk no-op) ──
    repoDir: '../.targets/agent-harness-generator',
    // Constraint A: clone ONLY the target's own tree; never index a vendor tree.
    scopeExclude: [
      'node_modules',
      'target',
      'dist',
      'build',
      '.git',
      'pkg',
      '.next',
      'coverage',
      '.vite',
    ],

    // ── Extension classes (what each file is, by suffix) ─────────────────────
    // code: bodies swept via sourceBodies / docCommentSweep rule types.
    codeExt: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs'],
    // fullText: prose swept verbatim (untruncated) via mdSweepFullText.
    fullTextExt: ['.md', '.mdx', '.txt'],
    // template: the .tmpl/.hbs harness scaffolding (294 files) — first-N-lines + path,
    // kind:'template'. Stage-4/7 "what does a generated harness contain" depends on these.
    templateExt: ['.tmpl', '.hbs', '.handlebars'],

    // ── Component model ──────────────────────────────────────────────────────
    // componentRoots per plan §2a. NOTE: repo ALSO has crates/, apps/, examples-packages/;
    // plan specifies ["packages"] only for P0 — see deviation note in the P0 report.
    componentRoots: ['packages'],
    componentWord, // ['crate','package','module','component'] synonym group

    // ── Disambiguation / off-topic magnets (filled during gate-A tuning, P6a) ──
    disambiguation: [],
    offtopicMagnets: [],

    // ── Corpus include rules (consumed by build-kb.mjs / corpus-rules.mjs in P1) ──
    // P0 lays the intent; rule-type implementations land in P1 (corpus-rules.mjs).
    include: [
      { rule: 'mdSweepFullText', roots: ['docs', 'docs/adrs', '.'] }, // README + docs + ADRs, verbatim
      { rule: 'componentManifests', roots: ['packages'] },            // package.json per component
      { rule: 'componentLead', roots: ['packages'] },                 // each package README / lead doc
      { rule: 'sourceBodies', roots: ['packages'], ext: ['.ts', '.tsx', '.js', '.mjs', '.rs'] },
      { rule: 'docCommentSweep', roots: ['packages', 'crates'] },     // doc comments only
      { rule: 'literalFiles', files: ['README.md', 'docs/OVERVIEW.md', 'docs/ARCHITECTURE.md', 'docs/USAGE.md', 'docs/USERGUIDE.md'] },
      { rule: 'templates', roots: ['packages'], ext: ['.tmpl', '.hbs', '.handlebars'], headLines: 40 },
    ],

    // ── Verification queries: ONE per arc stage (7 total) ─────────────────────
    // Arc: why-built → what-problem/capabilities → inventory → how-each-works(composer)
    //      → maturity → docs-where → end-to-end-usage. Facts verified against source 2026-06-19.
    verificationQueries: [
      {
        stage: 1,
        arc: 'what-is-it',
        query: 'What is metaharness?',
        wantPaths: ['README.md', 'docs/OVERVIEW.md'],
        mustContain: ['factory for agent frameworks', 'harness is the product', 'npx metaharness'],
      },
      {
        stage: 2,
        arc: 'capabilities',
        query: 'What can the tool do to a repo?',
        wantPaths: ['README.md', 'docs/USAGE.md'],
        mustContain: ['score', 'genome', 'mcp-scan', 'threat-model', 'router', 'Darwin'],
      },
      {
        stage: 3,
        arc: 'inventory-components',
        query: 'What packages make up metaharness?',
        wantPaths: ['packages', 'docs/ARCHITECTURE.md'],
        mustContain: ['kernel', 'host-claude-code', 'router', 'darwin', 'three-layer'],
      },
      {
        stage: 4,
        arc: 'how-each-works-composer',
        query: 'How does the composer scaffold a harness?',
        wantPaths: ['docs/adrs/ADR-003-generator-architecture.md', 'docs/ARCHITECTURE.md'],
        // Composer 7 stages, verified ADR-003 lines 104–110.
        mustContain: ['Identity', 'Hosts', 'Primitives', 'Agents', 'Skills', 'Plugins', 'Features', 'mcp'],
      },
      {
        stage: 5,
        arc: 'maturity',
        query: 'Is this production-ready?',
        wantPaths: ['README.md', 'docs/USERGUIDE.md'],
        mustContain: ['v0.1.x beta', '568', 'never'],
      },
      {
        stage: 6,
        arc: 'docs-where-things-live',
        query: 'Where do I read about the architecture?',
        wantPaths: ['docs/ARCHITECTURE.md', 'docs/adrs'],
        mustContain: ['ARCHITECTURE.md', 'OVERVIEW.md', 'USERGUIDE.md', 'INDEX.md'],
      },
      {
        stage: 7,
        arc: 'end-to-end-usage',
        query: 'How do I start the fastest?',
        wantPaths: ['README.md', 'docs/USAGE.md'],
        mustContain: ['npx metaharness --wizard', '--template', '--host', 'npm install'],
      },
    ],

    // ── Bundle metadata (consumed by make-bundles.mjs in P1/P7) ───────────────
    bundle: {
      blurb:
        'MetaHarness drop-in knowledge base — mint a custom AI agent harness from any repo. ' +
        'Two halves: for-ai/ (RVF + retrieval brain + MCP server) and for-humans/ (the primer). ' +
        'Canonical CLI `npx metaharness` (alias `create-agent-harness`).',
      questions: [
        'What is metaharness and what does it produce?',
        'What can the tool do to a repo before I build?',
        'How does the composer scaffold a harness end-to-end?',
        'Is this production-ready and what are its honest limits?',
        'How do I start the fastest?',
      ],
    },
  },
};

/** Default target for CLI scripts that omit --target while only one repo is in scope [L]. */
export const defaultTarget = 'agent-harness-generator';

/** Lookup helper used by build-kb / ask-kb / guard-check / grade-kb / gate. */
export function getTarget(slug = defaultTarget) {
  const t = targets[slug];
  if (!t) {
    throw new Error(
      `kb.config.mjs: unknown target "${slug}". Known: ${Object.keys(targets).join(', ')}`,
    );
  }
  return t;
}

export default { targets, defaultTarget, getTarget };
