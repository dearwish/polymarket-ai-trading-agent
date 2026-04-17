from __future__ import annotations

import math
from dataclasses import dataclass

from polymarket_ai_agent.config import Settings
from polymarket_ai_agent.types import EvidencePacket, MarketAssessment, SuggestedSide


_SQRT_1800 = math.sqrt(1800.0)


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


@dataclass(slots=True)
class EdgeBreakdown:
    fair_yes: float
    ask_yes: float
    ask_no: float
    slippage_bps: float
    fee_bps: float
    edge_yes: float
    edge_no: float


class QuantScoringEngine:
    """Closed-form fair-value scorer for BTC up/down markets.

    Models BTC as a drift-less GBM over the time remaining (τ) and converts the
    normalized log-return since the implicit candle open into an YES-side
    probability. The momentum tilt from the order book top-5 imbalance is added
    as a small linear adjustment. Edges are computed per-side after an explicit
    cost model: baseline taker slippage plus a spread-proportional widening and
    a configurable fee. All outputs are bounded and deterministic, so the
    daemon can call this on every book update without I/O.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    def score_market(self, packet: EvidencePacket) -> MarketAssessment:
        fair_yes, fair_reasons = self._fair_value(packet)
        breakdown = self._edge_breakdown(packet, fair_yes)
        side, chosen_edge, side_reasons = self._pick_side(breakdown)
        confidence = self._confidence(breakdown, chosen_edge)
        reasons_for_trade, reasons_to_abstain = self._reasons(
            packet, breakdown, side, chosen_edge, fair_reasons, side_reasons
        )
        expiry_risk = self._expiry_risk(packet)
        return MarketAssessment(
            market_id=packet.market_id,
            fair_probability=round(fair_yes, 6),
            confidence=round(confidence, 4),
            suggested_side=side,
            expiry_risk=expiry_risk,
            reasons_for_trade=reasons_for_trade,
            reasons_to_abstain=reasons_to_abstain,
            edge=round(chosen_edge, 6),
            raw_model_output="quant-scoring",
            edge_yes=round(breakdown.edge_yes, 6),
            edge_no=round(breakdown.edge_no, 6),
            fair_probability_no=round(1.0 - fair_yes, 6),
            slippage_bps=round(breakdown.slippage_bps, 4),
        )

    # --- Fair value ----------------------------------------------------

    def _fair_value(self, packet: EvidencePacket) -> tuple[float, list[str]]:
        tte = max(float(packet.seconds_to_expiry), float(self.settings.quant_tte_floor_seconds))
        sigma_per_second = self._sigma_per_second(packet)
        expected_stdev = sigma_per_second * math.sqrt(tte)
        drift = self._drift_log_return(packet)
        z = drift / max(expected_stdev, 1e-9) if expected_stdev > 0 else 0.0
        damping = float(self.settings.quant_drift_damping)
        fair_from_drift = _normal_cdf(z * damping) if drift != 0.0 else 0.5
        imbalance = max(-1.0, min(1.0, float(packet.imbalance_top5_yes)))
        tilt = imbalance * float(self.settings.quant_imbalance_tilt)
        fair_yes = fair_from_drift + tilt
        fair_yes = max(0.01, min(0.99, fair_yes))
        reasons = [
            f"z={z:+.2f} drift={drift:+.5f} σ_per_s={sigma_per_second:.6f} expected_stdev={expected_stdev:.5f}",
            f"imbalance tilt={tilt:+.4f} base_fair={fair_from_drift:.4f} fair_yes={fair_yes:.4f}",
        ]
        return fair_yes, reasons

    def _sigma_per_second(self, packet: EvidencePacket) -> float:
        if packet.realized_vol_30m > 0:
            return packet.realized_vol_30m / _SQRT_1800
        return float(self.settings.quant_default_vol_per_second)

    def _drift_log_return(self, packet: EvidencePacket) -> float:
        horizon = float(self.settings.quant_drift_horizon_seconds)
        # Prefer the horizon that best matches the configured drift lookback.
        if horizon >= 600.0 and packet.btc_log_return_15m != 0.0:
            return float(packet.btc_log_return_15m)
        if packet.btc_log_return_5m != 0.0:
            return float(packet.btc_log_return_5m)
        return float(packet.btc_log_return_15m)

    # --- Edges ---------------------------------------------------------

    def _edge_breakdown(self, packet: EvidencePacket, fair_yes: float) -> EdgeBreakdown:
        ask_yes = self._effective_ask_yes(packet)
        ask_no = self._effective_ask_no(packet)
        slippage_bps = self._slippage_bps(packet)
        fee_bps = float(self.settings.fee_bps)
        cost = (slippage_bps + fee_bps) / 10_000.0
        edge_yes = fair_yes - ask_yes - cost
        edge_no = (1.0 - fair_yes) - ask_no - cost
        return EdgeBreakdown(
            fair_yes=fair_yes,
            ask_yes=ask_yes,
            ask_no=ask_no,
            slippage_bps=slippage_bps,
            fee_bps=fee_bps,
            edge_yes=edge_yes,
            edge_no=edge_no,
        )

    def _effective_ask_yes(self, packet: EvidencePacket) -> float:
        if packet.ask_yes > 0.0:
            return packet.ask_yes
        if packet.orderbook_midpoint > 0.0:
            return min(0.999, packet.orderbook_midpoint + max(packet.spread, 0.0) / 2.0)
        return 1.0

    def _effective_ask_no(self, packet: EvidencePacket) -> float:
        if packet.ask_no > 0.0:
            return packet.ask_no
        # Derive from YES side: ask_no ≈ 1 − bid_yes.
        if packet.bid_yes > 0.0:
            return max(0.001, min(0.999, 1.0 - packet.bid_yes))
        if packet.orderbook_midpoint > 0.0:
            return min(0.999, (1.0 - packet.orderbook_midpoint) + max(packet.spread, 0.0) / 2.0)
        return 1.0

    def _slippage_bps(self, packet: EvidencePacket) -> float:
        baseline = float(self.settings.quant_slippage_baseline_bps)
        spread_bps = max(packet.spread, 0.0) * 10_000.0
        return baseline + spread_bps * float(self.settings.quant_slippage_spread_coef)

    # --- Side + confidence --------------------------------------------

    def _pick_side(self, breakdown: EdgeBreakdown) -> tuple[SuggestedSide, float, list[str]]:
        if breakdown.edge_yes <= 0.0 and breakdown.edge_no <= 0.0:
            return (
                SuggestedSide.ABSTAIN,
                max(breakdown.edge_yes, breakdown.edge_no),
                [],
            )
        if breakdown.edge_yes >= breakdown.edge_no:
            return (
                SuggestedSide.YES,
                breakdown.edge_yes,
                [f"YES edge {breakdown.edge_yes:+.4f} beats NO edge {breakdown.edge_no:+.4f}"],
            )
        return (
            SuggestedSide.NO,
            breakdown.edge_no,
            [f"NO edge {breakdown.edge_no:+.4f} beats YES edge {breakdown.edge_yes:+.4f}"],
        )

    def _confidence(self, breakdown: EdgeBreakdown, chosen_edge: float) -> float:
        if chosen_edge <= 0.0:
            return 0.0
        per_edge = float(self.settings.quant_confidence_per_edge)
        conf = 0.5 + per_edge * chosen_edge
        if breakdown.slippage_bps > 100.0:
            conf *= 0.9
        return max(0.0, min(0.99, conf))

    def _expiry_risk(self, packet: EvidencePacket) -> str:
        if packet.seconds_to_expiry <= int(self.settings.quant_high_expiry_risk_seconds):
            return "HIGH"
        if packet.seconds_to_expiry <= int(self.settings.quant_medium_expiry_risk_seconds):
            return "MEDIUM"
        return "LOW"

    def _reasons(
        self,
        packet: EvidencePacket,
        breakdown: EdgeBreakdown,
        side: SuggestedSide,
        chosen_edge: float,
        fair_reasons: list[str],
        side_reasons: list[str],
    ) -> tuple[list[str], list[str]]:
        reasons_for_trade = list(fair_reasons) + list(side_reasons)
        reasons_to_abstain: list[str] = []
        if side == SuggestedSide.ABSTAIN:
            reasons_to_abstain.append(
                f"No positive edge after costs (yes={breakdown.edge_yes:+.4f}, no={breakdown.edge_no:+.4f})."
            )
        if packet.seconds_to_expiry <= int(self.settings.quant_high_expiry_risk_seconds):
            reasons_to_abstain.append("Market is within high-expiry-risk window.")
        if breakdown.slippage_bps > 150.0:
            reasons_to_abstain.append(
                f"Slippage estimate {breakdown.slippage_bps:.0f}bps is high relative to available edge."
            )
        reasons_for_trade.append(
            f"ask_yes={breakdown.ask_yes:.4f} ask_no={breakdown.ask_no:.4f} "
            f"slippage_bps={breakdown.slippage_bps:.1f} fee_bps={breakdown.fee_bps:.1f}"
        )
        return reasons_for_trade, reasons_to_abstain
