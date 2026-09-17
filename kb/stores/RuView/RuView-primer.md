## 1. What is RuView

RuView (WiFi DensePose) is a WiFi sensing platform: it turns the radio waves your existing WiFi already fills a room with into spatial intelligence. When people move, breathe, or even sit still, they disturb those waves in measurable ways, and RuView captures this via Channel State Information (CSI) from low-cost ESP32 sensors, turning it into data about who's there, what they're doing, and whether they're okay — through walls, in the dark, with no cameras or wearables.

This particular knowledge base slice indexes the **npm side** of the repo — a 384-dim RVF knowledge base built from 1,145 passages, covering 2 npm components, 7,874 public symbols, and 246 entrypoint commands. The wider RuView project also spans Rust crates, Python packages, and ESP32 firmware, but the components formally cataloged here are the JavaScript/TypeScript apps: `mobile` and `@ruvnet/nvsim-dashboard`.

RuView is built on RuVector and Cognitum Seed, and is designed to run entirely on edge hardware — an ESP32 mesh (as low as $9 per node) paired with a Cognitum Seed appliance. It integrates with the four major smart-home ecosystems: Home Assistant (via an HA-DISCO MQTT publisher), Apple Home & HomePod (as a HAP-1.1 bridge), Google Home, and Amazon Alexa.

## 2. What can it do for you

- **Presence and occupancy** — detect people through walls, count them, track entries and exits.
- **Vital signs** — extract breathing rate and heart rate remotely.
- **Movement tracking and room monitoring** — general spatial awareness without cameras.
- **Through-wall sensing** — using Fresnel-zone geometry and multipath modeling, effective up to roughly 5 m (signal-dependent).
- **Edge module ("cog") catalog** — a live catalog of small signed binaries covering categories like health, security, building, retail, industrial, research, AI, swarm, signal, and network. Sample counts by category: Health (14 modules, e.g. `cardiac-arrhythmia`, `cough-detect`, `baby-cry`), Security (14, e.g. `gunshot-detect`, `glass-break`, `behavioral-profiler`), Building (11, e.g. `elevator-count`, `frost-warning`), Retail (7, e.g. `customer-flow`, `dwell-heatmap`, `package-detect`). Modules are typically a few KB to ~450 KB and rated by difficulty.
- **Visualization and observability** — the `mobile` app and `@ruvnet/nvsim-dashboard` component give you client-side views into sensing data (there are also public live demos: Observatory, Dual-Modal Pose Fusion, Live 3D Point Cloud, and three.js demos).
- **No-hardware evaluation** — a Docker image (`ruvnet/wifi-densepose`) runs with simulated data so you can explore before buying ESP32 hardware.

## 3. What is it made of (the components)

The npm-indexed portion of RuView has two components and no internal dependencies between them:

- **`mobile`** — a React Native / Expo application. Dependencies include `expo`, `expo-status-bar`, `react`, `react-native`, `react-native-web`, `react-native-webview`, navigation (`@react-navigation/native`, `@react-navigation/bottom-tabs`), UI/gesture support (`react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`, `@expo/vector-icons`), storage (`@react-native-async-storage/async-storage`), networking (`axios`, `react-native-wifi-reborn`), charts (`victory-native`), and 3D rendering (`three`, `@types/three`).
- **`@ruvnet/nvsim-dashboard`** — a web dashboard built with `lit` (Web Components), state via `@preact/signals-core` and `zustand`, offline/PWA support via `workbox-window`, and 3D visualization via `three`.

Beyond these two, the broader repo (referenced throughout its docs and commands, though not part of this npm component list) includes a Rust workspace of crates such as `wifi-densepose-core`, `-signal`, `-nn`, `-vitals`, `-mat`, `-hardware`, `-train`, `-wifiscan`, `-ruvector`, `-wasm`, `-wasm-edge`, `-sar`, `-bfld`, `-pointcloud`, `-engine`, `-cli`, `-api`, and `-sensing-server`; Python packages (`ruview`, `wifi-densepose`) with an optional `[client]` extra for asyncio WebSocket and paho-mqtt clients; and ESP32 firmware/provisioning scripts.

## 4. How it works

At the physical layer, an ESP32-S3 (or a research NIC) captures CSI — the fine-grained way WiFi signals are disturbed by bodies moving, breathing, or otherwise present. That CSI is processed through signal-processing and neural-network stages (the Rust `wifi-densepose-signal`, `-nn`, `-vitals`, `-mat` crates) to derive presence, vitals, and pose-related outputs.

A pretrained CSI encoder (hosted on Hugging Face as `ruvnet/wifi-densepose-pretrained`) produces 128-dimensional embeddings and feeds a presence-detection head; a separate MM-Fi pose model (`ruvnet/wifi-densepose-mmfi-pose`) targets pose estimation. Per-node LoRA adapters are supported for on-device fine-tuning.

A sensing server (`wifi-densepose-sensing-server`) aggregates data from one or more ESP32 nodes and serves it — over HTTP and WebSocket ports plus a UDP CSI channel in the Docker deployments — to consumers like the `mobile` app, the `@ruvnet/nvsim-dashboard` web dashboard, or smart-home bridges (MQTT for Home Assistant, HAP for Apple Home). The server is optional for basic operation: the ESP32 can run independently for presence detection, vital signs, and fall alerts.

Separately, this repo/pack is also indexed into its own RVF (RuVector Format) knowledge base — 384-dim embeddings over 1,145 passages — which backs a `ruview` CLI (`brain search`, `brain verify`, `guidance`, `agent run`, `claim-check`, `verify`, `mcp start`) for source-cited guidance, agent runs, and reproducibility checks against the codebase itself.

## 5. How do I install and use it

For the JS/npm side:

```bash
npm install
npm run dev
npm run start
npm run android
npm run ios
npm run web
```

For the RuView documentation/agent CLI:

```bash
npx @ruvnet/ruview@0.4.0 doctor
npx @ruvnet/ruview@0.4.0 guidance --topic sensing --query "model loading"
npx @ruvnet/ruview@0.4.0 agent run --host codex --repo . \
  --prompt "Find the nearest tests and cite the source files"
npx @ruvnet/ruview@0.4.0 brain search --query "calibration"
npx @ruvnet/ruview@0.4.0 brain verify --repo .
npx @ruvnet/ruview@0.4.0 claim-check --file REPORT.md
npx @ruvnet/ruview@0.4.0 verify
```

For evaluating the sensing platform without hardware:

```bash
docker pull ruvnet/wifi-densepose:latest
docker run -p 3000:3000 ruvnet/wifi-densepose:latest
# then open http://localhost:3000
```

For real sensing hardware, flash and provision an ESP32-S3 ($9):

```bash
python -m esptool --chip esp32s3 --port COM9 --baud 460800 \
  write_flash 0x0 bootloader.bin 0x8000 partition-table.bin \
  0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20
```

The Rust crates that make up the sensing pipeline are consumed as Cargo dependencies (e.g. `cargo add wifi-densepose-core`, `wifi-densepose-signal`, `wifi-densepose-nn`, `wifi-densepose-vitals`, `wifi-densepose-mat`, `wifi-densepose-hardware`, `wifi-densepose-train`, `wifi-densepose-wifiscan`, `wifi-densepose-ruvector`, `wifi-densepose-wasm`), with `wasm-pack` and `cargo-watch` as supporting tools. The Python client is `pip install "ruview[client]"` (or the equivalent `wifi-densepose[client]`).

## 6. Honest scope and limits

- **Agent runs are read-only by default.** Workspace writes via the `ruview` CLI require both `--allow-write` and `--confirm`; anything retrieved from the "brain" is treated as evidence, not authority.
- **Model maturity varies and is explicitly labeled (ADR-187).** "WiFi → pose" means different things at different tiers in this repo — read the maturity label for a given checkpoint rather than assuming a headline figure applies uniformly.
- **Published accuracy has been corrected in public.** The pretrained CSI encoder's documented figure is 82.3% held-out temporal-triplet accuracy (up from a 66.4% raw baseline); an earlier "100% presence" claim was measured on a single-class recording and has since been retracted.
- **Known artifact issue:** the published `model.safetensors` file has a NUL-padded header that the reference `safetensors.torch.load_file` rejects (tracked as issue #1522), pending a corrected re-upload.
- **Through-wall range is bounded and signal-dependent** — roughly up to 5 m per the documented Fresnel-zone/multipath approach, not unlimited range.
- **Hardware matters.** CSI-capable hardware (an ESP32-S3 at ~$9, or a research NIC) is recommended for presence, vital-sign, and through-wall capabilities; the Docker image runs on simulated data for evaluation only, and consumer WiFi laptops have limited capability by comparison.
- **Older material is being deprecated with clear labeling** — an `archive/v1` path exists with its own deterministic proof/verification script (`archive/v1/data/proof/verify.py`), documented under ADR-187 as part of an honest-labeling effort rather than being presented as current.
- **This knowledge pack's component inventory (2 components, npm ecosystem) reflects the indexed JS/TS surface only** — the fuller system (Rust crates, Python packages, ESP32 firmware, Docker images) is described in the repo's docs and build commands but isn't enumerated as a separate "component" in this particular index.
