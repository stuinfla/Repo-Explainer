# OpenConnector — primer

## What it is
OpenConnector (`@oomol-lab/open-connector`) is an open-source connector gateway for AI agents and
applications — a self-hosted alternative to Composio. It sits between AI agents/apps and the real
online accounts they need to touch (GitHub, Gmail, Notion, Slack, BigQuery, Airtable, and 1,000+
other providers), exposing a shared catalog of 10,000+ pre-built "Actions" (e.g. `github.create_issue`,
`gmail.send_message`) behind one runtime boundary.

## The core idea
Real credentials (API keys, OAuth tokens) are connected once, at the gateway, and stored encrypted.
Agents never receive the real credential. Instead they call the gateway with a runtime token
(scoped, revocable, logged) via the Connector SDK, the `oo` CLI relay, MCP, or plain HTTP/OpenAPI.
The gateway enforces an action allow/block policy (`ActionPolicyService`, `src/core/action-policy.ts`)
before invoking the matching provider's open-source executor. The agent gets back the action's result
and a safe, redacted account label — never the underlying secret.

## How it's built
- `src/server/` — the Hono-based HTTP app (`connect-server.ts`, `connect-app.ts`), API routes, MCP
  endpoint (`src/mcp.ts`), Cloudflare adapter (`server/cloudflare.ts`), storage adapters
  (SQLite locally / Fly volume; D1 + R2 on Cloudflare).
- `src/core/` — catalog assembly (`catalog.ts`, `catalog-store.ts`), the action policy engine
  (`action-policy.ts`), request/schema validation (`json-schema.ts`, `validation.ts`), provider/action
  types (`types.ts`, `provider-definition.ts`).
- `src/oauth/` — OAuth client config + token refresh services.
- `src/connection-service.ts` — the "front desk ledger": connection identity, scopes, runtime tokens.
- `src/providers/<service>/` — one directory per provider (1,000+), each with `definition.ts`
  (schema/scopes/metadata), `actions.ts`, and `executors.ts` (the actual open-source call-out code),
  generated into a registry/catalog at build time (`scripts/generate-provider-registry.ts`,
  `generate-catalog.ts`).
- `web/` — the React Web Console (provider browsing, credential setup, runtime tokens, Action
  debugging, run logs), served by Vite locally or from the built runtime/Static Assets on Cloudflare.
- `migrations/` — SQL migrations for the runtime's SQLite/D1 state (connections, tokens, run logs).

## Maturity / status
v1.1.0, Apache-2.0, actively maintained by OOMOL Lab. Ships with tests (`vitest`), typecheck, lint
(`oxlint`), and a generated OpenAPI 3.1 document served at `/docs`. Deployable via Docker/Docker
Compose (published GHCR image), Fly.io (Node + persistent SQLite volume), or Cloudflare Workers
(D1 + R2 + Static Assets), or usable hosted via OOMOL with the same provider/Action contracts.

## Where the docs are
`README.md` (overview, quick start), `docs/quickstart.md`, `docs/runtime-api.md` (HTTP/OpenAPI/MCP
surface), `docs/credentials.md` (API key/OAuth/custom credential handling), `docs/configuration.md`
(policy, tokens), `docs/catalog-format.md` (provider/action schema shape), `docs/cloudflare.md`,
`docs/fly-io.md`, `docs/docker-ghcr.md`, `docs/sdk-cli.md` (Connector SDK + `oo` CLI), `CONTRIBUTING.md`.

## How to use it end-to-end
1. `docker compose up` (pulls `ghcr.io/oomol-lab/open-connector:latest`), or `npm install && npm run dev`
   for local Node development (API on `:3000`, Web Console dev server on `:5173`).
2. Open `http://localhost:3000` (console) and `http://localhost:3000/docs` (API reference).
3. Verify with a no-auth Action: `POST /v1/actions/hackernews.get_top_stories`.
4. Connect a real provider (e.g. GitHub via `PUT /api/connections/github` with an API key, or OAuth
   for providers like Gmail), then call a credentialed Action such as `github.get_current_user`.
5. Give an agent a scoped runtime token (not the real credential) via the SDK/CLI/MCP/HTTP, set an
   action allow/block policy, and review run logs and access from the Web Console.
6. For production, redeploy the same runtime to Fly.io or Cloudflare Workers, or point the same
   provider/Action contracts at OOMOL's hosted runtime.
