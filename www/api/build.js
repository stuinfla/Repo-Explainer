/* =============================================================================
   POST /api/build — Validate a GitHub repo, create a tracking issue,
   provision a status gist, and trigger the build pipeline.
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
    "User-Agent": "repo-explainer-bot",
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

  // Validate the repo exists and is public
  let repoData;
  try {
    const ghRes = await fetch(
      "https://api.github.com/repos/" + owner + "/" + repo,
      { headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "repo-explainer-bot" } }
    );
    if (ghRes.status === 404) {
      res.writeHead(404, corsHeaders());
      return res.end(
        JSON.stringify({
          error: "Repository not found. Make sure the URL points to a public GitHub repo.",
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

  if (repoData.private) {
    res.writeHead(400, corsHeaders());
    return res.end(
      JSON.stringify({
        error: "This repository is private. Repo Explainer only works with public repos.",
      })
    );
  }

  const description = repoData.description || "No description provided.";
  const stars = repoData.stargazers_count || 0;
  const language = repoData.language || "Not specified";
  const repoUrl = repoData.html_url;

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
        description: "Repo Explainer build status: " + fullName,
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

  // Create tracking issue
  const issueTitle = "Explainer request: " + fullName;
  const issueBody = [
    "## Explainer Request",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| **Repository** | [" + fullName + "](" + repoUrl + ") |",
    "| **Description** | " + description.replace(/\|/g, "\\|") + " |",
    "| **Language** | " + language + " |",
    "| **Stars** | " + stars + " |",
    "| **Build ID** | `" + buildId + "` |",
    "| **Status Gist** | [View](https://gist.github.com/" + gistId + ") |",
    "",
    "### Next steps",
    "",
    "1. Run the Repo-Primer Pipeline against this repo.",
    "2. Build the explainer site and smart zip.",
    "3. Run all 5 quality gates (target: 95+).",
    "4. Deploy to Vercel and create the GitHub repo.",
    "5. Invite the repo author as a collaborator on the explainer repo.",
    "",
    "---",
    "*Submitted via [Repo Explainer](https://repo-explainer-six.vercel.app).*",
  ].join("\n");

  let issueUrl = null;
  let issueNumber = null;
  try {
    const issueRes = await fetch(
      "https://api.github.com/repos/stuinfla/Repo-Explainer/issues",
      {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: ["explainer-request"],
        }),
      }
    );
    if (issueRes.ok) {
      const issueData = await issueRes.json();
      issueUrl = issueData.html_url;
      issueNumber = issueData.number;
    } else {
      const errBody = await issueRes.text();
      console.error("GitHub issue creation failed:", issueRes.status, errBody);
    }
  } catch (err) {
    console.error("Issue creation error:", err);
  }

  // Trigger the build pipeline via workflow_dispatch
  const workflowInputs = {
    target_owner: owner,
    target_repo: repo,
    build_id: buildId,
    gist_id: gistId,
  };
  if (issueNumber !== null) {
    workflowInputs.issue_number = String(issueNumber);
  }
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
    }
  } catch (err) {
    console.error("Workflow dispatch error:", err);
  }

  const response = {
    success: true,
    buildId: buildId,
    statusUrl: "/api/status?id=" + buildId + "&gist=" + gistId,
    gistId: gistId,
    repoName: fullName,
  };
  if (issueUrl) {
    response.issueUrl = issueUrl;
  }

  res.writeHead(200, corsHeaders());
  return res.end(JSON.stringify(response));
};
