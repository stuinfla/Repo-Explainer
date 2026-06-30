// src/run-tool.mjs — spawn an EXISTING tools/<name>.mjs as a child process (CONTRACT §b).
//
// The orchestrator never re-implements a tool. It invokes each one the uniform way —
// `node tools/<name>.mjs <build-dir>` — and obeys the uniform return convention:
//   • stdout carries EXACTLY one JSON result object → we capture + JSON.parse it.
//   • stderr is diagnostics → we INHERIT it so the operator watches the tool work live.
//   • the exit code is the source of truth → ok iff code 0 (CONTRACT §b·6).
//
// We pass the merged env (src/env.mjs) so every tool finds its own credentials in process.env.

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Pull the LAST non-empty line of stdout and JSON.parse it. Tools route diagnostics to stderr, so
// stdout is normally a single JSON line; the last-line rule is just belt-and-suspenders.
function parseResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* keep scanning upward */ }
  }
  return null;
}

// Run one tool. Returns { ok, code, result, error }. Never throws — the orchestrator decides whether
// a non-ok station is fatal or a non-blocking warning (notify / readme-enhance degrade to warnings).
export function runTool(name, buildDir, { repoRoot, env, timeoutMs = 1_800_000 } = {}) {
  const toolPath = path.join(repoRoot, 'tools', `${name}.mjs`);
  if (!fs.existsSync(toolPath)) {
    return { ok: false, code: 127, result: null, error: `tool not found: tools/${name}.mjs` };
  }
  const res = spawnSync(process.execPath, [toolPath, path.resolve(buildDir)], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],   // capture stdout JSON; stream stderr live to operator
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    const why = res.error.code === 'ETIMEDOUT' ? `timed out after ${timeoutMs}ms` : res.error.message;
    return { ok: false, code: res.status ?? 1, result: null, error: `tools/${name}.mjs: ${why}` };
  }
  const result = parseResult(res.stdout);
  const code = res.status;
  const ok = code === 0 && (!result || result.ok !== false);
  const error = ok ? null : (result?.error || `tools/${name}.mjs exited ${code} (no JSON result on stdout)`);
  return { ok, code, result, error };
}
