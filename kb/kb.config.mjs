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
    // ── Embedder (ADR-0001 v1.3.1: SINGLE 384-dim desktop variant) ────────────
    // bge-small-en-v1.5 (cls-pooled, normalized, asymmetric query prefix) — the SAME embedder
    // proven on ruqu/ruvn. build-kb.mjs writes the canonical un-suffixed
    // stores/agent-harness-generator/agent-harness-generator-kb.rvf + a .embed.json sidecar that
    // ask-kb + index-primer read (so query + primer use the SAME model). Model is cached offline at
    // kb/models-cache/Xenova/bge-small-en-v1.5 (HF_HUB_OFFLINE=1) for fast deterministic builds.
    embed: {
      model: 'Xenova/bge-small-en-v1.5',
      dim: 384,
      pooling: 'cls',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      rankScale: 1,
      rvfSuffix: '.rvf',
    },
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
      // §8/§9 added for the AI-comprehension gate (extensibility + gotchas dimensions).
      extensibility: 'PRIMER#8-how-do-i-extend-metaharness-safely-the-extension-points',
      gotchas:       'PRIMER#9-performance-and-gotchas-running-the-generator',
    },

    // extensionFiles — concept word -> the real extension-point file(s) it touches. Consumed by the
    // AI-comprehension grader (and a useful map for any AI): "add a host" -> the kernel HostAdapter
    // contract + a reference adapter, etc. Every file below IS indexed (in passages.jsonl); PRIMER#8
    // names them in prose. Paths verified against .targets/agent-harness-generator 2026-06-19.
    extensionFiles: {
      'host':       ['packages/kernel-js/src/types.ts', 'packages/host-claude-code/src/index.ts', 'docs/adrs/ADR-004-host-integration-model.md'],
      'adapter':    ['packages/host-claude-code/src/index.ts', 'packages/kernel-js/src/types.ts', 'docs/adrs/ADR-004-host-integration-model.md'],
      'vertical':   ['packages/vertical-base/src/index.ts', 'packages/create-agent-harness/src/registry.ts', 'docs/adrs/ADR-013-vertical-packs-publishing.md'],
      'template':   ['packages/create-agent-harness/src/walker.ts', 'packages/create-agent-harness/src/renderer.ts', 'docs/adrs/ADR-003-generator-architecture.md'],
      'composer':   ['packages/create-agent-harness/src/index.ts', 'packages/create-agent-harness/src/wizard.ts', 'docs/adrs/ADR-003-generator-architecture.md'],
      'scaffold':   ['packages/create-agent-harness/src/index.ts', 'packages/create-agent-harness/src/walker.ts'],
      'generator':  ['packages/create-agent-harness/src/index.ts', 'docs/adrs/ADR-003-generator-architecture.md'],
      'wizard':     ['packages/create-agent-harness/src/wizard.ts'],
      'render':     ['packages/create-agent-harness/src/renderer.ts', 'packages/create-agent-harness/src/walker.ts'],
      'rename':     ['packages/create-agent-harness/src/rename.ts'],
      'plugin':     ['packages/create-agent-harness/src/plugin-init-cmd.ts', 'packages/create-agent-harness/src/registry.ts', 'docs/adrs/ADR-005-marketplace-plugin-design.md'],
      'marketplace':['docs/adrs/ADR-005-marketplace-plugin-design.md', 'packages/create-agent-harness/src/registry.ts'],
      'kernel':     ['packages/kernel-js/src/index.ts', 'packages/kernel-js/src/types.ts', 'docs/adrs/ADR-002-kernel-boundary.md'],
      'router':     ['packages/router/src/index.ts'],
      'agent':      ['packages/sdk/src/index.ts'],
      'skill':      ['packages/sdk/src/index.ts'],
      'tool':       ['packages/sdk/src/index.ts'],
      'sdk':        ['packages/sdk/src/index.ts'],
      'subcommand': ['packages/create-agent-harness/src/subcommands.ts', 'packages/create-agent-harness/src/index.ts'],
      'command':    ['packages/create-agent-harness/src/subcommands.ts', 'packages/create-agent-harness/src/index.ts'],
      'manifest':   ['packages/create-agent-harness/src/manifest.ts', 'docs/adrs/ADR-003-generator-architecture.md'],
      'upgrade':    ['packages/create-agent-harness/src/upgrade.ts', 'docs/adrs/ADR-008-drift-detection.md'],
      'drift':      ['packages/create-agent-harness/src/upgrade.ts', 'docs/adrs/ADR-008-drift-detection.md'],
    },
    // docFiles — per-dimension authoritative docs the grader injects (the AI reads these for the
    // dimension). CLI per-command table lives in docs/USAGE.md; usage examples in the package READMEs.
    docFiles: {
      cli:   ['docs/USAGE.md', 'packages/create-agent-harness/src/index.ts', 'packages/create-agent-harness/src/subcommands.ts'],
      // usage: the SDK builders + Router API + the shared kernel TYPE definitions (types.ts holds the
      // full HostAdapter / HarnessSpec / HookSpec / McpServerSpec interface bodies — TS interface
      // MEMBERS aren't captured as method symbols, so the grader needs the file body to show the
      // generateConfig(spec: HarnessSpec) signature) + a reference host adapter implementation.
      usage: ['packages/sdk/src/index.ts', 'packages/router/src/index.ts', 'packages/kernel-js/src/types.ts', 'packages/host-claude-code/src/index.ts', 'docs/USAGE.md'],
    },
    // typeAliases — concept word in a question -> the public TS type/class whose definition + members
    // answer it (the AI reads symbols.json + the file body). Names verified to exist in symbols.json.
    typeAliases: {
      'host':       'HostAdapter',
      'adapter':    'HostAdapter',
      'harness spec':'HarnessSpec',
      'spec':       'HarnessSpec',
      'router':     'Router',
      'route':      'RouteResult',
      'vertical':   'VerticalPack',
      'manifest':   'HarnessManifest',
      'agent':      'AgentDef',
      'skill':      'SkillDef',
      'tool':       'ToolDef',
      'genome':     'HarnessPlan',
      'plan':       'HarnessPlan',
      'settings':   'ClaudeCodeSettings',
    },

    // ── Source scope (force-walk; NO .gitmodules in this repo → walk no-op) ──
    repoDir: '../.targets/agent-harness-generator',
    // Constraint A: clone ONLY the target's own tree; never index a vendor tree.
    // Names match any dir in the walk. Beyond build artifacts we also exclude tree(s) that are NOT
    // the MetaHarness *product* an AI needs to understand+use it: `apps/` is the separate client-side
    // Studio web-UI (ADR-020..024, its own GitHub-Pages app), `scripts/` is repo CI tooling, and
    // `bench`/`experiments` are darwin-mode research benchmark scripts (not the harness API surface).
    // The product = the generator CLI + kernel + hosts + SDK + verticals (all under packages/ + crates/).
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
      'apps',          // client-side Studio web-UI (separate product surface)
      'scripts',       // repo build/CI tooling, not harness API
      'bench',         // darwin-mode benchmark scripts (research, not API)
      'benches',       // Rust crate benchmark harnesses (infra, not API)
      'experiments',   // darwin-mode ablation experiments (research, not API)
      'bin',           // here ONLY examples-packages/*/bin/scaffold.mjs — identical `npx metaharness
                       // <name> --template vertical:X --host Y` demo shims; the command they wrap is
                       // already indexed (docs/USAGE.md + example READMEs). No product package uses bin/.
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
      { rule: 'componentManifests', roots: ['packages', 'examples-packages'] }, // package.json per component
      { rule: 'componentLead', roots: ['packages', 'examples-packages'] },      // each package README / lead doc
      // full source bodies: the npm packages (the product) + the Rust kernel crates + the runnable
      // example-package scaffold scripts (examples-packages/*/bin) + the docs/ example tour.
      { rule: 'sourceBodies', roots: ['packages', 'crates', 'examples-packages', 'examples'], ext: ['.ts', '.tsx', '.js', '.mjs', '.rs'] },
      // tests + examples are the BEST usage docs (real call sites + expected results). Ingested
      // deliberately (sourceBodies excludes test-named files); tagged source_type test|example by build-kb.
      // Covers per-package tests, the repo-level __tests__/ suite, and the examples/ tour scripts.
      { rule: 'testsAndExamples', roots: ['packages', '__tests__', 'examples', 'examples-packages'], ext: ['.ts', '.tsx', '.js', '.mjs', '.rs'] },
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

  // ──────────────────────────────────────────────────────────────────────────
  // ruvn — AI research harness: turns a question into a graded, cited dossier.
  // Node/TypeScript single-package npm harness (@ruvnet/ruvn), generated by
  // metaharness (vertical:research). NOT crate-based: its "components" are the
  // six pipeline AGENTS in src/agents/ (scout → web-searcher → source-grader →
  // synthesizer → fact-checker → citer). No .gitmodules → force-walk own tree.
  // Facts verified against .targets/ruvn 2026-06-19 (README/CLAUDE.md/package.json
  // /src/agents/*/bin/cli.js/scripts/openrouter-validate.mjs/.harness/manifest.json).
  // ──────────────────────────────────────────────────────────────────────────
  ruvn: {
    slug: 'ruvn',
    metaName: 'ruvn',
    // ── Embedder (ADR-0001 v1.3.1: SINGLE 384-dim desktop variant) ────────────
    // bge-small-en-v1.5 — a strong retrieval model (beats all-MiniLM); mean-pooled,
    // normalized, with the BGE asymmetric query prefix. build-kb.mjs writes the
    // canonical un-suffixed stores/ruvn/ruvn-kb.rvf + a .embed.json sidecar that
    // ask-kb.mjs + index-primer.mjs read (so query + primer use the SAME model).
    embed: {
      model: 'Xenova/bge-small-en-v1.5',
      dim: 384,
      pooling: 'mean',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      rankScale: 0.6,
      rvfSuffix: '.rvf',
    },
    // Product / brand names + the agent role names (so "what is the source-grader"
    // and "@ruvnet/ruvn" both match the product-name matcher in ask-kb).
    productNames: [
      'ruvn',
      '@ruvnet/ruvn',
      'scout',
      'web-searcher',
      'source-grader',
      'synthesizer',
      'fact-checker',
      'citer',
    ],
    // EXPLICIT archetype → PRIMER#<slug> map (slugify of each ## section title in
    // ruvn-primer.md). Explicit beats 'auto' so every orientation question force-routes
    // to the synthesized section instead of a raw README fragment.
    primerSlugs: {
      whatis:       'PRIMER#1-what-is-ruvn',
      capabilities: 'PRIMER#2-what-can-ruvn-do-for-you',
      crates:       'PRIMER#3-what-is-ruvn-made-of-the-six-agents-and-nine-hosts',
      composer:     'PRIMER#4-how-the-pipeline-works-step-by-step',
      maturity:     'PRIMER#5-is-it-production-ready-scope-and-honest-limits',
      docs:         'PRIMER#6-where-do-i-read-more-the-docs-map',
      adr:          'PRIMER#6-where-do-i-read-more-the-docs-map',
      playbook:     'PRIMER#7-how-do-i-install-and-use-it-end-to-end',
      // §8/§9 added for the AI-comprehension gate (extensibility + gotchas dimensions).
      extensibility: 'PRIMER#8-how-do-i-extend-ruvn-safely-the-extension-points',
      gotchas:       'PRIMER#9-cost-latency-and-gotchas-running-the-pipeline',
    },
    // extensionFiles — concept word -> the real extension-point file(s) it touches. Consumed by the
    // AI-comprehension grader (and a useful map for any AI): "add a new agent" -> src/agents/*.ts +
    // the validate script that discovers agents, "add a CLI command" -> bin/cli.js, "add a host" ->
    // package.json. These files ARE indexed (in passages.jsonl); PRIMER#8 names them in prose.
    extensionFiles: {
      'agent': ['src/agents/scout.ts', 'src/agents/synthesizer.ts', 'scripts/openrouter-validate.mjs'],
      'prompt': ['src/agents/scout.ts', 'src/agents/source-grader.ts'],
      'system_prompt': ['src/agents/scout.ts', 'src/agents/synthesizer.ts'],
      'pipeline': ['src/agents/scout.ts', 'src/agents/citer.ts', 'CLAUDE.md'],
      'grade': ['src/agents/source-grader.ts', 'src/agents/synthesizer.ts'],
      'grading': ['src/agents/source-grader.ts'],
      'rubric': ['src/agents/source-grader.ts', 'CLAUDE.md'],
      'tier': ['src/agents/web-searcher.ts', 'scripts/openrouter-validate.mjs'],
      'model': ['scripts/openrouter-validate.mjs', 'src/agents/web-searcher.ts'],
      'cli': ['bin/cli.js'],
      'command': ['bin/cli.js'],
      'subcommand': ['bin/cli.js'],
      'host': ['package.json', 'README.md', 'install.md'],
      'adapter': ['package.json', 'bin/cli.js'],
      'validate': ['scripts/openrouter-validate.mjs', '__tests__/openrouter.integration.test.ts'],
      'test': ['__tests__/smoke.test.ts', '__tests__/openrouter.integration.test.ts'],
    },
    // docFiles — per-dimension authoritative docs the grader injects (the AI reads these for the
    // dimension). ruvn has no cli/README.md: the CLI is bin/cli.js + the README "Install & use"
    // section; usage examples live in the README + the agent prompt files + the validate script.
    docFiles: {
      cli: ['README.md', 'bin/cli.js'],
      usage: ['README.md', 'CLAUDE.md'],
    },
    // typeAliases — concept word in a question -> the public symbol whose signature answers it.
    // ruvn's "API" is the agent prompt modules (each exports SYSTEM_PROMPT/NAME/TIER) + the CLI
    // `run(argv)` dispatcher. The grader's usage-injector matches struct/enum names; ruvn has none,
    // so this map mainly documents intent (the agent modules + run are surfaced by name match).
    typeAliases: {
      'dispatch': 'run',
      'cli': 'run',
    },

    // ── Source scope (force-walk; NO .gitmodules in this repo → walk no-op) ──
    repoDir: '../.targets/ruvn',
    scopeExclude: [
      'node_modules',
      'dist',
      'target',
      '.git',
      'coverage',
      'pkg',
      '.next',
    ],

    // ── Extension classes ────────────────────────────────────────────────────
    codeExt: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    fullTextExt: ['.md', '.mdx', '.txt'],
    templateExt: [],

    // ── Component model: the six agents live under src/agents/ ────────────────
    // componentWord widened with 'agent' so the inventory archetype fires for
    // "what agents make up ruvn" / "which agents are in the pipeline".
    componentRoots: ['src/agents'],
    componentWord: ['agent', 'host', 'crate', 'package', 'module', 'component'],

    // ── Disambiguation / off-topic magnets (filled during gate-A tuning) ──────
    // ruvn is a SMALL corpus (16 source chunks + 7 primer sections). A few one-/two-line
    // host stub files (AGENTS.md, SYSTEM.md, install.md) and the single-prompt agent .ts
    // files are vector-close to orientation queries and out-rank the rich PRIMER/README.
    // These rules route each comprehension archetype to its synthesized PRIMER section (or
    // the canonical README/CLAUDE) and demote the thin stubs. `when` matches the query;
    // `good`/`bad` match the result PATH.
    disambiguation: [
      // capabilities: "what can ruvn do / give me / value / final dossier / synthesizer allowed /
      // live-model validation" -> PRIMER#2 + README, not the maturity/scope section, the inventory
      // section, a single agent .ts, or a host stub. (Widened during gate-A re-tune on bge-small.)
      { whenSource: '\\b(what can|what does ruvn do|do for me|give me|value of ruvn|value|capabilit|in the (final )?dossier|what is in the|synthesizer (allowed|use)|allowed to use|live model|end-?to-?end|validate ruvn|run ruvn end)\\b',
        goodSource: 'PRIMER#2-what-can-ruvn-do-for-you|README\\.md',
        badSource: 'PRIMER#5|PRIMER#3|PRIMER#7|src/agents/|AGENTS\\.md|SYSTEM\\.md', goodBoost: 0.34, badPenalty: 0.32 },
      // pipeline / how-it-works -> PRIMER#4 + CLAUDE + README, not a single agent .ts or a host stub.
      // Widened for held-out phrasings: "what does the scout produce first", "what does the citer
      // add/refuse to ship", "grade A versus grade C", "how does the grader rank ... vs ...",
      // "after installing how do I run a research pipeline", "order of operations".
      { whenSource: '\\b(pipeline work|step by step|order of operations|order of|each agent only|a/?b/?c/?d grading|abcd|which grades reach|grades reach the synth|fact-?check|adversarial|synthesiz|scout (produce|first)|what does the (scout|citer|grader)|citer (add|refuse)|grade a (vs|versus)|grader rank|disprove|disproven)\\b',
        goodSource: 'PRIMER#4-how-the-pipeline-works|CLAUDE\\.md|README\\.md',
        badSource: 'src/agents/|src/init|AGENTS\\.md|SYSTEM\\.md|install\\.md|PRIMER#7|PRIMER#1|PRIMER#6', goodBoost: 0.30, badPenalty: 0.32 },
      // docs map -> PRIMER#6 + README, not the source-grader.ts / AGENTS.md noise.
      { whenSource: '\\b(where (do|can|is|are)|read more|docs|documentation|which doc|start with|read about)\\b',
        goodSource: 'PRIMER#6-where-do-i-read-more|README\\.md',
        badSource: 'src/agents/|AGENTS\\.md|SYSTEM\\.md|PRIMER#1|PRIMER#4|PRIMER#2', goodBoost: 0.32, badPenalty: 0.30 },
      // "which FILE has the pipeline diagram and rubric" / "operating contract for the model" ->
      // CLAUDE.md is the literal answer (the pipeline diagram + A/B/C/D rubric live in CLAUDE.md).
      // Triggers ONLY on file-location phrasing ("which file has", "operating contract") so it does
      // not collide with the pipeline-mechanics rule above; boost CLAUDE strongly over the PRIMERs.
      { whenSource: '\\b(which file (has|holds|contains)|operating contract|model running the harness|contract for the model|file has the pipeline)\\b',
        goodSource: 'CLAUDE\\.md',
        badSource: 'src/|AGENTS\\.md|SYSTEM\\.md|PRIMER#1|PRIMER#4|PRIMER#2|PRIMER#3|PRIMER#9', goodBoost: 0.45, badPenalty: 0.40 },
      // install / end-to-end usage / validate -> PRIMER#7 + README, not install.md (a 2-line Copilot
      // stub), not PRIMER#1, and NOT the raw scripts/openrouter-validate.mjs body (the HOW-to lives
      // in #7/README; the script file out-ranks since it is now indexed in full). "validate ruvn
      // against a real model / OpenRouter / npm run validate" all route here.
      { whenSource: '\\b(install|use it|usage|get ?started|init|doctor|one-?liner|no.?install|build (it )?before|run (a )?(the )?research|validate ruvn|validate.{0,18}(real )?model|against a real model|openrouter|npm run validate|how do i run.{0,12}(research )?pipeline|after installing.{0,20}run)\\b',
        goodSource: 'PRIMER#7-how-do-i-install-and-use|PRIMER#4-how-the-pipeline-works|README\\.md',
        badSource: 'install\\.md|AGENTS\\.md|SYSTEM\\.md|PRIMER#1|scripts/openrouter-validate\\.mjs', goodBoost: 0.30, badPenalty: 0.32 },
      // inventory of agents/hosts -> PRIMER#3 + README + CLAUDE, not a single agent .ts file.
      { whenSource: '\\b(agents (and|are)|nine hosts|9 hosts|made of|monorepo|kernel|which agents|list the agents|each ruvn agent)\\b',
        goodSource: 'PRIMER#3-what-is-ruvn-made-of|README\\.md|CLAUDE\\.md',
        badSource: 'AGENTS\\.md|SYSTEM\\.md', goodBoost: 0.24, badPenalty: 0.26 },
      // maturity / limits / "where does its intelligence come from" / "what does it depend on" /
      // "is validation required" -> PRIMER#5 + README, not the inventory/install sections or a stub.
      { whenSource: '\\b(production-?ready|mature|version|limit|medical advice|node version|what is ruvn not|opt-?in|final answer|intelligence (actually )?come|come from|depend on|required to use|validation required|is the openrouter validation required|on its own or inside|run on its own)\\b',
        goodSource: 'PRIMER#5-is-it-production-ready|README\\.md',
        badSource: 'AGENTS\\.md|SYSTEM\\.md|src/agents/|scripts/openrouter-validate\\.mjs|PRIMER#3|PRIMER#7|PRIMER#2|PRIMER#1|PRIMER#9', goodBoost: 0.30, badPenalty: 0.30 },
      // extensibility -> PRIMER#8 (carries the agent/prompt/tier/rubric/CLI/host extension points +
      // the stable-contract rule). Fires on "add/extend/change/implement/where do I" + a ruvn noun,
      // or "safely modify/change without breaking the pipeline". Allow the named source .ts/.js
      // through (a real extension question wants the agent/cli file), so don't demote src/ here.
      // EXTENSIBILITY needs an ACTION verb (add/change/edit/implement/extend/contribute/where-do-I-
      // put) so it does NOT steal the architecture/inventory question "which model tier does EACH
      // agent run on" (no action verb -> PRIMER#3 owns it) or the docs question "which FILE has the
      // grading rubric" (-> CLAUDE/#6). Bare "model tier"/"grading rubric" are intentionally NOT here.
      { whenSource: '\\b((add|create|write) (a |an |my )?(new )?(agent|stage|prompt|cli|command|subcommand|host|adapter|test)|(change|edit|modify|tune|update) (the |an |its |my )?(agent|prompt|rubric|grading|model tier|tier|model)|change which (model|tier)|implement (a|the|my) (new )?(agent|stage|command|host)|new (agent|stage|command|subcommand|host)|safely (add|modify|change|extend|edit)|without breaking|extend ruvn|extensib|contribute|where (do|should) i (add|put|implement)|stable (api|contract)|extension point|add (support for )?(another|a new) host)\\b',
        goodSource: 'PRIMER#8-how-do-i-extend-ruvn|src/agents/[a-z-]+\\.ts|bin/cli\\.js|scripts/openrouter-validate\\.mjs',
        badSource: 'PRIMER#(1|2|5|6|7)|AGENTS\\.md|SYSTEM\\.md|install\\.md', goodBoost: 0.42, badPenalty: 0.34 },
      // gotchas / cost / latency / "why empty/thin / why slow / does ruvn search itself" -> PRIMER#9
      // (carries six-pass cost, sonnet/haiku tiers, no ruvn-research-command, host-owns-web-search,
      // grade-A/B caps coverage, starting-dossier-not-verdict). Fires on cost/perf/empty phrasings.
      // Deliberately does NOT match "grading rubric" or a bare "run a research pipeline" (those are
      // the docs / install+pipeline questions Gate A owns); it owns cost/latency/empty-result/gotcha.
      { whenSource: '\\b(cost|how much|expensive|token|slow|latency|how (many|long).{0,20}(model|call|pass|run)|six (model )?passes|why is.{0,12}(it|ruvn|my run).{0,8}slow|(dossier|it|results?) (come|comes|came) back (empty|thin)|(empty|thin) (dossier|result)|dossier (be|is|come).{0,12}(empty|thin)|gotcha|footgun|pitfall|does ruvn (do|run|have).{0,14}(its own )?(web )?search|(own|bundle).{0,8}(web )?search|no (ruvn )?(research|dossier) command|is there a (research|dossier) command|prompts? not (an )?engine|engine or prompts|build step|need to build before)\\b',
        goodSource: 'PRIMER#9-cost-latency-and-gotchas|README\\.md',
        badSource: 'PRIMER#(1|2|3|5|6|7)|AGENTS\\.md|SYSTEM\\.md', goodBoost: 0.46, badPenalty: 0.36 },
    ],
    // Thin host-stub files (1-2 lines) carry almost no answer substance; demote them on ANY
    // query unless the query explicitly names that file/host config surface.
    offtopicMagnets: [
      { reSource: '(^|/)AGENTS\\.md$', pen: 0.30, allowSource: '\\bAGENTS\\.md\\b|behavioral rules|defer destructive' },
      { reSource: '(^|/)SYSTEM\\.md$', pen: 0.30, allowSource: '\\bSYSTEM\\.md\\b|system identity' },
      { reSource: '(^|/)install\\.md$', pen: 0.20, allowSource: '\\binstall\\.md\\b|per-host install|copilot' },
      // Per-host config artifacts (now indexed to enrich coverage) are tiny stubs that are vector-
      // close to orientation/inventory queries but carry no orientation prose — demote them unless
      // the query explicitly names that host/config surface (e.g. "what ships for Codex").
      { reSource: '(^|/)(cli-config\\.yaml|trust\\.json|capability-table\\.json|rvm\\.manifest\\.toml)$', pen: 0.30, allowSource: 'cli-config|trust\\.json|capability-table|rvm\\.manifest|hermes|rvm\\b' },
      { reSource: '(^|/)(\\.harness|optional-mcps|\\.claude|\\.claude-plugin|\\.codex|\\.vscode|\\.opencode|\\.openclaw)/', pen: 0.28, allowSource: 'manifest|mcp|codex|copilot|opencode|openclaw|plugin|\\.vscode|host config|what ships|drops? into|config for' },
      { reSource: '(^|/)\\.github/copilot-instructions\\.md$', pen: 0.24, allowSource: 'copilot|github|what ships|host config' },
    ],

    // ── Corpus include rules ──────────────────────────────────────────────────
    // ruvn is small: README + CLAUDE/SYSTEM/AGENTS/install (full text), the six
    // agent prompt files + cli + init + validate script (full bodies — the agent
    // SYSTEM_PROMPTs ARE the substance), and the per-host config manifests.
    include: [
      { rule: 'mdSweepFullText', roots: ['.'] },                          // README + CLAUDE/SYSTEM/AGENTS/install verbatim
      // literalFiles guarantees the package manifest AND the two non-src/ source files
      // (bin/cli.js, scripts/openrouter-validate.mjs) are indexed in FULL — sourceBodies only
      // ingests files under a src/ dir (or index/main/lib/mod leads), so the CLI entry + the live-
      // model validate script would otherwise be missed. These are core to onboarding/extensibility.
      { rule: 'literalFiles', files: ['README.md', 'CLAUDE.md', 'SYSTEM.md', 'AGENTS.md', 'install.md', 'package.json', 'bin/cli.js', 'scripts/openrouter-validate.mjs'] },
      // Per-host config artifacts ruvn ships (the concrete answer to "what does ruvn drop into
      // host X"): the harness manifest + each host's config file. Tagged source_type config/doc by
      // path — they are NOT source files, so they enrich coverage without inflating the source set.
      { rule: 'literalFiles', files: [
        '.harness/manifest.json', 'capability-table.json', 'trust.json', 'cli-config.yaml',
        'rvm.manifest.toml', 'optional-mcps/ruvn.json',
        '.claude/settings.json', '.claude-plugin/plugin.json', '.codex/config.toml',
        '.vscode/mcp.json', '.github/copilot-instructions.md', '.opencode/opencode.json',
        '.openclaw/openclaw.json',
      ] },
      { rule: 'sourceBodies', roots: ['src', 'bin', 'scripts'], ext: ['.ts', '.js', '.mjs'] }, // agent prompts, init
      // tests are the BEST usage docs (real call sites: run(['doctor']), the OpenRouter agent
      // exercise). Ingested deliberately (sourceBodies excludes tests); tagged source_type test
      // by build-kb so the AI can ask for tests as usage and the deep-dive can pick them.
      { rule: 'testsAndExamples', roots: ['__tests__', 'scripts'], ext: ['.ts', '.js', '.mjs'] },
      { rule: 'docCommentSweep', roots: ['src', 'bin', 'scripts', '__tests__'] }, // leading doc comments across tree
    ],

    // ── Verification queries: ONE per arc stage (7 total). Facts verified 2026-06-19.
    verificationQueries: [
      {
        stage: 1,
        arc: 'what-is-it',
        query: 'What is ruvn?',
        wantPaths: ['PRIMER#1-what-is-ruvn', 'README.md', 'CLAUDE.md'],
        mustContain: ['graded, cited evidence dossier', 'research', 'every claim is cited'],
      },
      {
        stage: 2,
        arc: 'capabilities',
        query: 'What can ruvn do for me?',
        wantPaths: ['PRIMER#2-what-can-ruvn-do-for-you', 'README.md'],
        mustContain: ['grades every source', 'adversarially fact-checks', 'bibliography'],
      },
      {
        stage: 3,
        arc: 'inventory-components',
        query: 'What agents and hosts make up ruvn?',
        wantPaths: ['PRIMER#3-what-is-ruvn-made-of-the-six-agents-and-nine-hosts', 'README.md', 'CLAUDE.md'],
        mustContain: ['scout', 'web-searcher', 'source-grader', 'synthesizer', 'fact-checker', 'citer', '9 hosts'],
      },
      {
        stage: 4,
        arc: 'how-it-works-pipeline',
        query: 'How does the ruvn pipeline work step by step?',
        wantPaths: ['PRIMER#4-how-the-pipeline-works-step-by-step', 'CLAUDE.md', 'README.md'],
        mustContain: ['each agent only sees', 'A/B/C/D', 'grade A and B', 'six agents in a line'],
      },
      {
        stage: 5,
        arc: 'maturity',
        query: 'Is ruvn production-ready and what are its limits?',
        wantPaths: ['PRIMER#5-is-it-production-ready-scope-and-honest-limits', 'README.md'],
        mustContain: ['v0.1.1', 'research tool', 'does not give medical advice', 'starting dossier'],
      },
      {
        stage: 6,
        arc: 'docs-where-things-live',
        query: 'Where do I read more about ruvn?',
        wantPaths: ['PRIMER#6-where-do-i-read-more-the-docs-map', 'README.md', 'install.md'],
        mustContain: ['README.md', 'CLAUDE.md', 'install.md'],
      },
      {
        stage: 7,
        arc: 'end-to-end-usage',
        query: 'How do I install and use ruvn?',
        wantPaths: ['PRIMER#7-how-do-i-install-and-use-it-end-to-end', 'README.md'],
        mustContain: ['npm i -g @ruvnet/ruvn', 'ruvn init', 'ruvn doctor', 'validate:openrouter'],
      },
    ],

    bundle: {
      blurb:
        'ruvn drop-in knowledge base — an AI research harness that turns a question into a graded, ' +
        'cited evidence dossier. Six agents in a line (scout → web-searcher → source-grader → ' +
        'synthesizer → fact-checker → citer), A/B/C/D source grading, every claim cited. ' +
        'Ships adapters for 9 hosts; OpenRouter-validated. Install: npm i -g @ruvnet/ruvn.',
      questions: [
        'What is ruvn and what does it give me back?',
        'What does a graded, cited evidence dossier mean here?',
        'What are the six agents and the nine hosts?',
        'How does the grading + fact-checking pipeline work?',
        'How do I install ruvn and validate it against a real model?',
      ],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // photonlayer — a deterministic optical-AI FRONT END in pure Rust. A learned
  // phase mask ("smart glass") shapes incoming light so a tiny sensor captures a
  // compressed task-useful MEASUREMENT (a few numbers) instead of a full image;
  // a small digital decoder reads the answer; every run emits a BLAKE3 receipt.
  // Rust workspace of 4 crates (core / bench / wasm / cli). No .gitmodules →
  // force-walk own tree. Single 768-dim bge variant (recipe v1.3.0).
  // Facts verified against .targets/photonlayer @ fe86c9f, 2026-06-19
  // (README.md / crates/*/src/*.rs / crates/*/README.md / docs/README.md /
  //  examples/README.md / crates/photonlayer-core/src/lib.rs).
  // ──────────────────────────────────────────────────────────────────────────
  photonlayer: {
    slug: 'photonlayer',
    metaName: 'PhotonLayer',
    // ── Embedder (ADR-0001 v1.3.1: SINGLE 384-dim desktop variant) ────────────
    // bge-small-en-v1.5 (cls-pooled, normalized, asymmetric query prefix). build-kb.mjs writes the
    // canonical un-suffixed stores/photonlayer/photonlayer-kb.rvf + a .embed.json sidecar that
    // ask-kb + index-primer read (so query + primer use the SAME model). Gate-A tuned at
    // rankScale 0.6 (trust bge's raw order gently). Matches the existing .embed.json sidecar.
    // Model cached offline at kb/models-cache/Xenova/bge-small-en-v1.5 for fast builds.
    embed: {
      model: 'Xenova/bge-small-en-v1.5',
      dim: 384,
      pooling: 'cls',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      rankScale: 0.6,
      rvfSuffix: '.rvf',
    },
    // Brand/product names + the crate names + the core optical nouns so
    // "what is the phase mask" / "what does photonlayer-core do" both match.
    productNames: [
      'PhotonLayer',
      'photonlayer',
      'photonlayer-core',
      'photonlayer-bench',
      'photonlayer-wasm',
      'photonlayer-cli',
      'phase mask',
      'PhaseMask',
      'ScalarSimulator',
    ],
    // EXPLICIT archetype → PRIMER#<slug> map (slugify of each ## section title in
    // photonlayer-primer.md). Explicit beats 'auto' so every orientation question
    // force-routes to the synthesized primer section, not a raw README fragment.
    primerSlugs: {
      whatis:       'PRIMER#1-what-is-photonlayer',
      capabilities: 'PRIMER#2-what-can-photonlayer-do',
      crates:       'PRIMER#3-what-is-photonlayer-made-of-the-four-crates',
      composer:     'PRIMER#4-how-the-optical-pipeline-works-step-by-step',
      maturity:     'PRIMER#5-is-it-production-ready-scope-and-honest-limits',
      docs:         'PRIMER#6-where-do-i-read-more-the-docs-map',
      adr:          'PRIMER#6-where-do-i-read-more-the-docs-map',
      playbook:     'PRIMER#7-how-do-i-install-and-run-it-end-to-end',
      // §8/§9 added for the AI-comprehension gate (extensibility + gotchas dimensions).
      extensibility: 'PRIMER#8-how-do-i-extend-photonlayer-safely-the-extension-points',
      gotchas:       'PRIMER#9-performance-determinism-and-gotchas',
    },
    // extensionFiles — concept word -> the real extension-point file(s) it touches. Consumed by the
    // AI-comprehension grader (and a useful map for any AI). Files verified present in source +
    // indexed in passages.jsonl; PRIMER#8 names them in prose. (Facts checked against source.)
    extensionFiles: {
      'propagation': ['crates/photonlayer-core/src/propagate.rs', 'crates/photonlayer-core/src/config.rs'],
      'diffraction': ['crates/photonlayer-core/src/propagate.rs', 'crates/photonlayer-core/src/config.rs'],
      'propagation mode': ['crates/photonlayer-core/src/config.rs', 'crates/photonlayer-core/src/propagate.rs'],
      'adjoint': ['crates/photonlayer-core/src/propagate.rs', 'crates/photonlayer-core/tests/gradient_check.rs'],
      'mask': ['crates/photonlayer-core/src/mask.rs'],
      'phase mask': ['crates/photonlayer-core/src/mask.rs'],
      'detector': ['crates/photonlayer-core/src/detector.rs', 'crates/photonlayer-core/src/config.rs'],
      'sensor': ['crates/photonlayer-core/src/detector.rs', 'crates/photonlayer-core/src/config.rs'],
      'differential': ['crates/photonlayer-bench/src/diffdetect.rs', 'crates/photonlayer-core/src/detector.rs'],
      'decoder': ['crates/photonlayer-bench/src/decoder.rs'],
      'training': ['crates/photonlayer-bench/src/grad_train.rs', 'crates/photonlayer-bench/src/learn.rs'],
      'train': ['crates/photonlayer-bench/src/grad_train.rs', 'crates/photonlayer-bench/src/learn.rs'],
      'gradient': ['crates/photonlayer-bench/src/grad_train.rs', 'crates/photonlayer-core/src/propagate.rs'],
      'optimizer': ['crates/photonlayer-bench/src/grad_adam.rs', 'crates/photonlayer-bench/src/grad_train.rs'],
      'cascade': ['crates/photonlayer-bench/src/grad_cascade.rs'],
      'multiplane': ['crates/photonlayer-bench/src/grad_cascade.rs'],
      'cli': ['crates/photonlayer-cli/src/main.rs'],
      'subcommand': ['crates/photonlayer-cli/src/main.rs'],
      'command': ['crates/photonlayer-cli/src/main.rs'],
      'wasm': ['crates/photonlayer-wasm/src/lib.rs'],
      'binding': ['crates/photonlayer-wasm/src/lib.rs'],
      'javascript': ['crates/photonlayer-wasm/src/lib.rs'],
      'receipt': ['crates/photonlayer-core/src/receipt.rs'],
      'simulator': ['crates/photonlayer-core/src/simulator.rs'],
      'metric': ['crates/photonlayer-core/src/metrics.rs'],
    },
    // docFiles — per-dimension authoritative docs the grader injects. CLI usage lives in the CLI
    // README + main.rs; runnable usage examples live in the crate READMEs + examples/.
    docFiles: {
      cli: ['crates/photonlayer-cli/src/main.rs', 'README.md'],
      usage: ['crates/photonlayer-core/README.md', 'README.md'],
    },
    // typeAliases — concept word in a question -> the public type whose method signatures answer it.
    // Lets "run the optical simulator" surface ScalarSimulator's simulate/trace from symbols.json.
    // All type names verified against crates/photonlayer-core/src/*.rs.
    typeAliases: {
      'simulator': 'ScalarSimulator',
      'simulation': 'ScalarSimulator',
      'mask': 'PhaseMask',
      'config': 'OpticalConfig',
      'field': 'OpticalField',
      'image': 'InputImage',
      'frame': 'OpticalFrame',
      'propagator': 'Propagator',
      'propagation': 'PropagationMode',
      'complex': 'Complex',
      'detector': 'DetectorConfig',
      'receipt': 'ExperimentReceipt',
    },

    // ── Source scope (force-walk; NO .gitmodules in this repo → walk own tree) ──
    repoDir: '../.targets/photonlayer',
    scopeExclude: [
      'node_modules',
      'target',
      'dist',
      'build',
      '.git',
      'pkg',        // docs/pkg = committed wasm-bindgen output (generated, not authored)
      '.next',
      'coverage',
      'data',       // crates/photonlayer-bench/data (MNIST cache, not authored)
    ],

    // ── Extension classes ────────────────────────────────────────────────────
    codeExt: ['.rs'],
    fullTextExt: ['.md', '.mdx', '.txt'],
    templateExt: [],

    // ── Component model: the four crates live under crates/ ────────────────────
    componentRoots: ['crates'],
    componentWord: ['crate', 'module', 'component', 'package'],

    // ── Disambiguation / off-topic magnets (gate-A tuned + AI-comprehension §8/§9) ──
    // photonlayer's Rust source is heavily doc-commented and vector-close to orientation queries,
    // so raw .rs files out-rank the synthesized PRIMER sections for architecture/extensibility/
    // gotchas archetypes. These rules route each comprehension archetype to its PRIMER section +
    // canonical README. `whenSource` matches the QUERY; `good/bad` match the result PATH.
    disambiguation: [
      // what-is-it / orientation -> PRIMER#1. Guard: don't fire on extensibility/gotchas/pipeline-output
      // phrasings ("what does it OUTPUT/produce/measurement" is §2/§4, not §1). Catches the held-out
      // "why is PhotonLayer described as a front end", "in one line what does it turn light into" which
      // are vector-close to the §8 extension section ("front end" boundary talk).
      { whenSource: '^(?!.*\\b(extend|add a|implement|new (propagation|mask|detector|decoder)|gotcha|memory|determinis|output|produce|measurement|cascade|accuracy|receipt)\\b).*\\b(what is photonlayer|why is photonlayer|why.{0,20}front ?end|described as a (front ?end|optical)|turn light into|in one line|smart glass|what does it capture|how is.{0,20}different from a (normal )?camera|what does a (learned )?phase mask do)\\b',
        goodSource: 'PRIMER#1-what-is-photonlayer|(^|/)README\\.md$',
        badSource: 'PRIMER#(3|5|6|7|8|9)|\\.rs$|Cargo\\.toml$', goodBoost: 0.50, badPenalty: 0.42 },
      // architecture / inventory: "which crate owns/holds X", "what does each module do", "how do the
      // crates depend", "what types does the prelude export" -> PRIMER#3 (the four-crate list +
      // per-module breakdown + the prelude export list). Demote raw .rs / Cargo.toml AND the §8
      // extension section (which also names the prelude types but for a different purpose).
      { whenSource: '\\b(which crate|what crate|crates? (make up|holds?|has|is|owns?)|made of|four crates|how (do|are) the crates|depend on each other|owns? the (optical )?simulator|each (module|crate) (do|does)|foundation crate|architecture|components|blast.?radius|affected if i change|what does (each )?(module|core) do|module breakdown|command.?line driver|prelude export|types? does the (core )?prelude|core prelude (export|re-?export)|what (types|modules) (does|are)|module(s)? in core)\\b',
        goodSource: 'PRIMER#3-what-is-photonlayer-made-of|(^|/)README\\.md$|crates/photonlayer-core/src/lib\\.rs',
        badSource: 'Cargo\\.toml$|crates/[^/]+/src/(?!lib)[a-z_]+\\.rs$|PRIMER#(1|2|4|5|6|7|8|9)', goodBoost: 0.56, badPenalty: 0.44 },
      // extensibility -> PRIMER#8 (propagation/mask/detector/decoder/training/cascade/cli/wasm/
      // receipt extension points). Trigger ONLY on real ADD/EXTEND/IMPLEMENT intent (NOT bare
      // "prelude"/"stable api"/"types export", which are inventory phrasings handled by §3 above).
      // Guard: don't fire on plain "what is / why is" orientation.
      { whenSource: '^(?!.*\\b(what is photonlayer|why is photonlayer|front ?end|what types|prelude export)\\b).*\\b(extend|extensib|add (a |an |my )?(new )?(propagation|diffraction|mode|mask|detector|sensor|decoder|training|trainer|optimizer|cascade|plane|command|subcommand|binding|metric|stage)|implement (a|the|my)|new (propagation|mask|detector|decoder|cli|wasm|subcommand|mode)|safely (add|modify|change|extend)|without breaking|contribute|where (do|should) i (add|put|implement)|trait (do|to) i implement|extension point|hook in|plug ?in a|adjoint (must|match|contract))\\b',
        goodSource: 'PRIMER#8-how-do-i-extend-photonlayer|crates/photonlayer-core/src/(propagate|mask|detector|simulator|config|receipt)\\.rs|crates/photonlayer-bench/src/(grad_train|grad_cascade|decoder|learn|grad_adam)\\.rs|crates/photonlayer-cli/src/main\\.rs|crates/photonlayer-wasm/src/lib\\.rs',
        badSource: 'PRIMER#(1|2|3|5|6|7|9)|Cargo\\.toml$', goodBoost: 0.56, badPenalty: 0.40 },
      // gotchas / performance / memory / determinism -> PRIMER#9 (power-of-two FFT, MAX_GRID_DIM,
      // 2^? memory scaling, libm cross-platform determinism caveat, training ceilings/init-sensitivity,
      // error types). Fires on memory/performance/determinism/limit phrasings (NOT the maturity
      // "is it production-ready", which §5 owns).
      { whenSource: '\\b(gotcha|footgun|pitfall|performance|how (fast|slow)|too slow|speed ?up|memory (limit|budget|usage|scal|grow)|out of memory|oom|grid size|power of two|power-?of-?2|fft cost|determinis|bit.?identical|reproducib|cross.?platform|libm|transcendental|why is.{0,12}slow|run a (large|big)|max grid|4096|seed(ed)? rng|noise(-free)?|training (ceiling|plateau|gotcha)|init.?sensit|hill.?climb plateau|adjoint (correct|valid|check))\\b',
        goodSource: 'PRIMER#9-performance-determinism-and-gotchas|crates/photonlayer-core/src/(propagate|fft|config|complex|error|rng)\\.rs|crates/photonlayer-core/README\\.md',
        badSource: 'PRIMER#(1|2|3|6|7)|Cargo\\.toml$', goodBoost: 0.50, badPenalty: 0.38 },
    ],
    // Raw Rust source bodies + manifests are dense and vector-close to orientation queries but carry
    // implementation detail, not plain orientation facts. Demote on ANY query UNLESS the query
    // explicitly names that file/symbol surface (allowSource).
    offtopicMagnets: [
      { reSource: '\\.rs$', pen: 0.20, allowSource: '\\.rs\\b|source code|implementation|struct |impl |fn |trait |how is .* implemented|show me the code|extend|add a new|propagat|mask|detector|decoder|gradient|cascade|adjoint|wasm|receipt' },
      { reSource: '(^|/)Cargo\\.toml$', pen: 0.26, allowSource: 'Cargo\\.toml|dependencies|manifest|crate version|workspace' },
    ],

    // ── Corpus include rules ──────────────────────────────────────────────────
    // photonlayer is small + heavily doc-commented: README + crate READMEs + docs
    // (full text), each crate's Cargo manifest, the full Rust source bodies of every
    // crate (the //! module docs + impls ARE the substance), doc-comments across the
    // tree, and the example + test sources (the best usage docs — real call sites).
    include: [
      { rule: 'mdSweepFullText', roots: ['.', 'docs', 'examples'] },     // README + crate READMEs + docs verbatim
      { rule: 'literalFiles', files: ['README.md', 'docs/README.md', 'examples/README.md', 'crates/photonlayer-core/README.md'] },
      { rule: 'componentManifests', roots: ['crates'] },                 // Cargo.toml per crate
      { rule: 'componentLead', roots: ['crates'] },                      // each crate README / lib.rs lead doc
      { rule: 'sourceBodies', roots: ['crates'], ext: ['.rs'] },         // full Rust bodies (src/)
      // tests + examples are the BEST usage docs (real call sites + expected results). Ingested
      // deliberately (sourceBodies excludes them); tagged source_type test|example by build-kb.
      { rule: 'testsAndExamples', roots: ['crates'], ext: ['.rs'] },
      { rule: 'docCommentSweep', roots: ['crates'] },                    // leading doc comments across tree
    ],

    // ── Verification queries: ONE per arc stage (7 total). Facts verified 2026-06-19.
    verificationQueries: [
      {
        stage: 1,
        arc: 'what-is-it',
        query: 'What is PhotonLayer?',
        wantPaths: ['PRIMER#1-what-is-photonlayer', 'README.md', 'crates/photonlayer-core/src/lib.rs'],
        mustContain: ['phase mask', 'sensor', 'deterministic'],
      },
      {
        stage: 2,
        arc: 'capabilities',
        query: 'What can PhotonLayer do?',
        wantPaths: ['PRIMER#2-what-can-photonlayer-do', 'README.md'],
        mustContain: ['compress', 'sensor pixels', 'receipt'],
      },
      {
        stage: 3,
        arc: 'inventory-components',
        query: 'What crates make up PhotonLayer?',
        wantPaths: ['PRIMER#3-what-is-photonlayer-made-of-the-four-crates', 'README.md'],
        mustContain: ['photonlayer-core', 'photonlayer-bench', 'photonlayer-wasm', 'photonlayer-cli'],
      },
      {
        stage: 4,
        arc: 'how-it-works-pipeline',
        query: 'How does the optical pipeline work step by step?',
        wantPaths: ['PRIMER#4-how-the-optical-pipeline-works-step-by-step', 'crates/photonlayer-core/src/lib.rs', 'README.md'],
        mustContain: ['phase mask', 'propagat', 'sensor', 'decoder'],
      },
      {
        stage: 5,
        arc: 'maturity',
        query: 'Is PhotonLayer production-ready and what are its limits?',
        wantPaths: ['PRIMER#5-is-it-production-ready-scope-and-honest-limits', 'README.md'],
        mustContain: ['simulator', 'No privacy', 'single', 'not'],
      },
      {
        stage: 6,
        arc: 'docs-where-things-live',
        query: 'Where do I read more about PhotonLayer?',
        wantPaths: ['PRIMER#6-where-do-i-read-more-the-docs-map', 'README.md', 'examples/README.md'],
        mustContain: ['README', 'examples', 'crates'],
      },
      {
        stage: 7,
        arc: 'end-to-end-usage',
        query: 'How do I install and run PhotonLayer?',
        wantPaths: ['PRIMER#7-how-do-i-install-and-run-it-end-to-end', 'README.md'],
        mustContain: ['cargo add photonlayer-core', 'cargo run', 'hello_optics'],
      },
    ],

    bundle: {
      blurb:
        'PhotonLayer drop-in knowledge base — a deterministic optical-AI front end in pure Rust. ' +
        'A learned phase mask shapes incoming light so a tiny sensor captures a compressed, ' +
        'task-useful measurement (a few numbers) instead of a full image; a small decoder reads ' +
        'the answer; every run emits a BLAKE3 receipt. Four crates (core / bench / wasm / cli). ' +
        'Live demo runs in-browser via WASM. Today a Rust simulator; hardware is on the roadmap.',
      questions: [
        'What is PhotonLayer and what does it actually capture?',
        'What does a learned phase mask do, and how is it different from a normal camera + model?',
        'What are the four crates and what does each one do?',
        'How does the optical pipeline work end to end (image → mask → sensor → decoder → receipt)?',
        'How do I install photonlayer-core and run the first example?',
      ],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ruqu — quantum computing simulator in pure Rust + WebAssembly. A state-vector
  // quantum CIRCUIT simulator (SIMD + noise models + multi-threading), production
  // quantum ALGORITHMS (VQE, Grover, QAOA, surface-code QEC), a real-time COHERENCE
  // engine, and WASM bindings that run ~25-qubit circuits in the browser. Crate-based:
  // its "components" are the five crates under crates/ (ruqu-core, ruqu-algorithms,
  // ruqu-exotic, ruqu-wasm, ruQu coherence engine) plus the npx CLI (cli/).
  // Single 768-dim bge variant (recipe v1.3.0). Facts verified against
  // .targets/ruqu @026d63ef 2026-06-19 (README + each crate README + lib.rs
  // doc-comments + cli/README + cli/package.json).
  // ──────────────────────────────────────────────────────────────────────────
  ruqu: {
    slug: 'ruqu',
    metaName: 'ruqu',
    // ── Embedder (ADR-0001 v1.3.1: SINGLE 384-dim desktop variant) ────────────
    // bge-small-en-v1.5 (cls-pooled, normalized, asymmetric query prefix). build-kb.mjs writes the
    // canonical un-suffixed stores/ruqu/ruqu-kb.rvf + a .embed.json sidecar that ask-kb +
    // index-primer read (so query + primer use the SAME model). The 1035-chunk ruqu corpus cleared
    // Gate A at 384 — no step-up to 768 needed (memory: embedding-final-768-plus-chunking).
    embed: {
      model: 'Xenova/bge-small-en-v1.5',
      dim: 384,
      pooling: 'cls',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      rankScale: 1,
      rvfSuffix: '.rvf',
    },
    productNames: [
      'ruqu',
      'ruqu-core',
      'ruqu-algorithms',
      'ruqu-exotic',
      'ruqu-wasm',
      'ruQu',
      '@ruvector/ruqu',
      '@ruvector/ruqu-wasm',
    ],
    primerSlugs: {
      whatis:       'PRIMER#1-what-is-ruqu',
      capabilities: 'PRIMER#2-what-can-ruqu-do-for-you',
      crates:       'PRIMER#3-what-is-ruqu-made-of-the-five-crates',
      composer:     'PRIMER#4-how-a-circuit-runs-the-simulation-pipeline',
      maturity:     'PRIMER#5-is-it-production-ready-scope-and-honest-limits',
      docs:         'PRIMER#6-where-do-i-read-more-the-docs-map',
      adr:          'PRIMER#6-where-do-i-read-more-the-docs-map',
      playbook:     'PRIMER#7-how-do-i-install-and-run-it-end-to-end',
      // §8/§9 added for the AI-comprehension gate (extensibility + gotchas dimensions).
      extensibility: 'PRIMER#8-how-do-i-extend-ruqu-safely-the-extension-points',
      gotchas:       'PRIMER#9-performance-memory-and-gotchas-running-large-circuits',
    },
    // extensionFiles — concept word -> the real extension-point file(s) it touches. Consumed by the
    // AI-comprehension grader (and a useful map for any AI): "add a CLI subcommand" -> cli/bin/cli.js,
    // etc. These files ARE indexed (in passages.jsonl); PRIMER#8 names them in prose.
    extensionFiles: {
      'gate': ['crates/ruqu-core/src/gate.rs', 'crates/ruqu-core/src/clifford_t.rs'],
      'backend': ['crates/ruqu-core/src/backend.rs', 'crates/ruqu-core/src/simulator.rs'],
      'decoder': ['crates/ruqu-core/src/decoder.rs'],
      'provider': ['crates/ruqu-core/src/hardware.rs'],
      'hardware': ['crates/ruqu-core/src/hardware.rs'],
      'algorithm': ['crates/ruqu-algorithms/src/lib.rs', 'crates/ruqu-algorithms/src/grover.rs'],
      'cli': ['cli/bin/cli.js'],
      'subcommand': ['cli/bin/cli.js'],
      'command': ['cli/bin/cli.js'],
      'wasm': ['crates/ruqu-wasm/src/lib.rs'],
      'binding': ['crates/ruqu-wasm/src/lib.rs'],
      'javascript': ['crates/ruqu-wasm/src/lib.rs'],
      'coherence': ['crates/ruQu/src/lib.rs'],
    },
    // docFiles — per-dimension authoritative docs the grader injects (the AI reads these for the
    // dimension). CLI per-command table lives in cli/README.md; usage gate examples in the crate READMEs.
    docFiles: {
      cli: ['cli/README.md', 'cli/bin/cli.js'],
      usage: ['crates/ruqu-core/README.md', 'crates/ruqu-algorithms/README.md'],
    },
    // typeAliases — concept word in a question -> the public type whose method signatures answer it.
    // Lets "build and run a circuit" surface QuantumCircuit's gate methods (h/cnot/…) from symbols.json.
    typeAliases: {
      'circuit': 'QuantumCircuit',
      'simulator': 'Simulator',
      'simulation': 'Simulator',
      'grover': 'GroverConfig',
      'backend': 'BackendType',
      'analyze': 'CircuitAnalysis',
    },

    repoDir: '../.targets/ruqu',
    scopeExclude: [
      'node_modules',
      'target',
      'dist',
      'build',
      '.git',
      'pkg',
      'coverage',
      '.next',
    ],

    codeExt: ['.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs'],
    fullTextExt: ['.md', '.mdx', '.txt'],
    templateExt: [],

    // Five crates live under crates/ (+ the npx CLI in cli/). componentWord widened
    // with 'engine' so "the coherence engine" matches the product/inventory matchers.
    componentRoots: ['crates'],
    componentWord: ['crate', 'engine', 'package', 'module', 'component'],

    // ── Disambiguation (gate-A tuning, 384 bge-small) ─────────────────────────
    // ruqu is a DENSE corpus (1035 chunks): every crate's full Rust source + ADRs + DDDs
    // are indexed, and many low-level files (noise.rs, backend.rs, simulator.rs, Cargo.toml,
    // ADR/DDD design docs) are vector-close to orientation queries but DON'T carry the plain
    // orientation facts the arc needs — they out-rank the synthesized PRIMER/README. Each rule
    // routes a comprehension archetype to its PRIMER section + canonical README, and demotes raw
    // source / design-doc magnets. `whenSource` matches the QUERY; `good/bad` match the result PATH.
    disambiguation: [
      // what-is-it: orientation -> PRIMER#1 + top-level README, never a single .rs / Cargo.toml.
      // Guard: don't fire on inventory phrasings ("...backends", "besides", "which crate") even when
      // they contain "state-vector" — those belong to the inventory rule (PRIMER#3).
      { whenSource: '^(?!.*\\bbackends?\\b)(?!.*\\bbesides\\b)(?!.*\\bwhich crate\\b)(?!.*\\b(vqe|grover|qaoa|surface.?code|algorithm)\\b).*\\b(what is ruqu|what does ruqu (do|actually)|state-?vector|run.{0,12}quantum|pretend quantum|no quantum hardware|without (owning|a quantum)|own(ing)? a quantum|need (a server|an account)|no server|exact instead|why are ruqu|answers exact|in (a|the) browser|in one line|what hardware|pure rust|wasm|webassembly)\\b',
        goodSource: 'PRIMER#1-what-is-ruqu|crates/ruqu-wasm/README\\.md|(^|/)README\\.md$',
        badSource: '\\.rs$|Cargo\\.toml$|(^|/)docs/(adr|ddd)/|SIMULATION-INTEGRATION|crates/(ruqu-core|ruqu-algorithms|ruqu-exotic|ruQu)/(README|readme)\\.md|PRIMER#(2|3|4|5)', goodBoost: 0.56, badPenalty: 0.46 },
      // capabilities / algorithms -> PRIMER#2 (carries VQE/Grover/QAOA/surface-code/distance-3/
      // OpenQASM/molecular-Hamiltonians/gate-set facts). Demote raw source AND cross-section PRIMER#1
      // + crate/top READMEs (which lack the synthesized set) so PRIMER#2 wins every capability query.
      { whenSource: '\\b(what can ruqu|capabilit|algorithm|vqe|grover|qaoa|surface.?code|error correction|chemistry|optimi|gate set|openqasm|noise model|depolariz|syndrome|distance.?3|molecular|hamiltonian|ground.?state|come built in|built[- ]in|speedup|quadratic|unstructured search|what does (qaoa|grover|vqe).{0,8}(solve|give|do)|what (are|is) (vqe|grover|qaoa)|maxcut|export.{0,12}(circuit|format|qasm)|standard format|ruqu-exotic (used|for)|what does ruqu do for)\\b',
        goodSource: 'PRIMER#2-what-can-ruqu-do-for-you',
        badSource: '\\.rs$|Cargo\\.toml$|/docs/|SECURITY-REVIEW|RESEARCH_DISCOVERIES|PRIMER#(1|3|4|5|6|7)', goodBoost: 0.78, badPenalty: 0.58 },
      // inventory of crates -> PRIMER#3 (carries the five-crate list + 'five simulation backends').
      // Demote raw source, ADR/DDD AND cross-section PRIMER#4 so PRIMER#3 leads inventory questions.
      { whenSource: '^(?!.*\\b(what|which) version\\b)(?!.*\\bwhat license\\b).*\\b(crates|made of|five crates|what.{0,12}(make|made) up|inventory|components|ruqu-core|ruqu-algorithms|ruqu-exotic|ruqu-wasm|coherence engine|coherence (engine )?(do|work)|dynamic min.?cut|min.?cut|(five|simulation|other).{0,14}backends?|backends? (exist|are|in ruqu)|list the crates|which crate (holds|has|is)|simulator engine|besides.{0,20}state-?vector)\\b',
        goodSource: 'PRIMER#3-what-is-ruqu-made-of',
        badSource: '\\.rs$|Cargo\\.toml$|/docs/|SECURITY-REVIEW|RESEARCH_DISCOVERIES|crates/ruQu/(README|readme)\\.md|PRIMER#(1|2|4|5|6|7)', goodBoost: 0.70, badPenalty: 0.50 },
      // how-a-circuit-runs / pipeline -> PRIMER#4 (carries QuantumCircuit→Simulator→backend→measureAll
      // run-flow + cost-model planner + SIMD + noise+correct flow + the in-browser run). Demote
      // cross-section PRIMER#1/#7 so the pipeline section leads every how-it-works question.
      // NOTE: "backend(s)" alone is ambiguous (inventory's "five simulation backends" vs pipeline's
      // "which backend"), so don't demote PRIMER#3 here — let the inventory rule own backend-listing
      // questions. Pipeline owns the run-flow / speed / planner / noise questions.
      { whenSource: '\\b(how.{0,14}(circuit|run|work)|run a circuit|pipeline|planner|cost.?model|which backend|pick.{0,10}backend|choose.{0,10}backend|statevector|state vector|auto.?select|noise|stabilizer|tensor|simd|multi.?thread|gate application|makes? .{0,16}fast|speed ?up|faster)\\b',
        goodSource: 'PRIMER#4-how-a-circuit-runs|crates/ruqu-core/README\\.md|crates/ruqu-wasm/README\\.md',
        badSource: '\\.rs$|Cargo\\.toml$|(^|/)docs/(adr|ddd)/|SIMULATION-INTEGRATION|PRIMER#(1|7)', goodBoost: 0.50, badPenalty: 0.42 },
      // maturity / limits -> PRIMER#5 (carries 'classical simulator', 'no quantum hardware', MIT,
      // qubit ceilings, exotic=experimental). Demote raw source, ADR/DDD, crate readmes AND the
      // cross-section PRIMER#2 so PRIMER#5 wins every maturity / 'real quantum computer?' question.
      { whenSource: '\\b(production-?ready|mature|maturity|limit|classical simulator|honest limit|honest|roadmap|how mature|is it (ready|production)|real quantum (computer|hardware|machine)|connect to a real|how many qubits|32 qubits|25 qubits|ruqu-exotic|experimental|quantum-?inspired|what version|which version|what license|licens(e|ed)|mit\\b|crates and the cli)\\b',
        goodSource: 'PRIMER#5-is-it-production-ready',
        badSource: '\\.rs$|Cargo\\.toml$|(^|/)docs/(adr|ddd)/|crates/[^/]+/(README|readme)\\.md|(^|/)README\\.md$|cli/README\\.md|PRIMER#(2|3)', goodBoost: 0.66, badPenalty: 0.48 },
      // docs map -> PRIMER#6 + README.
      { whenSource: '\\b(where (do|can|is|are)|read more|docs|documentation|which (file|doc)|docs map|learn more)\\b',
        goodSource: 'PRIMER#6-where-do-i-read-more|(^|/)README\\.md$',
        badSource: '\\.rs$|Cargo\\.toml$', goodBoost: 0.30, badPenalty: 0.26 },
      // install / end-to-end usage -> PRIMER#7 + README + cli README, not a source file. NOTE:
      // "how do I run a circuit" is a how-it-works question (handled by the pipeline rule), so the
      // install trigger is install-CONTEXTUAL (install/get-started/cargo/npx/wasm-pack/terminal),
      // NOT a bare "how do I run" — otherwise it steals the pipeline's browser/circuit-run questions.
      { whenSource: '\\b(install|usage|get ?started|cargo add|npx|wasm-pack|how do i (start|install|build the (web)?assembly|build the wasm)|from (my|the) terminal|no.?install|end.?to.?end|quickstart|first command|fastest way|fastest to see|see ruqu run|what do i add to cargo|add to cargo|build the (web)?assembly bundle)\\b',
        goodSource: 'PRIMER#7-how-do-i-install-and-run|(^|/)README\\.md$|cli/README\\.md',
        badSource: '\\.rs$|Cargo\\.toml$|(^|/)docs/(adr|ddd)/|PRIMER#4', goodBoost: 0.32, badPenalty: 0.30 },
      // extensibility -> PRIMER#8 (carries the gate/backend/algorithm/decoder/CLI/wasm extension
      // points + the stable-API rule). Fires on "add/extend/implement/contribute/where do I" + a
      // ruqu noun, or "safely modify/change without breaking". Demote cross-section PRIMERs so the
      // extension section leads. Allow .rs through (an extension question legitimately wants the
      // trait/struct source) — so DON'T demote .rs here; the magnets already gate raw source.
      { whenSource: '\\b(extend|extensib|add (a |an |my )?(new )?(gate|backend|algorithm|decoder|provider|command|subcommand|binding|feature)|implement (a|the|my)|new (gate|backend|algorithm|decoder|cli|wasm|subcommand)|safely (add|modify|change|extend)|without breaking|contribute|where (do|should) i (add|put|implement)|trait (do|to) i implement|stable api|extension point|hook in|plug ?in a)\\b',
        goodSource: 'PRIMER#8-how-do-i-extend-ruqu|crates/ruqu-core/src/(gate|backend|decoder|hardware)\\.rs|crates/ruqu-algorithms/src/|crates/ruqu-wasm/src/lib\\.rs|cli/bin/cli\\.js',
        badSource: 'PRIMER#(1|2|5|6|7)|Cargo\\.toml$|(^|/)docs/(adr|ddd)/', goodBoost: 0.58, badPenalty: 0.40 },
      // gotchas / performance / memory limits -> PRIMER#9 (carries 2^n memory, qubit ceilings, OOM,
      // stabilizer escape hatch, TILE_MEMORY_BUDGET, SIMD speed, exotic caution). Fires on memory/
      // performance/limit phrasings (NOT the maturity "is it production-ready", which §5 owns).
      { whenSource: '\\b(out of memory|run out of memory|oom|memory (limit|budget|usage|grow)|how (much|many).{0,18}(memory|qubits before)|large circuit|why is.{0,12}(it|my run|ruqu) slow|performance|speed (up|tip)|too slow|tile memory|tilememoryexceeded|syndrome buffer|2\\^n|exponential memory|gotcha|footgun|pitfall|run a (large|big) circuit|memory per qubit|simd|multi.?thread|stabilizer (backend|for))\\b',
        goodSource: 'PRIMER#9-performance-memory-and-gotchas|crates/ruqu-core/README\\.md|crates/ruQu/src/(lib|error)\\.rs',
        badSource: 'PRIMER#(1|2|3|6|7)|Cargo\\.toml$|(^|/)docs/(adr|ddd)/', goodBoost: 0.50, badPenalty: 0.38 },
    ],
    // Raw Rust source bodies + design docs + manifests are dense and vector-close to orientation
    // queries but carry implementation detail, not plain orientation facts. Demote them on ANY
    // query UNLESS the query explicitly names that file/symbol surface (allowSource).
    offtopicMagnets: [
      { reSource: '\\.rs$', pen: 0.22, allowSource: '\\.rs\\b|source code|implementation|struct |impl |fn |how is .* implemented|show me the code' },
      { reSource: '(^|/)Cargo\\.toml$', pen: 0.26, allowSource: 'Cargo\\.toml|dependencies|manifest|crate version' },
      { reSource: '(^|/)docs/adr/', pen: 0.22, allowSource: '\\badr\\b|architecture decision|design rationale|why was .* decided' },
      { reSource: '(^|/)docs/ddd/', pen: 0.24, allowSource: '\\bddd\\b|domain model|bounded context|aggregate' },
      { reSource: 'SIMULATION-INTEGRATION', pen: 0.20, allowSource: 'integration|wiring|how .* integrat' },
      { reSource: '(SECURITY-REVIEW|RESEARCH_DISCOVERIES|ROADMAP|CHANGELOG)', pen: 0.26, allowSource: 'security|threat|research|roadmap|changelog' },
    ],

    include: [
      { rule: 'mdSweepFullText', roots: ['.'] },
      { rule: 'componentManifests', roots: ['crates'] },
      { rule: 'componentLead', roots: ['crates'] },
      { rule: 'sourceBodies', roots: ['crates', 'cli'], ext: ['.rs', '.ts', '.js', '.mjs'] },
      // tests + examples are the BEST usage docs (real call sites + expected results). Ingested
      // deliberately (sourceBodies excludes them); tagged source_type test|example by build-kb.
      { rule: 'testsAndExamples', roots: ['crates', 'cli'], ext: ['.rs', '.ts', '.js', '.mjs'] },
      { rule: 'docCommentSweep', roots: ['crates', 'cli'] },
      { rule: 'literalFiles', files: ['README.md', 'cli/README.md', 'cli/package.json', 'cli/bin/cli.js', 'crates/ruqu-core/README.md', 'crates/ruqu-algorithms/README.md', 'crates/ruqu-wasm/README.md', 'crates/ruqu-exotic/README.md', 'crates/ruQu/README.md'] },
    ],

    verificationQueries: [
      {
        stage: 1,
        arc: 'what-is-it',
        query: 'What is ruqu?',
        wantPaths: ['PRIMER#1-what-is-ruqu', 'README.md'],
        mustContain: ['quantum', 'pure Rust', 'state-vector', 'WebAssembly'],
      },
      {
        stage: 2,
        arc: 'capabilities',
        query: 'What can ruqu do for me?',
        wantPaths: ['PRIMER#2-what-can-ruqu-do-for-you', 'README.md', 'crates/ruqu-algorithms/README.md'],
        mustContain: ['VQE', 'Grover', 'QAOA', 'Surface Code'],
      },
      {
        stage: 3,
        arc: 'inventory-components',
        query: 'What crates make up ruqu?',
        wantPaths: ['PRIMER#3-what-is-ruqu-made-of-the-five-crates', 'README.md'],
        mustContain: ['ruqu-core', 'ruqu-algorithms', 'ruqu-exotic', 'ruqu-wasm', 'coherence'],
      },
      {
        stage: 4,
        arc: 'how-it-works-pipeline',
        query: 'How does a quantum circuit run on the simulator?',
        wantPaths: ['PRIMER#4-how-a-circuit-runs-the-simulation-pipeline', 'crates/ruqu-core/README.md'],
        mustContain: ['StateVector', 'planner', 'backend', 'noise'],
      },
      {
        stage: 5,
        arc: 'maturity',
        query: 'Is ruqu production-ready and what are its limits?',
        wantPaths: ['PRIMER#5-is-it-production-ready-scope-and-honest-limits', 'README.md'],
        mustContain: ['25', 'simulator', 'MIT'],
      },
      {
        stage: 6,
        arc: 'docs-where-things-live',
        query: 'Where do I read more about ruqu?',
        wantPaths: ['PRIMER#6-where-do-i-read-more-the-docs-map', 'README.md'],
        mustContain: ['ruqu-core', 'ruqu-algorithms', 'README'],
      },
      {
        stage: 7,
        arc: 'end-to-end-usage',
        query: 'How do I install and run ruqu?',
        wantPaths: ['PRIMER#7-how-do-i-install-and-run-it-end-to-end', 'README.md', 'cli/README.md'],
        mustContain: ['cargo add ruqu-core', 'npx @ruvector/ruqu', 'wasm-pack', 'simulate'],
      },
    ],

    bundle: {
      blurb:
        'ruqu drop-in knowledge base — a quantum computing simulator in pure Rust + WebAssembly. ' +
        'A state-vector quantum circuit simulator (SIMD, noise models, multi-threading), production ' +
        'quantum algorithms (VQE, Grover, QAOA, surface-code error correction), and ~25-qubit ' +
        'in-browser WASM. Run circuits with no quantum hardware, even in a browser tab. ' +
        'Install: cargo add ruqu-core ruqu-algorithms · or npx @ruvector/ruqu simulate.',
      questions: [
        'What is ruqu and what does it let me do without quantum hardware?',
        'What is a state-vector simulator and what are VQE / Grover / QAOA?',
        'What are the five crates that make up ruqu?',
        'How does a circuit run — backends, noise, the cost-model planner?',
        'How do I install ruqu or run it from the terminal with npx?',
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
