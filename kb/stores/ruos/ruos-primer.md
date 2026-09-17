## 1. What is ruos

ruOS is an **agentic desktop** — a full Linux desktop (GNOME on Xorg, built on Ubuntu 24.04 LTS running on a GCP Compute Engine VM) with the ruvnet AI-agent stack wired in as a first-class control plane. Rather than being "a cloud desktop you happen to reach remotely," its identity is agentic: it's designed to act on its own — research, writing, code, system tasks — instead of waiting for every click.

This repo (`ruvnet/ruos`) is the **public control-and-extension surface** for a ruOS desktop. It's not the whole OS image; it's the code that lets an AI client (like Claude) drive a running ruOS desktop over MCP, plus documentation of the desktop's architecture. The knowledge base for this repo is small — 17 indexed passages, no exposed public components/symbols — reflecting that it's a focused, minimal surface (a Rust MCP server) rather than a large SDK or application framework.

## 2. What can it do for you

Once pointed at a running ruOS desktop, an AI client gets:

- **GUI control** — screenshot the desktop, move/click/drag the mouse, type, send keys, scroll, and wait, via `xdotool` and a screenshot tool (`scrot`, `gnome-screenshot`, or ImageMagick's `import`).
- **Console access** — a `run_shell` tool that runs an arbitrary shell command on the desktop and returns merged stdout/stderr.
- **System control** — `system_action`, a set of named ruOS actions (install / optimize / update / status / restart) proxied to a desktop executor.
- **Display info** — `screen_size`, `cursor_position`, and `desktop_resolution` for querying the current display state.

In short: it lets an agent see the screen, operate the mouse/keyboard, run commands, and trigger system-level actions on a real desktop, the same way a human would.

## 3. What is it made of (the components)

The repo has no formally declared "components" or public symbols in the index, but the passages describe a clear structure:

- **`mcp/`** — the ruos-mcp server itself: a minimal Model Context Protocol server (stdio transport, JSON-RPC 2.0) written in Rust, built with `main.rs`. It advertises a tool catalog (`tools/list`) covering GUI, console, and system actions, and dispatches calls (`call_tool`) to shell commands or an HTTP call to the executor.
- **ruos-welcome-server** — the desktop-side executor (referenced as ADR-016/018) that listens on loopback `127.0.0.1:17870` and handles `system_action` and `desktop_resolution` requests. It's part of the desktop, not this repo's build artifact.
- **`skills/`** — referenced alongside `mcp/` as part of wiring "ruvnet skills" (e.g., Ruflo, RuVecto-related tooling) into a Claude session, via `skills/README.md`.
- **Transport/front-ends** — not code in this repo but part of the described architecture: a rebranded noVNC browser viewer, an installable iPad PWA, and a macOS connect app, all pointing at the same underlying ruOS desktop VM.

No external or internal dependency graph is declared in the index — the server is a small, self-contained Rust binary calling out to system tools (`xdotool`, `scrot`, `curl`, `sh`) rather than linking a large dependency tree.

## 4. How it works

1. **Transport is stdio over SSH.** The `ruos-mcp` binary must run *inside* the desktop's X session, so an MCP client (Claude Code, Claude Desktop) launches it by SSHing into the ruOS desktop and running the binary there — e.g. `ssh you@your-ruos-desktop 'DISPLAY=:0 XAUTHORITY=... /usr/local/bin/ruos-mcp'`. There's no open network socket for MCP traffic itself; the security boundary is **who can open the SSH session**.
2. **JSON-RPC over stdin/stdout.** `main()` reads lines from stdin, parses each as JSON, and routes methods like `initialize` and tool calls through a `handle` function that replies with `{"jsonrpc": "2.0", "id": ..., "result": ...}` or an error object.
3. **GUI and shell tools** shell out directly: screenshots run `scrot`/`gnome-screenshot`/`import` in sequence until one succeeds and return a base64-encoded PNG; mouse/keyboard tools invoke `xdotool`; `run_shell` runs `sh -lc <cmd>` and merges stdout+stderr.
4. **System actions** (`system_action`, `desktop_resolution`) are proxied via `curl` as an HTTP POST to the local executor at `127.0.0.1:17870`, which is a separate process on the desktop (not part of this Rust binary).
5. **Display env fallback.** If `DISPLAY` isn't set when the binary starts, it defaults to `:0` so `xdotool`/`scrot` can find the desktop session even if the SSH launcher forgot to export it.

The broader desktop architecture layers: browser/iPad/macOS viewers → `ruos.cognitum.one` → the ruOS desktop VM (GNOME on Xorg) → `ruos-mcp` (driven by an MCP client over SSH) → `xdotool`/`scrot`/shell → the executor and the rest of the ruvnet agent stack (Ruflo, RuVecto, etc., as referenced but not detailed in this repo).

## 5. How do I install and use it

Build the MCP server from source with Cargo:

```bash
cd mcp && cargo build --release
```

A musl target build is also available for static/portable deployment:

```bash
cargo build --release --target x86_64-unknown-linux-musl
```

(See `mcp/README.md` for musl and deployment notes.)

To use it, point an MCP client at a running ruOS desktop over SSH:

```bash
claude mcp add ruos -- ssh you@your-ruos-desktop \
  'DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority /usr/local/bin/ruos-mcp'
```

Optionally wire in the ruvnet skills/agent tooling:

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
```

Then ask the connected AI client to screenshot the desktop, run a shell command, or invoke a system action / agent swarm. Details are documented in `mcp/README.md` and `skills/README.md`.

**Prerequisites on the desktop side:** an active X session (`DISPLAY=:0`) with `xdotool` and a screenshot tool installed; for `system_action` and `desktop_resolution`, the ruOS desktop executor (`ruos-welcome-server`) must be listening on `127.0.0.1:17870`. GUI tools and `run_shell` work without the executor.

## 6. Honest scope and limits

- This repo is the **control/extension surface**, not the full ruOS desktop image or hosting infrastructure — the actual desktop VM, executor, and ruvnet stack live elsewhere and are only described, not shipped, here.
- The MCP server is intentionally **minimal**: it's a single Rust binary with a small, fixed tool catalog (GUI actions, `run_shell`, `system_action`, display queries) — there's no plugin system, no public API surface, and the knowledge base reflects this with zero declared components or public symbols.
- Security relies entirely on **SSH access control**; the server itself binds no network socket and performs no additional authentication — anyone who can SSH in as the target user can drive the desktop fully, including arbitrary shell execution via `run_shell`.
- `system_action` and `desktop_resolution` have a **hard dependency** on the separate executor process being reachable on loopback; without it, those two tools fail while GUI/shell tools continue to work.
- No install script, package manager entry, or version metadata is documented for this repo — usage is via `cargo build` and manual client configuration only.
- No external dependency list, benchmarks, or public API documentation is available in the indexed material beyond what's summarized above.
