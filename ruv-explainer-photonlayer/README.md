# PhotonLayer — Explainer Site

A plain-English explainer for **[PhotonLayer](https://github.com/ruvnet/PhotonLayer)** by
**Reuven Cohen / [@ruvnet](https://github.com/ruvnet)** — a deterministic optical-AI front
end where a learned phase mask reshapes light so a tiny sensor captures the *answer* instead
of the whole picture, with a signed, reproducible receipt.

This site is part of the Repo-Primer / ExplainerSite pipeline (ADR-0001, Part II). It is an
independent explainer; all numbers and quotes are grounded in the source repo at the SHA
shown on the page. Nothing is invented.

## Structure

```
ruv-explainer-photonlayer/
├ index.html            # the site — 11 collapsible numbered sections, dual-level visuals
├ styles.css            # PRISM / NEAR-BLACK theme (distinct per repo, constraint K)
├ main.js               # collapsible sections, smooth nav, live-provenance refresh, copy-to-clip
├ favicon.svg           # prism + spectrum mark
├ vercel.json           # static hosting config
├ package.json          # local dev server
├ robots.txt
└ assets/
   ├ img/               # friendly raster on-ramp illustrations (Gemini-generated)
   └ diagrams/          # (reserved) — technical diagrams ship as inline SVG in index.html
```

## Run locally

```bash
npm run dev      # serves on http://localhost:4321
```

## Provenance

- Source: <https://github.com/ruvnet/PhotonLayer> @ `fe86c9fad9a1572ce46e337f118656961bdf4ebb`
- Live demo: <https://ruvnet.github.io/PhotonLayer/>
- NotebookLM studio (public — audio · video · slides · infographic · report): <https://notebooklm.google.com/notebook/d97351e0-542f-4c80-9e56-19cb1dca04f5>
- License (PhotonLayer): MIT © Ruvector
- Updated: 2026-06-19
