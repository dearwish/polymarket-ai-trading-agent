# Polymarket AI Agent

Python project for a Polymarket trading agent with three clearly separated layers:

- Deterministic execution built around official Polymarket APIs and `py-clob-client`
- Research and model-scoring layer using OpenRouter by default
- Operator-facing CLI and deployment model designed for safe paper trading first, then tightly gated live trading

## Current Status

The repository includes a working paper and read-only live-readiness stack, plus Phases 1–3 of the short-horizon BTC trading core (see [`docs/ROADMAP.md`](./docs/ROADMAP.md)).

- Python package under `src/polymarket_ai_agent`
- operator CLI via `polymarket-ai-agent`
- settings/config loading from `.env`
- Polymarket market discovery and order book snapshot connector (top-10 levels per side)
- authenticated read-only Polymarket account diagnostics
- external BTC price feed connector (REST + websocket)
- research, scoring, risk, execution, and journaling engines
- paper trading and read-only simulation flows
- hard-gated live execution path
- live preflight and live order inspection commands
- SQLite and JSONL logging
- **event-driven asyncio daemon** with Polymarket CLOB + Binance BTC websocket subscriptions, rolling per-market and BTC state, and a pluggable decision callback (Phase 1)
- **deterministic quant fair-value scorer** (closed-form GBM + momentum tilt + per-side edge after slippage and fees) running on every daemon tick (Phase 2)
- **maker-first / taker-fallback execution router** with VWAP paper fills, SELL-side support, live-fill → PositionRecord bridge, and a `close_position` path that posts a SELL-side counter order on Polymarket (Phase 3)
- test suite covering connectors, scoring, risk, execution, service, CLI, state/daemon/feed modules, the execution router and VWAP fills, live fill bridging, and the live close flow

Important:

- this repo can authenticate against Polymarket and inspect account state
- this repo can simulate and paper-trade decisions
- this repo has a real live order-posting code path
- live posting is still disabled by default and requires explicit config and CLI confirmation

## Quick Start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
polymarket-ai-agent status
polymarket-ai-agent scan --limit 5
```

## Makefile Shortcuts

```bash
make bootstrap
make test
make status
make auth-check
make doctor
make live-preflight
make live-orders
make simulate-active
make simulate-market MARKET_ID=123
make simulate-loop-active ITERATIONS=3 INTERVAL=0
make daemon-smoke   # 15s smoke test of the event-driven daemon
make daemon         # run the event-driven daemon (Ctrl+C to stop)
```

## Operator Workflow

Recommended sequence:

1. `make status`
2. `make auth-check`
3. `make doctor`
4. `make live-preflight`
5. `make live-orders`

What these do:

- `status`
  - shows runtime mode, safety state, and authenticated account summary
- `auth-check`
  - verifies wallet/private-key/funder auth and reads collateral balance
- `doctor`
  - combines auth, active market, order book, and current simulated decision
- `live-preflight`
  - evaluates whether a live trade would currently be allowed and lists blockers
- `live-orders`
  - inspects current authenticated open orders without posting anything

## Live Trading Safety Model

Live trading is intentionally hard-gated.

Real order posting requires all of:

- `TRADING_MODE=live`
- `LIVE_TRADING_ENABLED=true`
- valid Polymarket auth
- a preflight that passes risk checks
- explicit CLI confirmation via `--confirm-live`

Default safe state:

```env
TRADING_MODE=paper
LIVE_TRADING_ENABLED=false
```

## Planned Architecture

- `connectors/polymarket`
  - Gamma/Data/CLOB reads
  - token resolution
  - order book snapshots
  - account state
  - authenticated order inspection
- `connectors/external_feeds`
  - external BTC price feed snapshots
  - source adapters for market-family-specific evidence
- `engine/research`
  - source gathering
  - evidence normalization
  - citation packaging
- `engine/scoring`
  - market packet generation
  - feature extraction
  - model scoring
  - edge calculation
- `engine/risk`
  - exposure caps
  - spread/liquidity gates
  - cooldowns
  - expiry protection
  - daily loss kill switch
- `engine/execution`
  - order placement
  - cancel/replace logic
  - fill tracking
  - emergency flatten
- `engine/journal`
  - SQLite state
  - JSONL event logging
- `apps/operator`
  - `scan`
  - `analyze`
  - `paper`
  - `simulate`
  - `doctor`
  - `live-preflight`
  - `live`
  - `live-orders`
  - `live-order`
  - `close`
  - `status`
  - `report`

## Strategy Scope For V1

The first version is intentionally narrow:

- target one repetitive market family only
- current implemented focus: BTC daily threshold markets
- use OpenRouter as the default model gateway
- keep execution deterministic and mostly non-agentic
- require structured LLM output and local risk approval before any order can be placed

## Files

- [`PLAN.md`](./PLAN.md)
- [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)
- [`.gitignore`](./.gitignore)

## Event-Driven Daemon (Phase 1)

The daemon replaces synchronous REST polling on the hot path with websocket-driven state:

- subscribes to Polymarket CLOB market deltas for discovered btc_1h / btc_15m / btc_5m tokens
- subscribes to Binance `aggTrade` + `bookTicker` for live BTC price, with a REST seed + fallback
- maintains in-memory `MarketState` (microprice, top-5 imbalance, trade tape, signed flow) and `BtcState` (log returns at 10s/1m/5m/15m, EWMA realized vol)
- auto-reconnects with exponential backoff on disconnect
- invokes the decision callback on every update (Phase 2 quant scorer)

Configure via `.env` (see `.env.example`):

```env
POLYMARKET_WS_MARKET_URL=wss://ws-subscriptions-clob.polymarket.com/ws/market
POLYMARKET_WS_USER_URL=wss://ws-subscriptions-clob.polymarket.com/ws/user
BTC_WS_URL=wss://stream.binance.com:9443/stream
BTC_SYMBOL=btcusdt
WS_RECONNECT_BACKOFF_SECONDS=2.0
WS_RECONNECT_BACKOFF_MAX_SECONDS=30.0
DAEMON_DISCOVERY_INTERVAL_SECONDS=60
DAEMON_DECISION_MIN_INTERVAL_SECONDS=1.0
```

## Quant Scoring (Phase 2)

`QuantScoringEngine` ([src/polymarket_ai_agent/engine/quant_scoring.py](./src/polymarket_ai_agent/engine/quant_scoring.py)) runs on every daemon tick:

- fair_yes from a drift-less GBM normalised by time-to-expiry, with a damping factor and a linear tilt from top-5 imbalance
- per-side edge after real cost stack: `edge_yes = fair_yes − ask_yes − slippage − fee_bps`, symmetric for NO
- confidence scales with edge magnitude and degrades when slippage is high
- expiry-risk tiers configurable via `QUANT_HIGH_EXPIRY_RISK_SECONDS` / `QUANT_MEDIUM_EXPIRY_RISK_SECONDS`
- the `ScoringEngine.OpenRouter` path is preserved but now returns the same per-side edge fields

## Execution Router (Phase 3)

`ExecutionRouter` ([src/polymarket_ai_agent/engine/execution/router.py](./src/polymarket_ai_agent/engine/execution/router.py)) chooses between maker and taker on every approved decision:

- `GTC_MAKER` with `post_only=True` when `TTE > EXECUTION_MAKER_MIN_TTE_SECONDS` and `edge > EXECUTION_MAKER_MIN_EDGE`
- otherwise `FOK_TAKER` crossing the best opposite level
- `should_replace(...)` detects stale maker quotes for the cancel/replace loop
- paper mode fills via VWAP walk across `ask_levels` (BUY) or `bid_levels` (SELL) — no more flat-bps slippage

Live round-trips now flow through the same lifecycle as paper:

- `PolymarketConnector.execute_live_trade` honors BUY/SELL from the decision's `order_side`
- filled live orders create a `PositionRecord` via `PortfolioEngine.record_live_fill`
- `AgentService.close_position` in live mode posts a SELL-side counter order, then records the realised exit price on the fill
- `PolymarketConnector.replace_live_order` supports cancel-and-repost for drifting maker quotes

## Deployment Recommendation

Best default deployment path:

1. Local development and dry runs on your machine
2. Paper trading on a small always-on VPS or Fly.io machine
3. Tiny-size live trading on a single-region VPS with process supervision and SQLite backups

Recommended first production target:

- a small VPS on Hetzner, DigitalOcean, or an equivalent provider

Why:

- long-running polling/loop workers fit a VPS better than serverless
- trading loops need stable process state, local logs, and low operational complexity
- SQLite + JSONL journaling works naturally on a single-node service

Avoid for v1:

- Lambda/serverless-only deployment
- edge-worker-only deployment
- multi-region active-active deployment

Those models add failure modes and complexity before the trading logic is validated.
