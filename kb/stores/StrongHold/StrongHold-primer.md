# StrongHold — Human Primer

## 1. What is StrongHold

StrongHold is a sovereign, memory-centric AI-agent harness served as an API — described in the codebase as "Harness as a Service." The key distinction from a cloud AI-agent service is that it runs entirely on the owner's own hardware (two DGX Sparks), so data stays local. It exposes its capabilities over a public HTTPS endpoint via Tailscale Funnel, with JWT authentication on every request except the health check.

The base URL is `https://spark-47d8.tail333a1d.ts.net/agentmem/v1`.

## 2. What can it do for you

StrongHold gives callers a set of durable, agentic primitives over a REST API:

- **Persistent agent memory** — store text into a named agent's memory (`/memories`) and retrieve semantically relevant passages later (`/recall`). Memory survives restarts because it is backed by an append-only durable log (the source of truth), not just an in-memory vector index.
- **Chat and agentic loops** — `POST /agents/{id}/chat` streams responses via SSE; `/act` runs a multi-step tool-using loop; both accept an optional `tier` knob to select quality vs. speed without naming a model directly.
- **Sub-agent fan-out** — `/fanout` runs up to 8 ephemeral parallel workers against a list of tasks, then aggregates results and dismisses the workers.
- **Sovereign code sandbox** — `/sandbox/run` executes Python, Node, or Bash in a hardened ephemeral Docker container: no network, all capabilities dropped, read-only rootfs, non-root user, memory/CPU/pids/time limited.
- **Tool scoping** — per-call `profile` or explicit `tools` allowlist controls exactly which tools a model may invoke; calls to non-permitted tools are rejected at dispatch.
- **Graduate-on-terminate** — deleting an agent (`DELETE /agents/{id}`) promotes its memories before removal.

## 3. What is it made of (the components)

The repo contains one component: **agenticow-ruflo-memory**.

It depends on four external packages:

| Package | Role |
|---|---|
| `agenticow` | Copy-on-write vector branching ("Git for agent memory") — provides the `*.rvf` vector store |
| `@huggingface/transformers` | Local embedding generation (384-dimensional vectors) |
| `@anthropic-ai/sdk` | Cloud Claude integration for the `max` tier |
| `fastify` | HTTP server framework |

The architecture is intentionally two-tier (ADR-0001): a small, dependency-light internet-facing backend handles auth, rate limiting, and tenant isolation; the internal harness holds model API keys, the memory corpus, MCP credentials, and the sandbox. The two tiers communicate over a strong `X-API-Key`.

## 4. How it works

**Memory persistence:** `agenticow` saves vectors but not text payloads. StrongHold solves this with an append-only durable log that stores both. On restart, the service rehydrates the vector index from the log, making memory deterministically exact across reboots (ADR-0002).

**Authentication:** Bearer JWTs are verified in dual mode (ADR-0003). Supabase projects use asymmetric RS256/ES256/PS256 tokens — the backend fetches the JWKS from the token's own issuer, verifies the signature, and scopes memory to `<projectRef>:<userId>`. Long-lived HS256 tokens serve prototypes and local tooling. An allowlist of Supabase project refs (`SUPABASE_ALLOWED_REFS`) means the API fails closed by default.

**Model routing:** Callers pass an optional `tier` rather than a model name (ADR-0005). `"fast"/"balanced"` uses a local model; omitting tier or passing `"auto"` tries local first, then falls over to cloud Claude, then OpenRouter. `"max"` targets cloud Claude Opus with the same fallback chain. Every response reports the `provider` and `model` that actually answered. Local inference runs across two DGX Sparks in parallel.

**Security posture:** The harness runs as an unprivileged user under rootless Docker (ADR-0004), so a harness-level RCE does not imply host root. The sandbox adds a second containment layer with no network and a read-only filesystem.

**Rate limiting:** Each tenant gets a token bucket (burst ~30, refill ~1/sec). Heavy operations (`act`, `fanout`, `chat`, `sandbox/run`) cost ~5 each. Exceeding limits returns `429` with a `Retry-After` header. Request bodies over ~1 MB return `413`.

## 5. How do I install and use it

No install command is documented in the repo. The quickstart is:

```bash
npm run start
```

Additional documented commands:

```bash
# Run the demo
npm run demo

# Mint a StrongHold token for a specific agent type
node service/mint-stronghold-token.mjs --url http://localhost:8771 --agent-type researcher

# Mint a token scoped to a colleague
node scripts/mint-token.js --sub colleague-name

# Check running sandbox containers
docker ps -a --filter name=agentmem-sbx
```

A drop-in TypeScript client (`src/lib/agentMemory.ts`) is included. It wraps the REST API with typed helpers — `listAgents`, `spawn`, `remember`, `recall`, `searchBase` — and surfaces `Retry-After` on 429 responses. The `AgentMemory` object is the intended integration point for Lovable or any frontend.

For Supabase-backed frontends, the backend automatically verifies real Supabase user tokens with no per-project setup beyond adding the project ref to `SUPABASE_ALLOWED_REFS` in `backend/.env`.

## 6. Honest scope and limits

- **Single-owner hardware.** StrongHold runs on two specific DGX Sparks. There is no documented path to running it on arbitrary hardware or in a generic cloud environment.
- **No published install steps.** The repo brief lists no install command. Getting the service running from scratch requires reading the source.
- **HS256 token risk.** A leaked prototype token maps all holders to one tenant until `JWT_SECRET` is rotated — acknowledged as a residual risk in ADR-0003.
- **Log-at-boot scaling.** The full durable log is read into memory at startup. This is noted as fine at current corpus size but flagged for revisit at very large scale (ADR-0002).
- **Two processes to operate.** The two-tier topology means two services to deploy, monitor, and keep in sync, plus the `owners.json` ownership map as a small stateful component the backend must persist.
- **Provider behavior depends on key configuration.** Which model actually runs for a given `tier` depends on which API keys are present. Behavior can differ between deployments without obvious indication to callers.
- **32 public symbols, 144 indexed passages.** This is a focused, single-component system — not a large framework with broad extension points.
