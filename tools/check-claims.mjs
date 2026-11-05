#!/usr/bin/env node
// tools/check-claims.mjs — ADVISORY check of the authored page against the repo's own KB.
//
// The brain is asked for content.citations and a real getStarted.install; this compares them with the KB
// and reports, without failing anything:
//   (a) citations whose passageId is not a passage in the KB (or that carry no passageId at all);
//   (b) install / step commands that appear neither in entrypoints (install, quickstart, commands)
//       nor anywhere in the README or passage text.
// Pure functions + a tiny CLI; `checkBuild(build.json path)` is the one call a station makes. It always
// returns a result on a readable build: a signal for the grader / operator, never a gate.
//
//   node tools/check-claims.mjs <build.json> [--root <dir kb paths resolve against>] [--readme <file>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// (a) ── citations ──────────────────────────────────────────────────────────────────────────────
export function checkCitations(content, passageIds) {
  const ids = new Set([...passageIds].map(String));
  const cits = Array.isArray(content?.citations) ? content.citations : [];
  const missing = [];
  cits.forEach((c, index) => {
    const id = c?.passageId;
    if (id == null || norm(id) === '') missing.push({ index, claim: norm(c?.claim).slice(0, 200), passageId: null, reason: 'no passageId' });
    else if (!ids.has(String(id).trim())) missing.push({ index, claim: norm(c?.claim).slice(0, 200), passageId: id, reason: 'passageId not in KB' });
  });
  return { total: cits.length, ok: cits.length - missing.length, missing };
}

// (b) ── commands ───────────────────────────────────────────────────────────────────────────────
const CMD_HEAD = /^(npm|npx|pnpm|yarn|bun|bunx|deno|node|cargo|rustup|pip|pip3|pipx|uv|uvx|python|python3|poetry|go|git|docker|make|brew|curl|wget|bash|sh|gem|bundle|mvn|gradle|dotnet|composer|apt|apt-get|helm|kubectl|\.\/)(\s|$)/;
const looksLikeCommand = (s) => CMD_HEAD.test(s);

// Split a shell block into single commands: join "\<newline>" continuations, then split on newlines,
// `;`, `&&`, `||`. Comments, prompts ("$ ") and bare `cd <dir>` hops are dropped (not claims).
export function splitCommands(block) {
  return String(block ?? '').replace(/\\\r?\n/g, ' ')
    .split(/\r?\n|;|&&|\|\|/)
    .map((s) => norm(s.replace(/^\$\s+/, '')))
    .filter((s) => s && !s.startsWith('#') && !/^cd(\s|$)/.test(s) && !/^(export\s+)?[A-Za-z_]\w*\+?=/.test(s));
}

// Commands quoted in getStarted.steps: every `backtick span` that starts like a command, plus a plain
// step that itself starts with one (e.g. "npx agentbbs web — npx downloads …").
export function extractStepCommands(steps) {
  const out = [];
  for (const st of Array.isArray(steps) ? steps : []) {
    const parts = typeof st === 'string' ? [st] : [st?.strong, st?.text].filter(Boolean).map(String);
    for (const p of parts) {
      for (const m of p.matchAll(/`([^`\n]+)`/g)) for (const c of splitCommands(m[1])) if (looksLikeCommand(c)) out.push(c);
      // Only "cmd — explanation": without the dash separator the command's end cannot be told from prose.
      const dash = p.split(/\s[—–]\s/);
      const lead = norm(dash[0]);
      if (dash.length > 1 && !p.trimStart().startsWith('`') && looksLikeCommand(lead)) out.push(...splitCommands(lead).filter(looksLikeCommand));
    }
  }
  return [...new Set(out)];
}

export function entrypointCommands(ent) {
  const set = new Set();
  for (const k of ['install', 'quickstart']) for (const c of Array.isArray(ent?.[k]) ? ent[k] : []) set.add(norm(c));
  for (const c of Array.isArray(ent?.commands) ? ent.commands : []) { if (c?.cmd) set.add(norm(c.cmd)); if (c?.raw) set.add(norm(c.raw)); }
  set.delete('');
  return set;
}

export function checkCommands(content, { entrypoints, corpusText = '', repoUrl = '' } = {}) {
  const gs = content?.sections?.getStarted || {};
  const known = entrypointCommands(entrypoints);
  // Cloning the repo itself is grounded by the repo slot, not by any file in it.
  const url = norm(repoUrl).replace(/\.git$/, '').replace(/\/$/, '');
  if (url) { known.add(`git clone ${url}`); known.add(`git clone ${url}.git`); }
  const corpus = norm(corpusText);
  const strip = (c) => c.replace(/[.,:]+$/, '');
  const verdict = (c, from) => {
    const cmd = strip(c);
    if (known.has(cmd)) return { cmd, from, groundedIn: 'entrypoints' };
    if (corpus.includes(cmd)) return { cmd, from, groundedIn: 'text' };
    return { cmd, from, groundedIn: null };
  };
  const checked = [
    ...splitCommands(gs.install).map((c) => verdict(c, 'install')),
    ...extractStepCommands(gs.steps).map((c) => verdict(c, 'steps')),
  ];
  const ungrounded = checked.filter((r) => !r.groundedIn);
  return { total: checked.length, ok: checked.length - ungrounded.length, ungrounded, checked };
}

// ── one call for the whole page ────────────────────────────────────────────────────────────────
export function checkClaims({ content, passages = [], ids = null, entrypoints = null, readme = '', repoUrl = '' }) {
  const passageIds = new Set(passages.map((p) => String(p.id)));
  if (ids && ids.entries && typeof ids.entries === 'object') for (const k of Object.keys(ids.entries)) passageIds.add(String(k));
  const corpusText = [readme, ...passages.map((p) => p.text || '')].join('\n');
  const citations = checkCitations(content, passageIds);
  const commands = checkCommands(content, { entrypoints, corpusText, repoUrl });
  const findings = citations.missing.length + commands.ungrounded.length;
  return { advisory: true, ok: findings === 0, findings, citations, commands };
}

// ── loaders + CLI ──────────────────────────────────────────────────────────────────────────────
function readPassageRecords(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function checkBuild(buildJsonPath, { root = process.cwd(), readmePath = null } = {}) {
  const build = readJson(buildJsonPath);
  if (!build) throw new Error(`cannot read ${buildJsonPath}`);
  const res = (rel) => (!rel ? null : path.isAbsolute(rel) ? rel : path.resolve(root, rel));
  const kb = build.kb || {};
  let readme = '';
  const clone = build.repo?.clonePath ? (path.isAbsolute(build.repo.clonePath) ? build.repo.clonePath : path.resolve(path.dirname(buildJsonPath), build.repo.clonePath)) : null;
  for (const f of readmePath ? [readmePath] : clone ? ['README.md', 'readme.md', 'README.rst'].map((n) => path.join(clone, n)) : []) {
    try { readme = fs.readFileSync(f, 'utf8'); break; } catch { /* next */ }
  }
  return checkClaims({
    content: build.content || {},
    passages: readPassageRecords(res(kb.passagesPath)),
    ids: readJson(res(kb.idsPath)),
    entrypoints: readJson(res(kb.entrypointsPath)),
    readme,
    repoUrl: build.repo?.url || '',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const file = args.find((a, i) => !a.startsWith('--') && !['--root', '--readme'].includes(args[i - 1]));
  if (!file) { console.error('usage: check-claims.mjs <build.json> [--root <dir>] [--readme <file>]'); process.exit(2); }
  const fileDir = path.dirname(fileURLToPath(import.meta.url));
  const out = checkBuild(path.resolve(file), { root: opt('--root') || path.resolve(fileDir, '..'), readmePath: opt('--readme') });
  delete out.commands.checked;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
