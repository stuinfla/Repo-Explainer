# PhotonLayer Audio Overview — Optimized Prompt

**Notebook:** PhotonLayer — Explainer
**Notebook ID:** d97351e0-542f-4c80-9e56-19cb1dca04f5
**Audio Artifact ID:** 7f9510fb-3273-4aea-ac61-894513f37a1f
**Report Artifact ID:** 6ed11d55-5365-4b52-a69b-b6ddaf4b87d0
**Format:** deep_dive | Length: default
**Audience:** Non-technical Claude Code user (comfortable with the terminal, not an optics/ML engineer)

## Focus Prompt Used

Open with the felt problem: every camera-based AI captures a full photo of everything it sees, then a computer chews through every pixel to decide what it is — heavy on power, storage, and bandwidth, and it leaves a viewable picture of whatever (or whoever) it looked at sitting around. Define the idea in one plain sentence: PhotonLayer is a deterministic optical-AI front end — a learned piece of smart glass (a phase mask) reshapes incoming light so a tiny sensor captures the answer instead of the whole picture, then signs a receipt proving exactly what it measured. Use the translator analogy: the glass listens to the whole scene and hands the sensor a one-line summary. Then walk Priya, who runs a small recycling line: before PhotonLayer her belt camera grabs a full image of every item and a chunky computer sorts plastic/paper/metal/glass while storing photos of everything including personal documents; after PhotonLayer a learned phase mask squeezes each item into a few numbers that do not look like the item, a tiny decoder reads "paper", and a signed receipt proves what was measured — in the repo's own run a few-pixel learned front end hits about 99 percent where a random mask gets about 74 percent. Be scrupulously honest: today this is a reproducible Rust SIMULATOR, not real glass yet (hardware is on the roadmap); the high accuracy numbers are noise-free simulation with a deliberately weak decoder and are a statement about feature separability, not optics beating digital — a small CNN on raw pixels still wins on raw accuracy. Priya's real win is compression plus privacy-by-physics plus auditability. Close with the exact way to try it right now: open the live browser demo, or run `cargo run --release --example hello_optics -p photonlayer-core`. Tone: warm, confident, zero undefined jargon; define phase mask, propagation, and receipt in plain words the first time each appears.

## Prompt Design Rationale

1. **Opens with the felt problem** — "captures a full photo of everything, then chews through every pixel" is the visceral cost (power, storage, a recoverable picture) a non-technical listener feels immediately.
2. **One-sentence definition** — "smart glass that reshapes light so the sensor captures the answer, not the picture, and signs a receipt" uses only everyday words.
3. **Translator analogy** — the repo's own analogy (a translator handing you a one-line summary) makes "analog preprocessing in the light" tangible.
4. **Priya before→after** — the canonical resonance persona; grounds the abstraction in a real recycling-line story with measured numbers (99% learned vs 74% random).
5. **Honest hedges baked in** — simulator-not-hardware, feature-separability-not-optics-beat-digital, privacy-by-physics-not-zero-knowledge — so the audio cannot overclaim (global Rule 9 honesty).
6. **Ends with the exact first step** — live browser demo or one `cargo run` command — removes all ambiguity about what to do next.

## Source Files

- content/photonlayer.canon.md (Source ID: 44365632-be50-4752-9081-7a08572fed44) — the resonance brief / content standard
- kb/stores/photonlayer/photonlayer-primer.md (Source ID: ec57e160-cb3d-432c-9328-ac681817f11b) — the 7-stage comprehension-arc primer
- .targets/photonlayer/README.md (Source ID: 2c40fe35-b32c-45d3-9a4d-e6067e125b24) — upstream README (ruvnet)
