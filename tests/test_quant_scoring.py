from __future__ import annotations

import math
from pathlib import Path

from polymarket_ai_agent.config import Settings
from polymarket_ai_agent.engine.quant_scoring import QuantScoringEngine, _normal_cdf
from polymarket_ai_agent.engine.research import ResearchEngine
from polymarket_ai_agent.types import EvidencePacket, SuggestedSide


def _settings(tmp_path: Path, **overrides) -> Settings:
    base = dict(
        openrouter_api_key="",
        polymarket_private_key="",
        polymarket_funder="",
        polymarket_signature_type=0,
        data_dir=tmp_path / "data",
        log_dir=tmp_path / "logs",
        db_path=tmp_path / "data" / "agent.db",
        events_path=tmp_path / "logs" / "events.jsonl",
        runtime_settings_path=tmp_path / "data" / "runtime_settings.json",
        # Explicitly pin experiment flags so tests don't pick them up from
        # the real .env (e.g. when QUANT_INVERT_DRIFT=true is enabled live).
        quant_invert_drift=False,
    )
    base.update(overrides)
    return Settings(**base)


def _packet(**overrides) -> EvidencePacket:
    defaults = dict(
        market_id="m1",
        question="Bitcoin up or down",
        resolution_criteria="-",
        market_probability=0.5,
        orderbook_midpoint=0.5,
        spread=0.02,
        depth_usd=500.0,
        seconds_to_expiry=900,
        external_price=70000.0,
        recent_price_change_bps=0.0,
        recent_trade_count=0,
        reasons_context=[],
        citations=[],
        bid_yes=0.49,
        ask_yes=0.51,
        bid_no=0.49,
        ask_no=0.51,
        microprice_yes=0.5,
        imbalance_top5_yes=0.0,
        signed_flow_5s=0.0,
        btc_log_return_5m=0.0,
        btc_log_return_15m=0.0,
        realized_vol_30m=0.02,
    )
    defaults.update(overrides)
    return EvidencePacket(**defaults)


def test_normal_cdf_matches_textbook_values() -> None:
    assert abs(_normal_cdf(0.0) - 0.5) < 1e-9
    assert abs(_normal_cdf(1.0) - 0.8413447460685429) < 1e-6
    assert abs(_normal_cdf(-1.0) - 0.1586552539314571) < 1e-6


def test_fair_value_is_neutral_without_drift_or_imbalance(tmp_path: Path) -> None:
    engine = QuantScoringEngine(_settings(tmp_path))
    assessment = engine.score_market(_packet())
    assert abs(assessment.fair_probability - 0.5) < 1e-6
    # Ask is 0.51 on both sides: edges are -(0.01 + cost), both negative → abstain.
    assert assessment.suggested_side == SuggestedSide.ABSTAIN


def test_positive_drift_biases_fair_above_half(tmp_path: Path) -> None:
    engine = QuantScoringEngine(_settings(tmp_path))
    packet = _packet(btc_log_return_15m=0.01, realized_vol_30m=0.02, seconds_to_expiry=1800)
    assessment = engine.score_market(packet)
    assert assessment.fair_probability > 0.5


def test_quant_invert_drift_flips_fair_around_half(tmp_path: Path) -> None:
    """When quant_invert_drift=True the scorer should return the mirror of
    its un-inverted fair_yes (around 0.5). Validates the mean-reversion
    test-flag does what it says."""
    # Same positive-drift packet evaluated with and without inversion.
    packet = _packet(btc_log_return_since_candle_open=0.01, realized_vol_30m=0.02, seconds_to_expiry=600)
    straight = QuantScoringEngine(_settings(tmp_path)).score_market(packet)
    inverted = QuantScoringEngine(_settings(tmp_path, quant_invert_drift=True)).score_market(packet)
    assert straight.fair_probability > 0.5
    assert inverted.fair_probability < 0.5
    # Mirror around 0.5 (within float noise and the 0.01/0.99 clamp).
    assert abs((straight.fair_probability + inverted.fair_probability) - 1.0) < 1e-6


def test_candle_open_log_return_takes_precedence_over_rolling_windows(tmp_path: Path) -> None:
    """For "up or down" candle markets the scorer must use Δ_since_candle_open,
    not a rolling 5m/15m window. When the candle-open field is populated it
    should dominate the drift signal regardless of what the rolling fields say.
    """
    engine = QuantScoringEngine(_settings(tmp_path))
    # Rolling returns say bearish (-0.01) but we've observed +0.01 since the
    # market's own candle opened. The scorer must follow the candle-open signal
    # and bias fair_yes ABOVE 0.5.
    packet = _packet(
        btc_log_return_5m=-0.01,
        btc_log_return_15m=-0.01,
        btc_log_return_since_candle_open=0.01,
        realized_vol_30m=0.02,
        seconds_to_expiry=600,
    )
    assessment = engine.score_market(packet)
    assert assessment.fair_probability > 0.5, (
        f"fair_yes={assessment.fair_probability} — candle-open drift was positive, "
        "but scorer still biased fair below 0.5 (likely using rolling windows)."
    )

    # Mirror case: rolling says bullish, but we've fallen -0.01 since candle open
    # → fair_yes must be below 0.5.
    packet = _packet(
        btc_log_return_5m=0.01,
        btc_log_return_15m=0.01,
        btc_log_return_since_candle_open=-0.01,
        realized_vol_30m=0.02,
        seconds_to_expiry=600,
    )
    assessment = engine.score_market(packet)
    assert assessment.fair_probability < 0.5


def test_negative_drift_biases_fair_below_half(tmp_path: Path) -> None:
    engine = QuantScoringEngine(_settings(tmp_path))
    packet = _packet(btc_log_return_15m=-0.01, realized_vol_30m=0.02, seconds_to_expiry=1800)
    assessment = engine.score_market(packet)
    assert assessment.fair_probability < 0.5


def test_imbalance_tilts_fair_value(tmp_path: Path) -> None:
    engine = QuantScoringEngine(_settings(tmp_path, quant_imbalance_tilt=0.05))
    baseline = engine.score_market(_packet()).fair_probability
    bullish = engine.score_market(_packet(imbalance_top5_yes=0.8)).fair_probability
    assert bullish > baseline


def test_edge_subtracts_ask_and_costs(tmp_path: Path) -> None:
    settings = _settings(tmp_path, quant_slippage_baseline_bps=0.0, quant_slippage_spread_coef=0.0, fee_bps=0.0)
    engine = QuantScoringEngine(settings)
    packet = _packet(ask_yes=0.40, ask_no=0.55, bid_yes=0.38, bid_no=0.53)
    assessment = engine.score_market(packet)
    # fair_yes ~ 0.5 (no drift, no imbalance) → edge_yes = 0.5 - 0.40 = 0.10; edge_no = 0.5 - 0.55 = -0.05.
    assert abs(assessment.edge_yes - 0.10) < 1e-6
    assert abs(assessment.edge_no + 0.05) < 1e-6
    assert assessment.suggested_side == SuggestedSide.YES
    assert assessment.edge == assessment.edge_yes


def test_pick_side_chooses_no_when_no_side_has_higher_edge(tmp_path: Path) -> None:
    settings = _settings(tmp_path, quant_slippage_baseline_bps=0.0, quant_slippage_spread_coef=0.0, fee_bps=0.0)
    engine = QuantScoringEngine(settings)
    packet = _packet(ask_yes=0.55, ask_no=0.40)
    assessment = engine.score_market(packet)
    assert assessment.suggested_side == SuggestedSide.NO
    assert assessment.edge == assessment.edge_no


def test_confidence_scales_with_edge_and_is_capped(tmp_path: Path) -> None:
    engine = QuantScoringEngine(_settings(tmp_path))
    packet = _packet(ask_yes=0.05, ask_no=0.99)
    assessment = engine.score_market(packet)
    assert assessment.confidence > 0.5
    assert assessment.confidence <= 0.99


def test_expiry_risk_tiers(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    engine = QuantScoringEngine(settings)
    assert engine.score_market(_packet(seconds_to_expiry=10)).expiry_risk == "HIGH"
    assert engine.score_market(_packet(seconds_to_expiry=45)).expiry_risk == "MEDIUM"
    assert engine.score_market(_packet(seconds_to_expiry=600)).expiry_risk == "LOW"


def test_research_from_snapshot_populates_asks(market_snapshot, tmp_path: Path) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    assert packet.ask_yes > packet.bid_yes
    assert packet.ask_no > packet.bid_no
    # The REST path leaves BTC features at zero; scorer should fall back to default vol.
    engine = QuantScoringEngine(_settings(tmp_path))
    assessment = engine.score_market(packet)
    assert math.isfinite(assessment.fair_probability)
    assert math.isfinite(assessment.edge_yes)
    assert math.isfinite(assessment.edge_no)


def test_research_from_features_populates_btc_fields(tmp_path: Path, market_candidate) -> None:
    from polymarket_ai_agent.engine.btc_state import BtcSnapshot
    from polymarket_ai_agent.engine.market_state import MarketFeatures

    features = MarketFeatures(
        market_id="m1",
        yes_token_id="yes",
        no_token_id="no",
        bid_yes=0.49,
        ask_yes=0.51,
        bid_no=0.49,
        ask_no=0.51,
        mid_yes=0.5,
        mid_no=0.5,
        microprice_yes=0.505,
        spread_yes=0.02,
        depth_usd_yes=600.0,
        imbalance_top5_yes=0.1,
        last_trade_price_yes=0.50,
        signed_flow_5s=3.0,
        trade_count_5s=4,
        last_update_age_seconds=0.5,
        two_sided=True,
    )
    btc_snapshot = BtcSnapshot(
        price=70000.0,
        observed_at=market_candidate.end_date_iso and __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        log_return_10s=0.0,
        log_return_1m=0.001,
        log_return_5m=0.003,
        log_return_15m=0.005,
        realized_vol_30m=0.02,
        sample_count=120,
    )
    packet = ResearchEngine().build_from_features(
        candidate=market_candidate,
        features=features,
        btc_snapshot=btc_snapshot,
        seconds_to_expiry=1800,
    )
    assert packet.ask_yes == 0.51
    assert packet.imbalance_top5_yes == 0.1
    assert packet.btc_log_return_15m == 0.005
    assert packet.realized_vol_30m == 0.02
    engine = QuantScoringEngine(_settings(tmp_path))
    assessment = engine.score_market(packet)
    assert assessment.fair_probability > 0.5  # positive drift + positive imbalance → YES bias
