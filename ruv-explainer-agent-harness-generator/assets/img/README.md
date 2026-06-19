# assets/img/ — graphics (G1–G6)

Generated in **P5** (image-generation skill) once the P2 foundry/mint palette is
locked. Every hard concept gets a figure [INV-12]. All art uses the locked
palette — **warm-charcoal + molten-amber/copper, zero cyan** [Constraint K].

Palette reference (from `styles.css :root`):
`--bg #16120e` · `--amber #ff9e2c` · `--copper #c2703a` · `--ember #e8531f` ·
`--brass #d9a441` · `--ink #f3e8d8`.

| File | ID | Section | What it shows | Aspect |
|---|---|---|---|---|
| `hero-stamp.png` | **G1** | 01 | The "MH" molten coin / what-it-is hero stamp. | 16:9 |
| `mint-factory-line.png` | **G2** | 02 | Repo → minted-harness assembly line (the factory metaphor). | 16:9 |
| `model-router-cost-curve.png` | **G3** | 04 | `@metaharness/router` "cheapest model that's good enough" cost curve. | 16:9 |
| `darwin-loop.png` | **G4** | 05 | Darwin Mode self-improvement loop: mutate → sandbox-test → keep-if-better. | 16:9 |
| `one-download-two-halves.png` | **G5** | 09 | One download splitting into `for-ai/` + `for-humans/`. | 16:9 |
| `og-card.png` | **G6** | `<meta og:image>` | Social share card. | **1200×630** |

Notes:
- Export PNG (or optimized WebP alongside if added later); keep each ≤ ~250 KB.
- Filenames are referenced by `index.html` / `styles.css` — do not rename without
  updating those.
