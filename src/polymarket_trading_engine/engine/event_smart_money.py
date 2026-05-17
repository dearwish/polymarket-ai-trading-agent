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
CLOB_BOOK_URL = "https://clob.polymarket.com/book"


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
    # Current at-risk $ committed by filtered holders, valued at the
    # avg price they paid for shares STILL held (i.e. size × avgPrice).
    # Replaces the prior "sum of totalBought" semantics, which overstated
    # commitment by including cumulative buying from shares the wallet has
    # since sold. The conviction score and the "Invested $" column on the
    # dashboard now reflect current commitment, not lifetime accumulation.
    yes_total_size_usd: float = 0.0
    # Lifetime cumulative buying ($) across the same filtered holders.
    # Kept around to compute exit_rate (how much of the early conviction
    # has already been taken off the table) and to surface it on the UI.
    yes_total_bought_usd: float = 0.0
    yes_total_shares: float = 0.0
    yes_total_realized_pnl: float = 0.0
    yes_total_current_value: float = 0.0
    yes_total_pnl: float = 0.0
    yes_avg_price: float = 0.0
    # 0–1 fraction of cumulative buying that's no longer in the position.
    # (totalBought - currentValue) / totalBought. High = smart money has
    # already scaled out, conviction signal is partly stale.
    yes_exit_rate: float = 0.0
    yes_top_wallets: list[dict] = field(default_factory=list)
    no_holders_count: int = 0
    no_total_size_usd: float = 0.0
    no_avg_price: float = 0.0
    smart_conviction: float = 0.0
    # CLOB token IDs — needed to fetch the order book for either side
    # of this outcome. Populated by analyze_event from gamma /markets
    # `clobTokenIds` field. None when the gamma call doesn't return them
    # (rare; happens for unusual market types).
    yes_token_id: str | None = None
    no_token_id: str | None = None

    def to_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "condition_id": self.condition_id,
            "current_yes_price": self.current_yes_price,
            "current_no_price": self.current_no_price,
            "closed": self.closed,
            "yes_holders_count": self.yes_holders_count,
            "yes_total_size_usd": self.yes_total_size_usd,
            "yes_total_bought_usd": self.yes_total_bought_usd,
            "yes_total_pnl": self.yes_total_pnl,
            "yes_avg_price": self.yes_avg_price,
            "yes_exit_rate": self.yes_exit_rate,
            "yes_top_wallets": self.yes_top_wallets,
            "smart_conviction": self.smart_conviction,
            "yes_token_id": self.yes_token_id,
            "no_token_id": self.no_token_id,
        }


def fetch_event(slug: str) -> dict:
    data = _http_get(GAMMA_EVENTS_URL, {"slug": slug})
    if not data:
        raise EventNotFoundError(f"event not found: {slug}")
    return data[0]


def fetch_market_detail(condition_id: str) -> dict:
    """Return {yes_price, no_price, closed, yes_token_id, no_token_id}
    using the live per-market query.

    The default gamma /markets endpoint filters out closed markets, so
    when the first call returns an empty list we retry with
    ``closed=true``. When the gamma call fails or returns no data the
    function returns a dict with zeros / Nones so callers can still
    pattern-match without try/except."""
    payload: list | None = None
    for params in (
        {"condition_ids": condition_id},
        {"condition_ids": condition_id, "closed": "true"},
    ):
        try:
            d = _http_get(GAMMA_MARKET_URL, params)
        except Exception:
            return {"yes_price": 0.0, "no_price": 0.0, "closed": False,
                    "yes_token_id": None, "no_token_id": None}
        if isinstance(d, list) and d:
            payload = d
            break
    if not payload:
        return {"yes_price": 0.0, "no_price": 0.0, "closed": False,
                "yes_token_id": None, "no_token_id": None}
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
    token_ids = m.get("clobTokenIds")
    if isinstance(token_ids, str):
        try:
            token_ids = json.loads(token_ids)
        except Exception:
            token_ids = None
    yes_tid = str(token_ids[0]) if isinstance(token_ids, list) and len(token_ids) > 0 else None
    no_tid = str(token_ids[1]) if isinstance(token_ids, list) and len(token_ids) > 1 else None
    return {"yes_price": yes, "no_price": no, "closed": closed,
            "yes_token_id": yes_tid, "no_token_id": no_tid}


def fetch_market_state(condition_id: str) -> tuple[float, float, bool]:
    """Backwards-compatible wrapper over :func:`fetch_market_detail`.
    Older callers (scripts, the backtest runner) want just the price /
    closed tuple — keep this shape stable so the wider script ecosystem
    doesn't have to update in lockstep with engine internals."""
    detail = fetch_market_detail(condition_id)
    return detail["yes_price"], detail["no_price"], detail["closed"]


def fetch_orderbook(token_id: str, *, depth: int = 10) -> dict:
    """Return live CLOB order book for a single Polymarket outcome token.

    Polymarket's clob.polymarket.com/book endpoint is unauthenticated
    and returns top-of-book on both sides as ``{bids: [...], asks: [...]}``.
    Each level is a ``{price: str, size: str}`` pair. This function
    normalises the response to a depth-capped list of floats plus
    cumulative-dollar markers so the dashboard can answer "if I buy $50
    of YES, what avg price would I pay?" without re-computing on the
    client side."""
    try:
        d = _http_get(CLOB_BOOK_URL, {"token_id": token_id})
    except Exception as exc:
        return {"error": str(exc), "bids": [], "asks": [],
                "best_bid": None, "best_ask": None, "spread": None,
                "bid_depth_usd_top_n": 0.0, "ask_depth_usd_top_n": 0.0}
    if not isinstance(d, dict) or "error" in d:
        return {"error": str(d.get("error") if isinstance(d, dict) else "no data"),
                "bids": [], "asks": [],
                "best_bid": None, "best_ask": None, "spread": None,
                "bid_depth_usd_top_n": 0.0, "ask_depth_usd_top_n": 0.0}

    raw_bids = d.get("bids") or []
    raw_asks = d.get("asks") or []
    bids = sorted(
        ({"price": float(b["price"]), "size": float(b["size"])} for b in raw_bids if "price" in b),
        key=lambda level: -level["price"],
    )[:depth]
    asks = sorted(
        ({"price": float(a["price"]), "size": float(a["size"])} for a in raw_asks if "price" in a),
        key=lambda level: level["price"],
    )[:depth]
    # Cumulative $ to absorb at each level — answers "how much can I move
    # before slipping past this price?". Computed in dollar terms because
    # that's how the operator sizes positions.
    cum = 0.0
    for level in bids:
        cum += level["price"] * level["size"]
        level["cum_usd"] = cum
    cum = 0.0
    for level in asks:
        cum += level["price"] * level["size"]
        level["cum_usd"] = cum

    best_bid = bids[0]["price"] if bids else None
    best_ask = asks[0]["price"] if asks else None
    spread = (best_ask - best_bid) if (best_bid is not None and best_ask is not None) else None
    return {
        "token_id": token_id,
        "bids": bids,
        "asks": asks,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "midpoint": (best_bid + best_ask) / 2 if (best_bid is not None and best_ask is not None) else None,
        "spread": spread,
        "bid_depth_usd_top_n": bids[-1]["cum_usd"] if bids else 0.0,
        "ask_depth_usd_top_n": asks[-1]["cum_usd"] if asks else 0.0,
    }


def estimate_fill(book: dict, target_usd: float, side: str = "buy") -> dict:
    """Walk the relevant side of the book to estimate the avg fill price
    for spending ``target_usd``. ``side="buy"`` walks asks (we're buying
    YES from sellers); ``side="sell"`` walks bids.

    Returns ``{filled_usd, filled_shares, avg_price, max_price, fully_filled}``.
    ``fully_filled`` is False when the visible book doesn't absorb the
    full target — the operator probably should not size that big."""
    levels = book.get("asks") if side == "buy" else book.get("bids")
    levels = levels or []
    if target_usd <= 0 or not levels:
        return {"filled_usd": 0.0, "filled_shares": 0.0, "avg_price": 0.0,
                "max_price": 0.0, "fully_filled": False}
    remaining = float(target_usd)
    filled_usd = 0.0
    filled_shares = 0.0
    max_price = 0.0
    for level in levels:
        price = float(level["price"])
        size = float(level["size"])
        level_usd = price * size
        if remaining <= level_usd:
            shares = remaining / price
            filled_usd += remaining
            filled_shares += shares
            max_price = price
            remaining = 0.0
            break
        # take the whole level
        filled_usd += level_usd
        filled_shares += size
        max_price = price
        remaining -= level_usd
    avg_price = filled_usd / filled_shares if filled_shares > 0 else 0.0
    return {
        "filled_usd": filled_usd,
        "filled_shares": filled_shares,
        "avg_price": avg_price,
        "max_price": max_price,
        "fully_filled": remaining <= 1e-6,
    }


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
    # Filter on the LIFETIME-bought threshold (so we don't drop holders
    # who scaled out — they were real smart money at one point and
    # their absence from current holdings is itself information).
    yes_filtered = [
        p for p in yes_holders
        if float(p.get("totalBought") or 0) >= min_position_usd
        and float(p.get("avgPrice") or 0) >= min_avg_price
    ]
    if yes_filtered:
        sig.yes_holders_count = len(yes_filtered)
        for p in yes_filtered:
            size = float(p.get("size") or 0)
            avg = float(p.get("avgPrice") or 0)
            # Current at-risk capital per holder = shares still held × the
            # avg price they paid for THOSE shares. (avgPrice on the
            # market-positions endpoint is the avg of currently-held
            # shares, not lifetime — verified against peepeepooppoop case
            # where size×avg ≈ $2.2K while totalBought = $26.7K.)
            sig.yes_total_size_usd += size * avg
            sig.yes_total_bought_usd += float(p.get("totalBought") or 0)
            sig.yes_total_shares += size
            sig.yes_total_realized_pnl += float(p.get("realizedPnl") or 0)
            sig.yes_total_current_value += float(p.get("currentValue") or 0)
            sig.yes_total_pnl += float(p.get("totalPnl") or 0)
        # avg paid weighted by shares currently held — what the typical
        # remaining share cost. Volume-weighted by share count is equivalent
        # to dollar-weighted by current-cost since cost = shares × avgPrice.
        if sig.yes_total_shares > 0:
            sig.yes_avg_price = sum(
                float(p.get("avgPrice") or 0) * float(p.get("size") or 0)
                for p in yes_filtered
            ) / sig.yes_total_shares
        # Exit rate: fraction of cumulative buying that's no longer in
        # the position. High → smart money has already taken profit and
        # the live conviction signal is partly stale.
        if sig.yes_total_bought_usd > 0:
            sig.yes_exit_rate = max(
                0.0,
                (sig.yes_total_bought_usd - sig.yes_total_current_value) / sig.yes_total_bought_usd,
            )
        # Rank top wallets by CURRENT exposure ($-at-risk), not lifetime
        # buying — a wallet still holding $20K is a stronger signal than
        # a wallet that bought $50K and exited 95% of it.
        yes_filtered.sort(
            key=lambda p: -(float(p.get("size") or 0) * float(p.get("avgPrice") or 0))
        )
        for p in yes_filtered[:5]:
            size = float(p.get("size") or 0)
            avg = float(p.get("avgPrice") or 0)
            bought = float(p.get("totalBought") or 0)
            current_cost = size * avg
            sig.yes_top_wallets.append({
                "wallet": str(p.get("proxyWallet") or ""),
                "name": str(p.get("name") or ""),
                "avg_price": avg,
                "bought_usd": bought,          # cumulative — preserved for UI
                "current_cost_usd": current_cost,  # NEW: still at-risk
                "exit_rate": max(0.0, (bought - float(p.get("currentValue") or 0)) / bought) if bought > 0 else 0.0,
            })
        sig.smart_conviction = sig.yes_total_size_usd * sig.yes_avg_price

    no_filtered = [
        p for p in no_holders
        if float(p.get("totalBought") or 0) >= min_position_usd
        and float(p.get("avgPrice") or 0) >= min_avg_price
    ]
    if no_filtered:
        sig.no_holders_count = len(no_filtered)
        # Same current-at-risk semantics on the NO side.
        no_shares = sum(float(p.get("size") or 0) for p in no_filtered)
        sig.no_total_size_usd = sum(
            float(p.get("size") or 0) * float(p.get("avgPrice") or 0)
            for p in no_filtered
        )
        if no_shares > 0:
            sig.no_avg_price = sum(
                float(p.get("avgPrice") or 0) * float(p.get("size") or 0)
                for p in no_filtered
            ) / no_shares
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
            detail = fetch_market_detail(cid)
            yes_h, no_h = fetch_holders(cid, top_holders)
        except Exception:
            continue
        sig = score_outcome(outcome, cid, detail["yes_price"], detail["no_price"],
                            detail["closed"], yes_h, no_h,
                            min_position_usd, min_avg_price)
        sig.yes_token_id = detail.get("yes_token_id")
        sig.no_token_id = detail.get("no_token_id")
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
