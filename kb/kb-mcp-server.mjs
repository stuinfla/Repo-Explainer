#!/usr/bin/env node
// kb-mcp-server.mjs — self-contained MCP stdio server for the Cognitum RVF knowledge bases.
//
// Exposes ONE tool:
//   search_kb({ query: string, k?: number = 6, store: "ruvector"|"ruview" })
// It embeds the query locally (MiniLM), queries the requested .rvf readonly, then loads
// the FULL passage text for each hit from the matching .passages.jsonl and returns it as
// readable text (path + title + full passage).
//
// Self-contained: needs only @ruvector/rvf (npm-global), @xenova/transformers (AppealArmor
// build), and the bundled kb/*.rvf + kb/*.passages.jsonl. It implements the MCP JSON-RPC
// stdio protocol directly (no @modelcontextprotocol/sdk dependency), so it runs anywhere
// Node 18+ is available.
//
// Wire it into .mcp.json (see kb/README) — DO NOT use @ruvector/rvf-mcp-server (a stub).
//
// Env overrides: KB_TRANSFORMERS_PATH, KB_MODEL_CACHE (see ask-kb.mjs).

import { searchKb } from './ask-kb.mjs';
import { targets, defaultTarget } from './kb.config.mjs';

const PROTOCOL_VERSION = '2024-11-05';

// Server identity + tool surface are DERIVED from the config registry — NO hard-coded repo names.
const STORE_SLUGS = Object.keys(targets);
const KNOWN_STORES = new Set(STORE_SLUGS);
const DEFAULT_STORE = defaultTarget;
const META_NAME = (targets[DEFAULT_STORE] && targets[DEFAULT_STORE].metaName) || DEFAULT_STORE;

const SERVER_INFO = { name: `${DEFAULT_STORE}-kb`, version: '1.0.0' };

// Per-store one-line descriptions (metaName + bundle blurb) so the tool description is specific.
const STORE_DESCRIPTIONS = STORE_SLUGS.map((slug) => {
  const t = targets[slug];
  const blurb = (t.bundle && t.bundle.blurb) ? ` — ${String(t.bundle.blurb).slice(0, 160)}` : '';
  return `store="${slug}" (${t.metaName || slug})${blurb}`;
}).join(' · ');

const TOOLS = [
  {
    name: 'search_kb',
    description:
      `Semantic search over the ${META_NAME} RVF knowledge base(s). Returns up to 5 whole, `
      + 'self-contained matched DOCUMENTS (all chunks of each reassembled in order, not fragments) '
      + '— READMEs, ADRs, package/component docs, source doc-comments, primers — each with its repo '
      + `path and title. Available stores: ${STORE_DESCRIPTIONS}.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language question or keywords.' },
        store: { type: 'string', enum: STORE_SLUGS, description: 'Which knowledge base to search.', default: DEFAULT_STORE },
        k: { type: 'integer', description: 'Number of passages to return (default 6).', default: 6 },
      },
      required: ['query'],
    },
  },
];

// ---------- minimal JSON-RPC over stdio (newline-delimited, also tolerates LSP framing) ----------
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function err(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  // notifications (no id) — ack silently
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized
  }
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name !== 'search_kb') return err(id, -32602, `unknown tool: ${name}`);
      try {
        const query = String(args.query || '').trim();
        const store = String(args.store || DEFAULT_STORE).trim();
        const k = Math.max(1, parseInt(args.k ?? 6, 10) || 6);
        if (!query) return err(id, -32602, 'query is required');
        if (!KNOWN_STORES.has(store)) return err(id, -32602, `store must be one of: ${STORE_SLUGS.join(', ')}`);
        const results = await searchKb({ query, k, store });
        const text = results.map((r, i) =>
          `#${i + 1}  (distance ${r.bestDistance.toFixed(4)})\n`
          + `path : ${r.path}\n`
          + `title: ${r.title}\n`
          + `----- full document (${r.fullText.length} chars, ${r.chunksJoined} chunk(s)${r.truncated ? ', truncated' : ''}) -----\n`
          + `${r.fullText}\n`
        ).join('\n========================================================\n\n');
        return ok(id, {
          content: [{ type: 'text', text: text || '(no results)' }],
          isError: false,
        });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `search_kb error: ${e.message}` }], isError: true });
      }
    }
    default:
      return err(id, -32601, `method not found: ${method}`);
  }
}

// ---------- stdin line reader ----------
let buf = '';
let inFlight = 0;
let ended = false;
function maybeExit() { if (ended && inFlight === 0) process.exit(0); }

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    inFlight++;
    Promise.resolve(handle(msg))
      .catch((e) => { if (msg && msg.id != null) err(msg.id, -32603, e.message); })
      .finally(() => { inFlight--; maybeExit(); });
  }
});
// Don't exit while requests are still being served (model load + query is async).
process.stdin.on('end', () => { ended = true; maybeExit(); });
