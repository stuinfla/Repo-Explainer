# NotebookLM (`nlm`) — Capabilities & Auth Reference

*Recorded 2026-06-19. Confirmed working against the live account.*

## TL;DR
- **Not an `.env` secret.** `nlm` stores cookies in `~/.notebooklm-mcp-cli/profiles/default`. There is no token to add to `.env`. The durable fix for "auth expired" is the re-auth recipe below.
- **Account:** `sikerr@gmail.com` · profile `default`.
- **Install:** `notebooklm-mcp-cli` v0.4.9 → `/opt/homebrew/bin/nlm` (+ `/opt/homebrew/bin/notebooklm-mcp`).

## Re-auth recipe (when it expires)
```bash
nlm login --check        # is the current auth valid? (lists notebooks if yes)
nlm login                # re-auth HEADLESSLY from the saved Google Chrome profile — no interaction
nlm doctor               # full diagnosis (install, cookies, account, Chrome)
```
- `nlm login` re-authenticated headlessly on 2026-06-19 (39 cookies + CSRF), and `--check` then listed **78 notebooks** — that listing is the real proof of access, not just "cookies present."
- If headless ever fails: run Chrome in debug mode with the profile, or `nlm login --provider openclaw --cdp-url http://127.0.0.1:18800`.

## Capabilities (subcommands)
| Command | Does |
|---|---|
| `notebook` | create / manage notebooks |
| `source` | add sources to a notebook |
| `audio create` | **create an audio overview (podcast)** from sources |
| `report` / `quiz` / `flashcards` | generate written report / quiz / flashcards |
| `studio` | list / delete / rename studio artifacts (status/delete/rename) |
| `download` | download artifacts (audio, video, …) |
| `export` | export to Google Docs / Sheets |
| `research` | discover sources |
| `pipeline` | run multi-step pipelines |
| `batch` / `cross` | batch ops / cross-notebook queries |
| `chat` / `share` / `tag` / `setup` | chat config / sharing / tags / MCP-server setup for AI tools |

## How we use it for a primer's human half
1. `nlm notebook create` for the target repo.
2. `nlm source add` — the auto-drafted comprehension-arc doc + key repo docs.
3. `nlm audio create` (audio overview) + `nlm report`.
4. **Video, slides, infographic are ALL CLI-scriptable** (verified 2026-06-19 — the earlier "UI-only" note was stale): `nlm video create <id>`, `nlm slides create <id>`, `nlm infographic create <id>` (+ `mindmap`/`quiz`/`flashcards`), then `nlm download`. Make a notebook public + linkable with `nlm share public <id>`. No UI step required.

> Per ADR-0001 Part II D14, NotebookLM studio media is an *enhancement* layered after the two heroes (site + smart-zip) pass their quality gate — it never blocks them.
