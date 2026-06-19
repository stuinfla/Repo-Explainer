# ruv-explainer-ruqu

A plain-language **ExplainerSite** for [**ruvnet/ruqu**](https://github.com/ruvnet/ruqu) —
a pretend quantum computer (a faithful state-vector simulator) written in pure Rust and
compiled to WebAssembly, plus a real-time "is it safe to act?" coherence engine.

Built as the second target of the **Repo-Primer Pipeline** (ADR-0001, Part II). One page
per repo; this is ruqu's. It is a static site — no build step, no dependencies.

- **Source of truth:** `content/ruqu.canon.md`
- **Author of ruqu:** Reuven Cohen / [@ruvnet](https://github.com/ruvnet)
- **Provenance:** content grounded in the repo's own READMEs at HEAD
  `026d63ef900ab689c863b6b3254f5dce8c068bf6` — no invented features.
  Workspace v2.2.3 · `@ruvector/ruqu` v0.2.0 · `@ruvector/ruqu-wasm` v2.0.5.

## Distinct aesthetic [Constraint K]

Deep **indigo** substrate, **electric-magenta** + **violet** accents, **cyan** phosphor
highlight; **bloch-sphere / quantum-circuit** motifs. Deliberately NOT the amber/copper
"foundry" look of the MetaHarness site, and not a clone of any prior primer.

## Dual-level visuals [D12 / gate E]

Every section carries **both**:

1. a **technical SVG** in `assets/diagrams/` — precise, labeled, accurate to the real
   architecture/process (the tier-2 "how it actually works" diagram), and
2. a **friendly illustration** in `assets/img/` — the approachable tier-1 on-ramp,
   generated with the `image-generation` skill (prompts saved as `gN.prompt.txt`).

That dual-level coverage is the whole advantage over a README.

## Files

```
ruv-explainer-ruqu/
├ index.html            — the site (collapsible numbered sections, learning-arc order)
├ styles.css            — quantum/indigo theme tokens + layout
├ main.js               — progressive enhancement (deep-link, live provenance)
├ favicon.svg           — bloch-sphere mark
├ vercel.json           — static hosting config
├ package.json          — metadata (no deps, no build)
├ robots.txt
├ assets/
│  ├ diagrams/          — technical SVGs (s01–s07, qubit, uc1–uc7, diff, dropin)
│  └ img/               — friendly raster art (g1–g8) + gN.prompt.txt
└ downloads/            — the drop-in .zip lands here (gitignored; ships via Release)
```

## Run locally

It's a static site — open `index.html`, or:

```bash
npx serve .      # or: python3 -m http.server
```

## Deploy

Vercel, git-connected, auto-deploy on push. Target host:
`https://ruv-explainer-ruqu.vercel.app`.
