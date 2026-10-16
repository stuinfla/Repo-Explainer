#!/usr/bin/env node
// make-ask.mjs — Station 6c (NON-BLOCKING): add the "Ask this project" box to the assembled page.
//
// CONTRACT: node tools/make-ask.mjs <build-dir>
//   Reads (declared inputs): repo.owner/name, kb.passagesPath, page.dir
//   Writes (own slot only):  ask { passages, sections, starters }  (or { skipped: why })
//   Files:                   <page.dir>/ask/{index.json,ask.js,ask.css}, a section in index.html
//   stdout = ONE JSON result object; diagnostics → stderr. A thin or missing knowledge base SKIPS the box
//   rather than failing the build — an explainer without Ask is still a complete explainer.
//
// The signed credential is added by deploy.mjs once the final site host is known (src/ask.mjs finalize()).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject, authorStarters, DEFAULT_ENDPOINT, extractSections, readPassages } from '../src/ask.mjs';
import { readContext, mergeSlot } from '../src/build-context.mjs';
import { loadEnv } from '../src/env.mjs';
import { callClaudeJSON, resolveModel, resolveBrainLane } from '../src/claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => process.stderr.write(`[make-ask] ${m}\n`);
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const buildDir = process.argv[2];
if (!buildDir) { emit({ ok: false, outputs: {}, error: 'usage: node tools/make-ask.mjs <build-dir>' }); process.exit(1); }

try {
  const ctx = readContext(buildDir);
  const env = { ...loadEnv(ROOT), ...process.env };
  if (env.ASK_DISABLE === '1') { mergeSlot(buildDir, 'ask', { skipped: 'ASK_DISABLE=1' }); emit({ ok: true, outputs: { ask: { skipped: 'ASK_DISABLE=1' } }, error: null }); process.exit(0); }
  const owner = ctx.repo?.owner, repoName = ctx.repo?.name, siteDir = ctx.page?.dir;
  const rel = ctx.kb?.passagesPath;
  const passagesPath = rel ? (path.isAbsolute(rel) ? rel : path.join(ROOT, rel)) : null;
  const skip = (why) => { log(`SKIPPED — ${why}`); mergeSlot(buildDir, 'ask', { skipped: why }); emit({ ok: true, outputs: { ask: { skipped: why } }, error: null }); process.exit(0); };
  if (!owner || !repoName || !siteDir || !fs.existsSync(path.join(siteDir, 'index.html'))) skip('page not assembled yet');
  if (!passagesPath || !fs.existsSync(passagesPath)) skip('no knowledge-base passages for this build');

  // starter questions: one cheap model call; any failure falls back to plain generic ones
  const lane = resolveBrainLane({ apiKey: env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY, env });
  const ask = lane.ok ? ({ system, user }) => callClaudeJSON({ apiKey: env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY, model: resolveModel(env), system, user, maxTokens: 400, env }) : null;
  const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  // the name the page itself shows in its header (e.g. "REA"), not the lowercase repo slug
  const brand = (html.match(/<a class="brand"[^>]*>[\s\S]*?<span>([^<]{1,40})<\/span>\s*<\/a>/) || [])[1];
  const name = (brand || repoName).trim();
  const starters = await authorStarters({ name, sections: extractSections(html), docs: readPassages(passagesPath), ask });

  const r = inject({ siteDir, passagesPath, repo: `${owner}/${repoName}`, name, starters, endpoint: env.ASK_ENDPOINT || DEFAULT_ENDPOINT });
  log(`added: ${r.passages} passages, ${r.sections} page sections; starters: ${r.starters.join(' | ')}`);
  mergeSlot(buildDir, 'ask', r);
  emit({ ok: true, outputs: { ask: r }, error: null });
} catch (e) {
  emit({ ok: false, outputs: {}, error: String(e.message || e) });
  process.exit(1);
}
