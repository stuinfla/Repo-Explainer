#!/usr/bin/env bash
# Seed the Ruv-Explainer AgentDB (Ruflo per-project memory) with the curated
# intelligence carried over from the cognitum-one-sensor-primer prototype.
# Deterministic: writes to the explicit DB path so cwd can never select the wrong brain.
# Re-runnable: uses --upsert so re-seeding updates rather than duplicates.
set -euo pipefail

DB="/Users/stuartkerr/Code/Ruv-Explainer/.swarm/memory.db"
NS="ruv-explainer"

store() {
  ruflo memory store -k "$1" -n "$NS" --vector --upsert --path "$DB" --value "$2"
  echo "  stored: $1"
}

echo "Seeding namespace '$NS' into $DB ..."

store "pipeline-overview" "The Repo-Primer Pipeline turns any hard-to-grok ruv repo into ONE download with two halves. HUMAN half = NotebookLM studio outputs (explainer video, audio overview, native-PDF slide deck, infographics), hand-curated, pulled via the nlm CLI. AI half = a force-walked RVF single-file vector knowledge base of the repo's OWN tree plus Whisper transcripts and a summary. Bundle both halves into one zip, publish to a rolling GitHub Release (kb-latest, permanent URL), surface on a static page with live provenance. Evergreen: a daily cron polls the upstream submodule and dispatches a rebuild only when the SHA moved. Proven on RuView and ruvector (live at cognitum-sensor-primer.vercel.app)."

store "comprehension-arc" "Every artifact must deliver this 7-stage journey for a newcomer who has never seen the repo: 1 what is this concept; 2 what can you do with it; 3 why was it built; 4 what problems does it solve; 5 one concrete end-to-end example; 6 three or four other application areas; 7 how exactly do I implement it. This is the acceptance bar: if a true beginner is still lost after the human half, the primer failed. An agent loaded with the AI half must be able to start using the tool on a real task."

store "notebooklm-authoring" "Human half production (MANUAL today): build the target repo into a NotebookLM notebook (sources hand-curated), generate studio outputs, then pull them via the nlm CLI (notebooklm-mcp-cli at /opt/homebrew/bin/nlm). Re-auth from a running Chrome via CDP: nlm login --provider openclaw --cdp-url http://localhost:9222. Commands: nlm list artifacts NOTEBOOK; nlm download audio|video|slide-deck|infographic NOTEBOOK --id ID -o PATH. Slides ship as native PDF (NO OCR, keep it simple). Transcribe audio and video with Whisper small.en to create the for-ai transcripts. The human half is NOT generated from the force-walk passages; it is a separate hand-curated path from the same source repo."

store "rvf-build" "AI half build: use @ruvector/rvf (Node, wraps @ruvector/rvf-node). API: RvfDatabase.create/open/openReadonly, ingestBatch, query, compact, status, close. close() is the ONLY persist path (there is no separate flush/save). Build TWO variants: small = Xenova/all-MiniLM-L6-v2 384-dim (automatic, evergreen, fast) and big = Xenova/bge-base-en-v1.5 768-dim (manual, over 1h CPU on a free runner). After the walk, append the 7-stage comprehension-arc primer sections into the .rvf (index-primer step). RvfError 0x0106 means ManifestNotFound, usually a persist failure from over-ingestion."

store "scope-boundary-rule" "CRITICAL RULE: a repo primer indexes ONLY that repo's OWN tree. At build time read .gitmodules and exclude every nested submodule and vendored dependency. Two independent failure modes if violated: a) over-ingestion broke the build (RuView vendored the entire ruvector engine, producing 44083 chunks and 4135 segments, which overwhelmed RvfDatabase.close() on a 2-core runner and threw ManifestNotFound; after the fix 6772 chunks and 637 segments); b) it drowns the learner in dependency internals (wrong tool, wrong audience). Each tool gets its own primer; cross-tool material belongs to that other tool's primer."

store "evergreen-ci" "Evergreen automation: a daily scheduled workflow bumps the target submodule pointer ONLY if upstream SHA moved (git diff --quiet gate), then dispatches the rebuild via gh workflow run (workflow_dispatch). Traps learned the hard way: a GITHUB_TOKEN push does NOT fire on-push workflows (GitHub anti-recursion), so you must dispatch explicitly; the dispatching workflow needs actions: write permission; CI commit steps must git pull --rebase --autostash before push (retry x3) because concurrent commits land mid-build; build and guard MUST run BEFORE publish so a bad build never clobbers the live download (fail-safe ordering)."

store "guard-and-distribution" "Guard before publish (guard-check): anti-truncation + parity + live-query checks; red means stop, never publish (the arc-coverage check is a designed-not-built follow-up). Distribution: rolling GitHub Release kb-latest (--clobber, permanent URL); loose KB files under 100MB are committed as source of truth; the large bundle zips are gitignored (GitHub 100MB per-file limit) and live on the Release; the static page reads /kb/.last-built.json for live provenance (rebuild date plus submodule SHAs). RuView bundle measured about 138MB (June 2026). Both RVF variants always ship; big is carried forward between manual runs with each variant's originating SHA recorded in the bundle manifest."

store "built-vs-designed" "Keep this split honest, never claim designed work as done. BUILT and PROVEN (RuView and ruvector, live): dual-half bundle, both RVF variants, multi-KIND walk (source, deep-docs, crate-src), guard-before-publish, change-based trigger, Release distribution, scope-boundary via .gitmodules, live provenance. DESIGNED and NOT YET BUILT (committed follow-ups = the build backlog): delta-highlighting (surface what is new each refresh), the full 5-strategy force-walk (add API/exports, examples, changelog passes), the comprehension-arc coverage guard, automated NotebookLM authoring, and the generalized per-repo build scripts."

store "qa-and-authoring-method" "Reusable method that worked: specialist agents author (adr-architect plus domain-modeler) from a shared context pack; ONE QA reviewer grades both docs against a beginner-from-zero bar AND cross-doc consistency; fixes route back to the ORIGINAL authors (they hold full context); the lead verifies every change ON DISK, never on an agent's word (PROVE, do not assert). Then an adversarial improvement pass (a design-challenger trying to beat the design plus a playbook-auditor checking turnkey readiness). This QA caught and killed a false-confidence defect: invented numbers and designed-behavior modeled as enforced invariants. Lesson: a subagent that reports done with zero tool uses did nothing, so verify on disk."

store "assets-and-tooling" "Tooling: visuals via OpenAI gpt-image-1 (dark background near hex 070b10 with phosphor-green and cyan to match the page aesthetic; CSS object-fit contain blends seamlessly). Transcripts via Whisper small.en. Off-site page links open in a new tab (target=_blank rel=noopener). Browser and CDP: shared Chrome Debug on port 9222; the CDP websocket needs no Origin header (use asyncio websockets, not websocket-client, to avoid a 403). API keys live in a gitignored .env, NEVER commit them."

store "reference-implementation" "The working reference implementation lives in the prototype repo at /Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer. Key files to port and generalize: kb/build-ruview-kb.mjs and kb/.build-ruvector-kb/build.mjs (the force-walk plus embed), kb/index-primer.mjs (appends the comprehension-arc sections), kb/guard-check.mjs (the anti-truncation/parity/live-query gate), kb/make-bundles.mjs (zips both halves, sweeps studio media recursively), kb/update-readme-pins.mjs (writes .last-built.json), and the workflows .github/workflows/rebuild-kb.yml plus update-ruview-submodule.yml (the evergreen pipeline). These are currently hard-wired to RuView and ruvector; generalizing them to take a repo id plus a per-repo config is the FIRST engineering task in this new repo."

echo ""
echo "=== entries now in namespace $NS ==="
ruflo memory list -n "$NS" --path "$DB" 2>/dev/null | grep -viE 'ONNX|Loading|cache hit|embedder' || ruflo memory list --path "$DB"
