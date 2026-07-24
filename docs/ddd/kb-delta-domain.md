# KB Delta Builds — Domain-Driven Design Model

**Version:** 1.0.0
**Created:** 2026-07-24
**Updated:** 2026-07-24
**Status:** Accepted — companion model for ADR-0010 (incremental delta KB builds).
**Paired ADR:** `docs/adr/0010-incremental-delta-kb-builds.md`
**Scope:** the `kb/` engine only (corpus construction → embedding → store maintenance).
Vocabulary from `explainmyrepo-recipe-domain.md` (TargetRepo, RVF KB, AIKnowledgePack) is
carried forward verbatim.

---

## 1. Bounded contexts

| Context | Owns | Code |
|---|---|---|
| **Corpus Construction** | walking a TargetRepo, dispatching config rules, chunking | `kb/chunker.mjs` (new), `kb/corpus-rules.mjs`, `kb/kb.config.mjs` |
| **Embedding & Store Maintenance** | turning a Corpus into a consistent StoreSet (full or delta) | `kb/build-kb.mjs` |
| **Orientation Layer** | synthetic `PRIMER#` entries appended post-build | `kb/index-primer.mjs` |
| **Retrieval** | querying the StoreSet; assumes its invariants, never repairs them | `kb/ask-kb.mjs`, `kb/kb-mcp-server.mjs`, frozen drop-in copies |

The delta feature lives entirely in **Embedding & Store Maintenance**. Corpus Construction
is deterministic and shared by both build modes — that determinism is what makes the
factoring provable (byte-identical sidecars) and the per-file hash meaningful.

## 2. Ubiquitous language

- **Corpus** — the ordered list of chunk records `{path, kind, source_type, title,
  chunkIdx, chunkTotal, text}` produced by running the target's include rules. Value
  object; deterministic function of (repo tree, config, chunker).
- **StoreSet** — the aggregate the builder maintains: the `.rvf` file **plus** its
  sidecars (`passages.jsonl`, `ids.json`, `.embed.json`, `.idmap.json` — the last is a
  correctness dependency: it maps string ids to native labels, and `delete()` resolves
  through it). The `.rvf` alone is not the aggregate; consistency is defined across the
  set, and mutation happens only on a **staged clone** published atomically.
- **FileIdentity (hash)** — sha256 over the JSON-serialized ordered chunk **texts** of
  all records sharing the exact path (every projection, in emission order). Texts only:
  the embed input is text alone, so metadata changes refresh via sidecar rewrite without
  re-embedding. Two FileIdentities equal ⇔ that path contributes byte-identical chunk
  texts to the corpus.
- **Projection** — one (kind, title) grouping of a path's chunks. A single path can carry
  several (e.g. a README as `doc` chunks and a `crate-src` body), with non-contiguous id
  runs; the replace boundary is always the whole path, never one projection.
- **Carried id** — an id whose file's identity is unchanged; survives a delta untouched.
- **Fresh id** — `maxId+1…`, assigned to every chunk of a changed/new file.
- **Synthetic entry** — a passage whose path is not produced by Corpus Construction
  (today: prefix `PRIMER#`). Owned by the Orientation Layer; the delta preserves it
  verbatim and never diffs it.

## 3. Aggregate: StoreSet — invariants the builder must uphold

- **INV-KB1 (parity)** — `status().totalVectors` = passages lines = `ids.json` entries.
  Enforced at the end of every build, full or delta; violation is a hard failure.
- **INV-KB2 (id-order)** — within any path, numeric id order equals **corpus emission
  order** (across all its projections; ids need not be contiguous, only strictly
  increasing). Retrieval's whole-document assembly (`loadPassages`) depends on it,
  including copies frozen in shipped drop-in zips. This invariant is *why* invalidation
  is file-granular: replacing ALL of a changed path's ids with fresh increasing ids
  keeps the ordering; per-chunk carry would interleave old and new ids.
- **INV-KB3 (embedder identity)** — every vector in a store was produced by the embedder
  named in `ids.json` / `.embed.json`. A delta under a different model is refused, never
  mixed.
- **INV-KB4 (synthetic preservation)** — a delta never deletes or reshapes a synthetic
  entry (`^PRIMER#` is the documented marker); BOTH its raw `passages.jsonl` line AND
  its raw `ids.json` entry are carried byte-identical (the primer's `kind`/`preview`
  exist only in `ids.json`).
- **INV-KB6 (isolation)** — a live StoreSet is never mutated in place: deltas stage a
  clone, verify parity there, and publish by atomic rename with a `.bak` fallback. A
  StoreSet-level lockfile serializes `--delta` and `index-primer` runs.
- **INV-KB7 (id monotonicity)** — ids are never reused: allocation starts from a
  persisted high-water mark (`ids.json.maxIdEver`), not from the live maximum.
- **INV-KB5 (corpus fidelity)** — after any build, the non-synthetic content of the
  StoreSet equals the current Corpus exactly (text, metadata, chunk boundaries) — a delta
  is an optimization of *how* the StoreSet reaches that state, never of *what* it contains.

## 4. Domain events (log lines are the event stream)

`DeltaPlanned {carried, toEmbed, toDelete, churnRatio}` → (guards) →
`ChunksEmbedded {n}` / `IdsDeleted {n}` / `SyntheticPreserved {n}` →
`StoreCompacted` → `ParityVerified` — or `DeltaRefused {reason}` (churn, embedder
mismatch, writer lock), which is a first-class outcome, not an error path: the refusal
message must name the cure (full rebuild / `--force-delta` / stop the MCP server).

## 5. Anti-corruption boundary

External tools (like the issue author's helper) previously replicated the chunker —
an unguarded copy of Corpus Construction living outside the boundary. `kb/chunker.mjs`
moves the boundary: external tools import the real chunker, and the churn guard remains
the last-resort drift detector (any chunker change moves every FileIdentity → 100% churn
→ refusal → full rebuild).
