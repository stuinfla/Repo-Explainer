# Technical diagrams

Per ADR-0001 D15(E) and the build brief, the **technical / architectural diagrams ship as
crisp inline SVG authored directly in `index.html`** (57 inline `<svg>` figures) — not as
separate raster files. Inline SVG keeps them sharp at any zoom, accessible (each has a
`role="img"` + `aria-label`), themeable with the page's spectrum palette, and true to the
real PhotonLayer architecture (pipeline, optical stack, crate graph, ceiling-break bars,
compression sweep, positioning, etc.).

The friendly raster on-ramp illustrations live in `../img/` (Gemini-generated).

This directory is reserved for any future exported/standalone diagram assets.
