# OpenConnector — Primer

## What it is

OpenConnector (`oomol-lab/open-connector`, Apache-2.0, by OOMOL Lab) is an **open-source connector
gateway for AI agents** — an alternative to Composio. You connect user app accounts (GitHub, Gmail,
Notion, Slack, BigQuery, Supabase, Airtable, and ~1,000+ more) **once**, and the gateway then exposes
a shared catalog of 10,000+ prebuilt, schema-typed **Actions** to agents and applications — through
MCP, plain HTTP/OpenAPI, the Connector SDK, the `oo` CLI, and a Web Console for administration.

The core promise: **provider secrets stay behind the runtime boundary.** Agents receive action
metadata, safe account labels, and execution results — never the API keys or OAuth tokens.

## The problem it solves

Agents need durable access to the tools users already use. Today you either paste API keys into the
agent's environment (every prompt, log, and tool call is one leak away from your credentials) or you
hand-build each integration — the OAuth dance, token refresh, request schemas, scopes — per service.
OpenConnector centralizes all of that in one inspectable, self-hostable runtime.

## Core concepts

- **Provider** — one external service (e.g. `github`, `hackernews`). Lives in
  `src/providers/<service>/` as `definition.ts` (catalog source: auth types, credential fields,
  action schemas, required scopes) + `executors.ts` (lazy-loaded code that actually calls the
  provider's API). ~1,086 provider directories in-repo.
- **Action** — one typed operation (`github.get_current_user`, `hackernews.get_top_stories`) with a
  JSON-schema input/output contract, required scopes, and an agent-readable markdown guide at
  `/api/actions/:actionId/agent.md`.
- **Connection** — a stored credential for a provider (`api_key`, `oauth2`, `custom_credential`, or
  virtual `no_auth`), managed by `src/connection-service.ts`. Named connections allow multiple
  accounts per service; agents select by alias, never by secret.
- **Credential boundary** — credentials are stored in SQLite (local/Fly) or D1 (Cloudflare),
  encrypted with AES-256-GCM when `OOMOL_CONNECT_ENCRYPTION_KEY` is set. OAuth client secrets and
  token refresh live in `src/oauth/`. Run logs are redacted.
- **Policy & tokens** — `src/core/action-policy.ts` enforces allow/block lists per action; runtime
  tokens (`oct_...` bearer tokens) gate `/v1/*` and `/mcp`; an admin token gates the console/`/api/*`.
- **Access surfaces** — MCP at `POST /mcp` (tools: `list_apps`, `search_actions`, `get_action_guide`,
  `execute_action`), HTTP runtime API at `/v1/*`, generated OpenAPI at `/openapi.json`, and the Web
  Console (Vite app under `web/`).

## How a call works (runtime flow)

1. Agent calls an action (MCP `execute_action` or `POST /v1/actions/<service>.<action>`).
2. Gateway authenticates the runtime token, then `action-policy` checks allow/block.
3. `src/core/validation.ts` validates input against the action's JSON schema.
4. `connection-service` resolves the selected connection and decrypts the credential.
5. The provider's lazy-loaded executor makes the real API call with the credential.
6. The result returns to the agent; the run is logged with secrets redacted. The credential never
   crosses back to the caller.

## How it's built

TypeScript, Node 22+ (native TS execution — no bundler), Hono for the HTTP server,
`@modelcontextprotocol/sdk` for MCP, zod + `@cfworker/json-schema` for validation, minisearch for
action search. Storage adapters target SQLite locally and Cloudflare D1/R2 on Workers.
Key modules: `src/server/` (routes, secrets codec, storage, Cloudflare adapter), `src/core/`
(catalog, execution, validation, policy, search), `src/oauth/`, `src/providers/`, `web/` (console).

## Maturity & deployment

v1.1.0, active. Four deployment paths: local Docker (`docker compose up`, pulls
`ghcr.io/oomol-lab/open-connector:latest`) or Node (`npm install && npm run dev`); Fly.io with a
persistent SQLite volume; Cloudflare Workers with D1/R2/Static Assets (`npm run deploy:cloudflare`);
or OOMOL's hosted runtime with the same contracts. Console at `http://localhost:3000`, API docs at
`/docs`.

## Where the docs are

`README.md` (overview), `docs/quickstart.md`, `docs/credentials.md`, `docs/runtime-api.md`,
`docs/configuration.md`, `docs/cloudflare.md`, `docs/fly-io.md`, `docs/catalog-format.md`,
`docs/sdk-cli.md`, `docs/docker-ghcr.md`.

## Use it end-to-end (fastest path)

```bash
docker compose up                      # gateway on http://localhost:3000
curl -s -X POST http://localhost:3000/v1/actions/hackernews.get_top_stories \
  -H 'content-type: application/json' -d '{"input":{}}'   # no-auth action works immediately
# connect GitHub with a personal access token:
curl -s -X PUT http://localhost:3000/api/connections/github \
  -H 'content-type: application/json' \
  -d '{"authType":"api_key","values":{"apiKey":"github_pat_..."}}'
curl -s -X POST http://localhost:3000/v1/actions/github.get_current_user \
  -H 'content-type: application/json' -d '{"input":{}}'
# point any MCP-capable agent host at http://localhost:3000/mcp
```
