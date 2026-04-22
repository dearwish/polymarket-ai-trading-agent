"""Focused tests for the per-strategy breakdown in scripts/analyze_soak.py.

The script is primarily a CLI tool so most of it is I/O; these tests cover
the pure helper that future phases rely on to compare strategies offline
without spinning up the daemon.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_analyze_soak():
    """Import the script as a module. It lives outside the package
    directory, so the canonical import path isn't available — this helper
    keeps the test self-contained and stable against future package moves.

    Registers in sys.modules before executing so dataclasses resolving
    annotations via cls.__module__ can find it.
    """
    if "analyze_soak" in sys.modules:
        return sys.modules["analyze_soak"]
    script = Path(__file__).resolve().parent.parent / "scripts" / "analyze_soak.py"
    spec = importlib.util.spec_from_file_location("analyze_soak", script)
    module = importlib.util.module_from_spec(spec)
    sys.modules["analyze_soak"] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_strategy_breakdown_skipped_for_single_strategy(capsys) -> None:
    """With only one strategy emitting closes, the breakdown section is
    skipped — the numbers would just duplicate the aggregate view.
    """
    mod = _load_analyze_soak()
    ClosedPosition = mod.ClosedPositionRecord
    rows = [
        ClosedPosition(
            market_id=f"m-{i}",
            side="YES",
            size_usd=10.0,
            entry_price=0.5,
            exit_price=0.6,
            realized_pnl=2.0,
            close_reason="paper_take_profit",
            hold_seconds=120.0,
            strategy_id="fade",
        )
        for i in range(3)
    ]
    mod._print_strategy_breakdown(rows)
    out = capsys.readouterr().out
    assert "Per-strategy breakdown" not in out


def test_strategy_breakdown_prints_per_strategy_rows(capsys) -> None:
    """Two strategies → breakdown table shows one row each, with the
    correct aggregated PnL and win rate per strategy_id.
    """
    mod = _load_analyze_soak()
    ClosedPosition = mod.ClosedPositionRecord
    rows = [
        ClosedPosition(
            market_id="m-1", side="YES", size_usd=10.0, entry_price=0.5,
            exit_price=0.6, realized_pnl=2.0, close_reason="paper_take_profit",
            hold_seconds=120.0, strategy_id="fade",
        ),
        ClosedPosition(
            market_id="m-2", side="NO", size_usd=10.0, entry_price=0.5,
            exit_price=0.4, realized_pnl=-2.0, close_reason="paper_stop_loss",
            hold_seconds=60.0, strategy_id="fade",
        ),
        ClosedPosition(
            market_id="m-1", side="NO", size_usd=10.0, entry_price=0.5,
            exit_price=0.6, realized_pnl=2.0, close_reason="paper_take_profit",
            hold_seconds=300.0, strategy_id="adaptive",
        ),
    ]
    mod._print_strategy_breakdown(rows)
    out = capsys.readouterr().out
    assert "Per-strategy breakdown" in out
    # Per-strategy aggregate rows
    assert "fade" in out
    assert "adaptive" in out
    # fade: 2 trades, net 0.00, 1 win → 50%
    # adaptive: 1 trade, +2.00, 1 win → 100%
    assert "50.0%" in out
    assert "100.0%" in out
