#!/usr/bin/env node
// readme-enhance.mjs — Station 8b, tool #13 of tools/CONTRACT.md (OPTIONAL, off the critical path).
//
// JOB (one mechanical thing): OFFER to enhance the SOURCE repo's README — add an architectural
// explanation + the SHARED Station-4 SVG diagrams (architecture + flow, authored once, reused here)
// + an explainer badge linking to the live explainer — and deliver it as a PULL REQUEST ONLY on the
// source repo. NEVER a direct push, NEVER a push to the default branch (INV-16). This wraps the
// `~/.claude/skills/readme-enhance` conventions (version-headerless, surgical, validate-against-repo)
// and the `gh` CLI mechanically; it makes no judgment calls.
//
// OPTIONAL / OFFERED. The offer is controlled by the brain via the environment: this tool only opens
// a PR when README_ENHANCE is truthy (1/true/yes/on). Unset/false ⇒ a clean no-op that records
// readmePr = { prUrl: "declined", svgsShared: [] } and exits 0. (Station 8b cue: "if declined, the
// station is a clean no-op.")
//
// FAIL-LOUD: when ENABLED and a declared input or a git/gh step genuinely fails, this tool exits
// NON-ZERO with a clear reason (per CONTRACT (b)·6) — it never writes a placeholder PR. Per ADR-0005
// Station 8b / INV-03 / INV-16 the BRAIN treats that non-zero as a NON-BLOCKING WARNING: a
// readme-enhance failure is a warning, it never blocks, gates, or sinks the core ship.
//
// Uniform invocation:  node tools/readme-enhance.mjs <build-dir>
//
// Reads (declared inputs only — CONTRACT roster row 13):
//   build.json: repo { owner, name, slug, clonePath, defaultBranch, url },
//               publish.liveUrl,
//               visuals.architectureDiagram { svgPath, altText },
//               visuals.flowDiagram         { svgPath, altText }
//   env:        README_ENHANCE (opt-in), GitHub token via the ambient `gh` auth / GH_TOKEN.
// Writes (its own slot + the PR, nothing else):
//   build.json: readmePr { prUrl | "declined", svgsShared[] }
//   the source clone at <build-dir>/repo: docs/explainer/{architecture,flow}.svg + a README block,
//   on a feature branch, pushed (to origin if writable, else a fork) and opened as a PR via gh.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL = 'readme-enhance';
const BRANCH = 'explainer/readme-enhancement';
const SVG_DIR = 'docs/explainer';
const MARK_START = '<!-- explainmyrepo:start -->';
const MARK_END = '<!-- explainmyrepo:end -->';
const TRUE_RE = /^(1|true|yes|on)$/i;

// stdout carries ONLY the single JSON result object; all diagnostics go to stderr.
function emit(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}
function log(msg) {
  process.stderr.write(`[${TOOL}] ${msg}\n`);
}
function fail(message) {
  log(message);
  emit({ ok: false, outputs: {}, error: message });
  process.exit(1);
}

// Run a command, capture stdout (trimmed). Throw on non-zero with stderr surfaced.
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim();
    const e = new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`);
    e.stderr = stderr;
    throw e;
  }
}

// Resolve a path token (absolute or relative to the build dir) into an absolute path.
function resolveIn(buildDir, p) {
  return path.isAbsolute(p) ? p : path.resolve(buildDir, p);
}

const buildDir = process.argv[2];
if (!buildDir) fail('usage: node tools/readme-enhance.mjs <build-dir>');

const buildJsonPath = path.join(buildDir, 'build.json');
let ctx;
try {
  ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
} catch (err) {
  fail(`cannot read ${buildJsonPath}: ${err.message}`);
}

// ── OPTIONAL gate: only act when the brain opted in via the environment ──────────────────────────
const enabled = TRUE_RE.test(String(process.env.README_ENHANCE || '').trim());
if (!enabled) {
  ctx.readmePr = { prUrl: 'declined', svgsShared: [] };
  fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n');
  log('README_ENHANCE not set — clean no-op (declined).');
  emit({ ok: true, outputs: { readmePr: ctx.readmePr, declined: true }, error: null });
  process.exit(0);
}

// ── ENABLED: validate the declared inputs (loud on any absence) ──────────────────────────────────
const repo = ctx.repo;
if (!repo || !repo.owner || !repo.name || !repo.clonePath) {
  fail('repo slot incomplete — need repo.owner, repo.name, repo.clonePath (run clone-repo first).');
}
const liveUrl = ctx.publish?.liveUrl;
if (!liveUrl) fail('publish.liveUrl is absent — run deploy (Station 8) before the README PR.');

const arch = ctx.visuals?.architectureDiagram;
const flow = ctx.visuals?.flowDiagram;
if (!arch?.svgPath) fail('visuals.architectureDiagram.svgPath is absent — run make-diagrams (Station 4) first.');
if (!flow?.svgPath) fail('visuals.flowDiagram.svgPath is absent — run make-diagrams (Station 4) first.');

const archSvg = resolveIn(buildDir, arch.svgPath);
const flowSvg = resolveIn(buildDir, flow.svgPath);
if (!fs.existsSync(archSvg)) fail(`shared architecture SVG not found on disk: ${archSvg}`);
if (!fs.existsSync(flowSvg)) fail(`shared flow SVG not found on disk: ${flowSvg}`);

const clone = resolveIn(buildDir, repo.clonePath);
if (!fs.existsSync(clone)) fail(`source clone not found: ${clone} (run clone-repo first).`);
try {
  run('git', ['-C', clone, 'rev-parse', '--is-inside-work-tree']);
} catch {
  fail(`not a git work tree: ${clone}`);
}

const baseBranch =
  repo.defaultBranch ||
  (() => {
    try {
      return run('git', ['-C', clone, 'symbolic-ref', '--short', 'HEAD']);
    } catch {
      return 'main';
    }
  })();

// ── Build the surgical README enhancement (badge + shared SVGs + architectural explanation) ───────
const repoName = repo.name;
const archAlt = (arch.altText || `Architecture diagram for ${repoName}.`).trim();
const flowAlt = (flow.altText || `Process / data-flow diagram for ${repoName}.`).trim();
const archRel = `${SVG_DIR}/architecture.svg`;
const flowRel = `${SVG_DIR}/flow.svg`;

const block = [
  MARK_START,
  '## Explainer',
  '',
  `[![Explainer — live](https://img.shields.io/badge/Explainer-live-7c3aed?style=flat-square)](${liveUrl})`,
  '',
  `A visual, newcomer-friendly explainer for **${repoName}** is live: ${liveUrl}`,
  '',
  '### Architecture',
  '',
  archAlt,
  '',
  `![${archAlt.replace(/[\r\n]+/g, ' ')}](${archRel})`,
  '',
  '### How it works',
  '',
  flowAlt,
  '',
  `![${flowAlt.replace(/[\r\n]+/g, ' ')}](${flowRel})`,
  MARK_END,
  '',
].join('\n');

// Pick the existing README (case-insensitive) or default to README.md.
function findReadme(dir) {
  const hit = fs.readdirSync(dir).find((f) => /^readme(\.md|\.markdown)?$/i.test(f));
  return hit || 'README.md';
}
const readmeName = findReadme(clone);
const readmePath = path.join(clone, readmeName);

// ALWAYS read before editing. Insert-or-replace our delimited block (idempotent on re-run).
let readme = '';
if (fs.existsSync(readmePath)) {
  readme = fs.readFileSync(readmePath, 'utf8');
}
let nextReadme;
if (readme.includes(MARK_START) && readme.includes(MARK_END)) {
  nextReadme = readme.replace(new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}\\n?`), block);
} else if (readme.trim().length === 0) {
  nextReadme = `# ${repoName}\n\n${block}`;
} else {
  nextReadme = `${readme.replace(/\s*$/, '')}\n\n${block}`;
}

// ── Stage the change on a feature branch in the clone (NEVER the default branch) ──────────────────
let prUrl;
try {
  run('git', ['-C', clone, 'checkout', '-B', BRANCH]);

  const svgAbsDir = path.join(clone, SVG_DIR);
  fs.mkdirSync(svgAbsDir, { recursive: true });
  fs.copyFileSync(archSvg, path.join(svgAbsDir, 'architecture.svg'));
  fs.copyFileSync(flowSvg, path.join(svgAbsDir, 'flow.svg'));
  fs.writeFileSync(readmePath, nextReadme);

  run('git', ['-C', clone, 'add', '--', readmeName, SVG_DIR]);

  // Commit with an explicit identity (the clone may carry none). No Co-Authored-By trailer.
  try {
    run('git', [
      '-C', clone,
      '-c', 'user.name=explainmyrepo',
      '-c', 'user.email=explainmyrepo@users.noreply.github.com',
      'commit', '-m', 'docs: add explainmyrepo architecture explainer + shared diagrams',
    ]);
  } catch (err) {
    if (!/nothing to commit/i.test(err.stderr || err.message)) throw err;
    log('no README changes to commit (already enhanced) — proceeding to PR.');
  }
} catch (err) {
  fail(`failed to stage the README enhancement: ${err.message}`);
}

// ── Push (origin if writable, else a fork) and open the PR via gh — never a direct push to base ──
let headRef = BRANCH; // owner:branch form filled in for the fork path
try {
  // Idempotency: if a PR already exists for this head, reuse it.
  const existing = run('gh', [
    'pr', 'list', '--repo', `${repo.owner}/${repo.name}`,
    '--head', BRANCH, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""',
  ]);
  if (existing) {
    log(`a PR already exists for ${BRANCH} — reusing it.`);
    prUrl = existing;
  }
} catch {
  /* gh pr list is best-effort detection; fall through to create */
}

if (!prUrl) {
  let pushedToOrigin = false;
  try {
    run('git', ['-C', clone, 'push', '--force-with-lease', '-u', 'origin', BRANCH]);
    pushedToOrigin = true;
  } catch (err) {
    log(`push to origin failed (likely no write access): ${err.stderr || err.message} — trying a fork.`);
  }

  if (!pushedToOrigin) {
    // Fork under our account, push the branch there, open a cross-repo PR.
    let login;
    try {
      run('gh', ['repo', 'fork', `${repo.owner}/${repo.name}`, '--clone=false']);
      login = run('gh', ['api', 'user', '--jq', '.login']);
    } catch (err) {
      fail(`could not fork ${repo.owner}/${repo.name} for the PR: ${err.message}`);
    }
    try {
      run('git', ['-C', clone, 'remote', 'remove', 'explainer-fork']);
    } catch {
      /* no pre-existing fork remote — fine */
    }
    try {
      run('git', ['-C', clone, 'remote', 'add', 'explainer-fork', `https://github.com/${login}/${repo.name}.git`]);
      run('git', ['-C', clone, 'push', '--force-with-lease', '-u', 'explainer-fork', BRANCH]);
    } catch (err) {
      fail(`could not push the branch to the fork ${login}/${repo.name}: ${err.message}`);
    }
    headRef = `${login}:${BRANCH}`;
  }

  const title = `docs: add a visual explainer for ${repoName}`;
  const body = [
    `This optional PR adds a short **Explainer** section to the README:`,
    '',
    `- an explainer badge linking to the live explainer (${liveUrl})`,
    '- an **Architecture** diagram and a **How it works** flow diagram (shared SVGs, authored once)',
    '- a brief architectural explanation alongside each diagram',
    '',
    'It touches only the README and `docs/explainer/`. Merge it or close it — no pressure.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

  try {
    prUrl = run('gh', [
      'pr', 'create',
      '--repo', `${repo.owner}/${repo.name}`,
      '--base', baseBranch,
      '--head', headRef,
      '--title', title,
      '--body', body,
    ]);
    // gh prints the PR URL on the last line of stdout.
    prUrl = prUrl.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  } catch (err) {
    fail(`gh pr create failed: ${err.message}`);
  }
}

if (!prUrl || !/^https?:\/\//.test(prUrl)) {
  fail(`could not determine the opened PR URL (got: ${JSON.stringify(prUrl)}).`);
}

// ── Merge ONLY the readmePr slot back; leave every other slot untouched ───────────────────────────
ctx.readmePr = { prUrl, svgsShared: ['architecture.svg', 'flow.svg'] };
fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n');

log(`opened README PR: ${prUrl}`);
emit({
  ok: true,
  outputs: {
    readmePr: ctx.readmePr,
    prUrl,
    head: headRef,
    base: baseBranch,
    svgsShared: ctx.readmePr.svgsShared,
  },
  error: null,
});
process.exit(0);
