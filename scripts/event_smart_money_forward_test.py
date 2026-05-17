"""Daily snapshot cron + resolution-tracking report for event smart-money.

Designed to be run once per day (or hourly). Two modes:

  ``--mode snapshot``  scan all active multi-outcome winner-style events
                       with end-date within ``--end-within-days``, run the
                       conviction analyzer, append a JSONL line per event
                       to ``scripts/_event_smart_money_snapshots.jsonl``.

  ``--mode report``    read the snapshot archive, fetch current state for
                       every snapshotted event, identify resolved ones,
                       compute hit rate + mirror payoff over the entire
                       forward-test history.

Recommended cron (once daily at 10:00 UTC):

  0 10 * * * cd ~/playground/polymarket-trading-engine && \
      uv run python scripts/event_smart_money_forward_test.py --mode snapshot \
      >> logs/event_smart_money_forward_test.log 2>&1

The snapshot file is append-only JSONL — each line is one event snapshot
at a single point in time. The report mode dedupes by (slug, snapshot
date) and only counts each event once for hit-rate (using its earliest
in-archive snapshot — the closest we can get to pre-resolution data).

Discovery: pulls active events from gamma-api with ``volumeNum`` sort
descending and filters by ``len(markets) >= 5`` plus slug keywords
(winner|champion|nominee|election|mvp|cup). End-of-archive deduplication
keeps the script idempotent if cron fires twice in a day.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Reuse the analyzer's primitives.
sys.path.insert(0, str(Path(__file__).parent))
from event_smart_money import (  # noqa: E402
    fetch_event,
    fetch_market_state,
    fetch_holders,
    http_get,
    score_outcome,
)


SNAPSHOTS_PATH = Path("scripts/_event_smart_money_snapshots.jsonl")
GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events"


WINNER_KEYWORDS = ("winner", "champion", "nominee", "election", "mvp", "cup",
                   "best-picture", "best-actor", "president", "primary")


def discover_active_events(end_within_days: float, min_outcomes: int) -> list[dict]:
    """Return active multi-outcome winner-style events with end date soon."""
    now = datetime.now(timezone.utc)
    candidates: list[dict] = []
    for offset in (0, 100, 200):
        try:
            data = http_get(
                GAMMA_EVENTS_URL,
                {"active": "true", "closed": "false", "limit": 100, "offset": offset,
                 "order": "volume24hr", "ascending": "false"},
            )
        except Exception as exc:
            print(f"  [warn] gamma /events offset={offset}: {exc}", file=sys.stderr)
            continue
        if not data:
            break
        for e in data:
            if len(e.get("markets", [])) < min_outcomes:
                continue
            slug = (e.get("slug") or "").lower()
            title = (e.get("title") or "").lower()
            if not any(k in slug + title for k in WINNER_KEYWORDS):
                continue
            end = e.get("endDate") or ""
            if not end:
                continue
            try:
                end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            except Exception:
                continue
            days_to_end = (end_dt - now).total_seconds() / 86400
            # Keep events ending within the window OR recently resolved (so
            # we can capture the late snapshot too).
            if -30 <= days_to_end <= end_within_days:
                candidates.append(e)
    # Dedupe by slug.
    seen: dict[str, dict] = {}
    for e in candidates:
        seen.setdefault(e.get("slug",""), e)
    return list(seen.values())


def already_snapshotted_today(slug: str, today_str: str) -> bool:
    if not SNAPSHOTS_PATH.exists():
        return False
    # Cheap tail-only scan — last 200 lines, since we run daily and
    # there are < 30 events per day this is plenty.
    with SNAPSHOTS_PATH.open() as f:
        lines = f.readlines()[-500:]
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("slug") == slug and row.get("snapshot_date") == today_str:
            return True
    return False


def take_snapshot(slug: str, min_position_usd: float, min_avg_price: float,
                  delay_seconds: float, top_holders: int) -> dict | None:
    try:
        event = fetch_event(slug)
    except Exception as exc:
        print(f"  [skip] {slug}: {exc}", file=sys.stderr)
        return None
    markets = event.get("markets", [])
    signals = []
    for m in markets:
        country = m.get("groupItemTitle") or m.get("question", "")
        cid = m.get("conditionId")
        if not cid:
            continue
        try:
            yes_px, no_px, closed = fetch_market_state(cid)
            yes_h, no_h = fetch_holders(cid, top_holders)
        except Exception:
            continue
        sig = score_outcome(country, cid, yes_px, no_px, closed,
                            yes_h, no_h, min_position_usd, min_avg_price)
        signals.append(sig)
        time.sleep(delay_seconds)
    signals.sort(key=lambda s: -s.smart_conviction)
    top10 = [{
        "country": s.country,
        "conviction": round(s.smart_conviction, 2),
        "yes_avg_price": round(s.yes_avg_price, 4),
        "yes_total_size_usd": round(s.yes_total_size_usd, 2),
        "current_yes_price": round(s.current_yes_price, 4),
        "yes_holders_count": s.yes_holders_count,
    } for s in signals[:10] if s.smart_conviction > 0]
    return {
        "snapshot_ts": datetime.now(timezone.utc).isoformat(),
        "snapshot_date": datetime.now(timezone.utc).date().isoformat(),
        "slug": slug,
        "title": event.get("title", slug),
        "end_date": event.get("endDate", ""),
        "n_outcomes": len(markets),
        "top10": top10,
    }


def cmd_snapshot(args) -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"[snapshot] {today} — discovering active events…", file=sys.stderr)
    events = discover_active_events(args.end_within_days, args.min_outcomes)
    print(f"[snapshot] {len(events)} candidate events in window", file=sys.stderr)

    SNAPSHOTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    new_count = 0
    skipped_count = 0
    with SNAPSHOTS_PATH.open("a") as f:
        for e in events:
            slug = e.get("slug")
            if already_snapshotted_today(slug, today):
                skipped_count += 1
                continue
            print(f"  [event] {slug}", file=sys.stderr)
            snap = take_snapshot(slug, args.min_position_usd, args.min_avg_price,
                                 args.delay_seconds, args.top_holders)
            if not snap:
                continue
            f.write(json.dumps(snap) + "\n")
            f.flush()
            new_count += 1
    print(f"\n[snapshot] wrote {new_count} new · skipped {skipped_count} already-today",
          file=sys.stderr)
    return 0


def cmd_report(args) -> int:
    if not SNAPSHOTS_PATH.exists():
        print(f"[err] no snapshots yet at {SNAPSHOTS_PATH}", file=sys.stderr)
        return 1

    # Group by slug; keep EARLIEST snapshot per slug (closest to pre-resolution
    # for events that have since resolved).
    by_slug: dict[str, dict] = {}
    with SNAPSHOTS_PATH.open() as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            slug = row.get("slug")
            if not slug:
                continue
            existing = by_slug.get(slug)
            if existing is None or row.get("snapshot_ts", "") < existing.get("snapshot_ts", ""):
                by_slug[slug] = row
    print(f"[report] tracking {len(by_slug)} unique events from snapshot archive",
          file=sys.stderr)

    # Fetch current state for each — has the event resolved?
    resolved: list[dict] = []
    pending: list[dict] = []
    for slug, snap in sorted(by_slug.items()):
        try:
            event = fetch_event(slug)
        except Exception as exc:
            print(f"  [skip] {slug}: {exc}", file=sys.stderr)
            continue
        # Find the winner by scanning each outcome's current YES price.
        winner = None
        max_yes = 0.0
        for m in event.get("markets", []):
            cid = m.get("conditionId")
            if not cid:
                continue
            try:
                yes_px, _no_px, _closed = fetch_market_state(cid)
            except Exception:
                continue
            country = m.get("groupItemTitle") or m.get("question", "")
            if yes_px > max_yes:
                max_yes = yes_px
                if yes_px >= 0.95:
                    winner = country
            time.sleep(args.delay_seconds)
        snap["current_winner"] = winner
        snap["current_max_yes"] = max_yes
        if winner:
            resolved.append(snap)
        else:
            pending.append(snap)

    # Compute hit rate + mirror payoff.
    hits = []
    misses = []
    for snap in resolved:
        top1 = snap["top10"][0] if snap["top10"] else None
        if not top1:
            continue
        if top1["country"] == snap["current_winner"]:
            hits.append(snap)
        else:
            misses.append(snap)

    def payoff(snap, k):
        pnl = 0.0
        for pick in snap["top10"][:k]:
            avg = pick["yes_avg_price"]
            cur = next((m_cur for m_cur in [snap.get("current_max_yes")] if pick["country"] == snap.get("current_winner")), 0.0)
            # Simpler: if it's the winner, cur ≈ 0.99; else cur ≈ 0.01 (loser)
            cur = 0.9995 if pick["country"] == snap.get("current_winner") else 0.0005
            if avg <= 0:
                continue
            shares = 5.0 / avg
            cur_val = shares * cur
            gross = cur_val - 5.0
            fee = max(0.0, gross) * 0.02
            pnl += gross - fee
        return pnl

    pnl_1 = sum(payoff(s, 1) for s in resolved)
    pnl_3 = sum(payoff(s, 3) for s in resolved)
    pnl_5 = sum(payoff(s, 5) for s in resolved)
    deployed_1 = len(resolved) * 5
    hit_rate = len(hits) / max(len(resolved), 1)

    # Write report.
    out = []
    out.append("# Event Smart-Money Forward-Test Report\n")
    out.append(f"**Generated:** {datetime.now(timezone.utc).isoformat()}\n")
    out.append(f"**Snapshots tracked:** {len(by_slug)} unique events\n")
    out.append(f"**Resolved since snapshot:** {len(resolved)}\n")
    out.append(f"**Still pending:** {len(pending)}\n\n")
    out.append("## Hit rate (top-1 by conviction)\n")
    out.append(f"- Hits: **{len(hits)} / {len(resolved)}** ({hit_rate:.0%})\n")
    if deployed_1:
        out.append(f"- top-1 mirror payoff: ${deployed_1} → ${deployed_1 + pnl_1:.2f} ({pnl_1/deployed_1:+.1%})\n")
        out.append(f"- top-3 mirror payoff: ${deployed_1*3} → ${deployed_1*3 + pnl_3:.2f} ({pnl_3/(deployed_1*3):+.1%})\n")
        out.append(f"- top-5 mirror payoff: ${deployed_1*5} → ${deployed_1*5 + pnl_5:.2f} ({pnl_5/(deployed_1*5):+.1%})\n")

    out.append("\n## Resolved events\n")
    out.append("| slug | snapshot date | top-1 pick | actual winner | hit | top-1 P&L |")
    out.append("|---|---|---|---|:---:|---:|")
    for snap in sorted(resolved, key=lambda s: s.get("snapshot_date","")):
        top1 = snap["top10"][0] if snap["top10"] else {"country": "—", "yes_avg_price": 0}
        mark = "✓" if top1.get("country") == snap.get("current_winner") else "✗"
        pnl = payoff(snap, 1)
        out.append(
            f"| `{snap['slug']}` | {snap.get('snapshot_date','')} | "
            f"{top1.get('country','—')} (paid {top1.get('yes_avg_price',0):.3f}) | "
            f"{snap.get('current_winner','—')} | {mark} | ${pnl:+.2f} |"
        )

    out.append("\n## Pending events\n")
    out.append("| slug | snapshot date | top-1 pick | current_yes | end_date |")
    out.append("|---|---|---|---:|---|")
    for snap in sorted(pending, key=lambda s: s.get("end_date","")):
        top1 = snap["top10"][0] if snap["top10"] else {"country": "—", "yes_avg_price": 0, "current_yes_price": 0}
        out.append(
            f"| `{snap['slug']}` | {snap.get('snapshot_date','')} | "
            f"{top1.get('country','—')} | {top1.get('current_yes_price',0):.3f} | "
            f"{snap.get('end_date','')[:10]} |"
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(out))
    print(f"\n[out] wrote {args.out}", file=sys.stderr)
    if resolved:
        print(f"[SUMMARY] {len(hits)}/{len(resolved)} hits ({hit_rate:.0%}) · "
              f"top-1 ROI {pnl_1/max(deployed_1,1):+.1%}", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["snapshot", "report"], default="snapshot")
    ap.add_argument("--end-within-days", type=float, default=30.0,
                    help="Only snapshot events ending within this many days.")
    ap.add_argument("--min-outcomes", type=int, default=5)
    ap.add_argument("--min-position-usd", type=float, default=2000.0)
    ap.add_argument("--min-avg-price", type=float, default=0.01)
    ap.add_argument("--top-holders", type=int, default=30)
    ap.add_argument("--delay-seconds", type=float, default=0.15)
    ap.add_argument("--out", type=Path,
                    default=Path("scripts/event_smart_money_forward_test_report.md"))
    args = ap.parse_args()
    if args.mode == "snapshot":
        return cmd_snapshot(args)
    return cmd_report(args)


if __name__ == "__main__":
    raise SystemExit(main())
