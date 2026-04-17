from polymarket_ai_agent.connectors.polymarket_ws import PolymarketMarketStream


def test_market_stream_parses_event_message() -> None:
    event = PolymarketMarketStream.parse_message(
        '{"event_type":"price_change","market":"cond-1","price_changes":[{"asset_id":"yes-token","price":"0.5"}]}'
    )
    assert event is not None
    assert event.event_type == "price_change"
    assert event.payload["market"] == "cond-1"


def test_market_stream_ignores_invalid_message() -> None:
    event = PolymarketMarketStream.parse_message("not-json")
    assert event is None
