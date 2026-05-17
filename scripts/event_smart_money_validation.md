# Event Smart-Money Strategy — Validation Status

**Last updated:** 2026-05-17

This file tracks the cumulative evidence for the event-smart-money
strategy across the three validation tracks built in `scripts/`:

| Track | Script | Purpose |
|---|---|---|
| #1 Forward-test (going-forward) | [`event_smart_money_forward_test.py`](event_smart_money_forward_test.py) | Daily cron snapshots conviction-ranked picks for active events; report mode evaluates hit rate after resolution. |
| #2 Retrospective backtest | [`event_smart_money_backtest.py`](event_smart_money_backtest.py) | Runs the analyzer on a curated list of resolved historical events ([`_event_seed_slugs.json`](_event_seed_slugs.json)). |
| #3 Engine integration | `engine/event_smart_money.py` + CLI command + API endpoint | Operator-accessible analyzer for any event slug. |

## #2 — Retrospective backtest result

Filter: `--min-position-usd 2000 --min-avg-price 0.01`

| Metric | Value |
|---|---|
| Seed slugs analyzed | 28 |
| Resolved events | 27 |
| **Top-1 hits** | **26 / 27 = 96%** |
| Top-1 mirror payoff | **+$209.11 on $135 deployed = +154.9% ROI** |
| Top-3 mirror payoff | −$26.31 on $405 deployed = −6.5% ROI |
| Top-5 mirror payoff | −$286.31 on $675 deployed = −42.4% ROI |

The **only miss** was the NHL Presidents Trophy (smart money said Washington Capitals; Winnipeg Jets won).

Top-1 is the sweet spot. The basket result for top-3/top-5 turns negative because the #2 and #3 picks (also nontrivial dollars at moderate prices) didn't win — picking ONLY the highest-conviction outcome and ignoring the runners-up is critical to the strategy.

### Per-category breakdown

| Category | n | hits | hit rate | top-1 ROI |
|---|---:|---:|---:|---:|
| culture (Eurovision) | 3 | 3 | 100% | +564.1% |
| intl-politics | 4 | 4 | 100% | +106.1% |
| sports | 16 | 15 | 94% | +101.3% |
| us-politics | 4 | 4 | 100% | +111.3% |

Sports has the most volume but also the only miss. International politics + Eurovision were unanimous. The ROI ranges from +100% (NBA Champion, Champions League, NFL MVP, NBA East/West Finals, Eurovision Jury) up to +880% (Portugal presidential, where smart money paid 30¢ for the winner) and +880%-equivalent for Eurovision Main (+$44 on $5).

### Reading the result honestly

1. **The signal is real but partially backward-looking**. `data-api.polymarket.com/v1/market-positions` returns current holder state — for resolved events, the YES winners are still in the top holders list. The strategy answers "did the wallets with the highest conviction at moderate prices win?" — and yes, they did, in 26 of 27. This validates the conviction formula and the lottery-filter.

2. **The pre-resolution test still has to happen** (#1). The current backtest reads holder data NOW, after resolution. To be truly predictive, we need to snapshot holder positions BEFORE the contest ends and check after — which is what #1 does going forward.

3. **96% is suspiciously high.** Possible failure modes the data can't yet exclude:
   - Survivorship in `/v1/market-positions` (closed positions are included with realized PnL, but very-early sellers may not appear)
   - The seed list itself is biased toward famous, decisive events (US presidential, NBA championship). Closer races would show lower hit rates.
   - Sports MVPs are essentially-known months in advance — the smart money's win there isn't predictive insight, it's lagged pricing.

## #1 — Forward-test status

First snapshot taken **2026-05-17** at [`_event_smart_money_snapshots.jsonl`](_event_smart_money_snapshots.jsonl):
- 25 active multi-outcome winner-style events with end date within 60 days
- Each snapshot records top-10 outcomes with conviction, avg paid, invested $, current YES, and holder count
- Cron command (operator runs):

```
0 10 * * * cd ~/playground/polymarket-trading-engine && \
  uv run python scripts/event_smart_money_forward_test.py --mode snapshot \
  >> logs/event_smart_money_forward_test.log 2>&1
```

After ~30 days of daily snapshots, run `--mode report` to see hit rate on events that have resolved since their first snapshot. That's the clean forward-only test.

## #3 — Engine integration

Three surfaces:

- **Engine module**: `src/polymarket_trading_engine/engine/event_smart_money.py` (analyze_event, score_outcome, fetch_market_state — single source of truth, used by the script, CLI, and API).
- **CLI command**: `polymarket-trading-engine event-analyze <slug> [--min-position-usd 2000] [--min-avg-price 0.01] [--json]`
- **API endpoint**: `GET /api/event-smart-money/{slug}?min_position_usd=2000&min_avg_price=0.01` — returns the same JSON shape, cached for 5 minutes per (slug, filters) tuple.
- **Tests**: `tests/test_event_smart_money.py` (8 tests, all passing) covering conviction formula, lottery filter, position-size filter, vol-weighted avg, closed=true fallback, and the end-to-end analyzer.

The CLI/API are read-only; they don't touch the daemon, journal, or settings store. This is an operator research tool, not a trading strategy in the daemon's decision loop.

## Caveats before deploying real capital

1. **Slippage**: the +154.9% ROI assumes mirror fills at `avg_paid` of the existing smart money — i.e. that you'd have bought in alongside them at the same prices. In reality, copying after their accumulation moves the price; realistic ROI is materially lower.
2. **Position size**: $5/event is plausible but $500/event would be visible enough to move the orderbook on smaller markets. Need per-market liquidity gating before scaling.
3. **Live-vs-resolved snapshot drift**: the retrospective backtest uses current holder data. For pre-resolution prediction, holder composition is different. Forward-test #1 is the cleanest test.
4. **Sample bias**: 28 hand-curated events skewed toward famous, decisive contests. Close races and obscure events likely have lower hit rates.

## Next steps

The 96% hit rate is striking but the strategy needs:
1. 30+ days of forward-test data from #1
2. A position-sizing model that respects per-market liquidity
3. A dashboard tab (Phase 4c, not built yet) so the operator can run the analyzer with one click instead of typing the CLI
4. A daily cron that picks up the snapshot and sends a Slack alert if any new event shows a clear top-1 conviction (a forward-looking "watch list")

## Files

- [`src/polymarket_trading_engine/engine/event_smart_money.py`](../src/polymarket_trading_engine/engine/event_smart_money.py) — engine module (analyzer core)
- [`tests/test_event_smart_money.py`](../tests/test_event_smart_money.py) — 8 unit tests
- [`scripts/event_smart_money.py`](event_smart_money.py) — CLI report writer (thin wrapper over engine)
- [`scripts/event_smart_money_backtest.py`](event_smart_money_backtest.py) — #2 retrospective backtest
- [`scripts/event_smart_money_backtest_report.md`](event_smart_money_backtest_report.md) — latest backtest run results
- [`scripts/event_smart_money_forward_test.py`](event_smart_money_forward_test.py) — #1 daily cron snapshotter
- [`scripts/_event_smart_money_snapshots.jsonl`](_event_smart_money_snapshots.jsonl) — snapshot archive (append-only)
- [`scripts/_event_seed_slugs.json`](_event_seed_slugs.json) — curated historical event slugs
