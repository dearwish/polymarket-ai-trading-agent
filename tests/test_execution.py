from __future__ import annotations

from polymarket_ai_agent.engine.execution import ExecutionEngine
from polymarket_ai_agent.types import DecisionStatus, ExecutionMode, ExecutionResult, SuggestedSide, TradeDecision


def test_execution_engine_skips_non_approved_trade() -> None:
    engine = ExecutionEngine(ExecutionMode.PAPER)
    decision = TradeDecision(
        market_id="123",
        status=DecisionStatus.ABSTAIN,
        side=SuggestedSide.ABSTAIN,
        size_usd=0.0,
        limit_price=0.0,
        rationale=["skip"],
        rejected_by=[],
    )
    result = engine.execute_trade(decision)
    assert not result.success
    assert result.status == "SKIPPED"


def test_execution_engine_executes_paper_trade() -> None:
    from polymarket_ai_agent.types import OrderBookSnapshot

    engine = ExecutionEngine(ExecutionMode.PAPER, paper_entry_slippage_bps=10)
    decision = TradeDecision(
        market_id="123",
        status=DecisionStatus.APPROVED,
        side=SuggestedSide.YES,
        size_usd=10.0,
        limit_price=0.52,
        rationale=["trade"],
        rejected_by=[],
    )
    orderbook = OrderBookSnapshot(
        bid=0.51,
        ask=0.52,
        midpoint=0.515,
        spread=0.01,
        depth_usd=500.0,
        last_trade_price=0.515,
    )
    result = engine.execute_trade(decision, orderbook)
    assert result.success
    assert result.status == "FILLED_PAPER"
    assert result.fill_price > 0.52


def test_execution_engine_blocks_live_trade_when_disabled() -> None:
    engine = ExecutionEngine(ExecutionMode.LIVE)
    decision = TradeDecision(
        market_id="123",
        status=DecisionStatus.APPROVED,
        side=SuggestedSide.YES,
        size_usd=10.0,
        limit_price=0.52,
        rationale=["trade"],
        rejected_by=[],
    )
    result = engine.execute_trade(decision)
    assert not result.success
    assert result.status == "LIVE_DISABLED"


def test_execution_engine_requires_asset_id_for_live_trade() -> None:
    engine = ExecutionEngine(ExecutionMode.LIVE, live_trading_enabled=True)
    decision = TradeDecision(
        market_id="123",
        status=DecisionStatus.APPROVED,
        side=SuggestedSide.YES,
        size_usd=10.0,
        limit_price=0.52,
        rationale=["trade"],
        rejected_by=[],
    )
    result = engine.execute_trade(decision)
    assert not result.success
    assert result.status == "LIVE_INVALID"


def test_execution_engine_uses_live_executor_when_enabled() -> None:
    def live_executor(decision, orderbook):
        return ExecutionResult(
            market_id=decision.market_id,
            success=True,
            mode=ExecutionMode.LIVE,
            order_id="live-1",
            status="LIVE_SUBMITTED",
            detail="submitted",
        )

    engine = ExecutionEngine(ExecutionMode.LIVE, live_trading_enabled=True, live_executor=live_executor)
    decision = TradeDecision(
        market_id="123",
        status=DecisionStatus.APPROVED,
        side=SuggestedSide.YES,
        size_usd=10.0,
        limit_price=0.52,
        rationale=["trade"],
        rejected_by=[],
        asset_id="token-yes",
    )
    result = engine.execute_trade(decision)
    assert result.success
    assert result.status == "LIVE_SUBMITTED"
