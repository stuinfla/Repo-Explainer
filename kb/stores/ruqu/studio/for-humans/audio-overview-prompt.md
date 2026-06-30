# ruqu Audio Overview — Optimized Prompt

**Notebook:** ruqu — Explainer
**Notebook ID:** 994580f7-b28d-4c02-9346-8829220af63a
**Audio Artifact ID:** ce8b045a-0ecf-4411-bb35-6397cd83bbac
**Report Artifact ID:** a63a133b-7bc2-4db4-b239-f4b68e299257
**Format:** deep_dive | Length: default
**Audience:** A curious developer or student, comfortable with npm, who is NOT a quantum physicist.

## Focus Prompt Used

Open with the felt problem: a teacher (Aisha) wants to demo a real quantum "Bell state" to her
class but has no quantum computer, and installing heavy Python quantum toolkits fails on classroom
laptops. Then define the core idea in one plain sentence: ruqu is a pretend quantum computer written
in pure Rust that runs on a normal laptop or right inside a browser tab, so you can build and test
real quantum algorithms with NO quantum hardware. Explain a qubit simply (a bit that can be a blend
of 0 and 1 until you look). Name the three things ruqu gives you in plain words: (1) a state-vector
simulator (the imitation quantum computer itself, exact answers up to ~25 qubits in a browser, ~32
in Rust), (2) ready-made quantum algorithms you just call (VQE for chemistry, Grover for fast
search, QAOA for optimization, surface-code error correction), and (3) ruv's original "coherence
engine" that watches a quantum machine in real time and says PERMIT / DEFER / DENY before each step.
Contrast with heavy Python stacks (Qiskit/Cirq): ruqu is tiny, fast, pure Rust to WebAssembly, no
Python, runs where Python can't. Be honest: it is a SIMULATOR, not real quantum hardware; qubit
counts are capped because cost doubles per qubit. End with the exact first command to try right now:
`npx @ruvector/ruqu simulate --qubits 2`. Tone: warm, vivid, zero undefined jargon.

## Prompt Design Rationale

1. **Opens with a felt, concrete scenario** (Aisha + the failed Python install) — the audience feels
   the pain instantly, no jargon required. This is the resonance canon's grounding example.
2. **One-sentence plain definition** — "a pretend quantum computer that runs on your normal laptop"
   collapses the ethereal "quantum execution intelligence engine" into words anyone understands.
3. **Defines "qubit" inline** — the single most important term, in one friendly clause.
4. **Names the three deliverables in plain words** — simulator / ready-made algorithms / coherence
   engine — so the listener leaves knowing exactly what they get.
5. **Differentiation built in** (vs Qiskit/Cirq Python) — answers "why this and not what I have."
6. **Honesty baked in** (it's a simulator, qubit ceilings are real) — never oversells.
7. **Ends with the exact first command** — `npx @ruvector/ruqu simulate --qubits 2` — removes all
   ambiguity about what to do next.
8. **Tone + audience pinned** — "warm, vivid, zero undefined jargon … not a quantum physicist" keeps
   the hosts out of tech-speak.

## Source Files (added to the notebook)

- `content/ruqu.canon.md` — Resonance Canon (grounded content standard) · Source ID 3ac41182-5c86-4e8a-89fd-66028eaf4251
- `kb/stores/ruqu/ruqu-primer.md` — Top-Down Primer (7-arc comprehension) · Source ID ee68cd7d-8127-4cc7-8be9-d458e29018d0
- `.targets/ruqu/README.md` — upstream README @026d63ef · Source ID a58b3648-2c95-45ef-ada5-eba7db556143

Provenance: content grounded in the ruqu repo at HEAD `026d63ef900ab689c863b6b3254f5dce8c068bf6`.
Author of ruqu: Reuven Cohen / @ruvnet · <https://github.com/ruvnet/ruqu>.
