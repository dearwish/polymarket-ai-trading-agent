"""Tests for the Polymarket fee-curve model (engine/fees.py)."""
from __future__ import annotations

from polymarket_trading_engine.engine.fees import (
    round_trip_fee_usd,
    taker_fee_price_units,
    taker_fee_usd,
)


def test_taker_fee_peaks_at_half() -> None:
    # 0.07 × 0.5 × 0.5 = 0.0175 $/share — the documented ~1.75¢ crypto peak.
    assert abs(taker_fee_usd(1.0, 0.5, 0.07) - 0.0175) < 1e-9
    # Symmetric and decaying toward the tails.
    assert abs(taker_fee_usd(1.0, 0.1, 0.07) - taker_fee_usd(1.0, 0.9, 0.07)) < 1e-12
    assert taker_fee_usd(1.0, 0.99, 0.07) < taker_fee_usd(1.0, 0.5, 0.07)


def test_taker_fee_zero_cases() -> None:
    assert taker_fee_usd(0.0, 0.5, 0.07) == 0.0
    assert taker_fee_usd(10.0, 0.5, 0.0) == 0.0
    assert taker_fee_usd(10.0, 0.0, 0.07) == 0.0
    assert taker_fee_usd(10.0, 1.0, 0.07) == 0.0


def test_taker_fee_price_units_matches_per_share_fee() -> None:
    assert abs(taker_fee_price_units(0.4, 0.07) - 0.07 * 0.4 * 0.6) < 1e-12
    assert taker_fee_price_units(0.4, 0.0) == 0.0


def test_round_trip_uses_curve_on_both_legs() -> None:
    # $2 at 0.44 → 4.5454… shares; entry fee at 0.44, exit fee at 0.30.
    shares = 2.0 / 0.44
    expected = shares * 0.07 * 0.44 * 0.56 + shares * 0.07 * 0.30 * 0.70
    got = round_trip_fee_usd(2.0, 0.44, 0.30, taker_fee_rate=0.07)
    assert abs(got - expected) < 1e-9


def test_round_trip_falls_back_to_flat_bps() -> None:
    # rate=0 → legacy flat model: size × bps/1e4 × 2.
    assert abs(round_trip_fee_usd(100.0, 0.5, 0.5, taker_fee_rate=0.0, flat_fee_bps=50.0) - 1.0) < 1e-9
    # Neither configured → free (legacy default).
    assert round_trip_fee_usd(100.0, 0.5, 0.5, taker_fee_rate=0.0, flat_fee_bps=0.0) == 0.0


def test_curve_supersedes_flat_when_both_set() -> None:
    curve_only = round_trip_fee_usd(10.0, 0.5, 0.5, taker_fee_rate=0.07)
    both = round_trip_fee_usd(10.0, 0.5, 0.5, taker_fee_rate=0.07, flat_fee_bps=200.0)
    assert both == curve_only
