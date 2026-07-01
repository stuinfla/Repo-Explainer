// src/orchestrator.mjs — run the explainer pipeline in CONTRACT order, with Claude in the loop.
//
// The deterministic stations are the EXISTING tools/*.mjs, invoked as child processes (never
// re-implemented — src/run-tool.mjs). Between them, the brain (src/brain.mjs → Claude) authors the
// judgment slots the e2e run proved cannot be deterministic: the primer, concept, content, and the
// Station-4 image briefs + diagram ASCII. The whole run is one BuildContext / build.json (CONTRACT §a).
//
// Station map (CONTRACT §d roster + §a "brain — no tool" rows):
//   0  clone-repo .............. tool   (Station 0–1)
//   1  kb:register ............. brain  GATED — only if the repo isn't in kb/kb.config.mjs
//   2  build-kb ................ tool   (Station 1)
//   3  primer .................. brain  (Station 1 brain deliverable; make-pack needs it)
//   4  concept ................. brain  (Station 2)
//   5  content ................. brain  (Station 3)
//   6  visual-brief ........... brain  (Station 4 brain half: image prompts + diagram ASCII)
//   7  generate-image ......... tool   (Station 4 raster)
//   8  make-favicon ........... tool   (Station 5 — reads the hero)
//   9  make-social-card ....... tool   (Station 5)
//   10 make-diagrams .......... tool   (Station 4 structural SVGs)
//   11 assemble-page .......... tool   (Station 6 — the single render)
//   12 make-pack .............. tool   (Station 6)
//   13 quality-grade .......... tool   (Station 7 — the completion gate)
//   14 deploy ................. tool   (Station 8 — skip with --no-deploy)
//   15 publish-repo ........... tool   (Station 8 — skip with --no-publish)
//   16 repo-seo .............. tool   (Station 8 — skip with --no-publish)
//   17 readme-enhance ......... tool   (Station 8b — optional, env-gated, NON-BLOCKING)
//   18 notify ................. tool   (Station 9 — NON-BLOCKING)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv, getSecret, redact } from './env.mjs';
import { initBuildDir, readContext, mergeSlot } from './build-context.mjs';
import { runTool } from './run-tool.mjs';
import { resolveModel } from './claude.mjs';
import {
  authorConcept, authorContent, authorVisualBrief, visualsSlotFromBrief,
  authorPrimer, authorKbTarget,
} from './brain.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
const log = (s = '') => process.stderr.write(s + '\n');
const step = (n, total, label, kind) => log(`\n${C.bold}${C.cyan}[${n}/${total}] ${label}${C.reset} ${C.dim}(${kind})${C.reset}`);

// Reuse clone-repo's URL grammar (https | git@host:owner/name | bare host/owner/name) just enough to
// derive a default out-dir name before clone-repo runs.
export function parseRepoUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const scp = s.match(/^git@([^:]+):(.+)$/);
  if (scp) s = `https://${scp[1]}/${scp[2]}`;
  if (!/^[a-z]+:\/\//i.test(s)) {
    // bare "owner/name" (no host) → assume github.com; "host/owner/name" keeps its host
    s = /^[^/]+\.[^/]+\//.test(s) ? `https://${s}` : `https://github.com/${s}`;
  }
  s = s.replace(/\/+$/, '');
  let u; try { u = new URL(s); } catch { return null; }
  const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  return { owner, name, url: `https://${u.host}/${owner}/${name}` };
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// ── the gated KB-registration station ──────────────────────────────────────────────────────────
async function kbRegisterStation({ buildDir, env, model, apiKey, opts }) {
  const ctx = readContext(buildDir);
  ctx._repoRoot = REPO_ROOT;
  const slug = ctx.repo?.slug;
  if (!slug) throw new Error('kb:register — no repo.slug yet (clone-repo must run first)');

  const cfgPath = path.join(REPO_ROOT, 'kb', 'kb.config.mjs');
  const importCfg = async () => import(pathToFileURL(cfgPath).href + `?t=${Date.now()}`);
  let registered = false;
  try { const m = await importCfg(); m.getTarget(slug); registered = true; } catch { registered = false; }
  if (registered) { log(`${C.dim}kb target "${slug}" already registered in kb/kb.config.mjs — using it.${C.reset}`); return { ok: true, skipped: 'already-registered' }; }

  log(`${C.yellow}kb target "${slug}" is NOT registered in kb/kb.config.mjs.${C.reset}`);
  const entry = await authorKbTarget(ctx, { apiKey, model });
  const genPath = path.join(buildDir, `kb-target.${slug}.generated.mjs`);
  fs.writeFileSync(genPath, `// GENERATED kb.config target entry for "${slug}" — paste into kb/kb.config.mjs targets{}.\nexport default ${JSON.stringify({ [slug]: entry }, null, 2)};\n`);
  log(`${C.dim}wrote generated entry → ${path.relative(process.cwd(), genPath)}${C.reset}`);

  if (!opts.registerKb) {
    throw new Error(
      `kb:register — "${slug}" must be a registered kb.config target before build-kb can index it.\n` +
      `  • A generated entry was written to ${genPath}.\n` +
      `  • Re-run with --register-kb to inject it into kb/kb.config.mjs automatically (the one step that edits the shared registry), or paste it in by hand.`,
    );
  }
  // --register-kb (opt-in, CLEARLY the single step that mutates kb/kb.config.mjs) ----------------
  let src = fs.readFileSync(cfgPath, 'utf8');
  const anchor = 'export const targets = {';
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error('kb:register — could not find "export const targets = {" in kb/kb.config.mjs to inject into');
  const inject = `\n  ${JSON.stringify(slug)}: ${JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ')},`;
  src = src.slice(0, at + anchor.length) + inject + src.slice(at + anchor.length);
  fs.writeFileSync(cfgPath, src);
  log(`${C.yellow}injected "${slug}" into kb/kb.config.mjs (--register-kb).${C.reset}`);
  const m2 = await importCfg();
  try { m2.getTarget(slug); } catch (e) { throw new Error(`kb:register — injection did not take: ${e.message}`); }
  return { ok: true, registered: true };
}

// ── brain station runners (each reads fresh ctx, authors, merges its slot) ──────────────────────
function brainRun(fn) {
  return async ({ buildDir, apiKey, model }) => {
    const ctx = readContext(buildDir);
    ctx._repoRoot = REPO_ROOT;
    await fn(ctx, { buildDir, apiKey, model });
    return { ok: true };
  };
}

// ── the station table ───────────────────────────────────────────────────────────────────────────
function stations(opts) {
  const tool = (id, name, { fatal = true } = {}) => ({ id, name, kind: 'tool', fatal, run: ({ buildDir, env }) => runTool(name, buildDir, { repoRoot: REPO_ROOT, env }) });
  const brain = (id, fn) => ({ id, kind: 'brain', fatal: true, run: brainRun(fn) });

  const all = [
    tool('clone-repo', 'clone-repo'),
    { id: 'kb:register', kind: 'brain', fatal: true, run: kbRegisterStation },
    tool('build-kb', 'build-kb'),
    brain('primer', async (ctx, { apiKey, model }) => { await authorPrimer(ctx, { apiKey, model, repoRoot: REPO_ROOT }); }),
    brain('concept', async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'concept', await authorConcept(ctx, { apiKey, model })); }),
    brain('content', async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'content', await authorContent(ctx, { apiKey, model })); }),
    brain('visual-brief', async (ctx, { buildDir, apiKey, model }) => { mergeSlot(buildDir, 'visuals', visualsSlotFromBrief(await authorVisualBrief(ctx, { apiKey, model }))); }),
    tool('generate-image', 'generate-image'),
    tool('make-favicon', 'make-favicon'),
    tool('make-social-card', 'make-social-card'),
    tool('make-diagrams', 'make-diagrams'),
    tool('assemble-page', 'assemble-page'),
    tool('make-pack', 'make-pack'),
    tool('quality-grade', 'quality-grade'),
    tool('deploy', 'deploy'),
    tool('publish-repo', 'publish-repo'),
    tool('repo-seo', 'repo-seo'),
    tool('readme-enhance', 'readme-enhance', { fatal: false }),   // Station 8b — non-blocking
    tool('notify', 'notify', { fatal: false }),                   // Station 9  — non-blocking
  ];

  // apply skip flags
  return all.filter((s) => {
    if (opts.noQuality && s.id === 'quality-grade') return false;
    if (opts.noDeploy && s.id === 'deploy') return false;
    if (opts.noPublish && (s.id === 'publish-repo' || s.id === 'repo-seo')) return false;
    if (opts.noNotify && s.id === 'notify') return false;
    return true;
  });
}

// ── preflight: fail fast with ACTIONABLE guidance when a station in the slice lacks its credential ──
// "If something's not there, tell them I need this key, and how to set it — don't work around it and
// ship a degraded result." Required keys (brain, OpenAI) are FATAL; ship-step keys are heads-up + a skip flag.
async function preflight(list, env, repoRoot) {
  const has = (names) => names.some((n) => env[n] && String(env[n]).trim());
  const ids = new Set(list.map((s) => s.id));
  const brainIds = ['kb:register', 'primer', 'concept', 'content', 'visual-brief'];
  const problems = [];
  if (brainIds.some((id) => ids.has(id)) && !has(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'])) {
    problems.push({ fatal: true, need: 'ANTHROPIC_API_KEY (or CLAUDE_API_KEY)', why: 'the brain stations (concept/content/visual-brief/primer) author the page',
      how: 'add ANTHROPIC_API_KEY=sk-ant-… to .env — create one at https://console.anthropic.com/settings/keys',
      envKey: 'ANTHROPIC_API_KEY', aliases: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] });
  }
  if ((ids.has('generate-image') || ids.has('quality-grade')) && !has(['OPENAI_API_KEY', 'OPEN_AI_KEY'])) {
    problems.push({ fatal: true, need: 'OPENAI_API_KEY (or OPEN_AI_KEY)', why: 'the atmospheric images (gpt-image-2) and the visual quality grade (gpt-5.5) need it',
      how: 'add OPENAI_API_KEY=sk-… to .env — create one at https://platform.openai.com/api-keys',
      envKey: 'OPENAI_API_KEY', aliases: ['OPENAI_API_KEY', 'OPEN_AI_KEY'] });
  }
  if (ids.has('deploy')) {
    // Deploy goes to NETLIFY ONLY now — each explainer to its own {slug}-explainer.netlify.app site.
    // (Vercel was removed after it overwrote a live site; the legacy Vercel explainers are untouched and
    // not managed by this pipeline.) A missing Netlify token is FATAL: we refuse to start a deploy run
    // rather than guess a target or fall back to another account.
    if (!has(['NETLIFY_AUTH_TOKEN'])) {
      problems.push({ fatal: true, need: 'NETLIFY_AUTH_TOKEN', why: 'the deploy station publishes each explainer to its own {slug}-explainer.netlify.app site',
        how: 'create a token at https://app.netlify.com/user/applications#personal-access-tokens and add NETLIFY_AUTH_TOKEN=… to .env, or re-run with --no-deploy to build locally only',
        envKey: 'NETLIFY_AUTH_TOKEN', aliases: ['NETLIFY_AUTH_TOKEN'] });
    }
  }
  if ((ids.has('publish-repo') || ids.has('repo-seo')) && !has(['GITHUB_TOKEN', 'GH_TOKEN'])) {
    problems.push({ fatal: false, need: 'GITHUB_TOKEN / GH_TOKEN (or `gh auth login`)', why: 'publish-repo creates the editable explainer repo on GitHub',
      how: 'run `gh auth login`, or add GITHUB_TOKEN=ghp_… to .env, or re-run with --no-publish' });
  }
  if (!problems.length) return;
  log(`\n${C.bold}Preflight — credentials${C.reset}`);
  for (const p of problems) {
    const tag = p.fatal ? `${C.red}MISSING${C.reset}` : `${C.yellow}heads-up${C.reset}`;
    log(`  ${tag} ${C.bold}${p.need}${C.reset} ${C.dim}— ${p.why}${C.reset}\n      → ${p.how}`);
  }
  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length) {
    // DROP-IN UX: on an interactive terminal, offer to paste the missing key(s) right now and save
    // them to .env — so a developer using their own keys doesn't have to stop, edit a file, and re-run.
    // Off a TTY (CI / hosted runner / piped), we keep the strict fail-loud behavior below.
    await promptForMissingKeys(fatal, env, repoRoot);
    const stillMissing = fatal.filter((p) => !(p.aliases || []).some((n) => env[n] && String(env[n]).trim()));
    if (stillMissing.length) {
      throw new Error(`preflight: ${stillMissing.length} required credential(s) missing (see above). Set them in .env and re-run — nothing was built; refusing to produce a degraded result silently.`);
    }
    log(`${C.green}✓ all required credentials present — continuing.${C.reset}`);
  }
  log(`${C.dim}(non-fatal — continuing; the affected ship steps will be skipped or fail loudly if reached)${C.reset}`);
}

// ── interactive key capture (drop-in mode) ──────────────────────────────────────────────────────
// Prompt for each still-missing FATAL key, but ONLY on a real interactive terminal. A provided value
// is set for this run AND persisted to .env (mode 0600). Values are NEVER printed or logged.
function promptSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve((ans || '').trim()); });
  });
}
export function upsertEnvFile(envPath, key, value) {
  let text = '';
  try { text = fs.readFileSync(envPath, 'utf8'); } catch { /* new .env */ }
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
  fs.writeFileSync(envPath, text, { mode: 0o600 });
}
export async function promptForMissingKeys(fatal, env, repoRoot) {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.EXPLAINER_NONINTERACTIVE;
  if (!interactive) return; // CI / hosted / piped → leave gaps; the caller throws with guidance
  const envPath = path.join(repoRoot, '.env');
  log(`\n${C.bold}Paste the missing key(s) to continue${C.reset} ${C.dim}— saved to .env (chmod 600), never printed, never committed. Press Enter to skip any.${C.reset}`);
  for (const p of fatal) {
    if (!p.envKey) continue;
    if ((p.aliases || []).some((n) => env[n] && String(env[n]).trim())) continue; // already satisfied
    const val = await promptSecret(`  ${p.envKey}: `);
    if (!val) continue;
    env[p.envKey] = val; // in-memory for this run
    try { upsertEnvFile(envPath, p.envKey, val); log(`  ${C.green}✓ saved ${p.envKey} → ${envPath}${C.reset}`); }
    catch (e) { log(`  ${C.yellow}kept ${p.envKey} for this run, but couldn't write .env: ${e.message}${C.reset}`); }
  }
}

// run a sub-list of stations linearly; stop on the first FATAL failure (non-fatal ones warn + continue).
async function runStations(subList, baseArgs, total, startIdx) {
  const results = [];
  let i = startIdx;
  for (const s of subList) {
    i++;
    step(i, total, s.id, s.kind);
    let r;
    try { r = await s.run(baseArgs); }
    catch (e) { r = { ok: false, error: e.message }; }
    if (r.ok) {
      log(`${C.green}✓ ${s.id}${C.reset}${r.skipped ? ` ${C.dim}(${r.skipped})${C.reset}` : ''}`);
      results.push({ id: s.id, ok: true });
    } else {
      results.push({ id: s.id, ok: false, error: r.error });
      if (s.fatal) { log(`${C.red}✗ ${s.id} FAILED:${C.reset} ${r.error}`); return { ok: false, failedAt: s.id, error: r.error, results }; }
      log(`${C.yellow}⚠ ${s.id} failed (non-blocking): ${r.error}${C.reset}`);
    }
  }
  return { ok: true, results };
}

const sumMean = (q) => (Array.isArray(q?.scorecard) ? q.scorecard.reduce((s, c) => s + (c.meanScore || 0), 0) : 0);
function readQuality(buildDir) { try { return readContext(buildDir).quality; } catch { return null; } }

// The self-correcting loop: while the page is below the bar, hand the harsh critic's CONTENT-actionable
// findings (A* substance axes + operator questions) back to the brain, re-author the copy, re-assemble,
// re-grade — keeping the BEST iteration. Craft (B*) and diagram (INV-18) notes are not content-fixable so
// they're left for the design system / make-diagrams, not looped on here.
async function refineLoop({ buildDir, env, model, apiKey, opts }) {
  const MAX = opts.maxRefine != null ? Math.max(0, parseInt(opts.maxRefine, 10) || 0) : 2;
  let q = readQuality(buildDir);
  let best = { mean: sumMean(q), content: (() => { try { return readContext(buildDir).content; } catch { return null; } })() };
  let pass = 0;
  while (q && !q.passed && pass < MAX) {
    pass++;
    const fb = (q.refineNotes || []).filter((n) => /^A\d|^operator:|^MEAN$/.test(n.criterion));
    const axes = [...new Set(fb.map((f) => f.criterion))].join(', ') || 'the weak axes';
    log(`\n${C.bold}${C.cyan}Refine pass ${pass}/${MAX}${C.reset} ${C.dim}(re-authoring content to lift ${axes})${C.reset}`);
    const ctx = readContext(buildDir); ctx._repoRoot = REPO_ROOT;
    try { mergeSlot(buildDir, 'content', await authorContent(ctx, { apiKey, model, feedback: fb })); }
    catch (e) { log(`${C.yellow}refine: content re-author failed (${e.message}) — stopping refine${C.reset}`); break; }
    const a = runTool('assemble-page', buildDir, { repoRoot: REPO_ROOT, env });
    if (!a.ok) { log(`${C.yellow}refine: assemble-page failed (${a.error}) — stopping refine${C.reset}`); break; }
    const g = runTool('quality-grade', buildDir, { repoRoot: REPO_ROOT, env });
    if (!g.ok) { log(`${C.yellow}refine: quality-grade failed (${g.error}) — stopping refine${C.reset}`); break; }
    q = readQuality(buildDir);
    const m = sumMean(q);
    log(`${C.dim}refine pass ${pass}: mean(sum of devices)=${m}  passed=${q?.passed}${C.reset}`);
    if (m > best.mean) best = { mean: m, content: readContext(buildDir).content };
  }
  // not passing → restore the BEST iteration so the local build is the strongest we reached
  if (q && !q.passed && best.content) {
    const cur = readContext(buildDir);
    if (JSON.stringify(cur.content) !== JSON.stringify(best.content)) {
      log(`${C.dim}restoring the best-scoring iteration (mean ${best.mean})${C.reset}`);
      mergeSlot(buildDir, 'content', best.content);
      runTool('assemble-page', buildDir, { repoRoot: REPO_ROOT, env });
      runTool('quality-grade', buildDir, { repoRoot: REPO_ROOT, env });
      q = readQuality(buildDir);
    }
  }
  return q;
}

function finalSummary(outDir) {
  log(`\n${C.green}${C.bold}Done.${C.reset} build dir: ${outDir}`);
  try {
    const ctx = readContext(outDir);
    if (ctx.publish?.liveUrl) log(`${C.green}live: ${ctx.publish.liveUrl}${C.reset}`);
    if (ctx.publish?.explainerRepoUrl) log(`${C.dim}repo: ${ctx.publish.explainerRepoUrl}${C.reset}`);
    if (ctx.quality?.passed != null) log(`${C.dim}quality passed: ${ctx.quality.passed}${C.reset}`);
  } catch { /* best-effort summary */ }
}

function reportQualityGap(quality) {
  if (!quality || !Array.isArray(quality.scorecard)) { log(`${C.red}quality gate: no scorecard available${C.reset}`); return; }
  log(`\n${C.bold}Quality scorecard — HELD below the SHIP bar (need, on both devices: mean ≥ 82, worst axis ≥ 70, real legible architecture+flow diagrams, and the comprehension operators YES). World-class target is mean ≥ 90 / worst ≥ 85 / all 5 operators.${C.reset}`);
  for (const c of quality.scorecard) {
    log(`  ${C.bold}${c.device}${C.reset}: mean ${c.meanScore}, worst axis ${c.headlineScore}, diagrams ${c.inv18?.passed ? 'ok' : 'FAIL'}, passed ${c.passed ? C.green + 'yes' + C.reset : C.red + 'no' + C.reset}`);
  }
  const seen = new Set();
  for (const n of (quality.refineNotes || [])) {
    const k = n.device + n.criterion;
    if (seen.has(k)) continue; seen.add(k);
    log(`   ${C.yellow}• [${n.device}] ${n.criterion} (${n.score})${C.reset} ${C.dim}${String(n.saw || '').replace(/\s+/g, ' ').slice(0, 150)}${C.reset}`);
  }
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────
export async function run(repoUrl, opts = {}) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error(`not a parseable GitHub repo URL: "${repoUrl}"`);
  const slug = slugify(parsed.name);

  const env = loadEnv(REPO_ROOT);
  let apiKey = getSecret(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  const model = resolveModel(env, opts.model);

  const outDir = path.resolve(opts.out || path.join(process.cwd(), 'explainer-builds', slug));
  let list = stations(opts);

  // --from / --to / --only slicing (resume a long build)
  if (opts.only) list = list.filter((s) => s.id === opts.only);
  else {
    if (opts.from) { const i = list.findIndex((s) => s.id === opts.from); if (i === -1) throw new Error(`--from: unknown station "${opts.from}"`); list = list.slice(i); }
    if (opts.to) { const i = list.findIndex((s) => s.id === opts.to); if (i === -1) throw new Error(`--to: unknown station "${opts.to}"`); list = list.slice(0, i + 1); }
  }

  log(`${C.bold}explainmyrepo${C.reset} — ${C.cyan}${parsed.owner}/${parsed.name}${C.reset}`);
  log(`${C.dim}build dir : ${outDir}${C.reset}`);
  log(`${C.dim}model     : ${model}   anthropic key: ${redact(apiKey)}${C.reset}`);
  log(`${C.dim}stations  : ${list.map((s) => s.id).join(' → ')}${C.reset}`);

  if (opts.dryRun) { log(`\n${C.yellow}--dry-run: plan only, nothing executed.${C.reset}`); return { ok: true, dryRun: true, outDir, stations: list.map((s) => s.id) }; }

  // Preflight: name any missing credential for the stations in this slice + how to set it. On a TTY it
  // offers to capture the key(s) now and save them to .env (drop-in mode); off a TTY it refuses to start
  // on a fatal gap rather than build a degraded result. (The brain key is among the fatal checks.)
  await preflight(list, env, REPO_ROOT);
  apiKey = getSecret(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']); // may have just been entered + saved

  // Seed the build dir + build.json (idempotent; resumes if it already exists). If the slice starts
  // at clone-repo we seed; if it starts later (a resume) we require an existing build.
  const startsAtCloneRepo = list.length > 0 && list[0].id === 'clone-repo';
  if (startsAtCloneRepo) {
    initBuildDir(outDir, parsed.url || repoUrl);
  } else if (!fs.existsSync(path.join(outDir, 'build.json'))) {
    throw new Error(`--from/--only "${list[0]?.id}" needs an existing build at ${outDir} — start with clone-repo first`);
  } else {
    const c = readContext(outDir);
    c.repo = { ...(c.repo || {}), url: c.repo?.url || parsed.url || repoUrl };
    fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify(c, null, 2) + '\n');
  }

  const total = list.length;
  const baseArgs = { buildDir: outDir, env, model, apiKey, opts };
  const qIdx = list.findIndex((s) => s.id === 'quality-grade');

  // No quality gate in this slice (--no-quality, or a partial --only/--from run) → run linearly.
  if (qIdx === -1) {
    const r = await runStations(list, baseArgs, total, 0);
    if (!r.ok) { log(`\n${C.red}${C.bold}Build stopped at "${r.failedAt}".${C.reset} Resume: ${C.cyan}--from ${r.failedAt} --out ${outDir}${C.reset}`); return { ok: false, failedAt: r.failedAt, error: r.error, outDir, results: r.results }; }
    finalSummary(outDir);
    return { ok: true, outDir, results: r.results };
  }

  // Gated run: build through quality-grade, refine-until-pass, and ONLY ship (deploy/publish/…) on pass.
  const pre = list.slice(0, qIdx + 1);
  const post = list.slice(qIdx + 1);
  const preR = await runStations(pre, baseArgs, total, 0);
  if (!preR.ok) { log(`\n${C.red}${C.bold}Build stopped at "${preR.failedAt}".${C.reset} Resume: ${C.cyan}--from ${preR.failedAt} --out ${outDir}${C.reset}`); return { ok: false, failedAt: preR.failedAt, error: preR.error, outDir, results: preR.results }; }

  let quality = readQuality(outDir);
  if (quality && !quality.passed && !opts.noRefine) {
    quality = await refineLoop({ buildDir: outDir, env, model, apiKey, opts });
  }

  if (!(quality && quality.passed)) {
    // NEVER ship a below-bar page silently — the whole point. Stop before deploy/publish, report the gap.
    reportQualityGap(quality);
    log(`\n${C.yellow}${C.bold}Held at the quality gate — did NOT deploy or publish a below-bar page.${C.reset}`);
    log(`${C.dim}Best local build: ${outDir}/site . Lift the gaps above (or re-run with a higher --max-refine), then ship the remaining steps with: ${C.cyan}--from ${post[0] ? post[0].id : 'deploy'} --out ${outDir}${C.reset}`);
    return { ok: false, gated: true, quality, outDir, results: preR.results };
  }

  const meanPair = quality.scorecard.map((c) => `${String(c.device).replace(/\(.*/, '')} ${c.meanScore}`).join(' / ');
  if (quality.exemplary) {
    log(`\n${C.green}${C.bold}Quality gate PASSED — world-class (mean ${meanPair}).${C.reset} Shipping.`);
  } else {
    log(`\n${C.green}${C.bold}Quality gate PASSED — ship-worthy (mean ${meanPair}).${C.reset} Shipping.`);
    log(`${C.dim}Genuinely good + no slop + real legible diagrams (INV-18). The world-class target (mean ≥ 90 / worst axis ≥ 85 / all 5 operators) is not fully reached — the per-axis gap is recorded in build.json refineNotes and travels with the scorecard.${C.reset}`);
  }
  const postR = post.length ? await runStations(post, baseArgs, total, qIdx + 1) : { ok: true, results: [] };
  finalSummary(outDir);
  return { ok: postR.ok !== false, outDir, results: [...preR.results, ...postR.results] };
}
