# ruvn Audio Overview — Optimized Prompt

**Notebook:** ruvn — Explainer
**Notebook ID:** 7d3e90bf-5bb7-4b78-9770-6e2c92bf5da0
**Audio Artifact ID:** a54b759f-cb41-4cda-914f-14fe7b24c2a3
**Format:** deep_dive · Length: default
**Audience:** Non-technical person who already uses Claude Code (comfortable with npm, not a developer)

## Focus Prompt Used

Open with the felt problem a normal person actually has: when you ask an AI chatbot to "research"
something, it blends a real 2024 study and a random forum post into ONE confident paragraph, with no
labels — so you cannot tell what to trust or cite. That confident-but-unsourced answer is the trap.
Define ruvn in one plain sentence: ruvn is a research assistant that turns your question into a
graded, cited evidence dossier — it grades every source A, B, C, or D, writes its answer using ONLY
the trustworthy A and B sources, tries to prove itself wrong, and hands you a report where every
single claim has a citation. Then walk Dr. Priya, a wellness-studio owner who is NOT a scientist:
before ruvn she asks her AI "does 40 Hz light therapy help sleep?" and gets one smooth paragraph she
cannot stand behind; after ruvn she gets a TL;DR, a cited body, and a graded bibliography she can
actually show a client. Explain the six helpers in a line — scout, web-searcher, source-grader,
synthesizer, fact-checker, citer — and the key trick: each helper only sees what the one before it
produced, so good information is FORCED through a grading gate and a fact-checking gate before it
reaches you. Make clear ruvn adds no model of its own — it rides inside the AI you already use
(Claude Code, Codex, and seven more hosts). Be honest: it is early beta v0.1.1, a research tool that
grades and cites evidence, not medical advice. Close with the exact first command:
npm i -g @ruvnet/ruvn, then ruvn init. Tone: warm, confident, plain-language, zero undefined jargon.
Audience: a non-technical person who already uses Claude Code but is not a developer.

## Prompt Design Rationale (D18 — tuned for clarity / understanding / intention / education / comfort / confidence)

1. **Opens with the felt problem** — "one confident paragraph blending a study and a forum post" is
   the visceral, jargon-free pain a non-technical person recognizes immediately.
2. **One-sentence definition** — "turns your question into a graded, cited evidence dossier" uses
   only words the audience already knows; the A/B/C/D grading is stated as letter grades, not theory.
3. **Dr. Priya before→after** — the canonical resonance persona (a non-scientist wellness-studio
   owner); makes the abstraction tangible and emotionally grounded.
4. **The structural trick named plainly** — "each helper only sees the one before it" is the single
   idea that explains *why* ruvn's output is trustworthy, said without pipeline jargon.
5. **Honest scope** — "early beta, research tool, not medical advice" keeps the audio truthful
   (constraint P / honest-limits), so a listener trusts the rest.
6. **Ends with the exact command** — `npm i -g @ruvnet/ruvn` then `ruvn init` removes any ambiguity
   about what to do next.
7. **Tone guidance** — "warm, confident, zero undefined jargon" keeps the two hosts out of tech-speak.

## Source Files (NotebookLM source IDs)

- `kb/stores/ruvn/ruvn-primer.md` — top-down 7-stage primer (ID: 58a634db-0072-465e-b4e6-f687ea737b98)
- `.targets/ruvn/README.md` — upstream README (ID: 3aa5300c-33fb-4b21-83bc-a476b404793c)
- `.targets/ruvn/CLAUDE.md` — pipeline + grading rubric (ID: 1760d6dc-7af9-474e-a72e-bb5843631b00)
