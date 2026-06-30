# ruqu — Top-Down Primer

> A synthesized, top-down orientation for newcomers. Seven sections, one per
> stage of the comprehension arc: what it is → what it can do → what it is made
> of → how a circuit runs → how mature it is → where the docs live → how to
> start. Every claim is grounded in the cloned repo (`README.md`, `cli/*`,
> `crates/*/README.md`, `crates/*/src/lib.rs`) @ `026d63ef`. The Rust crates are
> `ruqu-core`, `ruqu-algorithms`, `ruqu-exotic`, `ruqu-wasm`, and `ruQu` (the
> coherence engine); the published terminal CLI is **`npx @ruvector/ruqu`**.

## 1. What is ruqu?

**ruqu is a fast, dependency-light quantum-computing toolkit written in pure
Rust — a state-vector quantum *circuit simulator* (with SIMD acceleration,
realistic noise models, and multi-threading), plus production quantum
*algorithms* (VQE, Grover, QAOA, surface-code error correction), and it runs
natively *and* in the browser via WebAssembly.** It lets you build and run real
quantum circuits and algorithms with **no quantum hardware** — on a laptop, a
server, or in a browser tab. (Source: README.md L7-14.)

A "state-vector simulator" means ruqu holds the full quantum state of your qubits
in memory as a vector of complex amplitudes and applies each gate as exact linear
algebra — so the answers are exact (not sampled from real noisy hardware), up to
the memory limit (~32 qubits native, ~25 in the browser). (Source:
crates/ruqu-core/README.md "Simulation Backends" — StateVector "exact, up to 32
qubits"; crates/ruqu-wasm/README.md "25-Qubit Limit … ~1GB for 25 qubits".)

**What you get back** is concrete: running a circuit returns a `SimulationResult`
(from `Simulator::run(&circuit) -> Result<SimulationResult>`) carrying the final
state and an exact **measurement distribution** — e.g. a 4-qubit GHZ circuit
yields `0000` and `1111` each with probability ~0.5 and the rest exactly 0
(`npx @ruvector/ruqu simulate --qubits 4` prints the bitstring→probability table
plus gate count and timing). Because it is exact linear algebra, those
probabilities are the true theoretical values, not noisy samples — run it twice
and (absent a noise model) you get identical numbers. (Source:
crates/ruqu-core/src/simulator.rs `Simulator::run`; cli/bin/cli.js `simulate`;
crates/ruqu-core/README.md.)

It is **pure Rust, no FFI** — portable, memory-safe, easy to embed, and it
compiles to native *and* `wasm32`. There is **no Python, no C++, no heavyweight
dependencies**. (Source: README.md L18-26.) The fastest way to *see* it run is
from your terminal: `npx @ruvector/ruqu simulate --qubits 4` runs a real
state-vector simulation compiled to WebAssembly, with no native addon and no
install. (Source: cli/README.md L1-12.)

Also asked as: what is ruqu, what does ruqu do, what is a state-vector quantum
circuit simulator, does ruqu need real quantum hardware, can I run quantum
circuits in the browser, is ruqu Python or Rust, what does running in WASM let me
do, what does ruqu actually do. Keywords: quantum computing, pure Rust, no FFI,
state-vector simulator, quantum circuit simulator, SIMD, noise models,
multi-threading, WebAssembly, wasm32, runs in the browser, no quantum hardware,
no Python no C++, 25 qubits, exact simulation, npx @ruvector/ruqu.

## 2. What can ruqu do for you?

ruqu ships **batteries-included quantum algorithms** on top of its simulator —
you don't have to implement them yourself (Source: README.md L20-26;
crates/ruqu-algorithms/README.md L7-15; crates/ruqu-algorithms/src/lib.rs L1-18):

- **VQE (Variational Quantum Eigensolver)** — finds **ground-state energies of
  molecular Hamiltonians** (quantum chemistry) using a classical-quantum hybrid
  loop with a hardware-efficient ansatz and parameter-shift gradient descent.
  (Source: crates/ruqu-algorithms/src/lib.rs L5-7; README "VQE for chemistry".)
- **Grover's search** — a **quadratic speedup for unstructured search**, O(√N)
  vs O(N), via amplitude amplification with direct state-vector oracle access.
  (Source: crates/ruqu-algorithms/README.md table; src/lib.rs L9-11.)
- **QAOA (Quantum Approximate Optimization Algorithm)** — approximate solutions
  to **combinatorial optimization** (MaxCut) via parameterized phase-separation
  and mixing layers. (Source: crates/ruqu-algorithms/src/lib.rs L13-15.)
- **Surface Code** — **quantum error correction**: a distance-3 surface code
  simulation with stabilizer-measurement cycles, noise injection, and syndrome
  decoding — the path toward fault-tolerant computation. (Source:
  crates/ruqu-algorithms/src/lib.rs L17-19.)

Beyond the algorithms, the **core simulator** gives you a universal gate set
(H, X, Y, Z, CNOT, CZ, Toffoli, Rx, Ry, Rz, Phase, SWAP, custom unitaries),
**realistic noise** (depolarizing, amplitude/phase damping, thermal relaxation,
custom Kraus operators) plus **error mitigation** (zero-noise extrapolation,
probabilistic error cancellation), and **OpenQASM 3.0 export** so you can move
circuits to other tools. (Source: crates/ruqu-core/README.md "Features".) The
**ruqu-exotic** crate adds experimental quantum-*inspired* tools for AI systems
(quantum memory decay, interference search, reasoning error correction, swarm
interference). (Source: crates/ruqu-exotic/README.md L7, table.)

Also asked as: what can ruqu do, what algorithms does ruqu include, what is VQE
in one line, what is Grover in one line, what is QAOA in one line, what is
surface-code error correction here, what gates does ruqu support, does ruqu model
noise, can ruqu export OpenQASM, what is ruqu-exotic for. Keywords: VQE quantum
chemistry ground state, Grover search O(√N), QAOA MaxCut combinatorial
optimization, Surface Code error correction distance-3 syndrome, universal gate
set H X Y Z CNOT CZ Toffoli, depolarizing amplitude phase damping Kraus, zero
-noise extrapolation, OpenQASM 3.0 export, ruqu-exotic interference search.

## 3. What is ruqu made of? (the five crates)

ruqu is a Rust **workspace of five crates** under `crates/`, plus an npx CLI
under `cli/`. (Source: README.md "Crates" table L28-36; crates/ directory.)

- **`ruqu-core`** — the high-performance **state-vector circuit simulator** with
  SIMD acceleration, noise models, and multi-threading. It is really a *quantum
  execution intelligence engine*: **five simulation backends** — StateVector
  (exact, ≤32 qubits), Stabilizer (millions of qubits, Clifford-only),
  Clifford+T, TensorNetwork (MPS), and Hardware (device profiles) — with a
  **cost-model planner** that auto-routes each circuit to the best backend.
  (Source: crates/ruqu-core/README.md "5 Simulation Backends", "Cost-Model
  Planner".)
- **`ruqu-algorithms`** — the production algorithms: **VQE, Grover, QAOA, and
  Surface Code** (see §2). (Source: crates/ruqu-algorithms/README.md L7.)
- **`ruqu-exotic`** — experimental **quantum–classical hybrid** algorithms
  (quantum memory decay, interference search, reasoning QEC, swarm interference)
  aimed at AI systems. (Source: crates/ruqu-exotic/README.md L7.)
- **`ruqu-wasm`** — the **WebAssembly** bindings: run circuits, VQE, Grover, and
  QAOA directly in JavaScript/TypeScript, ~25-qubit, zero dependencies, no
  server. Published to npm as `@ruvector/ruqu-wasm`. (Source:
  crates/ruqu-wasm/README.md "Browser-Native", "25-Qubit Limit".)
- **`ruQu`** (the coherence engine) — a **classical "nervous system for quantum
  machines"** that assesses qubit coherence in real time via **dynamic min-cut**;
  the README calls it a *quantum execution intelligence engine* (5 layers,
  468 ns P99 latency). (Source: README.md L36; crates/ruQu/README.md "Platform
  Overview".)

**How the crates relate (the dependency layering).** `ruqu-core` is the
**foundation** — it depends on no other ruqu crate. `ruqu-algorithms` and
`ruqu-exotic` each depend on **`ruqu-core`** (they build algorithms on the
simulator). `ruqu-wasm` depends on **both `ruqu-core` and `ruqu-algorithms`** and
re-exports them to JavaScript. The **`ruQu` coherence engine is independent**: it
does **not** depend on the simulator crates and they do not depend on it — it is a
separately-extracted classical layer ("nervous system") that *complements* the
simulator rather than sitting in its call path. So a change in `ruqu-core` can
ripple to algorithms/exotic/wasm, but never to `ruQu`. (Source: each crate's
Cargo.toml `[dependencies]`; ruqu-dep-graph.json internalEdges:
ruqu-algorithms→ruqu-core, ruqu-exotic→ruqu-core, ruqu-wasm→ruqu-core,
ruqu-wasm→ruqu-algorithms; ruQu has no internal edges.)

The **`npx @ruvector/ruqu`** CLI bundles a `--target nodejs` WASM build of
`ruqu-wasm` so you can run real simulations from your terminal — wrapped in a
metaharness agent CLI for `init`/`doctor`. Commands and their flags:
`simulate [--qubits N]` (GHZ state-vector run → gate count, timing, the
measurement distribution), `grover [--qubits N] [--target T] [--seed S]`
(amplitude amplification), `qaoa [--nodes N]` (MaxCut on a ring), `capabilities`
(gates/algorithms/qubit+memory limits), `doctor` (verify kernel + quantum WASM),
`init`, `version`. (Source: cli/README.md L1-12; cli/bin/cli.js function
signatures + help listing; cli/package.json L2-5.)

Also asked as: what crates make up ruqu, what is ruqu-core, what is
ruqu-algorithms, what is ruqu-exotic, what is ruqu-wasm, what is the coherence
engine, what are the five simulation backends, what is the cost-model planner.
Keywords: five crates, ruqu-core ruqu-algorithms ruqu-exotic ruqu-wasm ruQu,
StateVector Stabilizer Clifford+T TensorNetwork Hardware backends, cost-model
planner auto-route, coherence engine dynamic min-cut nervous system, @ruvector
/ruqu-wasm npm, npx @ruvector/ruqu CLI.

## 4. How a circuit runs (the simulation pipeline)

You build a **circuit** by adding gates, then **run** it on a simulator backend
and read out **probabilities** or **measurements**. The minimal flow (Source:
crates/ruqu-core/README.md "Quick Start"):

```rust
use ruqu_core::prelude::*;
let mut circuit = QuantumCircuit::new(2);
circuit.h(0).cnot(0, 1);              // Bell state |00> + |11>
let result = Simulator::run(&circuit)?;
let probs = result.state.probabilities(); // ~ [0.5, 0.0, 0.0, 0.5]
```

Under the hood ruqu does more than blindly simulate. The **cost-model planner**
inspects each circuit (qubit count, gate mix, T-count) and **auto-selects the
optimal backend**: StateVector for exact small circuits, Stabilizer for
Clifford-only circuits (Gottesman–Knill, scaling to millions of qubits),
Clifford+T for low-T-count circuits, TensorNetwork (MPS) for shallow/structured
circuits, and Hardware for real device profiles. (Source:
crates/ruqu-core/README.md "Simulation Backends", "Cost-Model Planner".)

Gates are applied with **SIMD-vectorized** kernels (AVX2/NEON, 2–4× speedup) and
**Rayon multi-threading** for large qubit counts; you can run **mixed precision**
(f32/f64) to trade speed for accuracy. You can inject **noise** (depolarizing,
amplitude/phase damping, custom Kraus channels) to study NISQ behavior, then
apply **error mitigation** (zero-noise extrapolation, probabilistic error
cancellation). Every run can emit a **cryptographic witness** — a tamper-evident
execution log for reproducibility. Finally, **`to_qasm3`** exports the circuit to
standard OpenQASM 3.0. (Source: crates/ruqu-core/README.md "SIMD Acceleration",
"Multi-Threading", "Mixed Precision", "Noise & Mitigation", "Cryptographic
Witnesses", "OpenQASM 3.0 Export".)

In the browser it's the same idea through `ruqu-wasm`: `new Circuit(n)`, add
gates (`circuit.h(0); circuit.cnot(0,1)`), `new Simulator().run(circuit)`, then
`state.measureAll()`. (Source: crates/ruqu-wasm/README.md "Quick Start
(JavaScript)".)

Also asked as: how does a circuit run, how do I build a Bell state, what is the
cost-model planner, which backend gets chosen, how does ruqu speed up
simulation, how does ruqu model noise, what is error mitigation, how do I export
to OpenQASM, how do I run a circuit in the browser. Keywords: QuantumCircuit
Simulator::run probabilities, cost-model planner auto-select backend,
StateVector Stabilizer Gottesman-Knill, SIMD AVX2 NEON 2-4x, Rayon
multi-threading, mixed precision f32 f64, noise depolarizing damping Kraus,
zero-noise extrapolation, cryptographic witness, to_qasm3 OpenQASM 3.0,
ruqu-wasm Circuit Simulator measureAll.

## 5. Is it production-ready? (scope and honest limits)

ruqu is a **simulator and algorithm library**, not access to a real quantum
computer — and that's the point: it lets you build and run quantum algorithms
**without any quantum hardware**. State plainly what it is and isn't:

- **It is a classical simulator.** Answers are exact state-vector math (or one of
  the other backends), not measurements from real noisy hardware. ruqu *models*
  noise; it does not connect to a physical QPU. (Source:
  crates/ruqu-core/README.md backends table; README.md L7-14.)
- **Qubit limits are real.** Exact state-vector simulation is **≤32 qubits**
  native (memory doubles per qubit), and the browser/WASM build is capped at
  **~25 qubits** (~1 GB for 25). The Stabilizer backend reaches "millions" but
  only for Clifford-only circuits (Gottesman–Knill). (Source:
  crates/ruqu-core/README.md; crates/ruqu-wasm/README.md "25-Qubit Limit".)
- **Crate versions vary.** The workspace is at **`2.2.x`** (Cargo.toml
  `version = "2.2.3"`); the npx CLI `@ruvector/ruqu` is **`0.2.0`**; the README
  install snippet pins `ruqu-core = "2.2"`. Cite the crate you mean. (Source:
  Cargo.toml L6; cli/package.json L3; README.md "Install".)
- **ruqu-exotic is experimental.** It is quantum-*inspired* tooling for AI
  systems, explicitly labeled experimental — not a physics result. (Source:
  crates/ruqu-exotic/README.md L7.)
- **License: MIT.** © Ruvector Team; part of the ruvector ecosystem (extracted
  per ADR-257). (Source: README.md "License".)

What is solidly real: **pure Rust, no FFI, no Python/C++**, a universal gate set,
five backends with a cost-model planner, realistic noise + mitigation, OpenQASM
3.0 export, SIMD + multi-threading, and a working in-browser WASM build you can
run today with `npx @ruvector/ruqu`. (Source: README.md; crates/ruqu-core
/README.md; cli/README.md.)

Also asked as: is ruqu production-ready, is ruqu real quantum hardware, how many
qubits can ruqu simulate, what is the browser qubit limit, what version is ruqu,
what is the CLI version, is ruqu-exotic real physics, what is the license, what
are ruqu's limits. Keywords: classical simulator not hardware, no quantum
hardware, 32 qubits native 25 in browser, Stabilizer millions Clifford-only,
version 2.2.3 crate, @ruvector/ruqu 0.2.0 CLI, ruqu-exotic experimental, MIT
license Ruvector ADR-257.

## 6. Where do I read more? (the docs map)

ruqu's docs live mostly as crate-level READMEs plus the coherence engine's deeper
design docs. Read top-down:

- **`README.md`** (repo root) — what ruqu is, why-ruqu bullets, the five-crate
  table, install, quick start, WebAssembly, the npx CLI, and use cases.
- **`crates/ruqu-core/README.md`** — the simulator: 5 backends, cost-model
  planner, universal gate set, noise + mitigation, OpenQASM 3.0, SIMD.
- **`crates/ruqu-algorithms/README.md`** — VQE, Grover, QAOA, Surface Code with
  runnable Rust examples.
- **`crates/ruqu-wasm/README.md`** — the browser story: JS/React quick starts,
  the 25-qubit limit, npm install.
- **`crates/ruqu-exotic/README.md`** — the experimental quantum-inspired modules.
- **`crates/ruQu/README.md`** + **`crates/ruQu/docs/`** — the coherence engine's
  platform overview, ADR-001 architecture, the two DDD domain docs, and research
  notes.
- **`cli/README.md`** — every `npx @ruvector/ruqu` command (simulate / grover /
  qaoa / capabilities / init / doctor / version) and how the WASM bundle loads.

(Source: README.md; the crate README files; cli/README.md; crates/ruQu/docs/.)

Also asked as: where do I read about ruqu, which doc covers the simulator, where
are the algorithms documented, where is the browser/WASM guide, where is the
coherence engine described, where are the CLI commands listed, what docs exist.
Keywords: README.md root, ruqu-core README simulator backends, ruqu-algorithms
README VQE Grover QAOA, ruqu-wasm README browser 25-qubit, ruqu-exotic README,
ruQu README coherence engine ADR DDD docs, cli README npx commands.

## 7. How do I install and run it (end-to-end)

**Fastest, zero-install — run a real simulation from your terminal** (Source:
cli/README.md L5-12; README.md "Command-line quantum (npx)"):

```bash
npx @ruvector/ruqu capabilities         # gates, algorithms, qubit/memory limits
npx @ruvector/ruqu simulate --qubits 4  # GHZ state-vector simulation
npx @ruvector/ruqu grover --qubits 3 --target 5
npx @ruvector/ruqu qaoa --nodes 4       # QAOA MaxCut on a ring
npx @ruvector/ruqu doctor               # verify the quantum WASM
```

**In Rust — add the crates and run a circuit** (Source: README.md "Install",
"Quick start"; crates/ruqu-core/README.md):

```bash
cargo add ruqu-core ruqu-algorithms     # simulator + VQE/Grover/QAOA/surface-code
```

Build a circuit directly with `ruqu-core` and read its measurement distribution:

```rust
use ruqu_core::{QuantumCircuit, Simulator};
let mut circuit = QuantumCircuit::new(2);
circuit.h(0).cnot(0, 1);                 // Bell state (gate methods: h x y z s t rx ry rz cnot cz …)
let result = Simulator::new().run(&circuit)?;   // -> SimulationResult
println!("{:?}", result.measure_all());  // exact distribution: "00" and "11" each ~0.5
```

Run **Grover's search** via `ruqu-algorithms` — `run_grover(&GroverConfig) -> Result<GroverResult>`.
`GroverConfig { num_qubits: u32, target_states: Vec<usize>, num_iterations: Option<u32>, seed: Option<u64> }`
— leave `num_iterations: None` to use the theoretically-optimal count, and `seed: None` for
nondeterministic sampling:

```rust
use ruqu_algorithms::grover::{run_grover, GroverConfig};
let cfg = GroverConfig { num_qubits: 3, target_states: vec![5], num_iterations: None, seed: Some(42) };
let res = run_grover(&cfg)?;              // GroverResult: measured state + success probability
```

```rust
use ruqu_algorithms::qaoa::{run_qaoa, Graph, QaoaConfig};
let graph = Graph::from_edges(4, &[(0,1),(1,2),(2,3),(3,0)]);
let result = run_qaoa(&graph, &QaoaConfig::default());
println!("best cut = {:?}", result.best_bitstring);
```

**In the browser / Node — via WebAssembly** (Source: README.md "WebAssembly";
crates/ruqu-wasm/README.md):

```bash
npm install @ruvector/ruqu-wasm         # or: wasm-pack build crates/ruqu-wasm --target web
```

```js
import init, { Circuit, Simulator } from '@ruvector/ruqu-wasm';
await init();
const c = new Circuit(2); c.h(0); c.cnot(0, 1);     // Bell state
const state = new Simulator().run(c);
console.log(state.measureAll().toString(2));         // "00" or "11"
```

**Build from source** (Source: README.md "Build"):

```bash
cargo build --release                              # native
cargo test                                         # run the test suite
wasm-pack build crates/ruqu-wasm --target web      # WASM
```

Also asked as: how do I install ruqu, how do I run ruqu from the terminal, how do
I run a circuit in Rust, how do I run ruqu in the browser, how do I build the
WASM bundle, what does npx @ruvector/ruqu do, how do I run QAOA, how do I run
Grover. Keywords: npx @ruvector/ruqu simulate grover qaoa capabilities doctor,
cargo add ruqu-core ruqu-algorithms, run_qaoa Graph QaoaConfig best_bitstring,
npm install @ruvector/ruqu-wasm, init Circuit Simulator measureAll, wasm-pack
build --target web, cargo build --release cargo test.

## 8. How do I extend ruqu safely? (the extension points)

ruqu is built around a few clear extension seams. Add new behavior at the seam,
keep the crate boundaries (ruqu-core is the foundation; ruqu-algorithms and
ruqu-wasm depend on it, so a core change can ripple outward — see §3), and add a
test next to the existing ones.

- **Add a new gate.** Gates live in **`crates/ruqu-core/src/gate.rs`** (`Gate`,
  `impl Gate`). A circuit applies gates via the simulator's `apply_gate(&Gate)`
  (see `clifford_t.rs` / `mixed_precision.rs` `apply_gate`). Define the gate +
  its matrix there, then exercise it in `crates/ruqu-core/tests/test_gates.rs`.
  Because every backend consumes `Gate`, a new gate is picked up by all backends.
- **Add a new simulation backend.** Backends are selected by the
  **`BackendType` enum + the `analyze_circuit` planner in
  `crates/ruqu-core/src/backend.rs`** (returns a `CircuitAnalysis` choosing the
  cheapest valid backend). Add the variant, teach the planner when to pick it,
  and keep the public `Simulator` API unchanged so ruqu-algorithms / ruqu-wasm
  stay source-compatible.
- **Add a new quantum algorithm.** Algorithms are per-module under
  **`crates/ruqu-algorithms/src/`** (`grover.rs`, `qaoa.rs`, `vqe.rs`,
  `surface_code.rs`, each `pub mod` in `lib.rs`). Add `your_algo.rs`, expose a
  `run_*` entry function + a `*Config`/`*Result` pair (the existing pattern —
  `run_grover(&GroverConfig) -> Result<GroverResult>`), declare `pub mod your_algo;`
  in `lib.rs`, and import only ruqu-core's public surface, e.g.
  `use ruqu_core::{QuantumCircuit, Simulator};` (ruqu-algorithms already depends on
  `ruqu-core` in its Cargo.toml, so no new dependency is needed). Build your circuit
  with `QuantumCircuit::new(n)` + gate methods (`.h(0)`, `.cnot(0,1)`, …) and run it
  with `Simulator::run(&circuit)`.
- **Add a new surface-code decoder.** Implement the
  **`SurfaceCodeDecoder` trait in `crates/ruqu-core/src/decoder.rs`** (it is
  `Send + Sync`) — the trait is the contract; the QEC path calls it polymorphically.
- **Add a hardware/provider target.** Implement the
  **`HardwareProvider` trait in `crates/ruqu-core/src/hardware.rs`** (the existing
  `LocalSimulatorProvider`, `IbmQuantumProvider`, `IonQProvider` are the templates).
- **Add a CLI subcommand.** The CLI is plain functions in
  **`cli/bin/cli.js`** (`simulate`, `grover`, `qaoa`, `doctor`, …). The wiring is a
  `switch`/dispatch on `process.argv[2]` inside the entry `run(argv)` function:
  add `function mycmd(args) { … }`, add its `case 'mycmd': return mycmd(rest);`
  branch to that dispatch, and list it in the `capabilities`/help output. Args are
  parsed with the `flag(args, '--name', default)` helper already in the file.
- **Add a browser (WASM) binding.** WASM exports are `#[wasm_bindgen]`-annotated
  items in **`crates/ruqu-wasm/src/lib.rs`**. The pattern is: a `#[wasm_bindgen]`
  on the `pub struct`/`impl`, `#[wasm_bindgen(constructor)]` on `new`, and
  `#[wasm_bindgen(getter)]` on field accessors — e.g.
  ```rust
  #[wasm_bindgen]
  impl Circuit {
      #[wasm_bindgen(constructor)]
      pub fn new(num_qubits: usize) -> Circuit { /* … */ }
      pub fn h(&mut self, q: usize) { /* … */ }
      #[wasm_bindgen(getter)]
      pub fn num_qubits(&self) -> usize { /* … */ }
  }
  ```
  Add your method with the same annotations, then
  `wasm-pack build crates/ruqu-wasm --target web` (or `--target nodejs` for the CLI
  bundle). The generated JS picks the export up automatically.

Rule of thumb for safety: change ruqu-core's *internals* freely, but treat its
**public types (`QuantumCircuit`, `Simulator`, `Gate`, `BackendType`) and the
`HardwareProvider`/`SurfaceCodeDecoder` traits as the stable API** that the other
crates and the WASM/CLI surfaces depend on. Run `cargo test` (per-crate tests
under `crates/*/tests/`) before and after. (Source: crates/ruqu-core/src/gate.rs,
backend.rs, decoder.rs, hardware.rs; crates/ruqu-algorithms/src/{grover,qaoa,vqe,
surface_code}.rs + lib.rs; cli/bin/cli.js; crates/ruqu-wasm/src/lib.rs.)

Also asked as: how do I add a gate to ruqu, how do I add a backend, how do I add
a new algorithm, where do I implement a decoder, how do I add a CLI command, how
do I add a wasm binding, how do I extend ruqu without breaking it, what is the
stable API, what trait do I implement, which crate does a new algorithm go in.
Keywords: gate.rs apply_gate Gate, BackendType analyze_circuit backend.rs planner,
ruqu-algorithms src grover qaoa vqe surface_code pub mod run_grover GroverConfig,
SurfaceCodeDecoder trait decoder.rs Send Sync, HardwareProvider trait hardware.rs
LocalSimulatorProvider, cli/bin/cli.js subcommand, wasm-bindgen ruqu-wasm lib.rs
Circuit Simulator, stable public API QuantumCircuit Simulator, ruqu-core foundation.

## 9. Performance, memory, and gotchas (running large circuits)

The one hard physical limit is memory: **exact state-vector simulation stores
`2^n` complex amplitudes**, so memory **doubles with every qubit added**. Concrete
numbers and how to stay under them:

- **Native exact state-vector: ≤ ~32 qubits.** ~25 qubits ≈ 1 GB; each extra
  qubit doubles it, so ~30 qubits ≈ 32 GB and 32 is the practical native ceiling.
  Beyond that you OOM. (Source: crates/ruqu-core/README.md; README.md L7-14.)
- **Browser / WASM: ~25 qubits** (~1 GB in a tab) — the WASM build is capped
  lower than native. (Source: crates/ruqu-wasm/README.md "25-Qubit Limit".)
- **Escape hatch for big circuits: the Stabilizer backend** reaches *millions* of
  qubits but ONLY for Clifford-only circuits (Gottesman–Knill); add a non-Clifford
  (T) gate and it falls back. The **`analyze_circuit` planner** auto-picks the
  cheapest valid backend, so you rarely choose by hand. (Source:
  crates/ruqu-core/README.md backends table; backend.rs.)
- **Coherence engine (ruQu) is tiled with budgets.** It enforces a per-tile memory
  budget — **`TILE_MEMORY_BUDGET = 65536` bytes (64 KB) per tile** — and returns a
  `TileMemoryExceeded` error rather than allocating unbounded; syndrome buffers can
  overflow (`SyndromeBufferOverflow`). Size your tiles/detectors accordingly.
  (Source: crates/ruQu/src/lib.rs TILE_MEMORY_BUDGET; crates/ruQu/src/error.rs.)
- **Speed levers:** ruqu-core is **SIMD + multi-threaded** (rayon); larger circuits
  amortize the threading overhead. Use `--release` for any real run — debug builds
  are far slower for state-vector math. (Source: crates/ruqu-core/README.md "SIMD".)
- **ruqu-exotic is experimental / quantum-*inspired*** — interference search,
  reasoning QEC, swarm interference for AI systems. Treat its outputs as heuristics,
  not physics guarantees. (Source: crates/ruqu-exotic/README.md L7,L14.)

Also asked as: how many qubits before I run out of memory, what are the memory
limits, what happens at 30 qubits, how do I simulate a large circuit, what is the
stabilizer backend for, why is my run slow, what is the tile memory budget, what
is TileMemoryExceeded, gotchas with ruqu, performance tips, is ruqu-exotic
trustworthy. Keywords: 2^n complex amplitudes memory doubles per qubit, 32 qubits
native 25 browser 1 GB, Stabilizer millions Clifford-only Gottesman-Knill, analyze_circuit
planner auto-pick backend, TILE_MEMORY_BUDGET 64KB TileMemoryExceeded SyndromeBufferOverflow,
SIMD multi-threaded rayon release build, ruqu-exotic experimental quantum-inspired heuristic.
