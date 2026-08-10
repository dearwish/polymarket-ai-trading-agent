"""Apply the 2026-06-12 audit decisions to an existing agent DB.

See docs/MORNING_REPORT_2026-06-12.md. Summary of why:

- fade / adaptive_v2: negative expectancy in every soak week; signals only
  "work" inverted (fitted noise). Disabled.
- penny: all 36 backtest configurations negative. Stays disabled.
- mm: stays disabled until the inventory-blowup accounting is reworked.
- fee_taker_rate=0.07: Polymarket Fee Structure V2 crypto taker curve —
  paper PnL must stop simulating a fee-free world.
- paper_maker_fill_mode="through": conservative maker-fill model.

Idempotent: writes a settings_changes row only where the effective value
diverges from the target. Same mechanism as seed_clean_soak_overrides.py.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from polymarket_trading_engine.engine.settings_store import SettingsStore

TARGETS: dict[str, object] = {
    "fade_enabled": False,
    "adaptive_v2_enabled": False,
    "penny_enabled": False,
    "adaptive_enabled": False,
    "mm_enabled": False,
    "fee_taker_rate": 0.07,
    "paper_maker_fill_mode": "through",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/agent.db")
    ap.add_argument(
        "--reason",
        default="2026-06-12 audit: disable negative-expectancy strategies; "
        "enable Polymarket fee curve + conservative maker fills",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    store = SettingsStore(Path(args.db))
    current = store.current_overrides()

    pending = []
    for field, target in TARGETS.items():
        before = current.get(field)
        if before == target:
            print(f"  skip  {field}: already {target!r}")
            continue
        print(f"  set   {field}: {before!r} -> {target!r}")
        pending.append((field, before, target))

    if args.dry_run:
        print(f"\n[dry-run] {len(pending)} changes pending; not written.")
        return 0
    if not pending:
        print("\nNothing to apply.")
        return 0

    ids = store.record_changes(
        pending,
        source="cli",
        actor="apply_audit_overrides_20260612",
        reason=args.reason,
    )
    print(f"\nWrote {len(ids)} settings_changes rows: ids={ids}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
