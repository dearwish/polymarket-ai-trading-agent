"""Honest forward evaluation of the event-smart-money snapshots.

For every event in scripts/_event_smart_money_snapshots.jsonl whose end_date has
passed, take the EARLIEST snapshot (no lookahead), pick the top-1 outcome by
conviction, and check against the resolved winner via the gamma API.

Reports top-1 hit rate and mirror ROI (buy $1 of top-1 YES at the snapshot's
current_yes_price).
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOTS = Path(__file__).parent / "_event_smart_money_snapshots.jsonl"
CACHE = Path(__file__).parent / "_forward_eval_resolution_cache.json"
GAMMA = "https://gamma-api.polymarket.com/events/slug/{slug}"


def load_first_snapshots() -> dict[str, dict]:
    first: dict[str, dict] = {}
    with SNAPSHOTS.open() as f:
        for line in f:
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue
            slug = s["slug"]
            if slug not in first or s["snapshot_ts"] < first[slug]["snapshot_ts"]:
                first[slug] = s
    return first


def fetch_winner(slug: str, cache: dict) -> tuple[str | None, str]:
    """Return (winner_title, status). status: ok|open|ambiguous|error."""
    if slug in cache:
        return cache[slug]["winner"], cache[slug]["status"]
    url = GAMMA.format(slug=slug)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "forward-eval/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            event = json.load(resp)
    except Exception as exc:  # noqa: BLE001
        return None, f"error:{exc}"
    winners = []
    any_open = False
    for m in event.get("markets", []):
        prices = m.get("outcomePrices")
        if isinstance(prices, str):
            try:
                prices = json.loads(prices)
            except json.JSONDecodeError:
                prices = None
        closed = m.get("closed", False)
        if not closed:
            any_open = True
            continue
        if prices and float(prices[0]) > 0.99:
            winners.append(m.get("groupItemTitle") or m.get("question", ""))
    if len(winners) == 1:
        result = (winners[0], "ok")
    elif winners:
        result = (winners[0], "multi")  # e.g. "advance" events with many YES
    elif any_open:
        result = (None, "open")
    else:
        result = (None, "no_winner")
    cache[slug] = {"winner": result[0], "status": result[1]}
    return result


def main() -> None:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    first = load_first_snapshots()
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for slug, snap in sorted(first.items()):
        end = snap.get("end_date") or ""
        if not end or end > now:
            continue
        top10 = snap.get("top10") or []
        if not top10:
            continue
        winner, status = fetch_winner(slug, cache)
        time.sleep(0.2)
        pick = top10[0]
        rows.append(
            {
                "slug": slug,
                "snapshot_date": snap["snapshot_date"],
                "n_outcomes": snap.get("n_outcomes"),
                "pick": pick["country"],
                "pick_price": pick["current_yes_price"],
                "winner": winner,
                "status": status,
                "hit": (winner is not None and pick["country"].strip().lower() == winner.strip().lower()),
            }
        )
    CACHE.write_text(json.dumps(cache, indent=1))

    resolved = [r for r in rows if r["status"] in ("ok", "multi") and r["winner"]]
    clean = [r for r in resolved if r["status"] == "ok"]
    hits = [r for r in clean if r["hit"]]
    print(f"events with passed end_date: {len(rows)}")
    print(f"cleanly resolved (single winner): {len(clean)}; multi/ambiguous: {len(resolved) - len(clean)}")
    if clean:
        print(f"top-1 hit rate: {len(hits)}/{len(clean)} = {len(hits) / len(clean):.1%}")
        invested = 0.0
        returned = 0.0
        for r in clean:
            price = float(r["pick_price"]) or 0.0
            if price <= 0 or price >= 1:
                continue
            invested += 1.0
            if r["hit"]:
                returned += 1.0 / price
        if invested:
            print(f"mirror $1/event: invested ${invested:.0f}, returned ${returned:.2f}, ROI {returned / invested - 1:+.1%}")
    print()
    for r in sorted(rows, key=lambda r: r["snapshot_date"]):
        mark = "WIN " if r["hit"] else ("....." if r["status"] in ("ok", "multi") else r["status"][:12])
        print(f"{mark:13s} {r['snapshot_date']} {r['slug'][:55]:55s} pick={r['pick'][:28]:28s} @{r['pick_price']:<7} winner={str(r['winner'])[:30]}")


if __name__ == "__main__":
    main()
