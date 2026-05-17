"""Event-specific smart-money analyzer for Polymarket multi-outcome markets.

Why this exists: the naive ``copy_mirror_sim.py`` mirrored top-N wallets
by all-time PnL across every market they touched. That filter fails for
event-driven markets like Eurovision — the wallets who specialize in
those events are usually NOT on the all-time leaderboard, and the
all-time-leaderboard wallets' Eurovision activity is mostly noise.

This script flips the approach: for each outcome of a given event, it
pulls the top holders DIRECTLY from
``data-api.polymarket.com/v1/market-positions``, computes a smart-money
conviction score per outcome, and surfaces the consensus pick.

Smart-money signal definitions (per outcome):

- ``smart_size_usd``     = sum of $ invested by top holders of YES side
                           (excluding lottery dust below ``--min-avg-price``)
- ``smart_avg_price``    = volume-weighted avg YES price they paid
- ``smart_pnl_usd``      = aggregate realized + paper PnL of those holders
- ``smart_conviction``   = invested $ × avg_paid (rewards moderate-price
                           accumulation, NOT sub-cent lotto buys)

Why two scores? Pre-resolution, only conviction is observable; the
realized P&L is still zero. Post-resolution (or partially-resolved
markets) the realized P&L IS the signal — keep that column too so
backtests of this analyzer on past events have a ground-truth column.

The lottery-filter (``--min-avg-price``) is the most important knob:
without it, the script ranks Poland-at-$0.003 above Bulgaria-at-$0.05
even though the former is degen lotto and the latter is a real bet.
A sane default is 0.01 (one cent) — anything below that is degens
paying $30 for a $10,000 payout, not informed accumulation.

Usage:
  uv run python scripts/event_smart_money.py --event-slug eurovision-winner-2026
  uv run python scripts/event_smart_money.py --event-slug presidential-election-winner-2028 \
      --min-position-usd 1000 --top-holders 20
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Canonical analyzer lives in the engine package — script imports the
# primitives from there so the CLI report-writer, the backtest, the
# forward-test snapshot, and the API/CLI endpoints all share one
# implementation (with the closed=true gamma fallback for resolved
# markets, etc.).
_SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(_SRC))
from polymarket_trading_engine.engine.event_smart_money import (  # noqa: E402
    GAMMA_EVENTS_URL,
    GAMMA_MARKET_URL,
    POSITIONS_URL,
    EventNotFoundError,
    OutcomeSignal,
    fetch_event as _engine_fetch_event,
    fetch_holders,
    fetch_market_state,
    score_outcome as _engine_score_outcome,
    _http_get as http_get,
)


def fetch_event(slug: str) -> dict:
    """Wrapper that preserves the script's original SystemExit-on-miss
    semantics for backward compatibility with the report-writing CLI."""
    try:
        return _engine_fetch_event(slug)
    except EventNotFoundError as exc:
        raise SystemExit(str(exc)) from exc


def score_outcome(
    country: str,
    cid: str,
    yes_price: float,
    no_price: float,
    closed: bool,
    yes_holders: list[dict],
    no_holders: list[dict],
    min_position_usd: float,
    min_avg_price: float,
) -> OutcomeSignal:
    """Compatibility shim — earlier consumers used positional ``country``
    while the engine module exposes ``outcome``. The returned OutcomeSignal
    has ``.outcome`` field but we expose ``.country`` here as an alias so
    the script's report writer keeps working without churn."""
    sig = _engine_score_outcome(
        country, cid, yes_price, no_price, closed,
        yes_holders, no_holders, min_position_usd, min_avg_price,
    )
    # Add a ``country`` attribute alias for legacy report code.
    object.__setattr__(sig, "country", sig.outcome)
    return sig


def write_report(event_title: str, signals: list[OutcomeSignal], out_path: Path) -> None:
    sections: list[str] = []
    sections.append(f"# Event smart-money analysis: {event_title}\n")
    sections.append(f"**Generated:** {datetime.now(timezone.utc).isoformat()}\n")
    sections.append(f"**Outcomes scanned:** {len(signals)}\n")
    sections.append("\n## How to read this\n")
    sections.append("Each row shows the *smart-money conviction* for that outcome — "
                    "summed across the top YES-token holders (with min position size and "
                    "non-zero avg buy price to filter dust). Higher `conviction` = more $ "
                    "committed at a lower buy price by multiple wallets.\n")
    sections.append("- `current_yes` is live market implied probability")
    sections.append("- `holders` is the number of significant YES holders (≥ min-position-usd)")
    sections.append("- `avg_paid` is the volume-weighted YES price they bought at")
    sections.append("- `invested $` is total YES capital from the filtered holders")
    sections.append("- `realized PnL` shows whether they've already been right\n")

    signals_sorted = sorted(signals, key=lambda s: -s.smart_conviction)

    sections.append("## Outcomes ranked by smart-money conviction\n")
    sections.append("| # | outcome | current_yes | holders | avg_paid | invested $ | realized PnL | total PnL | conviction |")
    sections.append("|---|---|---:|---:|---:|---:|---:|---:|---:|")
    for i, s in enumerate(signals_sorted[:20], 1):
        if s.smart_conviction <= 0 and s.yes_holders_count == 0:
            continue
        sections.append(
            f"| {i} | **{s.country}** | {s.current_yes_price:.4f} | "
            f"{s.yes_holders_count} | {s.yes_avg_price:.3f} | "
            f"${s.yes_total_size_usd:,.0f} | ${s.yes_total_realized_pnl:+,.0f} | "
            f"${s.yes_total_pnl:+,.0f} | {s.smart_conviction:,.0f} |"
        )
    sections.append("")

    sections.append("## Top-5 holders per top-3 outcome\n")
    for s in signals_sorted[:3]:
        sections.append(f"### {s.country} (conviction {s.smart_conviction:,.0f}, current YES {s.current_yes_price:.4f})\n")
        sections.append("| wallet | name | avg buy price | $ invested |")
        sections.append("|---|---|---:|---:|")
        for wallet_info in s.yes_top_wallets:
            # Engine module returns dicts; old script used tuples — handle both.
            if isinstance(wallet_info, dict):
                w = wallet_info["wallet"][:10] + "…"
                name = wallet_info["name"][:18]
                avg = wallet_info["avg_price"]
                bought = wallet_info["bought_usd"]
            else:
                w, name, avg, bought = wallet_info
            sections.append(f"| `{w}` | {name} | {avg:.3f} | ${bought:,.0f} |")
        sections.append("")

    out_path.write_text("\n".join(sections))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event-slug", required=True,
                    help="Polymarket event slug, e.g. 'eurovision-winner-2026'")
    ap.add_argument("--min-position-usd", type=float, default=1000.0,
                    help="Drop holders below this $ position size (filters dust). "
                         "Lower for thin markets, higher for liquid politics/sports.")
    ap.add_argument("--min-avg-price", type=float, default=0.01,
                    help="Drop holders whose avg buy price is below this (filters "
                         "sub-cent lottery tickets). Default 0.01 = one cent.")
    ap.add_argument("--top-holders", type=int, default=30,
                    help="Pull this many top holders per outcome from market-positions endpoint.")
    ap.add_argument("--delay-seconds", type=float, default=0.15)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    event = fetch_event(args.event_slug)
    title = event.get("title", args.event_slug)
    markets = event.get("markets", [])
    print(f"[event] {title} — {len(markets)} outcomes", file=sys.stderr)

    signals: list[OutcomeSignal] = []
    for idx, m in enumerate(markets, 1):
        country = m.get("groupItemTitle") or m.get("question", "")
        cid = m.get("conditionId")
        if not cid:
            continue
        try:
            yes_px, no_px, closed = fetch_market_state(cid)
            yes_h, no_h = fetch_holders(cid, args.top_holders)
        except Exception as exc:
            print(f"  [warn] {country}: {exc}", file=sys.stderr)
            continue
        sig = score_outcome(
            country, cid, yes_px, no_px, closed,
            yes_h, no_h, args.min_position_usd, args.min_avg_price,
        )
        signals.append(sig)
        if idx % 10 == 0:
            print(f"  [{idx}/{len(markets)}] last={country} conviction={sig.smart_conviction:,.0f}",
                  file=sys.stderr)
        time.sleep(args.delay_seconds)

    out_path = args.out or Path(f"scripts/event_smart_money_{args.event_slug}.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_report(title, signals, out_path)
    print(f"\n[out] wrote {out_path}", file=sys.stderr)

    # Headline: top 3 picks.
    top3 = sorted(signals, key=lambda s: -s.smart_conviction)[:3]
    print("\n[TOP 3 SMART-MONEY PICKS]", file=sys.stderr)
    for i, s in enumerate(top3, 1):
        print(f"  #{i}: {s.country:<20}  current_yes={s.current_yes_price:.4f}  "
              f"conviction={s.smart_conviction:,.0f}  invested=${s.yes_total_size_usd:,.0f}  "
              f"avg_paid={s.yes_avg_price:.3f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
