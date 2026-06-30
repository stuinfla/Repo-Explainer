# PhotonLayer: Auditable Optical Compression and Task-Trained Optics

## Executive Summary

PhotonLayer is a deterministic optical-AI front end implemented in pure Rust. It reimagines the traditional imaging pipeline by performing task-specific analog preprocessing directly in the optical domain before light is digitized. By placing a learned "phase mask"—a specially-shaped piece of smart glass—in front of a sensor, the system bends incoming light to compress task-useful information into a small number of sensor pixels. This approach allows a system to "capture the answer" rather than recording a full-resolution image and processing it digitally.

Currently existing as a high-fidelity software simulator, PhotonLayer achieves significant data reduction, demonstrating a 16× reduction in sensor pixels and digital Multiply-Accumulate (MAC) operations with minimal accuracy loss on benchmarks like MNIST. The system distinguishes itself through a commitment to absolute reproducibility; every execution generates a tamper-evident, BLAKE3-bound cryptographic receipt that proves exactly what was measured and decided.

## Core Theme Analysis

### 1. Optical Compression: "The Wedge"
PhotonLayer is explicitly defined not as a general-purpose "optical neural network," but as **auditable optical compression for task-useful sensing**. In a standard imaging system, a camera captures every pixel of a scene, creating a massive data overhead and potential privacy leaks. PhotonLayer "flips the order" by using a learned phase mask to perform a trained analog transform on light. 

The resulting sensor measurement is a compressed summary rather than a viewable photo. This provides four primary benefits:
*   **Reduced Capture:** Uses a few sensor pixels instead of a full image.
*   **Faster Decisions:** The "heavy lifting" occurs passively in the optics through free-space diffraction.
*   **Reduced Leakage:** The sensor records a compressed measurement that does not look like the original scene.
*   **Provability:** Every run emits a deterministic receipt.

### 2. Training Methodologies and "Ceiling Breaking"
The system utilizes two primary methods for training the optical phase masks, moving from simple optimization to advanced analytic gradients:

*   **Hill-Climbing:** A trial-and-improvement method that perturbs the mask and retains changes that improve accuracy. This method typically hits an optimizer ceiling (approx. 73% accuracy on MNIST at 16× compression).
*   **Analytic Gradient Descent:** This represents the "headline" achievement of the project. By using a proven adjoint of the diffraction operator (`Propagator::backward_into`), gradients flow back through the optics. This allows for direct training via Adam, breaking the single-mask ceiling to reach **83.30%** accuracy.
*   **Multi-Plane Diffractive Cascade:** By stacking multiple phase planes with free-space propagation between them, the system can reach **88.80%** (2 planes) or **89.80%** (3 planes) accuracy while maintaining 16× compression.

### 3. Determinism and Cryptographic Auditability
The project's primary competitive advantage—its "moat"—is bit-identical reproducibility. PhotonLayer uses a custom scalar Complex type and a hand-rolled FFT with a fixed reduction order to ensure that the same input, mask, and seed produce identical results on x86-64 architectures.

This determinism enables the generation of **BLAKE3-bound receipts**. These receipts hash the model, configuration, measurement, and decision into a single digest. This transforms a result from a mere claim into a reproducible experiment that can be verified by third parties or auditors.

## Measured Results: MNIST Optical Compression

The following table outlines the performance of various configurations against a full-image baseline using a tiny nearest-centroid decoder.

| Configuration | Sensor Pixels | Decoder Params | Accuracy | Delta vs Baseline |
| :--- | :--- | :--- | :--- | :--- |
| **Full-Image Baseline** | 1024 | 10,240 | 75.40% | — |
| **Optical (Hill-Climb Mask)** | 64 | 640 | 73.05% | -2.35 pp |
| **Optical (Gradient-Trained)** | 64 | 640 | **83.30%** | **+7.90 pp** |
| **Optical (2-Plane Cascade)** | 64 | 640 | **88.80%** | **+13.40 pp** |

**Note on Accuracy:** The superior performance of the gradient-trained optical system over the baseline (83.30% vs 75.40%) is a statement on **feature separability under a fixed weak decoder**. It indicates that 64 learned optical features are more linearly separable than 1024 raw pixels, rather than a claim that optics outperform all digital methods (as a CNN on the same 1024 pixels reaches ~99%).

## System Architecture

### The Four Crates
PhotonLayer is organized as a Rust workspace consisting of four distinct crates:

| Crate | Functionality |
| :--- | :--- |
| `photonlayer-core` | The optical simulator. Handles scalar diffraction (Fresnel/Fraunhofer), deterministic FFT, phase masks, and BLAKE3 receipts. |
| `photonlayer-bench` | Benchmarks and training. Contains MNIST benchmarks, hill-climb and gradient training logic, and privacy probes. |
| `photonlayer-wasm` | WebAssembly bindings enabling the live browser-based demo and playground. |
| `photonlayer-cli` | Command-line driver for subcommands like `bench`, `barcode`, `edge`, and `verify-receipt`. |

### The Optical Pipeline
The core pipeline follows a deterministic five-stage chain:
1.  **InputImage:** The source scene is converted into an `OpticalField`.
2.  **PhaseMask:** A trained pattern of phase shifts is imprinted onto the light.
3.  **Propagation:** The field moves through free space via scalar diffraction models.
4.  **Capture:** The sensor records intensity, average-pooling the field into a compressed measurement.
5.  **Decoder & Receipt:** A tiny digital program interprets the measurement and signs the result.

## Honest Scope and Limitations

The documentation emphasizes several critical caveats regarding the current state of the project:
*   **Simulator Status:** The project is currently a software simulator. While the physics and training are real, physical hardware implementation is still on the roadmap.
*   **Not Absolute SOTA:** The goal is competitive single-layer compression, not setting new state-of-the-art accuracy records for MNIST (where multi-layer CNNs still dominate).
*   **Privacy vs. Security:** While PhotonLayer captures "less" information, it offers **no formal privacy or security guarantee**. Linear reconstruction may fail, but nonlinear (CNN-based) reconstruction is expected to succeed. It is "privacy-by-physics," not zero-knowledge.
*   **MAC Reduction:** The 16× reduction claim applies only to the **digital decoder**. The optical transform is passive in hardware but consumes compute resources within the simulator.
*   **Cross-Platform Determinism:** While bit-identity is verified on x86-64, it is not yet proven across Linux, macOS, and WASM due to variations in platform `libm` transcendentals (sin/cos).

## Key Quotes with Context

> **"The camera no longer captures the image. It captures the answer shaped by physics."**
*   *Context:* Found in the `photonlayer-core` documentation, this summarizes the fundamental shift from traditional "capture everything" imaging to task-specific "capture the answer" sensing.

> **"It's like a translator who listens to a whole speech and hands you a one-line summary — you never needed the full transcript to act on it."**
*   *Context:* A plain-language analogy used to explain how the phase mask summarizes information in the light itself before digitization.

> **"Capture less · decide faster · leak less · prove what happened."**
*   *Context:* The core mantra of the PhotonLayer project, highlighting the four pillars of its value proposition.

> **"Hill-climbing converges to an optimizer ceiling (~73%); analytic gradient descent breaks it to 83.30%."**
*   *Context:* Highlights the technical breakthrough achieved by implementing a differentiable training head and an adjoint of the diffraction operator.

## Actionable Insights and Implementation

### Demonstration Pathways
For those seeking to evaluate the system, the repository provides a "ladder" of runnable examples:
*   **Visualizing Compression:** Run `cargo run --example compression` to see a side-by-side ASCII comparison of a 64x64 input and its compressed 8x8 sensor measurement.
*   **Verifying Receipts:** Use `cargo run --example receipt` to generate a receipt, verify it passes, tamper with one byte, and watch it fail.
*   **Gradient Training:** Run `cargo run --example gradient_training` to reproduce the 83.30% accuracy result in approximately 24 seconds.

### Roadmap and Future Development
The project outlines a clear path toward physical realization:
1.  **Analytic Adjoint Refinement:** Continuing to push the limits of cascaded planes.
2.  **FiberGate:** Simulating multimode-fiber transmission-matrix substrates with drift-aware training.
3.  **Hardware Bridge:** Developing a DiffuserCam-style lensless camera as the first physical demonstration, preceded by a phase-quantization sweep to prepare for fabrication.