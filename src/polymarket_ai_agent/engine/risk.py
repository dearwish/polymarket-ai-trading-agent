from __future__ import annotations

from polymarket_ai_agent.config import Settings
from polymarket_ai_agent.types import (
    AccountState,
    DecisionStatus,
    ExecutionStyle,
    MarketAssessment,
    MarketSnapshot,
    OrderSide,
    PositionRecord,
    RiskState,
    SuggestedSide,
    TradeDecision,
    utc_now,
)


class RiskEngine:
    def __init__(self, settings: Settings):
        self.settings = settings

    def decide_trade(
        self,
        snapshot: MarketSnapshot,
        assessment: MarketAssessment,
        account_state: AccountState,
    ) -> TradeDecision:
        risk = self.evaluate(snapshot, assessment, account_state)
        if not risk.approved:
            return TradeDecision(
                market_id=snapshot.candidate.market_id,
                status=DecisionStatus.REJECTED,
                side=SuggestedSide.ABSTAIN,
                size_usd=0.0,
                limit_price=snapshot.orderbook.midpoint,
                rationale=assessment.reasons_for_trade,
                rejected_by=risk.rejected_by,
            )
        side = assessment.suggested_side
        if side == SuggestedSide.ABSTAIN:
            return TradeDecision(
                market_id=snapshot.candidate.market_id,
                status=DecisionStatus.ABSTAIN,
                side=side,
                size_usd=0.0,
                limit_price=snapshot.orderbook.midpoint,
                rationale=assessment.reasons_to_abstain or ["Model abstained."],
                rejected_by=[],
            )
        limit_price = snapshot.orderbook.ask if side == SuggestedSide.YES else max(1 - snapshot.orderbook.bid, 0.01)
        return TradeDecision(
            market_id=snapshot.candidate.market_id,
            status=DecisionStatus.APPROVED,
            side=side,
            size_usd=self.settings.max_position_usd,
            limit_price=limit_price,
            rationale=assessment.reasons_for_trade,
            rejected_by=[],
            asset_id=snapshot.candidate.yes_token_id if side == SuggestedSide.YES else snapshot.candidate.no_token_id,
            order_side=OrderSide.BUY,
            intent="OPEN",
            execution_style=ExecutionStyle.FOK_TAKER,
        )

    def build_close_decision(
        self,
        position: PositionRecord,
        snapshot: MarketSnapshot,
    ) -> TradeDecision:
        """Construct a SELL-side TradeDecision that closes an open position.

        The close price targets the best opposite-of-entry level so FOK
        crossing gets a fast exit; size mirrors the opened position's notional.
        """
        orderbook = snapshot.orderbook
        if position.side == SuggestedSide.YES:
            limit_price = max(orderbook.bid, 0.01) if orderbook.bid > 0 else max(orderbook.midpoint, 0.01)
            asset_id = snapshot.candidate.yes_token_id
        else:
            limit_price = max(orderbook.ask, 0.01) if orderbook.ask > 0 else max(orderbook.midpoint, 0.01)
            asset_id = snapshot.candidate.no_token_id
        return TradeDecision(
            market_id=snapshot.candidate.market_id,
            status=DecisionStatus.APPROVED,
            side=position.side,
            size_usd=position.size_usd,
            limit_price=limit_price,
            rationale=[f"Close position opened at {position.entry_price:.4f}"],
            rejected_by=[],
            asset_id=asset_id,
            order_side=OrderSide.SELL,
            intent="CLOSE",
            execution_style=ExecutionStyle.FOK_TAKER,
        )

    def evaluate(
        self,
        snapshot: MarketSnapshot,
        assessment: MarketAssessment,
        account_state: AccountState,
    ) -> RiskState:
        rejected_by: list[str] = []
        now = utc_now()
        if account_state.daily_realized_pnl <= -self.settings.max_daily_loss_usd:
            rejected_by.append("daily_loss_limit")
        if account_state.rejected_orders >= self.settings.max_rejected_orders:
            rejected_by.append("rejected_order_limit")
        snapshot_age = max(
            (now - snapshot.collected_at).total_seconds(),
            (now - snapshot.orderbook.observed_at).total_seconds(),
        )
        if snapshot_age > self.settings.stale_data_seconds:
            rejected_by.append("stale_data")
        if snapshot.orderbook.spread > self.settings.max_spread:
            rejected_by.append("spread_limit")
        if snapshot.orderbook.depth_usd < self.settings.min_depth_usd:
            rejected_by.append("depth_limit")
        if snapshot.seconds_to_expiry <= self.settings.exit_buffer_seconds:
            rejected_by.append("expiry_buffer")
        if assessment.confidence < self.settings.min_confidence:
            rejected_by.append("confidence_limit")
        if abs(assessment.edge) < self.settings.min_edge:
            rejected_by.append("edge_limit")
        if account_state.available_usd < self.settings.max_position_usd:
            rejected_by.append("insufficient_usd")
        if account_state.open_positions >= 1:
            rejected_by.append("single_position_rule")
        approved = not rejected_by
        reasons = [] if approved else ["Risk checks failed."]
        return RiskState(approved=approved, reasons=reasons, rejected_by=rejected_by)
