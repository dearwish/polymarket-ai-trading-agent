"""Retrospective validation of ``event_smart_money.py`` across historical events.

Reads ``scripts/_event_seed_slugs.json`` (curated list of resolved
multi-outcome winner-style events) and runs the conviction-ranking
analyzer on each. For each event, identifies the actual winner from
current ``outcomePrices`` (the resolved YES side is at $0.99+; everything
else at $0.01-) and compares to the top-1 by conviction.

Outputs:
  - per-event hit/miss table
  - per-category hit rate breakdown
  - aggregate mirror payoff at top-K = 1, 3, 5, 10
  - per-event mirror payoff detail

Important caveat baked into the math: ``/v1/market-positions`` returns
*current* holder state, including closed positions (with realized PnL).
For resolved events the holder data is therefore biased toward (a)
hodlers who never sold and (b) closers whose realized PnL still appears
in the response. This is the same data shape that would have been
available pre-resolution if we'd snapshotted it then — but we're reading
it post-resolution, so the test is "did smart money pre-resolution
correctly pick the winner?" approximated by "did the wallets with the
biggest dollars at moderate buy prices end up holding the winning side?"

Usage:
  uv run python scripts/event_smart_money_backtest.py
  uv run python scripts/event_smart_money_backtest.py --min-position-usd 5000 --min-avg-price 0.02
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

# Reuse the analyzer's primitives.
sys.path.insert(0, str(Path(__file__).parent))
from event_smart_money import (  # noqa: E402
    fetch_event,
    fetch_market_state,
    fetch_holders,
    score_outcome,
)


SEED_PATH = Path("scripts/_event_seed_slugs.json")


@dataclass
class EventResult:
    slug: str
    category: str
    title: str
    n_outcomes: int
    actual_winner: str | None
    actual_winner_yes_price: float
    top_picks: list[tuple[str, float, float, float]]  # (country, conviction, avg_paid, current_yes)
    top1_country: str | None
    top1_avg_paid: float
    top1_current_yes: float
    top1_invested_usd: float
    hit: bool | None  # None when unresolved
    mirror_payoff_top1: float = 0.0   # P&L on $5 deployed
    mirror_payoff_top3: float = 0.0   # P&L on $15 deployed ($5 each)
    mirror_payoff_top5: float = 0.0


def mirror_payoff(picks: list[tuple[str, float, float, float]], k: int, size_usd: float, fee_rate: float) -> float:
    """Net P&L on $size_usd deployed into each of the top-k picks."""
    pnl = 0.0
    for country, conv, avg_paid, cur_yes in picks[:k]:
        if avg_paid <= 0:
            continue
        shares = size_usd / avg_paid
        cur_val = shares * cur_yes
        gross = cur_val - size_usd
        fee = max(0.0, gross) * fee_rate
        pnl += gross - fee
    return pnl


def find_actual_winner(signals: list) -> tuple[str | None, float]:
    """The winner of a resolved event is the outcome with YES ≥ 0.95.
    Returns (country, current_yes) or (None, max_yes) if unresolved."""
    if not signals:
        return None, 0.0
    sorted_by_yes = sorted(signals, key=lambda s: -s.current_yes_price)
    top = sorted_by_yes[0]
    if top.current_yes_price >= 0.95:
        return top.country, top.current_yes_price
    return None, top.current_yes_price


def analyze_event(slug: str, category: str, min_position_usd: float, min_avg_price: float,
                  delay_seconds: float, top_holders: int) -> EventResult | None:
    try:
        event = fetch_event(slug)
    except SystemExit as exc:
        print(f"  [skip] {slug}: {exc}", file=sys.stderr)
        return None
    except Exception as exc:
        print(f"  [skip] {slug}: {exc}", file=sys.stderr)
        return None
    title = event.get("title", slug)
    markets = event.get("markets", [])
    if len(markets) < 3:
        print(f"  [skip] {slug}: only {len(markets)} outcomes", file=sys.stderr)
        return None

    signals = []
    for m in markets:
        country = m.get("groupItemTitle") or m.get("question", "")
        cid = m.get("conditionId")
        if not cid:
            continue
        try:
            yes_px, no_px, closed = fetch_market_state(cid)
            yes_h, no_h = fetch_holders(cid, top_holders)
        except Exception as exc:
            print(f"    [warn] {country}: {exc}", file=sys.stderr)
            continue
        sig = score_outcome(country, cid, yes_px, no_px, closed,
                            yes_h, no_h, min_position_usd, min_avg_price)
        signals.append(sig)
        time.sleep(delay_seconds)

    signals.sort(key=lambda s: -s.smart_conviction)
    top_picks = [(s.country, s.smart_conviction, s.yes_avg_price, s.current_yes_price)
                 for s in signals if s.smart_conviction > 0]
    winner, winner_yes = find_actual_winner(signals)

    if not top_picks:
        return EventResult(
            slug=slug, category=category, title=title, n_outcomes=len(markets),
            actual_winner=winner, actual_winner_yes_price=winner_yes,
            top_picks=[], top1_country=None, top1_avg_paid=0.0, top1_current_yes=0.0,
            top1_invested_usd=0.0, hit=None,
        )

    top1_country, top1_conv, top1_avg, top1_yes = top_picks[0]
    top1_invested = next((s.yes_total_size_usd for s in signals if s.country == top1_country), 0.0)
    hit = None if winner is None else (top1_country == winner)
    return EventResult(
        slug=slug, category=category, title=title, n_outcomes=len(markets),
        actual_winner=winner, actual_winner_yes_price=winner_yes,
        top_picks=top_picks[:5],
        top1_country=top1_country, top1_avg_paid=top1_avg,
        top1_current_yes=top1_yes, top1_invested_usd=top1_invested, hit=hit,
        mirror_payoff_top1=mirror_payoff(top_picks, 1, 5.0, 0.02),
        mirror_payoff_top3=mirror_payoff(top_picks, 3, 5.0, 0.02),
        mirror_payoff_top5=mirror_payoff(top_picks, 5, 5.0, 0.02),
    )


def write_report(results: list[EventResult], args, out_path: Path) -> None:
    sections: list[str] = []
    sections.append("# Event Smart-Money Retrospective Backtest\n")
    sections.append(f"**Generated:** {datetime.now(timezone.utc).isoformat()}\n")
    sections.append(f"**Filter:** min-position=${args.min_position_usd:.0f}, min-avg-price=${args.min_avg_price:.4f}\n")
    sections.append(f"**Seed slugs analyzed:** {len(results)}\n")

    resolved = [r for r in results if r.hit is not None]
    unresolved = [r for r in results if r.hit is None]
    hits = [r for r in resolved if r.hit]
    misses = [r for r in resolved if not r.hit]

    hit_rate = len(hits) / max(len(resolved), 1)
    sections.append("\n## Aggregate hit rate (top-1 by conviction)\n")
    sections.append(f"- Resolved events: **{len(resolved)}**")
    sections.append(f"- Hits: **{len(hits)}** ({hit_rate:.0%})")
    sections.append(f"- Misses: **{len(misses)}**")
    sections.append(f"- Unresolved / skipped: {len(unresolved)}\n")

    # Aggregate mirror payoff
    total_deployed_1 = len(resolved) * 5
    total_pnl_1 = sum(r.mirror_payoff_top1 for r in resolved)
    total_pnl_3 = sum(r.mirror_payoff_top3 for r in resolved)
    total_pnl_5 = sum(r.mirror_payoff_top5 for r in resolved)
    sections.append("## Aggregate mirror payoff (resolved events only)\n")
    sections.append("| Basket | Deployed | Net P&L | ROI |")
    sections.append("|---|---:|---:|---:|")
    if total_deployed_1 > 0:
        sections.append(f"| top-1 ($5/event) | ${total_deployed_1} | ${total_pnl_1:+.2f} | {total_pnl_1/total_deployed_1:+.1%} |")
        sections.append(f"| top-3 ($15/event) | ${total_deployed_1*3} | ${total_pnl_3:+.2f} | {total_pnl_3/(total_deployed_1*3):+.1%} |")
        sections.append(f"| top-5 ($25/event) | ${total_deployed_1*5} | ${total_pnl_5:+.2f} | {total_pnl_5/(total_deployed_1*5):+.1%} |")
    sections.append("")

    sections.append("## Per-category hit rate\n")
    by_cat: dict[str, list[EventResult]] = defaultdict(list)
    for r in resolved:
        by_cat[r.category].append(r)
    sections.append("| Category | n | hits | hit rate | top-1 ROI |")
    sections.append("|---|---:|---:|---:|---:|")
    for cat, rs in sorted(by_cat.items()):
        h = sum(1 for r in rs if r.hit)
        pnl = sum(r.mirror_payoff_top1 for r in rs)
        deployed = len(rs) * 5
        sections.append(f"| {cat} | {len(rs)} | {h} | {h/len(rs):.0%} | {pnl/deployed:+.1%} |")
    sections.append("")

    sections.append("## Per-event detail\n")
    sections.append("| slug | category | top-1 pick | avg paid | invested $ | actual winner | hit | top-1 P&L |")
    sections.append("|---|---|---|---:|---:|---|:---:|---:|")
    for r in sorted(results, key=lambda x: x.category):
        status = "✓" if r.hit else ("✗" if r.hit is False else "—")
        winner_str = r.actual_winner or f"(unresolved, max YES {r.actual_winner_yes_price:.2f})"
        sections.append(
            f"| `{r.slug}` | {r.category} | {r.top1_country or '—'} | "
            f"{r.top1_avg_paid:.3f} | ${r.top1_invested_usd:,.0f} | "
            f"{winner_str} | {status} | ${r.mirror_payoff_top1:+.2f} |"
        )

    out_path.write_text("\n".join(sections))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=Path, default=SEED_PATH)
    ap.add_argument("--min-position-usd", type=float, default=2000.0)
    ap.add_argument("--min-avg-price", type=float, default=0.01)
    ap.add_argument("--top-holders", type=int, default=30)
    ap.add_argument("--delay-seconds", type=float, default=0.15)
    ap.add_argument("--out", type=Path, default=Path("scripts/event_smart_money_backtest_report.md"))
    args = ap.parse_args()

    seeds = json.loads(args.seeds.read_text())["events"]
    print(f"[seeds] loaded {len(seeds)} events from {args.seeds}", file=sys.stderr)

    results: list[EventResult] = []
    for i, s in enumerate(seeds, 1):
        slug = s["slug"]
        cat = s.get("category", "other")
        print(f"[event {i}/{len(seeds)}] {slug} ({cat})", file=sys.stderr)
        r = analyze_event(slug, cat, args.min_position_usd, args.min_avg_price,
                          args.delay_seconds, args.top_holders)
        if r:
            results.append(r)
            mark = '✓' if r.hit else ('✗' if r.hit is False else '?')
            print(f"   [{mark}] top1={r.top1_country} winner={r.actual_winner} p&l=${r.mirror_payoff_top1:+.2f}",
                  file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    write_report(results, args, args.out)
    print(f"\n[out] wrote {args.out}", file=sys.stderr)

    resolved = [r for r in results if r.hit is not None]
    hits = sum(1 for r in resolved if r.hit)
    pnl = sum(r.mirror_payoff_top1 for r in resolved)
    if resolved:
        print(f"\n[SUMMARY] {len(resolved)} resolved · {hits}/{len(resolved)} hits ({hits/len(resolved):.0%}) · "
              f"top-1 net P&L ${pnl:+.2f} on ${len(resolved)*5} deployed ({pnl/(len(resolved)*5):+.1%} ROI)",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
