# KB grading question sets

`grade-kb.mjs` and `gate.mjs` resolve question files here as
`kb/questions/<target-slug>.<set>.jsonl` — e.g.
`agent-harness-generator.tuned.jsonl` and `agent-harness-generator.heldout.jsonl`.

These are **authored in P6a** (gate A), AFTER the target repo is cloned and the KB is built, so
every `mustContain` token can be verified against text actually present in the source (the ≥98
deterministic bar requires verified facts, not guessed ones — build-plan §3-A, top risk #3).

## Line schema (one JSON object per line; `//` / `#` comment lines are skipped)

```json
{"stage":1,"arc":"what-is-it","query":"What is metaharness?","wantPaths":["README.md","docs/OVERVIEW.md"],"mustContain":["factory for agent frameworks","npx metaharness"],"niceToHave":["harness is the product"],"forbidden":["9 hosts"]}
```

| field | required | meaning |
|---|---|---|
| `stage` | yes | arc stage 1–7 (per-stage score = mean of its questions; gate needs every stage ≥ 95) |
| `arc` | no | human label for the stage |
| `query` | yes | the question, run through the SAME `searchKb()` the CLI/MCP use |
| `wantPaths` | yes | path substrings; M1 = 0.6·[top-1 ∈ wantPaths] + 0.4·[any top-k ∈ wantPaths] |
| `mustContain` | yes | verified facts; coverage = fraction present in the assembled top-k answer |
| `niceToHave` | no | bonus facts (15% weight in M2) |
| `forbidden` | no | tokens that must NOT appear (proposal-as-reality, wrong product, invented API); penalize M2 |

- **tuned** set: used while tuning the reranker.
- **heldout** set: disjoint phrasings of the same 7 stages, NEVER consulted during tuning
  (overfit-proof). Gate A passes only when BOTH sets pass on BOTH variants.

Run: `node grade-kb.mjs --target agent-harness-generator --set tuned` (exit 1 if below threshold).
