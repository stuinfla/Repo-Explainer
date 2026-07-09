/* =============================================================================
   POST /.netlify/functions/build

   The hosted front door. Validates a GitHub repo, meters usage (5 free builds
   per email + a global monthly kill-switch), creates a status gist, and triggers
   the GitHub Actions build (build-explainer.yml) which runs the real engine on the
   OWNER's keys and writes progress back to that gist. The client polls /status.

   Env (Netlify site settings, server-side only — never sent to the browser):
     GITHUB_TOKEN            PAT with `gist` + `actions:write` on stuinfla/Repo-Explainer
     EMAIL_LEDGER_GIST_ID    gist holding ledger.json  (per-email counts)   [optional]
     GLOBAL_COUNTER_GIST_ID  gist holding counter.json (global monthly cap) [optional]
   If a meter gist id is missing we FAIL OPEN (allow the build) and log — the metering
   is a politeness/kill-switch layer, never a reason to break a legit request.
   ========================================================================== */

const FREE_PER_EMAIL = 5;
const REPO = "stuinfla/Repo-Explainer"; // where build-explainer.yml lives

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(obj),
  };
}

function gh(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "User-Agent": "explainmyrepo-bot",
  };
}

// ---- tiny gist-as-keyvalue helpers (read-modify-write JSON in one file) ------
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
async function writeGist(token, gistId, file, obj) {
  try {
    await fetch("https://api.github.com/gists/" + gistId, {
      method: "PATCH",
      headers: gh(token),
      body: JSON.stringify({ files: { [file]: { content: JSON.stringify(obj, null, 2) } } }),
    });
  } catch (e) { console.error("meter write failed:", e && e.message); }
}

// Daily door tally (doors.json, same gist as the monthly counter): how many submissions were
// accepted vs bounced for being private vs unreachable. Feeds the admin dashboard's
// public/private intelligence. Best-effort — a tally failure must never block a build.
async function bumpDoor(token, kind) {
  const counterId = process.env.GLOBAL_COUNTER_GIST_ID;
  if (!counterId) return;
  try {
    const doors = (await readGist(token, counterId, "doors.json")) || {};
    const day = new Date().toISOString().slice(0, 10);
    doors[day] = doors[day] || { accepted: 0, private: 0, notfound: 0 };
    doors[day][kind] = (doors[day][kind] || 0) + 1;
    await writeGist(token, counterId, "doors.json", doors);
  } catch { /* never block the door on its own tally */ }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const token = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "Server misconfigured: missing EXPLAINER_GH_TOKEN." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body." }); }
  const url = (body.url || "").toString();
  const email = (body.email || "").toString().trim().toLowerCase();

  // Accept the full URL or just "owner/name" — first real user's first ask (2026-07-09).
  const match = url.trim().match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/)
    || url.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return json(400, { error: "That doesn't look like a GitHub repo — try owner/name or https://github.com/owner/name." });
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const fullName = owner + "/" + repo;

  // 1) Repo must exist + be reachable by our token (private repos 404 to anon callers).
  // Same response also carries `size` (KB) — a free, instant, no-clone-needed complexity signal we
  // reuse below to size this build's time/cost budget instead of one fixed ceiling for every repo.
  let repoSizeKb = 0;
  try {
    const r = await fetch("https://api.github.com/repos/" + owner + "/" + repo, { headers: gh(token) });
    if (r.status === 404) {
      await bumpDoor(token, "notfound");
      return json(404, { error: "We can't access " + fullName + ". Check the URL — the website builds PUBLIC repos. Private repo you own? Build it locally: npx explainmyrepo " + fullName + " in a VS Code / Claude Code session (gh auth login first). We only ever build from your exact repo; if we can't see it, we stop rather than guess." });
    }
    if (!r.ok) return json(502, { error: "GitHub API returned " + r.status + " — try again shortly." });
    const repoMeta = await r.json();
    // Policy (ADR-0007, owner decision 2026-07-08): the hosted door builds PUBLIC repos only — a
    // hosted build publishes a public page, which must never quietly expose private code. Private
    // repos are the local door's job, where the owner runs it under their own identity.
    if (repoMeta.private === true) {
      await bumpDoor(token, "private");
      return json(400, { error: fullName + " is a private repo. The website publishes public explainer pages, so it only builds public repos. To build yours: run npx explainmyrepo " + fullName + " in a VS Code / Claude Code session (gh auth login first) — you keep full control, including whether it deploys at all." });
    }
    repoSizeKb = Number(repoMeta.size) || 0;
  } catch { return json(502, { error: "Couldn't reach GitHub — try again shortly." }); }

  // Complexity tiers (size-based; component-count refinement can follow once the pipeline itself
  // reports dep-graph size back, but the outer GH Actions job timeout must be fixed BEFORE dispatch,
  // so a pre-flight signal is what's available here). Bigger repos get more wall-clock AND more $,
  // rather than the same fixed budget regardless of scale.
  //
  // Floors measured live, twice (2026-07-04, 2026-07-06): a first smoke test at 15min on `chalk`
  // got killed mid-image-generation; raised small to 25. Then a REAL production front-door run on
  // `sindresorhus/p-map` (25min) ALSO got killed, this time deep in a quality-grade refine loop —
  // small repos can still need real time once the agent starts iterating on copy/diagram fixes.
  // Raised again. This floor has been wrong twice from a guess; don't lower it again without a real
  // measured run to justify it.
  const tier = repoSizeKb > 200000 ? "large" : repoSizeKb > 20000 ? "medium" : "small";
  const budgetMin = tier === "large" ? 60 : tier === "medium" ? 40 : 30;
  const budgetUsd = tier === "large" ? 18 : tier === "medium" ? 10 : 6;
  // GitHub Actions expressions don't support arithmetic the way `fromJSON(x) + 10` implies (learned
  // the hard way — it rejects the dispatch outright, a YAML-structure check doesn't catch it since
  // it's an expression-syntax error, not a YAML one). Compute the +10min overhead buffer here in
  // plain JS instead and pass the already-summed value.
  const timeoutMin = budgetMin + 10;

  // 2) METERING (before we spend a cent). Fail open if the meter gists aren't configured.
  const ledgerId = process.env.EMAIL_LEDGER_GIST_ID;
  const counterId = process.env.GLOBAL_COUNTER_GIST_ID;
  const nowIso = new Date().toISOString();
  const month = nowIso.slice(0, 7);

  let ledger = null;
  if (ledgerId && email) {
    ledger = await readGist(token, ledgerId, "ledger.json");
    if (ledger && ledger[email] && ledger[email].count >= FREE_PER_EMAIL) {
      return json(402, {
        error: "You've used your " + FREE_PER_EMAIL + " free builds — thank you for trying it! " +
          "To keep going, run it yourself with your own API keys: npx explainmyrepo <github-url> --ship-best-effort",
      });
    }
  } else if (!ledgerId) {
    console.warn("EMAIL_LEDGER_GIST_ID not set — per-email metering disabled (fail-open).");
  }

  let counter = null;
  if (counterId) {
    counter = await readGist(token, counterId, "counter.json");
    if (counter && counter.month === month && typeof counter.hardCap === "number" && (counter.builds || 0) >= counter.hardCap) {
      return json(503, { error: "We've hit this month's community build limit. It resets next month — or run it yourself: npx explainmyrepo <github-url> --ship-best-effort" });
    }
  } else {
    console.warn("GLOBAL_COUNTER_GIST_ID not set — global cap disabled (fail-open).");
  }

  // 3) Create the status gist the runner will patch + the browser will poll.
  const buildId = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  const initial = { buildId, step: 0, totalSteps: 16, stepName: "Queued", status: "queued", repo: fullName, startedAt: nowIso, error: null, result: null };
  let gistId;
  try {
    const r = await fetch("https://api.github.com/gists", {
      method: "POST", headers: gh(token),
      body: JSON.stringify({ description: "explainmyrepo build: " + fullName, public: true, files: { "status.json": { content: JSON.stringify(initial, null, 2) } } }),
    });
    if (!r.ok) { console.error("gist create failed", r.status, await r.text()); return json(502, { error: "Couldn't start the build tracker — try again." }); }
    gistId = (await r.json()).id;
  } catch { return json(502, { error: "Couldn't start the build tracker — try again." }); }

  // 4) Trigger the real build. Runner writes progress -> the status gist.
  try {
    const r = await fetch("https://api.github.com/repos/" + REPO + "/actions/workflows/build-explainer.yml/dispatches", {
      method: "POST", headers: gh(token),
      body: JSON.stringify({ ref: "main", inputs: { target_repo: fullName, build_id: buildId, gist_id: gistId, submitter_email: email || "", budget_min: String(budgetMin), budget_usd: String(budgetUsd), timeout_min: String(timeoutMin) } }),
    });
    if (!r.ok && r.status !== 204) { console.error("dispatch failed", r.status, await r.text()); return json(502, { error: "Couldn't start the build pipeline — try again." }); }
  } catch { return json(502, { error: "Couldn't start the build pipeline — try again." }); }

  // 5) Count it (only now that it's really queued). Best-effort.
  if (ledgerId && email) {
    const l = ledger || {};
    const rec = l[email] || { count: 0, first: nowIso };
    rec.count += 1; rec.last = nowIso; rec.lastRepo = fullName; l[email] = rec;
    await writeGist(token, ledgerId, "ledger.json", l);
  }
  if (counterId) {
    let c = counter || {};
    if (c.month !== month) c = { month, builds: 0, hardCap: typeof c.hardCap === "number" ? c.hardCap : 50 };
    c.builds = (c.builds || 0) + 1;
    await writeGist(token, counterId, "counter.json", c);
  }

  await bumpDoor(token, "accepted");
  return json(200, { success: true, buildId, gistId, statusUrl: "/.netlify/functions/status?id=" + buildId + "&gist=" + gistId, repo: fullName });
};
