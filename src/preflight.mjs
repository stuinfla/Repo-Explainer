// src/preflight.mjs — the ONE local-door credential check (bin/explainmyrepo.mjs has none of its own).
// Fail fast, with the exact fix, when a station in the slice lacks its credential. Fatal keys (brain, OpenAI,
// Netlify) stop the run; ship-step keys are a heads-up. On a real terminal the fatal ones can be pasted in
// and saved to .env; off a TTY (CI, piped) a gap refuses to start.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { resolveBrainLane } from './claude.mjs';
import { C, log } from './runtime.mjs';

const filled = (env, names) => names.some((n) => env[n] && String(env[n]).trim());

// Which credentials the stations in `list` need and `env` lacks. Pure: the brain lane is injected so a test
// never probes the real machine. Any ONE authoring credential satisfies the brain stations: an Anthropic key,
// an OpenRouter key (the sole-credential lane), or a logged-in Claude Code CLI.
export function credentialProblems(list, env, { lane = resolveBrainLane } = {}) {
  const ids = new Set(list.flatMap((s) => [s.id, s.tool].filter(Boolean)));
  const problems = [];
  const brainIds = ['kb:register', 'primer', 'concept', 'content', 'visual-brief'];
  const brain = lane({ apiKey: env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY, env });
  if (brainIds.some((id) => ids.has(id)) && !brain.ok) {
    problems.push({ fatal: true, need: 'one authoring credential: ANTHROPIC_API_KEY (or CLAUDE_API_KEY), OPENROUTER_API_KEY, or a logged-in Claude Code CLI', why: 'the brain stations (concept/content/visual-brief/primer) author the page',
      how: 'add ANTHROPIC_API_KEY=sk-ant-… to .env (https://console.anthropic.com/settings/keys), or OPENROUTER_API_KEY=sk-or-… to .env, or install Claude Code and log in — the brain then runs on your Claude subscription with no API key at all',
      envKey: 'ANTHROPIC_API_KEY', aliases: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] });
  }
  if ((ids.has('generate-image') || ids.has('quality-grade')) && !filled(env, ['OPENAI_API_KEY', 'OPEN_AI_KEY'])) {
    problems.push({ fatal: true, need: 'OPENAI_API_KEY (or OPEN_AI_KEY)', why: 'the atmospheric images (gpt-image-2.5-flare, gpt-image-2 as the safety net) and the visual quality grade (gpt-5.6-sol) need it',
      how: 'add OPENAI_API_KEY=sk-… to .env — create one at https://platform.openai.com/api-keys',
      envKey: 'OPENAI_API_KEY', aliases: ['OPENAI_API_KEY', 'OPEN_AI_KEY'] });
  }
  // Deploy is Netlify-only: each explainer goes to its own {slug}-explainer.netlify.app site.
  if (ids.has('deploy') && !filled(env, ['NETLIFY_AUTH_TOKEN'])) {
    problems.push({ fatal: true, need: 'NETLIFY_AUTH_TOKEN', why: 'the deploy station publishes each explainer to its own {slug}-explainer.netlify.app site',
      how: 'create a token at https://app.netlify.com/user/applications#personal-access-tokens and add NETLIFY_AUTH_TOKEN=… to .env, or re-run with --no-deploy to build locally only',
      envKey: 'NETLIFY_AUTH_TOKEN', aliases: ['NETLIFY_AUTH_TOKEN'] });
  }
  if ((ids.has('publish-repo') || ids.has('repo-seo')) && !filled(env, ['GITHUB_TOKEN', 'GH_TOKEN'])) {
    problems.push({ fatal: false, need: 'GITHUB_TOKEN / GH_TOKEN (or `gh auth login`)', why: 'publish-repo creates the editable explainer repo on GitHub',
      how: 'run `gh auth login`, or add GITHUB_TOKEN=ghp_… to .env, or re-run with --no-publish' });
  }
  // The tournament calls Anthropic and OpenAI directly (never OpenRouter or the CLI) and needs 2+ candidates
  // plus a judge; without them it skips and the single-shot concept station authors instead.
  if (ids.has('concept-tournament') && !(filled(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) && filled(env, ['OPENAI_API_KEY', 'OPEN_AI_KEY']))) {
    problems.push({ fatal: false, need: 'ANTHROPIC_API_KEY and OPENAI_API_KEY (direct)', why: 'the concept tournament needs 2+ candidate models and a judge',
      how: 'without both it is skipped and one model writes the concept instead (lower variety, not a failure)' });
  }
  return problems;
}

// ONE preflight for the local door. Fatal gaps: on a terminal each missing key is prompted for (saved to .env,
// mode 0600); anywhere else the run stops with the exact fix. Ship-step gaps are a heads-up only.
// `deps` injects the lane probe, the TTY decision, the prompt and the .env writer for tests.
export async function preflight(list, env, repoRoot, deps = {}) {
  const { lane = resolveBrainLane, interactive = isInteractive(), ask = promptSecret, save = upsertEnvFile, print = log } = deps;
  const problems = credentialProblems(list, env, { lane });
  if (!problems.length) return { problems: [] };
  print(`\n${C.bold}Preflight — credentials${C.reset}`);
  for (const p of problems) {
    const tag = p.fatal ? `${C.red}MISSING${C.reset}` : `${C.yellow}heads-up${C.reset}`;
    print(`  ${tag} ${C.bold}${p.need}${C.reset} ${C.dim}— ${p.why}${C.reset}\n      → ${p.how}`);
  }
  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length) {
    await promptForMissingKeys(fatal, env, repoRoot, { interactive, ask, save, print });
    const stillMissing = credentialProblems(list, env, { lane }).filter((p) => p.fatal);
    if (stillMissing.length) {
      const hint = interactive ? '' : ' No terminal to ask on: set them in .env (or the environment) and re-run, or use the zero-setup site https://explainmyrepo.isovision.ai for a public repo.';
      throw new Error(`preflight: ${stillMissing.length} required credential(s) missing: ${stillMissing.map((p) => p.need).join('; ')}.${hint} Nothing was built.`);
    }
    print(`${C.green}✓ all required credentials present — continuing.${C.reset}`);
  }
  if (problems.some((p) => !p.fatal)) print(`${C.dim}(non-fatal — continuing; the affected stations will be skipped or fail loudly if reached)${C.reset}`);
  return { problems };
}

const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.EXPLAINER_NONINTERACTIVE;

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

// Prompt for each still-missing fatal key, on a real terminal only. A value is set for this run AND saved
// to .env (mode 0600); it is never printed or logged.
export async function promptForMissingKeys(fatal, env, repoRoot, deps = {}) {
  const { interactive = isInteractive(), ask = promptSecret, save = upsertEnvFile, print = log } = deps;
  if (!interactive) return;
  const envPath = path.join(repoRoot, '.env');
  print(`\n${C.bold}Paste the missing key(s) to continue${C.reset} ${C.dim}— saved to .env (chmod 600), never printed, never committed. Press Enter to skip any.${C.reset}`);
  for (const p of fatal) {
    if (!p.envKey) continue;
    if (filled(env, p.aliases || [])) continue;
    const val = await ask(`  ${p.envKey}: `);
    if (!val) continue;
    env[p.envKey] = val;
    try { save(envPath, p.envKey, val); print(`  ${C.green}✓ saved ${p.envKey} → ${envPath}${C.reset}`); }
    catch (e) { print(`  ${C.yellow}kept ${p.envKey} for this run, but couldn't write .env: ${e.message}${C.reset}`); }
  }
}
