# Build Journal — <REPO> → <SITE-NAME>.vercel.app

> **This journal IS the recipe path made auditable.** The checklist below mirrors the
> ADR-0001 v1.2.0 Definition-of-Done (Part II) + DDD v1.2.0 invariants. The build swarm
> checks each box **with evidence** as it goes (constraint AA / D25 / INV-23). A deployed
> primer with an incomplete journal is incomplete.

- **Recipe:** ADR-0001 v1.2.0 ⇄ DDD v1.2.0
- **Status:** not started | in progress | done
- **Started:** ____  ·  **Completed:** ____
- **Upstream:** github.com/ruvnet/<REPO> @ <sha>
- **One-line function (plain English):** ____

---

## 0 · Config  (Part I D10)
- [ ] `config/repos/<repo>.json` present — _path / notes_
- [ ] registered in `kb.config.mjs` (primerSlugs etc.)

## 1 · KB build  (Part I D2 / D5) — SINGLE 768-dim variant (v1.3.0)
- [ ] `<repo>-kb.rvf` built — single **384-dim `Xenova/bge-small-en-v1.5`** (desktop), one embed pass — _chunk count / path_
- [ ] passages.jsonl + ids.json + primer.md built

## 2 · GATE A — KB answer-quality  (D15-A / INV-09)
- [ ] tuned set graded **≥95** — _score_
- [ ] held-out set graded **≥95** — _score_
- [ ] PROVE-IT: real `ask-kb` answer (grounded + cited) — _snippet_

## 3 · Site to standard  (Part II D11–D22)
- [ ] Hero opens with captivating visual (S/D21/INV-16)
- [ ] 7 ordered sections (D12)
- [ ] DUAL-LEVEL visuals every section — technical SVG + simple illustration (T/D22/INV-17)
- [ ] IMAGE-FIRST ordering everywhere (W/INV-19)
- [ ] ≥5 use-case scenarios, each VISUAL, lead = relatable named persona (J/INV-11)
- [ ] Resonance lead: what-does-it-do / why-care / why-need + named before→after (P/D20/INV-18)
- [ ] Differentiation vs tools they already have + before→after-on-your-codebase (U/D20)
- [ ] Repo↔brand reconciliation if repo name ≠ shipped CLI/brand (Z/D24/INV-22)
- [ ] Provenance + attribution: Reuven Cohen/@ruvnet + repo link + live date/version/sha (Q/D12)
- [ ] Approachable favicon + og share card
- [ ] Official upstream repo + demo/Studio link featured
- [ ] Drop-in visual = annotated file-tree of real zip, **studio media (audio overview + report) listed + HIGHLIGHTED** (V/D13)
- [ ] Distinct aesthetic, not cloned (K/INV-12)

## 4 · GATE B — comprehension + felt audit  (D15-B / INV-10)
- [ ] clarity/compelling/ease ≥ bar — _scores_
- [ ] 3 FELT questions all "yes" (impress / invite / want) — _verdict_

## 5 · GATE C — consistency + drop-in dry-run  (D15-C)
- [ ] claims grounded (no invented APIs), links resolve
- [ ] PROVE-IT: drop-in unzip → `npm i` → real query → grounded answer — _proof_

## 6 · GATE E — visual assets graded  (D15-E / INV-15)
- [ ] every generated image vision-checked **≥95** — _notes_

## 7 · GATE D — NotebookLM studio — REQUIRED for "done" (D18 / INV-14)
> Sequenced AFTER the two heroes pass (doesn't block their deploy) — but the repo is NOT done without it (D15: done = A+B+C+D+E green).
- [ ] own NotebookLM notebook created + comprehension-arc sources added (`nlm notebook` / `nlm source`)
- [ ] **audio overview** generated + downloaded (`nlm audio create`) — _path_
- [ ] **report** generated (`nlm report`) — _path_
- [ ] outputs GRADED (gate D: clarity / comfort / confidence / completeness / effectiveness) — _score_
- [ ] **studio media placed IN the zip** at `for-humans/studio/` (audio overview + report + prompt) — verify with `unzip -l`
- [ ] studio **listed + HIGHLIGHTED** in the drop-in file-tree visual AND surfaced as a site studio section/CTA
- [ ] (optional) video / slides via NotebookLM UI → `nlm download` — _path, or noted as manual follow-on_

## 8 · Deploy  (D17 / X / INV-20)
- [ ] public GitHub repo `stuinfla/<site-name>`
- [ ] Vercel `<site-name>.vercel.app` --prod, Deployment Protection OFF
- [ ] PROVE-IT: `curl -sI https://<site-name>.vercel.app` → **HTTP 200**, publicly viewable

## 9 · Score + record  (I/INV-13)
- **Final score:** __/100  (≥95 acceptable under time pressure; ≥98 target)
- **Deductions (honest, with evidence):** ____
- [ ] learnings stored: `ruflo memory store -k "<repo>-build-done" -n ruv-explainer`

---

## Decisions & fixes log  (append chronologically as you go)
- _timestamp — what happened / what was fixed / why_
