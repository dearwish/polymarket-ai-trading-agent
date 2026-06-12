"""Polymarket fee model.

Since Fee Structure V2 (2026-03-30) Polymarket charges taker-only fees on
nearly all categories with a price-symmetric curve:

    fee = shares × feeRate × price × (1 − price)

Crypto is the highest-fee category (feeRate 0.07 → ~1.75¢/share at p=0.5,
i.e. ~3.5% of the premium spent at mid prices). Makers pay zero and earn a
share of taker fees back through the daily maker-rebate pool. The fee peaks
exactly at p=0.5 and decays to ~0 toward $0.01/$0.99.

Paper-mode accounting uses this module so simulated PnL can no longer run
fee-free (the pre-2026 assumption baked into the flat ``fee_bps`` setting).
The live engine must NOT hardcode the rate: per-market ``feeSchedule`` is
mandatory on the CLOB API since 2026-03-31 and is the source of truth for
real fills.

Deliberately pessimistic simplification: paper PnL charges the taker curve
on BOTH legs, including entries routed through the paper-maker lifecycle.
Real maker fills pay zero, so live results can only be better than paper on
the fee line — the safe direction for go/no-go decisions. Revisit when the
execution layer records per-leg maker/taker style on the position row.
"""
from __future__ import annotations


def taker_fee_usd(shares: float, price: float, fee_rate: float) -> float:
    """Taker fee in dollars for one leg: shares × rate × p × (1 − p)."""
    if shares <= 0.0 or fee_rate <= 0.0:
        return 0.0
    p = min(max(price, 0.0), 1.0)
    return shares * fee_rate * p * (1.0 - p)


def taker_fee_price_units(price: float, fee_rate: float) -> float:
    """Per-share taker fee expressed in price units (dollars per share).

    Used by scorers to fold the fee into the pre-trade edge: an edge of
    ``fair − ask`` must also clear ``rate × ask × (1 − ask)`` to be real.
    """
    if fee_rate <= 0.0:
        return 0.0
    p = min(max(price, 0.0), 1.0)
    return fee_rate * p * (1.0 - p)


def round_trip_fee_usd(
    size_usd: float,
    entry_price: float,
    exit_price: float,
    taker_fee_rate: float,
    flat_fee_bps: float = 0.0,
) -> float:
    """Entry + exit fee in dollars for a position of ``size_usd`` premium.

    When ``taker_fee_rate`` > 0 the Polymarket curve is applied to both
    legs at their respective prices. Otherwise falls back to the legacy
    flat ``flat_fee_bps`` round-trip (kept for back-compat with old soaks).
    """
    if size_usd <= 0.0:
        return 0.0
    if taker_fee_rate > 0.0:
        shares = size_usd / max(entry_price, 1e-6)
        return taker_fee_usd(shares, entry_price, taker_fee_rate) + taker_fee_usd(
            shares, exit_price, taker_fee_rate
        )
    if flat_fee_bps > 0.0:
        return float(size_usd) * (flat_fee_bps / 10_000.0) * 2.0
    return 0.0
