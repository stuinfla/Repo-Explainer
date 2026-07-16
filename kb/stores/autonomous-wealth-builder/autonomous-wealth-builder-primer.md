# Autonomous Wealth Builder (AWB / MTWM) — Primer

## What it is
Autonomous Wealth Builder is a single-process Node.js/TypeScript trading orchestrator
("gateway-v2") that runs an autonomous equities trading strategy end-to-end: it scans
for opportunities overnight and pre-market, places and manages orders against Alpaca
(paper trading), protects every position with layered stops, and forces itself to close
out risk on a fixed daily clock. A Next.js 16 dashboard ("mtwm-ui") gives a human owner
visibility into positions, research, and strategy state. A Cloudflare "webhook-worker"
receives external events. The project was previously named MTWM (inspired by Reuven
Cohen's neural-trader) and was renamed/pared down to AWB on 2026-05-06 after a real
runtime incident (duplicated orchestrator processes + a long/short bug) that the team's
own incident notes describe in detail (docs/history/2026-05-06-awb-recovery-cleanup.md).

## The core idea (what makes it different)
It is not trying to out-predict the market. Its actual discipline is TIME: every kind
of risk the system takes on is bounded to an exact, posted clock window, enforced in
code, not policy:
- No new buys after 2 PM ET (`NEW_BUY_CUTOFF_HOUR = 14` in trade-engine.ts).
- Every short position is force-covered at 3:45 PM ET — no overnight short exposure,
  ever.
- Two independent stops ride on every open position: a 5% broker-side stop placed at
  entry, PLUS an active "heartbeat" check every 2 minutes (`HEARTBEAT_MS = 120_000`)
  that can exit on a $100 loss threshold.
- Two core holdings (AMZN, NVDA) are permanently exempt from the engine's auto-sell
  logic — the system's own conviction can add to them, but only a human can remove them.
- A hard avoid-list (Trident `avoid` domain: railroads UNP/CSX/NSC, TTWO, DIS, etc.)
  is checked before any buy.

## How it's built (architecture)
Three deployable components, one repo:
1. **services/gateway-v2** (the brain) — the single production orchestrator. In-process
   modules: `trade-engine.ts` (buy/sell/short logic + stops), `research-worker.ts` +
   `research-crons.ts` (scraping/scoring candidates), `catalyst hunter` (news-driven
   entries), `brain-client.ts` (the Trident integration), `data-feed.ts`/`market-stream.ts`
   (Alpaca REST + WebSocket), `discord-bot.ts` (owner notifications + `!note` commands),
   `api-server.ts` (REST API for the UI). `services/gateway` is explicitly legacy
   (old NeuralTrader/FANN-era code) — NOT the production path.
2. **mtwm-ui** — a Next.js 16 + HeroUI + Tailwind dashboard (port 3000) with pages for
   Dashboard, Trading, Research, Intelligence, Strategy, plus experimental verticals
   (commodities, forex, real estate, crypto) that talk to gateway-v2's REST API (port 3001).
3. **webhook-worker** — a small Cloudflare Worker that receives external webhook events
   into a KV namespace.

Supporting data stores: SQLite (research stars / local state), PostgreSQL on
DigitalOcean (companies, signals, theses, fundamentals), and **Trident** — an external
hosted intelligence/memory API (backed by "RuVector") that stores domain-scoped
knowledge (`trade_outcome`, `avoid`, `buffett_core`, `fundamental_profile`,
`strategy_knowledge`, `autonomous_decision`, `owner_preference`) and whose SONA
component learns from every closed trade to influence future `shouldBuy()` calls.

## The trading day (runtime flow)
1. **Overnight (5 PM → 7 AM)** — Catalyst Hunter scans Alpaca news for earnings beats/
   upgrades/FDA approvals; Research Worker reads Yahoo Finance, Bloomberg RSS, Business
   Insider movers; Deep Research pulls analyst targets/insider activity/financials.
   Results become scored "research stars" (SQLite, 0.85–0.99).
2. **Morning prep (8 AM ET)** — merges overnight catalysts + research stars + pre-market
   snapshots, confirms movers are actually moving, places extended-hours limit orders.
3. **Market hours (9:30 AM → 4 PM ET)** — catalyst buys and catalyst shorts fire 10 AM–2 PM;
   an SQQQ auto-hedge triggers when SPY drops 0.5%+ while core tech is held; core holdings
   get reinforced when conviction is high; every position carries the $100 heartbeat stop
   + 5% broker stop; all shorts are force-covered by 3:45 PM.
4. **Extended hours** — the Catalyst Hunter keeps running so an overnight earnings beat
   can get an immediate limit order before the next day's gap-up prices it in.

## Conviction pipeline
Research Worker findings → scored research stars (SQLite) → bridged into PostgreSQL
`research_signals` every 15 min → a thesis generator clusters signals into a 0–100
conviction score → theses at ≥65 conviction are promoted back to research stars →
the catalyst-buy path executes when score ≥ 0.95 AND Trident's `shouldBuy()` gate agrees.

## Maturity / status
This is a real, actively-operated paper-trading system with its own incident history,
ADRs (docs/ADR-027 through ADR-031), a mandatory pre-change QA checklist, and hard
runtime guardrails documented in CLAUDE.md (max 10 positions, $25K deployed cap, no
penny stocks, one buy per ticker per day, a -$1,000 daily circuit breaker). It trades
paper money on Alpaca; production runtime is `services/gateway-v2` only —
`services/gateway` is retained for reference but is not live.

## How to run it end-to-end
```
# services (gateway-v2 orchestrator)
cd services && npm install
npm run dev          # tsx watch gateway-v2/src/index.ts  (port 3001)

# UI dashboard
cd mtwm-ui && npm install
npm run dev           # next dev (port 3000)

# webhook worker (optional, Cloudflare)
cd webhook-worker && wrangler dev
```
Requires Alpaca (paper) API keys, a PostgreSQL connection, and Trident API credentials
configured via environment (see `config-bus.ts` / `.env.example`-style setup); the
system runs continuously on a 2-minute heartbeat once started.

## Where the docs are
`README.md` (overview + architecture diagram), `CLAUDE.md` (operating rules, panic
protocol, QA checklist references), `docs/ADR-*.md` (design decisions), `docs/strategy-spec.md`
(exact trading rules), `docs/history/*` (real incident write-ups), `docs/ROADMAP.md`.
