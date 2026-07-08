# Gathering Architect — Primer

## 1. What is Gathering Architect?

Gathering Architect is a coaching-first Claude Code plugin (a "skill") that helps you design gatherings where people actually connect, learn, and leave changed. It is not a template generator or an agenda machine. It is a structured conversation partner that works exactly like a good human facilitator would: by asking you the right questions before recommending anything.

It handles workshops, meetups, hackathons, team sessions, learning cohorts, and any gathering where you want more than a schedule — you want an experience that works. Created by Klara Hermesz (Co-founder & Chief Learning Architect, AI Enablement Academy), released under CC BY 4.0, v3.0.0.

## 2. What can Gathering Architect do for you?

- **Diagnose purpose before logistics** — It asks 2-3 sharp questions about *why* you are gathering before recommending any activities, because every decision (who to invite, how to open, which methods to use, how to close) flows from purpose.
- **Recommend the non-obvious** — Instead of "do an icebreaker," it gives specific methods with reasoning: "Try Impromptu Networking instead of round-robin intros. Pairs rotate every 3 minutes, everyone talks to 5 people in 15 minutes, and introverts get 1-on-1 safety instead of spotlight pressure."
- **Design for introverts by default** — Every agenda includes processing time, small-group options, and write-before-speak patterns without you having to ask.
- **Think in energy, not just time** — It uses the Kaospilot Learning Arch (SET / HOLD / LAND) to sequence activities for emotional flow, not just clock management. SET = connection and safety; HOLD = challenge and content; LAND = reflection and commitment.
- **Name what can go wrong** — It flags when a draft agenda has three high-energy activities in a row with no reflection, or when a 2-hour passive-listening block will kill the room.
- **Give you an honest gut-check** — A good coach will gently name the uncomfortable possibility, including whether the gathering should happen at all. Gathering Architect does this.
- **Back claims with defensible evidence** — Named, peer-reviewed sources only (Freeman et al. 2014 in PNAS on active learning; Edmondson 1999 on psychological safety). No round, dramatic blog numbers.
- **Produce tangible artifacts** — Five ready-to-use workshop templates on demand.

## 3. What is Gathering Architect made of?

The repository is a Claude Code / Cowork plugin marketplace (no traditional source code). Its substance lives entirely in Markdown:

**The skill itself:**
- `SKILL.md` — The complete coaching AI: voice, philosophy, four coaching phases, method library, reference routing table, and external resources.
- `CHANGELOG.md` — Version history (v2.0.0 first public release; v3.0.0 stronger coaching + cleaner evidence).

**Five reference libraries (on-demand, loaded only when relevant):**
- `references/facilitation-methods.md` — 20+ methods with full step-by-step instructions: Liberating Structures (1-2-4-All, Troika Consulting, World Café, Open Space Technology, Fishbowl, Impromptu Networking, TRIZ, Min Specs), Hyper Island methods (IDOARRT, Marshmallow Challenge, Human Spectrogram), workshop design formats (hands-on build sessions, pair/mob programming, Show & Tell).
- `references/community-frameworks.md` — Deep frameworks: Community Canvas (17 themes across Identity, Experience, Structure), Community Weaving (Fire/Web/Rhythm/Circles/Spiral arc), Wenger's Communities of Practice, Tacit Maturity Model, JRC Playbook.
- `references/hackathons-and-builds.md` — Hackathon, unconference, and design sprint formats (the event-wrapper application of Open Space Technology; BarCamp variant).
- `references/social-learning-evidence.md` — Research backbone: Bandura (1977), Vygotsky's ZPD, Lave & Wenger's situated learning, Edmondson's psychological safety, Freeman et al. active-learning meta-analysis. Marks which findings are solid and which are practitioner heuristics.
- `references/facilitator-pain-points.md` — Common mistakes, advanced challenges, non-obvious event design wisdom, community-building pitfalls, what experienced facilitators wish they'd known.

**Five workshop templates (assets, on offer):**
- `assets/mvc-worksheet.md` — 9-question Minimum Viable Community sprint (30-45 min, 3-5 stakeholders). For validating whether a community is worth building.
- `assets/idoarrt-template.md` — 6-field meeting design tool. For any meeting longer than 30 minutes where the purpose is not obvious to everyone walking in.
- `assets/run-of-show-template.md` — Full agenda with SET/HOLD/LAND phases, energy notes, and pre-event checklist. For sessions 90 minutes or longer.
- `assets/community-canvas-runner.md` — Facilitator's guide for running a full 17-theme Community Canvas workshop.
- `assets/agenda-builder-prompt.md` — Structured input form for generating a fast first-draft agenda. For when you're stuck.

**Plugin manifests:**
- `.claude-plugin/marketplace.json` — Marketplace catalog; declares the plugin for discovery.
- `plugins/gathering-architect/.claude-plugin/plugin.json` — Plugin manifest (name, author, version, license, keywords).

## 4. How the coaching flow works

The skill runs four progressive phases. You do not need to know the phases; the AI manages them conversationally.

**Phase 1 — Gentle Diagnostic (first response, always short):**
Acknowledge what you shared, ask 2-3 of the most important diagnostic questions, offer one reframing idea. Never dump an agenda on the first response. Even under deadline pressure, it promises the deliverable and still asks the questions that change the shape of the day.

**Phase 2 — Recommendations (after you answer):**
Specific method recommendations grouped by impact (high / medium / low tiers) with reasoning. Ends with a question so you steer. For troubleshooting scenarios (attendance dropping, disengaged cohort), groups as: quick wins / structural changes / longer-term shifts.

**Phase 3 — Emotional Arc (when building full agendas):**
Thinks in energy flow, not just time blocks. SET / HOLD / LAND is used internally as a compass; you see it expressed in how activities are sequenced and in parenthetical energy notes like "(energy: high → reflective → warm close)".

**Phase 4 — Artifacts (on offer):**
Describes what each template gives you and asks if you want it filled in or delivered as a worksheet. Never pastes the whole template into chat unsolicited.

## 5. Is it production-ready? Scope and honest limits

Yes and no. The skill itself is stable and polished at v3.0.0 (CC BY 4.0). The coaching flow, method library, and evidence base are well-tested in real facilitation contexts.

Honest limits:
- It is a *starting point*, not a substitute for a human facilitator reading the room in real time.
- It cannot observe your participants' body language, energy level, or cultural dynamics. It works from what you tell it.
- Evidence quality varies: it explicitly labels which findings are solid (named, peer-reviewed) and which are practitioner heuristics. Check the evidence reference before quoting a figure to a skeptical stakeholder.
- The "honest gut-check" instinct means it will sometimes tell you your gathering shouldn't happen. This is a feature, not a bug.

## 6. Where do I read more?

- `README.md` — Install instructions, file tree, license, credits.
- `SKILL.md` — Full coaching logic, voice, method library, reference routing table.
- `references/` — Deep reference libraries (loaded on demand by the AI, not all at once).
- `assets/` — Five workshop templates (run with stakeholders, not alone).
- External: [SessionLab](https://www.sessionlab.com), [Liberating Structures](https://www.liberatingstructures.com), [Hyper Island Toolbox](https://toolbox.hyperisland.com), [Community Canvas](https://community-canvas.org), Priya Parker *The Art of Gathering*, Etienne Wenger *Communities of Practice*.

## 7. How do I install and use it end-to-end?

**Via Claude Code (terminal):**
```
/plugin marketplace add klarahermesz/gathering-architect
/plugin install gathering-architect@gathering-architect
```

Then describe a gathering you are planning, or invoke directly:
```
/gathering-architect:gathering-architect
```

**Via Cowork (Claude desktop app, no terminal needed):**
1. Download `gathering-architect-cowork-plugin.zip` from the repo (click the file → "Download raw file").
2. Open Claude desktop app → Cowork tab → Customize.
3. Add plugin → Upload a file → select the zip.
4. Start a Cowork chat, type `/` and pick `gathering-architect` — or just describe your event.

**What to expect in your first session:**
The AI will acknowledge what you shared, ask 2-3 clarifying questions (typically: what do you want people to leave with? what vibe — buzzy or reflective? do they know each other?), and offer one reframing idea. Answer those, and it will give you specific method recommendations grouped by impact. From there you can ask for a full agenda, a specific template (like the Run of Show or IDOARRT), or deeper instructions for any method.

The skill automatically designs for introverts, thinks in energy arcs, and names failure modes without you having to ask.
