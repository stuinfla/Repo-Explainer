# PhotonLayer — Resonance Brief (the content standard)

> Purpose: the concrete, non-ethereal way to explain **PhotonLayer** so a **non-technical Claude-Code user** goes "oh — *that's* what it's for." The site's hero + §01 + the lead example must be written to this standard. Everything here is grounded in the real repo at `.targets/photonlayer/` (HEAD `fe86c9fad9a1572ce46e337f118656961bdf4ebb`) — no invented features. Source author: **Reuven Cohen / @ruvnet** ([github.com/ruvnet/PhotonLayer](https://github.com/ruvnet/PhotonLayer)).

## The one plain sentence (lead with this)
**PhotonLayer is a deterministic optical-AI front end: a learned piece of "smart glass" reshapes light so a tiny sensor captures the *answer* instead of the whole picture — then signs a receipt proving exactly what it measured.**

(Grounded: README.md line 5, `crates/photonlayer-core/README.md` lines 3–5: "A deterministic optical AI front end. A learned phase mask performs task-specific *analog* preprocessing on incoming light, so the sensor records a small compressed measurement and a tiny digital decoder reads the answer.")

## Translate the abstraction (kill the ethereal pitch)
The repo's sharpest line is *"The camera no longer captures the image. It captures the answer shaped by physics."* (`photonlayer-core/README.md` line 7). True, but a normal person needs it grounded:
- A normal camera records **every pixel** of a scene, then a computer reads all of them to decide what it's looking at. That's a lot of data to move, store, and process — and the picture itself can leak (it's a viewable photo of you / your scene).
- PhotonLayer **flips the order.** It puts a specially-shaped, *trained* piece of glass — a **phase mask** — in front of a small sensor. The glass bends the incoming light so that, by the time light lands on the sensor, the useful information has already been **squeezed into just a handful of numbers**. A tiny program reads those numbers and gives the answer. (README.md lines 24–28.)
- The repo's own analogy (README.md line 28): it's *like a translator who listens to a whole speech and hands you a one-line summary — you never needed the full transcript to act on it.* The "lens" is **trained by trial-and-improvement** to do that summarizing **in the light itself, before anything is digitized.**
- "Phase mask," in plain terms: a flat piece of optics whose surface is patterned so it nudges different parts of the light wave to arrive slightly early or late — and *that* pattern is what gets learned for your specific task.

**Honest framing the repo insists on:** today this is a **software simulator written in Rust** — the physics, the training, and the receipts are all real and reproducible; **building the actual glass is on the roadmap** (README.md line 37, Roadmap item 3). So when we say "smart glass," it currently means a faithful *simulation* of that glass that runs on your computer or in your browser.

## Answer the stakes, explicitly and early
- **What does it actually do?** It moves the first chunk of "figuring out what's in the picture" *into the light*, so the sensor only ever captures a tiny compressed measurement (e.g. **64 numbers instead of 1,024 pixels**), and a small program reads the answer from it. (README.md "Measured results" table: 64 sensor px vs 1024.)
- **Why do I care?** Less data captured = less to move, store, and process; the heavy lifting is done by the optics, which in real hardware is **passive** (free-space diffraction costs no compute). And because the sensor stores a *measurement, not a viewable photo*, there's measurably less of the original scene sitting around. (README.md lines 32–35.)
- **Why do I need it?** Because every camera-based AI system pays the "capture everything, then think" tax — bandwidth, power, storage, and a recoverable image of whatever it looked at. PhotonLayer is a proof-of-concept for *capture-the-answer* sensing, and it's the only one that ships with **bit-reproducible receipts** so a result is a re-runnable experiment, not a claim. (README.md "Determinism & receipts".)
- **Why is it important?** It's a working, honest, fully-open reference for a real research frontier — task-trained optics. It reproduces a genuine result (a single-layer **ceiling-break to 83.3 %**, multi-plane **88.8 %**, all at 16× compression, all deterministic, reproduced from clean in ~24–62 s) and is unusually candid about exactly what it does and doesn't prove. (README.md "Breaking the ceiling".)

## THE grounding example (concrete, relatable, before→after) — use this as §01's anchor
**Priya runs a small recycling line.** A camera over the conveyor belt has to spot which bin each item belongs in. She is not an optics engineer; she just needs the sorter to be fast, cheap, and not a privacy headache (the belt sometimes carries documents and personal items).
- **Before:** The camera grabs a **full image** of every item — thousands of pixels each — and a computer chews through all of them to decide "plastic / paper / metal / glass." That's a lot of data per second, a chunky processor, and a stored photo of *everything* that went past, including the personal stuff. It works, but it's heavy, power-hungry, and the stored pictures make her lawyer nervous.
- **After PhotonLayer:** Priya's team designs a **learned phase mask** for exactly this 4-way sort. Now the sensor captures **a few numbers per item** — a compressed *measurement* that has already been shaped to separate the four classes, and that **does not look like the item** (you can't read a document off it). A tiny decoder reads "paper" off those numbers. In the repo's own measured run, that few-pixel learned front end hits **~99 %** on a 4-class task where a random mask gets ~74 % and naïve sub-sampling loses the signal entirely (`photonlayer-core/README.md` compression-sweep table: 2×2 sensor, 64× reduction, learned **0.988** vs random 0.738). Each run also emits a **signed receipt** so she can prove to an auditor *exactly* what was measured.
- **The "oh, that's what it's for" line:** *It's the difference between a camera that photographs the scene and then thinks about it, and one where the lens already did the thinking — so all that's left to capture is the answer.*

> Note the honest hedge the repo itself demands: the high-accuracy MNIST and sweep numbers come from a **noise-free simulation with a deliberately weak decoder**, and they are a statement about *feature separability*, not "optics beat digital." A small CNN on the raw pixels still wins on raw accuracy (README.md line 103). Priya's win is **compression + privacy-by-physics + auditability**, not "more accurate than a normal camera."

## The collapsible gallery — varied real-world uses (each: situation → command → what it does → what you get)
Sequence AFTER the grounding example, BEFORE "how to implement." Each is a collapsible card with its own problem → command → mechanism → result visual. **Every command below is real and runs offline on the built-in synthetic data** (`examples/README.md`: "Every one compiles … and runs offline … none print fabricated numbers").

1. **See the compression with your own eyes.**
   *Situation:* you don't believe a few numbers can replace a picture.
   *Command:* `cargo run --release --example compression -p photonlayer-core`
   *What it does:* feeds a 64×64 image through a phase mask + propagation, bins the sensor down to a tiny grid, and renders **both** the input and the captured measurement as ASCII side-by-side.
   *What you get:* a ~64× pixel/byte reduction printed, and a sensor block that **looks nothing like the scene** (near-zero correlation) — proof the measurement is the answer, not the photo. *Visual:* big input grid → mask → tiny scrambled measurement block + reduction number.

2. **Train the glass to be good at your task.**
   *Situation:* a random mask works okay; you want it actually *good* at separating your classes.
   *Command:* `cargo run --release --example learn_mask -p photonlayer-bench`
   *What it does:* hill-climbs a phase mask on the synthetic shapes at a tiny 2×2 sensor, keeping only changes that improve task accuracy.
   *What you get:* the learned mask beats the random one (≈75 % → 100 % on the toy task) — "learning the optics genuinely helps" (README.md line 69). *Visual:* random mask → trial-and-improvement loop → learned mask, accuracy bar rising.

3. **Break the ceiling with real gradient training (the headline).**
   *Situation:* hill-climbing plateaus; you want the best a single learned plane can do.
   *Command:* `cargo run --release --example gradient_training -p photonlayer-bench`
   *What it does:* trains the same single phase mask by **analytic gradient descent through a proven adjoint** of the diffraction operator (`Propagator::backward_into`, validated by an exact-adjoint identity *and* a finite-difference grad-check).
   *What you get:* the loss curve falls and accuracy clears the hill-climb ceiling — on real MNIST this is **73 % → 83.3 %** at 16× compression, reproduced from clean in ~24 s (README.md "Breaking the ceiling"). *Visual:* loss curve dropping; bar chart random 65.4 % → hill-climb 73 % → gradient 83.3 %.

4. **Go deeper — a multi-plane optical cascade.**
   *Situation:* one learned plane is good; can stacking planes do better?
   *Command:* `cargo run --release --example multiplane_cascade -p photonlayer-bench`
   *What it does:* trains 2 phase planes with free-space propagation between them, end-to-end through the **composed** adjoint; verifies the second plane sees a genuinely *different* (decorrelated, ~0.04 correlation) field, not a redundant copy.
   *What you get:* on MNIST, 2 planes reach **88.8 %** (+5.5 pp over single-plane), still at 16× compression (README.md cascade table). *Visual:* plane 1 → propagate → plane 2, with a "fields decorrelated ✓" badge and the accuracy step-up.

5. **Probe how much the measurement leaks (privacy-by-physics, measured honestly).**
   *Situation:* you want to know whether the compressed measurement still reveals the original scene.
   *Command:* `cargo run --release --example privacy_probe -p photonlayer-bench`
   *What it does:* runs a **linear reconstruction attack** — fits a ridge-regularized linear inverse from the measurement back to the image and measures how well it reconstructs (PSNR). Identity mask (no optics) leaks heavily; optical masks leak less.
   *What you get:* identity-mask high PSNR vs optical-mask low PSNR — **plus the printed caveat** that this is a *linear lower bound, not a privacy guarantee* (a trained network would recover more). *Visual:* image → optical mask → reconstruction attempt; "linear attack fails, NOT a guarantee" banner. (Source: `examples/privacy_probe.rs` lines 1–14, 68–71.)

6. **Run the flagship consented-verification demo (with a signed receipt).**
   *Situation:* you want "same / not same person" without storing a recoverable face image.
   *Command:* `cargo run -p photonlayer-cli -- privacy-gate`
   *What it does:* does 1:1 verification on optical features (reports EER for random vs learned mask), runs the reconstruction-attack privacy score, then **builds and verifies a tamper-evident BLAKE3 receipt** and saves it to `/tmp` so you can re-verify it. (`crates/photonlayer-cli/src/main.rs` lines 234–413.)
   *What you get:* a verification result, a leakage score, and a `verify-receipt`-able JSON proving exactly what ran — with the explicit ethical boundary printed: *consented verification only, not mass surveillance.* *Visual:* two faces → optical features → "match / no-match" + a green "receipt VERIFIED" stamp.

7. **Prove a result wasn't tampered with.**
   *Situation:* you (or an auditor) need to trust that a reported result is exactly the run that produced it.
   *Command:* `cargo run --release --example receipt -p photonlayer-core` (then `cargo run -p photonlayer-cli -- verify-receipt <path.json>`)
   *What it does:* builds a receipt that hashes every output-determining input (image, mask, config, output frame, metrics, build provenance) into one anti-swap digest, verifies it **PASSES**, then flips a single byte and shows verification **FAILS**.
   *What you get:* a concrete "PASS → tamper → FAIL" demonstration that the receipt detects any change. *Visual:* receipt with green PASS → one field edited red → FAIL. (`examples/receipt.rs`.)

8. **Watch the physics: how light spreads as it travels.**
   *Situation:* you want to understand what "propagation" actually means before trusting the rest.
   *Command:* `cargo run --release --example propagation_modes -p photonlayer-core`
   *What it does:* propagates a single bright pixel under the three real diffraction models the simulator supports — **Fresnel** (near-field), **Fraunhofer** (far-field), and **Angular-Spectrum** — and shows the spread growing with distance.
   *What you get:* real diffraction physics you can see, confirming the simulator isn't faking it. *Visual:* one bright dot → three different spreads labeled Fresnel / Fraunhofer / Angular-Spectrum. (`config.rs` `PropagationMode`; `examples/README.md` Intermediate row.)

## §Drop-in / "how do I actually use it" — show the ACTUAL contents
PhotonLayer is **Rust crates**, not a zip-of-models, so the drop-in visual should be an annotated map of the **four real crates** (from README.md "Crates" table and `Cargo.toml`), each with a plain-English "what this is":

```
PhotonLayer  (one Rust workspace, four crates)
├ photonlayer-core   — the optical simulator: scalar diffraction (Fresnel/
│                       Fraunhofer/angular-spectrum), deterministic FFT, phase
│                       mask, sensor, metrics, signed receipts   ← the heart
├ photonlayer-bench  — the experiments: learned-vs-random masks, the real-MNIST
│                       compression benchmark, gradient + cascade training,
│                       privacy probe                            ← the proof
├ photonlayer-wasm   — browser build: run the whole thing in your browser, no install
└ photonlayer-cli    — command-line driver: bench / barcode / edge / privacy-gate /
                        verify-receipt                           ← the easy front door
```

**Three ways to start (all real, all in README.md):**
1. **No install — try it in your browser:** open the [live demo](https://ruvnet.github.io/PhotonLayer/) (runs entirely via WASM — shape light through a mask, watch it compress, verify the receipt). (README.md line 14–16.)
2. **30-line local tour:** `cargo run --release --example hello_optics -p photonlayer-core` → prints a deterministic frame hash and shows a re-run is bit-identical. (README.md line 41.)
3. **Use it in your own Rust project:** `cargo add photonlayer-core`, then `ScalarSimulator.simulate(&img, &mask, &cfg)` — re-running yields a bit-identical `frame_hash`. (README.md Quickstart, lines 124–142.)

## 'Why this vs what I already have' differentiation
A reader may already use a normal camera + a CNN, or an "optical neural network" they've read about. Answer head-on:
- **vs a normal camera + AI:** a normal camera captures the *whole scene* then computes; PhotonLayer's whole point is to capture *far less* by doing the first transform **in the optics**, and to store a measurement that **need not look like the scene**. The repo is explicit: "sees enough to decide, but captures far less than a full image" (README.md line 55).
- **vs "an optical neural network":** the repo deliberately positions itself as **NOT** that. Its wedge is *"auditable optical compression for task-useful sensing"* — narrower and "far more defensible" (`photonlayer-core/README.md` lines 15–24, README.md "The wedge"). Multi-layer 97–99 % diffractive networks are **explicitly out of scope** (README.md line 114). So it's not competing on raw accuracy; it competes on **compression + privacy-by-physics + determinism/receipts.**
- **The one thing nothing else here gives you:** **bit-reproducible, signed receipts.** Every run hashes its inputs/outputs into a tamper-evident digest, so a result is a re-runnable experiment, not a screenshot (README.md "Determinism & receipts"). That's the stated *moat*.

## Honest limits (state plainly, don't hide — the repo is unusually candid)
All of these are the repo's own words; do not soften them.
- **It's a simulator, not hardware (yet).** "Today this is a software simulator written in Rust … building the actual glass is on the roadmap." Real hardware is expected to **degrade** the numbers (README.md line 37; Honest-scope line 118).
- **Not a new accuracy state-of-the-art.** A single task-trained optical layer + tiny decoder = *competitive single-layer optical compression*, **not** SOTA. The +7.9 pp vs the full-image baseline is feature-separability under a *deliberately weak* nearest-centroid decoder; a small CNN on the same raw pixels reaches ~99 % and beats both (README.md lines 103, 114).
- **No privacy or security guarantee.** It stores a *learned measurement, not the raw image* — "a description, not a theorem." The bundled probe measures **linear** invertibility only; nonlinear (CNN/U-Net) reconstruction is *expected to succeed*. Never read it as "cannot be reconstructed," "privacy-preserving," or "zero-knowledge" (README.md line 116; `privacy_probe.rs` lines 11–14).
- **The "16× MAC reduction" counts the *digital decoder* only** (640 vs 10,240). The optical FFT-scale transform is passive in real hardware but **not free in this simulator** and is not counted (README.md line 117).
- **All accuracy figures are noise-free scalar-diffraction simulation with continuous phase.** Robustness to phase **quantization**, sensor **noise**, and **fabrication error** is not yet characterized (a quantization/SNR ablation is roadmap). The simulator *can* model shot/read noise + quantization (`DetectorConfig`), but the headline numbers don't (README.md line 118; `config.rs` lines 23–32).
- **Determinism is verified within runs/builds on x86-64, not yet proven cross-platform.** Full Linux/macOS/WASM bit-identity is a **design goal, not yet proven** — the open obstacle is platform `libm` transcendentals (`sin`/`cos`/`atan2`) differing by a ULP (README.md "Determinism & receipts", lines 120–122).
- **MNIST data isn't bundled.** The real-data runs need you to fetch the IDX files into `crates/photonlayer-bench/data/mnist/` first; without them the examples **skip cleanly** (never panic) and run on synthetic data (README.md line 167; `examples/README.md` lines 47–55).

---

### Provenance (mandatory on the page)
- **Author:** Reuven Cohen / **@ruvnet** · **License:** MIT © Ruvector.
- **Source:** <https://github.com/ruvnet/PhotonLayer> · **Live demo:** <https://ruvnet.github.io/PhotonLayer/>
- **Primer built from HEAD:** `fe86c9fad9a1572ce46e337f118656961bdf4ebb` — show a live updated-date + this sha so a visitor can tell whether it's current.
- **Design refs cited in-repo:** ADR-260 / ADR-261 (core), ADR-263 (FiberGate roadmap). Academic anchors: Wirth-Singh et al. arXiv:2406.06534; Bezzam et al. arXiv:2206.01429; Lin et al. *Science* 361:1004 (2018); Li/Ozcan arXiv:1906.03417.
