# ADR-0010: Incremental (delta) KB builds — embed only changed files

**Status**: Accepted (converged after adversarial review round, Fable 5 vs GPT-5.6-Sol, 2026-07-24)
**Date**: 2026-07-24
**Updated**: 2026-07-24
**Authors**: Claude Code (Fable 5), directed by Stuart Kerr; adversarial reviewer GPT-5.6-Sol (codex)
**Prompted by**: [GitHub issue #14](https://github.com/stuinfla/Repo-Explainer/issues/14) (Jordi Izquierdo, Data Driven Solutions) — heavy user, 15,316-chunk corpus, ~50 min local embed per rebuild, ~99% of it recomputing unchanged vectors
**Supersedes**: None
**Related ADRs**: ADR-0001 (repo-primer recipe; chunker D5, single-384 v1.3.1), ADR-0007 (source identity invariant)
**Code touchpoints**: `kb/build-kb.mjs` (`--delta`), new `kb/chunker.mjs`, new `kb/store-set.mjs`, `kb/index-primer.mjs` (idempotent replace + metadata fix), `tests/kb-delta.e2e.mjs`

---

## Context

`kb/build-kb.mjs` is batch-from-scratch: every run re-walks the tree, re-chunks, and
re-embeds **every** chunk, then writes a fresh store. Chunking is nearly free (pure text
ops, ~3 s on a 15k-chunk corpus); embedding is the entire cost. Because chunks never
cross file boundaries, a per-file content identity is a *correct* invalidation boundary,
not an approximation.

The issue author built an external delta helper and measured: unchanged tree →
15,316/15,316 carried, 0 embedded, ~3 s (vs ~50 min); one added doc → 1 chunk embedded,
immediately retrievable; removal → true delete with `totalVectors` decremented.

### Verified live (2026-07-24, smoke-cycle against the resolved `@ruvector/rvf` 0.3.0)

- `RvfDatabase.open(path)` read-write (advisory writer lock), `ingestBatch`, `delete`,
  `compact`, `status`, `close` all work end-to-end: create → ingest → delete → query →
  close → reopen → ingest → compact → query.
- `status().totalVectors` counts **live** vectors (`rvf-runtime/src/status.rs`) — delete
  decrements it; deleted vectors stop appearing in query results; `compact()` reclaims
  dead space and the store queries correctly afterward.
- **`ingestBatch` with a non-empty `metadata` object THROWS `MetadataNotSupported`**
  (SDK issue #704 guard, `dist/backend.js`). The currently-resolved module is the
  global 0.3.0 — meaning **today's full build and `index-primer.mjs` are broken as-is**
  (existing stores were built under 0.2.2). Nothing in this repo reads RVF-side
  metadata (`ask-kb.mjs`/`kb-mcp-server.mjs` join hits to sidecars by id), so dropping
  the `metadata` field from ingest is a pure fix.
- `delete(ids)` resolves string ids through the `.idmap.json` string→label map and
  **silently ignores unknown ids** (`{deleted: n}` reflects only mapped ones) — callers
  must assert counts themselves.

### Problem statement

1. **Batch tax on iterative users**: daily-changing repos pay a full re-embed for a few
   dozen changed files.
2. **External replicas rot**: the only way to build a delta tool today is to replicate the
   chunker; any drift silently corrupts the store. The chunker must be importable.
3. **Two invariants make a naive delta corrupting** (both found in this repo's own code):
   - **Id-order invariant**: `ask-kb.mjs` (`loadPassages`) reconstructs a path's chunk
     order by sorting its passage ids numerically, and whole-document assembly depends on
     it. Carrying unchanged chunk ids while inserting fresh `maxId+1…` ids for changed
     chunks *within the same file* breaks that ordering for every reader — **including
     `ask-kb.mjs` copies frozen inside already-shipped drop-in zips**, which cannot be
     patched. Note the invariant is per-path id order = **corpus emission order** (a path
     can carry multiple projections — e.g. a README indexed as `doc` chunks AND a
     `crate-src` projection, with non-contiguous id runs; 56 such paths exist in the
     `agent-harness-generator` store alone).
   - **Synthetic layers**: `kb/index-primer.mjs` appends `PRIMER#<slug>` orientation
     entries to the same `.rvf` + sidecars *after* a build, with a narrower passage-line
     shape (`{id,text,path,title}` — no `kind`/`source_type`; their `kind`/`preview` live
     only in `ids.json`). A delta derived from re-walking the repo tree would see them as
     orphans and delete the entire orientation layer.

---

## Decision

### D0 — Fix the metadata regression first (blocks everything else)

`build-kb.mjs` and `index-primer.mjs` stop passing `metadata` to `ingestBatch`. All
per-chunk metadata already lives in the sidecars, which every reader uses. Without this,
no build — full or delta — works against the currently-resolved SDK.

### D1 — Factor the chunker into `kb/chunker.mjs` (importable, no drift)

Move `CHUNK_CHARS` / `OVERLAP_CHARS` / `STRUCT_TARGET_CHARS` / `STRUCT_MIN_CHARS`,
`windowChunk()`, `structureBoundaries()`, `chunk()`, `classifySourceType()`, and
`makeContext()` verbatim into `kb/chunker.mjs`. `build-kb.mjs` imports them. External
delta tools import the *real* chunker; the drift risk the issue's replica guarded against
disappears by construction. Zero behavior change — proven by byte-comparing full-build
sidecars before and after the factoring.

`make-dropin.mjs` is unaffected: the drop-in ships `ask-kb.mjs` / `kb-mcp-server.mjs` /
`kb.config.mjs` / `resolve-deps.mjs`, none of which import the chunker.

### D2 — `--delta` on `build-kb.mjs`, invalidating at FILE granularity

`node kb/build-kb.mjs --target <slug> --delta`

1. **Previous state** from `passages.jsonl` (per-path id-ordered lines = previous
   emission order) — with `ids.json` loaded alongside for preserved-entry metadata and
   the id high-water mark. Baseline must validate before any mutation: sidecars parse,
   passages↔ids id-sets are equal, and `status().totalVectors` matches — else refuse
   and advise a full rebuild.
2. **Re-chunk the whole tree** with the same config rules (cheap), producing the new
   corpus. **Empty corpus → refuse before touching the store** (a bad `KB_REPO_DIR` or
   config must never plan a full deletion).
3. **FileIdentity hash = sha256 over the path's ordered chunk TEXTS** (all projections
   of the exact path, in emission order, JSON-serialized — injective, no delimiter
   ambiguity). Texts only: metadata (kind/title/source_type) changes refresh for free in
   the sidecar rewrite without re-embedding, since the embed input is text alone. Any
   chunker change moves every hash → churn guard trips → full rebuild advised (the
   drift-guard property, preserved at file granularity).
4. **Replace boundary = ALL records sharing the exact path.** Unchanged file → all its
   ids carried untouched. Changed/new file → *all* its chunks (every projection)
   embedded and ingested under fresh ids from the high-water mark; ALL old ids of that
   path `delete()`d, with the returned `deleted` count asserted against the plan.
   Vanished path → ids deleted. Within every path, new ids are strictly increasing in
   emission order (never assert contiguity) → the id-order invariant holds for every
   reader, shipped drop-ins included.
5. **Fresh ids from a persisted high-water mark**: `ids.json` gains a `maxIdEver`
   header field (readers ignore it); `nextId = max(liveMaxId, maxIdEver) + 1`, with a
   `Number.MAX_SAFE_INTEGER` guard. Prevents id reuse after deleting the highest-id
   file (a reused id could collide with a tombstoned label in `.idmap.json`).
6. **Synthetic entries preserved verbatim**: previous entries whose path is absent from
   the new corpus AND matches `^PRIMER#` are carried as their **raw original
   `passages.jsonl` lines AND raw `ids.json` entries** (both, byte-identical — the
   primer's `kind`/`preview` exist only in `ids.json`); their vectors are never deleted.
   The `^PRIMER#` prefix is hereby the **documented contract** for "synthetic, preserve
   on delta" (it is already load-bearing in `ask-kb.mjs`'s `PRIMER_PATH_RE`); any future
   synthetic layer must use it or extend this ADR.
7. **Staged-copy mutation, atomic publish**: the delta clones the `.rvf` +
   `.idmap.json` (APFS clonefile via `fs.copyFileSync` + `COPYFILE_FICLONE` fallback
   to full copy), mutates the **copy**, writes new sidecars to temp files, runs the full
   reconcile on the staged set, then publishes by renaming the previous generation to
   `*.bak` and the staged files into place, deleting `*.bak` on success. A crash
   mid-delta leaves the live store untouched; a crash mid-publish leaves `*.bak` for
   recovery. `compact()` runs on the staged copy only, and only when deletions
   occurred.
8. **Reconcile (strengthened, on the staged set before publish)**: exact id-set
   equality between rewritten `passages.jsonl` and `ids.json`; `status().totalVectors`
   equals that count; per-path ids strictly increasing in emission order; ingest
   `accepted` and delete `deleted` counts equal the plan; plus a probe query proving a
   changed chunk is retrievable. Any failure → staged files discarded, live store
   untouched, `exit 1`.

Why file granularity instead of the issue's per-chunk hash: chunk-granular carry breaks
the id-order invariant (see Context). The extra cost is re-embedding the unchanged
chunks *of changed files only* — for the issue's workload (dozens of changed files/day,
~5.5 chunks/file) that is seconds. The adversarial reviewer's verdict concurred:
file-granular is the right conservative boundary for frozen numeric-id readers.

### D3 — Guards (each provably trips; see the E2E)

- **Embedder identity**: compare `model` + `dimensions` (from `ids.json`) AND
  `pooling` + `normalize` (from `.embed.json`, when present) against the target's
  currently-resolved embedder → mismatch refuses (`exit 2`), advising a full rebuild.
  (Query-side settings — `queryPrefix`, `rankScale` — don't affect passage vectors and
  are not compared. Model *artifact* hashing was considered and rejected: nothing in
  this pipeline tracks model revisions, and the model cache is name-addressed.)
- **Churn**: `(chunksToEmbed + chunksToDelete) / newCorpusSize > 0.4` → refuse
  (`exit 2`), advise full rebuild; `--force-delta` overrides. Deletion counts in the
  numerator so a mass-deletion (e.g. wrong repo dir) trips it. This is a footgun
  guard, not a correctness guard.
- **Missing store / sidecars** with `--delta` → loud WARN, automatic full build.
- **Writer lock / concurrent builders**: a `<base>.lock` file (exclusive create, pid +
  timestamp, removed on exit, stale after 1 h) is taken by both `--delta` and
  `index-primer.mjs` before reading any state — closing the planning race between them.
  RVF's own advisory lock still guards the store file itself.

### D4 — No per-file hash manifest artifact (issue's suggestion 3: declined for now)

Deriving previous state from `passages.jsonl` is *exact* (it is the previous corpus text
itself) and costs <1 s per ~30 MB of passages. A manifest is a second artifact that can
drift from the store. Revisit only if derivation cost ever shows up in measurements.

### D5 — `KB_STORE_DIR` env override

Mirrors the existing `KB_REPO_DIR` precedent: overrides `kb/stores/<slug>` as the output
directory. Exists so the E2E can build against fixtures without touching real stores, and
lets users stage builds.

### D6 — `index-primer.mjs` becomes an idempotent REPLACE (and drops RVF metadata)

Today a re-run appends a second generation of every `PRIMER#` path (duplicates assembled
into documents by `loadPassages`). It now: deletes all existing `PRIMER#` ids from the
store, filters their lines/entries from both sidecars, then appends the fresh
generation — under the same StoreSet lock as D3. This makes the natural iterative loop
(delta → primer refresh → delta …) safe.

---

## Adversarial review round (what changed, what was rejected)

GPT-5.6-Sol (codex, read-only) attacked the v1 draft; every factual claim was
re-verified against the live SDK/source before adoption. Adopted: the metadata
regression (D0 — found by the reviewer, proven by smoke test), staged-copy atomicity
(D2.7), multi-projection paths breaking positional chunk derivation (fixed by
text-only per-path hashing, D2.3/D2.4), primer metadata loss (D2.6 carries both raw
sidecar forms), primer duplication (D6), id high-water mark (D2.5), delete-count
assertion + strengthened reconcile (D2.8), churn numerator including deletions,
empty-corpus refusal, embedder guard extended to pooling/normalize, StoreSet lockfile.
Rejected as over-engineering: explicit synthetic-ownership schema fields (the
`^PRIMER#` prefix is a documented contract instead); model-artifact fingerprinting;
generation-directory publish (single `.bak` swap suffices at this scale). Reviewer's
final verdict agreed: file-granular invalidation is correct.

## Consequences

**Positive**: unchanged corpus ~minutes→seconds; iterative users embed only changed
files; metadata-only config edits refresh sidecars with zero embeds; the chunker is
importable (external tools can't drift); every existing reader — including frozen
drop-in zips — keeps working; a crash can no longer corrupt a store (staged publish);
full rebuilds work again against rvf 0.3.0 (D0).

**Negative / accepted**: changed files re-embed even their unchanged chunks (bounded,
small); deleted vectors leave dead space until the staged `compact()`; ids grow
monotonically and are not globally dense (readers never assumed density — only per-path
ordering); a delta briefly needs ~2× store disk during staging (clonefile makes this
near-free on APFS).

**Risks**: if a future reader assumes globally-contiguous ids, it breaks on
delta-maintained stores — the E2E encodes the per-path invariant as the contract; the
`^PRIMER#` prefix is now the load-bearing synthetic marker (documented above).

## References

- Issue #14 — measured results table and the sidecar-derivation observation (adopted).
- `kb/ask-kb.mjs` `loadPassages()` — the id-order invariant (the reason for file
  granularity).
- `kb/index-primer.mjs` — the synthetic-layer append contract (now idempotent replace).
- `ruvector/crates/rvf/rvf-runtime/src/status.rs` — live-vector semantics of
  `totalVectors` (grounded via RuvNet Brain, 2026-07-24).
- `@ruvector/rvf` 0.3.0 `dist/backend.js` — `rejectUnsupportedMetadata` (issue #704),
  id→label mapping in `delete()` (both verified live, 2026-07-24).
