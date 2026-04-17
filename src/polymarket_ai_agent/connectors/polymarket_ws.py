from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class MarketStreamEvent:
    event_type: str
    payload: dict[str, Any]


class PolymarketMarketStream:
    """Foundational public market-channel websocket client.

    This is intentionally not wired into the live trading path yet. It provides
    a minimal async interface for subscribing to token IDs and consuming market
    deltas, which is the main prerequisite for shorter-horizon families like
    btc_5m in a future event-driven loop.
    """

    def __init__(self, url: str):
        self.url = url

    async def subscribe(self, asset_ids: Iterable[str]) -> AsyncIterator[MarketStreamEvent]:
        asset_list = [asset_id for asset_id in asset_ids if asset_id]
        if not asset_list:
            return
        try:
            import websockets  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "websockets dependency is required for Polymarket market stream support."
            ) from exc

        async with websockets.connect(self.url) as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "assets_ids": asset_list,
                        "type": "market",
                        "custom_feature_enabled": True,
                    }
                )
            )
            async for raw_message in websocket:
                event = self.parse_message(raw_message)
                if event is not None:
                    yield event

    @staticmethod
    def parse_message(raw_message: str) -> MarketStreamEvent | None:
        try:
            payload = json.loads(raw_message)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None
        event_type = str(payload.get("event_type") or "")
        if not event_type:
            return None
        return MarketStreamEvent(event_type=event_type, payload=payload)
