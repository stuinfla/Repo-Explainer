# ternlight — A Human Primer

## 1. What is ternlight

ternlight is a sentence-embedding model packaged as a WebAssembly module. Give it a piece of text; it returns a 384-dimensional unit vector representing that text's semantic meaning. It is inspired by Microsoft's BitNet b1.58 and built around a core idea: use **ternary weights** — values constrained to `{-1, 0, +1}` — so that inference requires only additions and subtractions, never floating-point multiplies.

The result is a model that fits in roughly 5–7 MB (depending on variant), runs anywhere JavaScript runs, and is designed to embed a sentence in under 2 milliseconds on an M-series Mac.

The project is currently at **v0.1, pre-alpha**, and is not yet accepting outside contributions.

---

## 2. What can it do for you

ternlight produces embeddings you can compare with cosine similarity (which, because the output vectors are L2-normalized, reduces to a plain dot product). That primitive underlies:

- **Semantic search** — find documents that mean the same thing, not just share keywords
- **FAQ matching** — route a user question to the closest known answer
- **Clustering** — group texts by topic without labels
- **Deduplication** — detect near-duplicate content

The model is not a general-purpose LLM. It takes text in, returns a vector out. That is its entire job.

---

## 3. What is it made of (the components)

The repo contains two components:

**`tern-engine`** — A Rust crate compiled to WebAssembly via `wasm-pack`. It owns the full inference pipeline: tokenization (using the `tokenizers` crate), the BitLinear forward pass, and the final L2-normalized embedding output. The WASM binary targets `wasm32-unknown-unknown`, meaning it runs in Node.js, browsers, Cloudflare Workers, and Vercel Edge — no WASI required. External dependencies include `libm`, `sha2`, `tokenizers`, and `wasm-bindgen`.

**`ternlight-monorepo`** — The npm-side wrapper. It provides a thin JavaScript API (`embed`, `similarity`, `classify`) with no tokenization logic of its own. It passes inputs straight to the WASM engine. Two packages are published: `@ternlight/base` and `@ternlight/mini`.

The two components have no internal dependencies on each other beyond the compiled WASM artifact that the engine produces and the JS wrapper consumes.

---

## 4. How it works

The system has three tightly coupled layers: a JS wrapper, a WASM engine, and a packed binary model file.

**Training (offline, Python/GPU)**
A teacher model (a high-quality sentence transformer) generates soft embedding targets for a training corpus. A 2-layer student model, built entirely from BitLinear layers, is trained against those targets using quantization-aware training (QAT). During training, weights are stored as float32 "shadow weights" for gradient flow, but the forward pass projects them to `{-1, 0, +1}` via a sign function with a zero-band threshold. Gradients flow back through the shadow weights using the straight-through estimator. The loss combines cosine similarity alignment with a contrastive guardrail (weight 0.15) to prevent mode collapse.

**Model format**
The trained weights are exported into a single `.bin` file. The format starts with a 32-byte header (magic bytes `TERN`, format version, embedding format ID, vocab size, model dimensions) followed by the packed weights. The engine reads this file linearly at load time with no deserialization step — it maps the binary sequentially into a single contiguous memory block.

**Inference**
The engine executes a hardcoded computation graph: embed tokens, run 2 BitLinear transformer layers, mean-pool over real (non-padding) token positions, project to 384 dimensions, and L2-normalize. The ternary matmul inner loop is branch-free: each weight encodes a sign bit, and the operation becomes a vectorized add/subtract over 128-bit WASM SIMD lanes. There is no floating-point multiply in the hot path.

**Variants**
The engine ships in four feature-gated builds that differ only in how the embedding table is quantized:

| Variant | Embedding quantization | Bundle size |
|---|---|---|
| `emb_int4` ⭐ (primary) | 4-bit per-row PTQ + per-row fp32 scale | ~7 MB |
| `emb_int8` | 8-bit per-row + per-row fp32 scale | ~11 MB |
| `emb_ternary` | Packed ternary + per-row fp32 scale | ~5 MB |
| `emb_fp32` | fp32 row-major | ~40 MB (parity reference, not shipped) |

All variants share the same WASM engine binary.

---

## 5. How do I install and use it

Install one of the two npm packages:

```bash
npm install @ternlight/base
# or
npm install @ternlight/mini
```

To build the WASM engine yourself from source, use `wasm-pack` with the appropriate feature flag:

```bash
wasm-pack build --target nodejs --features emb_int4   # primary build
wasm-pack build --target nodejs --features emb_int8
wasm-pack build --target nodejs --features emb_ternary
wasm-pack build --target nodejs --features emb_fp32
```

To run tests:

```bash
npm run test
node tests/test_embed.js
node ../eval/benchmarks/smoke.js
```

To build the JS packages:

```bash
npm run build
```

There is no published quickstart guide at this time.

---

## 6. Honest scope and limits

**Pre-alpha.** The project is at v0.1. The API, binary format, and package structure may change. Outside PRs are not yet accepted.

**Narrow output.** The model produces 384-dimensional embeddings. It does not generate text, answer questions, or classify without a separate classification head.

**Input truncation.** The tokenizer truncates input to 128 tokens. Longer texts are silently cut off.

**Quality trade-off is real.** Ternary weights are documented to stay within approximately 95% of the full-precision baseline — there is a measurable quality gap. The eval methodology tracks this gap explicitly across model quality, quantization delta, and runtime performance dimensions, but results are not published in this primer.

**`emb_fp32` is not shipped.** The full-precision variant exists as a parity reference for internal evaluation only.

**Rust + wasm-pack toolchain required** to build from source. The JS packages abstract this away for consumers, but contributors touching the engine need both.
