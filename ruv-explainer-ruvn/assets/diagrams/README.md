# assets/diagrams

The precise **technical diagrams** for this explainer are authored as **crisp inline SVG**
directly in `index.html` (one per numbered section, in each `<figure class="figure diagram">`),
per ADR-0001 Part II gate (E): *"ARCHITECTURAL / explanatory diagrams — authored as crisp SVG,
not AI raster."* Authoring them inline keeps them styleable, zoomable, accessible
(`<title>`/`<desc>` + `role="img"`), and zero-request.

This folder is reserved for any standalone `.svg` exports of those diagrams if they are ever
needed outside the page (e.g. for the NotebookLM human half or social cards).

The **friendly raster on-ramp** illustrations live in `../img/` (g-*.png).
