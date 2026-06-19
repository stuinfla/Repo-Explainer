# Build Journal — agent-harness-generator (MetaHarness) → metaharness-explainer.vercel.app

> **This journal IS the recipe path made auditable.** Mirrors ADR-0001 v1.3.1
> Definition-of-Done (Part II) + DDD v1.3.1 invariants. Evidence-gated.

- **Recipe:** ADR-0001 v1.3.1 ⇄ DDD v1.3.1
- **Status:** LIVE — studio-in-zip fix applied (D13/V + D18 compliance)
- **Upstream:** github.com/ruvnet/agent-harness-generator (MetaHarness)
- **Live:** https://metaharness-explainer.vercel.app
- **Vercel project:** ruv-explainer-agent-harness-generator (prj_ke4Tq6PrZXlU28DOXP2VTOuXVeJN)

---

## Studio-in-zip fix — 2026-06-19 (ADR-0001 v1.3.1 D13/V + D18/INV-14)

### Problem (PROVEN GAP)
The deployed drop-in `metaharness-dropin.zip` (3 MB) had ONLY
`for-humans/agent-harness-generator-primer.md`. The NotebookLM studio media — the
32 MB `metaharness-audio.m4a` audio overview + `metaharness-report.md` — existed in
`studio/` on disk and on the site, but was **MISSING from the zip**. This violates
D13/V (studio media MUST be bundled in the zip at `for-humans/studio/` AND
listed + HIGHLIGHTED in the drop-in file-tree visual). The KB itself (384-dim
`small.rvf`, Gate A 99.9/100) was NOT touched.

### Fix
1. **Rebuilt the zip** — added `for-humans/studio/` with `metaharness-audio.m4a`
   (33,998,838 B), `metaharness-report.md` (7,704 B), `audio-overview-prompt.md`
   (2,164 B), copied from `ruv-explainer-agent-harness-generator/studio/`. All
   `for-ai/` files kept byte-identical. Updated in-zip `manifest.json` (added
   `studio` block + for-humans entries) and `README.md` (added "Listen first"
   section + studio file-tree).
2. **Updated `index.html`** drop-in section (§09) — the "For you" half of the SVG
   file-tree now HIGHLIGHTS `🎧 audio overview` (amber border) + `📄 report`;
   added a prominent `.studio-note` callout listing
   `for-humans/studio/metaharness-audio.m4a` ("play this first, ~32 MB"),
   `metaharness-report.md`, and `audio-overview-prompt.md`; updated figcaptions,
   the SVG `<desc>` a11y text, and the download hint (3 MB → "27 MB incl 🎧 audio
   overview"). Added `.studio-note` CSS matching the existing amber/CTA aesthetic.
3. **Redeployed** the existing Vercel project to `--prod` (deployment
   `dpl_9AeVkTYeQc9PJ3FSGgYHqMJ68JXE`,
   `ruv-explainer-agent-harness-generator-i9awpbclp.vercel.app`). The custom alias
   `metaharness-explainer.vercel.app` was still pointing at the OLD deployment
   (serving the old 3 MB zip) so it was explicitly re-pointed to the new deployment
   via `vercel alias set`.

### Evidence (PROVE-IT)
- **studio in deliverable zip** (`unzip -l downloads/metaharness-dropin.zip`):
  - `for-humans/studio/metaharness-audio.m4a` — 33,998,838 B (~32 MB)
  - `for-humans/studio/metaharness-report.md` — 7,704 B
  - `for-humans/studio/audio-overview-prompt.md` — 2,164 B
- **live site**: `curl -sI https://metaharness-explainer.vercel.app` → HTTP 200;
  HTML shows the `for-humans/studio/` callout, `metaharness-audio.m4a`, and the
  "27 MB (incl 🎧 audio overview)" hint.
- **live zip**: `curl -sI .../downloads/metaharness-dropin.zip` → HTTP 200,
  `content-type: application/zip`, `content-length: 28,743,795` (~27 MB, was
  3,152,452).
- **end-to-end**: downloaded the live-served zip and confirmed `for-humans/studio/`
  with the 32 MB audio is inside it.

### Notes
- Task text referenced the alias `metaharness-explainer.vercel.app`; the linked
  Vercel project for this directory is `ruv-explainer-agent-harness-generator`.
  Both `metaharness-explainer.vercel.app` and
  `ruv-explainer-agent-harness-generat.vercel.app` are production aliases of that
  same project. `--prod` did NOT auto-reassign the custom alias, so it was set
  manually — a redeploy alone would have left the public URL on the stale 3 MB zip.
- KB / Gate A untouched (scope honored): 384-dim `small.rvf`, Gate A 99.9/100.
- 2026-06-19 — Attribution fix (ADR-0001 v1.3.1 constraint Q): added a first-screen hero `.attrib-lede` line naming **Reuven Cohen** in full and stating purpose ("An independent explainer for Reuven Cohen's (@ruvnet) agent-harness-generator — built to help you actually adopt and implement his technology"), styled to the dark amber/brass molten aesthetic (brass left-border, fill-amber bg). Linked the Ruv-Explainer project (github.com/stuinfla/Ruv-Explainer) in the footer credit (replaced bare "Ruv-Explainer dual-half pipeline" text with a real link). Existing prov-banner + live provenance (date/SHA db65fab/v0.1.3) kept. Redeployed Vercel prod; the custom alias did NOT auto-move (deploy-verify lesson confirmed) so re-pointed it: `vercel alias set ruv-explainer-agent-harness-generator-qnmjfg59k.vercel.app metaharness-explainer.vercel.app`. VERIFIED on https://metaharness-explainer.vercel.app: HTTP 200, "Reuven Cohen"×3, "independent explainer"×1, stuinfla/Ruv-Explainer link served.

---

## 2026-06-19 — AI-COMPREHENSION GATE replayed (ruqu → MetaHarness): weakest-link ≥95 under TWO judges

**Mission:** replay the proven config-driven AI-comprehension gate + enrichment scripts
(built/proven on ruqu, 60.7→98) on MetaHarness; drive weakest-link ≥95 across all 8 dims; ship.
Used the EXISTING generic scripts (`extract-symbols`/`dep-graph`/`entrypoints`/`coverage-gate`/
`grade-ai-comprehension`) config-driven — no script rewrites. All per-target knobs via the Edit tool
ONLY (kb.config.mjs corruption-safe), `node --check` after each edit.

### What changed (kb.config.mjs `agent-harness-generator` block + primer)
- **embed block** added: `Xenova/bge-small-en-v1.5` 384-dim cls-pooled (same as ruqu/ruvn),
  `rvfSuffix:'.rvf'` → canonical un-suffixed rvf + `.embed.json` sidecar (offline model at
  kb/models-cache, HF_HUB_OFFLINE=1). Replaced the stale MiniLM `.small.rvf`.
- **primerSlugs.{extensibility,gotchas}** → PRIMER#8 / PRIMER#9.
- **extensionFiles** (23 concept→file maps), **docFiles.{cli,usage}**, **typeAliases** (14, all
  verified to exist in symbols.json). Key fix: TS interface MEMBERS aren't captured as method
  symbols, so `docFiles.usage` injects `packages/kernel-js/src/types.ts` (full HostAdapter/HarnessSpec
  bodies) + a reference host adapter.
- **include[]**: added `testsAndExamples` (tests+examples), widened `sourceBodies` to
  `packages,crates,examples-packages,examples`, `componentManifests`/`componentLead` over
  examples-packages.
- **scopeExclude**: added `apps` (separate client-side Studio web-UI, ADR-020..024), `scripts`
  (repo CI tooling), `bench`/`benches`/`experiments` (darwin-mode research benches), `bin` (only
  examples-packages/*/bin/*.mjs identical demo shims) — NOT product API. Honest denominator.
- **PRIMER#8** (extensibility: add host/vertical/template/plugin, stable-API rule, 6-mo kernel
  deprecation) + **PRIMER#9** (perf budgets 90s/5s/10MB, native vs WASM, Codex/Hermes/pi.dev/smoke
  gotchas) authored, grounded in real symbols (`scaffold`/`runWizard`/`render`/`walkTemplate`/
  `renameIdentifiers`/`writeAtomic`/`pluginInitCmd`/`buildRegistryEntry`) + ADRs 002/003/004/005/008/009.
- Enriched PRIMER#1 (own-files/fork-ruflo/branding) + PRIMER#3 (exact kernel semver/6-mo-deprecation
  rule) + PRIMER#8 plugin paragraph (kernelEngines mechanism, no kernel method) to satisfy the
  stricter opus judge.

### Enriched KB built
- Corpus 1351 (old, un-tagged) → **2572 chunks + 11 primer = 2583** (bge-small). All passages
  source_type-tagged: doc 1523 / test 291 / example 299 / config 56 / src 423.
- Structured artifacts: `*-symbols.json` (1211 syms, rustdoc for crates + TS source-scan),
  `*-dep-graph.json` (25 components, 40 internal edges, rust+npm), `*-entrypoints.json` (21 comp,
  3 bins, 148 cmds).

### Gates (real battery + real LLM judge, ANTHROPIC_API_KEY, temp 0)
- **Gate B (coverage):** ratio **0.9841** (247/251), spot-check **0.95**, passage-ratio 10.54,
  all 18 components ≥3. PASS.
- **AI-comprehension gate (weakest-link, per dimension start→final):** every dim 95–98.
  - **opus-4-1 seed7: 95 PASS**  | **opus-4-1 seed19 (cross-seed): 95 PASS**
  - **sonnet-4-5 seed7: 97 PASS** | sonnet-4-5 seed19: 97 PASS
  - Dim7 deep-dive (random buried files, can't tune to): 95–97.7.
  - Opus is the binding (strictest) judge. Iterated opus 91.7 (usage) → 94 (what-it-is) →
    94 (extensibility) → **95** by adding types.ts to docFiles.usage, then enriching
    PRIMER#1/#3/#8 with the exact facts opus flagged (ownership, kernel semver rule, plugin mechanism).
- **Discrimination control:** deliberately-vague context scored **0–15** (max 15) vs real 95–97 —
  judge genuinely discriminates, NOT rubber-stamping. (`kb/_control-probe-ahg.mjs`.)
- **Gate A (tuned+heldout, both variants):** **99.89 / 99.89**, every stage ≥95. Green (kept).

### Shipped
- Rebuilt `ruv-explainer-agent-harness-generator/downloads/metaharness-dropin.zip` (35.9 MB) with
  structured for-ai/: canonical bge `.rvf` + `.embed.json` + tagged passages + symbols + dep-graph +
  entrypoints + MCP server (search_kb · lookup_symbol · get_entrypoints · get_dep_graph) + enriched
  primer (29 KB, +PRIMER#8/#9). Verified standalone: `--symbol HostAdapter` → types.ts:43.
- Deployed `vercel --prod` → `ruv-explainer-agent-harness-generator-piihxra89.vercel.app`; alias did
  NOT auto-move, re-pointed: `vercel alias set …-piihxra89… metaharness-explainer.vercel.app`.
- **Live verified:** HTTP 200; served zip md5 `4cd37ffbbb1d4578941e342a8cb537d6` == local. ✓

### Not tested / honest limits
- The two studio files copied into `kb/stores/agent-harness-generator/studio/for-humans/` are the
  pre-existing MetaHarness audio/report (unchanged; my work changed the KB, not the media).
- The gate judges the DROP-IN's retrieval+structured artifacts; it does not execute the generated
  harness. Symbol extraction for TS interface *members* relies on injected file bodies (the scanner
  captures interface declarations, not per-member method symbols) — covered by docFiles/extensionFiles.
