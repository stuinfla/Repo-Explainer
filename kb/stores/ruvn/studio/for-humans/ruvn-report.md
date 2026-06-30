# Briefing: ruvn Research Agent Harness

## Executive Summary

ruvn is a specialized research agent "harness" designed to transform complex research questions into rigorously graded and cited evidence dossiers. Originally developed for the **ruv-neural** project to investigate 40 Hz gamma-entrainment protocols, the tool is a general-purpose pipeline that can be applied to any research domain. 

Unlike standard AI chatbots that may blend reliable and unreliable information into a single response, ruvn employs a disciplined six-agent pipeline. This architecture ensures that every claim is filtered through specific grading and verification gates. The system’s primary value proposition is the creation of a **defensible research artifact**—a Markdown dossier containing a TL;DR, a body with inline citations, and a bibliography where every source is assigned a letter grade (A/B/C/D) based on authority, freshness, and relevance.

ruvn is not a standalone model or hosted service; it is an npm package (`@ruvnet/ruvn`) that integrates directly into existing AI coding hosts such as Claude Code, GitHub Copilot, and Codex.

---

## Detailed Analysis of Key Themes

### 1. The Disciplined Research Pipeline
The core of ruvn is its sequential six-agent pipeline. A fundamental rule of this system is that **each agent only sees the output of the previous agent**, rather than the raw inputs. This forces information to pass through grading and verification gates before reaching the final dossier.

| Step | Agent | Model Tier | Function |
| :--- | :--- | :--- | :--- |
| 1 | **scout** | Sonnet | Decomposes the research question into 3–7 precise, standalone subqueries. |
| 2 | **web-searcher** | Haiku | Executes subqueries via WebSearch MCP and collects raw hits (URL, title, snippet). |
| 3 | **source-grader** | Sonnet | Fetches each URL and assigns a grade (A–D) based on specific rubric criteria. |
| 4 | **synthesizer** | Sonnet | Writes findings using **only** Grade A and B sources; identifies contradictions. |
| 5 | **fact-checker** | Sonnet | Adversarially verifies claims; strips any statement that is "UNSUPPORTED." |
| 6 | **citer** | Sonnet | Performs the final pass, adding inline citations and rendering the graded bibliography. |

### 2. Evidence Grading Rubric
The "source-grader" agent applies a strict rubric to ensure the integrity of the final synthesis. The system is designed to prioritize primary sources and recent data.

*   **Grade A (Primary):** Official documents or papers, less than 2 years old, highly on-topic.
*   **Grade B (Secondary):** Reputable secondary sources (expert blogs, major outlets), less than 5 years old.
*   **Grade C (Tertiary):** Informational context only (e.g., Wikipedia). These are not used as evidence in the synthesis.
*   **Grade D (Discarded):** Forums, unsourced claims, broken links, or irrelevant content.

**Critical Constraint:** The synthesizer is strictly prohibited from using any information graded C or D.

### 3. Architecture and Host Integration
ruvn is built as a "harness" that adds discipline to the AI models provided by a user's host environment. It utilizes the `@metaharness/kernel` for orchestration and memory but performs no model calls itself. 

The package ships with configurations for **nine different hosts**:
*   **Claude Code:** `.claude/settings.json`, `.claude-plugin/plugin.json`
*   **Codex:** `.codex/config.toml`, `AGENTS.md`
*   **GitHub Copilot:** `.vscode/mcp.json`, `.github/copilot-instructions.md`
*   **Additional Hosts:** OpenCode, GitHub Actions, pi-dev, Hermes, OpenClaw, and RVM.

### 4. Scope, Safety, and Limitations
While ruvn was birthed from medical research (gamma-entrainment), the documentation explicitly defines its boundaries:
*   **Not an Oracle:** It is a research tool meant to provide a "starting dossier to verify," not a final conclusion.
*   **No Medical Advice:** It does not provide medical advice or make efficacy claims.
*   **Dependency:** The quality of the output is heavily dependent on the host model's intelligence and its ability to access the web.
*   **Version Status:** Currently at **v0.1.1**, indicating it is an early-stage tool.

---

## Important Quotes

### On Trust and Methodology
> "Most 'ask an AI' research blends good and bad sources into one confident answer. ruvn refuses to." 

### On the Nature of the Output
> "The point is trust... what you get back is a starting dossier you can defend, with receipts."

### On Systematic Discipline
> "No claim ships without a receipt." (Referring to the requirement that every statement in the dossier must cite a graded source.)

### On the Role of the User
> "Treat its output as a starting dossier to verify, not a conclusion."

---

## Actionable Insights

### Implementation Requirements
*   **Environment:** Requires **Node.js version 20** or higher.
*   **Installation:** Can be installed via npm: `npm i -g @ruvnet/ruvn`.
*   **Initialization:** Run `ruvn init` to set up the kernel and host adapters (e.g., for Claude Code).
*   **Verification:** Use `ruvn doctor` to run four pass/fail checks to ensure the kernel, backend, and host adapters are functioning correctly.

### Workflow Integration
*   **Validation:** For users with an OpenRouter API key, the system can be validated end-to-end using `npm run validate:openrouter`. This exercises each agent against its designated model tier (Sonnet or Haiku).
*   **Research Execution:** Once initialized, users can trigger the pipeline within their preferred host (like Claude Code) by asking the model to run the research pipeline on a specific query.
*   **Evidence Handling:** Users should expect a Markdown dossier as the final product. This artifact is intended to be shared with reviewers or clinicians as a baseline of evidence-backed data points.

### Strategic Use Case: ruv-neural
For those involved in the **ruv-neural** project, ruvn serves as the "research front-end." While ruvn gathers and grades evidence regarding 40 Hz stimulation modalities and safety, the ruv-neural OS is used to actually run, measure, and sign the research protocols.