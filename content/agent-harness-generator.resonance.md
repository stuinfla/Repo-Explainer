# MetaHarness — Resonance Brief (the content standard)

> Purpose: the concrete, non-ethereal way to explain MetaHarness so a **non-technical Claude-Code user** goes "oh — *that's* what it's for." The site's hero + §01 + the lead example must be rewritten to this standard. Everything here is grounded in the real repo (no invented features).

## The one plain sentence (lead with this)
**MetaHarness gives any project its own AI assistant that actually *knows that project* — built for you in about a minute, instead of by an expert over days.**

## Translate the "meta" (kill the ethereal pitch)
The repo calls it *"a factory for agent frameworks — the model is replaceable, the harness is the product."* That's true but it means nothing to a normal person. Say it like this instead:
- An AI assistant (Claude, etc.) is a brilliant **generalist** — but out of the box it has **never seen your project**. So when you ask it to change your code, it **guesses**: invents file names, ignores your rules, sometimes touches things it shouldn't.
- The fix the pros use is to hand-build a custom "wrapper" around the AI — give it a memory of your project, the right skills, and guardrails. That's expert work most people can't do.
- **MetaHarness does that hand-building for you, automatically.** Point it at a project; a minute later you have a custom assistant tuned to *that* project, with **your** name and **your** one-line command — that you own and can hand to your whole team. The AI brain stays the same; what's new is that now it knows *your* world.

## Answer the stakes, explicitly and early
- **What does it actually do?** Turns a generic AI assistant into a specialist for *your* specific project — automatically.
- **Why do I care?** Because guessing wastes your time and breaks things. A project-aware assistant gets it right the first time.
- **Why do I need it?** Hand-building this yourself is days of expert work; forking someone else's setup freezes you out of updates. MetaHarness does it in ~60s and you still get future improvements.
- **Why is it important?** Everyone on your team can run the *same* one command and get the *same* project-smart assistant — consistent, safe, and even publishable like any package.

## THE grounding example (concrete, relatable, before→after) — use this as §01's anchor
**Maya runs a small online shop on her own codebase.** She's not a deep engineer; she uses Claude Code to make changes.
- **Before:** She asks the AI to "add a gift-card option." It doesn't know her project, so it invents file names that don't exist, ignores her rule that *all payments go through the billing service*, and even suggests editing her secret keys. She spends an hour cleaning up confident-but-wrong guesses — every time.
- **After MetaHarness:** Maya runs `npx metaharness` on her shop's repo. ~1 minute later she has **`npx maya-shop`** — an assistant that already knows every file in her store, follows "payments always go through billing," refuses to touch her keys, and remembers the project between sessions. She asks for the gift-card option again; it lands correctly the first try. She shares that one command with her two freelancers — now all three get the identical, shop-smart assistant.
- **The "oh, that's what it's for" line:** *It's the difference between an assistant that guesses about your project and one that actually knows it.*

## The collapsible gallery — varied real-world uses (each: concept • what-it-does • its own visual)
Sequence AFTER the grounding example, BEFORE "how to implement." Each is a collapsible card with its own diagram.
1. **Tame a scary unfamiliar repo.** *Concept:* you inherit a codebase you don't understand. *Does:* `npx metaharness score <repo>` reads it (never runs it) and prints a one-screen report card — how well an assistant will fit, how safe it is, rough cost per run — before you commit. *Visual:* repo → read-only scan → report card.
2. **Cut your AI bill.** *Concept:* you're overpaying for a frontier model on routine work. *Does:* the built-in router sends each task to the cheapest model that still clears your quality bar. *Visual:* task → router picks cheapest-good-enough → same result, far less spend.
3. **Give your whole team the same smart assistant.** *Concept:* everyone configures their AI differently. *Does:* publish your harness as `npx @your-org/your-bot` — one command, org-wide, versioned. *Visual:* one package → three teammates, identical assistant.
4. **Let it improve itself, safely.** *Concept:* you want it to get better without babysitting. *Does:* Darwin mode tries small tweaks in a sandbox and keeps only what measurably helps (model frozen, safety-gated). *Visual:* tweak → sandbox test → keep-if-better loop.
5. **Trust a downloaded harness.** *Concept:* someone hands you a harness zip — is it safe? *Does:* witness-signed releases + default-deny tools let you verify provenance before you run anything. *Visual:* zip → signature check → "verified" badge.
6. **Onboard your own project in a minute.** *Concept:* a new hire's AI knows nothing about your stack. *Does:* `npx metaharness .` scaffolds a project-aware assistant from your actual file layout. *Visual:* your files → generated skills/memory → ready assistant.

## §09 Drop-in visual — show the ACTUAL contents (Cognitum-style file tree)
NOT a pretty abstract two-halves. Show an annotated file tree of what's inside the zip, each file with a plain-English "what this is":
```
metaharness-kb/  (one download, two halves)
├ for-you (human) ──────────────────────────────
│  └ metaharness-primer.md   — the whole tool, in plain English
│  └ studio/ (optional)      — short video + audio overview
├ for-your-AI ──────────────────────────────────
│  ├ *-kb.big.rvf            — the "brain" (sharp, Mac/PC)
│  ├ *-kb.small.rvf          — the "brain" (light, edge)
│  ├ *.passages.jsonl        — every doc + all source, searchable
│  ├ ask-kb.mjs              — ask it from the command line
│  └ kb-mcp-server.mjs       — wire it into Claude Code / Cursor
└ README                     — what it is + the 3-step setup
```
Plus the 3 steps: **1** unzip into your project as `kb/` · **2** add the 2-line `.mcp.json` · **3** paste the `CLAUDE.md` gate → your AI now answers from the real source.

## Honest limits (state plainly, don't hide)
v0.1.x beta; `metaharness` == `create-agent-harness` (same tool); ~6 stable hosts + 3 newer; "568 tests" headline (other docs lag); **it never executes your code** — analysis is read-only.
