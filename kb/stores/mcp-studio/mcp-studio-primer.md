## 1. What is mcp-studio

MCP Studio is an open source starter and visual workbench for building ChatGPT apps with the Model Context Protocol (MCP) and the MCP Apps extension. It's a single deployable project that combines a browser playground, a production Streamable HTTP endpoint, validated tools, embeddable `ui://` resources, a theme-aware ChatGPT widget, and five attributed admin dashboard templates. It's an npm package (`site-creator-vinext-starter`), built on Next.js and designed to deploy to Cloudflare Workers via Vinext. A live demo is referenced at `https://web-based-chatgpt-mcp-starter.ruv.chatgpt.site`, with its MCP endpoint at `/api/mcp`.

## 2. What can it do for you

- **Serve a stateless MCP endpoint** (`/api/mcp`) that ChatGPT or any MCP client can connect to, built on the SDK's Web Standard Streamable HTTP transport with JSON responses and no server-managed session ID — designed to scale on serverless infrastructure without sticky sessions.
- **Run one UI in two runtimes**: a single widget bundle that works both as a standalone browser page (`/widget?mode=web`) and as an MCP Apps resource inside ChatGPT, with host context controlling theme and sizing.
- **Give you a playground** at `/` for inspecting tool schemas, browsing resources, trying the template builder, and following a setup guide.
- **Ship five attributed dashboard templates** (Signal Analytics, Order Command, Fleet Pulse, Care Calendar, and others), each an original implementation inspired by a specific Dribbble design with visible creator/source attribution — not copied assets.
- **Enforce security basics out of the box**: strict Zod schemas, a 32 KiB request size limit, explicit CORS, no-store responses, MIME-sniffing protection, and a resource CSP with no external domains.
- **Support optional ChatGPT authentication** via headers (`oai-authenticated-user-id`, etc.) and a sign-in redirect flow, for cases beyond the harmless, read-only demo.

## 3. What is it made of (the components)

The repo is indexed as a single npm component: **site-creator-vinext-starter** (version `0.1.0`, requires Node `>=22.13.0`).

Key routes and files it ships:

| Route/File | Purpose |
|---|---|
| `/` (`app/page.tsx`) | Playground, template builder, tool schemas, resource inspector |
| `/api/mcp` (`app/mcp/route.ts`) | Canonical stateless Streamable HTTP MCP endpoint |
| `/api/mp` | Compatibility alias for the earlier short path |
| `/widget?mode=web` | Browser version of the embedded widget |
| `/resource` | Resource metadata and a `resources/read` example |
| `ui://starter/dashboard.html` | Bundled MCP Apps HTML resource |
| `lib/templates.ts` | Typed catalog of the five attributed dashboard templates |
| `lib/catalog.ts` | Tool definitions and `RESOURCE_URI` |
| `app/chatgpt-auth.ts` | ChatGPT-header-based auth helpers |

External dependencies span the UI/form stack (`@base-ui/react`, `@shadcn/react`, `radix-ui`, `react-hook-form`, `@hookform/resolvers`, `zod`), MCP integration (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`), the app framework (`next`, `react`, `react-dom`, `next-themes`), and supporting utilities (`drizzle-orm`, `date-fns`, `recharts`, `clsx`, `tailwind-merge`, `sonner`, `cmdk`, `lucide-react`, and more). There are no internal deps — it's self-contained.

The knowledge base behind this primer indexes 347 passages, 34 public symbols, and 35 entrypoint commands from the repo.

## 4. How it works

- A request to `/api/mcp` hits `app/mcp/route.ts`, which creates and closes one MCP server and transport per request — no durable session state, no session ID issued by the server. This is documented as ADR 001: "Stateless Streamable HTTP transport," a deliberate choice to avoid needing sticky sessions on serverless Workers.
- CORS headers are applied to every response (`Access-Control-Allow-Origin: *`, restricted methods/headers), and the POST handler reads the request body in chunks, rejecting anything over 32 KiB before parsing — matching ADR 003's security posture: read-only, deterministic, strict schemas, no external CSP domains.
- `/api/mp` is a compatibility alias that re-exports the same handlers as `/api/mcp` (`export { POST, GET, OPTIONS, DELETE } from '@/app/mcp/route'`). A legacy `/mcp` app route also exists in source, though some managed hosting edges reserve that path.
- The widget is authored once and runs in two modes (ADR 002): browser mode calls `/api/mcp` directly; ChatGPT mode connects through the MCP Apps host bridge, with the host controlling theme/sizing.
- Templates are defined in one typed catalog (`lib/templates.ts`, ADR 004) — each entry has a stable ID, category, creator, source title, direct Dribbble URL, accent, and description, so attribution is both visible and machine-readable.
- Optional ChatGPT-native auth reads headers like `oai-authenticated-user-id` and `oai-authenticated-user-email`, with a `safeRelativeReturnPath` guard to prevent open-redirect issues on sign-in/sign-out/callback paths.
- The project is coordinated with RuFlo V3 tooling (config in `.claude-flow`, `.claude`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`), an optional layer for agentic/swarm-based development workflows — not required to run the app itself.

## 5. How do I install and use it

Install:

```bash
npm run install:ci
# or
pnpm install
```

Run in development:

```bash
npm run dev
# or
pnpm dev
```

Build and start:

```bash
npm run build
npm run start
# or
pnpm build
pnpm start
```

Other useful scripts: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check`, `npm run build:widget`, `npm run db:generate`.

The build target is a Cloudflare Workers–compatible server bundle produced through Vinext; `start` runs it locally via Wrangler.

To connect it to ChatGPT: deploy to a public HTTPS origin (or add a supported MCP auth flow), then add the endpoint in ChatGPT developer settings as `https://your-domain.example/api/mcp`. For the public demo, no authentication is used — a choice the project explicitly says is only acceptable while the service has no private data or write tools.

Optional RuFlo/agentic workflow setup:

```bash
npx ruflo@latest doctor --fix
npx ruflo@latest memory init
npx ruflo@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

The background daemon this enables is optional and consumes model tokens while workers run — start it only for deliberate continuous workflows.

## 6. Honest scope and limits

- The MCP endpoint is explicitly **stateless per request** — no long-lived server state, resumable streams, or server-initiated notifications, since those require durable coordination outside what this starter provides (ADR 001).
- The public demo ships **without authentication**, and the project states plainly this is acceptable "only while the service contains harmless examples and no private data." Anything with private data or write tools needs its own auth story.
- The demo is **read-only and deterministic** by design (ADR 003) — it's a starter/reference, not a hardened production backend on its own.
- The legacy `/mcp` route is retained in source but **may be blocked by some hosting edges** that reserve that path; `/api/mcp` and `/api/mp` are the supported paths.
- Templates are **original implementations inspired by** specific Dribbble designs, with direct attribution links — they are not copies of proprietary logos or assets, and licensing (Apache 2.0) covers the code, not the linked design references, which remain owned by their creators.
- The RuFlo/swarm tooling is an optional coordination layer for development, separate from the MCP Studio application logic itself — it's not required to deploy or use the MCP endpoint or widget.
