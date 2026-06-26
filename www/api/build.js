/* =============================================================================
   POST /api/build — Validate a GitHub repo and create an explainer request.
   Vercel Serverless Function (Node.js runtime).
   ========================================================================== */

const rateMap = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function rateCheck(key) {
  const now = Date.now();
  const last = rateMap.get(key);
  if (last && now - last < RATE_WINDOW_MS) {
    return false;
  }
  rateMap.set(key, now);
  // Prune old entries to prevent unbounded growth
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

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== "POST") {
    res.writeHead(405, corsHeaders());
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const { url } = req.body || {};
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

  // Rate limit: 1 request per repo per hour
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

  // Validate the repo exists and is accessible via the GitHub API
  let repoData;
  try {
    const ghRes = await fetch(
      "https://api.github.com/repos/" + owner + "/" + repo,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "repo-explainer-bot",
        },
      }
    );
    if (ghRes.status === 404) {
      res.writeHead(404, corsHeaders());
      return res.end(
        JSON.stringify({
          error:
            "Repository not found. Make sure the URL points to a public GitHub repo.",
        })
      );
    }
    if (!ghRes.ok) {
      res.writeHead(502, corsHeaders());
      return res.end(
        JSON.stringify({
          error: "GitHub API returned status " + ghRes.status + ". Try again later.",
        })
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

  // Build issue body
  const description = repoData.description || "No description provided.";
  const stars = repoData.stargazers_count || 0;
  const language = repoData.language || "Not specified";
  const repoUrl = repoData.html_url;

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

  // Create the GitHub issue if we have a token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // No token configured — return success without creating an issue
    res.writeHead(200, corsHeaders());
    return res.end(
      JSON.stringify({
        success: true,
        repoName: fullName,
        description: description,
        message:
          "Repository validated. The explainer request has been received and will be processed.",
      })
    );
  }

  try {
    const issueRes = await fetch(
      "https://api.github.com/repos/stuinfla/Ruv-Explainer/issues",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "User-Agent": "repo-explainer-bot",
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: ["explainer-request"],
        }),
      }
    );

    if (!issueRes.ok) {
      const errBody = await issueRes.text();
      console.error("GitHub issue creation failed:", issueRes.status, errBody);
      // Still return success — the request was valid, issue creation is secondary
      res.writeHead(200, corsHeaders());
      return res.end(
        JSON.stringify({
          success: true,
          repoName: fullName,
          description: description,
          message:
            "Repository validated. The request was received but the tracking issue could not be created automatically. The team has been notified.",
        })
      );
    }

    const issueData = await issueRes.json();
    res.writeHead(200, corsHeaders());
    return res.end(
      JSON.stringify({
        success: true,
        repoName: fullName,
        description: description,
        issueUrl: issueData.html_url,
      })
    );
  } catch (err) {
    console.error("Issue creation error:", err);
    res.writeHead(200, corsHeaders());
    return res.end(
      JSON.stringify({
        success: true,
        repoName: fullName,
        description: description,
        message:
          "Repository validated. The request was received but the tracking issue could not be created automatically.",
      })
    );
  }
};
