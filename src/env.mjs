// src/env.mjs — environment + secret loading for the explainmyrepo CLI.
//
// The deterministic tools/ each read their own credentials from the environment (CONTRACT §d
// "Secrets"). Several of them (generate-image, quality-grade) ALSO self-parse the repo-root .env,
// but others (deploy, publish-repo, notify) read process.env only. So the orchestrator loads .env
// ONCE here, merges it under process.env (process.env always wins), adds the canonical aliases the
// tools expect, and hands that merged env to every child spawn AND to its own Claude brain calls.
//
// Secrets are NEVER printed, NEVER written to build.json, NEVER committed (CONTRACT §d). This module
// only resolves them in-memory; the redact() helper exists so any diagnostics stay safe.

import fs from 'node:fs';
import path from 'node:path';

// Parse a dotenv file into a plain object. Never throws (a missing .env is normal). Supports
// `KEY=value`, `export KEY=value`, and single/double-quoted values. Ignores comments + blanks.
export function parseDotenv(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (!k) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

// Canonical aliases: the tools/ + brain code read the canonical names, but this repo's .env uses
// vendor-specific ones. Fill the canonical key from the first present alias WITHOUT overwriting a
// value that is already set.
const ALIASES = {
  ANTHROPIC_API_KEY: ['CLAUDE_API_KEY'],
  OPENAI_API_KEY: ['OPEN_AI_KEY'],
};

// Load the merged environment for a build run. process.env overrides the .env file; canonical
// aliases are then back-filled. Returns a NEW object (does not mutate process.env).
export function loadEnv(repoRoot) {
  const fromFile = parseDotenv(path.join(repoRoot, '.env'));
  const merged = { ...fromFile, ...process.env };
  for (const [canon, alts] of Object.entries(ALIASES)) {
    if (merged[canon] && String(merged[canon]).trim()) continue;
    for (const a of alts) {
      if (merged[a] && String(merged[a]).trim()) { merged[canon] = merged[a]; break; }
    }
  }
  return merged;
}

// First present, non-empty value among `names`, else null. Used to resolve a credential without
// caring which alias the operator set.
export function getSecret(env, names) {
  for (const n of names) {
    const v = env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

// Mask a secret for safe logging — only the first/last 3 chars survive.
export function redact(s) {
  if (!s) return '(unset)';
  const t = String(s);
  if (t.length <= 8) return '***';
  return `${t.slice(0, 3)}…${t.slice(-3)} (len ${t.length})`;
}
