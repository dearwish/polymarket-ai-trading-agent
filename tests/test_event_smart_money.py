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

def _holder(*, wallet="0xabc", name="", size=1.0, current_value=1.0,
            avg_price=0.05, total_bought=100.0, realized=0.0, oi=0):
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


def test_conviction_is_invested_times_avg_paid() -> None:
    holders = [_holder(total_bought=10_000, avg_price=0.10)]
    sig = esm.score_outcome(
        "Bulgaria", "cid", yes_price=0.30, no_price=0.70, closed=False,
        yes_holders=holders, no_holders=[],
        min_position_usd=1000, min_avg_price=0.01,
    )
    # 10,000 × 0.10 = 1,000
    assert sig.smart_conviction == pytest.approx(1000.0)
    assert sig.yes_holders_count == 1


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
    holders = [
        _holder(wallet="0xa", total_bought=10_000, avg_price=0.10),
        _holder(wallet="0xb", total_bought=30_000, avg_price=0.20),
    ]
    sig = esm.score_outcome(
        "X", "cid", 0.5, 0.5, False, holders, [],
        min_position_usd=1000, min_avg_price=0.01,
    )
    # (10k × 0.10 + 30k × 0.20) / 40k = 0.175
    assert sig.yes_avg_price == pytest.approx(0.175)
    assert sig.smart_conviction == pytest.approx(40_000 * 0.175)


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
    market_state = {
        "cid-bul": (0.99, 0.01, True),
        "cid-fin": (0.005, 0.995, True),
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
         patch.object(esm, "fetch_market_state",
                      side_effect=lambda cid: market_state[cid]), \
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


def test_analyze_event_raises_on_missing_slug() -> None:
    def fake_http_get(url, params=None, timeout=15):
        return []  # gamma /events returns empty for unknown slug

    with patch.object(esm, "_http_get", side_effect=fake_http_get):
        with pytest.raises(esm.EventNotFoundError):
            esm.analyze_event("no-such-event", per_market_delay_seconds=0)
