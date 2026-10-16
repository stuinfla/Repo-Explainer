# explainmyrepo ask service

One Netlify function (`/api/ask`) that writes the short, cited answers for the "Ask this project" box on every
explainer. Explainer sites call it; they keep no key and need no function of their own.

**Why central:** the first prototype put a function and the model key on each explainer site. Review showed the
page supplied its own excerpts, so the endpoint was an open proxy on the key. Here the browser sends only the
question and passage ids; the service verifies a signed token for the site's host, fetches that site's own
`ask/index.json`, and builds the passages itself.

**Environment (set on this site):**

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | model access. Give this site its own key with a spend limit set at OpenRouter — that limit is the hard backstop |
| `ASK_SIGNING_SECRET` | same value as in the build machine's `.env`; tokens are `base64url(host).HMAC(host)` |
| `ASK_MODEL` | default `anthropic/claude-haiku-5.5` |
| `ASK_SITE_CAP` / `ASK_DAILY_CAP` | questions per site per day (default 150) / across all sites (default 1500) |

Fails closed: no key, no secret, or no working counter means no answer — the page falls back to showing the closest passages.
