# Optimizing the Polymarket AI Agent for Real btc_1h / btc_15m / btc_5m Trading

## Context

The repo is a clean Codex-generated scaffold (Python + FastAPI + React) that targets short-horizon BTC directional markets on Polymarket. Architecture is well-separated (connectors / engine / service / apps) and the safety gating around live trading is thoughtful. However, the **hot path is synchronous REST + LLM polling**, the websocket client exists but is dormant, and the "fair probability" estimator is a toy heuristic or a 30-second LLM call. For btc_1h the agent can technically function but edges will be stale; for btc_15m it will trade with a consistent latency handicap; for btc_5m the current design cannot trade competitively at all.

Scope:
- Drop LLM from the hot path; deterministic quant model is primary.
- Optimize **btc_1h, btc_15m, and btc_5m in parallel**, parameterized by timeframe.
- **Maker-first with taker fallback** execution.

Note on btc_15m: the existing code ships family scorers for `btc_1h`, `btc_5m`, and `btc_daily_threshold` only (see `connectors/polymarket.py` and `config.py`). A new `btc_15m` family needs to be added with its own keyword matcher, `_active_market_max_expiry_seconds` (suggested: 30 min window), `_discovery_request_limit`, and `RiskProfile`. This is a parallel of the existing 1h/5m code paths and is folded into the phases below.

---

## What the Repo Gets Right (keep)

- Clear module boundaries (`src/polymarket_ai_agent/` — connectors, engine, service, apps).
- Strong test coverage on paper paths (`tests/`).
- Hard-gated live mode: `TRADING_MODE=live` + `LIVE_TRADING_ENABLED=true` + `--confirm-live` + preflight blockers.
- Rich runtime settings surface (`config.py`) with editable overrides — trivial to extend for per-family knobs.
- SQLite + JSONL journaling for replayable decisions.
- Market-family scoring in `connectors/polymarket.py` is a reasonable first-pass filter.
- Preflight + doctor + live-orders commands form a usable operator toolkit.

---

## Critical Gaps For Real Short-Horizon Trading

### G1. Hot path is synchronous REST polling
- `service.build_market_snapshot` makes three blocking HTTP calls (Gamma market, CLOB book, Binance) every cycle.
- CLI `run-loop` uses `time.sleep(interval)` between iterations — no event-driven behavior.
- `polymarket_ws.py` explicitly says *"intentionally not wired into the live trading path yet"*.
- Impact: at btc_5m scale, the mid can move a full cent between cycle start and order post.

### G2. LLM is a 30-second blocking call on the critical path
- `scoring.py` sets `httpx.Client(timeout=30)` and POSTs to OpenRouter synchronously on every `analyze_market`.
- No caching, no streaming, no async.

### G3. Fair-value model is a toy
- Heuristic fallback adds `±1.5%` based on sign of "recent price change" plus a constant `+1%`.
- LLM prompt sends a thin JSON blob; without market-microstructure features an LLM is guessing.

### G4. Edge formula ignores fill costs
- `edge = fair - packet.market_probability` uses the stale Gamma `outcomePrices[0]`, not the ask you actually cross.
- Correct YES taker edge: `fair − ask − slippage − fees`; NO taker edge: `(1 − fair) − ask_NO − slippage`.

### G5. "Recent price change bps" is not a price change
- `recent_price_change_bps=(orderbook.midpoint − candidate.implied_probability) * 10_000` measures API staleness, not momentum.
- `recent_trade_count=0` is hardcoded; the tape is never consulted.

### G6. Execution is buy-only, no SELL, no cancel/replace
- `PolymarketConnector.execute_live_trade` always uses `BUY`. Exits cannot be posted as resting sells. No cancel/replace loop.
- `manage_open_positions()` returns `[]`.
- Paper fill always uses `orderbook.ask` regardless of side — wrong for NO-side paper trades.

### G7. Live fills never become positions
- Only `FILLED_PAPER` creates a `PositionRecord`. Live orders go to `live_orders` but never become positions → no live TTL exits, PnL, or manage.

### G8. Risk gates are blunt
- Single `open_positions >= 1` rejection prevents multi-market exposure.
- `min_edge=0.03` / `max_spread=0.04` / `min_depth_usd=200` apply globally; they should be per-family.
- `exit_buffer_seconds=5` is fixed; should be `max(floor, pct * TTE)`.
- `stale_data_seconds=30` is too loose for 5m/15m.

### G9. External feed: single REST source, high latency
- Binance `/ticker/price` over HTTP every cycle. No candle history, no realized vol, no fallback.

### G10. Paper slippage is too generous
- 10 bps × ask on a 0.5 probability = 0.0005. Real Polymarket taker slippage on 5m markets is 1–3¢.

### G11. No continuous daemon, no monitoring
- `run-loop` is a bounded for-loop; no systemd unit, health endpoint, or metrics.

### G12. API is readonly, dashboard polls
- SSE endpoints internally re-call sync REST. Dashboard polls.

---

## Target Architecture (deterministic quant core, LLM optional)

```
┌─────────────────────────────────────────────────────────────────┐
│                        asyncio daemon                           │
│  ┌──────────────┐  ┌──────────────┐   ┌──────────────────────┐  │
│  │ PolyMkt WS   │  │  BTC WS      │   │  Market-family        │  │
│  │ (book/trade) │  │ (bookTicker  │   │  discovery (60s REST) │  │
│  │              │  │  + aggTrade) │   │                       │  │
│  └──────┬───────┘  └──────┬───────┘   └──────────┬────────────┘  │
│         ▼                 ▼                      ▼                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │               MarketState (in-memory, per market)           │ │
│  │  book, microprice, imbalance, trade tape, BTC price/vol,    │ │
│  │  TTE, candle-open price, time-elapsed-in-candle             │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │         QuantScoringEngine (deterministic, <1ms)            │ │
│  │  fair = BS-like P(BTC_T > strike | S_now, σ, τ, drift)      │ │
│  │  or fair = logistic(features) for up/down markets           │ │
│  │  edge_yes = fair - ask_yes - fees - slippage_estimate       │ │
│  │  edge_no  = (1-fair) - ask_no - fees - slippage_estimate    │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │   RiskEngine (per-family gates) → TradeDecision              │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ExecutionEngine: router                                    │ │
│  │   TTE > T_maker_min AND edge > E_maker → GTC post-only      │ │
│  │   else                                 → FOK taker          │ │
│  │   cancel/replace on mid drift or edge change                │ │
│  │   force-close at exit_buffer = max(floor, pct * TTE)        │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Portfolio + Journal: live fills create PositionRecords;    │ │
│  │  user_orders WS reconciles status; TTL / vol-based exits   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  LLM runs out-of-band: news / halt detection / "should we skip   │
│  this hour?" advisor, never on the tick path.                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phased Roadmap

Each phase is independently shippable and leaves paper mode working.

### Phase 1 — Event-driven market plumbing (foundation)
Goal: replace REST polling on the hot path with websocket-driven state.

- Wire `PolymarketMarketStream` (`connectors/polymarket_ws.py`) into the daemon. Also subscribe to the `user` channel for fills/cancels.
- Add `connectors/binance_ws.py`: aggTrade + bookTicker over websocket; fallback to REST.
- Introduce `engine/market_state.py`: per-market rolling state updated by WS events. Owns order book, trade tape (last N), computed features (microprice, top-5 imbalance, signed flow, last-trade-age).
- Introduce `engine/btc_state.py`: rolling 1-second price bars (last 120), realized vol (EWMA), log returns at 10s/1m/5m/15m.
- Add `apps/daemon/run.py` (new): asyncio entry point, discovers markets every 60s, subscribes to WS for matching token IDs, fires strategy on each event.
- Latency metrics: WS → decision, decision → order-post, exposed via `/api/metrics`.

New: `connectors/binance_ws.py`, `engine/market_state.py`, `engine/btc_state.py`, `apps/daemon/run.py`.
Modified: `connectors/polymarket_ws.py`, `service.py`, `config.py` (adds `btc_ws_url`, `polymarket_ws_user_url`, `ws_reconnect_backoff_seconds`).

Verification:
- Unit: WS reconnect logic, parse of Polymarket `book`/`last_trade_price`/`price_change`, Binance `bookTicker`+`aggTrade`, vol/return aggregators.
- Integration: 10-minute paper run in btc_1h should log ≥200 book updates/min with no REST polls on the hot path.

### Phase 2 — Deterministic quant fair-value model
Goal: replace the heuristic / LLM scorer with a closed-form probability model.

- Up/down: drift-less GBM over τ, `fair_yes = 1 − Φ(-d)` with small momentum tilt from last-5m log return and signed-flow imbalance.
- Threshold: BS-style `P(S_T > K) = Φ((ln(S/K) + (μ − σ²/2)τ) / (σ√τ))` with σ from 30-min realized vol.
- New edge: `edge_side = fair_side − ask_side − take_slippage(size, book) − fee_bps` per side.
- LLM becomes an optional *veto-only* advisor with `asyncio.wait_for(..., 2.0)`.

New: `engine/quant_scoring.py`.
Modified: `engine/scoring.py` → async `LLMAdvisor`; `types.EvidencePacket` gains ask_yes/ask_no/bid_yes/bid_no/microprice/imbalance_top5/signed_flow_5s/btc_log_return_5m/btc_log_return_15m/realized_vol_30m/time_elapsed_in_candle_s; `engine/research.py` populates new fields from MarketState+BtcState.

Verification:
- Golden tests over fixtures.
- Walk-forward backtest on journaled data: hit rate > 50%, avg edge > fees.

### Phase 3 — Execution: maker-first router with cancel/replace + SELL + TTL exits
- Split execution into `engine/execution/router.py` + `engine/execution/live.py`.
- Route: `TTE > T_maker_min` AND `edge > E_maker` → GTC post-only; else FOK taker.
- Cancel/replace on edge drop or best-level move > 1 tick.
- Force-close near exit with `max(base_s, pct * TTE)`.
- Fix buy-only executor: accept BUY/SELL from decision.
- Fix live-fill → PositionRecord bridge via user WS channel.
- Paper fills walk the book VWAP-style.

### Phase 4 — Per-family risk + correlation-aware portfolio
- `RiskProfile` per family: `btc_1h`, `btc_15m`, `btc_5m`.
- Replace single-position rule with `max_concurrent_positions` + `max_total_exposure_usd`.
- Correlation gate: cap net BTC directional exposure across families.
- Dynamic `exit_buffer_seconds = max(base_s, pct * TTE)`.
- Tighten `stale_data_seconds`: 2s for 5m, 3s for 15m, 5s for 1h.
- Add `btc_15m` scorer to `PolymarketConnector`.

### Phase 5 — Operational readiness (daemon, metrics, reconciliation)
- `polymarket-ai-agent daemon` CLI runs forever, auto-reconnect WS.
- `/api/metrics` (Prometheus text) + `/api/healthz`.
- Kill-switch hooks.
- systemd unit + log rotation + SQLite backup cron in `docs/DEPLOYMENT.md`.

### Phase 6 — Front-end + operator UX upgrades (optional)
- SSE-driven dashboard with per-family panels.
- RiskProfile editor in settings.

---

## Out of Scope

- ML fair-value beyond closed-form starting point.
- Multi-asset expansion (ETH, etc.).
- On-chain fill verification beyond `py-clob-client`.
- RL / automated strategy selection.

---

## Verification Strategy (across phases)

1. `make test` stays green.
2. Paper soak per phase: 4h btc_1h, 2h btc_15m, 1h btc_5m. Record hit rate, captured vs projected edge, cancel ratio, latency.
3. Walk-forward replay on journaled events; each model must beat previous on same window.
4. $1 live smoke after Phase 3 and Phase 5.
5. Dashboards show open positions, daily PnL, WS lag, model vs market edge, rejection histogram.

---

## The Three Biggest Wins

1. Wire up Polymarket + BTC websockets + asyncio daemon (Phase 1).
2. Correct per-side edge formula with quant fair value (Phase 2).
3. SELL + cancel/replace + live-fill → position bridge (Phase 3).
