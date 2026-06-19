# MetaHarness Audio Overview — Optimized Prompt

**Notebook:** MetaHarness — Explainer  
**Notebook ID:** 3cc18f99-ef82-457d-bd80-686238d0685a  
**Artifact ID:** 17496280-86f0-40f2-a713-5939924ed24a  
**Format:** deep_dive | Length: default  
**Audience:** Non-technical Claude Code user (comfortable with npm, not a framework author)

## Focus Prompt Used

Open with the felt problem: when you ask a generic AI assistant to change your code, it guesses — invents file names, ignores your project rules, sometimes touches things it shouldn't. Define "harness" in one plain sentence: a harness is a lightweight wrapper around the AI that gives it your project's memory, skills, and guardrails. Then walk Maya's before-and-after: before MetaHarness she spends an hour cleaning up wrong guesses every time; after running npx metaharness on her shop's repo she has npx maya-shop — a project-aware assistant that gets it right the first try and that she can share with her whole team. Close with the exact first command to try right now: npx metaharness. Tone: warm, confident, zero undefined jargon. Audience: a non-technical Claude Code user comfortable with npm.

## Prompt Design Rationale

1. **Opens with the felt problem** — "it guesses" is the visceral pain point non-technical users recognize immediately; no jargon required.
2. **One-sentence harness definition** — "a wrapper that gives the AI your project's memory, skills, and guardrails" uses only words the audience already knows.
3. **Maya before→after** — concrete character example from the resonance brief; makes the abstract tangible and emotionally grounded.
4. **Ends with exact first command** — `npx metaharness` removes all ambiguity about what to do next.
5. **Tone guidance** — "warm, confident, zero undefined jargon" prevents the hosts from slipping into tech-speak.

## Source Files

- content/agent-harness-generator.canon.md (Source ID: 15cab96b-5192-40ac-b59b-cd177b0fbed7)
- content/agent-harness-generator.resonance.md (Source ID: 978badc7-e54a-425f-b62d-1f33a28224a8)
- .targets/agent-harness-generator/README.md (Source ID: f1001fb8-04c4-4aaa-88e8-e08a5711f53d)
