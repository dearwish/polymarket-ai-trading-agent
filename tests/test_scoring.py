from __future__ import annotations

import json

from polymarket_ai_agent.engine.research import ResearchEngine
from polymarket_ai_agent.engine.scoring import ScoringEngine
from polymarket_ai_agent.types import SuggestedSide


class DummyResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class DummyClient:
    def __init__(self, content: str | None = None):
        self.content = content

    def post(self, *args, **kwargs):
        payload = {
            "choices": [
                {
                    "message": {
                        "content": self.content
                        or json.dumps(
                            {
                                "fair_probability": 0.61,
                                "confidence": 0.84,
                                "reasons_for_trade": ["Momentum and external price align."],
                                "reasons_to_abstain": [],
                                "expiry_risk": "LOW",
                                "suggested_side": "YES",
                            }
                        )
                    }
                }
            ]
        }
        return DummyResponse(payload)


def test_scoring_engine_heuristic_fallback(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    engine = ScoringEngine(settings)
    assessment = engine.score_market(packet)
    assert assessment.market_id == packet.market_id
    assert assessment.raw_model_output == "heuristic-fallback"
    assert assessment.suggested_side in {SuggestedSide.YES, SuggestedSide.NO, SuggestedSide.ABSTAIN}


def test_scoring_engine_openrouter_path(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(configured, client=DummyClient())
    assessment = engine.score_market(packet)
    assert assessment.fair_probability == 0.61
    assert assessment.confidence == 0.84
    assert assessment.suggested_side == SuggestedSide.YES


def test_scoring_engine_invalid_json_abstains(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(configured, client=DummyClient(content="{not-json"))
    assessment = engine.score_market(packet)
    assert assessment.suggested_side == SuggestedSide.ABSTAIN
    assert assessment.confidence == 0.0
    assert assessment.edge == 0.0
    assert "schema validation" in assessment.reasons_to_abstain[0].lower()


def test_scoring_engine_missing_fields_abstains(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(
        configured,
        client=DummyClient(content=json.dumps({"fair_probability": 0.6, "confidence": 0.7})),
    )
    assessment = engine.score_market(packet)
    assert assessment.suggested_side == SuggestedSide.ABSTAIN
    assert assessment.fair_probability == packet.market_probability


def test_scoring_engine_bad_enum_abstains(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(
        configured,
        client=DummyClient(
            content=json.dumps(
                {
                    "fair_probability": 0.61,
                    "confidence": 0.84,
                    "reasons_for_trade": ["Momentum and external price align."],
                    "reasons_to_abstain": [],
                    "expiry_risk": "LOW",
                    "suggested_side": "MAYBE",
                }
            )
        ),
    )
    assessment = engine.score_market(packet)
    assert assessment.suggested_side == SuggestedSide.ABSTAIN


def test_scoring_engine_normalizes_string_confidence_and_side(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(
        configured,
        client=DummyClient(
            content=json.dumps(
                {
                    "fair_probability": 0.49,
                    "confidence": "Low to moderate",
                    "reasons_for_trade": ["Potential downside edge."],
                    "reasons_to_abstain": ["Wide spread."],
                    "expiry_risk": "HIGH",
                    "suggested_side": "No - market looks overpriced",
                }
            )
        ),
    )
    assessment = engine.score_market(packet)
    assert assessment.confidence == 0.45
    assert assessment.suggested_side == SuggestedSide.NO
    assert assessment.fair_probability == 0.49


def test_scoring_engine_out_of_range_probability_abstains(settings, market_snapshot) -> None:
    packet = ResearchEngine().build_evidence_packet(market_snapshot)
    configured = settings.model_copy(update={"openrouter_api_key": "test-key"})
    engine = ScoringEngine(
        configured,
        client=DummyClient(
            content=json.dumps(
                {
                    "fair_probability": 1.5,
                    "confidence": 0.84,
                    "reasons_for_trade": ["Momentum and external price align."],
                    "reasons_to_abstain": [],
                    "expiry_risk": "LOW",
                    "suggested_side": "YES",
                }
            )
        ),
    )
    assessment = engine.score_market(packet)
    assert assessment.suggested_side == SuggestedSide.ABSTAIN
