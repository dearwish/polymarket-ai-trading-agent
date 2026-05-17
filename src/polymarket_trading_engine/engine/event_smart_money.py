"""Engine-package version of the event smart-money analyzer.

The script-level entry point at ``scripts/event_smart_money.py`` calls
into this module — the script remains the human-friendly CLI for batch
runs and report generation, while the operator CLI command and FastAPI
endpoint call ``analyze_event`` directly without subprocess overhead.

Distinct from the BTC-microstructure trading strategies in this package
(``quant_scoring``, ``penny_scoring``, ``market_maker``) — the smart-
money analyzer is **research-only**, not a live trading strategy. It
surfaces signal for the operator to act on manually, and does not feed
the daemon's decision callback.

Why "research-only" and not a real strategy: event markets have
weeks-to-months horizons and discrete resolution, so the existing
event-driven daemon's per-tick loop is the wrong shape. A future
``event_strategy`` could ingest these signals on a daily cron, but
that's beyond the current scope.
"""
from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any


GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events"
GAMMA_MARKET_URL = "https://gamma-api.polymarket.com/markets"
POSITIONS_URL = "https://data-api.polymarket.com/v1/market-positions"


class EventNotFoundError(LookupError):
    pass


def _http_get(url: str, params: dict | None = None, timeout: int = 15) -> Any:
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


@dataclass
class OutcomeSignal:
    outcome: str
    condition_id: str
    current_yes_price: float
    current_no_price: float
    closed: bool
    yes_holders_count: int = 0
    yes_total_size_usd: float = 0.0
    yes_total_shares: float = 0.0
    yes_total_realized_pnl: float = 0.0
    yes_total_current_value: float = 0.0
    yes_total_pnl: float = 0.0
    yes_avg_price: float = 0.0
    yes_top_wallets: list[dict] = field(default_factory=list)
    no_holders_count: int = 0
    no_total_size_usd: float = 0.0
    no_avg_price: float = 0.0
    smart_conviction: float = 0.0

    def to_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "condition_id": self.condition_id,
            "current_yes_price": self.current_yes_price,
            "current_no_price": self.current_no_price,
            "closed": self.closed,
            "yes_holders_count": self.yes_holders_count,
            "yes_total_size_usd": self.yes_total_size_usd,
            "yes_total_pnl": self.yes_total_pnl,
            "yes_avg_price": self.yes_avg_price,
            "yes_top_wallets": self.yes_top_wallets,
            "smart_conviction": self.smart_conviction,
        }


def fetch_event(slug: str) -> dict:
    data = _http_get(GAMMA_EVENTS_URL, {"slug": slug})
    if not data:
        raise EventNotFoundError(f"event not found: {slug}")
    return data[0]


def fetch_market_state(condition_id: str) -> tuple[float, float, bool]:
    """Return (yes_price, no_price, closed) using the live per-market query.

    The default gamma /markets endpoint filters out closed markets, so when
    the first call returns an empty list we retry with ``closed=true``."""
    payload: list | None = None
    for params in (
        {"condition_ids": condition_id},
        {"condition_ids": condition_id, "closed": "true"},
    ):
        try:
            d = _http_get(GAMMA_MARKET_URL, params)
        except Exception:
            return 0.0, 0.0, False
        if isinstance(d, list) and d:
            payload = d
            break
    if not payload:
        return 0.0, 0.0, False
    m = payload[0]
    px = m.get("outcomePrices")
    if isinstance(px, str):
        try:
            px = json.loads(px)
        except Exception:
            px = None
    yes = float(px[0]) if px else 0.0
    no = float(px[1]) if (px and len(px) > 1) else 0.0
    closed = bool(m.get("closed") or m.get("isResolved"))
    return yes, no, closed


def fetch_holders(condition_id: str, limit: int = 30) -> tuple[list[dict], list[dict]]:
    """Return (yes_holders, no_holders) for a condition."""
    data = _http_get(POSITIONS_URL, {"market": condition_id, "limit": limit})
    yes_holders: list[dict] = []
    no_holders: list[dict] = []
    for token_block in data or []:
        for p in token_block.get("positions", []):
            if p.get("outcomeIndex") == 0:
                yes_holders.append(p)
            else:
                no_holders.append(p)
    return yes_holders, no_holders


def score_outcome(
    outcome: str,
    cid: str,
    yes_price: float,
    no_price: float,
    closed: bool,
    yes_holders: list[dict],
    no_holders: list[dict],
    min_position_usd: float,
    min_avg_price: float,
) -> OutcomeSignal:
    sig = OutcomeSignal(
        outcome=outcome,
        condition_id=cid,
        current_yes_price=yes_price,
        current_no_price=no_price,
        closed=closed,
    )
    yes_filtered = [
        p for p in yes_holders
        if float(p.get("totalBought") or 0) >= min_position_usd
        and float(p.get("avgPrice") or 0) >= min_avg_price
    ]
    if yes_filtered:
        sig.yes_holders_count = len(yes_filtered)
        for p in yes_filtered:
            sig.yes_total_size_usd += float(p.get("totalBought") or 0)
            sig.yes_total_shares += float(p.get("size") or 0)
            sig.yes_total_realized_pnl += float(p.get("realizedPnl") or 0)
            sig.yes_total_current_value += float(p.get("currentValue") or 0)
            sig.yes_total_pnl += float(p.get("totalPnl") or 0)
        weighted = sum(
            float(p.get("avgPrice") or 0) * float(p.get("totalBought") or 0)
            for p in yes_filtered
        )
        sig.yes_avg_price = weighted / sig.yes_total_size_usd if sig.yes_total_size_usd > 0 else 0.0
        yes_filtered.sort(key=lambda p: -float(p.get("totalBought") or 0))
        for p in yes_filtered[:5]:
            sig.yes_top_wallets.append({
                "wallet": str(p.get("proxyWallet") or ""),
                "name": str(p.get("name") or ""),
                "avg_price": float(p.get("avgPrice") or 0),
                "bought_usd": float(p.get("totalBought") or 0),
            })
        sig.smart_conviction = sig.yes_total_size_usd * sig.yes_avg_price

    no_filtered = [
        p for p in no_holders
        if float(p.get("totalBought") or 0) >= min_position_usd
        and float(p.get("avgPrice") or 0) >= min_avg_price
    ]
    if no_filtered:
        sig.no_holders_count = len(no_filtered)
        sig.no_total_size_usd = sum(float(p.get("totalBought") or 0) for p in no_filtered)
        weighted = sum(
            float(p.get("avgPrice") or 0) * float(p.get("totalBought") or 0)
            for p in no_filtered
        )
        sig.no_avg_price = weighted / sig.no_total_size_usd if sig.no_total_size_usd > 0 else 0.0
    return sig


def analyze_event(
    slug: str,
    *,
    min_position_usd: float = 2000.0,
    min_avg_price: float = 0.01,
    top_holders: int = 30,
    per_market_delay_seconds: float = 0.15,
) -> dict:
    """Run the smart-money analyzer on a single event slug.

    Returns a dict suitable for JSON serialization (CLI / API consumers)
    with the full ranked signal list, plus ``top_3`` summary picks.
    Raises :class:`EventNotFoundError` if the slug doesn't resolve to a
    Polymarket event.
    """
    event = fetch_event(slug)
    markets = event.get("markets", [])
    signals: list[OutcomeSignal] = []
    for m in markets:
        outcome = m.get("groupItemTitle") or m.get("question", "")
        cid = m.get("conditionId")
        if not cid:
            continue
        try:
            yes, no, closed = fetch_market_state(cid)
            yes_h, no_h = fetch_holders(cid, top_holders)
        except Exception:
            continue
        sig = score_outcome(outcome, cid, yes, no, closed, yes_h, no_h,
                            min_position_usd, min_avg_price)
        signals.append(sig)
        if per_market_delay_seconds > 0:
            time.sleep(per_market_delay_seconds)

    signals.sort(key=lambda s: -s.smart_conviction)
    ranked = [s.to_dict() for s in signals if s.smart_conviction > 0]
    top_3 = ranked[:3]
    return {
        "slug": slug,
        "title": event.get("title", slug),
        "end_date": event.get("endDate"),
        "n_outcomes": len(markets),
        "ranked_outcomes": ranked,
        "top_3": top_3,
        "filters": {
            "min_position_usd": min_position_usd,
            "min_avg_price": min_avg_price,
            "top_holders_per_outcome": top_holders,
        },
    }
