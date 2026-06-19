# assets/fonts/ — self-hosted woff2 (zero CDN)

`styles.css` declares **5** `@font-face` faces, all loaded from THIS directory
with `font-display: swap`. No CDN, no Google Fonts request at runtime
[Constraint: site is fully self-hosted]. Drop the real `.woff2` files here at
build time (they are gitignored; commit/ship them with the deploy bundle).

| File (exact name expected by `styles.css`) | Family | Weight | Use |
|---|---|---|---|
| `BigShouldersDisplay-SemiBold.woff2` | Big Shoulders Display | 600 | h3, CTA, brand label |
| `BigShouldersDisplay-Black.woff2` | Big Shoulders Display | 900 | h1/h2 display headings, coin |
| `IBMPlexSans-Regular.woff2` | IBM Plex Sans | 400 | body text |
| `IBMPlexSans-Medium.woff2` | IBM Plex Sans | 500 | emphasis |
| `IBMPlexMono-Regular.woff2` | IBM Plex Mono | 400 | eyebrows, code chips, meta, captions |

## Sourcing

Both families are SIL Open Font License (OFL) and free to self-host:
- **Big Shoulders Display** — Google Fonts (OFL).
- **IBM Plex Sans / IBM Plex Mono** — IBM Plex (OFL).

Get the woff2 either by downloading the families and subsetting to Latin
(e.g. with `fonttools`/`pyftsubset` or `glyphhanger`) to keep each file small, or
by pulling the prebuilt woff2 from a Plex/Fontsource distribution. Subset to the
glyphs actually used (Latin + the few punctuation/arrow glyphs on the page) to
keep total font weight low.

Filenames must match the table exactly — `styles.css` references them verbatim.
