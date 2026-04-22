"""Regime-gated scorer.

Phase 2 of the adaptive-regime branch. The legacy GBM fade scorer wins in
choppy, mean-reverting regimes (Asia overnight) and loses in trending
regimes (EU/US during news flow). This wrapper classifies the tick's
regime from existing HTF features and:

- RANGING         → delegate to the underlying fade scorer unchanged
                    (this is the regime where buying the cheap side pays off)
- TRENDING_UP     → ABSTAIN (fade into a real trend loses on taker entries;
                    the follow-with-maker path lands in phase 3)
- TRENDING_DOWN   → ABSTAIN (mirror)
- HIGH_VOL        → ABSTAIN (even a real trend gets chopped up here)
- UNKNOWN         → ABSTAIN (HTF buffer hasn't warmed up; no honest signal yet)

The wrapper is deliberately thin — it does not re-implement edge math or
confidence, just short-circuits the side decision when the regime says
"this scorer has no edge here". When Phase 3 adds a maker-order path, the
TRENDING branches will switch from ABSTAIN to "propose a follow at
mid − N bps" instead of being routed back through the fade logic.
"""
from __future__ import annotations

from dataclasses import replace

from polymarket_ai_agent.engine.quant_scoring import QuantScoringEngine
from polymarket_ai_agent.engine.regime import Regime, RegimeThresholds, classify_regime
from polymarket_ai_agent.types import EvidencePacket, MarketAssessment, SuggestedSide


_TRADEABLE_REGIMES: frozenset[Regime] = frozenset({Regime.RANGING})


class AdaptiveScorer:
    """Regime-gated wrapper around :class:`QuantScoringEngine`.

    Holds no state beyond the regime thresholds — every call is derived
    from the ``EvidencePacket`` so the scorer is safe to call on every
    tick and reuses the underlying fade scorer's settings (edge gates,
    slippage model, confidence) verbatim.
    """

    def __init__(
        self,
        fade: QuantScoringEngine,
        thresholds: RegimeThresholds | None = None,
    ):
        self.fade = fade
        self.thresholds = thresholds or RegimeThresholds()

    def score_market(self, packet: EvidencePacket) -> MarketAssessment:
        """Return an assessment for ``packet``, ABSTAIN outside RANGING.

        Preserves the underlying fair_probability and per-side edges so
        downstream telemetry (Brier, edge distribution) stays comparable
        across scorers. Only ``suggested_side``, ``edge``, ``confidence``,
        and ``reasons_*`` get rewritten when the regime gate fires.
        """
        base = self.fade.score_market(packet)
        regime = classify_regime(packet, thresholds=self.thresholds)
        if regime in _TRADEABLE_REGIMES:
            return base

        gate_reason = f"Regime {regime.value}: adaptive scorer holds fire outside RANGING."
        return replace(
            base,
            suggested_side=SuggestedSide.ABSTAIN,
            edge=0.0,
            confidence=0.0,
            reasons_for_trade=[],
            reasons_to_abstain=[gate_reason, *base.reasons_to_abstain],
            raw_model_output="adaptive-regime-gated",
        )
