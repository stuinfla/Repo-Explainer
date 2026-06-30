# ruqu: High-Performance Quantum Computing Toolkit for Rust and WebAssembly

## Executive Summary

**ruqu** is an advanced, dependency-light quantum computing toolkit developed in pure Rust, designed to provide high-performance quantum circuit simulation and algorithm execution across native and web environments. By leveraging WebAssembly (WASM), ruqu enables complex quantum simulations—traditionally reserved for heavy Python-based stacks or expensive hardware—to run directly in browsers or via a one-line terminal command.

The toolkit functions as a "pretend quantum computer" that executes on standard hardware, offering an exact state-vector simulation of up to 32 qubits (native) or 25 qubits (browser). Beyond simulation, ruqu distinguishes itself through a novel "coherence engine" that acts as a classical nervous system for quantum machines, assessing real-time stability to mitigate errors. Its "batteries-included" approach provides production-ready implementations of VQE, Grover’s search, QAOA, and surface-code error correction, making it a comprehensive solution for research, education, and prototype development in the Noisy Intermediate-Scale Quantum (NISQ) era.

---

## Core System Architecture

The ruqu ecosystem is structured as a Rust workspace comprising five primary crates, each serving a distinct role in the quantum execution stack.

### The Five Crates of ruqu

| Crate | Primary Function | Key Features |
| :--- | :--- | :--- |
| **ruqu-core** | State-vector circuit simulator | SIMD acceleration (AVX2/NEON), multi-threading (Rayon), 5 simulation backends, and noise models. |
| **ruqu-algorithms** | Production quantum algorithms | Implementations for VQE (chemistry), Grover’s (search), QAOA (optimization), and Surface Code (error correction). |
| **ruqu-wasm** | WebAssembly bindings | Enables 25-qubit simulations in JavaScript/TypeScript/Node.js with zero native dependencies. |
| **ruQu** | Coherence engine | A "quantum execution intelligence engine" using dynamic min-cut for real-time coherence assessment. |
| **ruqu-exotic** | Experimental AI hybrids | Quantum-classical hybrid tools including memory decay, interference search, and swarm interference. |

---

## Detailed Analysis of Key Themes

### 1. High-Performance Simulation & Automation
The toolkit is built for speed and portability. Unlike traditional quantum toolkits that rely on Python or C++ FFI (Foreign Function Interface), ruqu's pure Rust implementation ensures memory safety and easy embedding.

*   **SIMD Acceleration:** Uses vectorized kernels to achieve a 2–4× speedup.
*   **Cost-Model Planner:** Rather than manual backend selection, ruqu's intelligence layer inspects circuit parameters (qubit count, gate mix, T-count) and auto-routes the workload to the most efficient backend (e.g., StateVector for small exact circuits, Stabilizer for millions of Clifford-only qubits).
*   **Mixed Precision:** Allows users to alternate between f32 and f64 precision to balance speed and accuracy.

### 2. The Coherence Engine (ruQu)
Described as a "nervous system for quantum machines," the ruQu crate represents the toolkit’s most innovative contribution. It monitors the health of a quantum operation in real time.
*   **Dynamic Min-Cut:** Analyzes error patterns to make PERMIT, DEFER, or DENY decisions for each operation.
*   **Latency:** Operates with a 468 ns P99 latency, capable of 3.8 million decisions per second.
*   **Predictive Safety:** In testing, it flagged structural breakdowns a median of 4 cycles before failure with 85.7% recall.

### 3. "Batteries-Included" Algorithms
ruqu provides ready-to-use implementations of industry-standard quantum algorithms:
*   **VQE (Variational Quantum Eigensolver):** Used for finding ground-state energies in quantum chemistry.
*   **QAOA (Quantum Approximate Optimization Algorithm):** Targeted at combinatorial optimization, such as MaxCut problems.
*   **Grover’s Search:** Provides a quadratic speedup for unstructured search tasks.
*   **Surface Code:** A distance-3 simulation for studying quantum error correction (QEC) via syndrome decoding and noise injection.

### 4. Accessibility via WebAssembly and CLI
One of ruqu's primary goals is removing the barrier to entry for quantum computing. 
*   **Zero Install:** Using `npx @ruvector/ruqu`, users can run simulations from any terminal.
*   **Browser-Native:** The `ruqu-wasm` package allows for the creation of interactive quantum widgets or educational tools that run entirely client-side, avoiding the need for backend servers or cloud credits.

---

## Technical Specifications and Limits

While powerful, ruqu is governed by the mathematical realities of classical simulation.

*   **State-Vector Limits:** Exact simulation is limited by memory. Each additional qubit doubles the memory requirement.
    *   **Native Rust:** Up to 32 qubits.
    *   **Browser/WASM:** Up to 25 qubits (~1 GB RAM).
*   **Stabilizer Backend:** Can handle millions of qubits, but only for Clifford-only circuits (Gottesman–Knill theorem).
*   **Noise Modeling:** Supports depolarizing, amplitude damping, phase damping, thermal relaxation, and custom Kraus operators.
*   **OpenQASM 3.0:** Supports exporting circuits to standard OpenQASM 3.0 for interoperability with other quantum tools.

---

## Important Quotes and Context

> **"ruqu is a pretend quantum computer that runs on your normal laptop — a tiny, fast program that acts exactly like a real quantum machine so you can build and test quantum ideas before the expensive hardware exists."**
*Context: A high-level explanation designed for non-technical users to understand the value proposition of a simulator versus physical hardware.*

> **"The coherence engine turns a quantum computer 'from a fragile experiment into a self-aware machine' which is exactly the missing piece for running long, trustworthy quantum jobs."**
*Context: Describing the strategic importance of the ruQu crate in moving beyond simple simulation toward managed quantum execution.*

> **"No Python, no C++, no heavyweight dependencies."**
*Context: Emphasizing the portability and ease of use compared to industry-standard tools like Qiskit or Cirq, which require complex environments.*

> **"Is it still safe to act, or is this thing about to fall apart?"**
*Context: The fundamental question the coherence engine answers through its real-time PERMIT / DEFER / DENY light system.*

---

## Actionable Insights for Implementation

### Deployment Pathways
1.  **For Rapid Prototyping:** Use `npx @ruvector/ruqu simulate --qubits 4` to immediately validate a circuit without any local installation.
2.  **For Web Integration:** Use the `@ruvector/ruqu-wasm` package to build client-side educational tools or demos that require no server-side quantum processing.
3.  **For High-Performance Research:** Integrate `ruqu-core` directly into Rust projects to utilize SIMD acceleration and Rayon-based multi-threading for circuits up to 32 qubits.
4.  **For Error Mitigation Studies:** Utilize the `SurfaceCode` implementation in `ruqu-algorithms` to test syndrome decoding against realistic noise models (depolarizing/damping).

### Maturity and Versioning Note
Users should be aware of the varied maturity levels across the workspace:
*   **Rust Workspace:** v2.2.3
*   **CLI (@ruvector/ruqu):** v0.2.0
*   **Status:** The coherence engine is currently in v0.3–0.4, with full hardware validation (v1.0) listed as a planned roadmap item. The `ruqu-exotic` crate remains explicitly experimental for research purposes.