<div align="center">

# explainmyrepo

### Point it at any GitHub repo. Get back an explainer a stranger — and their AI — actually understands.

**▶ See it live — the concept, the full process, and all six example explainers on one page: [explainmyrepo.isovision.ai](https://explainmyrepo.isovision.ai)**

*Complex repos deserve clear introductions. This builds them, then refuses to ship until they're good.*

</div>

<!-- DIAGRAM: hero (a dense, unreadable repo on the left transformed into a clear, art-directed explainer page on the right) -->

---

## The problem it solves

Most repositories are opaque. Open one cold and you can't quickly tell **what it is**, **why it matters**, **how it's built**, or **how to use it**. The README is usually a wall of text written by someone who already knows the answer — so it assumes you do too.

That hurts twice over now:

- **A human** lands on your repo, doesn't get it in thirty seconds, and leaves.
- **An AI** (Claude Code, Cursor) is asked about your repo and *guesses*, because it has no grounded understanding of the actual source.

A longer README doesn't fix opacity. The goal is bigger than documentation:

> Take someone from *"I've never seen this before"* to *"Oh, I get why this was created, the problem it solves, what it does, why it's elegant, how it works — and I'm ready to go implement it."*

That's the bar. `explainmyrepo` exists to clear it, on every build.

---

## What you get — three artifacts from one command

One command reads a repo and produces three things, each quality-gated:

<!-- DIAGRAM: three-outputs (one GitHub URL → a live explainer page for humans + a GitHub repo you own + a downloadable AI knowledge pack for their AI) -->

1. **A live explainer web page** — the link you share. A bespoke, art-directed walkthrough with a real architecture diagram and a real data-flow diagram drawn from the code itself.
2. **A GitHub repo you own** — you're invited as a collaborator on the explainer's own repo, so you can edit it. It's yours.
3. **A downloadable AI knowledge pack** — a drop-in `.zip` containing a vector knowledge base of the repo, a search CLI, and an MCP server, so Claude Code or Cursor answer from the **real source** instead of guessing.

---

## How it works — the process

`explainmyrepo` is not a template filler and not a doc scraper. It's a single Claude Code **skill** that holds the judgment (the *brain*) plus small, pure **tools** that do the mechanics — with one data contract flowing between them. No brittle multi-phase pipeline.

The brain runs the repo through an ordered sequence. Each step has one job:

<!-- DIAGRAM: pipeline (read → understand → conceive → author → visualize → assemble → grade ⟲ → ship) -->

1. **Read** — clone the repo and confirm it's reachable (public, private, or your own, via authenticated access).
2. **Understand** — build a real RVF vector knowledge base from the actual code: structure-aware chunks, local 384-dim embeddings (`bge-small-en-v1.5`), plus an extracted symbol index, dependency graph, and entrypoints. Then author a plain-language primer. Everything downstream is grounded in this KB — **no invented capabilities**.
3. **Conceive** — before writing a word, invent *this repo's* art direction: a visual metaphor that fits (PhotonLayer → prism, ruvn → evidence dossier, ruqu → Bloch-sphere orb), a palette, a type personality, a layout rhythm, a hero concept, and a copy voice. This is why every explainer looks different.
4. **Author** — write the copy along a **comprehension arc** — the questions a newcomer actually asks, in order: *What world am I in? Why does this exist? What does it do? Why is it clever? How is it built? Could I use it? How do I start?* Every claim is traceable to a KB passage.
5. **Visualize** — generate imagery on two tracks: emotional/illustrative images via `gpt-image-2` (hero, problem, scenario), and crisp **vector diagrams** via `ascii-to-svg` for structure. An **architecture diagram and a data-flow diagram are mandatory on every page**, drawn from the repo's *real* dependency graph and entrypoints — never invented.
6. **Assemble** — render the page **once** onto a shared design system (no incremental marker-patching), build the downloadable AI knowledge pack, and wire in SEO + social (JSON-LD, a 1200×630 social card, `llms.txt` for AI crawlers).
7. **Grade** — the quality gate. Render the real page, score it, and **refine in a loop until it clears the bar** (see below).
8. **Ship** — deploy the already-great page to its own URL (Netlify by default, provider-agnostic), create the explainer GitHub repo and invite you in, set its topics + description, and email you the scorecard, both screenshots, and every link.

---

## The quality gate — why the output is a class above

This is the part that makes the difference. A generic generator emits something and stops. `explainmyrepo` **does not ship until an independent critic and a set of operator questions both pass.**

<!-- DIAGRAM: quality-gate (render @ 390px + 1440px → vision critic scores Gate A substance + Gate B craft → 5 operator YES/NO questions → refine loop until mean ≥ 90, min axis ≥ 85, all YES → ship) -->

The gate renders the live page in a real browser at **390px (mobile)** and **1440px (desktop)**, takes full-page screenshots, and scores them on **two independent rubrics**:

- **Gate A — "Do they actually get it?"** (substance): visual effectiveness, storytelling, clueless-to-convinced, usefulness-to-*you*, completeness of the arc, and implementation confidence.
- **Gate B — "Did someone who gives a shit make this?"** (craft / anti-slop): typography, alignment, spacing, polish, and imagery craft — including whether the diagrams are genuinely explanatory.

To pass, on **both devices**, the scorecard must hit an **exemplar-anchored bar: mean ≥ 90 and minimum axis ≥ 85**. The bar is pinned to the project's own praised example sites (~88 headline / ~92 mean on an honest harsh grader) — not an impossible "95 on everything." The minimum-axis floor is the anti-slop catch: one weak axis (a raw ASCII diagram, a pretty-but-empty image) scores ~50 and fails the whole build.

On top of the numbers, the operator must answer **YES to all five questions** — a separate, independent gate:

1. Would this make me believe I understand this?
2. Would this make it approachable?
3. Would this explain it for somebody who doesn't understand it?
4. Would it give me confidence I understand the architecture?
5. Does it make me smile — "oh, that's cool"?

A single axis below the bar, or a single NO, names the exact weakness, reopens just that slot, re-renders, and re-grades. **Iterating over a few revisions is expected by design** — it's how the build climbs to genuinely high quality. Three sets of eyes see the same pixels: the vision-model critic, the operator, and finally you (the owner) on delivery. If a repo genuinely can't reach the bar, the build **says so honestly** rather than shipping slop and calling it done.

---

## One brain, three doors

The judgment lives in **one** place — a Claude Code skill. The same core is exposed through three thin adapters that each run the *identical* skill; none of them contains explainer logic of its own. Improve the brain once, and it improves everywhere.

<!-- DIAGRAM: three-doors (one skill = the brain → exposed as a Claude Code plugin · an npx CLI · a hosted website) -->

- **Claude Code plugin** — run it from inside Claude Code.
- **npx CLI** — the one-liner below.
- **Hosted website** — paste a GitHub URL in the browser.

---

## Get started

```bash
# Point it at any GitHub repo. Walk away. Get back a live page, a repo you own, and an AI pack.
npx @isovision/explainmyrepo https://github.com/owner/repo
```

**What you need:** Node 18+, a GitHub repo URL, and your own API keys (Anthropic for the authoring brain, OpenAI for `gpt-image-2` imagery).

**What happens:** it reads the repo, understands it, art-directs and writes the page, generates the imagery and the real architecture + data-flow diagrams, grades the result on mobile and desktop until it clears the bar, then deploys it.

**What you get back:** a live URL (in your terminal and by email), a GitHub repo you're a collaborator on, and the downloadable AI knowledge pack — plus the scorecard and both screenshots, so you're the final set of eyes.

> **Honest status:** the engine is built and proven. The `npx` package and the Claude Code plugin are **being published** — until that's live the one-liner above won't resolve from npm yet; today it runs as the Claude Code skill in this repo. We won't show the command as "done" until it actually installs.

---

## See a real one

The agenticow explainer below was generated end to end from [`ruvnet/agenticow`](https://github.com/ruvnet/agenticow): a captivating hero, a plain-language walkthrough, **a real architecture diagram and data-flow diagram drawn from agenticow's own code**, concrete use-cases, and a one-click AI knowledge pack.

### [Open the live agenticow explainer →](https://stuinfla.github.io/Repo-Explainer/agenticow/)

The bar these are calibrated against — five hand-built explainers, five completely different looks, same engine, same gate:

| | | |
|---|---|---|
| **PhotonLayer** — optical-AI: light computes the answer before any chip wakes up. | **ruqu** — a quantum-computing simulator in your browser (Rust + WASM). | **ruvn** — turns a question into a graded, cited evidence dossier. |
| **MetaHarness** — gives any project its own AI assistant that knows *that* project. | **Agentic QE** — replaces manual testing with a fleet of specialist AI agents. | **agenticow** — git for agent memory: copy-on-write vector branching. |

---

## Built with

| Layer | Tool |
|---|---|
| Knowledge base | RVF single-file vector DB (`@ruvector/rvf`) + `bge-small-en-v1.5` (local, 384-dim) |
| Imagery | `gpt-image-2` (illustration) + `ascii-to-svg` (architecture / flow diagrams) |
| Quality gate | Playwright dual-viewport render + vision grading (Claude by default, or any vision model you configure) |
| Hosting | Netlify by default (provider-agnostic adapter) |

The full recipe lives in [`docs/adr/0005-skill-based-explainer-recipe.md`](docs/adr/0005-skill-based-explainer-recipe.md); the domain model in [`docs/ddd/explainmyrepo-recipe-domain.md`](docs/ddd/explainmyrepo-recipe-domain.md).

---

## Credit

The tools in the examples above belong to [Reuven Cohen / @ruvnet](https://github.com/ruvnet). `explainmyrepo` is an independent project that exists to help more people — and their AIs — discover, understand, and adopt great work.

---

<div align="center">

Built by **[Stuart Kerr](https://stuart-kerr-card.netlify.app)** at **[ISOvision.ai](https://isovision.ai)**.

*Complex repos deserve clear introductions.*

</div>
