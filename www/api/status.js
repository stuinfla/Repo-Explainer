/* =============================================================================
   GET /api/status — Read build status from a public GitHub Gist.
   Vercel Serverless Function (Node.js runtime).
   ========================================================================== */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== "GET") {
    res.writeHead(405, corsHeaders());
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const { id, gist } = req.query || {};

  if (!id || !gist) {
    res.writeHead(400, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Missing required query parameters: id, gist" })
    );
  }

  let gistData;
  try {
    const gistRes = await fetch("https://api.github.com/gists/" + gist, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "explainmyrepo-bot",
      },
    });

    if (gistRes.status === 404) {
      res.writeHead(404, corsHeaders());
      return res.end(
        JSON.stringify({ error: "Build status not found." })
      );
    }

    if (!gistRes.ok) {
      res.writeHead(502, corsHeaders());
      return res.end(
        JSON.stringify({ error: "Failed to fetch build status. Try again later." })
      );
    }

    gistData = await gistRes.json();
  } catch (err) {
    res.writeHead(502, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Failed to reach GitHub API. Try again later." })
    );
  }

  const statusFile = gistData.files && gistData.files["status.json"];
  if (!statusFile || !statusFile.content) {
    res.writeHead(404, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Build status file not found in gist." })
    );
  }

  let status;
  try {
    status = JSON.parse(statusFile.content);
  } catch (err) {
    res.writeHead(502, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Build status data is malformed." })
    );
  }

  if (status.buildId !== id) {
    res.writeHead(404, corsHeaders());
    return res.end(
      JSON.stringify({ error: "Build ID mismatch." })
    );
  }

  if (gistData.updated_at) {
    status.updatedAt = gistData.updated_at;
  }

  res.writeHead(200, corsHeaders());
  return res.end(JSON.stringify(status));
};
