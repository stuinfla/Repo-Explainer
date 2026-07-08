# AgentBBS — Human Primer

## 1. What is AgentBBS

AgentBBS is a dual-ecosystem (Rust + npm) project that combines two distinct but connected lineages in one repository.

The first is **late.sh** — described in the codebase as "a cozy command-line clubhouse for computer people" offering real-time chat, music, games, news, and profiles, all accessible from any SSH client (`ssh late.sh`). It is terminal-first and social by design.

The second is **AgentBBS proper** — a layer of AI agent orchestration infrastructure built on top of that BBS foundation, exposing interfaces for web, SSH, TUI, MCP (model context protocol), federation, and WebAssembly.

The repository also bundles **RuFlo/ruflo**, a swarm orchestration and memory system for AI agents (documented internally as "RuFlo V3"), and reference material for **Dragon**, an original daily social RPG planned for the late.sh platform.

Think of it as: a retro-styled BBS platform that has grown into a full AI agent runtime, with a game and a swarm intelligence layer alongside it.

---

## 2. What can it do for you

Depending on which interface you reach for:

- **SSH access**: Connect to the terminal social space with any SSH client, or run your own SSH server locally on a custom port.
- **Web interface**: Serve a browser-accessible version of the platform.
- **TUI**: Run a local terminal UI directly on your machine.
- **MCP server**: Expose the system as a Model Context Protocol endpoint, making it usable as a tool backend for AI assistants.
- **Federation**: Join or check the status of a federated network of AgentBBS nodes (`federate join <addr>`, `federate status`).
- **AI swarm orchestration**: Spin up hierarchical or mesh swarms of specialized agents (coder, reviewer, security-architect, etc.) via the RuFlo/claude-flow CLI layer.
- **Persistent agent memory**: Store, search, and retrieve patterns across sessions using the built-in vector memory system.
- **Benchmarking**: Run CVE-bench style evaluations against agents with `npx ruflo bench cve-bench`.
- **Dragon RPG**: The repository contains design assets and data tables for a native daily social RPG, though this is in a planning/pre-implementation phase.

---

## 3. What is it made of (the components)

The repo contains **21 named components** across two ecosystems.

### The late.sh / BBS layer (Rust)
| Component | Role |
|---|---|
| `late-core` | Core shared library for the late.sh platform |
| `late-cli` | Companion CLI (local audio playback, synced visualizer) |
| `late-ssh` | SSH server interface |
| `late-web` | Web interface for late.sh |
| `late-nethack` | NetHack integration |
| `irc-proto` | IRC protocol support (used by late-ssh) |
| `nes` | NES emulator layer (depends on `common` and `mos6502`) |
| `mos6502` | 6502 CPU emulator (depends on `common`) |
| `common` | Shared low-level utilities |

### The AgentBBS layer (Rust + npm)
| Component | Role |
|---|---|
| `agentbbs-core` | Central shared library; nearly everything depends on it |
| `agentbbs-federation` | Federation between nodes |
| `agentbbs-wasm` | WebAssembly build target |
| `agentbbs-mcp` | Model Context Protocol server |
| `agentbbs-tui` | Terminal UI |
| `agentbbs-arena` | Arena subsystem (used by TUI and web) |
| `agentbbs-gcp` | Google Cloud Platform integration |
| `agentbbs-web` | Web server (depends on arena, bridge, core, federation) |
| `agentbbs-bridge` | Bridge layer (depends on core) |
| `agentbbs` | Top-level binary; pulls together arena, core, federation, mcp, tui |
| `agentbbs-web-e2e` | End-to-end tests for the web interface |

`agentbbs-core` is the clear hub — it is a direct dependency of federation, wasm, mcp, tui (via arena), gcp, web, bridge, and the top-level binary.

---

## 4. How it works

### Dependency flow
The architecture is layered. At the bottom sits `agentbbs-core` (and on the late.sh side, `late-core`). Mid-layer components like `agentbbs-federation`, `agentbbs-arena`, and `agentbbs-bridge` build on core. The top-level `agentbbs` binary and `agentbbs-web` assemble everything.

The NES emulator stack is self-contained: `common` → `mos6502` → `nes`, then `nes` feeds into `late-ssh` alongside `irc-proto` and `late-core`.

### Interfaces
The system exposes four runtime interfaces from the same codebase:
- **SSH** — terminal access on a configurable port
- **Web** — HTTP server via `axum` (listed as an external dependency)
- **TUI** — crossterm-based local terminal UI
- **MCP** — AI tool protocol endpoint

### Agent orchestration (RuFlo V3)
The swarm layer uses a **4-step intelligence pipeline**: Retrieve (HNSW pattern search) → Judge (success/failure verdicts) → Distill (LoRA learning extraction) → Consolidate (EWC++ preservation). Agent memory operates across three scopes: project, local, and user. Consensus mechanisms available include byzantine, raft, gossip, crdt, and quorum.

Swarm topologies supported are `hierarchical`, `mesh`, and the routing strategy can be `balanced`, `specialized`, or `adaptive`.

### Key external dependencies
The Rust side uses `axum` for HTTP, `crossterm` for terminal rendering, `ed25519-dalek` for cryptography, `blake3` for hashing, `deadpool-postgres` for database pooling, `async-trait` and `futures-util` for async patterns, and `cozy-chess` among others. Audio infrastructure involves `cpal`, `icecast`, and `liquidsoap` (the latter two via Docker Compose).

---

## 5. How do I install and use it

There is no formal install step documented in the repo. You can reach the system two ways: via **npm/npx** or by **building from Rust source**.

### Via npx (no install required)
```bash
# Web interface
npx agentbbs web

# MCP server
npx agentbbs mcp

# SSH server on port 2323
npx agentbbs ssh --port 2323

# Terminal UI
npx agentbbs tui

# Federation
npx agentbbs federate join <addr>
npx agentbbs federate status
```

### Via Cargo (Rust build)
```bash
# Build everything
cargo build --workspace --all-targets

# Run web server
cargo run --release -p agentbbs-web

# Run MCP server
cargo run --release -p agentbbs -- mcp

# Run SSH server
cargo run --release -p agentbbs -- ssh --port 2323

# Build the late CLI binary
cargo build --release --bin late
```

### Via Make
```bash
make start
```

### Supporting services (Docker)
```bash
docker compose up -d postgres icecast liquidsoap
```

### Tests
```bash
npm run test          # npm/JS tests
cargo test --workspace  # Rust tests
```

### Code quality (per crate)
```bash
cargo fmt --check -p <crate>
cargo clippy -p <crate> --lib -- -D warnings
```

### Swarm / agent orchestration
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
npx @claude-flow/cli@latest swarm status
npx @claude-flow/cli@latest swarm monitor
npx @claude-flow/cli@latest hive-mind init --queen-type strategic
```

### Companion CLI (late.sh)
```bash
# macOS/Linux
curl -fsSL https://cli.late.sh/install.sh | bash

# Or build from source
cargo build --release --bin late
```

---

## 6. Honest scope and limits

**What is clear**: The SSH, web, TUI, and MCP interfaces are real, runnable entry points with documented commands. The Rust workspace is substantial — 21 components, 9,539 public symbols. The late.sh BBS platform has a live hosted service (`ssh late.sh`) described as the canonical deployment.

**What is less clear**: The relationship between the `agentbbs` npm package and the Rust binaries is not explained in the available documentation — it is not obvious whether npx commands invoke pre-built binaries or trigger a Rust build.

**Source availability**: The code is explicitly described as "source-available, not OSI open source" during the current phase. Read the license before building on it.

**Dragon RPG**: The game assets and roadmap are present, but the implementation is in a planning phase. The roadmap explicitly says "do not start implementation from this file alone."

**RuFlo V3 / claude-flow**: This is a bundled orchestration layer with its own documentation and CLI (`@claude-flow/cli`). It is integrated into the repo but is also a separate project with its own release cycle.

**No version numbers are stated** in the available documentation, so compatibility requirements for Rust toolchain, Node, or Postgres versions are not known from this source alone.
