<div align="center">

# Repo Explainer

### Great technology deserves a great first impression.

*You built something powerful. Now let people actually understand it.*

![Cinematic showcase of explainer pages floating above code — the project's metaphor: take something dense and technical, and turn it into something anyone can understand.](assets/img/hero-showcase.png)

**[Create your explainer →](https://repo-explainer-six.vercel.app)**&ensp;·&ensp;**[See live examples ↓](#-live-explainers)**

</div>

---

## The problem: brilliant tools, invisible impact

You poured months into something genuinely useful. You shipped it to GitHub. And then... silence. A developer lands on your repo, scans the README, hits a wall of jargon, and quietly closes the tab. Not because your tool isn't good — but because the *introduction* isn't.

The truth is, most GitHub repos are written by people who already understand the project, for people who already understand the project. That leaves out the vast majority of potential users — the people who *would* love your tool if they could just see what it does and imagine themselves using it.

## The solution: a visual explainer that opens the door

**Repo Explainer turns any GitHub repository into a polished, visual explainer page** — the kind of introduction that makes a newcomer think *"oh, I get it — and I want to try this."*

Instead of a wall of text, your project gets:

- A **captivating hero image** and a one-sentence pitch that hooks curiosity
- A **plain-language walkthrough** that answers the questions people actually ask: *What is this? Why would I want it? How do I start?*
- **Architecture diagrams and illustrations** that make complex systems feel approachable
- A **relatable before-and-after story** — a real persona who goes from confused to confident
- **Concrete use-cases** so people can see themselves in the story

The result is a standalone website that lives at its own URL, looks professional, and gives your project the introduction it deserves.

> **Think of it this way:** your README is the technical reference. Your explainer is the welcome mat.

---

## Why this matters

Technology adoption isn't just about capability — it's about **confidence**. When someone encounters a new tool, they're asking themselves a series of quiet questions:

- *Is this for me?*
- *Can I actually use this?*
- *What does it look like when it works?*
- *Will I be lost if I try?*

A great explainer answers all of these in under three minutes. It bridges the gap between "this looks interesting" and "I'm going to try this today." That's the difference between a repo with 12 stars and a project with a growing community.

**Visual presentation isn't vanity — it's accessibility.** When your project looks polished and approachable, you're telling people: *"We thought about you. We want you here. You can do this."*

---

## How it works

Paste a GitHub URL. That's it.

The pipeline reads your entire repository — code, docs, structure — and produces a complete explainer page automatically. No templates to fill out, no design skills needed, no content to write.

> **Paste a URL → the pipeline clones your repo, builds a knowledge base, authors a visual explainer, generates images, runs quality checks, and deploys it — all in about 6 minutes.**

![The automated build pipeline: user pastes a URL, Vercel validates and dispatches to GitHub Actions, which runs 9 phases and updates a status gist that the client polls in real time.](assets/img/build-pipeline-flow.svg)

<details>
<summary>What happens behind the scenes (9 phases)</summary>

| Phase | What it does | Time |
|-------|-------------|------|
| **P0** Setup | Prepare the build environment | ~30s |
| **P1** Clone | Download your repo's code and docs | ~10s |
| **P2** Knowledge base | Embed your code into a searchable vector database | ~60s |
| **P3** Scaffold | Create the explainer site structure | ~10s |
| **P4** Author | Write 7 sections of plain-language content | ~90s |
| **P5** Images | Generate hero image and section illustrations | ~60s |
| **P6** Quality gates | Check accuracy, completeness, and visual quality | ~60s |
| **P7** Publish | Create a GitHub repo and invite you as a collaborator | ~20s |
| **P8** Deploy | Launch your live site at `{repo}.repoexplainer.isovision.ai` | ~30s |
| **P9** Notify | Send you an email when it's ready | ~5s |

</details>

You watch the progress in real time. Every step updates live. If anything goes wrong, you'll know immediately — the pipeline never fails silently.

### What you get back

When the pipeline finishes, you have:

1. **A live website** at `yourproject.repoexplainer.isovision.ai` — ready to share
2. **A GitHub repo** (`stuinfla/yourproject-explainer`) — you're invited as a collaborator with push access, so you own it
3. **An email notification** with links to everything
4. **A PR on your original repo's README** — adds a badge linking to the explainer, which you can merge or skip

Everything is yours. No vendor lock-in, no subscriptions, no dependencies on this pipeline. The explainer is a self-contained site you can modify, fork, or host anywhere.

---

## What the visual layer adds

The difference between a README and an explainer isn't just words — it's *design*. Here's what the visual treatment does:

| README approach | Explainer approach |
|---|---|
| Starts with installation instructions | Starts with a compelling image and a one-liner about *why* |
| Lists features in bullet points | Tells a story: here's someone like you, here's their problem, here's how this solved it |
| Shows a code snippet | Shows an architecture diagram *and* a friendly illustration — meets both technical and non-technical readers |
| Assumes you already care | Earns your attention in the first 10 seconds |
| Text-only | Hero images, section illustrations, visual hierarchy that guides the eye |

The visual layer isn't decoration. It's the thing that makes someone stop scrolling and actually *read*.

---

## 🖼️ Live explainers

Five live explainers — each one a real project, automatically transformed. Click any card to see it in action.

### MetaHarness

[![MetaHarness explainer page screenshot](assets/img/screenshots/metaharness.png)](https://metaharness-explainer.vercel.app)

> **Gives any project its own AI assistant that actually knows *that* project — built in about a minute.** An AI assistant is a brilliant generalist, but out of the box it's never seen your code. MetaHarness hands your AI a memory of your project, the right skills, and guardrails — automatically.

[Live explainer](https://metaharness-explainer.vercel.app) · [Explainer repo](https://github.com/stuinfla/metaharness-explainer) · [Source repo](https://github.com/ruvnet/agent-harness-generator) · [Reuven Cohen](https://github.com/ruvnet)

### PhotonLayer

[![PhotonLayer explainer page screenshot](assets/img/screenshots/photonlayer.png)](https://photonlayer-explainer.vercel.app)

> **A deterministic optical-AI front end: a learned phase mask shapes light so a tiny sensor captures the *answer*, not the picture.** The optics themselves do part of the computation — at the speed of light, before any chip wakes up.

[Live explainer](https://photonlayer-explainer.vercel.app) · [Explainer repo](https://github.com/stuinfla/photonlayer-explainer) · [Source repo](https://github.com/ruvnet/PhotonLayer) · [Reuven Cohen](https://github.com/ruvnet)

### ruqu

[![ruqu explainer page screenshot](assets/img/screenshots/ruqu.png)](https://ruqu-explainer.vercel.app)

> **A fast quantum-computing simulator in Rust + WebAssembly — build and run quantum algorithms with no quantum hardware, right in your browser.**

[Live explainer](https://ruqu-explainer.vercel.app) · [Explainer repo](https://github.com/stuinfla/ruqu-explainer) · [Source repo](https://github.com/ruvnet/ruqu) · [Reuven Cohen](https://github.com/ruvnet)

### ruvn

[![ruvn explainer page screenshot](assets/img/screenshots/ruvn.png)](https://ruvn-explainer.vercel.app)

> **An AI research engine that turns a question into a graded, cited evidence dossier.** Instead of one confident paragraph, you get a structured report with sources gathered, weighed, and graded.

[Live explainer](https://ruvn-explainer.vercel.app) · [Explainer repo](https://github.com/stuinfla/ruvn-explainer) · [Source repo](https://github.com/ruvnet/ruvn) · [Reuven Cohen](https://github.com/ruvnet)

### Agentic QE

[![Agentic QE explainer page screenshot](assets/img/screenshots/agentic-qe.png)](https://agentic-qe-explainer.vercel.app)

> **A framework that replaces manual software testing with a fleet of AI agents — each one a specialist in a different kind of quality check.** Ship faster, catch more bugs, without a QA team bottleneck.

[Live explainer](https://agentic-qe-explainer.vercel.app) · [Explainer repo](https://github.com/stuinfla/agentic-qe-explainer) · [Source repo](https://github.com/ruvnet/agentic-qe) · [Reuven Cohen](https://github.com/ruvnet)

---

## Quality you can trust

Every explainer passes through **5 automated quality gates** before it goes live. The pipeline doesn't just generate content — it evaluates its own output and only ships when every gate clears.

![The 5-gate quality system: gates A through E, each scoring at least 95.](assets/img/five-gates.svg)

| Gate | What it checks | The bar |
|---|---|---|
| **A — Knowledge base** | Can the vector DB answer real questions about the repo accurately? | Score >= 95 |
| **B — Comprehension** | Would a newcomer walk away thinking *"I get it and I want this"*? | Yes on all 3 checks |
| **C — Consistency** | Are all claims grounded in source? Do all links work? | Pass / fail |
| **D — Studio media** | Is the audio overview clear, confident, and complete? | Score >= 95 |
| **E — Visuals** | Does every section have both a friendly illustration *and* an accurate diagram? | Score >= 95 |

The headline quality score is always the **lowest gate**. An explainer is only as strong as its weakest section.

---

## The smart zip — so your AI gets it too

Every explainer also produces a **drop-in knowledge pack** for AI assistants. It has two halves:

![One download, two halves: an explainer website for humans on the left, and a drop-in smart zip for your AI on the right.](assets/img/dual-hero-output.png)

- **`for-humans/`** — the written primer, audio overview, infographic, and deep-dive report
- **`for-ai/`** — a vector knowledge base of the repo's code and docs, plus a search tool and MCP server

Wire the `for-ai/` half into Claude Code or Cursor, and your AI answers from the **real source** instead of guessing. No more hallucinated APIs or invented function signatures.

---

## Built with

| Layer | Tool | Why |
|---|---|---|
| **Website** | Vanilla HTML/CSS/JS on Vercel | Zero dependencies, instant load, works everywhere |
| **API** | Vercel Serverless Functions | Auto-scaling, same repo as the site |
| **Pipeline** | GitHub Actions | Free compute, runs in the cloud, no server to manage |
| **Progress** | GitHub Gists (public JSON) | No database needed, updated by each pipeline phase |
| **Knowledge base** | RVF single-file HNSW vector DB | One file, zero Docker, drops into any project |
| **Embeddings** | `bge-small-en-v1.5` (384-dim, local) | Strong retrieval, runs on a laptop |
| **Studio media** | Google NotebookLM | Audio overview and report that teach a true beginner |
| **Images** | OpenAI gpt-image-1 | Hero images and section illustrations |
| **Email** | Resend API | Notification when your explainer is ready |

---

## Credit

The projects showcased in the gallery above belong to [Reuven Cohen / @ruvnet](https://github.com/ruvnet). All credit for MetaHarness, PhotonLayer, ruqu, ruvn, and Agentic QE is his. Repo Explainer is an independent project that exists to help more people discover, understand, and adopt great open-source work.

---

<div align="center">

**[Create your explainer →](https://repo-explainer-six.vercel.app)**

*Great technology deserves a great first impression.*

**[Repo Explainer](https://repo-explainer-six.vercel.app)** · [GitHub](https://github.com/stuinfla/Repo-Explainer)

</div>
