# explainmyrepo ask service

One Netlify function (`/api/ask`) that writes the short, cited answers for the "Ask this project" box on
explainers built by the **local door** (the hosted door does not add the box yet; see ADR-0016). Explainer sites
call it; they keep no key and need no function of their own.

**Why central:** the first prototype put a function and the model key on each explainer site. Review showed the
page supplied its own excerpts, so the endpoint was an open proxy on the key. Here the browser sends only the
question and passage ids; the service verifies a signed token for the site's host, fetches that site's own
`ask/index.json`, and builds the passages itself.

## What a request goes through (in order, `netlify/functions/ask.mjs`)

1. Not configured (no `ASK_SIGNING_SECRET` or `OPENROUTER_API_KEY`): refused, so the page shows the closest passages.
2. The signed token must verify (`verifyToken`) and the browser `Origin` must match the signed host.
3. **AIMDS inbound** (`lib/guard.mjs`, `@claude-flow/aidefence`): the question is scanned before anything is spent or
   sent. Threats at medium severity or above are refused, and so are personal data and credentials (they must not be
   forwarded to a third-party model).
4. The per-site and global daily counters (Netlify Blobs) take a slot. No working counter means no answer.
5. The model writes the answer from the site's own passages.
6. **AIMDS outbound**: the answer is scanned before the visitor sees it. A threat withholds it. Every scanner error
   on either side blocks (fail closed).

**Answers are buffered, not streamed.** The reply is held until it has been scanned, because a stream cannot be taken
back once it has started. Answers are under 150 words, so the wait is a few seconds.

## Environment (set on this site)

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | model access. Give this site its own key with a spend limit set at OpenRouter; that limit is the hard backstop |
| `ASK_SIGNING_SECRET` | same value as in the build machine's `.env` (at least 24 characters); tokens are `base64url(host).HMAC(host)` |
| `ASK_MODEL` | default `anthropic/claude-haiku-5.5` |
| `ASK_SITE_CAP` / `ASK_DAILY_CAP` | questions per site per day (default 150) / across all sites (default 1500) |

## Where the token code lives

The service **verifies** (`verifyToken` in `netlify/functions/ask.mjs`); the build machine only **signs**
(`src/ask-token.mjs`). They are deployed separately, so each side owns its half, and `tests/ask.test.mjs` runs the
signer and the service's verifier against each other (forged, truncated and wrong-secret tokens are rejected).
`tests/ask-service.test.mjs` drives the guard through the service's real handler.

Fails closed: no key, no secret, no working counter, or no scanner verdict means no answer. The page then falls back
to showing the closest passages and says so.
