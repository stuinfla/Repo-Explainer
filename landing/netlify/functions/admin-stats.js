// admin-stats.js — owner-only aggregate of everything explainmyrepo knows about itself:
// monthly meter, every build ever attempted (from the status gists), every person (email
// ledger), GitHub repo stats + traffic, npm downloads.
//
// Auth: requires the ADMIN_KEY env var to be set in Netlify, and the same value passed as
// the `x-admin-key` header (or ?key=). No key configured → everything refused (fail closed):
// the ledger holds real user emails (PII) and must never be readable from an open endpoint.

const REPO = "stuinfla/Repo-Explainer";

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-admin-key",
    },
    body: JSON.stringify(body),
  };
}

function gh(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "User-Agent": "explainmyrepo-bot",
  };
}

async function readGist(token, gistId, file) {
  try {
    const r = await fetch("https://api.github.com/gists/" + gistId, { headers: gh(token) });
    if (!r.ok) return null;
    const data = await r.json();
    const f = data.files && data.files[file];
    if (!f || !f.content) return {};
    return JSON.parse(f.content);
  } catch { return null; }
}

// Every hosted build creates one public gist "explainmyrepo build: owner/name" holding
// status.json — the list of those gists IS the complete build history. Contents come from
// raw_url (gist.githubusercontent.com), which doesn't spend API rate limit.
async function listBuilds(token) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers: gh(token) });
    if (!r.ok) break;
    const gists = await r.json();
    if (!gists.length) break;
    for (const g of gists) {
      if (!(g.description || "").startsWith("explainmyrepo build:")) continue;
      out.push(g);
    }
    if (gists.length < 100) break;
  }
  const builds = await Promise.all(out.map(async (g) => {
    const base = {
      repo: (g.description || "").replace("explainmyrepo build: ", ""),
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      gistUrl: g.html_url,
      status: "unknown",
      liveUrl: null,
    };
    try {
      const f = g.files && g.files["status.json"];
      if (!f || !f.raw_url) return base;
      const s = await (await fetch(f.raw_url)).json();
      base.status = s.status || "unknown";
      base.liveUrl = (s.result && s.result.liveUrl) || null;
      return base;
    } catch { return base; }
  }));
  builds.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return builds;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return json(503, { error: "ADMIN_KEY is not configured in Netlify env — the admin API stays closed until it is." });
  const given = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) ||
    (event.queryStringParameters && event.queryStringParameters.key) || "";
  if (given !== adminKey) return json(401, { error: "Wrong or missing admin key." });

  const token = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "Server misconfigured: missing EXPLAINER_GH_TOKEN." });

  const ledgerId = process.env.EMAIL_LEDGER_GIST_ID;
  const counterId = process.env.GLOBAL_COUNTER_GIST_ID;

  const [ledger, counter, builds, repoResp, viewsResp, clonesResp, npmWeek, npmMonth] = await Promise.all([
    ledgerId ? readGist(token, ledgerId, "ledger.json") : null,
    counterId ? readGist(token, counterId, "counter.json") : null,
    listBuilds(token),
    fetch(`https://api.github.com/repos/${REPO}`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    // Traffic needs push access on the repo; degrade to null rather than fail the page.
    fetch(`https://api.github.com/repos/${REPO}/traffic/views`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://api.github.com/repos/${REPO}/traffic/clones`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://api.npmjs.org/downloads/point/last-week/explainmyrepo").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://api.npmjs.org/downloads/point/last-month/explainmyrepo").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const people = Object.entries(ledger || {}).map(([email, v]) => ({
    email, count: v.count || 0, first: v.first || null, last: v.last || null, lastRepo: v.lastRepo || null,
  })).sort((a, b) => (a.last < b.last ? 1 : -1));

  const done = builds.filter((b) => b.status === "done");

  return json(200, {
    generatedAt: new Date().toISOString(),
    meter: counter || null,
    totals: {
      buildAttempts: builds.length,
      pagesLive: done.length,
      distinctRepos: new Set(builds.map((b) => b.repo.toLowerCase())).size,
      people: people.length,
    },
    people,
    builds,
    repo: repoResp ? {
      stars: repoResp.stargazers_count, forks: repoResp.forks_count,
      watchers: repoResp.subscribers_count, openIssues: repoResp.open_issues_count,
    } : null,
    traffic: {
      views14d: viewsResp ? { total: viewsResp.count, uniques: viewsResp.uniques } : null,
      clones14d: clonesResp ? { total: clonesResp.count, uniques: clonesResp.uniques } : null,
    },
    npm: {
      lastWeek: npmWeek ? npmWeek.downloads : null,
      lastMonth: npmMonth ? npmMonth.downloads : null,
    },
  });
};
