// src/readme-pr.mjs — the pull request the readme-enhance station sends (ADR-0015).
//
// PURE: builds the title/body and decides whether to send at all. No I/O. The station owns git and gh.
//
// THE TONE (owner-specified, 2026-10-10, after reviewing PR #447 on realiti4/claude-swap):
//   a friendly person who thinks what the maintainer built is great and wants more people to see it —
//   NOT a bot reporting a diff. Lead with thanks. Put the one-click link to the rendered README and a
//   picture of it FIRST (the owner's note: "you're burying the lead"). Then the explainer page, with an
//   image. Say plainly what changes and that nothing of theirs is removed. Ask them to check the
//   diagrams. No pressure, and mean it: a closed PR is never re-sent (see decideSend).
//
// Voice: the default opening is honest for ANY runner — it makes no claim about the runner's personal
// experience. A runner who wants their own first-person voice sets README_PR_INTRO (markdown; {repo}
// is substituted) and README_PR_SIGNOFF.

const EXPLAINER_REPO = 'https://github.com/stuinfla/Repo-Explainer';

/** @param {string} repoName */
export function buildPrTitle(repoName) {
  return `docs: a visual README to help more people discover ${repoName}`;
}

/** The issue-first title. Stable text: the station finds its own earlier issue by this exact string. */
export function buildIssueTitle(repoName) {
  return `A visual README for ${repoName}? (happy to send a PR)`;
}

const MODE_LINE = {
  ascii: (repo) => `It's your README, exactly as you wrote it, with a link to an explainer page right under the title and your own ASCII diagrams drawn as clean, animated graphics just above the originals. Nothing is replaced.`,
  fallback: (repo) => `It's your README, exactly as you wrote it, with a link to an explainer page right under the title and two diagrams just after your intro: what ${repo} plugs into, and how it works.`,
  'link-only': (repo) => `It's your README, exactly as you wrote it, with a link to an explainer page right under the title.`,
};

/**
 * @param {object} o
 * @param {string} o.repoName
 * @param {string} o.liveUrl       the live explainer page
 * @param {string} o.readmeUrl     blob URL of the proposed README on the PR's branch (one click, rendered)
 * @param {{architecture?:string, flow?:string, hero?:string}} [o.images]  absolute URLs, all optional
 * @param {'ascii'|'fallback'|'link-only'} o.mode
 * @param {number} o.addedLines    lines added to README.md
 * @param {string[]} o.files       other files in the PR (repo-relative)
 * @param {string} [o.intro]       replaces the two opening paragraphs; {repo} is substituted
 * @param {string} [o.signoff]     name to sign with
 * @param {'pr'|'issue'} [o.kind]  'issue' = a proposal with the work already visible and a PR on request
 */
export function buildPrBody(o) {
  const repo = o.repoName;
  const img = o.images || {};
  const intro = (o.intro && o.intro.trim())
    ? o.intro.trim().replace(/\{repo\}/g, repo)
    : [
      `Hi, and thank you for building ${repo}. It's genuinely good work, and I think more people should get to see it.`,
      '',
      `Newcomers can have a hard time working out what a project is, and how its pieces fit together, from a README alone. So I ran ${repo} through a tool that turns a repo into a visual explainer, and I'd like to suggest a small change to your README that makes it easier to take in.`,
    ].join('\n');

  const out = [];
  out.push(`## 👋 Thank you for ${repo}`);
  out.push('');
  out.push(intro);
  out.push('');
  out.push('## 👉 See the new README in one click');
  out.push('');
  out.push(`**[Open the proposed README, rendered →](${o.readmeUrl})**`);
  out.push('');
  out.push((MODE_LINE[o.mode] || MODE_LINE['link-only'])(repo));
  out.push('');
  if (img.architecture) out.push(`[![What ${repo} plugs into, as it appears in the proposed README](${img.architecture})](${o.readmeUrl})`, '');
  if (img.flow) out.push(`[![How ${repo} works, as it appears in the proposed README](${img.flow})](${o.readmeUrl})`, '');
  out.push('## 🎨 And a page that tells the story');
  out.push('');
  out.push(`I also made a full visual explainer for ${repo}:`);
  out.push('');
  out.push(`**[${String(o.liveUrl).replace(/^https?:\/\//, '').replace(/\/$/, '')} →](${o.liveUrl})**`);
  out.push('');
  if (img.hero) out.push(`[![The ${repo} explainer page](${img.hero})](${o.liveUrl})`, '');
  const isIssue = o.kind === 'issue';
  out.push(isIssue ? "## What I'd change" : "## What's in this PR");
  out.push('');
  out.push(`- \`README.md\`: ${o.addedLines} lines added, **0 removed**. Nothing you wrote ${isIssue ? 'would be' : 'has been'} changed.`);
  for (const f of o.files || []) out.push(`- \`${f}\``);
  out.push('');
  if (isIssue) {
    out.push(`I haven't touched your repo. If you'd like this, say the word and I'll open a pull request with exactly that, or you're welcome to take whatever is useful. The diagrams were generated from your repo, and every claim on them was checked against your source, but please give them a quick accuracy check. If you'd rather not, closing this is completely fine, and I won't send another.`);
  } else {
    out.push(`The diagrams were generated from your repo, and every claim on them was checked against your source, but please give them a quick accuracy check before merging. Take it as is, tweak it, or ignore it. It's yours either way. If you'd rather not have it, closing this is completely fine, and I won't send another.`);
  }
  out.push('');
  out.push('Thanks again for building this, and for making it open.');
  out.push('');
  if (o.signoff && o.signoff.trim()) out.push(o.signoff.trim(), '');
  out.push(`Made with [explainmyrepo](${EXPLAINER_REPO})`);
  return `${out.join('\n')}\n`;
}

/**
 * Decide whether to send, reuse, or stand down. Order matters: never re-send to someone who said no.
 * @param {object} o
 * @param {string} o.owner            source repo owner login
 * @param {string} o.ghLogin          the account the PR would come from
 * @param {boolean} [o.isPrivate]
 * @param {string} [o.liveUrl]
 * @param {{state:string,url:string,author?:string}[]} [o.existing]  PRs on our branch, any state
 * @returns {{action:'send'}|{action:'reuse',url:string}|{action:'skip',reason:string}}
 */
export function decideSend(o) {
  // (shared by the issue and PR channels: "already responded" means a CLOSED or MERGED item of ours)
  if (!o.liveUrl) return { action: 'skip', reason: 'no-live-url' };
  if (o.isPrivate) return { action: 'skip', reason: 'private-source-repo' };
  if (o.ghLogin && o.owner && o.ghLogin.toLowerCase() === o.owner.toLowerCase()) return { action: 'skip', reason: 'own-repo' };
  const mine = (o.existing || []).filter((p) => !p.author || !o.ghLogin || p.author.toLowerCase() === o.ghLogin.toLowerCase());
  const open = mine.find((p) => String(p.state).toUpperCase() === 'OPEN');
  if (open) return { action: 'reuse', url: open.url };
  if (mine.some((p) => ['CLOSED', 'MERGED'].includes(String(p.state).toUpperCase()))) {
    return { action: 'skip', reason: 'already-responded' };
  }
  return { action: 'send' };
}

/** Opt-out: README_ENHANCE=0|false|no|off. Anything else — including unset — means ON. */
export function readmePrEnabled(env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.README_ENHANCE) || '').trim());
}
