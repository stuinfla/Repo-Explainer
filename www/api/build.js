/* =============================================================================
   POST /api/build — Validate a GitHub repo, provision a status gist,
   and trigger the build pipeline via workflow_dispatch.
   Vercel Serverless Function (Node.js runtime).
   ========================================================================== */

const crypto = require("crypto");

const rateMap = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function rateCheck(key) {
  const now = Date.now();
  const last = rateMap.get(key);
  if (last && now - last < RATE_WINDOW_MS) {
    return false;
  }
  rateMap.set(key, now);
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) {
      if (now - v > RATE_WINDOW_MS) rateMap.delete(k);
    }
  }
  return true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function ghHeaders(token) {
  return {
    Accept: "application/vnd.github.v3+json",
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "User-Agent": "explainmyrepo-bot",
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== "POST") {
    res.writeHead(405, corsHeaders());
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.writeHead(500, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Server misconfigured: missing GITHUB_TOKEN." })
    );
  }

  const { url, email } = req.body || {};
  if (!url || typeof url !== "string") {
    res.writeHead(400, corsHeaders());
    return res.end(JSON.stringify({ error: "Missing or invalid 'url' field." }));
  }

  const match = url.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!match) {
    res.writeHead(400, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Not a valid GitHub repository URL." })
    );
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const fullName = owner + "/" + repo;

  if (!rateCheck(fullName.toLowerCase())) {
    res.writeHead(429, corsHeaders());
    return res.end(
      JSON.stringify({
        error:
          "An explainer request for " +
          fullName +
          " was already submitted recently. Please wait before trying again.",
      })
    );
  }

  // Validate the repo exists and is accessible to our GitHub token.
  // Authenticated so the token's own private repos are visible (GitHub
  // returns 404 — not 403 — for private repos to anonymous callers).
  let repoData;
  try {
    const ghRes = await fetch(
      "https://api.github.com/repos/" + owner + "/" + repo,
      { headers: ghHeaders(token) }
    );
    if (ghRes.status === 404) {
      res.writeHead(404, corsHeaders());
      return res.end(
        JSON.stringify({
          error:
            "Couldn't find " +
            fullName +
            ", or the explainmyrepo GitHub account doesn't have access to it. " +
            "Check the URL — and if it's a private repo, make sure it's owned by " +
            "or shared with that account.",
        })
      );
    }
    if (!ghRes.ok) {
      res.writeHead(502, corsHeaders());
      return res.end(
        JSON.stringify({ error: "GitHub API returned status " + ghRes.status + ". Try again later." })
      );
    }
    repoData = await ghRes.json();
  } catch (err) {
    res.writeHead(502, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Failed to reach the GitHub API. Try again later." })
    );
  }

  // Private repos are allowed as long as our token can read them (validated
  // above). We surface the privacy state so the caller knows the source is
  // private — the explainer OUTPUT visibility is governed separately.
  const isPrivate = Boolean(repoData.private);

  // Generate build ID
  const buildId = crypto.randomUUID();

  // Create status gist
  const statusPayload = {
    buildId: buildId,
    step: 0,
    totalSteps: 9,
    stepName: "Queued",
    status: "queued",
    startedAt: new Date().toISOString(),
    error: null,
    result: null,
  };

  let gistId;
  try {
    const gistRes = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({
        description: "explainmyrepo build status: " + fullName,
        public: true,
        files: {
          "status.json": { content: JSON.stringify(statusPayload, null, 2) },
        },
      }),
    });
    if (!gistRes.ok) {
      const errBody = await gistRes.text();
      console.error("Gist creation failed:", gistRes.status, errBody);
      res.writeHead(502, corsHeaders());
      return res.end(
        JSON.stringify({ error: "Failed to create build status tracker." })
      );
    }
    const gistData = await gistRes.json();
    gistId = gistData.id;
  } catch (err) {
    console.error("Gist creation error:", err);
    res.writeHead(502, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Failed to create build status tracker." })
    );
  }

  // Trigger the build pipeline via workflow_dispatch
  const workflowInputs = {
    target_owner: owner,
    target_repo: repo,
    build_id: buildId,
    gist_id: gistId,
  };
  if (email && typeof email === "string" && email.includes("@")) {
    workflowInputs.submitter_email = email;
  }

  try {
    const workflowRes = await fetch(
      "https://api.github.com/repos/stuinfla/Repo-Explainer/actions/workflows/build-explainer.yml/dispatches",
      {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({ ref: "main", inputs: workflowInputs }),
      }
    );
    if (!workflowRes.ok && workflowRes.status !== 204) {
      const errBody = await workflowRes.text();
      console.error("Workflow dispatch failed:", workflowRes.status, errBody);
      res.writeHead(502, corsHeaders());
      return res.end(
        JSON.stringify({ error: "Failed to start the build pipeline. Please try again." })
      );
    }
  } catch (err) {
    console.error("Workflow dispatch error:", err);
    res.writeHead(502, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Failed to start the build pipeline. Please try again." })
    );
  }

  const response = {
    success: true,
    buildId: buildId,
    statusUrl: "/api/status?id=" + buildId + "&gist=" + gistId,
    gistId: gistId,
    repoName: fullName,
    private: isPrivate,
  };

  res.writeHead(200, corsHeaders());
  return res.end(JSON.stringify(response));
};
