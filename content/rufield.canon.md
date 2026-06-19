# RuField MFS — Canonical Newcomer Content

> **Single source of truth.** This file feeds the website, the KB primer, and the
> NotebookLM studio. All three must say the same true thing. Every non-obvious
> claim cites its source file in the cloned repo (`.targets/rufield/`).
> Audience: a **non-technical person who uses Claude Code** — comfortable running
> a command and reading a dashboard, but not a radio engineer.
>
> **Provenance.** Source repo: <https://github.com/ruvnet/rufield> (author **Reuven
> Cohen / @ruvnet**). HEAD sha at time of writing: **`509d8ae29e654a322910bd504d325b0dd1fdd895`**.
> Spec of record: ADR-260 (`docs/ADR-260-rufield-mfs.md`). Version: **rufield.mfs.v0.1**
> "reference stack" (README.md L9, L13-25).
>
> **Honesty banner (carried from the repo, non-negotiable).** Most of v0.1's numbers
> come from a **synthetic simulator** and are labelled SYNTHETIC — they prove the
> pipeline scores correctly against known truth, **not** real-world accuracy. One
> adapter ingests **real** WiFi signal (`CsiReplayAdapter`), but that is **replay
> from a recorded file, not live hardware**, and the recordings are **unlabeled**,
> so its output is a **physically-grounded proxy, not validated accuracy**. We say
> this plainly everywhere. (Source: README.md L13-25, L246-254.)

---

## 1. What it is (one plain sentence)

**RuField MFS is an open, free specification — plus a working Rust reference
build — for "camera-free field sensing": it takes the invisible signals already
bouncing around a room (WiFi, radar, ultrasound, infrared) and turns them into
one common, privacy-labelled stream of plain-English events like "someone is in
the room," "they sat down," "they left the bed" — with no camera, no microphone,
and a signed receipt proving where each reading came from.**
(Source: README.md L1, L29-57; ADR-260 §2-3, §7.)

The two words to demystify are in the name:
- **"Field"** = the invisible signals all around you right now. Your WiFi is
  constantly bouncing radio waves off everything in the room; a $10 radar chip
  sees motion through the air; a cheap thermal sensor sees body heat. A person
  moving slightly changes all of these. That changing pattern is the "field."
  (Source: ADR-260 §1, §4; README.md L29-49.)
- **"Multimodal Field Sensing Specification" (MFS)** = an agreed-upon *format* so
  that every one of those different sensors speaks the **same language**. Today
  WiFi, radar, and thermal each spit out their own incompatible gibberish.
  RuField is the translator that turns all of them into one tidy event everyone
  can read and combine. (Source: ADR-260 §4-5; README.md L31-54.)

**It is not a new gadget and not a new radio.** RuField sits *above* the existing
standards (WiFi sensing / 802.11bf, Bluetooth Channel Sounding, UWB, radar) — it
doesn't replace them, it makes their outputs fit together. (Source: README.md
L51-54; ADR-260 §2, §6.)

---

## 2. Translate the abstraction down to earth (kill the "spec" fog)

A "specification" sounds like a dry PDF. Here is what it actually buys a normal
person, in concrete terms:

- **Think of USB.** Before USB, every device had its own weird plug. USB was just
  an *agreement* on the shape of the plug — and suddenly any device worked with
  any computer. RuField is "USB for room-sensing": one agreed-upon shape so any
  sensor's reading drops into any app. (Grounding: the whole point of ADR-260 §4-5
  is that sensors are "locked into modality-specific silos" with no common format.)
- **The reference build proves it's real.** RuField isn't just the agreement on
  paper — it ships a *working* Rust program (eight crates) you can run today: feed
  it signals, watch it fuse them into room-state, see the privacy labels and the
  signed receipts. (Source: README.md L59-69; ADR-260 "Crates delivered".)
- **"Fusion" just means common sense from many clues.** No single sensor is sure.
  WiFi *thinks* someone's there; radar agrees; the thermal sensor sees warmth in
  the same spot. Combine the three weak guesses and you get one confident answer —
  exactly how a person uses sight + sound + touch together. (Source:
  `crates/rufield-fusion/rules/room_state.toml` L15-20; ADR-260 §12-13.)
- **"Privacy class" is a colour-coded sensitivity label** stamped on every reading,
  P0 (rawest, most sensitive) up to P5 (names a person). The system *refuses* to
  send the sensitive ones off the device without permission. (Source:
  `crates/rufield-core/src/privacy.rs` L8-25; `crates/rufield-privacy/src/lib.rs`
  L1-12.)
- **"Provenance receipt" is a tamper-proof sticker** on every reading — a
  cryptographic signature — so you can prove it came from a real sensor and wasn't
  faked or altered. Change one number after signing and the sticker breaks.
  (Source: README.md L363-371; `rufield-provenance`.)

---

## 3. The four stakes — answered plainly and early

**What does it actually DO?**
It listens to the invisible WiFi/radar/heat signals in a room and turns them into
a live, readable list of facts about that room — *someone is present, sitting,
sleeping, breathing, got out of bed, left the room* — without a camera watching,
with a privacy label and a tamper-proof signature on every single fact. (Source:
README.md L96-108; `room_state.toml`; ADR-260 §19.)

**Why do I care?**
Because the useful information — "Grandma got out of bed at 3am and hasn't come
back" — usually requires a *camera*, and a camera in a bedroom or bathroom is a
non-starter. RuField gives you the *answer* without the *image*. Nobody is ever
watched; the system only knows "a person is here," never "here is a picture of
them." (Source: ADR-260 §6 non-goals — "Do not transmit speech, images, or raw
biometric identity by default"; README.md L355-361.)

**Why do I need it (vs. building this myself)?**
Because every sensor talks a different language and every team reinvents the
plumbing — calibration, fusion, privacy rules, anti-spoofing — by hand, badly.
RuField hands you the agreed format *and* a working reference engine so you skip
the months of glue code and the privacy/security mistakes. (Source: ADR-260 §4
"locked into modality-specific silos … prevents reliable fusion and makes
governance weak"; §5 goals 1-7.)

**Why is it important?**
Because it's an **open standard**, not one company's locked box. If WiFi sensing
is going to be everywhere — in homes, hospitals, offices — it needs a common,
privacy-first, provable format the way the web needed HTTP. RuField is a bid to be
that shared layer, with privacy and provenance built in from day one rather than
bolted on after the scandal. (Source: ADR-260 §21 decision matrix — "Create open
RuField spec plus reference stack" scores highest; §25 consequences.)

---

## 4. THE grounding example (named, relatable, before → after)

**Margaret is 78 and lives alone. Her daughter Priya worries about night-time
falls and bathroom trips — but Margaret flatly refuses cameras in her home, and
she's right to.**

- **Before RuField:** Priya's only real options are (a) cameras — which Margaret
  vetoes, and which Priya herself wouldn't want in a bedroom or bathroom — or (b) a
  panic button Margaret has to remember to wear and press, which is useless if
  she's fallen and can't reach it. So Priya just *worries*, and calls more than
  she'd like. There's no dignified way to know "is Mum up and moving normally
  tonight?"

- **After RuField:** A few cheap, camera-free sensors sit in the corners — a WiFi
  node, a small radar chip, a thermal dot. RuField fuses their invisible signals
  into plain facts: *person present · sitting · breathing · in bed · got out of bed ·
  left the room.* Priya's app simply shows a calm room-state. The raw signals never
  leave Margaret's house (they're privacy-class **P0**, which the system refuses to
  transmit by default). Any sensitive health reading like *breathing* is **P4** and
  stays off unless Margaret explicitly consents. Every fact carries a signed
  receipt, so a tampered "she's fine" can't be faked. Margaret is **never watched** —
  there is no image, ever — yet Priya finally knows her mother is moving normally
  tonight. (Source for the exact sequence and labels: ADR-260 §19; `room_state.toml`
  — `breathing` is `privacy_max = "P4", requires_consent = true`, L36-42;
  `rufield-privacy/src/lib.rs` L60-75 P0 denial + P4 consent gate.)

- **The "oh — that's what it's for" line:** *It's how you get the answer a camera
  would give you — "is everything okay in there?" — without anyone ever being
  watched.*

> Honest note on this example: v0.1's room-state demo runs on a **synthetic
> simulator**, and the one real-signal path (`CsiReplayAdapter`) is **recorded WiFi
> replayed from a file, a physically-grounded proxy, not validated accuracy.** The
> *architecture, privacy enforcement, and provenance are real and working today*;
> the *field-accuracy numbers that would let you trust this with a real Margaret*
> need the hardware adapters v0.1 deliberately does not yet ship. (Source: README.md
> L13-25, L317-344; ADR-260 "Honest statement".)

---

## 5. "Why this vs. what I already have?" (differentiation)

A non-technical reader may have heard of cameras, motion sensors, or a smart-home
hub like Matter. Here is the honest difference:

| You might already use… | What it gives you | What RuField adds |
|---|---|---|
| **A security camera** | A literal image — and a privacy problem nobody wants in a bedroom/bathroom | The *answer* ("person present, got out of bed") with **no image at all**, plus a privacy label per fact (Source: ADR-260 §6; README.md L355-361) |
| **A PIR motion sensor** | One bit: "something moved" | Rich room-state — sitting, sleeping, breathing, bed-exit, room-transition — fused from several signals with confidence scores (Source: `room_state.toml` L15-66) |
| **Matter / a smart-home hub** | A way for *devices to connect* | Matter is a connectivity layer; it does **not** define a sensing event format. RuField is the missing sensing/event layer that could *feed* a Matter bridge (Source: ADR-260 §1 — "Matter … is a device connectivity layer, not a multimodal field sensing specification"; §14 Layer 7) |
| **WiFi sensing / 802.11bf alone** | WiFi-only readings, no privacy or provenance model | One common grammar across **WiFi + radar + ultrasound + IR + more**, with privacy classes and signed receipts on top — RuField sits *above* 802.11bf, it doesn't compete with it (Source: README.md L51-54; ADR-260 §1-2, §8) |

The one-line version: **everything you already have either watches you (cameras) or
tells you almost nothing (a motion blip) or just connects devices (Matter).
RuField is the privacy-first layer that turns invisible signals into rich, provable
facts — and it's an open standard, so it's not one vendor's locked box.**

---

## 6. Real-world use-case scenarios (≥5, each: situation → command → what it does → what you get)

Each scenario below maps to something the v0.1 reference stack actually runs. The
commands are real (README.md L76-125). Honest scope is stated where it matters.

### 6.1 — "Just show me it works" (the benchmark)
- **Situation:** You've heard the pitch and want proof the pipeline is real, not a
  slide deck.
- **Command:** `cargo run -p rufield-bench -- 2026`
- **What it does:** Runs the whole pipeline — synthetic sensors → fusion → room
  state → scoring — deterministically against known ground truth. (Source:
  README.md L76-82, L272-291.)
- **What you get:** A one-screen report card: F1 per task (presence, breathing,
  bed-exit, room-transition…), p95 latency, 100% provenance coverage, 0 privacy
  violations — every number **labelled SYNTHETIC**, honestly. (Source: README.md
  L279-313; ADR-260 "Deterministic benchmark report".)

### 6.2 — "Let me watch a room light up" (the live dashboard)
- **Situation:** You want to *see* camera-free room intelligence, not read a table.
- **Command:** `cargo run -p rufield-viewer` → open `http://localhost:8088/`
- **What it does:** Replays the enter → sit → breathe → sleep → scratch → bed-exit
  → leave sequence tick by tick across WiFi/radar/thermal, in your browser, no
  build step. (Source: README.md L84-111.)
- **What you get:** A live room-state panel, an event stream with a colour-coded
  **privacy badge (P0–P5)** on every event, the fusion graph showing which signals
  support each conclusion, and a click-to-inspect **signed receipt** (✓/✗) per
  event. An amber banner says **`SYNTHETIC — simulated sensors, no hardware`** so
  you're never misled about what you're looking at. (Source: README.md L96-152.)

### 6.3 — "Plug in a real WiFi recording" (the one real-signal path)
- **Situation:** You want to feed RuField *real* captured WiFi, not a simulator.
- **Command (Rust):** `CsiReplayAdapter::from_jsonl(&recording)` → `adapter.calibrate("living_room")` → loop `adapter.next_event()` into `RuFieldFusion`.
- **What it does:** Reads a real `.csi.jsonl` WiFi recording, learns an empty-room
  baseline, and emits one **signed** field event per frame with a genuine sha256 +
  ed25519 signature over the raw bytes — feeding the same fusion engine as the
  demo. (Source: README.md L212-244; ADR-260 "Update — first real adapter".)
- **What you get:** Real `person_present` / `breathing` inferences derived from
  *real WiFi signal*. **Honest caveat:** it's replay from a file (not live
  hardware), the recording is unlabeled, so this is a **CSI-variance proxy, not
  validated accuracy** — the win is "RuField ingests real WiFi and fuses it," not
  an accuracy claim. (Source: README.md L246-254.)

### 6.4 — "Prove a reading wasn't faked" (provenance / anti-spoofing)
- **Situation:** A safety system can't trust an event that might be forged — a
  spoofed "all clear" could hide a real emergency.
- **Command (Rust):** `rufield_provenance::is_fusable(&event)`
- **What it does:** Checks every event's signature; an event is allowed into fusion
  **only** if it carries a verifying ed25519 receipt or is explicitly flagged
  synthetic. Tamper with any field after signing and the check fails. (Source:
  README.md L363-371; ADR-260 §11, §22 "Sensor spoofing → signed sensor receipts".)
- **What you get:** A hard guarantee that **no forged or altered event can drive a
  trusted conclusion** — the live viewer flags unverified events ✗ and never fuses
  them. (Source: README.md L130-138.)

### 6.5 — "Keep the sensitive stuff on the device" (the privacy guard)
- **Situation:** Raw signals and health inferences must not leak off the device by
  accident.
- **Command (Rust):** `DefaultPrivacyGuard::default().authorize(class, destination, consent, identity_bound)`
- **What it does:** Enforces the policy automatically: **P0 raw frames are denied
  from the network** by default; **P4 health inferences (breathing) require explicit
  consent**; **P5 (names a person) requires identity binding + an audit log**.
  (Source: README.md L200-209; `rufield-privacy/src/lib.rs` L60-110.)
- **What you get:** Privacy by construction — you literally *can't* ship the
  sensitive data without an explicit, logged decision; the benchmark reports **0
  privacy violations**. (Source: README.md L290, L355-361.)

### 6.6 — "Show real sensor data on the same dashboard" (live upstream mode)
- **Situation:** You have a real RuField feed (e.g. from RuView's sensing server)
  and want the same dashboard to display it instead of the simulator.
- **Command:** `cargo run -p rufield-viewer -- --source live --upstream http://127.0.0.1:8080`
- **What it does:** Subscribes to the upstream's real `FieldEvent` stream, **verifies
  each receipt on ingest**, and runs only the verified events through the identical
  room-state / privacy / fusion display. (Source: README.md L113-152.)
- **What you get:** The same panels, now driven by real events — with an honest
  **green `LIVE`** banner when connected, or a **red `DISCONNECTED`** banner if the
  upstream is unreachable. It **never** silently falls back to fake data under a
  LIVE banner. (Source: README.md L140-152.)

---

## 7. Honest limits (stated plainly, not hidden)

- **Mostly synthetic in v0.1.** The room-state demo and all the benchmark F1
  numbers come from a **deterministic synthetic simulator**, scored against its own
  ground truth. They prove the *pipeline* is correct; they say **nothing** about
  real-world accuracy. (Source: README.md L13-19, L295-298; ADR-260 "Honest
  statement".)
- **The one real path is replay, not live, and unlabeled.** `CsiReplayAdapter`
  ingests **real captured WiFi CSI**, but from a **recorded file, not live
  hardware**, and the recording is **unlabeled** — so its motion/presence output is
  a **physically-grounded CSI-variance proxy, NOT validated accuracy**. No pose, no
  accuracy numbers are claimed. (Source: README.md L20-25, L246-254.)
- **No validated hardware adapter ships.** mmWave radar and thermal IR are
  **synthetic** in v0.1. Real ESP32 / mmWave / thermal hardware integration is a
  documented **follow-up**, not a shipped feature. (Source: README.md L316-344;
  ADR-260 §17 note.)
- **The dashboard is a viewer, not a control system.** It's a **read-only** demo —
  no device management, no fleet console, no controlling real sensors. (Source:
  README.md L69, L150-152.)
- **Not a medical device.** RuField explicitly does **not** define medical
  diagnosis; health-style inferences (breathing, sleep) are gated behind privacy
  class P4 + consent and must not be read as clinical claims. (Source: ADR-260 §6
  non-goal 5; §25 "do not claim medical diagnosis".)
- **It's a spec + reference, not a product you install in your house yet.** v0.1 is
  an honestly-measured reference pipeline — data model, provenance, privacy, fusion,
  benchmark — *pending* the real hardware adapters that would make it deployable.
  (Source: ADR-260 "Honest statement".)

---

## 8. Provenance & attribution (mandatory, Cognitum pattern)

- **Original author:** Reuven Cohen / **@ruvnet**.
- **Source repo:** <https://github.com/ruvnet/rufield>
- **Spec of record:** ADR-260 (`docs/ADR-260-rufield-mfs.md`).
- **Version / status:** `rufield.mfs.v0.1` — "reference stack", Accepted.
- **HEAD sha at authoring:** `509d8ae29e654a322910bd504d325b0dd1fdd895`.
- **License:** MIT (`LICENSE`).
- The live site must show a provenance line (last-updated date + version + HEAD
  sha) so a visitor can tell whether this content is current. (Pattern per
  ADR-0001 Part II D12 / constraint Q.)
