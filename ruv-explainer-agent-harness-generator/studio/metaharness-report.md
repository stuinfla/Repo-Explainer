# MetaHarness: Project Analysis and Briefing Document

## Executive Summary

MetaHarness is a local-first, client-side factory for AI agent frameworks. Rather than acting as another standalone agent, it generates custom, branded, and npm-publishable "harnesses" from any GitHub repository or blank slate. A harness functions as a specialized wrapper around existing Large Language Models (LLMs) like Claude or GPT, providing them with repo-aware skills, scoped memory, and governance policies.

The tool aims to solve three primary problems: model and framework lock-in, host fragmentation across various AI platforms, and the constant reinvention of agentic infrastructure. By automating the creation of MCP servers, memory namespaces, and release gates, MetaHarness allows developers to ship repo-tuned agents as versioned dependencies (via `npx`) in under 60 seconds.

Currently in **v0.1.x beta**, MetaHarness features a Rust-based kernel, supports nine host integrations, and includes "Darwin Mode" for self-evolving configurations.

---

## Key Themes Analysis

### 1. The "Harness" vs. The Framework
A central tenet of the project is that the model is replaceable while the harness is the product. Most frameworks require developers to build agents; MetaHarness helps repositories ship their own agents.
*   **Definition:** A harness is not the AI "brain" but the infrastructure around it—identity, branding, skills, memory, and safety nets.
*   **Function:** It turns a generalist AI into a specialist that "knows" a specific project’s file layout, billing rules, and safety constraints.

### 2. Economic Optimization and Model Routing
MetaHarness emphasizes cost-efficiency through its "Router" and the DRACO benchmark.
*   **The Router:** Using `@metaharness/router`, the system routes queries to the cheapest model predicted to meet the required quality bar based on local evaluation logs.
*   **DRACO Benchmark:** This internal benchmark demonstrates that a well-harnessed small model can deliver frontier-quality research at approximately **one-tenth the cost** of larger models.

### 3. Security and "Default-Deny" Governance
The architecture prioritizes security through a strict "default-deny" policy for all generated tools.
*   **MCP Safeguards:** Generated MCP servers ship with no network, shell, or file-write access by default. Dangerous actions require explicit approval.
*   **Provenance:** Every release is signed with an **Ed25519 witness manifest**, allowing users to verify that a harness has not been tampered with before execution.
*   **Static Analysis:** The `metaharness score` and `genome` commands perform deterministic static analysis, meaning they read repository metadata without ever executing the code.

### 4. Self-Evolution (Darwin Mode)
Newer scaffolds include "Darwin Mode," an experimental feature where the harness improves its own configuration.
*   **Mechanism:** The harness mutates its config, tests changes in a sandbox, and retains only those that measurably improve performance against a fitness function.
*   **Safety:** This process happens while the underlying model remains frozen, ensuring the "evolution" is limited to the harness's logic and tuning.

---

## Technical Infrastructure and Host Support

MetaHarness supports nine distinct host environments, allowing a single generated harness to run across multiple platforms.

| Host | Integration Method | Stability Status |
| :--- | :--- | :--- |
| **Claude Code** | MCP server + hooks + 3-scope settings | Stable |
| **OpenAI Codex** | MCP via config.toml | Stable |
| **pi.dev** | Pi extension via registerTool() | Stable |
| **Hermes** | MCP runtime + thinking scrubbing | Stable |
| **OpenClaw** | workspace skills | Stable |
| **RVM** | Bare-metal microhypervisor | Stable |
| **GitHub Copilot** | MCP via .vscode/mcp.json | New (ADR-032) |
| **OpenCode** | MCP via .opencode/opencode.json | New (ADR-036) |
| **GitHub Actions** | Composite action.yml | New (ADR-033) |

---

## Important Quotes with Context

> **"It is not another agent framework. It is a factory for agent frameworks. The model is replaceable. The harness is the product."**
*   **Context:** This quote defines the project's market position. It emphasizes that MetaHarness provides the "plumbing" (the harness) and treats the AI model as a modular component.

> **"Every serious repo deserves its own agent."**
*   **Context:** The founding philosophy of MetaHarness is that repo-aware CLIs and agents should be standard for any project, providing project-specific memory and governance.

> **"Default-deny is a feature with a cost."**
*   **Context:** Found in the user limits section, this warns developers that while the security is high, they must explicitly spend time allowing specific tools/permissions because the system starts with zero access.

> **"Stop paying frontier prices for work a $0.10 model does just as well."**
*   **Context:** Used to promote the `@metaharness/router`, highlighting the project's focus on breaking the reliance on expensive models for routine tasks.

---

## Use-Case Scenarios

| Situation | Actionable Command | Outcome |
| :--- | :--- | :--- |
| **Pre-Analysis** | `npx metaharness score <repo>` | A report card on fit, cost per run, and tool safety. |
| **Standard Scaffolding** | `npx metaharness --wizard` | A 4-question interactive setup for a new harness. |
| **Vertical Deployment** | `npx @metaharness/devops my-bot` | A ready-made incident response pod for DevOps. |
| **Integrity Check** | `harness verify` | Confirmation that the witness signature is untampered. |
| **Cost Savings** | `npm i @metaharness/router` | Automated routing to the cheapest capable model. |
| **Ejection** | `harness eject` | Lifting custom agents from a `ruflo` install into a new branded harness. |

---

## Actionable Insights

1.  **Perform "Genome" Scoring Before Scaffolding:** Use `harness genome <repo>` to determine if a repository is ready for an agent. This avoids building harnesses for "needs-work" or "blocked" repositories.
2.  **Standardize Team AI with npm:** Organizations should publish their harnesses as private npm packages. This ensures every team member runs the same `npx @org/harness` command, providing a consistent, repo-tuned experience across the organization.
3.  **Utilize Darwin Mode for Continuous Tuning:** For complex engineering tasks, enable Darwin Mode to allow the harness to self-refactor its configurations based on real-world bug-fixing performance (validated on SWE-bench Lite).
4.  **Enforce Security via MCP-Scan:** Integrate `harness mcp-scan` into CI/CD pipelines. This acts as an "npm audit" for agent tools, flagging shell/network grants and unpinned dependencies before they reach production.
5.  **Leverage the Router for High-Volume Tasks:** For projects requiring deep research or high-volume processing, implement the `@metaharness/router` to achieve "frontier-quality" results at one-tenth the cost.

---

## Documented Limits and Constraints

*   **Beta Status:** The project is in v0.1.x beta. Documentation and credibility reconciliation (Issue #4) are ongoing.
*   **Documentation Lag:** There are inconsistencies between the code (which supports 9 hosts) and the documentation (which often cites 4 or 6). Similarly, test counts vary between 568 and 605 across different files.
*   **Static-Only Analysis:** Analysis is intentionally shallow and read-only. It does not execute code; the output is a "strong starting point" that requires manual prompt and tool tuning.
*   **Local-First Architecture:** There is no hosted backend or telemetry. The Studio is 100% client-side (GitHub Pages), and the CLI runs entirely locally.