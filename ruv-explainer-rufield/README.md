# ruv-explainer-rufield

A plain-language **ExplainerSite** for **RuField MFS** (`ruvnet/rufield`) — the open
specification plus working Rust reference build for **camera-free multimodal field
sensing**: turning the invisible WiFi / radar / heat signals already in a room into
privacy-labelled, provenance-signed, fusion-ready facts (*present · sitting · got out
of bed · left*) — with no camera and no microphone.

- **Source of truth (content):** `content/rufield.canon.md`
- **Upstream repo:** <https://github.com/ruvnet/rufield> by Reuven Cohen ([@ruvnet](https://github.com/ruvnet)), MIT.
- **Provenance shown on page:** Updated 2026-06-19 · source `@ 509d8ae` · `rufield.mfs.v0.1`.

## What's here

Static site — no build, no dependencies, no framework.

```
index.html          8 collapsible numbered sections (learning arc) + hero + footer
styles.css          FIELD/SIGNAL theme: deep slate-charcoal + signal-violet/magenta
main.js             progressive enhancement (deep-link sections, dropzone stub)
favicon.svg         a violet field-wave mark
vercel.json         static headers (immutable assets, woff2, zip)
package.json        metadata only (no scripts)
robots.txt          allow all + sitemap pointer
assets/img/         g1–g6 friendly raster art (+ optimized prompts) — gate-E tier
assets/diagrams/    (reserved; technical diagrams are authored INLINE in index.html)
assets/fonts/        optional self-hosted woff2 (system fallbacks ship by default)
downloads/          the drop-in .zip lands here at publish (gitignored)
```

## Aesthetic [Constraint K — distinct per repo]

Deep **slate-charcoal** (cool blue-grey, never warm) with **signal-violet → magenta**
accents and **waveform / field** motifs. Type: **Space Grotesk** over **Inter** /
**JetBrains Mono**. Deliberately unlike the MetaHarness amber/copper foundry site and
unlike the cognitum cyan.

## Dual-level visuals [D15-E]

Every section carries **both**:
1. a **precise technical SVG** — authored inline, accurate to the real 7-crate
   architecture / pipeline / privacy ladder, labelled and source-cited; and
2. a **simple, friendly illustration** — either a generated raster (g1–g6) or a
   friendly inline SVG — that makes the idea approachable.

## Local preview

```
cd ruv-explainer-rufield
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy

Vercel, git-connected, auto-deploy on push → `ruv-explainer-rufield.vercel.app`.
