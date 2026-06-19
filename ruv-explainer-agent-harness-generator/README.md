# ruv-explainer-agent-harness-generator

Foundry/mint-themed **ExplainerSite** for **MetaHarness**
(`ruvnet/agent-harness-generator`). Static single page, **no build, no deps**.

> The harness is the product. This site teaches a non-technical Claude Code user
> what MetaHarness is and how to use it, and links the drop-in AI half.

## Status — P2 (site skeleton + design lock)

The **shell** is built and the **aesthetic is locked**: warm-charcoal +
molten-amber/copper, Big Shoulders Display over IBM Plex Sans/Mono, tactile
pressed-metal depth, **zero cyan** (deliberately unlike the cognitum reference).
All section body copy is **clearly-marked placeholder** — real copy lands in P4
from the 7-arc draft; graphics G1–G6 land in P5.

## Files

| File | Role |
|---|---|
| `index.html` | Single page; 9 collapsible `<details>` sections (01–07 = 7 arc questions, 08 = use-case gallery, 09 = drop-in). |
| `styles.css` | `:root` foundry tokens, 5 `@font-face` (self-hosted woff2), `prefers-reduced-motion`, responsive. |
| `main.js` | < 6 KB: deep-link section open + dropzone stub (click / keyboard / drag fallback). |
| `vercel.json` | `cleanUrls`, `/assets` immutable cache, woff2 + zip content-type. |
| `favicon.svg` | Hand-authored 'MH' molten stamped coin. |
| `assets/img/` | G1–G6 graphics (see its `README.md`). |
| `assets/fonts/` | 5 self-hosted woff2 (see its `README.md`). |
| `downloads/` | `metaharness-dropin.zip` (the AI half; built P7/P9, gitignored). |

## Local preview

Any static server, e.g. `python3 -m http.server` from this directory, then open
`http://localhost:8000`.

See `../docs/build-plan-metaharness.md` for the full plan and gates.
