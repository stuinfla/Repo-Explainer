# PhotonLayer — the primer

> A plain-English, top-down orientation to **PhotonLayer** by Reuven Cohen (@ruvnet).
> Source repo: github.com/ruvnet/PhotonLayer @ fe86c9f. Everything here is grounded in the
> repo's own README, crate docs, and Rust source — no invented features. Read this once and you
> can answer: what it is, what it does, what it's made of, how it works, how grown-up it is,
> where to read more, and how to run it yourself.

## 1. What is PhotonLayer?

**PhotonLayer is a deterministic optical-AI _front end_, written in pure Rust.** A normal camera
records every pixel of a scene, then a computer reads all of them to decide what it is looking at.
PhotonLayer flips that around: it puts a specially-shaped piece of "smart glass" — a **phase mask** —
in front of a small sensor. The mask bends the incoming light so that, by the time the light reaches
the sensor, the task-useful information has been squeezed into just a handful of numbers. A tiny
program reads those numbers and produces the answer.

Think of it as a translator who listens to a whole speech and hands you a one-line summary — you
never needed the full transcript to act on it. The "lens" is **trained** (by trial and improvement,
or by gradient descent) to do that summarizing **in the light itself, before anything is digitized**.

The precise wording from the repo: *"a learned phase mask compresses light into a tiny sensor
measurement, and a small digital decoder reads the answer — with a signed, reproducible receipt of
exactly what was measured."* In one line in `photonlayer-core`'s own module docs (lib.rs): *light
performs the first trained transformation; a smaller digital backend reads the result.*

**It is deliberately NOT "an optical neural network."** The repo frames it more narrowly and more
defensibly as **auditable optical compression for task-useful sensing**:
`scene → trained optical transform → tiny sensor measurement → small decoder → decision (+ receipt)`.
The measurement need not look like the scene.

**Honest framing up front:** today PhotonLayer is a **software simulator** — the physics, the
training, and the receipts are all real, reproducible, and run offline; building the actual physical
glass is on the roadmap. You can try it in your browser right now via the live WASM demo, or run a
30-line tour locally.

## 2. What can PhotonLayer do?

Four things, all measured (the repo never prints a fabricated number):

- **Compress capture.** A learned mask reaches near-full accuracy with a tiny sensor. On a synthetic
  4-class task at a 2×2 sensor (**64× fewer pixels**), the learned mask hits ~0.99 where a random
  mask gets ~0.74 — learning the optics genuinely preserves task-useful information that random
  projection loses. On real MNIST it compresses a 16×16-style input to **64 sensor pixels (16×
  fewer)** and a tiny 640-parameter decoder, for a small accuracy cost vs a full-image baseline.
- **Break the optimizer ceiling with gradient training.** Hill-climbing a single mask plateaus
  around 73%. Training the *same* mask by **analytic gradient descent** — through a proven adjoint of
  the diffraction operator (validated by an exact-adjoint identity *and* a finite-difference
  grad-check) — reaches **83.30%** at 16× compression (+10.25 pp), reproduced from clean in ~24 s.
- **Go deeper with a multi-plane cascade.** Several phase planes with free-space propagation between
  them, trained end-to-end by the *composed* adjoint, climb further at the same 16× compression:
  **2 planes → 88.80%**, 3 planes → 89.80% (each plane sees a genuinely decorrelated field). The
  2-plane 88.80% is the robust headline; the 3-plane is real but more init-sensitive, so it's
  reported, not over-asserted.
- **Prove what happened.** Every run emits a **BLAKE3 receipt** binding the model hash, config,
  measurement, and decision, so a result is a *reproducible experiment*, not just a claim. The
  `receipt` example builds a receipt, verifies it passes, tampers one field, and shows it fails.

It also includes side demos the front end enables: optical edge detection, a barcode
encode/decode, a wavefront-focusing "learned lens," a differential-detection (I⁺−I⁻) readout lever,
and a linear privacy-reconstruction probe (a lower bound, explicitly not a guarantee).

## 3. What is PhotonLayer made of — the four crates

PhotonLayer is a Rust workspace of **four crates**:

- **`photonlayer-core`** — the optical simulator: scalar diffraction (Fresnel / Fraunhofer /
  angular-spectrum), a deterministic in-house FFT, the phase mask, the sensor/detector, metrics, and
  BLAKE3 receipts. Dependency-light (`serde`, `blake3`, `thiserror`). This crate owns the optical
  half. Its `prelude` re-exports the everyday types: `Complex`, `OpticalConfig`, `PropagationMode`,
  `OpticalFrame`, `InputImage`, `OpticalField`, `PhaseMask`, `ScalarSimulator`.
- **`photonlayer-bench`** — the benchmarks and training: the synthetic compression sweep and the
  real-MNIST optical-compression benchmark, plus the differential-detection ablation, hill-climb and
  gradient training, the multi-plane cascade, the decoder, and the privacy probe.
- **`photonlayer-wasm`** — WebAssembly bindings that power the in-browser playground (the live demo
  runs entirely client-side; no server, no mocked output).
- **`photonlayer-cli`** — the command-line driver: subcommands for `bench`, `barcode`, `edge`,
  `privacy-gate`, and `verify-receipt`.

The hot path is hyper-optimized and proven: a cached, in-place `Propagator` plus a
checkerboard-fftshift fold and precomputed FFT twiddle tables give a measured ~2.0× speedup, fully
deterministic.

## 4. How the optical pipeline works, step by step

The core pipeline (from `photonlayer-core`'s own module docs) is a clean five-stage chain:

```
input image
  → scalar optical field        (field)
  → learned phase mask           (mask)
  → diffraction propagation      (propagate)
  → sensor intensity frame       (detector)
  → metrics + BLAKE3 receipt     (metrics, receipt)
```

In words: an `InputImage` becomes an `OpticalField`; a `PhaseMask` (random, designed, or *learned*)
imprints a trained pattern of phase shifts onto the light; the field is **propagated** through free
space by scalar diffraction (you choose Fresnel, Fraunhofer, or angular-spectrum); the sensor
**captures** an intensity frame — and crucially that frame is average-pooled down to far fewer
pixels than the input, so it is a *compressed measurement*, not a photo; finally a tiny digital
**decoder** reads the measurement to produce the decision, and a **receipt** binds the whole run.

**Training the mask** happens two ways. The simple way is **hill-climbing** — perturb the mask, keep
the change if accuracy improves (this plateaus at an optimizer ceiling). The strong way is **analytic
gradient descent**: PhotonLayer has a proven *adjoint* of its diffraction operator
(`Propagator::backward_into` using `conj(H)`), so gradients flow back through the optics and Adam
trains the mask directly — that is what breaks the ceiling to 83.30%, and the *composed* adjoint
trains a multi-plane cascade to 88.80%.

**How is this different from a normal camera + model?** A normal camera digitizes the *whole* scene
and a model does all the "figuring out" afterward in software. PhotonLayer does the first chunk of
that figuring-out **in the light**, so the sensor only ever records the compressed answer-shaped
measurement — fewer pixels to move, less digital compute downstream, and the raw scene is never
stored as a viewable image by default.

## 5. Is it production-ready — scope and honest limits

Be clear-eyed; the repo is admirably honest about this:

- **It is a Rust _simulator_ today.** The physics, training, and receipts are real and reproducible,
  but it is **not** controlling real glass yet — a hardware bridge (a DiffuserCam-style lensless
  camera) is on the roadmap, after an in-sim phase-quantization sweep.
- **It is a _single_ task-trained optical layer + a tiny decoder** = competitive single-layer optical
  compression. It is **not** a new accuracy state-of-the-art; multi-layer ~97–99% diffractive networks
  are explicitly out of scope. The +7.9 pp vs the full-image baseline is a *feature-separability under
  a fixed weak decoder* statement, **not** "optics beat digital" — a small CNN on the same 1024 pixels
  reaches ~99% and beats both. The repo states this so the obvious objection is pre-answered.
- **No privacy or security guarantee is claimed.** PhotonLayer stores a *learned measurement, not the
  raw image* — a description, not a theorem. The bundled probe measures **linear** invertibility only;
  nonlinear (CNN/U-Net) reconstruction is expected to succeed. Never read it as "cannot be
  reconstructed," "privacy-preserving," or "zero-knowledge."
- **The "16× MAC reduction" counts the _digital decoder_ only** (640 vs 10,240). The optical transform
  is passive in *real* hardware but is **not free in this simulator** and is not counted in that figure.
- **All accuracy figures are noise-free scalar-diffraction simulation with continuous phase.**
  Robustness to phase quantization, sensor noise, and fabrication error is not yet characterized;
  expect degradation on real hardware.
- **Determinism is verified within runs/builds on x86-64**; full cross-platform (Linux/macOS/WASM)
  bit-identity is a design goal, not yet proven (the obstacle is platform `libm` transcendentals).

## 6. Where do I read more — the docs map

- **`README.md`** (repo root) — the canonical narrative: plain-language intro, the wedge, the
  measured results (compression sweep, gradient ceiling-break, multi-plane cascade), determinism &
  receipts, quickstart, the examples ladder, the crate table, the roadmap, and the citations.
- **`crates/photonlayer-core/README.md`** — the optical engine's own README with the compression
  sweep table.
- **`examples/README.md`** — the full practical-to-exotic ladder of runnable examples (what each one
  shows + its exact `cargo run` command).
- **`docs/README.md`** — the in-browser **Optical Compression Playground** demo (the live WASM page).
- **The crate source itself** — `crates/photonlayer-core/src/` is heavily doc-commented (lib.rs,
  simulator.rs, mask.rs, propagate.rs, detector.rs, receipt.rs); `crates/photonlayer-bench/src/`
  holds the training (grad_train, grad_cascade, learn) and benchmarks.
- **Citations** in the README anchor the science: Wirth-Singh et al. (compressed meta-optical
  encoder, arXiv:2406.06534), Bezzam/Vetterli/Simeoni (few-pixel learned mask), Lin et al. (D2NN,
  *Science* 2018), Li/Ozcan (differential detection, arXiv:1906.03417).

## 7. How do I install and run it end-to-end

The fastest path (no install) is the **live browser demo**: <https://ruvnet.github.io/PhotonLayer/> —
shape light through a learned mask, watch it compress to a tiny measurement, and verify the receipt.

To run locally with Rust:

```sh
# 1. Add the core crate to a Rust project
cargo add photonlayer-core

# 2. Or run the 30-line guided tour straight from a clone
cargo run --release --example hello_optics -p photonlayer-core
```

A minimal program (from the README quickstart):

```rust
use photonlayer_core::prelude::*;

let n = 32;
let pixels: Vec<f32> = (0..n * n).map(|i| (i % n) as f32 / n as f32).collect();
let img  = InputImage::from_norm_f32(n, n, pixels).unwrap();
let mask = PhaseMask::random(n, n, 42);
let cfg  = OpticalConfig::demo(n, n);

let frame = ScalarSimulator.simulate(&img, &mask, &cfg).unwrap();
// Re-running is bit-identical:
assert_eq!(frame.frame_hash, ScalarSimulator.simulate(&img, &mask, &cfg).unwrap().frame_hash);
```

Then climb the examples ladder — `compression` (see 64× reduction as ASCII), `receipt` (tamper →
fails), `propagation_modes`, `learn_mask`, `differential_detection`, `gradient_training` (the
83.30% ceiling-break), `multiplane_cascade` (the 2-plane 88.80%), and the real-data
`mnist_compression`. Every example compiles clean and runs offline on the built-in deterministic
dataset. The CLI (`photonlayer-cli`) drives the same machinery: `bench`, `barcode`, `edge`,
`privacy-gate`, and `verify-receipt <path.json>`.

## 8. How do I extend PhotonLayer safely? (the extension points)

PhotonLayer has a few clear extension seams. Add new behavior at the seam, keep the crate
boundaries (`photonlayer-core` is the foundation; `photonlayer-bench`, `photonlayer-cli`, and
`photonlayer-wasm` all depend on it via `use photonlayer_core::prelude::*`, so a core change can
ripple outward — see §3), and add a test next to the existing ones.

- **Add a new propagation mode / diffraction model.** Propagation modes are the
  **`PropagationMode` enum in `crates/photonlayer-core/src/config.rs`** (`Fresnel`, `Fraunhofer`,
  `AngularSpectrum`); the math lives in **`crates/photonlayer-core/src/propagate.rs`** (the
  `Propagator` struct + its `transfer_kernel`). Add the variant, build its transfer kernel `H`, and
  match it in the propagation dispatch. **The hard contract: forward and adjoint must match.** The
  transfer-arm modes implement the adjoint by multiplying with `conj(H)` in
  `Propagator::backward_into`; if your mode is transfer-like this is automatic, otherwise document
  the adjoint explicitly (Fraunhofer's adjoint is intentionally not implemented). **Validate the
  adjoint identity** `⟨P(a), b⟩ == ⟨a, Pᴴ(b)⟩` in `crates/photonlayer-core/tests/gradient_check.rs`
  — gradient training relies on it.
- **Add a new phase-mask type.** The mask is the **`PhaseMask` struct in
  `crates/photonlayer-core/src/mask.rs`**; constructors are `PhaseMask::new(w, h, phase_radians,
  mask_id)`, `::identity(w, h)`, `::random(w, h, seed)`, `::lens(w, h, focal_strength)`. Add a new
  constructor that fills `phase_radians` (length **must** equal `width * height`, values in `[0,2π)`)
  and sets a unique descriptive `mask_id` (it is hashed into the receipt). `apply(&mut OpticalField)`
  already centers a smaller mask on the field — no change needed there.
- **Add a new detector / sensor readout.** The detector is **`crates/photonlayer-core/src/detector.rs`**
  (`OpticalFrame`, the free fns `capture` / `capture_with`, and the `DetectorConfig` knobs in
  `config.rs`: `shot_noise_photons`, `read_noise_std`, `quantization_levels`, `binning`,
  `saturation`). For a non-trivial readout (e.g. differential `I⁺−I⁻`), follow the worked extension in
  **`crates/photonlayer-bench/src/diffdetect.rs`** (`DiffDetector`) which reads positive/negative
  regions off `OpticalFrame.intensity` rather than a single pooled value.
- **Add a new decoder.** Decoders read `OpticalFrame.intensity` and return a class. The reference is
  **`NearestCentroid` in `crates/photonlayer-bench/src/decoder.rs`** with `fit(features, labels,
  num_classes)` + `predict(feat)` + `accuracy(...)`, plus the `frame_features(frame, out_dim)` pooling
  helper. Implement the same `fit`/`predict` shape and keep it deterministic (fixed op order; if you
  need randomness, seed it like `DeterministicRng::new(seed)` from `src/rng.rs`).
- **Add a new training method.** Training lives in `photonlayer-bench`: hill-climb in
  **`src/learn.rs`** (`learn_mask`, `LearnConfig`), analytic gradient descent in **`src/grad_train.rs`**,
  the Adam optimizer in **`src/grad_adam.rs`**, and the multi-plane cascade in **`src/grad_cascade.rs`**
  (`Cascade`). **Do not re-implement the optics or the adjoint** — compose from the proven core fns
  `phase_gradient(prop, u0, theta, w_weight) -> Result<Vec<f32>>` and `intensity_loss(...) -> Result<f32>`
  (re-exported in the prelude), which route gradients through `Propagator::backward_into`. Keep the
  iteration order seeded/serial for determinism.
- **Add a new CLI subcommand.** The CLI is a plain dispatch in
  **`crates/photonlayer-cli/src/main.rs`** — `match args.first()` over `"bench"`, `"barcode"`,
  `"edge"`, `"privacy-gate"`, `"verify-receipt"`, `"help"`. Add a `Some("my-cmd") => cmd_my_cmd()`
  arm, write `fn cmd_my_cmd()` (the `cmd_barcode()` / `cmd_edge()` fns are the templates), and add a
  line to `print_usage()`.
- **Add a browser (WASM) binding.** WASM exports are `#[wasm_bindgen]`-annotated items in
  **`crates/photonlayer-wasm/src/lib.rs`** (existing: `simulate(...)`, `compress(...)`,
  `verify_receipt_json(...)`, `default_config_json(...)`, returning `WasmTraceResult` /
  `CompressResult`). The pattern is: add a `#[wasm_bindgen] pub fn`, **validate untrusted inputs first**
  (bound `width`/`height` to `1..=MAX_GRID_DIM`, `config.validate()`), call the deterministic core
  from `photonlayer_core::prelude::*` (e.g. `ScalarSimulator.trace(...)`), and return
  `Result<T, JsValue>` (a Rust `Err` maps to a JS exception). Then `wasm-pack build
  crates/photonlayer-wasm --target web`.
- **Keep the receipt honest.** If you add a stage that changes the result, bind its output into the
  **`ExperimentReceipt` in `crates/photonlayer-core/src/receipt.rs`** (`build_receipt`, `verify_receipt`,
  `replay_and_verify`): add a field, hash it with a versioned namespace, and include that hash in the
  `hash_join` binding so the run stays tamper-evident and replay-checkable.

Rule of thumb for safety: change `photonlayer-core`'s *internals* freely, but treat its
**prelude types (`ScalarSimulator`, the `OpticalSimulator` trait, `PhaseMask`, `OpticalConfig`,
`PropagationMode`, `OpticalField`, `InputImage`, `OpticalFrame`, `Propagator`, `Complex`,
`ExperimentReceipt`) as the stable API** that bench/cli/wasm depend on — don't change their
signatures; add via new variants/constructors/functions. Run `cargo test` (per-crate tests under
`crates/*/tests/`) before and after. (Source: crates/photonlayer-core/src/{lib,config,propagate,
mask,detector,simulator,receipt}.rs + tests/gradient_check.rs; crates/photonlayer-bench/src/{learn,
grad_train,grad_adam,grad_cascade,decoder,diffdetect}.rs; crates/photonlayer-cli/src/main.rs;
crates/photonlayer-wasm/src/lib.rs.)

Also asked as: how do I add a propagation mode, how do I add a diffraction model, how do I add a
phase mask, how do I add a detector, how do I add a decoder, how do I add a training method, where
do I implement a trainer, how do I add a CLI command, how do I add a wasm binding, how do I extend
PhotonLayer without breaking it, what is the stable API, what trait do I implement, which crate does
a new trainer go in, what is the adjoint contract. Keywords: PropagationMode enum config.rs Fresnel
Fraunhofer AngularSpectrum, Propagator propagate.rs transfer_kernel backward_into conj(H) adjoint
gradient_check.rs, PhaseMask mask.rs new identity random lens apply phase_radians mask_id,
detector.rs OpticalFrame capture DetectorConfig binning, diffdetect.rs DiffDetector differential,
decoder.rs NearestCentroid fit predict frame_features, learn.rs learn_mask grad_train.rs grad_adam
grad_cascade Cascade phase_gradient intensity_loss, photonlayer-cli main.rs match subcommand
print_usage, wasm-bindgen photonlayer-wasm lib.rs simulate compress verify_receipt_json
WasmTraceResult, ExperimentReceipt receipt.rs build_receipt verify_receipt hash_join, stable prelude
ScalarSimulator OpticalSimulator photonlayer-core foundation.

## 9. Performance, determinism, and gotchas

PhotonLayer is fast and deterministic by design, but there are real constraints to know before you
push grid size, training, or cross-platform reproducibility.

- **Grids must be powers of two, and there is a hard ceiling.** FFT-based propagation requires each
  grid side to be a **non-zero power of two** — pass `48×48` and you get
  `PhotonError::NotPowerOfTwo`. The maximum side is **`MAX_GRID_DIM = 4096`**
  (`crates/photonlayer-core/src/config.rs`); `OpticalConfig::validate()` rejects anything bigger
  (it also overflows-guards 32-bit wasm32). Use `OpticalConfig::demo(w, h)` or check `is_pow2()`
  first. (Source: config.rs `MAX_GRID_DIM`/`validate`; propagate.rs `is_pow2`; error.rs.)
- **Memory scales with the grid, not exponentially.** A field is `width × height` `Complex` values
  (two `f32` = 8 bytes each), so a `4096²` grid ≈ 134 MB per field; the cached `Propagator`
  precomputes a same-sized transfer kernel. This is linear in pixels — unlike a state-vector
  simulator — so the practical lever is grid size, not an exponential qubit-style wall.
- **Determinism is guaranteed *within a platform*, not yet *across* platforms.** Same input + mask +
  config + seed always yields the same `frame_hash` on one machine (in-house FFT + seeded RNG, no
  `rayon`/FMA nondeterminism). The cross-platform gap is **`Complex::from_phase` calling the platform
  `libm` `cos`/`sin`**, which is not correctly-rounded and can differ by a ULP between glibc / musl /
  Apple / wasm. Full cross-platform bit-identity is a design goal, not yet proven; it would require
  owning the transcendentals. (Source: complex.rs `from_phase`; lib.rs determinism note; README.)
- **Noise is opt-in and seeded.** `DetectorConfig` adds shot/read noise + quantization only when its
  fields are set; when it does, it draws from `DeterministicRng::new(seed ^ …)` (SplitMix64 +
  Box–Muller in `src/rng.rs`), so noisy runs are still reproducible for a fixed `config.seed`. All
  reported accuracy figures are **noise-free, continuous-phase** scalar-diffraction simulation.
- **Training has real ceilings and one init-sensitivity gotcha.** Hill-climbing a single mask
  (`learn.rs`, `LearnConfig`: 160 iters, block 4, σ 0.6) plateaus at the single-mask optimizer
  ceiling (~73% MNIST). Analytic **gradient descent breaks it to 83.30%** at 16× compression
  (reproduced in ~24 s); the **2-plane cascade reaches 88.80% (the robust headline)** while the
  **3-plane 89.80% is more init-sensitive** — reported, not over-asserted. Always run training with
  `--release`; debug builds are far slower. Verify any new adjoint with `gradient_check.rs` (exact
  Hermitian-adjoint identity + finite-difference grad-check) before trusting gradients.
- **Watch the error/panic conditions.** `PhotonError` (`src/error.rs`) covers `DimensionMismatch`
  (`u0`/`theta`/`w_weight` or image/mask length ≠ `width*height`), `NotPowerOfTwo`, `InvalidConfig`,
  and `InvalidMask`. The FFT panics on a non-power-of-two length and `DiffDetector::new` asserts the
  sensor is large enough for its tiles — validate sizes before calling.
- **Read the honest scope as a gotcha too.** It's a *simulator*, not hardware. The "16× MAC
  reduction" counts only the **digital decoder** (640 vs 10,240 MACs) — the optical transform is free
  on *real* hardware but **not free in this simulator** and isn't counted. The privacy probe measures
  **linear** invertibility only (a lower bound, not a guarantee). See §5 for the full limits.

Also asked as: how many pixels before I run out of memory, what are the grid-size limits, why must
the grid be a power of two, what is MAX_GRID_DIM, is PhotonLayer deterministic, why isn't it
bit-identical across platforms, why is my training slow, what is the hill-climb ceiling, why is the
3-plane cascade unstable, what errors can PhotonLayer throw, gotchas with PhotonLayer, performance
tips. Keywords: power of two FFT NotPowerOfTwo MAX_GRID_DIM 4096 config.rs validate, memory width
height Complex 8 bytes linear Propagator transfer kernel, determinism frame_hash seeded RNG libm
cos sin transcendental cross-platform glibc musl Apple wasm complex.rs from_phase, DetectorConfig
shot_noise read_noise quantization DeterministicRng SplitMix64 Box-Muller rng.rs noise-free
continuous phase, hill-climb 73 plateau gradient 83.30 cascade 88.80 2-plane 89.80 3-plane
init-sensitive release build gradient_check adjoint, PhotonError DimensionMismatch NotPowerOfTwo
InvalidConfig InvalidMask error.rs panic DiffDetector assert, 16x MAC decoder 640 10240 optical not
free simulator privacy linear probe.
