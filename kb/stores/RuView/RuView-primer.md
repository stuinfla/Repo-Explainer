# RuView — Primer

## 1. What is RuView?

RuView is a WiFi-based spatial intelligence platform that turns the radio waves already filling your home or office into a contactless sensing system — detecting people, measuring their breathing and heart rate, recognizing activity, and estimating body pose, all through walls, in complete darkness, with no cameras and no wearables.

The underlying physics: every WiFi router floods the space around it with radio signals. When a person moves, breathes, or even sits still, they perturb those signals in measurable ways. RuView captures those perturbations using Channel State Information (CSI) — the per-subcarrier, per-antenna signal fingerprint — from inexpensive ESP32 microcontrollers ($9 each), feeds those readings into signal-processing and machine-learning pipelines, and produces actionable data: who is in a room, what they are doing, and whether they are okay.

No cloud is required. No cameras. No app on the user's phone. Just physics and a $9 chip.

## 2. What can RuView do for you?

- **Presence and occupancy** — detect people through walls, count occupants, track entries and exits
- **Vital signs** — breathing rate (6–30 BPM, bandpass 0.1–0.5 Hz on CSI phase) and heart rate (40–120 BPM, bandpass 0.8–2.0 Hz), contactless, without wearing anything
- **Activity recognition** — walking, sitting, gestures, and falls detected from temporal CSI patterns
- **Fall detection** — detected in under 200 ms using phase-acceleration thresholds with a 3-frame debounce
- **17-keypoint pose estimation** — body skeleton reconstruction from WiFi signals, using a pretrained model published on Hugging Face (`ruvnet/wifi-densepose-pretrained`); 82.3% temporal-triplet accuracy on held-out test (v2 encoder)
- **Multi-person counting** — adaptive P95 normalization with a runtime-tunable dedup factor
- **Sleep monitoring** — overnight breathing and movement data with sleep-stage classification and apnea screening
- **Environment mapping** — RF fingerprinting identifies rooms, detects moved furniture, spots new objects
- **Smart home integration** — ships 21 Home Assistant entities per node (11 raw signals + 10 semantic states like "someone-sleeping", "fall-risk-elevated", "bathroom-occupied"), plus HAP-1.1 bridge for Apple Home, and a Matter endpoint for Google Home and Alexa

## 3. What is RuView made of?

RuView is a multi-language system with five layers:

**Firmware (ESP32-S3 or ESP32-C6, C/Rust via ESP-IDF):**
Located at `firmware/esp32-csi-node/`. Runs on a $9 ESP32-S3 or $6–10 ESP32-C6. Reads CSI from the WiFi hardware at up to 50 Hz, applies optional edge filtering, and streams the data over UDP to the Rust sensing server. The C6 variant adds WiFi 6 (HE-LTF subcarrier tagging), 802.15.4 mesh time-sync, and TWT power gating for ~5 µA sleep modes.

**Rust core (v2/ Cargo workspace, 22+ crates):**
The primary processing engine. Key crates:
- `wifi-densepose-core` — shared types (CSI frames, detections, events)
- `wifi-densepose-signal` — signal processing: bandpass filtering, phase unwrapping, FFT, variance
- `wifi-densepose-nn` — neural network inference (Candle framework), loads `.safetensors` models
- `wifi-densepose-vitals` — breathing and heart rate extraction from the signal pipeline
- `wifi-densepose-hardware` — device management and ESP32 connection handling
- `wifi-densepose-sensing-server` — the HTTP/WebSocket server (Axum), exposes REST API at `/api/v1/`, WebSocket at `/ws`, and optional MQTT publisher
- `wifi-densepose-mat` — WiFi mat sensing for floor-level presence
- `wifi-densepose-engine` — integration/composition layer (ADR-135–146)
- `wifi-densepose-calibration` — per-room calibration (30 seconds, spiking neural network adaptation)
- `homecore` — state machine for smart home entity management (Home Assistant entities, HAP bridge)

**Python library (`wifi_densepose` / `ruview` on PyPI):**
PyO3 bindings wrapping the Rust core. Install: `pip install ruview` or `pip install wifi-densepose`. Exposes `BreathingExtractor`, `HeartRateExtractor`, `SensingClient`, `RuViewMqttClient`. Ships as a compiled wheel (~250 KB, abi3-py310, Linux/macOS/Windows). No Rust toolchain needed.

**Web UI (JavaScript, `ui/`):**
A vanilla-JS PWA dashboard at `ui/index.html`. Real-time data visualization via WebSocket. The Observatory view (`ui/observatory.html`) shows 3D point-cloud rendering of room occupancy. A React Native mobile app (`ui/mobile/`, Expo) is also included for iOS and Android.

**Pretrained models (Hugging Face):**
- `ruvnet/wifi-densepose-pretrained` — the 4-bit quantized pose model (8 KB), loads in 8.4 ms on Raspberry Pi 5
- `ruvnet/wifi-densepose-mmfi-pose` — SOTA on MM-Fi: 82.69% torso-PCK@20, beats MultiFormer (72.25%) and CSI2Pose (68.41%)
- Self-supervised contrastive encoder (128-dim, 12.2M training steps on 60K frames)

**Edge module catalog (105 Cogs):**
Small programs for specialized sensing scenarios (health, security, retail, building, industrial). Loaded at runtime. Examples: `occupancy-zones`, `queue-length`, `fall-detection`, `sleep-monitor`.

## 4. How WiFi sensing works — step by step

**Step 1: CSI capture.** The ESP32's WiFi chip reads Channel State Information — the complex amplitude and phase of each subcarrier (up to 234 subcarriers) on each antenna for every WiFi packet it receives. This is a fine-grained fingerprint of how the radio signal passed through the space.

**Step 2: Streaming.** Firmware sends each CSI frame (typically at 50 Hz) over UDP to the sensing server. A 3–6 node mesh multiplies coverage and enables multistatic sensing (using neighbors' routers as radar illuminators).

**Step 3: Signal processing.** The `wifi-densepose-signal` crate:
- Unwraps the phase to remove 2π ambiguities
- Applies bandpass filters: 0.1–0.5 Hz to isolate breathing motion, 0.8–2.0 Hz for heartbeat
- Computes motion-band power for activity detection
- Uses phase-acceleration thresholds for fall detection
- Calculates subcarrier variance, which correlates with presence

**Step 4: Per-room calibration.** On first run (30 seconds), a spiking neural network learns the room's static fingerprint. This step is critical: WiFi sensing does not generalize zero-shot between rooms. The 30-second calibration resolves this completely.

**Step 5: Neural network inference.** The pre-trained CSI encoder produces 128-dim embeddings. A task-specific readout head (trained per-room if needed) maps embeddings to pose keypoints, presence count, or activity labels. The entire inference runs in microseconds on a Raspberry Pi.

**Step 6: Semantic state.** The `homecore` state machine maps raw detections to 10 semantic entities per node: "someone-sleeping", "possible-distress", "room-active", "elderly-inactivity-anomaly", "meeting-in-progress", "bathroom-occupied", "fall-risk-elevated", "bed-exit", "no-movement", "multi-room-transition".

**Step 7: Output.** Delivered simultaneously via REST (`/api/v1/status`, `/api/v1/presence`, `/api/v1/vitals`), WebSocket (real-time streaming), MQTT (Home Assistant auto-discovery), and HAP (Apple HomeKit).

## 5. Is it production-ready? Scope and honest limits

**What works and is confirmed shipped:**
- Breathing rate and heart rate extraction (zero-crossing BPM from bandpass CSI phase)
- Presence detection with phase-variance fallback (no model required)
- Fall detection (phase-acceleration threshold + debounce)
- 17-keypoint pose estimation via the Hugging Face model
- Docker image (`ruvnet/wifi-densepose:latest`) with simulated data for evaluation
- Python PyPI packages (`ruview`, `wifi-densepose`) — PyO3 compiled wheels
- Home Assistant MQTT integration with 21 entities per node
- ESP32-S3 and ESP32-C6 firmware, tested and validated

**Honest limits:**
- **CSI hardware required for full sensing.** Consumer WiFi adapters only provide RSSI (coarse presence/motion). Full CSI requires an ESP32-S3 ($9) or ESP32-C6 ($6–10) — or an Intel 5300/Atheros AR9580 research NIC.
- **Zero-shot room transfer doesn't work.** The model must be calibrated to each room (30 seconds). This is a fundamental property of WiFi sensing, not a bug.
- **Camera-free pose accuracy is modest.** The v2 encoder achieves 82.3% temporal-triplet accuracy on held-out test. Camera-supervised fine-tuning (using a co-located camera for training data, then removing the camera) reaches 92.9% PCK@20.
- **Single node has limited spatial resolution.** 2+ nodes (or a Cognitum Seed with kNN + vector memory) significantly improve accuracy.
- **Through-wall range is signal-dependent**, typically up to 5 m with commodity hardware.
- **Multi-person counting** works well with the adaptive P95 algorithm but degrades in crowded rooms or when people are close together.

## 6. Where to read more — the docs map

- `README.md` — the primary overview, hardware options, quick-start commands
- `docs/user-guide.md` — full user guide: installation, quick-start, API reference, hardware setup, training
- `docs/build-guide.md` — building from source (Rust workspace + Python + firmware)
- `docs/integrations/home-assistant.md` — Home Assistant MQTT/DISCO integration
- `docs/user-guide-apple-homepod.md` — Apple Home / HomePod / HAP setup
- `docs/adr/` — 150+ Architecture Decision Records documenting every major design choice
- `v2/` — the Rust workspace (primary codebase for Rust builds)
- `firmware/esp32-csi-node/` — ESP32 firmware source + build instructions
- `python/` — PyO3 bindings source
- `ui/` — web dashboard and mobile app

## 7. How to install and use RuView end-to-end

### Path 1: Docker demo (no hardware, 30 seconds)
```bash
docker pull ruvnet/wifi-densepose:latest
docker run -p 3000:3000 ruvnet/wifi-densepose:latest
# Open http://localhost:3000
# You'll see the real-time dashboard with simulated CSI data
```

### Path 2: Python library
```bash
pip install ruview
# or: pip install wifi-densepose  (same wheel, different name)

# Add WebSocket/MQTT clients:
pip install "ruview[client]"

# Use it:
from ruview import BreathingExtractor, HeartRateExtractor
# from ruview.client import SensingClient, RuViewMqttClient
```

### Path 3: Build from source (Rust)
```bash
# Prerequisites: Rust 1.85+, Python 3.10+
git clone https://github.com/ruvnet/RuView
cd RuView/v2

# Run tests (no hardware needed — uses simulated data):
cargo test --workspace --no-default-features

# Start the sensing server (simulated mode):
cargo run -p wifi-densepose-sensing-server -- --simulate
# Open http://localhost:3000
```

### Path 4: Live ESP32 sensing ($9 hardware)
```bash
# 1. Flash firmware to ESP32-S3:
python -m esptool --chip esp32s3 --port COM9 --baud 460800 \
  write_flash 0x0 bootloader.bin 0x8000 partition-table.bin \
  0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin

# 2. Provision WiFi and server IP:
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20

# 3. Start the sensing server:
cargo run -p wifi-densepose-sensing-server
# Dashboard at http://localhost:3000
# API at http://localhost:3000/api/v1/
```

### What you'll see when it works
- The web dashboard shows real-time presence detection, breathing rate, and heart rate bars
- REST API returns JSON: `GET /api/v1/status` → system status; `GET /api/v1/vitals` → breathing/heart rate; `GET /api/v1/presence` → occupancy count
- WebSocket at `/ws` streams events in real-time
- With Home Assistant: `--mqtt` flag publishes sensor entities automatically

## 8. How to extend RuView

**Add a custom Cog (edge module):**
Implement the Cog interface in the edge-module runtime. Add it to `app-registry.json`. The catalog supports 105 modules across health, security, building, retail, and industrial domains.

**Train a custom pose model:**
Use camera-supervised fine-tuning: record 2.1 seconds of training data per pose with a MediaPipe camera, then run the Candle pipeline. Alternatively, use self-supervised contrastive pre-training on your own CSI data.

**Add a new Home Assistant entity:**
Extend the `homecore` state machine in `crates/homecore/`. New entities are published via MQTT DISCO auto-discovery.

**Integrate with Matter:**
Use the Matter endpoint in `homecore-api` (ADR-122). Works with Google Home, SmartThings, and any Matter-compatible hub.

## 9. Hardware requirements and gotchas

**Hardware options (smallest to largest):**
| Option | Cost | Full CSI? | Capabilities |
|--------|------|-----------|-------------|
| Any WiFi laptop | $0 | No | RSSI-only: coarse presence and motion |
| ESP32-S3 mesh (3–6× boards) | ~$54 | Yes | Presence, breathing, heartbeat, pose, fall detection |
| ESP32-C6 research node | ~$10 | Yes (WiFi 6) | Same as S3 + WiFi 6 HE-LTF, lower power |
| ESP32 + Cognitum Seed | ~$140 | Yes | All above + persistent vector store, kNN, witness chain, 105-cog catalog |

**Key gotchas:**
- ESP32-C3 and the original ESP32 are **not supported** (single-core, insufficient for CSI processing)
- A single node has limited spatial resolution; 2+ nodes significantly improve accuracy
- The 30-second calibration is **mandatory** for each new room — skip it and accuracy collapses
- Camera-free pose estimation is the "good" option; camera-supervised training is the "great" option
- Flash (provisioning) resets the entire NVS namespace — pass the full flag set each time or settings are wiped
- On Windows, ESP-IDF requires a specific Python subprocess setup (see `CLAUDE.local.md`); do not use MSYS2/Git Bash directly
