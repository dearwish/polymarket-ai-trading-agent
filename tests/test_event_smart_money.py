"""Unit tests for the event smart-money analyzer.

Mocks out the three external HTTP endpoints (gamma /events, gamma
/markets, data-api /v1/market-positions) so the tests run offline and
deterministically. Exercises:

- conviction formula (invested $ × avg paid price)
- lottery-dust filter (min_avg_price)
- position-size dust filter (min_position_usd)
- ranking is sorted by conviction descending
- closed=true fallback on the gamma /markets call when the default
  query returns []
- EventNotFoundError when the gamma /events call returns []
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from polymarket_trading_engine.engine import event_smart_money as esm


# ---------------------------------------------------------------------------
# score_outcome — pure-function tests
# ---------------------------------------------------------------------------

def _holder(*, wallet="0xabc", name="", size=None, current_value=None,
            avg_price=0.05, total_bought=100.0, current_cost=None,
            realized=0.0, oi=0):
    """Build a synthetic market-positions holder dict.

    ``current_cost`` lets a test express the wallet's CURRENT at-risk
    capital directly; it's auto-derived as size × avg_price if omitted.
    Defaults: holder is fully HODL'ing (size × avg_price == total_bought
    means no exits, exit_rate = 0).
    """
    if current_cost is None and size is None:
        # Default: assume HODL — current cost equals lifetime buying.
        size = total_bought / avg_price if avg_price > 0 else 0.0
        current_cost = total_bought
    elif current_cost is None and size is not None:
        current_cost = size * avg_price
    elif size is None:
        size = current_cost / avg_price if avg_price > 0 else 0.0
    if current_value is None:
        # By default, mark-to-market at avg_price → no price movement,
        # exit_rate = 0 when size×avg == totalBought.
        current_value = current_cost
    return {
        "proxyWallet": wallet,
        "name": name,
        "asset": "asset-x",
        "conditionId": "0xcid",
        "avgPrice": avg_price,
        "size": size,
        "currPrice": 0.5,
        "currentValue": current_value,
        "totalBought": total_bought,
        "realizedPnl": realized,
        "totalPnl": realized + (current_value - total_bought),
        "outcomeIndex": oi,
    }


def test_conviction_is_current_at_risk_times_avg_paid() -> None:
    """Conviction = (size × avgPrice) × avgPrice — current at-risk capital
    weighted by the avg paid by smart money. HODL case: size×avg ==
    totalBought, so conviction matches the old totalBought × avgPrice."""
    holders = [_holder(total_bought=10_000, avg_price=0.10)]
    sig = esm.score_outcome(
        "Bulgaria", "cid", yes_price=0.30, no_price=0.70, closed=False,
        yes_holders=holders, no_holders=[],
        min_position_usd=1000, min_avg_price=0.01,
    )
    # size = 10k/0.10 = 100,000 shares; current_cost = 10,000
    # conviction = 10,000 × 0.10 = 1,000
    assert sig.smart_conviction == pytest.approx(1000.0)
    assert sig.yes_total_size_usd == pytest.approx(10_000.0)
    assert sig.yes_holders_count == 1
    assert sig.yes_exit_rate == pytest.approx(0.0)  # HODL


def test_conviction_discounts_wallets_who_scaled_out() -> None:
    """The peepeepooppoop case: wallet bought $26.7K, currently holds
    8,284 shares at avg 27.1¢ = $2,244 still at risk, realized +$1,423
    on the sold portion. Conviction should reflect $2.2K not $26.7K."""
    h = _holder(
        total_bought=26_714,
        size=8_284,
        avg_price=0.271,
        current_value=8_284 * 0.225,  # current price 22.5¢
        realized=1_423,
    )
    sig = esm.score_outcome(
        "Spencer Pratt", "cid", 0.225, 0.775, False, [h], [],
        min_position_usd=1000, min_avg_price=0.01,
    )
    # Current at-risk: 8,284 × 0.271 = $2,244
    assert sig.yes_total_size_usd == pytest.approx(8_284 * 0.271, rel=0.01)
    # Conviction much smaller than the old totalBought-based score of
    # 26_714 × 0.271 = 7,242 — discounts by the exit ratio.
    assert sig.smart_conviction < 26_714 * 0.271 * 0.5  # <50% of old score
    # Exit rate: (totalBought - currentValue) / totalBought
    expected_exit = (26_714 - 8_284 * 0.225) / 26_714
    assert sig.yes_exit_rate == pytest.approx(expected_exit, rel=0.01)
    assert sig.yes_total_bought_usd == pytest.approx(26_714.0)


def test_lottery_filter_drops_subcent_buys() -> None:
    holders = [
        _holder(wallet="0xa", total_bought=5_000, avg_price=0.003),  # lotto, drop
        _holder(wallet="0xb", total_bought=5_000, avg_price=0.08),   # real, keep
    ]
    sig = esm.score_outcome(
        "X", "cid", 0.1, 0.9, False, holders, [],
        min_position_usd=1000, min_avg_price=0.01,
    )
    assert sig.yes_holders_count == 1
    # Default _holder is HODL → size × avg_price == total_bought.
    assert sig.yes_total_size_usd == pytest.approx(5000.0)
    assert sig.yes_avg_price == pytest.approx(0.08)


def test_min_position_filter_drops_dust_wallets() -> None:
    holders = [
        _holder(wallet="0xa", total_bought=500, avg_price=0.20),    # dust, drop
        _holder(wallet="0xb", total_bought=5_000, avg_price=0.20),  # keep
    ]
    sig = esm.score_outcome(
        "X", "cid", 0.5, 0.5, False, holders, [],
        min_position_usd=1000, min_avg_price=0.01,
    )
    assert sig.yes_holders_count == 1
    assert sig.yes_total_size_usd == pytest.approx(5000.0)


def test_volume_weighted_avg_price() -> None:
    """Avg paid is weighted by shares currently held — for HODL wallets
    where size × avgPrice equals totalBought, this gives the same answer
    as the old totalBought-weighted formula."""
    holders = [
        _holder(wallet="0xa", total_bought=10_000, avg_price=0.10),  # 100k shares
        _holder(wallet="0xb", total_bought=30_000, avg_price=0.20),  # 150k shares
    ]
    sig = esm.score_outcome(
        "X", "cid", 0.5, 0.5, False, holders, [],
        min_position_usd=1000, min_avg_price=0.01,
    )
    # Weighted by shares: (100k × 0.10 + 150k × 0.20) / 250k = 0.16
    assert sig.yes_avg_price == pytest.approx(0.16)
    # Conviction = current_cost × avg_paid = 40_000 × 0.16
    assert sig.smart_conviction == pytest.approx(40_000 * 0.16)


def test_no_holders_zero_conviction() -> None:
    sig = esm.score_outcome("X", "cid", 0.5, 0.5, False, [], [],
                            min_position_usd=1000, min_avg_price=0.01)
    assert sig.smart_conviction == 0.0
    assert sig.yes_holders_count == 0


# ---------------------------------------------------------------------------
# fetch_market_state — closed=true fallback
# ---------------------------------------------------------------------------

def test_fetch_market_state_falls_back_to_closed_when_open_returns_empty() -> None:
    calls: list[dict] = []

    def fake_http_get(url, params=None, timeout=15):
        calls.append(dict(params or {}))
        # First call (no closed filter) returns empty.
        # Second call (closed=true) returns a resolved market.
        if "closed" in (params or {}):
            return [{"closed": True, "outcomePrices": '["0.0005","0.9995"]'}]
        return []

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        yes, no, closed = esm.fetch_market_state("0xcid")

    assert yes == pytest.approx(0.0005)
    assert no == pytest.approx(0.9995)
    assert closed is True
    # Verifies both queries were issued in order.
    assert len(calls) == 2
    assert "closed" not in calls[0]
    assert calls[1].get("closed") == "true"


# ---------------------------------------------------------------------------
# analyze_event — end-to-end with mocked HTTP
# ---------------------------------------------------------------------------

def test_analyze_event_ranks_by_conviction() -> None:
    """Smoke test that pulls together all the pieces."""
    event_payload = {
        "title": "Test Cup",
        "slug": "test-cup",
        "endDate": "2026-12-31T00:00:00Z",
        "markets": [
            {"groupItemTitle": "Bulgaria", "conditionId": "cid-bul"},
            {"groupItemTitle": "Finland",  "conditionId": "cid-fin"},
        ],
    }
    # analyze_event now calls fetch_market_detail (richer dict, includes
    # token IDs). The legacy fetch_market_state stays for older callers
    # but is not on the analyze_event path anymore.
    market_detail = {
        "cid-bul": {"yes_price": 0.99, "no_price": 0.01, "closed": True,
                    "yes_token_id": "bul-yes", "no_token_id": "bul-no"},
        "cid-fin": {"yes_price": 0.005, "no_price": 0.995, "closed": True,
                    "yes_token_id": "fin-yes", "no_token_id": "fin-no"},
    }
    holders_map = {
        "cid-bul": (
            [_holder(wallet="0xrich", total_bought=200_000, avg_price=0.05)],
            [],
        ),
        "cid-fin": (
            [_holder(wallet="0xpoor", total_bought=50_000, avg_price=0.08)],
            [],
        ),
    }

    with patch.object(esm, "fetch_event", return_value=event_payload), \
         patch.object(esm, "fetch_market_detail",
                      side_effect=lambda cid: market_detail[cid]), \
         patch.object(esm, "fetch_holders",
                      side_effect=lambda cid, limit: holders_map[cid]):
        result = esm.analyze_event("test-cup", per_market_delay_seconds=0)

    assert result["slug"] == "test-cup"
    assert result["n_outcomes"] == 2
    # Bulgaria conviction = 200k × 0.05 = 10,000
    # Finland conviction  =  50k × 0.08 =  4,000
    assert result["top_3"][0]["outcome"] == "Bulgaria"
    assert result["top_3"][1]["outcome"] == "Finland"
    assert result["top_3"][0]["smart_conviction"] == pytest.approx(10_000)
    # Token IDs from fetch_market_detail must propagate to top_3 / ranked_outcomes
    # so the dashboard can fetch order books per outcome.
    assert result["top_3"][0]["yes_token_id"] == "bul-yes"
    assert result["top_3"][0]["no_token_id"] == "bul-no"


def test_analyze_event_raises_on_missing_slug() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return []  # gamma /events returns empty for unknown slug

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        with pytest.raises(esm.EventNotFoundError):
            esm.analyze_event("no-such-event", per_market_delay_seconds=0)


# ---------------------------------------------------------------------------
# fetch_market_detail — includes token IDs
# ---------------------------------------------------------------------------

def test_fetch_market_detail_returns_token_ids() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return [{
            "closed": False,
            "outcomePrices": '["0.4", "0.6"]',
            "clobTokenIds": '["111", "222"]',
        }]

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        d = esm.fetch_market_detail("0xcid")

    assert d["yes_price"] == pytest.approx(0.4)
    assert d["no_price"] == pytest.approx(0.6)
    assert d["closed"] is False
    assert d["yes_token_id"] == "111"
    assert d["no_token_id"] == "222"


def test_fetch_market_detail_handles_missing_token_ids() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return [{"closed": False, "outcomePrices": '["0.1","0.9"]'}]

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        d = esm.fetch_market_detail("0xcid")

    assert d["yes_token_id"] is None
    assert d["no_token_id"] is None


def test_fetch_market_state_wrapper_is_backwards_compatible() -> None:
    """Older scripts still tuple-unpack fetch_market_state — verify the
    shim stays a 3-tuple even after fetch_market_detail was introduced."""
    def fake_http_get(url, params=None, timeout=15):
        return [{"closed": True, "outcomePrices": '["0.0005","0.9995"]',
                 "clobTokenIds": '["a","b"]'}]

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        yes, no, closed = esm.fetch_market_state("0xcid")

    assert yes == pytest.approx(0.0005)
    assert no == pytest.approx(0.9995)
    assert closed is True


# ---------------------------------------------------------------------------
# fetch_orderbook — depth aggregation, cumulative $, error handling
# ---------------------------------------------------------------------------

def test_fetch_orderbook_normalises_and_computes_cumulative_usd() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return {
            "bids": [
                {"price": "0.40", "size": "100"},
                {"price": "0.38", "size": "200"},
                {"price": "0.42", "size": "50"},
            ],
            "asks": [
                {"price": "0.45", "size": "100"},
                {"price": "0.43", "size": "50"},
                {"price": "0.50", "size": "300"},
            ],
        }

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        book = esm.fetch_orderbook("token-x", depth=10)

    assert [b["price"] for b in book["bids"]] == [0.42, 0.40, 0.38]
    assert book["best_bid"] == pytest.approx(0.42)
    assert book["bids"][0]["cum_usd"] == pytest.approx(0.42 * 50)
    assert book["bids"][1]["cum_usd"] == pytest.approx(0.42 * 50 + 0.40 * 100)
    assert [a["price"] for a in book["asks"]] == [0.43, 0.45, 0.50]
    assert book["best_ask"] == pytest.approx(0.43)
    assert book["asks"][1]["cum_usd"] == pytest.approx(0.43 * 50 + 0.45 * 100)
    assert book["spread"] == pytest.approx(0.43 - 0.42)


def test_fetch_orderbook_passes_error_through() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return {"error": "Invalid token_id"}

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        book = esm.fetch_orderbook("not-a-token")

    assert "error" in book
    assert book["bids"] == []
    assert book["asks"] == []


# ---------------------------------------------------------------------------
# estimate_fill — slippage math
# ---------------------------------------------------------------------------

def test_estimate_fill_eats_single_level_when_target_fits() -> None:
    book = {
        "asks": [
            {"price": 0.40, "size": 1000, "cum_usd": 400},
            {"price": 0.41, "size": 1000, "cum_usd": 810},
        ],
    }
    e = esm.estimate_fill(book, target_usd=50, side="buy")
    assert e["fully_filled"] is True
    assert e["avg_price"] == pytest.approx(0.40)
    assert e["max_price"] == pytest.approx(0.40)
    assert e["filled_shares"] == pytest.approx(125)


def test_estimate_fill_walks_multiple_levels_for_bigger_buy() -> None:
    book = {
        "asks": [
            {"price": 0.40, "size": 100, "cum_usd": 40},
            {"price": 0.42, "size": 200, "cum_usd": 124},
            {"price": 0.45, "size": 1000, "cum_usd": 574},
        ],
    }
    e = esm.estimate_fill(book, target_usd=100, side="buy")
    assert e["fully_filled"] is True
    assert e["max_price"] == pytest.approx(0.42)
    expected_shares = 100 + 60 / 0.42
    assert e["filled_shares"] == pytest.approx(expected_shares)
    assert e["avg_price"] == pytest.approx(100 / expected_shares)


def test_estimate_fill_reports_partial_when_book_too_thin() -> None:
    book = {
        "asks": [
            {"price": 0.40, "size": 10, "cum_usd": 4},
            {"price": 0.42, "size": 5, "cum_usd": 6.1},
        ],
    }
    e = esm.estimate_fill(book, target_usd=100, side="buy")
    assert e["fully_filled"] is False
    assert e["filled_usd"] == pytest.approx(4 + 0.42 * 5)
    assert e["filled_shares"] == pytest.approx(15)
