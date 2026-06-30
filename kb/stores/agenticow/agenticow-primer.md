# agenticow — a top-down orientation

> Git for agent memory: copy-on-write vector branching. Branch a base vector
> memory in ~0.5 ms and 162 bytes, independent of how big the base is.

## 1. What is agenticow?

agenticow is a small, embedded JavaScript library (`npm install agenticow`, Node
≥ 18, ESM) that gives a vector memory the thing Git gave source code: **cheap,
instant branching**. Every other vector store makes you *full-copy* the whole
index to snapshot, fork, or checkpoint it. agenticow **branches** it copy-on-write:
a branch records only its own edits plus a pointer to its parent, so creating one
costs ~0.5 ms and ~162 bytes whether the base holds 10,000 or 1,000,000 vectors.

Query a branch and you transparently see `parent ∪ your edits`, with the child
winning on id collisions and deletes (tombstones) honored. It is built for
**embedded multi-agent memory** — in-process, over a single `.rvf` file, no DB
server and no network.

## 2. What can agenticow do for you?

It makes three expensive things nearly free:

- **Parallel agents share one base memory.** Fork a branch per agent/user/tenant
  off one shared base instead of N full copies of the index — N × 162 bytes,
  N × 0.5 ms.
- **Roll back a poisoned or hallucinated branch.** An agent ingests adversarial
  or wrong memories into a sandbox branch; detect it, drop the branch, and the
  base is instantly clean — no re-ingest, no re-index, blast radius zero.
- **Zero-cost checkpointing before risky steps.** Checkpoint memory before each
  risky tool call (162 bytes each); on failure, roll back to the last good
  checkpoint in ~0.5 ms without replaying earlier steps.

The verbs are Git's: `branch` / `fork` / `checkpoint` / `rollback` / `diff` /
`promote` / `query`. A "memory DevOps" workflow falls right out: an agent
proposes memories in a branch, an **external deterministic verifier** (a test, a
regex, a distance threshold — never a cheap LM judging itself) gates it, and only
a passing branch is `promote()`d into the base.

## 3. What is agenticow made of?

It is a **single npm package** with a deliberately small surface:

- `src/index.js` — the copy-on-write core. It exports `open` / `openBase` and the
  `AgenticMemory` class, whose methods are the public verbs (`ingest`, `query`,
  `branch`, `fork`, `checkpoint`, `rollback`, `diff`, `promote`, `lineage`,
  `status`, `save`/`load`). `src/index.d.ts` carries the full TypeScript types
  (`OpenOptions`, `QueryHit`, `MemoryDiff`, `LineageNode`, …).
- `bin/agenticow.js` — the CLI (`init`, `ingest`, `branch`, `query`, `diff`,
  `demo`, `bench`, `acceptance`).
- `examples/` — 16 runnable scripts, each a real use case (red-team sandbox,
  multi-tenant SaaS, time-travel debug, A/B at scale, personalization, …).
- One external dependency: **`@ruvector/rvf-node`** — ruvector's RVF format and
  its `RvfDatabase` (HNSW index, `.rvf` files, the shipped `derive()` primitive
  agenticow branches on top of).

## 4. How copy-on-write branching works

A base memory is an `.rvf` index. A branch is a new store that holds **only its
own edits** (inserts + tombstones) and a **pointer to its parent**. That is why
create cost is `O(edits)` and `O(1)` in base size — 162 bytes for an empty
branch, regardless of base size.

A `query(q, k)` is an **exact read-through**: it walks the lineage chain
(`child → … → base`), asks each store with its own native index, **merges** the
results, lets the **child win** on any id collision, **masks** anything the branch
tombstoned, and **re-ranks** by exact distance — returning the true
`parent ∪ edits` top-K. `promote(target)` replays a branch's edits into the
target; `rollback(checkpointId)` discards edits since a checkpoint.

## 5. Is it production-ready? Scope and honest limits

agenticow is scrupulously honest about what it proves:

- **Proven:** base-size-independent branch/checkpoint create (162 B / ~0.5 ms —
  the 83× faster / 3000× smaller headline, `npm run bench`) and exact read-through
  with tombstone masking (`npm run acceptance`: 1,000 branches off one base,
  recall@10 = 100%, 943× less disk than 1,000 full copies).
- **Shipped but platform-gated:** a native ANN/HNSW query that spans the COW
  boundary (`fork({ nativeAnn: true })`, recall@10 ≈ 1.0) ships for **linux-x64**
  today; other platforms degrade gracefully to the exact read-through path (same
  correctness, `mem.nativeAnn === false`).
- **Conceded by design:** raw single-index ANN throughput is ~6.3× behind a
  dedicated flat-index engine like hnswlib at 1M-vector scale. agenticow competes
  on memory *versioning / isolation / rollback*, not raw search speed. If you need
  maximum raw similarity-search throughput on a static index, use a dedicated ANN
  library.
- **Roadmap, clearly labeled:** agent marketplaces / shared published base
  memories (the distribution + trust + merge-policy layer is not shipped).

## 6. Where do I read more? The docs map

- `README.md` — the full pitch, benchmarks table, acceptance proof, the comparison
  vs Pinecone/Milvus/pgvector/Chroma/Qdrant, and the honest-scope section.
- `examples/README.md` + `examples/*.mjs` — runnable, executed use cases (the best
  "how do I actually use this" docs).
- `bench/` — `bench.js`, `acceptance.js`, `claim-ladder.js` (reproduce the numbers).
- `src/index.d.ts` — the typed public API.
- The scaffolding ablation study (`SCAFFOLDING-ABLATION.md`) behind the
  "deployment patterns" thesis: smarter orchestration, not smarter execution.

## 7. How do I install and use it end-to-end

```bash
npm install agenticow
```

```js
import { open } from 'agenticow';

const base = open('memory.rvf', { dimension: 1536 });
base.ingest([{ id: 1, vector: embedding }]);

const agent = base.branch('agent-a');        // ~0.5 ms / 162 B, any base size
agent.ingest([{ id: 9001, vector: newMemory }]);
const hits = agent.query(queryVector, 10);    // parent ∪ edits, child wins

const ckpt = agent.checkpoint('clean');
agent.ingest([{ id: 666, vector: poison }]);
agent.rollback(ckpt.id);                       // poison gone, clean memory intact
```

CLI: `agenticow init mem.rvf --dim 128` → `agenticow ingest mem.rvf --n 5000` →
`agenticow branch mem.rvf --as user-42` → `agenticow query mem.rvf.user-42.rvf --k 10`
→ `agenticow diff …`. `agenticow demo` runs a scripted end-to-end walkthrough;
`agenticow bench` and `agenticow acceptance` reproduce the headline numbers.

## 8. How do I extend agenticow

The public contract is the `AgenticMemory` class in `src/index.js` (typed in
`src/index.d.ts`). Add or change a lifecycle verb there and keep its signature
stable; add a CLI subcommand in `bin/agenticow.js`; add a new use-case as a
runnable script under `examples/`. The promotion gate is intentionally *your*
code: agenticow gives you the isolation primitive (branch/fork) — you supply the
**external, deterministic verifier** (a test, compiler, schema/regex validator, or
distance threshold) that decides `promote()` vs `rollback()`.

## 9. Cost, latency, and gotchas

- Branch create is flat in base size but **linear in edit count** (~520 bytes per
  edited vector); a 100-edit branch is ~51 KB.
- The default exact read-through `query()` walks every store in the lineage chain,
  so a very deep chain costs more per query — keep chains shallow, or `promote()`
  to collapse them.
- **cosine note:** rvf-node does not persist the cosine metric across a file
  reopen, and the native COW query is accurate for L2. agenticow therefore drives
  the engine with **L2 over L2-normalized vectors** when you ask for cosine
  (L2 order = cosine order on unit vectors), so both the exact and native paths
  stay correct and survive `save()`/`load()`.
- Selection is the hard part, not branching: a cheap LM judging its own outputs is
  a *worse* selector than a plain vote — gate promotion with something that can't
  hallucinate.
