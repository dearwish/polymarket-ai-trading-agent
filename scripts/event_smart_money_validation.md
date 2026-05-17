# Cross-Event Validation — Smart-Money Top-1 Pick

**Date:** 2026-05-17
**Script:** [`scripts/event_smart_money.py`](event_smart_money.py)
**Filter:** `--min-position-usd 2000 --min-avg-price 0.01`

## Results

| Event | Top-1 by conviction | Avg paid | Invested $ | Current YES | Result |
|---|---|---:|---:|---:|---|
| `eurovision-winner-2026` | **Bulgaria** | $0.076 | $2,194,407 | **$0.997** | **HIT ✓** |
| `eurovision-2026-televote-winner` | **Bulgaria** | $0.122 | $59,916 | **$0.9995** | **HIT ✓** |
| `eurovision-2026-jury-winner` | **Bulgaria** | $0.488 | $123,172 | **$0.9995** | **HIT ✓** |
| `peru-presidential-election` | Keiko Fujimori | $0.458 | $2,716,789 | $0.6450 | OPEN |

**Resolved: 3/3 hits (100%)** — but with the giant caveat below.

## Mirror payoff (top-1 only, $5 per event)

| Event | Deployed | Realized | ROI |
|---|---:|---:|---:|
| Eurovision main | $5 | $64.38 | +1188% |
| Eurovision televote | $5 | $40.24 | +705% |
| Eurovision jury | $5 | $10.14 | +103% |
| **Aggregate** | **$15** | **$114.76** | **+665%** |

Note how the magnitude tracks the avg buy price — smart money paid more for Bulgaria-Jury than Bulgaria-Main (0.488 vs 0.076), meaning they were less sure about jury vs televote. Lower avg-paid = bigger asymmetric payoff if the pick wins.

## The honest reading

**3 of 3 is not the same as 100% hit rate.** The three Eurovision markets are correlated — they're three different ways to bet on the same underlying contest outcome (Bulgaria won the combined ranking, the televote, AND the jury vote). One sweep, three columns. The independent-sample count here is closer to **n = 1.5** than n = 3.

Peru is the only truly independent test in this batch, and it's not yet resolved. Top-1 conviction picked Keiko Fujimori; current implied YES is 65%, so the framework is leaning right but we won't know until the runoff resolves.

## What needs to happen before deploying capital

1. **20+ truly independent resolved events.** Different categories (sports, politics, awards), different time horizons (next-week, next-month, next-year), different countries. Polymarket's gamma-api `/events` endpoint caps at 100 results and the `search` parameter is broken, so this is a real discoverability problem — needs either:
   - Scraping the Polymarket UI's `/markets?_status=resolved` page
   - Pulling from The Graph subgraph (`polymarket/matic-markets`) for the full event archive
   - A maintained slug list of historically-significant winner-events

2. **Conviction score recalibration on more data.** The current `invested $ × avg_paid` formula was tuned for Eurovision. It might over- or under-weight signal on different market types (e.g., presidential elections where serious money sits at 50-60¢, vs sports where it sits at 20-40¢).

3. **Wallet-track-record overlay.** The top conviction holders on Bulgaria-YES (`rdba`, `CryptoVagabond`, `skk1ch`) should be cross-checked against their prior multi-event accuracy. A wallet that's been right on 5 of 7 past events is a stronger signal than a one-shot whale.

4. **Forward-test paper soak.** Run the analyzer daily on upcoming events with end-dates ≤30 days out, log the top-1 pick at each scan, and measure hit rate after resolution. Three months of forward-only data is the cleanest proof.

## Next concrete step

I'd build a small `scripts/event_smart_money_backtest.py` that:

- Maintains a curated list of historical event slugs in `scripts/_event_archive.json` (start with whatever's surfaceable via gamma + manual seeds).
- For each slug, runs `event_smart_money.score_outcome` on a frozen snapshot of holders captured BEFORE resolution (would need to be scraped going forward, since live `/v1/market-positions` only returns current state).
- Reports hit rate, mirror ROI per K, and per-category breakdowns.

Without that, every additional run is just another sample-of-one. Eurovision 2026 says the framework can work; it doesn't say it does work reliably.

## Files

- [`scripts/event_smart_money.py`](event_smart_money.py) — the analyzer itself
- [`scripts/event_smart_money_eurovision-winner-2026.md`](event_smart_money_eurovision-winner-2026.md) — Eurovision main report
- [`scripts/event_smart_money_eurovision-2026-televote-winner.md`](event_smart_money_eurovision-2026-televote-winner.md)
- [`scripts/event_smart_money_eurovision-2026-jury-winner.md`](event_smart_money_eurovision-2026-jury-winner.md)
- [`scripts/event_smart_money_peru-presidential-election-winner.md`](event_smart_money_peru-presidential-election-winner.md)
