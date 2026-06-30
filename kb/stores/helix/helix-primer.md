# helix — Human Primer

## 1. What is helix

Helix is a Rust workspace for personal health intelligence, built under the banner "Personal Health Intelligence (PHI)" by ISO Vision LLC. The project started on 2026-06-25 and is hosted at [github.com/ruvnet/helix](https://github.com/ruvnet/helix).

The core design premise is that health and genomic data should never leave the user's device in a readable form. The architecture is described as "can't, not just won't": no decryption keys are held server-side, so the company is structurally unable to read, sell, or transfer user data — including in a bankruptcy scenario. The 23andMe Chapter 11 filing (March 2025), in which a genetic database of approximately 15 million customers became a court-supervised sale asset, is cited explicitly as the motivating failure mode Helix is designed to prevent.

The knowledge base is indexed into a 384-dimensional RVF store covering 576 passages, 27 components, and 1,629 public symbols.

---

## 2. What can it do for you

Helix integrates a wide range of health-adjacent capabilities into a single local-first system:

- **Encrypted health vault** — stores biomarker data, genomic files (raw VCF/genotype), and other health records using XChaCha20-Poly1305 (256-bit key, 192-bit nonce) with an AES-256-GCM fallback for FIPS contexts. All vault writes are authenticated encryption (AEAD); there is no separate MAC step.
- **Biological age estimation** — `helix-bioage` implements PhenoAge biological age calculation, exposed through the WASM layer with a non-diagnostic framing (e.g., "42.5 yrs / 7.5 younger").
- **Ambient / contactless sensing** — `helix-sensing` ingests WiFi-CSI readings from the RuView backend, maps semantic states (possible-distress/fall-risk → Critical; elderly-inactivity/apnea → Urgent) to an Escalation Guardian, and caps confidence at 0.5 with non-diagnostic framing throughout.
- **Genome ingestion and pharmacogenomics** — `helix-genome` handles genomic data ingestion with provenance records.
- **OCR-based lab PDF ingestion** — `helix-ocr` brings in lab results from PDFs.
- **Semantic retrieval over the health graph** — `helix-retrieval` and `helix-embed` provide vector/GraphRAG-style retrieval.
- **Score timelines and focus areas** — `helix-timeline` tracks scores over time; `helix-focus` handles focus-area selection.
- **Privacy-preserving cohort analytics** — `helix-cohort` applies cell-suppression (local k-anonymity proxy) and Laplace differential-privacy noise with an ε budget split across features, refusing to return results when suppression leaves nothing meaningful.
- **WASM dashboard** — `helix-wasm` exposes bioage, focus, and timeline as JSON-in/JSON-out functions, powering a "Health report" view with a score-over-time SVG sparkline, vitals table, focus cards, bio-age delta card, and recommendations feed.

---

## 3. What is it made of (the components)

The workspace contains 27 Rust crates:

| Crate | Role |
|---|---|
| `helix-provenance` | Provenance records; depended on by nearly every other crate |
| `helix-numeric` | Numeric utilities |
| `helix-evidence` | Evidence handling (depends on provenance) |
| `helix-escalation` | Escalation Guardian for triage flags |
| `helix-pipeline` | Orchestration pipeline (depends on escalation, evidence, numeric, provenance) |
| `helix-ontology` | Ontology definitions |
| `helix-verifier` | Verification (depends on evidence, provenance) |
| `helix-vault` | Encrypted local-first health vault (depends on provenance) |
| `helix-score` | Scoring logic |
| `helix-neural` | Neural/on-device inference (depends on provenance) |
| `helix-sensing` | WiFi-CSI ambient sensing (depends on escalation, provenance) |
| `helix-genome` | Genome ingestion (depends on provenance) |
| `helix-ocr` | OCR lab PDF ingestion (depends on provenance) |
| `helix-retrieval` | Vector/GraphRAG retrieval (depends on provenance) |
| `helix-cohort` | Privacy-preserving cohort analytics |
| `helix-visual` | Visual output |
| `helix-llm` | LLM integration |
| `helix-embed` | Embeddings (depends on provenance, retrieval) |
| `helix-vision` | Vision pipeline (depends on embed) |
| `helix-connect` | Connector abstraction (depends on provenance) |
| `helix-fed` | Federation (depends on cohort) |
| `helix-bioage` | PhenoAge biological age (depends on provenance) |
| `helix-focus` | Focus-area selection (depends on numeric, provenance) |
| `helix-timeline` | Score-over-time (depends on numeric, score) |
| `helix-evolve` | Evolutionary/optimization layer (depends on escalation, numeric, pipeline, provenance) |
| `helix-refranges` | Reference ranges (depends on provenance) |
| `helix-wasm` | WASM bindings — the widest fan-in, depending on most other crates |

**External dependencies** include: `chacha20poly1305`, `serde` / `serde_json`, `thiserror`, `zeroize`, `wasm-bindgen`, `wasm-bindgen-test`, `image`, `ureq`, `getrandom`, `criterion`, and `proptest`.

---

## 4. How it works

**Provenance as the backbone.** `helix-provenance` is the single most-depended-on crate in the graph. Every data ingestion path — sensing, genome, OCR, retrieval, bioage, connect, embed — emits provenance records. This enforces a rule stated explicitly in the codebase: provenance is required; recall does not equal grounding.

**Anti-hallucination guardrails.** Each adapter (sensing, genome, OCR, retrieval) applies capped confidence, a screening-not-diagnosis framing, and provenance-required checks. The sensing crate, for example, rejects unsigned or non-finite readings and caps confidence at 0.5. These are structural constraints, not runtime flags.

**Escalation routing.** `helix-escalation` receives triage flags from sensing (and other sources via `helix-pipeline` and `helix-evolve`) and routes them by severity: Critical, Urgent, or none.

**Vault encryption.** The key derivation follows a KEK/DEK pattern. The primary key lives in the device Secure Enclave or Android StrongBox, unlocked by biometric/PIN and not exportable. A passphrase-derived recovery key (Argon2id) provides cross-device and device-loss recovery. Optional Shamir Secret Sharing (e.g., 3-of-5 shares) distributes recovery capability further.

**WASM surface.** `helix-wasm` is the integration point for the browser/dashboard layer. It depends on the majority of other crates and exposes functions such as `bioage_json`, `focus_json`, and `timeline_json` as JSON-in/JSON-out calls, which the UI consumes to render the Health Report view.

**Federated cohort privacy.** `helix-fed` builds on `helix-cohort`, which applies local k-anonymity cell-suppression followed by Laplace DP noise with an ε budget split across features. Results are refused when suppression leaves nothing meaningful to return.

**Development loop.** The project was built through a tightly iterated loop: each iteration produced an Architecture Decision Record (ADRs 001–034+), a tested crate, and a clippy/fmt-clean push to main. The knowledge base records at least 6 named iterations between 2026-06-25 and 2026-06-26.

---

## 5. How do I install and use it

The brief records **no install instructions, no CLI entry-point commands, and no quickstart**. The repository has 0 registered entrypoint commands.

What is known:
- The project is a Rust workspace, so standard Cargo tooling applies (`cargo build`, `cargo test`).
- The WASM crate (`helix-wasm`) uses `wasm-bindgen` and `wasm-bindgen-test`, implying a `wasm-pack` build step for the browser target.
- The ledger mentions `cargo audit` as a recommended check.
- Property tests use `proptest`; benchmarks use `criterion`.
- A GitHub Pages deployment is referenced for the dashboard UI.

Beyond these inferences from the dependency list and ledger notes, no concrete setup steps can be stated without inventing them.

---

## 6. Honest scope and limits

**What this is not:**
- It is not a medical device and does not diagnose. Every ingestion path is explicitly framed as screening, not diagnosis. Confidence is capped structurally.
- It is not a finished product with a documented install path. No quickstart, no versioned release, and no CLI commands are recorded.

**Regulatory reality:**
- HIPAA applies only to covered entities. A direct-to-consumer health app is not automatically a HIPAA covered entity, and the ADRs acknowledge this gap explicitly.
- GINA does not govern how consumer apps handle genetic data, does not cover life/disability/long-term-care insurance, and does not prevent a genomic data company from sharing data with third parties.
- State genetic privacy law is described as "a patchwork, accelerating" — uneven and jurisdiction-dependent.
- GDPR Article 9 classifies health and genetic data as special categories. The local-first architecture is noted as aligned with GDPR data-minimization principles, but compliance depends on operational details not fully specified here.

**Technical limits noted in the ledger:**
- The WASM exposure, live UI panels, and COVERAGE.md refresh were listed as remaining polish items as of the recorded iterations — they may or may not be complete in the current state of the repo.
- The sensing crate is non-diagnostic by design; WiFi-CSI readings are research codes (RUVW-* prefix), not clinical measurements.
- The cohort privacy layer is a local k-anonymity proxy, not a formally audited DP implementation.
