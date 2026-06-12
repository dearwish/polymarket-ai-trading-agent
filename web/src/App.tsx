import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type ViewKey = "overview" | "decisions" | "orders" | "portfolio" | "events" | "event-signals" | "live-portfolio" | "settings" | "daemon";

type LivePosition = {
  title: string;
  option_title?: string;
  event_title?: string;
  slug: string;
  event_slug: string;
  outcome: string;
  outcome_index: number | null;
  asset: string;
  condition_id: string;
  size: number;
  avg_price: number;
  current_price: number;
  cost_usd: number;
  current_value_usd: number;
  cash_pnl_usd: number;
  realized_pnl_usd: number;
  total_pnl_usd: number;
  end_date: string;
  is_settled?: boolean;
  icon: string;
};

type LiveConditionMeta = { option_title: string; event_title: string };

type LivePositionsPayload = {
  wallet: string;
  positions: LivePosition[];
  condition_meta?: Record<string, LiveConditionMeta>;
  summary: {
    count: number;
    total_cost_usd: number;
    total_current_value_usd: number;
    total_cash_pnl_usd: number;
    settled_unredeemed_count?: number;
    settled_unredeemed_pnl_usd?: number;
    closed_realized_pnl_usd: number;
  };
};

type EventSnapshotPick = {
  country?: string;
  outcome?: string;
  conviction: number;
  yes_avg_price: number;
  yes_total_size_usd: number;
  current_yes_price: number;
  yes_holders_count: number;
};

type EventSnapshotRow = {
  snapshot_ts: string;
  snapshot_date: string;
  slug: string;
  title: string;
  end_date: string;
  n_outcomes: number;
  top10: EventSnapshotPick[];
};

type EventSnapshotArchive = {
  snapshots: EventSnapshotRow[];
  total_records: number;
};

type EventSmartMoneyTopWallet = {
  wallet: string;
  name: string;
  avg_price: number;
  bought_usd: number;
  current_cost_usd?: number;
  exit_rate?: number;
};

type EventSmartMoneyRanked = {
  outcome: string;
  condition_id: string;
  current_yes_price: number;
  current_no_price: number;
  closed: boolean;
  yes_holders_count: number;
  yes_total_size_usd: number;        // current $ at risk (size × avgPrice)
  yes_total_bought_usd?: number;      // cumulative lifetime $ bought
  yes_total_pnl: number;
  yes_avg_price: number;
  yes_exit_rate?: number;             // 0..1 fraction of cumulative buying that's exited
  yes_top_wallets: EventSmartMoneyTopWallet[];
  smart_conviction: number;
  yes_token_id: string | null;
  no_token_id: string | null;
};

type BookLevel = { price: number; size: number; cum_usd: number };
type BookEstimate = {
  target_usd: number;
  filled_usd: number;
  filled_shares: number;
  avg_price: number;
  max_price: number;
  fully_filled: boolean;
};
type BookPayload = {
  token_id?: string;
  bids: BookLevel[];
  asks: BookLevel[];
  best_bid: number | null;
  best_ask: number | null;
  midpoint?: number | null;
  spread: number | null;
  bid_depth_usd_top_n: number;
  ask_depth_usd_top_n: number;
  estimate?: BookEstimate;
  error?: string;
};
type BookCacheEntry = { loading: boolean; data?: BookPayload; error?: string };

type EventSmartMoneyDetail = {
  slug: string;
  title: string;
  end_date: string | null;
  n_outcomes: number;
  ranked_outcomes: EventSmartMoneyRanked[];
  top_3: EventSmartMoneyRanked[];
  filters: { min_position_usd: number; min_avg_price: number; top_holders_per_outcome: number };
};

type StatusPayload = {
  trading_mode: string;
  market_family: string;
  live_trading_enabled: boolean;
  open_positions: number;
  available_usd: number;
  paper_available_usd: number;
  funded_balance_usd: number | null;
  available_usd_source: string;
  daily_realized_pnl: number;
  rejected_orders: number;
};

type AuthPayload = {
  readonly_ready: boolean;
  balance: number | null;
  wallet_address: string;
  open_orders_count: number;
  diagnostics_collected: boolean;
};

type LiveActivityPayload = {
  market_id: string;
  last_poll: {
    polled_at: string;
    time_remaining_seconds: number;
    time_remaining_minutes: number;
    trade_counts: {
      yes: number;
      no: number;
      other: number;
      total: number;
    };
  };
  preflight: {
    blockers: string[];
    market: {
      question: string;
      implied_probability: number;
      liquidity_usd: number;
      seconds_to_expiry: number;
    };
    assessment: {
      fair_probability: number;
      confidence: number;
      edge: number;
      suggested_side: string;
    };
  };
  tracked_orders: {
    count: number;
    active_count: number;
    terminal_count: number;
  };
  recent_trades: {
    count: number;
  };
};

type PerStrategyStats = {
  strategy_id: string;
  open_positions: number;
  closed_positions: number;
  total_realized_pnl: number;
  open_notional: number;
  wins: number;
  losses: number;
  win_rate: number | null;
};

type PortfolioSummaryPayload = {
  open_positions: number;
  closed_positions: number;
  total_realized_pnl: number;
  daily_realized_pnl: number;
  open_position_notional: number;
  per_strategy?: PerStrategyStats[];
};

type ClosedPosition = {
  market_id: string;
  order_id: string;
  side: string;
  size_usd: number;
  entry_price: number;
  exit_price: number;
  close_reason: string;
  realized_pnl: number;
  fees_paid: number;
  cumulative_pnl: number;
  opened_at: string;
  closed_at: string | null;
  strategy_id?: string;
};

type ClosedPositionsPayload = {
  count: number;
  positions: ClosedPosition[];
};

type TimelineEvent = {
  event_type: string;
  logged_at: string;
  payload: Record<string, unknown>;
};

type TradeTimelinePayload = {
  order_id: string;
  found: boolean;
  market_id?: string;
  strategy_id?: string;
  rows?: Array<{
    market_id: string;
    side: string;
    size_usd: number;
    entry_price: number;
    exit_price: number;
    realized_pnl: number;
    close_reason: string;
    opened_at: string;
    closed_at: string | null;
    fees_paid?: number;
  }>;
  events?: TimelineEvent[];
  stats?: {
    total_realized_pnl: number;
    total_size_usd: number;
    roi_pct: number;
    hold_seconds: number;
    tranches: number;
  };
};

type OpenPosition = {
  market_id: string;
  side: string;
  size_usd: number;
  entry_price: number;
  opened_at: string;
  order_id: string;
  strategy_id?: string;
};

type OpenPositionsPayload = {
  count: number;
  positions: OpenPosition[];
};

type EquityPoint = {
  sequence: number;
  market_id: string;
  closed_at: string | null;
  realized_pnl: number;
  equity: number;
  strategy_id?: string;
};

type StrategyEquitySeries = {
  strategy_id: string;
  points: EquityPoint[];
};

type EquityCurvePayload = {
  count: number;
  points: EquityPoint[];
  strategy_id: string | null;
  per_strategy_series: StrategyEquitySeries[];
};

type ReportPayload = {
  session_id: string;
  generated_at: string;
  summary: string;
  items: string[];
};

type RecentEvent = {
  event_type: string;
  logged_at: string;
  payload: Record<string, unknown>;
};

type RecentEventsPayload = {
  count: number;
  events: RecentEvent[];
};

type DecisionItem = {
  event_type: string;
  logged_at: string;
  payload: Record<string, unknown>;
};

type DecisionsPayload = {
  count: number;
  decisions: DecisionItem[];
};

type LiveOrder = {
  order_id: string;
  market_id?: string;
  side?: string;
  status: string;
  price?: number;
  size?: number;
  size_matched?: number;
  created_at?: string;
  asset_id?: string;
};

type LiveOrdersPayload = {
  count: number;
  orders: LiveOrder[];
};

type PendingMaker = {
  strategy_id: string;
  market_id: string;
  side: string;
  limit_price: number;
  size_usd: number;
  placed_at: string;
  ttl_seconds: number;
  age_seconds: number;
  ttl_remaining_seconds: number;
  // Live book context (sourced from per-tick MarketState in the daemon
  // and surfaced via the heartbeat). null when the book is missing or
  // one-sided. ``current_ask`` is the side-relevant ask whose drop
  // to-or-below ``limit_price`` would fill us. ``limit_minus_mid`` is
  // a signed cents-off-mid distance — operators eyeball it to spot
  // stale quotes before the freshness loop sweeps them.
  current_mid?: number | null;
  current_ask?: number | null;
  limit_minus_mid?: number | null;
};

type PendingMakersPayload = {
  orders: PendingMaker[];
};

type LiveTrade = {
  trade_id: string;
  order_id?: string;
  market_id?: string;
  status?: string;
  side?: string;
  amount?: number;
  asset_id?: string;
  price?: number;
  size?: number;
  created_at?: string;
};

type LiveTradesPayload = {
  count: number;
  trades: LiveTrade[];
};

type PaperActivityEvent = {
  logged_at: string;
  payload: {
    market_id?: string;
    success?: boolean;
    status?: string;
    mode?: string;
    fill_price?: number;
    filled_size_shares?: number;
    remaining_size_shares?: number;
    order_side?: string;
    execution_style?: string;
    asset_id?: string;
    detail?: string;
    // Tagged on the ExecutionResult by the daemon at every log site
    // so the dashboard can attribute fills to fade / penny / adaptive_v2
    // / market_maker. Old events (pre-2026-05-01) lack this field; the
    // table renders ``—`` for those rows.
    strategy_id?: string;
  };
};

type PaperActivityPayload = {
  count: number;
  events: PaperActivityEvent[];
};

type DaemonHeartbeatPayload = {
  age_seconds: number | null;
  heartbeat: {
    written_at: string;
    metrics: {
      started_at: string;
      active_market_count: number;
      polymarket_events: number;
      btc_ticks: number;
      decision_ticks: number;
      last_decision_latency_ms: number;
      safety_stop_reason: string | null;
      maintenance_runs: number;
    };
    btc_last_price: number | null;
    btc_seconds_since_last_update: number | null;
    btc_session?: string | null;
    safety_stop_reason: string | null;
    market_family: string;
    active_market_ids: string[];
    active_market_slugs?: Record<string, string>;
    // Nested shape: { strategy_id: { market_id: extras } }. Flat shape
    // (Record<market_id, extras>) is still emitted as ``position_extras_flat``
    // for backwards compatibility, but the UI prefers the nested form so
    // adaptive_v2 / penny / fade positions on the same market don't collide.
    position_extras?: Record<string, Record<string, { peak_price?: number; tranches_closed?: number; original_size_usd?: number }>>;
    position_extras_flat?: Record<string, { peak_price?: number; tranches_closed?: number; original_size_usd?: number }>;
    paper_trailing_stop_pct?: number;
    paper_trail_arm_pct?: number;
  } | null;
};

type DaemonTickPayload = {
  market_id: string;
  strategy_id?: string;
  question: string;
  slug?: string;
  end_date_iso?: string;
  seconds_to_expiry: number;
  bid_yes: number;
  ask_yes: number;
  mid_yes?: number;
  bid_no?: number;
  ask_no?: number;
  mid_no?: number;
  fair_probability: number;
  fair_probability_no: number;
  edge_yes: number;
  edge_no: number;
  suggested_side: string;
  confidence: number;
  btc_price: number | null;
  btc_realized_vol_30m: number | null;
  expiry_risk: string;
  time_elapsed_in_candle_s?: number | null;
  signed_flow_5s?: number | null;
  btc_log_return_1h?: number | null;
  btc_log_return_4h?: number | null;
  reasons_to_abstain?: string[] | null;
  reasons_for_trade?: string[] | null;
};

type SettingsValues = Record<string, string | number | boolean>;

function settingNumber(values: SettingsValues | undefined, key: string, fallback: number): number {
  const raw = values?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Condense a verbose scorer reason (e.g.
 *  "Regime (4h UP +0.0040): counter-trend edge +0.0512 < required 0.1500.")
 *  into a dashboard-friendly one-liner. Falls back to the first ~72 chars when
 *  no bespoke shortener matches so new backend reasons still render readably.
 */
function formatBackendReason(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const m1 = trimmed.match(/^Regime \((\w+) (UP|DOWN) ([+-]?\d+\.\d+)\): counter-trend edge ([+-]?\d+\.\d+) < required ([+-]?\d+\.\d+)/);
  if (m1) {
    const [, tf, dir, , edge, required] = m1;
    return `Trend gate — ${tf} ${dir}, edge ${(parseFloat(edge) * 100).toFixed(1)}% < ${(parseFloat(required) * 100).toFixed(0)}%`;
  }
  const m2 = trimmed.match(/^Distressed \((\w+) (UP|DOWN)\): (YES|NO) ask (\d+\.\d+) < floor (\d+\.\d+)/);
  if (m2) {
    const [, tf, dir, side, ask, floor] = m2;
    return `Distressed ${tf} ${dir} — ${side} ask ${(parseFloat(ask) * 100).toFixed(0)}¢ < ${(parseFloat(floor) * 100).toFixed(0)}¢`;
  }
  const m3 = trimmed.match(/^OFI gate: flow ([+-]?\d+\.\d+) opposes (YES|NO|ABSTAIN)/);
  if (m3) return `OFI gate — flow ${parseFloat(m3[1]).toFixed(0)} opposes ${m3[2]}`;
  const m4 = trimmed.match(/^Vol regime: realized_vol (\d+\.\d+) exceeds extreme threshold (\d+\.\d+)/);
  if (m4) return `Vol extreme — σ₃₀ ${(parseFloat(m4[1]) * 100).toFixed(3)}%`;
  const m5 = trimmed.match(/^Vol regime: high vol (\d+\.\d+), edge ([+-]?\d+\.\d+) < required (\d+\.\d+)/);
  if (m5) return `Vol gate — σ₃₀ ${(parseFloat(m5[1]) * 100).toFixed(2)}%, edge ${(parseFloat(m5[2]) * 100).toFixed(1)}% < ${(parseFloat(m5[3]) * 100).toFixed(0)}%`;
  const m6 = trimmed.match(/^Min price: (YES|NO) ask (\d+\.\d+) < floor (\d+\.\d+)/);
  if (m6) return `Price floor — ${m6[1]} ask ${(parseFloat(m6[2]) * 100).toFixed(0)}¢ < ${(parseFloat(m6[3]) * 100).toFixed(0)}¢`;
  const m7 = trimmed.match(/^Chosen edge ([+-]?\d+\.\d+) exceeds \|edge\| ceiling (\d+\.\d+)/);
  if (m7) return `Edge ceiling — ${(parseFloat(m7[1]) * 100).toFixed(1)}% > ${(parseFloat(m7[2]) * 100).toFixed(0)}%`;
  const m8 = trimmed.match(/^No positive edge after costs \(yes=([+-]?\d+\.\d+), no=([+-]?\d+\.\d+)\)/);
  if (m8) {
    const ey = parseFloat(m8[1]);
    const en = parseFloat(m8[2]);
    const best = ey >= en ? ey : en;
    return `No positive edge — best ${(best * 100).toFixed(1)}%`;
  }
  if (/high-expiry-risk window/i.test(trimmed)) return "Expiry-risk window";
  if (/Slippage estimate/i.test(trimmed)) return trimmed.replace(/\.$/, "");
  return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
}

type DecisionReasonOptions = {
  /** ``(strategy_id, market_id)`` pairs with an open paper position.
   *  Strategies don't share their entry block — each runs its own
   *  portfolio slice — so "Position already open" should only fire when
   *  the SAME strategy already has a position on this market, not
   *  whenever any other strategy does. Encoded as ``"strategy|market"``
   *  strings for cheap Set membership checks. */
  openStrategyMarkets?: Set<string>;
};

/** Helper: build the ``"strategy|market"`` key used by
 *  ``openStrategyMarkets`` lookups. Keeping the format in one place so
 *  the producer (PortfolioPage) and consumer (deriveEntryBlockReason)
 *  can't drift apart.
 */
function strategyMarketKey(strategyId: string | undefined, marketId: string | undefined): string {
  return `${strategyId || "fade"}|${marketId || ""}`;
}

/** Reason that would block a YES/NO entry BEFORE the scorer's regime gate
 *  runs — i.e. daemon-level filters in _paper_execute_decision_callback.
 *  Returns null when no pre-risk filter would fire. Checks run in the same
 *  order the daemon applies them so the returned reason matches what the
 *  operator would see in the next trade_decision rejection.
 */
function deriveEntryBlockReason(
  tick: DaemonTickPayload,
  values: SettingsValues | undefined,
  options: DecisionReasonOptions | undefined,
): string | null {
  const side = tick.suggested_side;
  if (side !== "YES" && side !== "NO") return null;

  // 1. Position already open on this (strategy, market) → one-at-a-time
  // policy. Each strategy has its own portfolio slice, so this only
  // fires when the SAME scorer that produced this tick is already long
  // on this market, not when any other strategy is.
  const marketId = tick.market_id;
  const strategyId = tick.strategy_id;
  if (marketId && options?.openStrategyMarkets?.has(strategyMarketKey(strategyId, marketId))) {
    return "Position already open";
  }

  // 2. Candle window (candle-style families only — threshold markets keep
  // elapsed at 0 and are gated differently upstream).
  const elapsed = tick.time_elapsed_in_candle_s ?? null;
  const minCandle = settingNumber(values, "min_candle_elapsed_seconds", 0);
  const maxCandle = settingNumber(values, "max_candle_elapsed_seconds", 0);
  if (minCandle > 0 && elapsed !== null && elapsed > 0 && elapsed < minCandle) {
    return `Blocked · candle too young (${Math.round(elapsed)}/${minCandle}s)`;
  }
  if (maxCandle > 0 && elapsed !== null && elapsed > maxCandle) {
    return `Blocked · candle too old (${Math.round(elapsed)}/${maxCandle}s)`;
  }

  // 3. Minimum TTE floor.
  const minTte = settingNumber(values, "min_entry_tte_seconds", 0);
  const tte = tick.seconds_to_expiry ?? 0;
  if (minTte > 0 && tte > 0 && tte < minTte) {
    return `Blocked · TTE ${tte}s < ${minTte}s floor`;
  }

  // 4. Risk engine floors. Chosen edge is on the picked side; daemon gates on
  //    abs(edge) < min_edge AND confidence < min_confidence.
  const ey = tick.edge_yes ?? 0;
  const en = tick.edge_no ?? 0;
  const chosenEdge = side === "YES" ? ey : en;
  const minEdge = settingNumber(values, "min_edge", 0);
  if (minEdge > 0 && Math.abs(chosenEdge) < minEdge) {
    return `Blocked · edge ${(chosenEdge * 100).toFixed(1)}% < ${(minEdge * 100).toFixed(0)}% floor`;
  }
  const minConf = settingNumber(values, "min_confidence", 0);
  const conf = tick.confidence ?? 0;
  if (minConf > 0 && conf < minConf) {
    return `Blocked · confidence ${(conf * 100).toFixed(0)}% < ${(minConf * 100).toFixed(0)}% floor`;
  }

  return null;
}

function deriveDecisionReason(
  tick: DaemonTickPayload,
  values?: SettingsValues,
  options?: DecisionReasonOptions,
): string {
  const side = tick.suggested_side;
  const elapsed = tick.time_elapsed_in_candle_s ?? null;
  const ey = tick.edge_yes ?? 0;
  const en = tick.edge_no ?? 0;
  const askYes = tick.ask_yes ?? 0;
  const askNo = tick.ask_no ?? 0;
  const conf = tick.confidence ?? 0;
  const flow = tick.signed_flow_5s ?? 0;
  const r1h = tick.btc_log_return_1h ?? 0;
  const vol = tick.btc_realized_vol_30m ?? 0;

  if (side !== "ABSTAIN") {
    const edge = side === "YES" ? ey : en;
    const ask = side === "YES" ? askYes : askNo;
    const trend = r1h > 0.003 ? "↑ 1h" : r1h < -0.003 ? "↓ 1h" : "ranging";
    const flowGate = settingNumber(values, "quant_ofi_gate_min_abs_flow", 60);
    const flowNote = Math.abs(flow) > flowGate ? ` · flow ${flow > 0 ? "+" : ""}${flow.toFixed(0)}` : "";
    const summary = `${trend} · ask ${(ask * 100).toFixed(0)}¢ · edge ${(edge * 100).toFixed(1)}%${flowNote}`;
    // If a daemon-level filter would block entry despite the YES/NO signal,
    // lead with that so the operator knows WHY no position opened. Keep the
    // summary after so the scorer's view still shows.
    const blocker = deriveEntryBlockReason(tick, values, options);
    return blocker ? `${blocker} · ${summary}` : summary;
  }

  // Prefer the scorer's verbatim reason when the daemon emitted one — no
  // heuristic guessing. The list is ordered by the scorer; the first entry is
  // the primary driver of the ABSTAIN.
  const backendReasons = tick.reasons_to_abstain ?? [];
  if (backendReasons.length > 0) {
    return formatBackendReason(backendReasons[0]);
  }

  // Legacy fallback for ticks logged before reasons_to_abstain was added:
  // re-implement the waterfall, but source thresholds from /api/settings so
  // the labels stay in sync with .env instead of hardcoded 3% / 30¢ / 0.008.
  const minCandleElapsed = settingNumber(values, "min_candle_elapsed_seconds", 60);
  if (elapsed !== null && elapsed < minCandleElapsed) {
    return `Candle too young — ${Math.round(elapsed)}s elapsed`;
  }
  const wouldBeSide = ey > en ? "YES" : "NO";
  const wouldBeAsk = wouldBeSide === "YES" ? askYes : askNo;
  const wouldBeEdge = wouldBeSide === "YES" ? ey : en;
  const minEntryPrice = settingNumber(values, "quant_min_entry_price", 0.30);
  if (wouldBeAsk > 0 && wouldBeAsk < minEntryPrice) {
    return `Price floor — ${wouldBeSide} ask ${(wouldBeAsk * 100).toFixed(0)}¢ < ${(minEntryPrice * 100).toFixed(0)}¢`;
  }
  const minEdge = settingNumber(values, "min_edge", 0.03);
  if (wouldBeEdge < minEdge) {
    return `Edge too thin — best ${(wouldBeEdge * 100).toFixed(1)}% < ${(minEdge * 100).toFixed(0)}%`;
  }
  const minConf = settingNumber(values, "min_confidence", 0.60);
  if (conf < minConf && conf > 0) {
    return `Low confidence — ${(conf * 100).toFixed(0)}% < ${(minConf * 100).toFixed(0)}%`;
  }
  const volExtreme = settingNumber(values, "quant_vol_regime_extreme_threshold", 0.008);
  if (vol > volExtreme) {
    return `Vol extreme — σ₃₀ ${(vol * 100).toFixed(3)}%`;
  }
  const flowGate = settingNumber(values, "quant_ofi_gate_min_abs_flow", 60);
  if (Math.abs(flow) >= flowGate) {
    return `OFI gate — flow ${flow > 0 ? "+" : ""}${flow.toFixed(0)} opposes ${wouldBeSide}`;
  }
  return "Regime gate";
}

type SettingsFieldMeta = {
  label: string;
  type: "text" | "number" | "boolean" | "select";
  group: "runtime" | "live" | "thresholds" | "paper";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
};

type SettingsPayload = {
  values: Record<string, string | number | boolean>;
  overrides: Record<string, string | number | boolean>;
  fields: Record<string, SettingsFieldMeta>;
};

type DashboardState = {
  status: StatusPayload | null;
  auth: AuthPayload | null;
  settings: SettingsPayload | null;
  liveActivity: LiveActivityPayload | null;
  portfolioSummary: PortfolioSummaryPayload | null;
  closedPositions: ClosedPositionsPayload | null;
  openPositions: OpenPositionsPayload | null;
  equityCurve: EquityCurvePayload | null;
  report: ReportPayload | null;
  recentEvents: RecentEvent[];
  recentDecisions: DecisionItem[];
  liveOrders: LiveOrder[];
  liveTrades: LiveTrade[];
  livePositions: LivePositionsPayload | null;
  daemonHeartbeat: DaemonHeartbeatPayload | null;
  daemonTicks: DaemonTickPayload[];
  paperActivity: PaperActivityEvent[];
  pendingMakers: PendingMaker[];
};

type DashboardSnapshotPayload = {
  status: StatusPayload;
  auth: AuthPayload;
  settings: SettingsPayload;
  live_activity: LiveActivityPayload;
  portfolio_summary: PortfolioSummaryPayload;
  closed_positions: ClosedPositionsPayload;
  open_positions: OpenPositionsPayload;
  equity_curve: EquityCurvePayload;
  report: ReportPayload;
  recent_events: RecentEventsPayload;
  recent_decisions: DecisionsPayload;
  live_orders: LiveOrdersPayload;
  live_trades: LiveTradesPayload;
  live_positions: LivePositionsPayload;
  daemon_heartbeat: DaemonHeartbeatPayload;
  daemon_ticks: { ticks: DaemonTickPayload[] };
  paper_activity: PaperActivityPayload;
  pending_makers: PendingMakersPayload;
};

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "decisions", label: "Signal History" },
  { key: "orders", label: "Orders & Trades" },
  { key: "portfolio", label: "Portfolio" },
  { key: "events", label: "Event Log" },
  { key: "event-signals", label: "Event Signals" },
  { key: "live-portfolio", label: "Live Portfolio" },
  { key: "settings", label: "Settings" },
  { key: "daemon", label: "Daemon" },
];

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const payload = await response.json();
      detail = payload.detail || JSON.stringify(payload);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Request failed for ${path}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

// Near resolution one side of the book drains — ask=0 means "no sellers",
// not "0¢". Prefer midpoint; fall back to whichever side is non-zero so the
// pill reflects where the market is actually trading.
function formatCentsFromBook(
  mid: number | null | undefined,
  bid: number | null | undefined,
  ask: number | null | undefined,
): string {
  const candidates = [mid, ask, bid];
  for (const v of candidates) {
    if (typeof v === "number" && v > 0) return `${Math.round(v * 100)}¢`;
  }
  return "—";
}

function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return "n/a";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || remainingSeconds) parts.push(`${remainingSeconds}s`);
  return parts.join(" ");
}

type TimeFormat = "12h" | "24h";

const BROWSER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
})();

const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const curated: Array<{ value: string; label: string }> = [
    { value: "UTC", label: "UTC" },
    { value: "Asia/Jerusalem", label: "Israel (Asia/Jerusalem)" },
    { value: "America/New_York", label: "New York (ET)" },
    { value: "Europe/London", label: "London" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
  ];
  // Only add a Browser entry if it isn't already in the curated list —
  // otherwise we'd emit duplicate <option> keys and React warns.
  const existing = curated.find((opt) => opt.value === BROWSER_TZ);
  if (existing) {
    return curated.map((opt) =>
      opt.value === BROWSER_TZ ? { ...opt, label: `${opt.label} · Browser` } : opt,
    );
  }
  return [{ value: BROWSER_TZ, label: `Browser (${BROWSER_TZ})` }, ...curated];
})();

function formatEndTime(endDateIso: string | null | undefined, tz: string, fmt: TimeFormat): string {
  return formatInstant(endDateIso, tz, fmt, "datetime");
}

type InstantVariant = "datetime" | "time" | "date";

function formatInstant(
  iso: string | null | undefined,
  tz: string,
  fmt: TimeFormat,
  variant: InstantVariant = "datetime",
): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz, hour12: fmt === "12h" };
  if (variant === "datetime" || variant === "date") {
    opts.day = "2-digit";
    opts.month = "short";
  }
  if (variant === "datetime" || variant === "time") {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.second = "2-digit";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", opts).format(d);
  } catch {
    return d.toISOString();
  }
}

const SESSION_UTC_RANGES: Record<string, [number, number]> = {
  asia: [0, 8],
  eu: [8, 13],
  us: [13, 21],
  off: [21, 24],
};

function formatUtcHourInTz(utcHour: number, tz: string, fmt: TimeFormat): string {
  // Anchor on today's date so DST is applied for the current period.
  const now = new Date();
  const hour = ((utcHour % 24) + 24) % 24;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour12: fmt === "12h",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return `${String(hour).padStart(2, "0")}:00`;
  }
}

function sessionTooltip(session: string | null | undefined, tz: string, fmt: TimeFormat): string {
  // Mirrors session_bucket() in btc_state.py; boundaries are UTC, shown in the
  // user's display timezone with the UTC range as a fallback note.
  const key = (session ?? "").toLowerCase();
  const range = SESSION_UTC_RANGES[key];
  if (!range) return "Session unknown";
  const [startUtc, endUtc] = range;
  const startLocal = formatUtcHourInTz(startUtc, tz, fmt);
  const endLocal = formatUtcHourInTz(endUtc, tz, fmt);
  const name = key === "off" ? "OFF (low liquidity)" : key.toUpperCase();
  return `${name} — ${startLocal}–${endLocal} ${tz}  (${String(startUtc).padStart(2, "0")}:00–${String(endUtc).padStart(2, "0")}:00 UTC)`;
}

function btcLastUpdateIso(heartbeat: DaemonHeartbeatPayload | null): string | null {
  const hb = heartbeat?.heartbeat;
  if (!hb?.written_at) return null;
  const ageSeconds = hb.btc_seconds_since_last_update ?? 0;
  const t = new Date(hb.written_at).getTime() - ageSeconds * 1000;
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function useDisplayPrefs() {
  const [timezone, setTimezone] = useLocalStorage<string>("display.timezone", BROWSER_TZ);
  const [timeFormat, setTimeFormat] = useLocalStorage<TimeFormat>("display.timeFormat", "24h");
  return { timezone, setTimezone, timeFormat, setTimeFormat };
}

/**
 * Compact trade-ID display. Extracts the sequence number from the full
 * order_id (e.g. "paper-order-000007") and assigns sequential tranche labels
 * T1, T2, … to any "-T<unix_ts>" suffixes grouped under the same base.
 */
function buildTradeIdMap(orderIds: Iterable<string>): Record<string, string> {
  // Group order_ids by base number; remember the tranche timestamp so we can
  // sort and label them in chronological order.
  const groups = new Map<string, { raw: string; ts: number }[]>();
  for (const raw of orderIds) {
    if (!raw) continue;
    const m = raw.match(/paper-order-(\d+)(?:-T(\d+))?/);
    if (!m) continue;
    const base = m[1];
    const tsRaw = m[2];
    const ts = tsRaw ? Number(tsRaw) : 0;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push({ raw, ts });
  }
  const map: Record<string, string> = {};
  for (const [base, entries] of groups) {
    // Tranches get T1, T2, … in chronological order. Any row without a
    // tranche suffix (ts=0) keeps just the base — that's the full close
    // (non-partial) row.
    const tranches = entries.filter((e) => e.ts > 0).sort((a, b) => a.ts - b.ts);
    const nonTranche = entries.filter((e) => e.ts === 0);
    for (const e of nonTranche) map[e.raw] = base;
    tranches.forEach((e, i) => {
      map[e.raw] = `${base}-T${i + 1}`;
    });
  }
  return map;
}

function DisplayPrefsPanel() {
  const { timezone, setTimezone, timeFormat, setTimeFormat } = useDisplayPrefs();
  return (
    <article className="panel">
      <div className="panel-header">
        <h2>Display</h2>
        <span>Applies to every date and time across the dashboard</span>
      </div>
      <div className="settings-grid">
        <label className="settings-field">
          <span>Timezone</span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <small>Stored locally in your browser.</small>
        </label>
        <label className="settings-field">
          <span>Time Format</span>
          <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}>
            <option value="24h">24-hour (14:30)</option>
            <option value="12h">12-hour (2:30 PM)</option>
          </select>
          <small>Stored locally in your browser.</small>
        </label>
      </div>
    </article>
  );
}

function useLocalStorage<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return [value, update];
}


function getInitialView(): ViewKey {
  const hash = window.location.hash.replace("#", "") as ViewKey;
  return VIEWS.some((item) => item.key === hash) ? hash : "overview";
}

function mapSnapshotToState(snapshot: DashboardSnapshotPayload): DashboardState {
  return {
    status: snapshot.status,
    auth: snapshot.auth,
    settings: snapshot.settings,
    liveActivity: snapshot.live_activity,
    portfolioSummary: snapshot.portfolio_summary,
    closedPositions: snapshot.closed_positions,
    openPositions: snapshot.open_positions ?? null,
    equityCurve: snapshot.equity_curve,
    report: snapshot.report,
    recentEvents: snapshot.recent_events.events,
    recentDecisions: snapshot.recent_decisions.decisions,
    liveOrders: snapshot.live_orders.orders,
    liveTrades: snapshot.live_trades.trades,
    livePositions: snapshot.live_positions ?? null,
    daemonHeartbeat: snapshot.daemon_heartbeat ?? null,
    daemonTicks: snapshot.daemon_ticks?.ticks ?? [],
    paperActivity: snapshot.paper_activity?.events ?? [],
    pendingMakers: snapshot.pending_makers?.orders ?? [],
  };
}

function applyDashboardDelta(current: DashboardState, eventName: string, payload: unknown): DashboardState {
  switch (eventName) {
    case "status":
      return { ...current, status: payload as StatusPayload };
    case "auth":
      return { ...current, auth: payload as AuthPayload };
    case "settings":
      return { ...current, settings: payload as SettingsPayload };
    case "live_activity":
      return { ...current, liveActivity: payload as LiveActivityPayload };
    case "portfolio_summary":
      return { ...current, portfolioSummary: payload as PortfolioSummaryPayload };
    case "closed_positions":
      return { ...current, closedPositions: payload as ClosedPositionsPayload };
    case "open_positions":
      return { ...current, openPositions: payload as OpenPositionsPayload };
    case "equity_curve":
      return { ...current, equityCurve: payload as EquityCurvePayload };
    case "report":
      return { ...current, report: payload as ReportPayload };
    case "recent_events":
      return { ...current, recentEvents: (payload as RecentEventsPayload).events };
    case "recent_decisions":
      return { ...current, recentDecisions: (payload as DecisionsPayload).decisions };
    case "live_orders":
      return { ...current, liveOrders: (payload as LiveOrdersPayload).orders };
    case "live_trades":
      return { ...current, liveTrades: (payload as LiveTradesPayload).trades };
    case "live_positions":
      return { ...current, livePositions: payload as LivePositionsPayload };
    case "daemon_heartbeat":
      return { ...current, daemonHeartbeat: payload as DaemonHeartbeatPayload };
    case "daemon_ticks":
      return { ...current, daemonTicks: (payload as { ticks: DaemonTickPayload[] }).ticks };
    case "paper_activity":
      return { ...current, paperActivity: (payload as PaperActivityPayload).events };
    case "pending_makers":
      return { ...current, pendingMakers: (payload as PendingMakersPayload)?.orders ?? [] };
    default:
      return current;
  }
}

function PnlChart({ points }: { points: EquityPoint[] }) {
  const polylinePoints = useMemo(() => {
    if (!points.length) return "";
    const max = Math.max(...points.map((item) => item.equity), 0.01);
    const min = Math.min(...points.map((item) => item.equity), 0);
    const range = Math.max(max - min, 0.01);
    return points
      .map((item, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
        const y = 100 - ((item.equity - min) / range) * 100;
        return `${x},${y}`;
      })
      .join(" ");
  }, [points]);

  if (!points.length) return <div className="empty-state">No closed positions yet.</div>;

  return (
    <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={polylinePoints} />
    </svg>
  );
}

// Stable colour per strategy_id so the legend / lines don't shuffle on
// re-render. Limited palette — if more than 6 strategies are ever wired
// up, extend.
const STRATEGY_COLORS: Record<string, string> = {
  fade: "#4ade80",
  adaptive: "#60a5fa",
  adaptive_v2: "#a78bfa",
  penny: "#f59e0b",
  market_maker: "#f87171",
};

function _colorFor(sid: string): string {
  return STRATEGY_COLORS[sid] || "#94a3b8";
}

function PnlChartMulti({ series }: { series: StrategyEquitySeries[] }) {
  const ranged = useMemo(() => {
    const allPoints = series.flatMap((s) => s.points);
    if (!allPoints.length) return null;
    const max = Math.max(...allPoints.map((p) => p.equity), 0.01);
    const min = Math.min(...allPoints.map((p) => p.equity), 0);
    const range = Math.max(max - min, 0.01);
    const longestSeq = Math.max(...series.map((s) => s.points.length), 1);
    // Each series is independently sequenced (its own trade-count axis).
    // Scaling each x to its own length means a strategy with 5 trades
    // and one with 200 both span the chart width — apples-to-apples on
    // "trade-number" not on wall-clock time. Operators comparing the
    // SHAPE of curves want this, not strict time alignment.
    const lines = series.map((s) => {
      const pts = s.points
        .map((p, i) => {
          const x = s.points.length === 1 ? 0 : (i / (s.points.length - 1)) * 100;
          const y = 100 - ((p.equity - min) / range) * 100;
          return `${x},${y}`;
        })
        .join(" ");
      return { sid: s.strategy_id, pts, last: s.points[s.points.length - 1]?.equity ?? 0, count: s.points.length };
    });
    // Zero line position
    const zeroY = 100 - ((0 - min) / range) * 100;
    return { lines, longestSeq, max, min, zeroY };
  }, [series]);

  if (!ranged || !ranged.lines.length) {
    return <div className="empty-state">No closed positions yet.</div>;
  }

  return (
    <div>
      <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none">
        {ranged.zeroY >= 0 && ranged.zeroY <= 100 && (
          <line
            x1="0"
            y1={ranged.zeroY}
            x2="100"
            y2={ranged.zeroY}
            stroke="var(--muted)"
            strokeWidth="0.3"
            strokeDasharray="1,1"
          />
        )}
        {ranged.lines.map((l) => (
          <polyline
            key={l.sid}
            fill="none"
            stroke={_colorFor(l.sid)}
            strokeWidth="1.5"
            points={l.pts}
          />
        ))}
      </svg>
      <div className="multi-legend" style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: "8px", fontSize: "12px" }}>
        {ranged.lines.map((l) => (
          <span key={l.sid} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "2px", background: _colorFor(l.sid), display: "inline-block" }} />
            <span style={{ color: "var(--muted)" }}>{l.sid}</span>
            <span style={{ color: l.last >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatMoney(l.last)}</span>
            <span style={{ color: "var(--muted)" }}>({l.count})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function OverviewPage({ state }: { state: DashboardState }) {
  const { auth, status, portfolioSummary, liveActivity, equityCurve } = state;
  return (
    <>
      <section className="grid cards">
        <article className="card">
          <h2>Account</h2>
          <p title={auth?.wallet_address}>{auth?.wallet_address || "n/a"}</p>
          <dl>
            <div><dt>Balance</dt><dd>{formatMoney(auth?.balance)}</dd></div>
            <div><dt>Open Orders</dt><dd>{auth?.open_orders_count ?? 0}</dd></div>
            <div><dt>Diagnostics</dt><dd>{auth?.diagnostics_collected ? "Collected" : "Pending"}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Strategy</h2>
          <dl>
            <div><dt>Mode</dt><dd>{status?.trading_mode || "n/a"}</dd></div>
            <div><dt>Market Family</dt><dd>{status?.market_family || "n/a"}</dd></div>
            <div><dt>Available USD</dt><dd>{formatMoney(status?.available_usd)}</dd></div>
            <div><dt>Balance Source</dt><dd>{status?.available_usd_source === "funded_balance" ? "Polymarket" : "Paper"}</dd></div>
            <div><dt>Rejected Orders</dt><dd>{status?.rejected_orders ?? 0}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Portfolio</h2>
          <dl>
            <div><dt>Total PnL</dt><dd>{formatMoney(portfolioSummary?.total_realized_pnl)}</dd></div>
            <div><dt>Daily PnL</dt><dd>{formatMoney(portfolioSummary?.daily_realized_pnl)}</dd></div>
            <div><dt>Closed Trades</dt><dd>{portfolioSummary?.closed_positions ?? 0}</dd></div>
            <div><dt>Exposure</dt><dd>{formatMoney(portfolioSummary?.open_position_notional)}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Last Poll</h2>
          <p>{liveActivity?.preflight?.market?.question || "n/a"}</p>
          <dl>
            <div><dt>Time Remaining</dt><dd>{formatDuration(liveActivity?.last_poll?.time_remaining_seconds)}</dd></div>
            <div><dt>Yes Trades</dt><dd>{liveActivity?.last_poll?.trade_counts?.yes ?? 0}</dd></div>
            <div><dt>No Trades</dt><dd>{liveActivity?.last_poll?.trade_counts?.no ?? 0}</dd></div>
            <div><dt>Total Trades</dt><dd>{liveActivity?.last_poll?.trade_counts?.total ?? 0}</dd></div>
          </dl>
        </article>
      </section>

      <section className="grid detail-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Equity Curve</h2>
            <span>{equityCurve?.count ?? 0} realized points</span>
          </div>
          <PnlChart points={equityCurve?.points ?? []} />
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Decision</h2>
            <span>{liveActivity?.market_id || "n/a"}</span>
          </div>
          <div className="decision-grid">
            <div>
              <label>Suggested Side</label>
              <strong>{liveActivity?.preflight?.assessment?.suggested_side || "n/a"}</strong>
            </div>
            <div>
              <label>Edge</label>
              <strong>{formatPct(liveActivity?.preflight?.assessment?.edge)}</strong>
            </div>
            <div>
              <label>Time Remaining</label>
              <strong>{formatDuration(liveActivity?.last_poll?.time_remaining_seconds)}</strong>
            </div>
            <div>
              <label>Tracked Orders</label>
              <strong>{liveActivity?.tracked_orders?.count ?? 0}</strong>
            </div>
            <div>
              <label>Recent Trades</label>
              <strong>{liveActivity?.recent_trades?.count ?? 0}</strong>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function DecisionsPage({ decisions, settings, openPositions }: { decisions: DecisionItem[]; settings: SettingsPayload | null; openPositions: OpenPosition[] }) {
  const { timezone, timeFormat } = useDisplayPrefs();
  // Same "Position already open" surfacing the Portfolio tab does —
  // keyed by (strategy_id, market_id) so e.g. adaptive_v2's position
  // doesn't suppress fade's tick label.
  const openStrategyMarkets = new Set(
    openPositions.map((p) => strategyMarketKey(p.strategy_id, p.market_id)),
  );
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Signal History</h2>
        <span>{decisions.length} daemon ticks</span>
      </div>
      {decisions.length === 0 ? (
        <div className="empty-state">No signal history yet — start the daemon to populate this view.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Strategy</th>
                <th>Market</th>
                <th>Side</th>
                <th>Fair</th>
                <th>Edge YES</th>
                <th>Edge NO</th>
                <th>Confidence</th>
                <th>TTE</th>
              </tr>
            </thead>
            <tbody>
              {[...decisions].reverse().map((item, index) => {
                const p = item.payload;
                const side = String(p.suggested_side ?? "");
                const sideClass = side === "YES" ? "side-yes" : side === "NO" ? "side-no" : "side-abstain";
                const edgeYes = typeof p.edge_yes === "number" ? p.edge_yes : null;
                const edgeNo = typeof p.edge_no === "number" ? p.edge_no : null;
                const fair = typeof p.fair_probability === "number" ? p.fair_probability : null;
                const conf = typeof p.confidence === "number" ? p.confidence : null;
                const tte = typeof p.seconds_to_expiry === "number" ? p.seconds_to_expiry : null;
                const question = typeof p.question === "string" ? p.question : String(p.market_id ?? "");
                const strategyId = typeof p.strategy_id === "string" ? p.strategy_id : "fade";
                // Reason tooltip: same text the Portfolio → Last Signal table
                // shows. deriveDecisionReason prefers the scorer's verbatim
                // reasons_to_abstain/reasons_for_trade when present, falling
                // back to a live-threshold heuristic for older ticks.
                const reasonTooltip = deriveDecisionReason(
                  p as unknown as DaemonTickPayload,
                  settings?.values,
                  { openStrategyMarkets },
                );
                return (
                  <tr key={`${item.logged_at}-${index}`}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: "12px" }}>{formatInstant(item.logged_at, timezone, timeFormat, "time")}</td>
                    <td><span className={`strategy-badge strategy-${strategyId}`}>{strategyId}</span></td>
                    <td title={question}>{question.length > 42 ? `${question.slice(0, 42)}…` : question}</td>
                    <td>
                      <span
                        className={sideClass}
                        data-tooltip={reasonTooltip}
                      >
                        {side || "n/a"}
                      </span>
                    </td>
                    <td>{fair !== null ? `${(fair * 100).toFixed(1)}%` : "n/a"}</td>
                    <td className={edgeYes !== null && edgeYes > 0 ? "positive" : edgeYes !== null ? "negative" : ""}>
                      {edgeYes !== null ? `${edgeYes >= 0 ? "+" : ""}${(edgeYes * 100).toFixed(2)}%` : "n/a"}
                    </td>
                    <td className={edgeNo !== null && edgeNo > 0 ? "positive" : edgeNo !== null ? "negative" : ""}>
                      {edgeNo !== null ? `${edgeNo >= 0 ? "+" : ""}${(edgeNo * 100).toFixed(2)}%` : "n/a"}
                    </td>
                    <td>{conf !== null ? `${(conf * 100).toFixed(0)}%` : "n/a"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDuration(tte)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EventEntry({
  title,
  timestamp,
  content,
  defaultExpanded = false,
}: {
  title: string;
  timestamp: string;
  content: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const preview = content.length > 180 ? `${content.slice(0, 180)}...` : content;

  const handleCopy = async () => {
    // Try the async Clipboard API first; fall back to a hidden textarea for
    // non-HTTPS dev origins where navigator.clipboard is undefined.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement("textarea");
        ta.value = content;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Swallow — the button text flips back on the next render and the user
      // can retry; surfacing an error dialog for a copy action is worse UX.
    }
  };

  return (
    <li className="event-entry">
      <div className="event-entry-header">
        <div>
          <strong>{title}</strong>
          <div className="event-time">{timestamp}</div>
        </div>
        <div className="event-entry-actions">
          <button
            type="button"
            className="toggle-button icon-button"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy JSON"}
            aria-label="Copy JSON to clipboard"
          >
            {copied ? "✓" : "⧉"}
          </button>
          <button type="button" className="toggle-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      <pre className="event-preview">{expanded ? content : preview}</pre>
    </li>
  );
}

function OrdersPage({ liveOrders, liveTrades, liveActivity, paperActivity, tradingMode, daemonTicks, pendingMakers }: { liveOrders: LiveOrder[]; liveTrades: LiveTrade[]; liveActivity: LiveActivityPayload | null; paperActivity: PaperActivityEvent[]; tradingMode: string; daemonTicks: DaemonTickPayload[]; pendingMakers: PendingMaker[] }) {
  const isLive = tradingMode === "live";
  const { timezone, timeFormat } = useDisplayPrefs();
  const marketLookup = useMemo(() => buildMarketLookup(daemonTicks), [daemonTicks]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const [liveOpen, setLiveOpen] = useState<boolean>(isLive);
  const [paperOpen, setPaperOpen] = useState<boolean>(!isLive);
  const selectedOrder = liveOrders.find((order) => order.order_id === selectedOrderId) ?? liveOrders[0];
  const selectedTrade = liveTrades.find((trade) => trade.trade_id === selectedTradeId) ?? liveTrades[0];
  return (
    <div className="accordion-stack">
    <details className="mode-accordion" open={liveOpen} onToggle={(e) => setLiveOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="mode-chip">Live Trading</span>
        {isLive ? <span className="mode-badge-active">ACTIVE</span> : <span className="mode-badge-idle">idle</span>}
        <span className="mode-summary-meta">{liveOrders.length} orders · {liveTrades.length} trades</span>
      </summary>
    <section className="grid detail-grid">
      <article className="panel">
        <div className="panel-header">
          <h2>Open Orders</h2>
          <span>{liveOrders.length} open</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Market</th>
                <th>Side</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {liveOrders.map((order) => (
                <tr key={order.order_id} className={selectedOrder?.order_id === order.order_id ? "selected-row" : ""} onClick={() => setSelectedOrderId(order.order_id)}>
                  <td>{order.order_id}</td>
                  <td>{order.market_id || "n/a"}</td>
                  <td>{order.side || "n/a"}</td>
                  <td>{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!liveOrders.length && <div className="empty-state">No open live orders.</div>}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <h2>Recent Trades</h2>
          <span>{liveTrades.length} recent</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trade ID</th>
                <th>Order</th>
                <th>Market</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {liveTrades.map((trade) => (
                <tr key={trade.trade_id} className={selectedTrade?.trade_id === trade.trade_id ? "selected-row" : ""} onClick={() => setSelectedTradeId(trade.trade_id)}>
                  <td>{trade.trade_id}</td>
                  <td>{trade.order_id || "n/a"}</td>
                  <td>{trade.market_id || "n/a"}</td>
                  <td>{trade.status || "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!liveTrades.length && <div className="empty-state">No recent live trades.</div>}
        </div>
      </article>

      <article className="panel full-span">
        <div className="panel-header">
          <h2>Detail Drawer</h2>
          <span>{liveActivity?.market_id || "n/a"}</span>
        </div>
        <div className="detail-drawer-grid">
          {selectedOrder?.order_id && (
            <div>
              <label>Selected Order</label>
              <strong>{selectedOrder.order_id}</strong>
              <p className="detail-copy">
                status={selectedOrder.status || "n/a"} | side={selectedOrder.side || "n/a"} | market={selectedOrder.market_id || "n/a"}
              </p>
              <p className="detail-copy">
                price={selectedOrder.price ?? "n/a"} | size={selectedOrder.size ?? "n/a"} | matched={selectedOrder.size_matched ?? "n/a"}
              </p>
              <p className="detail-copy">created={selectedOrder.created_at || "n/a"} | asset={selectedOrder.asset_id || "n/a"}</p>
            </div>
          )}
          {selectedTrade?.trade_id && (
            <div>
              <label>Selected Trade</label>
              <strong>{selectedTrade.trade_id}</strong>
              <p className="detail-copy">
                status={selectedTrade.status || "n/a"} | side={selectedTrade.side || "n/a"} | market={selectedTrade.market_id || "n/a"}
              </p>
              <p className="detail-copy">
                price={selectedTrade.price ?? "n/a"} | size={selectedTrade.size ?? "n/a"} | amount={selectedTrade.amount ?? "n/a"}
              </p>
              <p className="detail-copy">created={selectedTrade.created_at || "n/a"} | asset={selectedTrade.asset_id || "n/a"}</p>
            </div>
          )}
          <div>
            <label>Live Readiness</label>
            <strong>{liveActivity?.preflight?.market?.question || "n/a"}</strong>
            <p className="detail-copy">blockers={liveActivity?.preflight?.blockers?.join(", ") || "none"}</p>
            <p className="detail-copy">
              implied={formatPct(liveActivity?.preflight?.market?.implied_probability)} | fair={formatPct(liveActivity?.preflight?.assessment?.fair_probability)}
            </p>
            <p className="detail-copy">
              confidence={formatPct(liveActivity?.preflight?.assessment?.confidence)} | liquidity={formatMoney(liveActivity?.preflight?.market?.liquidity_usd)}
            </p>
          </div>
        </div>
      </article>
    </section>
    </details>

    <details className="mode-accordion" open={paperOpen} onToggle={(e) => setPaperOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="mode-chip">Paper Trading</span>
        {!isLive ? <span className="mode-badge-active">ACTIVE</span> : <span className="mode-badge-idle">idle</span>}
        <span className="mode-summary-meta">{pendingMakers.length} resting · {paperActivity.length} executions</span>
      </summary>
      <section className="grid">
      <article className="panel full-span">
        <div className="panel-header">
          <h2>Pending Maker Orders</h2>
          <span>{pendingMakers.length} resting</span>
        </div>
        {pendingMakers.length === 0 ? (
          <div className="empty-state">No resting paper-maker limits. Enable <code>mm_enabled</code> for two-sided MM quotes, or <code>fade_post_only</code>/<code>adaptive_v2_post_only</code> to route a directional scorer through the maker lifecycle.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Limit</th>
                  <th>Mid</th>
                  <th>Δ vs Mid</th>
                  <th>Ask (fills @≤)</th>
                  <th>Size</th>
                  <th>Age</th>
                  <th>TTL Left</th>
                </tr>
              </thead>
              <tbody>
                {pendingMakers.map((m) => {
                  const sideClass = m.side === "YES" ? "positive" : m.side === "NO" ? "negative" : "";
                  const ttlClass = m.ttl_remaining_seconds < 30 ? "negative" : "";
                  // Δ vs mid: positive (above mid) shouldn't happen for a
                  // BUY rest because we always quote below mid by design;
                  // colour-code so a positive value visually pops as a bug
                  // signal. Tight magnitude (< 1¢) = quote is tracking
                  // mid as intended.
                  const delta = m.limit_minus_mid;
                  const deltaClass =
                    delta === null || delta === undefined
                      ? "muted"
                      : delta > 0
                      ? "negative"
                      : Math.abs(delta) < 0.01
                      ? "positive"
                      : "";
                  // Ask gap: how close are we to filling? When
                  // current_ask − limit_price ≤ 0 we'd fill on the next
                  // tick. Highlight when within 1¢ as "imminent fill".
                  const askGap =
                    m.current_ask !== null && m.current_ask !== undefined
                      ? m.current_ask - m.limit_price
                      : null;
                  const askClass =
                    askGap === null
                      ? "muted"
                      : askGap <= 0
                      ? "positive"
                      : askGap < 0.01
                      ? ""
                      : "muted";
                  return (
                    <tr key={`${m.strategy_id}-${m.market_id}-${m.side}`}>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }}>{m.strategy_id}</td>
                      <td><MarketCell marketId={m.market_id} lookup={marketLookup} timezone={timezone} timeFormat={timeFormat} /></td>
                      <td className={sideClass}>{m.side}</td>
                      <td>{m.limit_price.toFixed(4)}</td>
                      <td className={m.current_mid === null || m.current_mid === undefined ? "muted" : ""}>
                        {m.current_mid !== null && m.current_mid !== undefined ? m.current_mid.toFixed(4) : "—"}
                      </td>
                      <td className={deltaClass}>
                        {delta !== null && delta !== undefined ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}¢` : "—"}
                      </td>
                      <td className={askClass}>
                        {m.current_ask !== null && m.current_ask !== undefined ? m.current_ask.toFixed(4) : "—"}
                      </td>
                      <td>{formatMoney(m.size_usd)}</td>
                      <td>{formatDuration(m.age_seconds)}</td>
                      <td className={ttlClass}>{formatDuration(m.ttl_remaining_seconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="panel full-span">
        <div className="panel-header">
          <h2>Paper Activity</h2>
          <span>{paperActivity.length} execution events</span>
        </div>
        {paperActivity.length === 0 ? (
          <div className="empty-state">No paper executions yet — enable <code>DAEMON_AUTO_PAPER_EXECUTE</code> and wait for an APPROVED signal.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Strategy</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Status</th>
                  <th>Fill Price (VWAP)</th>
                  <th>Filled Shares</th>
                  <th>Style</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {[...paperActivity].reverse().map((event, index) => {
                  const p = event.payload;
                  const side = String(p.order_side ?? "");
                  const sideClass = side === "BUY" ? "positive" : side === "SELL" ? "negative" : "";
                  const status = String(p.status ?? "");
                  const statusClass = p.success ? "positive" : status === "SKIPPED" ? "" : "negative";
                  const price = typeof p.fill_price === "number" && p.fill_price > 0 ? p.fill_price.toFixed(4) : "n/a";
                  const shares = typeof p.filled_size_shares === "number" ? p.filled_size_shares.toFixed(2) : "n/a";
                  const detail = p.detail ?? "";
                  const strategyId = p.strategy_id;
                  return (
                    <tr key={`${event.logged_at}-${index}`}>
                      <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: "12px" }}>{formatInstant(event.logged_at, timezone, timeFormat, "time")}</td>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }}>{strategyId ?? "—"}</td>
                      <td>{p.market_id ? <MarketCell marketId={p.market_id} lookup={marketLookup} timezone={timezone} timeFormat={timeFormat} /> : "n/a"}</td>
                      <td className={sideClass}>{side || "n/a"}</td>
                      <td className={statusClass}>{status || "n/a"}</td>
                      <td>{price}</td>
                      <td>{shares}</td>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }}>{p.execution_style ?? "n/a"}</td>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }} title={detail}>
                        {detail.length > 60 ? `${detail.slice(0, 60)}…` : detail}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
      </section>
    </details>
    </div>
  );
}

function summarizeTimelineEvent(e: TimelineEvent): { kind: string; summary: string } {
  const p = (e.payload || {}) as Record<string, unknown>;
  switch (e.event_type) {
    case "paper_maker_placed": {
      const side = String(p.side ?? "?");
      const limit = typeof p.limit_price === "number" ? p.limit_price.toFixed(4) : "?";
      const midYes = typeof p.mid_yes === "number" ? p.mid_yes.toFixed(3) : "?";
      const source = p.source ? ` [${p.source}]` : "";
      return { kind: "Maker placed", summary: `${side} @ ${limit} (mid_yes=${midYes})${source}` };
    }
    case "paper_maker_cancelled": {
      const side = String(p.side ?? "?");
      const limit = typeof p.limit_price === "number" ? p.limit_price.toFixed(4) : "?";
      const reason = String(p.reason ?? "?");
      const delta = typeof p.price_delta === "number" ? `, drift=${p.price_delta.toFixed(4)}` : "";
      return { kind: "Maker cancelled", summary: `${side} @ ${limit} — ${reason}${delta}` };
    }
    case "execution_result": {
      const detail = String(p.detail ?? "");
      const fillPrice = typeof p.fill_price === "number" ? p.fill_price.toFixed(4) : "?";
      const shares = typeof p.filled_size_shares === "number" ? p.filled_size_shares.toFixed(4) : "?";
      return { kind: "FILLED", summary: `${shares} shares @ ${fillPrice} — ${detail.slice(0, 80)}` };
    }
    case "position_closed": {
      const reason = String(p.close_reason ?? "?");
      const exit = typeof p.exit_price === "number" ? p.exit_price.toFixed(4) : "?";
      const pnl = typeof p.realized_pnl === "number" ? p.realized_pnl.toFixed(4) : "?";
      const sign = typeof p.realized_pnl === "number" && p.realized_pnl >= 0 ? "+" : "";
      return { kind: "Position closed", summary: `${reason} @ ${exit}, PnL ${sign}$${pnl}` };
    }
    default:
      return { kind: e.event_type, summary: JSON.stringify(p).slice(0, 80) };
  }
}

function TradeTimelineModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { timezone, timeFormat } = useDisplayPrefs();
  const [data, setData] = useState<TradeTimelinePayload | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setData(null);
    fetchJson<TradeTimelinePayload>(`/api/positions/timeline?order_id=${encodeURIComponent(orderId)}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [orderId]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trade timeline — <code style={{ fontSize: "13px" }}>{orderId}</code></h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="empty-state negative">Failed to load: {error}</div>}
          {!error && !data && <div className="empty-state">Loading…</div>}
          {data && !data.found && <div className="empty-state">No trade found for this order_id.</div>}
          {data && data.found && (
            <>
              <div className="modal-stats">
                <div><dt>Strategy</dt><dd>{data.strategy_id}</dd></div>
                <div><dt>Market</dt><dd>{data.market_id}</dd></div>
                <div><dt>Tranches</dt><dd>{data.stats?.tranches}</dd></div>
                <div><dt>Total notional</dt><dd>{formatMoney(data.stats?.total_size_usd)}</dd></div>
                <div>
                  <dt>Realized PnL</dt>
                  <dd className={(data.stats?.total_realized_pnl ?? 0) >= 0 ? "positive" : "negative"}>
                    {(data.stats?.total_realized_pnl ?? 0) >= 0 ? "+" : ""}{formatMoney(data.stats?.total_realized_pnl)}
                    {" "}({((data.stats?.roi_pct ?? 0) * 100).toFixed(1)}%)
                  </dd>
                </div>
                <div><dt>Hold time</dt><dd>{formatDuration(data.stats?.hold_seconds)}</dd></div>
              </div>

              <h3 style={{ marginTop: 16 }}>Timeline</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Event</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.events ?? []).map((e, idx) => {
                      const { kind, summary } = summarizeTimelineEvent(e);
                      const cls = e.event_type === "execution_result" ? "positive"
                        : e.event_type === "position_closed" ? ((e.payload as Record<string, unknown>).realized_pnl as number ?? 0) >= 0 ? "positive" : "negative"
                        : "";
                      return (
                        <tr key={`${e.logged_at}-${idx}`}>
                          <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted)" }}>
                            {formatInstant(e.logged_at, timezone, timeFormat, "datetime")}
                          </td>
                          <td className={cls}><strong>{kind}</strong></td>
                          <td style={{ fontSize: "12px" }}>{summary}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!(data.events ?? []).length && <div className="empty-state">No journal events found in the scan window.</div>}
              </div>

              {(data.rows?.length ?? 0) > 1 && (
                <>
                  <h3 style={{ marginTop: 16 }}>Tranches ({data.rows?.length})</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Side</th><th>Size</th><th>Entry</th><th>Exit</th><th>Reason</th><th>PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.rows ?? []).map((r, i) => (
                          <tr key={i}>
                            <td>{r.side}</td>
                            <td>{formatMoney(r.size_usd)}</td>
                            <td>{r.entry_price.toFixed(4)}</td>
                            <td>{r.exit_price.toFixed(4)}</td>
                            <td>{r.close_reason}</td>
                            <td className={r.realized_pnl >= 0 ? "positive" : "negative"}>
                              {r.realized_pnl >= 0 ? "+" : ""}{formatMoney(r.realized_pnl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioPage({ summary, positions, openPositions, equityCurve, daemonTicks, heartbeat, settings }: { summary: PortfolioSummaryPayload | null; positions: ClosedPosition[]; openPositions: OpenPosition[]; equityCurve: EquityCurvePayload | null; daemonTicks: DaemonTickPayload[]; heartbeat: DaemonHeartbeatPayload | null; settings: SettingsPayload | null }) {
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null);
  const { timezone, timeFormat } = useDisplayPrefs();
  // Rebuild the lookup on every render so the Mark / Unrealized PnL cells
  // always reflect the freshest daemon_tick. With a handful of markets the
  // cost is negligible and avoids any reference-stability bail in useMemo.
  const marketLookup = buildMarketLookup(daemonTicks);
  // Multi-strategy lookup for the Last Signal panel, which renders one
  // row per (market, strategy) so fade / adaptive / penny are all
  // visible instead of whichever scorer happened to fire last.
  const marketStrategyLookup = buildMarketStrategyLookup(daemonTicks);
  // Daemon-provided trail state (peak_price, etc.) + the trail settings so we
  // can compute each open position's live trailing-stop level. The nested
  // shape ({strategy: {market: extras}}) is preferred so the same market on
  // different strategies doesn't collide; we fall back to the flat shape if
  // a daemon predating the nested heartbeat is talking to a fresh dashboard.
  const hb = heartbeat?.heartbeat ?? null;
  const positionExtras = hb?.position_extras ?? {};
  const positionExtrasFlat = hb?.position_extras_flat ?? {};
  const trailPct = hb?.paper_trailing_stop_pct ?? 0;
  const trailArmPct = hb?.paper_trail_arm_pct ?? 0;
  // (strategy_id, market_id) pairs with an open position — used by
  // deriveDecisionReason to label YES/NO ticks on those pairs as
  // "Position already open" instead of pretending the entry could have
  // fired. Keying on both dimensions matters because each strategy has
  // its own portfolio slice: adaptive_v2 being long on a market doesn't
  // block fade from entering the same market.
  const openStrategyMarkets = new Set(
    openPositions.map((p) => strategyMarketKey(p.strategy_id, p.market_id)),
  );
  // Bump to force Polymarket iframes to remount with a fresh src. The embed
  // is a 3rd-party page we can't message, so a URL-level cache-bust is the
  // only reliable way to refresh it on demand.
  const [embedReloadKey, setEmbedReloadKey] = useState(0);
  // Strategy filter for the equity curve. ``"all"`` overlays every
  // strategy's curve; a specific id renders just that one. The list is
  // derived from the per-strategy series the API already returns, so
  // strategies with zero closed positions don't appear (they have no
  // curve to draw anyway).
  const [equityStrategy, setEquityStrategy] = useState<string>("all");
  const selectedSeries = equityCurve?.per_strategy_series?.find((s) => s.strategy_id === equityStrategy);
  const selectedSeriesPoints = selectedSeries?.points ?? [];

  // Single source of truth for strategy filtering across every panel on this
  // page. ``strategyEnabled`` mirrors the backend's per-strategy gate (fade
  // is always on; everything else gates on ``{id}_enabled``). ``selectedOk``
  // additionally honors the dropdown — ``"all"`` overlays every enabled
  // strategy, a specific id narrows every panel to that one.
  const enabledMap = settings?.values ?? {};
  // strategy_id → settings flag. Most strategies use ``{id}_enabled`` but
  // market_maker is the odd one out (``mm_enabled``); fade is structurally
  // always on and has no toggle.
  const STRATEGY_ENABLE_FLAG: Record<string, string | null> = {
    fade: null,
    adaptive: "adaptive_enabled",
    adaptive_v2: "adaptive_v2_enabled",
    penny: "penny_enabled",
    market_maker: "mm_enabled",
  };
  const strategyEnabled = (s: string): boolean => {
    if (!(s in STRATEGY_ENABLE_FLAG)) {
      // Unknown strategy id — fall back to the ``{id}_enabled`` convention
      // so a future scorer that follows the pattern doesn't get hidden.
      const flag = enabledMap[`${s}_enabled`];
      return flag !== false;
    }
    const flagKey = STRATEGY_ENABLE_FLAG[s];
    if (flagKey === null) return true;
    return enabledMap[flagKey] !== false;
  };
  const selectedOk = (s: string | null | undefined): boolean => {
    const sid = s ?? "fade";
    if (!strategyEnabled(sid)) return false;
    return equityStrategy === "all" || sid === equityStrategy;
  };
  // Dropdown options: union of every strategy we have evidence of (closed
  // curve, summary row, live tick, open position), filtered to the ones
  // currently enabled. Stable order so the visual grouping is predictable.
  const STRATEGY_ORDER = ["fade", "adaptive", "adaptive_v2", "penny", "market_maker"];
  const knownStrategies = new Set<string>();
  for (const row of summary?.per_strategy ?? []) knownStrategies.add(row.strategy_id);
  for (const s of equityCurve?.per_strategy_series ?? []) knownStrategies.add(s.strategy_id);
  for (const perStrat of Object.values(marketStrategyLookup)) {
    for (const sid of Object.keys(perStrat)) knownStrategies.add(sid);
  }
  for (const p of openPositions) knownStrategies.add(p.strategy_id ?? "fade");
  const displayStrategies = [...knownStrategies]
    .filter(strategyEnabled)
    .sort((a, b) => {
      const ia = STRATEGY_ORDER.indexOf(a);
      const ib = STRATEGY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  // Strategy-scoped views used by the metrics panel. When "all" we hand back
  // the API-level summary (already enabled-only on the backend); when a
  // specific strategy is chosen we project from per_strategy + closed
  // positions list (the API doesn't break out daily PnL per strategy).
  const selectedStrategyRow = equityStrategy === "all"
    ? null
    : summary?.per_strategy?.find((r) => r.strategy_id === equityStrategy) ?? null;
  const dailyForSelected = (() => {
    if (equityStrategy === "all") return null;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return positions
      .filter((p) => (p.strategy_id ?? "fade") === equityStrategy)
      .filter((p) => p.closed_at && new Date(p.closed_at).getTime() >= startMs)
      .reduce((sum, p) => sum + p.realized_pnl, 0);
  })();
  const metricsTotalPnl = equityStrategy === "all"
    ? summary?.total_realized_pnl
    : selectedStrategyRow?.total_realized_pnl;
  const metricsDailyPnl = equityStrategy === "all"
    ? summary?.daily_realized_pnl
    : dailyForSelected;
  const metricsClosed = equityStrategy === "all"
    ? summary?.closed_positions
    : selectedStrategyRow?.closed_positions ?? 0;
  const metricsExposure = equityStrategy === "all"
    ? summary?.open_position_notional
    : selectedStrategyRow?.open_notional;

  // Visible position lists for the bottom panels.
  const visibleOpenPositions = openPositions.filter((p) => selectedOk(p.strategy_id));
  const visibleClosedPositions = positions.filter((p) => selectedOk(p.strategy_id));

  return (
    <section className="grid detail-grid">
      <article className="panel">
        <div className="panel-header">
          <h2>Equity Curve</h2>
          <span style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
            <label style={{ fontSize: "12px", color: "var(--muted)" }}>
              Strategy:&nbsp;
              <select
                value={equityStrategy}
                onChange={(e) => setEquityStrategy(e.target.value)}
                style={{ fontSize: "12px" }}
              >
                <option value="all">all (overlay)</option>
                {displayStrategies.map((sid) => (
                  <option key={sid} value={sid}>{sid}</option>
                ))}
              </select>
            </label>
            <span>{equityStrategy === "all" ? (equityCurve?.count ?? 0) : selectedSeriesPoints.length} closed points</span>
          </span>
        </div>
        {equityStrategy === "all" ? (
          <PnlChartMulti series={equityCurve?.per_strategy_series ?? []} />
        ) : (
          <PnlChart points={selectedSeriesPoints} />
        )}
        {equityStrategy !== "all" && (
          <div className="axis-labels">
            <span>{formatInstant(selectedSeriesPoints[0]?.closed_at, timezone, timeFormat, "date") || "start"}</span>
            <span>{formatInstant(selectedSeriesPoints[selectedSeriesPoints.length - 1]?.closed_at, timezone, timeFormat, "date") || "latest"}</span>
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-header">
          <h2>Portfolio Metrics</h2>
          <span>{equityStrategy === "all" ? "Realized performance" : `Strategy: ${equityStrategy}`}</span>
        </div>
        <dl>
          <div><dt>Total Realized PnL</dt><dd>{formatMoney(metricsTotalPnl)}</dd></div>
          <div><dt>Daily Realized PnL</dt><dd>{formatMoney(metricsDailyPnl)}</dd></div>
          <div><dt>Closed Positions</dt><dd>{metricsClosed ?? 0}</dd></div>
          <div><dt>Exposure</dt><dd>{formatMoney(metricsExposure)}</dd></div>
        </dl>
      </article>

      {(() => {
        const filteredPerStrategy = (summary?.per_strategy ?? []).filter((row) => selectedOk(row.strategy_id));
        if (!filteredPerStrategy.length) return null;
        return (
        <article className="panel full-span">
          <div className="panel-header">
            <h2>Per-Strategy Stats</h2>
            <span>Realised performance by scorer</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Open</th>
                  <th>Closed</th>
                  <th>Total PnL</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Win Rate</th>
                  <th>Exposure</th>
                </tr>
              </thead>
              <tbody>
                {filteredPerStrategy.map((row) => {
                  const pnlCls = row.total_realized_pnl >= 0 ? "positive" : "negative";
                  const sign = row.total_realized_pnl >= 0 ? "+" : "";
                  return (
                    <tr key={row.strategy_id}>
                      <td><span className={`strategy-badge strategy-${row.strategy_id}`}>{row.strategy_id}</span></td>
                      <td>{row.open_positions}</td>
                      <td>{row.closed_positions}</td>
                      <td className={pnlCls}>{sign}{formatMoney(row.total_realized_pnl)}</td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{row.win_rate !== null ? `${(row.win_rate * 100).toFixed(1)}%` : "—"}</td>
                      <td>{formatMoney(row.open_notional)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
        );
      })()}

      {(() => {
        const activeIds: string[] = hb?.active_market_ids ?? [];
        // Render one row per (market, strategy) so fade / adaptive / penny
        // each get their own "last signal" instead of whichever scorer
        // happened to fire last collapsing them all into one row.
        type Row = { marketId: string; strategyId: string; tick: DaemonTickPayload };
        const rows: Row[] = [];
        for (const marketId of activeIds) {
          const perStrategy = marketStrategyLookup[marketId];
          if (!perStrategy) continue;
          const strategyIds = Object.keys(perStrategy)
            .filter(selectedOk)
            .sort((a, b) => {
              const ia = STRATEGY_ORDER.indexOf(a);
              const ib = STRATEGY_ORDER.indexOf(b);
              return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });
          for (const strategyId of strategyIds) {
            const tick = perStrategy[strategyId];
            // Drop pre-market rows outright — they were rendered as a
            // greyed "pre-market" label, but with three strategies per
            // market the clutter outweighs the information. Show only
            // live-candle signals.
            if (tick.seconds_to_expiry > 900) continue;
            rows.push({ marketId, strategyId, tick });
          }
        }
        if (!rows.length) return null;
        const distinctMarkets = new Set(rows.map((r) => r.marketId)).size;
        const distinctStrategies = new Set(rows.map((r) => r.strategyId)).size;
        return (
          <article className="panel full-span">
            <div className="panel-header">
              <h2>Last Signal</h2>
              <span>{distinctMarkets} active market{distinctMarkets === 1 ? "" : "s"} × {distinctStrategies} strateg{distinctStrategies === 1 ? "y" : "ies"}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Market</th>
                    <th>Decision</th>
                    <th>Edge</th>
                    <th>Conf</th>
                    <th>TTE</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ marketId, strategyId, tick }) => {
                    const side = tick.suggested_side;
                    const sideClass = side === "YES" ? "side-yes" : side === "NO" ? "side-no" : "side-abstain";
                    const icon = side === "YES" ? "▲" : side === "NO" ? "▼" : "—";
                    const edge = side === "YES" ? tick.edge_yes : side === "NO" ? tick.edge_no : null;
                    const reason = deriveDecisionReason(tick, settings?.values, { openStrategyMarkets });
                    const question = tick.question ?? marketId;
                    const label = question.length > 36 ? `${question.slice(0, 36)}…` : question;
                    return (
                      <tr key={`${marketId}-${strategyId}`}>
                        <td><span className={`strategy-badge strategy-${strategyId}`}>{strategyId}</span></td>
                        <td title={question} style={{ fontSize: "12px" }}>{label}</td>
                        <td>
                          <span
                            className={sideClass}
                            style={{ fontWeight: 600, letterSpacing: "0.02em" }}
                            data-tooltip={reason}
                          >
                            {icon} {side}
                          </span>
                        </td>
                        <td className={edge != null && edge > 0 ? "positive" : edge != null ? "negative" : ""}>
                          {edge != null ? `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td>{tick.confidence > 0 ? `${(tick.confidence * 100).toFixed(0)}%` : "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatDuration(tick.seconds_to_expiry)}</td>
                        <td style={{ fontSize: "12px", color: "var(--muted)" }}>{reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })()}

      {(() => {
        // Merge active markets from daemon heartbeat with open-position markets.
        // Show even when there are no open positions.
        const activeIds: string[] = hb?.active_market_ids ?? [];
        const slugOverrides: Record<string, string> = hb?.active_market_slugs ?? {};
        // Only show markets that (a) have at least one tick from an enabled
        // strategy AND (b) are in the active market_family. ``active_market_ids``
        // pins markets the daemon is managing (e.g. open mm_universe positions on
        // long-dated political markets) regardless of strategy enable state, and
        // the dashboard's ~5000-event tick cache holds stale fade ticks long
        // after mm gets disabled. Gating on TTE ≤ 15min naturally excludes any
        // non-family market — every BTC 15m candle has TTE ≤ 900s by definition;
        // mm_universe markets (e.g. "Iran peace deal by 2026") have TTE in days.
        // NOTE: 900 hard-coded for the btc_15m family. Make this derive from the
        // configured market_family if/when we run multiple families.
        const FAMILY_TTE_CEILING = 900;
        const strategyHasMarket = (id: string): boolean => {
          const perStrategy = marketStrategyLookup[id];
          if (!perStrategy) return false;
          for (const [sid, tick] of Object.entries(perStrategy)) {
            if (!selectedOk(sid)) continue;
            if (tick.seconds_to_expiry <= FAMILY_TTE_CEILING) return true;
          }
          return false;
        };
        const filteredActiveIds = activeIds.filter(strategyHasMarket);
        const filteredOpenPositions = openPositions.filter((p) => selectedOk(p.strategy_id));
        const seen = new Set<string>(filteredActiveIds);
        const allIds = [...filteredActiveIds];
        for (const position of filteredOpenPositions) {
          if (!seen.has(position.market_id)) {
            seen.add(position.market_id);
            allIds.push(position.market_id);
          }
        }
        if (allIds.length === 0) return null;
        return (
          <article className="panel full-span">
            <div className="panel-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Live Markets</h2>
                <button
                  type="button"
                  onClick={() => setEmbedReloadKey((k) => k + 1)}
                  title="Refresh Polymarket embeds"
                  aria-label="Refresh Polymarket embeds"
                  style={{
                    border: "1px solid var(--border)",
                    background: "rgba(8, 17, 31, 0.6)",
                    color: "var(--text)",
                    borderRadius: 999,
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    padding: 0,
                    lineHeight: 1,
                    fontSize: 12,
                  }}
                >
                  <span className="glyphicon glyphicon-refresh" aria-hidden="true" />
                </button>
              </div>
              <span>{allIds.length} active</span>
            </div>
            <div className="polymarket-embed-grid">
              {allIds.map((market_id) => {
                const tick = marketLookup[market_id];
                const slug = tick?.slug ?? slugOverrides[market_id];
                if (!slug) {
                  return (
                    <div key={market_id} className="polymarket-embed-placeholder">
                      <div>{market_id}</div>
                      <small>Loading market data…</small>
                    </div>
                  );
                }
                const src = `https://embed.polymarket.com/market?market=${encodeURIComponent(slug)}&theme=dark&liveactivity=true&buttons=false&border=true&creator=0x43424Ed47ec4e4aC737534bea1DFd5d992B34732-1756591618869&height=300${embedReloadKey ? `&_r=${embedReloadKey}` : ""}`;
                const question = tick?.question ?? market_id;
                return (
                  <figure
                    key={market_id}
                    className="polymarket-embed"
                    id={`polymarket-${slug}`}
                    aria-label={`Polymarket prediction market: ${question}`}
                    itemScope
                    itemType="https://schema.org/WebPage"
                    style={{ position: "relative", display: "inline-block", margin: 0 }}
                  >
                    {/* buttons=false on the embed URL hides Polymarket's own
                        trade buttons (they showed stale prices); we render
                        our own read-only price row below. */}
                    <iframe
                      key={embedReloadKey}
                      title={`${question} — Polymarket Prediction Market`}
                      src={src}
                      width={400}
                      height={300}
                      style={{ border: "none", display: "block" }}
                      loading="lazy"
                    />
                    <a
                      href={`https://polymarket.com/event/${slug}`}
                      aria-label="View on Polymarket"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ position: "absolute", top: 16, right: 20, width: 120, height: 24, zIndex: 10 }}
                    />
                    <figcaption style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
                      <strong>{question}</strong>
                    </figcaption>
                    {/* Our own read-only Up/Down price row, sourced from the
                        latest daemon_tick. Prefer the midpoint; fall back to
                        the non-zero side of the book when one side is empty
                        (common near resolution — "ask_yes=0" means no sellers,
                        not a 0¢ price). */}
                    <div className="polymarket-price-row">
                      <span className="price-pill price-up" title="Daemon-reported YES price">
                        ▲ Up {formatCentsFromBook(tick?.mid_yes, tick?.bid_yes, tick?.ask_yes)}
                      </span>
                      <span className="price-pill price-down" title="Daemon-reported NO price">
                        ▼ Down {formatCentsFromBook(tick?.mid_no, tick?.bid_no, tick?.ask_no)}
                      </span>
                    </div>
                  </figure>
                );
              })}
            </div>
          </article>
        );
      })()}

      <article className="panel full-span">
        <div className="panel-header">
          <h2>Open Positions</h2>
          <span>{visibleOpenPositions.length} currently held</span>
        </div>
        {visibleOpenPositions.length === 0 ? (
          <div className="empty-state">No open positions.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>Unrealized PnL</th>
                  <th>Trail Stop</th>
                  <th>Opened</th>
                  <th>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {visibleOpenPositions.map((position) => {
                  const tick = marketLookup[position.market_id];
                  const mark = currentTokenPrice(tick, position.side);
                  let unrealizedCell: ReactNode;
                  if (mark !== null && position.entry_price > 0) {
                    const shares = position.size_usd / position.entry_price;
                    const pnl = (mark - position.entry_price) * shares;
                    const pct = (mark - position.entry_price) / position.entry_price;
                    const cls = pnl >= 0 ? "positive" : "negative";
                    const sign = pnl >= 0 ? "+" : "";
                    unrealizedCell = (
                      <span className={cls}>
                        {sign}{formatMoney(pnl)} ({sign}{(pct * 100).toFixed(1)}%)
                      </span>
                    );
                  } else {
                    unrealizedCell = <span style={{ color: "var(--muted)" }}>—</span>;
                  }
                  // Live trailing-stop level: max(peak × (1 - trail_pct), entry)
                  // once armed (peak ≥ entry × (1 + arm_pct)). Entry floor mirrors
                  // the daemon so a freshly-armed trail can't fire at a loss.
                  let trailCell: ReactNode = <span style={{ color: "var(--muted)" }}>—</span>;
                  const positionStrategy = position.strategy_id ?? "fade";
                  // Prefer the nested per-(strategy, market) lookup; fall back
                  // to the legacy flat dict if the daemon is older.
                  const extras =
                    positionExtras[positionStrategy]?.[position.market_id]
                    ?? positionExtrasFlat[position.market_id];
                  if (trailPct > 0 && extras && extras.peak_price && position.entry_price > 0) {
                    const peak = extras.peak_price;
                    const armThreshold = position.entry_price * (1 + trailArmPct);
                    const armed = peak >= armThreshold;
                    if (armed) {
                      const trailLevel = Math.max(peak * (1 - trailPct), position.entry_price);
                      const trailPctFromEntry = (trailLevel - position.entry_price) / position.entry_price;
                      const cls = trailPctFromEntry >= 0 ? "positive" : "negative";
                      const sign = trailPctFromEntry >= 0 ? "+" : "";
                      trailCell = (
                        <span className={cls} title={`Peak ${peak.toFixed(4)} · armed at ${armThreshold.toFixed(4)}`}>
                          {trailLevel.toFixed(4)} ({sign}{(trailPctFromEntry * 100).toFixed(1)}%)
                        </span>
                      );
                    } else {
                      trailCell = (
                        <span style={{ color: "var(--muted)", fontSize: "12px" }} title={`Peak ${peak.toFixed(4)} · arms at ${armThreshold.toFixed(4)}`}>
                          N/A
                        </span>
                      );
                    }
                  }
                  const strategyId = position.strategy_id ?? "fade";
                  return (
                    <tr key={position.order_id || `${position.market_id}-${position.opened_at}`}>
                      <td><span className={`strategy-badge strategy-${strategyId}`}>{strategyId}</span></td>
                      <td><MarketCell marketId={position.market_id} lookup={marketLookup} timezone={timezone} timeFormat={timeFormat} /></td>
                      <td className={position.side === "YES" ? "positive" : position.side === "NO" ? "negative" : ""}>{position.side}</td>
                      <td>{formatMoney(position.size_usd)}</td>
                      <td>{position.entry_price.toFixed(4)}</td>
                      <td>{mark !== null ? mark.toFixed(4) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>{unrealizedCell}</td>
                      <td>{trailCell}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted)" }}>{formatInstant(position.opened_at, timezone, timeFormat, "time")}</td>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }}>{position.order_id || "n/a"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="panel full-span">
        <div className="panel-header">
          <h2>Closed Positions</h2>
          <span>Latest realized trades</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trade ID</th>
                <th>Strategy</th>
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>PnL</th>
                <th>Fees</th>
                <th>Cumulative</th>
                <th>Opened</th>
                <th>Closed</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Build base + tranche labels once per render from the full
                // list so T1/T2 ordering is chronological regardless of the
                // reversed display order.
                const tradeIdMap = buildTradeIdMap(visibleClosedPositions.map((p) => p.order_id));
                return [...visibleClosedPositions].reverse().map((position) => {
                  const pnlPct = position.size_usd > 0 ? (position.realized_pnl / position.size_usd) : 0;
                  const pnlCls = position.realized_pnl >= 0 ? "positive" : "negative";
                  const sign = position.realized_pnl >= 0 ? "+" : "";
                  const compactId = tradeIdMap[position.order_id] || position.order_id || "n/a";
                  const strategyId = position.strategy_id ?? "fade";
                  return (
                    <tr key={position.order_id || `${position.market_id}-${position.closed_at}`}>
                      <td
                        style={{ fontSize: "12px", color: "var(--accent)", cursor: position.order_id ? "pointer" : "default", textDecoration: position.order_id ? "underline" : "none" }}
                        title={position.order_id ? `Click to view full timeline\n${position.order_id}` : ""}
                        onClick={() => { if (position.order_id) setTimelineOrderId(position.order_id); }}
                      >
                        {compactId}
                      </td>
                      <td><span className={`strategy-badge strategy-${strategyId}`}>{strategyId}</span></td>
                      <td><MarketCell marketId={position.market_id} lookup={marketLookup} timezone={timezone} timeFormat={timeFormat} /></td>
                      <td>{position.side}</td>
                      <td>{formatMoney(position.size_usd)}</td>
                      <td className={pnlCls}>
                        {sign}{formatMoney(position.realized_pnl)} ({sign}{(pnlPct * 100).toFixed(1)}%)
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {position.fees_paid > 0 ? formatMoney(position.fees_paid) : "—"}
                      </td>
                      <td>{formatMoney(position.cumulative_pnl)}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted)" }}>
                        {formatInstant(position.opened_at, timezone, timeFormat, "datetime")}
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted)" }}>
                        {formatInstant(position.closed_at, timezone, timeFormat, "datetime")}
                      </td>
                      <td>{position.close_reason}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
          {!visibleClosedPositions.length && <div className="empty-state">No closed positions yet.</div>}
        </div>
      </article>
      {timelineOrderId && (
        <TradeTimelineModal orderId={timelineOrderId} onClose={() => setTimelineOrderId(null)} />
      )}
    </section>
  );
}

function EventsPage({ events, report }: { events: RecentEvent[]; report: ReportPayload | null }) {
  const { timezone, timeFormat } = useDisplayPrefs();
  const visibleEvents = events.length ? events : [];
  return (
    <section className="grid detail-grid">
      <article className="panel">
        <div className="panel-header">
          <h2>Streamed Events</h2>
          <span>{visibleEvents.length} items</span>
        </div>
        <ul className="event-list">
          {visibleEvents.map((item, index) => (
            <EventEntry
              key={`${item.logged_at}-${index}`}
              title={item.event_type}
              timestamp={formatInstant(item.logged_at, timezone, timeFormat, "datetime")}
              content={JSON.stringify(item.payload, null, 2)}
            />
          ))}
        </ul>
      </article>

      <article className="panel">
        <div className="panel-header">
          <h2>Operator Report</h2>
          <span>{report?.summary || "n/a"}</span>
        </div>
        <ul className="event-list">
          {(report?.items ?? []).slice(0, 12).map((item, index) => (
            <EventEntry
              key={`${report?.session_id ?? "report"}-${index}`}
              title="report_item"
              timestamp={formatInstant(report?.generated_at, timezone, timeFormat, "datetime")}
              content={item}
            />
          ))}
        </ul>
      </article>
    </section>
  );
}

// Render a 0..1 Polymarket implied probability as cents (e.g. 0.5850 → "58.5¢").
// Sub-cent values use one decimal too so 0.0005 → "0.1¢" instead of "0.0¢".
function formatCents(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  const cents = price * 100;
  // Avoid the awkward "100.0¢" when we're effectively at full resolution.
  if (cents >= 99.95) return "100¢";
  return `${cents.toFixed(1)}¢`;
}

// Days-to-resolution helper. Returns:
//   { days, label, tier }
//   tier ∈ "past" | "today" | "soon" (< 7d) | "near" (< 30d) | "far"
// "soon" is the threshold for the horizon-risk warning — the framework's
// 96% backtest hit rate was on events with multiple weeks between snapshot
// and resolution. Sub-week events have already absorbed most of the
// smart-money signal into the live YES price, so the asymmetric edge is
// largely gone even when the conviction tier looks green.
type HorizonTier = "past" | "today" | "soon" | "near" | "far";
function daysToResolution(endDate: string | null | undefined): { days: number; label: string; tier: HorizonTier } {
  if (!endDate) return { days: NaN, label: "—", tier: "far" };
  const ms = Date.parse(endDate);
  if (!Number.isFinite(ms)) return { days: NaN, label: "—", tier: "far" };
  const diff = ms - Date.now();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < -0.5) {
    return { days, label: `ended ${Math.abs(Math.round(days))}d ago`, tier: "past" };
  }
  if (days < 1) {
    const hours = Math.max(0, Math.round(diff / (1000 * 60 * 60)));
    return { days, label: hours <= 1 ? "<1h left" : `${hours}h left`, tier: "today" };
  }
  if (days < 7) return { days, label: `${Math.round(days)}d left`, tier: "soon" };
  if (days < 30) return { days, label: `${Math.round(days)}d left`, tier: "near" };
  return { days, label: `${Math.round(days)}d left`, tier: "far" };
}

function BookDepthPanel({
  bookEntry,
  sizeUsd,
  onChangeSize,
  onRefresh,
}: {
  bookEntry: BookCacheEntry | undefined;
  sizeUsd: number;
  onChangeSize: (n: number) => void;
  onRefresh: () => void;
}) {
  if (!bookEntry || bookEntry.loading) {
    return <div className="muted" style={{ padding: "0.5em" }}>Fetching live order book…</div>;
  }
  if (bookEntry.error) {
    return <div className="banner error">Book error: {bookEntry.error}</div>;
  }
  const book = bookEntry.data;
  if (!book) return null;
  if (book.error) {
    return <div className="banner error">Polymarket CLOB error: {book.error}</div>;
  }
  if (book.bids.length === 0 && book.asks.length === 0) {
    return <div className="muted">No active book — this outcome may be resolved or untraded.</div>;
  }
  const est = book.estimate;
  // Slippage % from best ask. Useful "how much does my buy move the price?" read.
  const slippageBps = est && book.best_ask
    ? ((est.avg_price - book.best_ask) / book.best_ask) * 10000
    : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1em" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75em", marginBottom: "0.5em", flexWrap: "wrap" }}>
          <strong>Order book</strong>
          <span className="muted" style={{ fontSize: "0.85em" }}>
            best bid {book.best_bid != null ? formatCents(book.best_bid) : "—"}
            {" · "}best ask {book.best_ask != null ? formatCents(book.best_ask) : "—"}
            {book.spread != null ? ` · spread ${(book.spread * 100).toFixed(2)}¢` : ""}
          </span>
          <button type="button" className="refresh-button"
                  style={{ padding: "0.15em 0.6em", fontSize: "0.85em" }}
                  onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <table style={{ width: "100%", fontSize: "0.9em" }}>
          <thead>
            <tr className="muted">
              <th style={{ textAlign: "right" }}>Bid</th>
              <th style={{ textAlign: "right" }}>Size</th>
              <th style={{ textAlign: "right" }}>Cum $ (sell-out)</th>
              <th style={{ width: "1em" }}></th>
              <th style={{ textAlign: "right" }}>Ask</th>
              <th style={{ textAlign: "right" }}>Size</th>
              <th style={{ textAlign: "right" }}>Cum $ (buy-in)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(book.bids.length, book.asks.length, 1) }).map((_, i) => {
              const b = book.bids[i];
              const a = book.asks[i];
              return (
                <tr key={i}>
                  <td style={{ textAlign: "right", color: "var(--positive, #2a8a3e)" }}>
                    {b ? formatCents(b.price) : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>{b ? b.size.toFixed(0) : ""}</td>
                  <td style={{ textAlign: "right" }}>{b ? `$${b.cum_usd.toFixed(0)}` : ""}</td>
                  <td></td>
                  <td style={{ textAlign: "right", color: "var(--negative, #c0392b)" }}>
                    {a ? formatCents(a.price) : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>{a ? a.size.toFixed(0) : ""}</td>
                  <td style={{ textAlign: "right" }}>{a ? `$${a.cum_usd.toFixed(0)}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5em", marginBottom: "0.5em", flexWrap: "wrap" }}>
          <strong>Mirror sizing</strong>
          <label style={{ fontSize: "0.85em", display: "flex", alignItems: "center", gap: "0.4em" }}>
            Buy $
            <input
              type="number"
              value={sizeUsd}
              min={1}
              step={10}
              style={{ width: "5em" }}
              onChange={(e) => onChangeSize(Number(e.target.value) || 0)}
            />
            of YES
          </label>
        </div>
        {est && est.fully_filled ? (
          <div style={{ padding: "0.5em 0", fontSize: "0.95em" }}>
            <div>
              Buys at avg <strong>{formatCents(est.avg_price)}</strong>, worst fill {formatCents(est.max_price)} →
              <strong> {est.filled_shares.toFixed(1)} shares</strong>
            </div>
            <div className="muted" style={{ fontSize: "0.85em" }}>
              Slippage vs best ask: <strong>{slippageBps >= 0 ? "+" : ""}{slippageBps.toFixed(0)} bps</strong>
              {" · "}If outcome wins → payout ${est.filled_shares.toFixed(0)} ({(est.filled_shares / Math.max(est.filled_usd, 0.01)).toFixed(2)}× cost)
            </div>
            <div style={{ fontSize: "0.85em", marginTop: "0.5em" }}>
              <span style={{ color: slippageBps < 50 ? "var(--positive, #2a8a3e)" : slippageBps < 200 ? "var(--muted)" : "var(--negative, #c0392b)" }}>
                {slippageBps < 50 ? "✓ Negligible slippage — safe size" : slippageBps < 200 ? "⚠ Mild slippage — acceptable" : "✗ Book too thin for this size — reduce"}
              </span>
            </div>
          </div>
        ) : est ? (
          <div className="banner error" style={{ marginTop: "0.5em" }}>
            Book exhausts before filling ${sizeUsd}. Only ${est.filled_usd.toFixed(0)} fillable
            ({est.filled_shares.toFixed(1)} shares at avg {formatCents(est.avg_price)}).
            <span className="muted"> Reduce size or accept partial fill.</span>
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: "0.8em", marginTop: "0.75em" }}>
          Ask depth shown: <strong>${book.ask_depth_usd_top_n.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> in top-10 levels.
          {" "}A safe mirror is roughly ≤5% of that without moving the price.
        </div>
      </div>
    </div>
  );
}

function EventSmartMoneyPage() {
  const [archive, setArchive] = useState<EventSnapshotArchive | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading] = useState<boolean>(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [customSlug, setCustomSlug] = useState<string>("");
  const [detail, setDetail] = useState<EventSmartMoneyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [minPositionUsd, setMinPositionUsd] = useState<number>(2000);
  const [minAvgPrice, setMinAvgPrice] = useState<number>(0.01);

  const refreshArchive = async () => {
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const data = await fetchJson<EventSnapshotArchive>("/api/event-smart-money");
      setArchive(data);
    } catch (exc) {
      setArchiveError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setArchiveLoading(false);
    }
  };

  useEffect(() => {
    void refreshArchive();
  }, []);

  const loadDetail = async (slug: string) => {
    setSelectedSlug(slug);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const qs = new URLSearchParams({
        min_position_usd: String(minPositionUsd),
        min_avg_price: String(minAvgPrice),
      });
      const data = await fetchJson<EventSmartMoneyDetail>(
        `/api/event-smart-money/${encodeURIComponent(slug)}?${qs}`,
      );
      setDetail(data);
    } catch (exc) {
      setDetailError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCustomAnalyze = () => {
    const slug = customSlug.trim();
    if (!slug) {
      return;
    }
    void loadDetail(slug);
  };

  type SortKey = "end_date" | "avg_paid" | "invested" | "current_yes" | "conviction";
  const [sortKey, setSortKey] = useState<SortKey>("end_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onSortClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column: descending for numbers (biggest
      // conviction / dollars / YES first), ascending for end_date so it
      // matches the original "closest to resolution first" feel.
      setSortDir(key === "end_date" ? "asc" : "desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <span className="muted" style={{ marginLeft: "0.25em", opacity: 0.45 }}>↕</span>;
    }
    return <span style={{ marginLeft: "0.25em" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  // Opportunity tier shading. Past events are GREY (no longer actionable).
  // For future events:
  //   GREEN  = best coming opportunities (cheap entry, real conviction, room to run)
  //   YELLOW = decent setups (real money but already partially priced or thinner)
  //   RED    = poor / dead signals (smart money lost, or near full resolution)
  type OppTier = "past" | "green" | "yellow" | "red" | "none";
  const NOW_MS = Date.now();
  const tierOf = (row: EventSnapshotRow): OppTier => {
    const end = row.end_date ? Date.parse(row.end_date) : NaN;
    if (Number.isFinite(end) && end < NOW_MS) return "past";
    const top = row.top10?.[0];
    if (!top) return "none";
    const cy = top.current_yes_price;
    const avg = top.yes_avg_price;
    const inv = top.yes_total_size_usd;
    const holders = top.yes_holders_count;
    // Dead signals first.
    if (cy <= 0.02) return "red";              // smart money lost
    if (cy >= 0.97) return "red";              // already fully resolved, no upside
    if (holders < 5) return "red";             // thin signal
    if (inv < 25_000) return "red";            // too little real money
    // Green: meaningful money, market hasn't fully rerated (room to grow),
    // and entry price wasn't a lottery ticket nor already expensive.
    const roomToResolve = 1.0 - cy;
    if (
      inv >= 100_000 &&
      holders >= 10 &&
      avg >= 0.05 && avg <= 0.50 &&
      roomToResolve >= 0.25 &&
      cy >= avg * 0.8   // market hasn't fully puked on the position
    ) return "green";
    return "yellow";
  };

  const tierStyle = (tier: OppTier): CSSProperties => {
    switch (tier) {
      case "past":
        return { opacity: 0.45, backgroundColor: "rgba(128,128,128,0.05)" };
      case "green":
        return { boxShadow: "inset 4px 0 0 0 #2a8a3e", backgroundColor: "rgba(42,138,62,0.06)" };
      case "yellow":
        return { boxShadow: "inset 4px 0 0 0 #c69026", backgroundColor: "rgba(198,144,38,0.05)" };
      case "red":
        return { boxShadow: "inset 4px 0 0 0 #c0392b", backgroundColor: "rgba(192,57,43,0.04)" };
      default:
        return {};
    }
  };

  // Per-outcome book-depth lookup. One outcome expanded at a time.
  const [expandedTokenId, setExpandedTokenId] = useState<string | null>(null);
  const [bookSizeUsd, setBookSizeUsd] = useState<number>(50);
  const [bookCache, setBookCache] = useState<Record<string, BookCacheEntry>>({});

  const loadBook = async (tokenId: string, sizeUsd: number) => {
    const key = `${tokenId}|${sizeUsd}`;
    setBookCache((prev) => ({ ...prev, [key]: { loading: true } }));
    try {
      const data = await fetchJson<BookPayload>(
        `/api/event-smart-money-book/${encodeURIComponent(tokenId)}?target_usd=${sizeUsd}`,
      );
      setBookCache((prev) => ({ ...prev, [key]: { loading: false, data } }));
    } catch (exc) {
      setBookCache((prev) => ({
        ...prev,
        [key]: { loading: false, error: exc instanceof Error ? exc.message : String(exc) },
      }));
    }
  };

  const toggleBook = (tokenId: string | null) => {
    if (!tokenId) return;
    if (expandedTokenId === tokenId) {
      setExpandedTokenId(null);
      return;
    }
    setExpandedTokenId(tokenId);
    const key = `${tokenId}|${bookSizeUsd}`;
    if (!bookCache[key]) {
      void loadBook(tokenId, bookSizeUsd);
    }
  };

  // Re-fetch the expanded row when the size knob changes.
  useEffect(() => {
    if (!expandedTokenId) return;
    const key = `${expandedTokenId}|${bookSizeUsd}`;
    if (!bookCache[key]) {
      void loadBook(expandedTokenId, bookSizeUsd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTokenId, bookSizeUsd]);

  // Per-outcome "penny opportunity" tier for the detail panel. Different
  // thresholds than the top-1 watchlist tiering — for individual outcomes
  // we care most about: low current price (cheap entry), real smart money
  // behind it (not zero conviction), and smart money still in profit or
  // close to it (so we're not catching a falling knife).
  type OutcomeTier = "green" | "yellow" | "red" | "none";
  const [pennyOnly, setPennyOnly] = useState<boolean>(false);

  const outcomeTier = (sig: EventSmartMoneyRanked): OutcomeTier => {
    const cy = sig.current_yes_price;
    const avg = sig.yes_avg_price;
    const inv = sig.yes_total_size_usd;
    const holders = sig.yes_holders_count;
    // Dead / no signal first.
    if (cy <= 0.01) return "red";          // outcome is essentially eliminated
    if (cy >= 0.97) return "red";          // already resolved (no upside left)
    if (holders < 3 || inv < 5_000) return "none";  // not enough signal to opine
    // Penny-opportunity GREEN: cheap current entry, real money behind it,
    // smart money hasn't bled out (current_yes close to or above avg paid).
    const cheap = cy <= 0.25;
    const meaningful = inv >= 20_000 && holders >= 5 && avg >= 0.02;
    const notFalling = cy >= avg * 0.7;   // smart money down ≤30% is acceptable
    if (cheap && meaningful && notFalling) return "green";
    // YELLOW: real money present but missing one criterion (a bit pricier,
    // a bit thinner, or smart money slightly underwater).
    if (inv >= 10_000 && holders >= 3 && cy <= 0.40) return "yellow";
    return "none";
  };

  const outcomeTierStyle = (tier: OutcomeTier): CSSProperties => {
    switch (tier) {
      case "green":
        return { boxShadow: "inset 4px 0 0 0 #2a8a3e", backgroundColor: "rgba(42,138,62,0.06)" };
      case "yellow":
        return { boxShadow: "inset 4px 0 0 0 #c69026", backgroundColor: "rgba(198,144,38,0.05)" };
      case "red":
        return { boxShadow: "inset 4px 0 0 0 #c0392b", backgroundColor: "rgba(192,57,43,0.04)" };
      default:
        return {};
    }
  };

  const snapshots = useMemo(() => {
    const rows = archive?.snapshots ?? [];
    const dir = sortDir === "asc" ? 1 : -1;
    const pickVal = (r: EventSnapshotRow): number | string => {
      const top = r.top10?.[0];
      switch (sortKey) {
        case "end_date":
          return r.end_date || "";
        case "avg_paid":
          return top?.yes_avg_price ?? -Infinity;
        case "invested":
          return top?.yes_total_size_usd ?? -Infinity;
        case "current_yes":
          return top?.current_yes_price ?? -Infinity;
        case "conviction":
          return top?.conviction ?? -Infinity;
        default:
          return 0;
      }
    };
    return [...rows].sort((a, b) => {
      const va = pickVal(a);
      const vb = pickVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [archive, sortKey, sortDir]);

  return (
    <section className="page-section">
      <article className="card">
        <header className="card-header">
          <div>
            <h2 style={{ margin: 0 }}>Event Smart-Money Signals</h2>
            <p className="muted" style={{ marginTop: "0.25em", marginBottom: 0, fontSize: "0.9em" }}>
              Conviction-ranked outcomes across multi-outcome Polymarket events.
              Top-1 hit the actual winner in <strong>26/27</strong> resolved historical events (<strong>+154.9% ROI</strong> validation).
              Daily cron at 07:00 IDT appends to <code>scripts/_event_smart_money_snapshots.jsonl</code>.
            </p>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1em", marginTop: "1em" }}>
          {/* Left column: filter knobs */}
          <fieldset style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "0.75em 1em" }}>
            <legend style={{ padding: "0 0.5em", fontSize: "0.85em" }} className="muted">
              Conviction filters
            </legend>
            <div style={{ display: "flex", gap: "1em", alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="form-label" style={{ flex: "1 1 140px" }}>
                Min position ($)
                <input
                  type="number"
                  value={minPositionUsd}
                  min={0}
                  step={100}
                  onChange={(e) => setMinPositionUsd(Number(e.target.value) || 0)}
                />
              </label>
              <label className="form-label" style={{ flex: "1 1 140px" }}>
                Min avg price (¢ filter)
                <input
                  type="number"
                  value={minAvgPrice}
                  min={0}
                  max={1}
                  step={0.001}
                  onChange={(e) => setMinAvgPrice(Number(e.target.value) || 0)}
                />
              </label>
            </div>
            <div className="muted" style={{ fontSize: "0.8em", marginTop: "0.5em" }}>
              Applies to the detail panel below and custom-slug analyses. Higher values drop noise.
            </div>
          </fieldset>

          {/* Right column: analyze any event */}
          <fieldset style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "0.75em 1em" }}>
            <legend style={{ padding: "0 0.5em", fontSize: "0.85em" }} className="muted">
              Analyze any event
            </legend>
            <div style={{ display: "flex", gap: "0.5em", alignItems: "flex-end" }}>
              <label className="form-label" style={{ flex: 1 }}>
                Polymarket event slug
                <input
                  type="text"
                  value={customSlug}
                  placeholder="e.g. eurovision-winner-2026"
                  onChange={(e) => setCustomSlug(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCustomAnalyze();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="refresh-button"
                onClick={handleCustomAnalyze}
                disabled={!customSlug.trim()}
              >
                Analyze
              </button>
            </div>
            <div className="muted" style={{ fontSize: "0.8em", marginTop: "0.5em" }}>
              Hits the live API (5–30s). Cached server-side for 5 min per (slug, filter).
            </div>
          </fieldset>
        </div>
      </article>

      <article className="card">
        <header className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1em", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Watchlist · {snapshots.length} events</h2>
            {archive && (
              <span className="muted" style={{ fontSize: "0.85em" }}>
                {archive.total_records} total snapshot rows in archive
              </span>
            )}
          </div>
          <button type="button" className="refresh-button" onClick={() => void refreshArchive()}>
            Refresh
          </button>
        </header>
        <div className="muted" style={{ fontSize: "0.85em", marginBottom: "0.75em", display: "flex", gap: "1em", flexWrap: "wrap" }}>
          <span style={{ borderLeft: "4px solid #2a8a3e", paddingLeft: "0.5em" }}>
            <strong>Green</strong> — best coming opportunity (≥$100K invested, ≥10 holders, 5–50¢ entry, room to resolve)
          </span>
          <span style={{ borderLeft: "4px solid #c69026", paddingLeft: "0.5em" }}>
            <strong>Yellow</strong> — decent setup (real money but already priced or thinner)
          </span>
          <span style={{ borderLeft: "4px solid #c0392b", paddingLeft: "0.5em" }}>
            <strong>Red</strong> — dead signal (smart money lost, near-resolved, or thin holders)
          </span>
          <span style={{ opacity: 0.55 }}>
            <strong>Grey</strong> — event already ended (past)
          </span>
          <span style={{ color: "#c69026" }}>
            <strong>⚠ Horizon</strong> — ≤7d to resolution: framework edge largely captured by market
          </span>
        </div>
        {archiveError && <div className="banner error">{archiveError}</div>}
        {archiveLoading && <div className="muted">Loading watchlist…</div>}
        {!archiveLoading && snapshots.length === 0 && !archiveError && (
          <p className="muted">
            No snapshots yet. The cron job at 07:00 IDT writes one row per active event per day.
            Run <code>uv run python scripts/event_smart_money_forward_test.py --mode snapshot</code>{" "}
            to populate immediately.
          </p>
        )}
        {snapshots.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>End date</th>
                  <th>Horizon</th>
                  <th>Event</th>
                  <th>Top-1 pick</th>
                  <th
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onSortClick("avg_paid")}
                  >
                    Avg paid{sortIcon("avg_paid")}
                  </th>
                  <th
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onSortClick("invested")}
                  >
                    Invested ${sortIcon("invested")}
                  </th>
                  <th
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onSortClick("current_yes")}
                  >
                    Current YES{sortIcon("current_yes")}
                  </th>
                  <th
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onSortClick("conviction")}
                  >
                    Conviction{sortIcon("conviction")}
                  </th>
                  <th style={{ textAlign: "right" }}>Holders</th>
                  <th>Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((row) => {
                  const top = row.top10?.[0];
                  const isSelected = selectedSlug === row.slug;
                  const pickName = top ? (top.country ?? top.outcome ?? "—") : "—";
                  const tier = tierOf(row);
                  const rowStyle: CSSProperties = {
                    cursor: "pointer",
                    ...tierStyle(tier),
                  };
                  const polyUrl = `https://polymarket.com/event/${encodeURIComponent(row.slug)}`;
                  return (
                    <tr
                      key={row.slug}
                      className={isSelected ? "selected-row" : ""}
                      style={rowStyle}
                      onClick={() => void loadDetail(row.slug)}
                      title={
                        tier === "past" ? "Event ended — past opportunity (greyed)"
                        : tier === "green" ? "Best coming opportunity (real conviction, market hasn't fully rerated)"
                        : tier === "yellow" ? "Decent setup (partial conviction or already priced)"
                        : tier === "red" ? "Poor / dead signal (smart money lost, near-resolved, or thin)"
                        : "Insufficient signal"
                      }
                    >
                      <td>{(row.end_date ?? "").slice(0, 10) || "—"}</td>
                      <td>
                        {(() => {
                          const h = daysToResolution(row.end_date);
                          const color = h.tier === "past" ? "var(--muted, #999)"
                            : h.tier === "today" ? "var(--negative, #c0392b)"
                            : h.tier === "soon" ? "#c69026"
                            : h.tier === "near" ? "inherit"
                            : "var(--muted, #999)";
                          return (
                            <span style={{ color, fontSize: "0.9em" }}
                                  title={
                                    h.tier === "today" || h.tier === "soon"
                                      ? "Short-horizon event: smart-money signal is largely already priced in. The framework's 96% backtest was on multi-week events."
                                      : undefined
                                  }>
                              {h.tier === "soon" || h.tier === "today" ? "⚠ " : ""}{h.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <a
                          href={polyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "inherit", textDecoration: "underline" }}
                        >
                          {row.title}
                        </a>
                        <div className="muted" style={{ fontSize: "0.85em" }}>{row.slug}</div>
                      </td>
                      <td>{pickName}</td>
                      <td style={{ textAlign: "right" }}>
                        {top ? formatCents(top.yes_avg_price) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {top ? `$${top.yes_total_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {top ? formatCents(top.current_yes_price) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {top ? top.conviction.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {top ? top.yes_holders_count : "—"}
                      </td>
                      <td className="muted">{row.snapshot_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {selectedSlug && (
        <article className="card">
          <header className="card-header">
            <h2>Detail · {detail?.title ?? selectedSlug}</h2>
            <span className="muted">
              slug=<code>{selectedSlug}</code>
              {detail?.end_date ? ` · end=${detail.end_date.slice(0, 10)}` : ""}
              {detail?.end_date && (() => {
                const h = daysToResolution(detail.end_date);
                return h.tier !== "far" ? ` · ${h.label}` : "";
              })()}
              {detail ? ` · ${detail.n_outcomes} outcomes` : ""}
            </span>
          </header>
          {/* Horizon-risk warning for sub-week events. The framework's
              backtest validated +154.9% ROI on multi-week events where
              smart money positioned weeks before resolution. At ≤7 days,
              the live YES price has absorbed the conviction signal and
              the residual edge is small. ≤1 day is essentially gambling
              on the leaderboard. */}
          {detail?.end_date && (() => {
            const h = daysToResolution(detail.end_date);
            if (h.tier !== "soon" && h.tier !== "today") return null;
            const isToday = h.tier === "today";
            return (
              <div className="banner" style={{
                backgroundColor: isToday ? "rgba(192,57,43,0.12)" : "rgba(198,144,38,0.12)",
                borderLeft: `4px solid ${isToday ? "#c0392b" : "#c69026"}`,
                padding: "0.75em 1em",
                marginBottom: "1em",
              }}>
                <strong>{isToday ? "⚠ Sub-day horizon" : "⚠ Sub-week horizon"}</strong>
                {" — "}{h.label}. The framework's 96% backtest hit rate was on events resolving in 2–12 weeks, where smart money positioned before the market caught up. At this horizon the conviction signal is largely already priced into the live YES, so the asymmetric "ride to $1.00" edge is mostly captured.
                {isToday && " Single-day variance is high; consider abstaining or sizing materially smaller."}
              </div>
            );
          })()}
          {detailLoading && <div className="muted">Fetching live conviction signal (5–30s)…</div>}
          {detailError && <div className="banner error">{detailError}</div>}
          {detail && (
            <>
              {detail.ranked_outcomes.length === 0 && (
                <p className="muted">
                  No outcomes pass the filter at this min-position / min-avg-price combination.
                  Try lowering either threshold.
                </p>
              )}
              {detail.ranked_outcomes.length > 0 && (() => {
                const allRows = detail.ranked_outcomes.slice(0, 30);
                const visibleRows = pennyOnly
                  ? allRows.filter((sig) => {
                      const tier = outcomeTier(sig);
                      return tier === "green" || tier === "yellow";
                    })
                  : allRows;
                const greenCount = allRows.filter((s) => outcomeTier(s) === "green").length;
                const yellowCount = allRows.filter((s) => outcomeTier(s) === "yellow").length;
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1em", marginBottom: "0.5em", flexWrap: "wrap" }}>
                      <div className="muted" style={{ fontSize: "0.85em" }}>
                        <span style={{ borderLeft: "4px solid #2a8a3e", paddingLeft: "0.5em" }}>
                          <strong>{greenCount} green</strong> penny opportunities
                        </span>
                        <span style={{ marginLeft: "1em", borderLeft: "4px solid #c69026", paddingLeft: "0.5em" }}>
                          <strong>{yellowCount} yellow</strong> setups
                        </span>
                        <span style={{ marginLeft: "1em" }}>
                          (cheap entry ≤25¢, real smart money, not bleeding)
                        </span>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5em", fontSize: "0.9em", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={pennyOnly}
                          onChange={(e) => setPennyOnly(e.target.checked)}
                        />
                        Penny opportunities only
                      </label>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Outcome</th>
                            <th style={{ textAlign: "right" }}>Current YES</th>
                            <th style={{ textAlign: "right" }}>Holders</th>
                            <th style={{ textAlign: "right" }}>Avg paid</th>
                            <th style={{ textAlign: "right" }} title="Current $ committed by smart money — shares still held × avg price they paid. Replaces the old totalBought figure which inflated conviction with capital that's since been sold.">$ at risk</th>
                            <th style={{ textAlign: "right" }} title="Fraction of cumulative smart-money buying that's no longer in the position. High exit rate = signal is stale (smart money took profit and left).">Exit %</th>
                            <th style={{ textAlign: "right" }} title="If this outcome wins, payoff multiple = $1 / current YES. Higher = more asymmetric.">
                              Payoff×
                            </th>
                            <th style={{ textAlign: "right" }}>Total PnL</th>
                            <th style={{ textAlign: "right" }}>Conviction</th>
                            <th style={{ textAlign: "center" }} title="Order-book depth check before mirroring">Book</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((sig, idx) => {
                            const tier = outcomeTier(sig);
                            const payoffMult = sig.current_yes_price > 0 ? 1.0 / sig.current_yes_price : 0;
                            const tokenId = sig.yes_token_id;
                            const expanded = expandedTokenId !== null && expandedTokenId === tokenId;
                            const bookKey = tokenId ? `${tokenId}|${bookSizeUsd}` : "";
                            const bookEntry = bookKey ? bookCache[bookKey] : undefined;
                            return (
                              <Fragment key={sig.condition_id || sig.outcome}>
                                <tr style={outcomeTierStyle(tier)}
                                    title={
                                      tier === "green" ? "Penny opportunity: cheap entry + real smart money + signal still healthy"
                                      : tier === "yellow" ? "Borderline penny setup (priced-up or thinner)"
                                      : tier === "red" ? "Dead outcome (eliminated or already resolved)"
                                      : "Insufficient signal"
                                    }>
                                  <td>{detail.ranked_outcomes.indexOf(sig) + 1}</td>
                                  <td>
                                    <strong>{sig.outcome}</strong>
                                  </td>
                                  <td style={{ textAlign: "right" }}>{formatCents(sig.current_yes_price)}</td>
                                  <td style={{ textAlign: "right" }}>{sig.yes_holders_count}</td>
                                  <td style={{ textAlign: "right" }}>{formatCents(sig.yes_avg_price)}</td>
                                  <td style={{ textAlign: "right" }}>
                                    ${sig.yes_total_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    {sig.yes_total_bought_usd != null && sig.yes_total_bought_usd > sig.yes_total_size_usd * 1.1 && (
                                      <span className="muted" style={{ fontSize: "0.75em", marginLeft: "0.3em" }}
                                            title={`Smart money cumulatively bought $${sig.yes_total_bought_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} but currently holds only the $-at-risk shown`}>
                                        (of ${(sig.yes_total_bought_usd / 1000).toFixed(0)}K)
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    {sig.yes_exit_rate != null && sig.yes_exit_rate > 0 ? (
                                      <span style={{
                                        color: sig.yes_exit_rate >= 0.8 ? "var(--negative, #c0392b)"
                                          : sig.yes_exit_rate >= 0.5 ? "#c69026"
                                          : "inherit"
                                      }} title={
                                        sig.yes_exit_rate >= 0.8
                                          ? "Smart money has mostly exited — conviction signal is largely stale"
                                          : sig.yes_exit_rate >= 0.5
                                          ? "Smart money has scaled out materially — partial signal degradation"
                                          : "Smart money still mostly holding"
                                      }>
                                        {(sig.yes_exit_rate * 100).toFixed(0)}%
                                      </span>
                                    ) : "—"}
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    {payoffMult >= 100 ? "—" : `${payoffMult.toFixed(1)}×`}
                                  </td>
                                  <td style={{ textAlign: "right", color: sig.yes_total_pnl >= 0 ? "var(--positive, #2a8a3e)" : "var(--negative, #c0392b)" }}>
                                    {sig.yes_total_pnl >= 0 ? "+" : ""}${sig.yes_total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    {sig.smart_conviction.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </td>
                                  <td style={{ textAlign: "center" }}>
                                    {tokenId ? (
                                      <button
                                        type="button"
                                        className="refresh-button"
                                        style={{ padding: "0.15em 0.6em", fontSize: "0.85em" }}
                                        onClick={() => toggleBook(tokenId)}
                                        title="Show order-book depth"
                                      >
                                        {expanded ? "▾ Hide" : "▸ Show"}
                                      </button>
                                    ) : (
                                      <span className="muted">—</span>
                                    )}
                                  </td>
                                </tr>
                                {expanded && tokenId && (
                                  <tr style={{ backgroundColor: "rgba(255,255,255,0.02)" }}>
                                    <td colSpan={11} style={{ padding: "0.75em 1em" }}>
                                      <BookDepthPanel
                                        bookEntry={bookEntry}
                                        sizeUsd={bookSizeUsd}
                                        onChangeSize={setBookSizeUsd}
                                        onRefresh={() => void loadBook(tokenId, bookSizeUsd)}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {visibleRows.length === 0 && (
                            <tr>
                              <td colSpan={11} className="muted" style={{ textAlign: "center", padding: "1em" }}>
                                No penny opportunities at the current filters. Try lowering Min position $ or unchecking the filter.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
              {detail.top_3.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1.5em" }}>Top wallets in top-3 outcomes</h3>
                  {detail.top_3.map((sig) => (
                    <div key={`wallets-${sig.condition_id}`} style={{ marginBottom: "1em" }}>
                      <h4>
                        {sig.outcome} <span className="muted">(current YES {formatCents(sig.current_yes_price)})</span>
                      </h4>
                      {sig.yes_top_wallets.length === 0 ? (
                        <p className="muted">No filtered holders for this outcome.</p>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Wallet</th>
                                <th>Name</th>
                                <th style={{ textAlign: "right" }}>Avg paid</th>
                                <th style={{ textAlign: "right" }}>Bought $</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sig.yes_top_wallets.map((w) => (
                                <tr key={`${sig.condition_id}-${w.wallet}`}>
                                  <td>
                                    <code style={{ fontSize: "0.85em" }}>
                                      {w.wallet.slice(0, 8)}…{w.wallet.slice(-4)}
                                    </code>
                                  </td>
                                  <td>{w.name || <span className="muted">(anon)</span>}</td>
                                  <td style={{ textAlign: "right" }}>{formatCents(w.avg_price)}</td>
                                  <td style={{ textAlign: "right" }}>
                                    ${w.bought_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </article>
      )}
    </section>
  );
}

function LivePortfolioPage({
  liveOrders,
  liveTrades,
  livePositions,
}: {
  liveOrders: LiveOrder[];
  liveTrades: LiveTrade[];
  livePositions: LivePositionsPayload | null;
}) {
  const data = livePositions;
  const error = (livePositions as { error?: string } | null)?.error ?? null;

  const summary = data?.summary;
  const positions = useMemo(() => {
    // Sort by end-date descending so still-pending markets are at the top
    // and stale/resolved positions sink to the bottom (where they get
    // greyed out below).
    const rows = data?.positions ?? [];
    return [...rows].sort((a, b) => (b.end_date || "").localeCompare(a.end_date || ""));
  }, [data]);
  const openOrders = useMemo(() => {
    // CLOB `created_at` is a Unix-epoch string. Newest-posted first.
    const rows = liveOrders ?? [];
    return [...rows].sort((a, b) => {
      const ta = Number(a.created_at ?? 0);
      const tb = Number(b.created_at ?? 0);
      return tb - ta;
    });
  }, [liveOrders]);
  const NOW_MS = Date.now();
  let activeCount = 0;
  let settledCount = 0;
  for (const p of positions) {
    const endMs = p.end_date ? Date.parse(p.end_date) : NaN;
    if (Number.isFinite(endMs) && endMs < NOW_MS) settledCount++;
    else activeCount++;
  }

  // Net total P&L: unrealised (cash_pnl from currently-open) + settled
  // markets we haven't redeemed yet (locked-in loss/gain) + realised
  // from already-redeemed markets. The Polymarket UI seems to only show
  // unrealized; combining gives the operator the full picture.
  const settledUnredeemedPnl = summary?.settled_unredeemed_pnl_usd ?? 0;
  const settledUnredeemedCount = summary?.settled_unredeemed_count ?? 0;
  const lifetimePnl = summary
    ? summary.total_cash_pnl_usd + settledUnredeemedPnl + summary.closed_realized_pnl_usd
    : 0;

  return (
    <section className="page-section">
      <article className="card">
        <header className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1em", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Live Polymarket Portfolio</h2>
            <p className="muted" style={{ marginTop: "0.25em", marginBottom: 0, fontSize: "0.9em" }}>
              On-chain positions held by the configured funder wallet.
              Polled directly from <code>data-api.polymarket.com/positions</code> — independent of
              the engine's own paper/live order book.
              {data?.wallet && (
                <>
                  {" "}Wallet: <code>{data.wallet.slice(0, 8)}…{data.wallet.slice(-4)}</code>
                  {" "}<a href={`https://polygonscan.com/address/${data.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>↗</a>
                </>
              )}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3em" }}>
            <span className="muted" style={{ fontSize: "0.75em" }}>
              streamed · server cache 30s
            </span>
          </div>
        </header>

        {error && <div className="banner error" style={{ marginTop: "1em" }}>{error}</div>}
        {!data && <div className="muted" style={{ marginTop: "1em" }}>Waiting for first SSE push…</div>}

        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75em", marginTop: "1em" }}>
            <SummaryTile
              label="Open positions"
              value={settledCount > 0 ? `${activeCount} + ${settledCount} settled` : activeCount.toString()}
            />
            <SummaryTile label="Deployed cost" value={`$${summary.total_cost_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <SummaryTile label="Current value" value={`$${summary.total_current_value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <SummaryTile
              label="Unrealised P&L"
              value={`${summary.total_cash_pnl_usd >= 0 ? "+" : ""}$${summary.total_cash_pnl_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              tone={summary.total_cash_pnl_usd >= 0 ? "positive" : "negative"}
            />
            {settledUnredeemedCount > 0 && (
              <SummaryTile
                label={`Settled · unredeemed (${settledUnredeemedCount})`}
                value={`${settledUnredeemedPnl >= 0 ? "+" : ""}$${settledUnredeemedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                tone={settledUnredeemedPnl >= 0 ? "positive" : "negative"}
              />
            )}
            <SummaryTile
              label="Closed realised"
              value={`${summary.closed_realized_pnl_usd >= 0 ? "+" : ""}$${summary.closed_realized_pnl_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              tone={summary.closed_realized_pnl_usd >= 0 ? "positive" : "negative"}
            />
            <SummaryTile
              label="Lifetime P&L"
              value={`${lifetimePnl >= 0 ? "+" : ""}$${lifetimePnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              tone={lifetimePnl >= 0 ? "positive" : "negative"}
            />
          </div>
        )}
      </article>

      <article className="card">
        <header className="card-header">
          <h2>
            Open positions · {activeCount} active
            {settledCount > 0 && ` + ${settledCount} settled`}
          </h2>
          {positions.length > 0 && (
            <span className="muted" style={{ fontSize: "0.85em" }}>
              held YES/NO tokens with non-trivial size
              {settledCount > 0 && " · settled rows are greyed out (event ended, no longer actionable)"}
            </span>
          )}
        </header>
        {positions.length === 0 && data !== null && (
          <p className="muted">No open positions in this wallet.</p>
        )}
        {positions.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: "right" }}>Size</th>
                  <th style={{ textAlign: "right" }}>Avg paid</th>
                  <th style={{ textAlign: "right" }}>Current</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th style={{ textAlign: "right" }}>Value</th>
                  <th style={{ textAlign: "right" }}>P&L</th>
                  <th style={{ textAlign: "right" }}>% move</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pctMove = p.avg_price > 0
                    ? ((p.current_price - p.avg_price) / p.avg_price) * 100
                    : 0;
                  const pnlColor = p.cash_pnl_usd >= 0 ? "var(--positive, #2a8a3e)" : "var(--negative, #c0392b)";
                  const eventSlug = p.event_slug || p.slug;
                  const endMs = p.end_date ? Date.parse(p.end_date) : NaN;
                  const isPast = Number.isFinite(endMs) && endMs < NOW_MS;
                  const rowStyle: CSSProperties = isPast
                    ? { opacity: 0.45, backgroundColor: "rgba(128,128,128,0.05)" }
                    : {};
                  return (
                    <tr key={`${p.asset}-${p.outcome_index}`}
                        style={rowStyle}
                        title={isPast ? "Event ended — position is settled, no longer actionable" : undefined}>
                      <td>
                        {/* Primary: the option you actually bet on (team / candidate / direction).
                            Secondary: the underlying market question for context. */}
                        {(() => {
                          // Best-effort primary label. Backend enrichment provides
                          // option_title when available; fall back to the YES/NO outcome
                          // if the gamma /events lookup didn't surface a groupItemTitle.
                          const primary = (p.option_title && p.option_title.trim()) || p.outcome || "—";
                          const secondary = p.event_title || p.title || "";
                          const linkHref = eventSlug
                            ? `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`
                            : null;
                          return (
                            <>
                              <div style={{ fontWeight: 600 }}>
                                {linkHref ? (
                                  <a href={linkHref} target="_blank" rel="noopener noreferrer"
                                     style={{ color: "inherit", textDecoration: "underline" }}>
                                    {primary}
                                  </a>
                                ) : primary}
                              </div>
                              {secondary && secondary !== primary && (
                                <div className="muted" style={{ fontSize: "0.85em" }}>{secondary}</div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td>
                        <span className={`pill ${p.outcome_index === 0 ? "positive" : "negative"}`}
                              style={{ padding: "0.1em 0.5em", fontSize: "0.85em" }}>
                          {p.outcome}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{p.size.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td style={{ textAlign: "right" }}>{formatCents(p.avg_price)}</td>
                      <td style={{ textAlign: "right" }}>{formatCents(p.current_price)}</td>
                      <td style={{ textAlign: "right" }}>${p.cost_usd.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>${p.current_value_usd.toFixed(2)}</td>
                      <td style={{ textAlign: "right", color: pnlColor }}>
                        {p.cash_pnl_usd >= 0 ? "+" : ""}${p.cash_pnl_usd.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right", color: pnlColor }}>
                        {pctMove >= 0 ? "+" : ""}{pctMove.toFixed(1)}%
                      </td>
                      <td className="muted">{p.end_date ? p.end_date.slice(0, 10) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card">
        <header className="card-header">
          <h2>Resting open orders · {openOrders.length}</h2>
          {openOrders.length > 0 && (
            <span className="muted" style={{ fontSize: "0.85em" }}>
              live CLOB orders the operator wallet still has working · sorted newest-posted first
            </span>
          )}
        </header>
        {openOrders.length === 0 && (
          <p className="muted">No open orders on the CLOB right now.</p>
        )}
        {openOrders.some((o) => (o.size_matched ?? 0) > 0 && (o.size_matched ?? 0) < (o.size ?? 0)) && (
          <div className="muted" style={{ fontSize: "0.85em", marginBottom: "0.5em" }}>
            <span style={{ borderLeft: "4px solid #c69026", paddingLeft: "0.5em" }}>
              <strong>Yellow rows</strong> = order is partially filled (some shares executed, rest still resting at the limit price)
            </span>
          </div>
        )}
        {openOrders.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th style={{ textAlign: "right" }}>Size</th>
                  <th style={{ textAlign: "right" }}>Limit</th>
                  <th style={{ textAlign: "right" }}>Filled</th>
                  <th>Status</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => {
                  // Three-step enrichment lookup for orders:
                  //   1. Held position with matching asset_id  → use its option_title + event_title
                  //   2. condition_meta map (from /api/live/positions, covers any market
                  //      in the same event as a held position)
                  //   3. Last resort: truncated conditionId + token-id
                  const matchedPos = positions.find((p) => p.asset === o.asset_id);
                  const cidMeta = o.market_id ? data?.condition_meta?.[o.market_id] : undefined;
                  const optionTitle = matchedPos?.option_title || cidMeta?.option_title || "";
                  const eventTitle = matchedPos?.event_title || cidMeta?.event_title || matchedPos?.title || "";
                  // created_at is a Unix epoch string from the CLOB.
                  let postedDisplay = "—";
                  if (o.created_at) {
                    const ts = Number(o.created_at);
                    if (Number.isFinite(ts) && ts > 0) {
                      postedDisplay = new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ");
                    } else {
                      postedDisplay = o.created_at.slice(0, 19).replace("T", " ");
                    }
                  }
                  const size = o.size ?? 0;
                  const filled = o.size_matched ?? 0;
                  const pctFilled = size > 0 ? (filled / size) * 100 : 0;
                  const partialFilled = filled > 0 && filled < size;
                  const rowStyle: CSSProperties = partialFilled
                    ? { boxShadow: "inset 4px 0 0 0 #c69026", backgroundColor: "rgba(198,144,38,0.06)" }
                    : {};
                  return (
                    <tr key={o.order_id}
                        style={rowStyle}
                        title={partialFilled ? `Partially filled: ${filled.toFixed(2)} of ${size.toFixed(2)} shares (${pctFilled.toFixed(0)}%)` : undefined}>
                      <td>
                        {optionTitle ? (
                          <div style={{ fontWeight: 600 }}>{optionTitle}</div>
                        ) : (
                          <div className="muted" style={{ fontSize: "0.85em" }}>
                            <code>{(o.market_id ?? "").slice(0, 12)}…</code>
                          </div>
                        )}
                        {eventTitle && eventTitle !== optionTitle && (
                          <div className="muted" style={{ fontSize: "0.85em" }}>{eventTitle}</div>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${o.side === "BUY" ? "positive" : "negative"}`}
                              style={{ padding: "0.1em 0.5em", fontSize: "0.85em" }}>
                          {o.side ?? "—"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{(o.size ?? 0).toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>
                        {typeof o.price === "number" ? formatCents(o.price) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {filled.toFixed(2)}
                        {partialFilled && (
                          <span className="muted" style={{ fontSize: "0.8em", marginLeft: "0.3em" }}>
                            ({pctFilled.toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="muted">{o.status}</td>
                      <td className="muted">{postedDisplay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card">
        <header className="card-header">
          <h2>Recent fills · {liveTrades.length}</h2>
          {liveTrades.length > 0 && (
            <span className="muted" style={{ fontSize: "0.85em" }}>
              wallet-level CLOB fills · sorted newest first
            </span>
          )}
        </header>
        {liveTrades.length === 0 ? (
          <p className="muted">No recent fills on this wallet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th style={{ textAlign: "right" }}>Size</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                  <th style={{ textAlign: "right" }}>Value</th>
                  <th>Status</th>
                  <th>Filled</th>
                </tr>
              </thead>
              <tbody>
                {[...liveTrades]
                  .sort((a, b) => {
                    const ta = a.created_at ? Date.parse(a.created_at) || Number(a.created_at) * 1000 : 0;
                    const tb = b.created_at ? Date.parse(b.created_at) || Number(b.created_at) * 1000 : 0;
                    return tb - ta;
                  })
                  .map((t) => {
                    const matchedPos = positions.find((p) => p.asset === t.asset_id);
                    const cidMeta = t.market_id ? data?.condition_meta?.[t.market_id] : undefined;
                    const optionTitle = matchedPos?.option_title || cidMeta?.option_title || "";
                    const eventTitle = matchedPos?.event_title || cidMeta?.event_title || matchedPos?.title || "";
                    let filledDisplay = "—";
                    if (t.created_at) {
                      const epoch = Number(t.created_at);
                      const ts = Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.parse(t.created_at);
                      if (Number.isFinite(ts)) {
                        filledDisplay = new Date(ts).toISOString().slice(0, 19).replace("T", " ");
                      }
                    }
                    const size = typeof t.size === "number" ? t.size : 0;
                    const price = typeof t.price === "number" ? t.price : null;
                    const value = price !== null ? size * price : null;
                    const sideLabel = (t.side ?? "").toUpperCase();
                    const sideClass = sideLabel === "BUY" ? "positive" : sideLabel === "SELL" ? "negative" : "";
                    return (
                      <tr key={t.trade_id}>
                        <td>
                          {optionTitle ? (
                            <div style={{ fontWeight: 600 }}>{optionTitle}</div>
                          ) : (
                            <div className="muted" style={{ fontSize: "0.85em" }}>
                              <code>{(t.market_id ?? "").slice(0, 12)}…</code>
                            </div>
                          )}
                          {eventTitle && eventTitle !== optionTitle && (
                            <div className="muted" style={{ fontSize: "0.85em" }}>{eventTitle}</div>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${sideClass}`}
                                style={{ padding: "0.1em 0.5em", fontSize: "0.85em" }}>
                            {sideLabel || "—"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>{size.toFixed(2)}</td>
                        <td style={{ textAlign: "right" }}>
                          {price !== null ? `${(price * 100).toFixed(1)}¢` : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {value !== null ? formatMoney(value) : "—"}
                        </td>
                        <td className="muted">{t.status || "—"}</td>
                        <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "12px" }}>{filledDisplay}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "var(--positive, #2a8a3e)"
    : tone === "negative" ? "var(--negative, #c0392b)"
    : undefined;
  return (
    <div style={{
      padding: "0.6em 0.9em",
      borderRadius: 6,
      backgroundColor: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
    }}>
      <div className="muted" style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.2em", fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function SettingsPage({
  settings,
  onSettingsUpdated,
  onRefresh,
}: {
  settings: SettingsPayload | null;
  onSettingsUpdated: (settings: SettingsPayload) => void;
  onRefresh: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setValues(settings?.values ?? {});
  }, [settings]);

  if (!settings) {
    return <section className="panel"><div className="empty-state">Settings are loading.</div></section>;
  }

  const groupedKeys = Object.entries(settings.fields).reduce<Record<string, string[]>>((acc, [key, meta]) => {
    acc[meta.group] = [...(acc[meta.group] ?? []), key];
    return acc;
  }, {});

  const updateValue = (key: string, value: string | number | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = async () => {
    setSaveMessage("");
    try {
      const updated = await sendJson<SettingsPayload>("/api/settings", "PUT", { values });
      onSettingsUpdated(updated);
      setSaveMessage("Runtime settings saved.");
      await onRefresh();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Failed to save settings.");
    }
  };

  const renderField = (key: string) => {
    const meta = settings.fields[key];
    const value = values[key];
    const isOverridden = Object.prototype.hasOwnProperty.call(settings.overrides, key);
    if (meta.type === "boolean") {
      return (
        <label key={key} className="settings-field checkbox-field">
          <span>{meta.label}</span>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateValue(key, event.target.checked)}
          />
          <small>{isOverridden ? "runtime override" : "env/default"}</small>
        </label>
      );
    }
    if (meta.type === "select") {
      return (
        <label key={key} className="settings-field">
          <span>{meta.label}</span>
          <select value={String(value ?? "")} onChange={(event) => updateValue(key, event.target.value)}>
            {(meta.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <small>{isOverridden ? "runtime override" : "env/default"}</small>
        </label>
      );
    }
    return (
      <label key={key} className="settings-field">
        <span>{meta.label}</span>
        <input
          type={meta.type === "number" ? "number" : "text"}
          min={meta.min}
          max={meta.max}
          step={meta.step}
          value={String(value ?? "")}
          onChange={(event) =>
            updateValue(key, meta.type === "number" ? Number(event.target.value) : event.target.value)
          }
        />
        <small>{isOverridden ? "runtime override" : "env/default"}</small>
      </label>
    );
  };

  return (
    <section className="settings-stack">
      <DisplayPrefsPanel />
      <article className="panel">
        <div className="panel-header">
          <h2>Runtime Settings</h2>
          <span>{Object.keys(settings.fields).length} editable fields</span>
        </div>
        <div className="settings-groups">
          {Object.keys(groupedKeys).map((group) => (
            <section key={group} className="settings-group">
              <h3>{group}</h3>
              <div className="settings-grid">
                {(groupedKeys[group] ?? []).map(renderField)}
              </div>
            </section>
          ))}
        </div>
        <div className="settings-actions">
          <button type="button" className="refresh-button" onClick={() => void saveSettings()}>
            Save Settings
          </button>
          {saveMessage && <span className="inline-message">{saveMessage}</span>}
        </div>

        <div style={{ marginTop: "24px" }}>
          <div className="panel-header">
            <h2>Per-Family Risk Profiles (read-only)</h2>
            <span>From config defaults</span>
          </div>
          <div className="table-wrap">
            <table className="risk-table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Stale Data (s)</th>
                  <th>Exit Buffer % × Window</th>
                  <th>Max Concurrent</th>
                  <th>Exit Buffer Floor</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { family: "btc_1h",  stale_data_seconds: 5, exit_buffer_pct_of_tte: 0.05, max_concurrent_positions: 2, floor_seconds: 30, window: "3600s" },
                  { family: "btc_15m", stale_data_seconds: 3, exit_buffer_pct_of_tte: 0.07, max_concurrent_positions: 2, floor_seconds: 15, window: "900s" },
                  { family: "btc_5m",  stale_data_seconds: 2, exit_buffer_pct_of_tte: 0.10, max_concurrent_positions: 1, floor_seconds: 10, window: "300s" },
                ].map((row) => (
                  <tr key={row.family}>
                    <td><code>{row.family}</code></td>
                    <td>{row.stale_data_seconds}</td>
                    <td>{(row.exit_buffer_pct_of_tte * 100).toFixed(0)}% × {row.window} = {(row.exit_buffer_pct_of_tte * parseInt(row.window)).toFixed(0)}s</td>
                    <td>{row.max_concurrent_positions}</td>
                    <td>{row.floor_seconds}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>

    </section>
  );
}

function heartbeatAgeClass(age: number | null): string {
  if (age === null) return "pill blocked";
  if (age < 15) return "pill ready";
  if (age < 60) return "pill stream-connecting";
  return "pill blocked";
}

type InfoBarItem = { label: string; value: string | number; tone?: "muted" | "positive" | "negative" | "ready" | "blocked" };

type MarketLookup = Record<string, DaemonTickPayload>;

function buildMarketLookup(ticks: DaemonTickPayload[]): MarketLookup {
  // The API returns ticks newest-first per (strategy, market), so iterate
  // and KEEP the first entry seen for each market (= the freshest tick).
  // Last-write-wins would let an older tick from a different strategy on
  // the same market shadow the newest one — in particular a cold-start
  // penny tick with bid_yes=0 was clobbering live fade ticks and blanking
  // the Mark / Unrealized PnL cells on Open Positions.
  const lookup: MarketLookup = {};
  for (const tick of ticks) {
    if (!tick.market_id) continue;
    if (!(tick.market_id in lookup)) lookup[tick.market_id] = tick;
  }
  return lookup;
}

type MarketStrategyLookup = Record<string, Record<string, DaemonTickPayload>>;

/** Multi-strategy lookup keyed by market_id → strategy_id → latest tick.
 *  The daemon emits one daemon_tick per scorer per decision, and the
 *  global "last" tick (used by buildMarketLookup) collapses all three
 *  scorers into whichever fired last. The Last Signal panel needs the
 *  per-strategy breakdown so fade / adaptive / penny each get a row.
 *
 *  Ticks are processed in arrival order, so later ticks overwrite earlier
 *  ones for the same (market, strategy) pair. Missing strategy_id falls
 *  back to "fade" to match the daemon's default value on older rows.
 */
function buildMarketStrategyLookup(ticks: DaemonTickPayload[]): MarketStrategyLookup {
  const out: MarketStrategyLookup = {};
  for (const tick of ticks) {
    if (!tick.market_id) continue;
    const strategy = tick.strategy_id || "fade";
    if (!out[tick.market_id]) out[tick.market_id] = {};
    out[tick.market_id][strategy] = tick;
  }
  return out;
}

/** Realisable mark price in the position's own frame — the bid we could
 *  actually sell into right now, not the optimistic mid. Matches what the
 *  daemon uses for SL/TP/trail triggers, so the Mark + Unrealized PnL cells
 *  line up with the thresholds that will fire. Falls back to mid when bid
 *  isn't populated (cold-start book) and to the ask-derived complement for
 *  NO positions if no_book bid isn't in the tick payload.
 */
function currentTokenPrice(tick: DaemonTickPayload | undefined, side: string): number | null {
  if (!tick) return null;
  if (side === "YES") {
    if (typeof tick.bid_yes === "number" && tick.bid_yes > 0) return tick.bid_yes;
    if (typeof tick.mid_yes === "number" && tick.mid_yes > 0) return tick.mid_yes;
    return null;
  }
  // NO side: prefer direct NO bid, then NO mid, then 1 - YES ask.
  if (typeof tick.bid_no === "number" && tick.bid_no > 0) return tick.bid_no;
  if (typeof tick.mid_no === "number" && tick.mid_no > 0) return tick.mid_no;
  if (typeof tick.ask_yes === "number" && tick.ask_yes > 0) return 1 - tick.ask_yes;
  return null;
}

function MarketCell({
  marketId,
  lookup,
  timezone,
  timeFormat,
}: {
  marketId: string;
  lookup: MarketLookup;
  timezone: string;
  timeFormat: TimeFormat;
}) {
  const info = lookup[marketId];
  const slug = info?.slug;
  const href = slug ? `https://polymarket.com/event/${slug}` : undefined;
  const tooltipParts: string[] = [];
  if (info?.question) tooltipParts.push(info.question);
  if (info?.end_date_iso) tooltipParts.push(`Ends: ${formatEndTime(info.end_date_iso, timezone, timeFormat)}`);
  tooltipParts.push(`ID: ${marketId}`);
  const tooltip = tooltipParts.join("\n");
  if (!href) {
    return <span title={tooltip}>{marketId}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={tooltip}
      className="market-link"
    >
      {marketId}
    </a>
  );
}

function InfoBar({ heartbeat, items }: { heartbeat: DaemonHeartbeatPayload | null; items: InfoBarItem[] }) {
  const hb = heartbeat?.heartbeat ?? null;
  const age = heartbeat?.age_seconds ?? null;
  const { timezone, timeFormat } = useDisplayPrefs();
  const btcLastIso = btcLastUpdateIso(heartbeat);
  const btcTitle = btcLastIso ? `Last BTC tick: ${formatInstant(btcLastIso, timezone, timeFormat, "datetime")}` : "";
  return (
    <div className="info-bar">
      <span className="pill has-tooltip" data-tooltip={btcTitle} aria-label={btcTitle}>
        <span className="info-bar-label">BTC</span>
        {formatMoney(hb?.btc_last_price)}
      </span>
      {hb?.btc_session && (
        <span
          className="pill has-tooltip"
          data-tooltip={sessionTooltip(hb.btc_session, timezone, timeFormat)}
          aria-label={sessionTooltip(hb.btc_session, timezone, timeFormat)}
        >
          <span className="info-bar-label">Session</span>
          {hb.btc_session.toUpperCase()}
        </span>
      )}
      {heartbeat !== null && (
        <span className={heartbeatAgeClass(age)}>
          <span className="info-bar-label">HB</span>
          {age !== null ? `${age.toFixed(1)}s ago` : "absent"}
        </span>
      )}
      {items.map((item) => (
        <span key={item.label} className={item.tone ? `pill ${item.tone}` : "pill"}>
          <span className="info-bar-label">{item.label}</span>
          {item.value}
        </span>
      ))}
    </div>
  );
}

function DaemonView({ heartbeat, ticks }: { heartbeat: DaemonHeartbeatPayload | null; ticks: DaemonTickPayload[] }) {
  const hb = heartbeat?.heartbeat ?? null;
  const age = heartbeat?.age_seconds ?? null;
  const metrics = hb?.metrics ?? null;
  // `heartbeat === null` means we haven't received the first SSE payload yet;
  // don't render a scary "daemon not running" banner during that initial window.
  const heartbeatLoaded = heartbeat !== null;
  const daemonRunning = age !== null && age < 60;
  const showStaleBanner = heartbeatLoaded && !daemonRunning;
  const { timezone, timeFormat } = useDisplayPrefs();

  return (
    <>
      {showStaleBanner && (
        <div className="banner error">Daemon not running — heartbeat is absent or stale.</div>
      )}

      <div className="daemon-header">
        {(() => {
          const iso = btcLastUpdateIso(heartbeat);
          const tip = iso ? `Last BTC tick: ${formatInstant(iso, timezone, timeFormat, "datetime")}` : "";
          return (
            <span className="pill has-tooltip" data-tooltip={tip} aria-label={tip}>
              BTC: {formatMoney(hb?.btc_last_price)}
            </span>
          );
        })()}
        {hb?.btc_session && (
          <span
            className="pill has-tooltip"
            data-tooltip={sessionTooltip(hb.btc_session, timezone, timeFormat)}
            aria-label={sessionTooltip(hb.btc_session, timezone, timeFormat)}
          >
            Session: {hb.btc_session.toUpperCase()}
          </span>
        )}
        <span className={heartbeatAgeClass(age)}>
          Heartbeat: {age !== null ? `${age.toFixed(1)}s ago` : "absent"}
        </span>
        <span className={hb?.safety_stop_reason ? "pill blocked" : "pill ready"}>
          Safety stop: {hb?.safety_stop_reason ?? "None"}
        </span>
        <span className="pill">
          Active markets: {metrics?.active_market_count ?? 0}
        </span>
        <span className="pill">
          Family: {hb?.market_family ?? "n/a"}
        </span>
      </div>

      <div className="daemon-stat-grid">
        <article className="card">
          <h2>Polymarket Events</h2>
          <strong className="card-stat">{metrics?.polymarket_events?.toLocaleString() ?? "0"}</strong>
        </article>
        <article className="card">
          <h2>BTC Ticks</h2>
          <strong className="card-stat">{metrics?.btc_ticks?.toLocaleString() ?? "0"}</strong>
        </article>
        <article className="card">
          <h2>Decision Ticks</h2>
          <strong className="card-stat">{metrics?.decision_ticks?.toLocaleString() ?? "0"}</strong>
        </article>
        <article className="card">
          <h2>Last Latency</h2>
          <strong className={`card-stat${metrics?.last_decision_latency_ms != null && metrics.last_decision_latency_ms > 100 ? " danger" : ""}`}>
            {metrics?.last_decision_latency_ms != null ? `${metrics.last_decision_latency_ms.toFixed(2)} ms` : "n/a"}
          </strong>
        </article>
      </div>

      {ticks.length === 0 ? (
        <div className="empty-state">No daemon tick data — daemon may not be running or no markets are active.</div>
      ) : (
        <div className="daemon-market-grid">
          {[...ticks].sort((a, b) => (a.seconds_to_expiry ?? Infinity) - (b.seconds_to_expiry ?? Infinity)).map((tick) => {
            const fairYes = tick.fair_probability ?? 0;
            const fairNo = tick.fair_probability_no ?? (1 - fairYes);
            const sideClass =
              tick.suggested_side === "YES" ? "side-yes" :
              tick.suggested_side === "NO" ? "side-no" : "side-abstain";
            const expiryClass =
              tick.expiry_risk === "HIGH" ? "side-no" :
              tick.expiry_risk === "MEDIUM" ? "side-abstain" : "side-yes";
            return (
              <div key={tick.market_id} className="daemon-market-card">
                <div className="market-card-title">
                  {tick.question ? (tick.question.length > 55 ? `${tick.question.slice(0, 55)}...` : tick.question) : tick.market_id}
                </div>
                {tick.end_date_iso && (
                  <div className="market-card-endtime">
                    Ends: {formatEndTime(tick.end_date_iso, timezone, timeFormat)}
                  </div>
                )}
                <div className="market-card-meta">
                  <span>TTE: {formatDuration(tick.seconds_to_expiry)}</span>
                  <span>Bid: {tick.bid_yes?.toFixed(3) ?? "n/a"}</span>
                  <span>Ask: {tick.ask_yes?.toFixed(3) ?? "n/a"}</span>
                </div>

                <div className="market-card-prob">
                  <div className="market-card-prob-labels">
                    <span>YES {(fairYes * 100).toFixed(1)}%</span>
                    <span>NO {(fairNo * 100).toFixed(1)}%</span>
                  </div>
                  <div className="prob-bar">
                    <div style={{ width: `${fairYes * 100}%` }} />
                  </div>
                </div>

                <div className="market-card-edges">
                  <div>
                    Edge YES: <span className={tick.edge_yes > 0 ? "edge-positive" : "edge-negative"}>
                      {tick.edge_yes != null ? (tick.edge_yes * 100).toFixed(2) : "n/a"}%
                    </span>
                  </div>
                  <div>
                    Edge NO: <span className={tick.edge_no > 0 ? "edge-positive" : "edge-negative"}>
                      {tick.edge_no != null ? (tick.edge_no * 100).toFixed(2) : "n/a"}%
                    </span>
                  </div>
                </div>

                <div className="market-card-footer">
                  <span className={sideClass}>{tick.suggested_side}</span>
                  <span className="market-card-confidence">
                    Confidence: {tick.confidence != null ? `${(tick.confidence * 100).toFixed(0)}%` : "n/a"}
                  </span>
                  {tick.expiry_risk && (
                    <span className={expiryClass}>
                      {tick.expiry_risk} expiry risk
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>(getInitialView);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">("connecting");
  const [state, setState] = useState<DashboardState>({
    status: null,
    auth: null,
    settings: null,
    liveActivity: null,
    portfolioSummary: null,
    closedPositions: null,
    openPositions: null,
    equityCurve: null,
    report: null,
    recentEvents: [],
    recentDecisions: [],
    liveOrders: [],
    liveTrades: [],
    livePositions: null,
    daemonHeartbeat: null,
    daemonTicks: [],
    paperActivity: [],
    pendingMakers: [],
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onHashChange = () => setActiveView(getInitialView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Global instant-tooltip handler — intercepts every `title` attribute in
  // the app so tooltips appear on hover-enter (0 ms) instead of after the
  // browser's ~700 ms default. Approach:
  //   1. Capture mouseover on the document. Walk up from the target to
  //      find the nearest element with a `title` attribute.
  //   2. Render our own floating <div> at the element's edge with the
  //      title text. Remove the element's `title` so the browser doesn't
  //      ALSO render its delayed native tooltip on top of ours.
  //   3. Stash the original title in `data-instant-title` so we can put
  //      it back on mouseout (preserves accessibility for screen
  //      readers + maintains source-of-truth in the React tree on
  //      re-render).
  // This way no JSX site needs to change — every existing `title=` in
  // the codebase becomes instant.
  useEffect(() => {
    let tooltipEl: HTMLDivElement | null = null;
    let activeEl: Element | null = null;

    function ensureTooltipEl(): HTMLDivElement {
      if (tooltipEl) return tooltipEl;
      const el = document.createElement("div");
      el.className = "instant-tooltip";
      document.body.appendChild(el);
      tooltipEl = el;
      return el;
    }

    function show(target: Element) {
      const title = target.getAttribute("title");
      if (!title) return;
      // Stash + remove so the browser's delayed tooltip doesn't double up.
      target.setAttribute("data-instant-title", title);
      target.removeAttribute("title");
      activeEl = target;
      const tip = ensureTooltipEl();
      tip.textContent = title;
      // Position above the element by default. Browser will clamp to
      // viewport via the max-width + the .instant-tooltip-flip rules.
      const rect = target.getBoundingClientRect();
      const docX = rect.left + window.scrollX + rect.width / 2;
      const docY = rect.top + window.scrollY;
      tip.style.left = `${docX}px`;
      tip.style.top = `${docY}px`;
      // requestAnimationFrame so the layout settles before we read
      // tooltip height for the "flip below if no space above" branch.
      requestAnimationFrame(() => {
        if (!tooltipEl || activeEl !== target) return;
        const tipRect = tooltipEl.getBoundingClientRect();
        const spaceAbove = rect.top;
        const place = spaceAbove > tipRect.height + 12 ? "above" : "below";
        tooltipEl.classList.toggle("instant-tooltip-flip", place === "below");
        if (place === "below") {
          tooltipEl.style.top = `${rect.bottom + window.scrollY}px`;
        }
        tooltipEl.style.opacity = "1";
      });
    }

    function hide(target: Element | null) {
      if (!target) return;
      const stashed = target.getAttribute("data-instant-title");
      if (stashed != null) {
        target.setAttribute("title", stashed);
        target.removeAttribute("data-instant-title");
      }
      if (tooltipEl) tooltipEl.style.opacity = "0";
      if (activeEl === target) activeEl = null;
    }

    function onMouseOver(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      // Walk to nearest titled ancestor. Skip form controls so the
      // browser's native :title handling for inputs stays normal.
      const titled = target.closest("[title]") as Element | null;
      if (!titled) return;
      const tag = titled.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (titled === activeEl) return;
      // Moving from one titled element straight into another — hide
      // the previous one first.
      if (activeEl) hide(activeEl);
      show(titled);
    }

    function onMouseOut(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      const related = e.relatedTarget as Element | null;
      // Find the titled ancestor of the leaving target; ignore if
      // we're just moving between children of the same titled element.
      const titled = target.closest("[data-instant-title]") as Element | null;
      if (!titled) return;
      if (related && titled.contains(related)) return;
      hide(titled);
    }

    function onScroll() {
      // Tooltip position is anchored to viewport coords; hide on scroll
      // rather than reposition (cheaper, and the user has moved on).
      if (activeEl) hide(activeEl);
    }

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("scroll", onScroll, { capture: true });
      if (activeEl) hide(activeEl);
      if (tooltipEl?.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
      tooltipEl = null;
    };
  }, []);

  useEffect(() => {
    void refreshDashboard();
  }, []);

  async function refreshDashboard() {
    setLoading(true);
    setError("");
    try {
      const snapshot = await fetchJson<DashboardSnapshotPayload>("/api/dashboard");
      setState(mapSnapshotToState(snapshot));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown dashboard error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    const eventNames = [
      "status",
      "auth",
      "settings",
      "live_activity",
      "portfolio_summary",
      "closed_positions",
      "open_positions",
      "equity_curve",
      "report",
      "recent_events",
      "recent_decisions",
      "live_orders",
      "live_trades",
      "live_positions",
      "daemon_heartbeat",
      "daemon_ticks",
      "paper_activity",
    ];

    const connect = () => {
      if (disposed) return;
      setStreamStatus((current) => (current === "connected" ? current : "connecting"));
      // 1 s cycle (was 5 s). Server-side dedupe by section JSON equality
      // means React only re-renders sections that actually changed, so
      // dropping the cadence costs ~5× DB reads but no extra render work.
      // WAL-mode SQLite handles this comfortably; bump back up if /api/dashboard
      // p99 drifts above ~200 ms on prod (see polymarket_agent_db_size_bytes).
      source = new EventSource("/api/dashboard/stream?interval_seconds=1");
      source.onopen = () => {
        setStreamStatus("connected");
        setError("");
      };
      const handlers = eventNames.map((eventName) => {
        const handler = (event: Event) => {
          const payload = JSON.parse((event as MessageEvent).data);
          setState((current) => applyDashboardDelta(current, eventName, payload));
          setLoading(false);
          setError("");
        };
        source?.addEventListener(eventName, handler);
        return { eventName, handler };
      });
      source.onerror = () => {
        handlers.forEach(({ eventName, handler }) => source?.removeEventListener(eventName, handler));
        source?.close();
        source = null;
        if (disposed) return;
        setStreamStatus("reconnecting");
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 3000);
      };
    };

    connect();
    return () => {
      disposed = true;
      setStreamStatus("disconnected");
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      source?.close();
    };
  }, []);

  const infoBarItems = useMemo<InfoBarItem[]>(() => {
    switch (activeView) {
      case "overview":
        return [
          { label: "Positions", value: state.portfolioSummary?.open_positions ?? 0 },
          { label: "Exposure", value: formatMoney(state.portfolioSummary?.open_position_notional) },
          { label: "Daily PnL", value: formatMoney(state.portfolioSummary?.daily_realized_pnl), tone: (state.portfolioSummary?.daily_realized_pnl ?? 0) >= 0 ? "positive" : "negative" },
          { label: "Balance", value: formatMoney(state.status?.available_usd) },
        ];
      case "decisions":
        return [
          { label: "Signals", value: state.recentDecisions.length },
          { label: "Markets", value: new Set(state.recentDecisions.map((d) => String(d.payload.market_id ?? ""))).size },
        ];
      case "orders":
        return [
          { label: "Live orders", value: state.liveOrders.length },
          { label: "Live trades", value: state.liveTrades.length },
          { label: "Paper execs", value: state.paperActivity.length },
        ];
      case "portfolio": {
        const pnl = state.portfolioSummary?.total_realized_pnl ?? 0;
        return [
          { label: "Open", value: state.portfolioSummary?.open_positions ?? 0 },
          { label: "Closed", value: state.portfolioSummary?.closed_positions ?? 0 },
          { label: "Exposure", value: formatMoney(state.portfolioSummary?.open_position_notional) },
          { label: "Total PnL", value: formatMoney(pnl), tone: pnl >= 0 ? "positive" : "negative" },
        ];
      }
      case "events":
        return [
          { label: "Events", value: state.recentEvents.length },
          { label: "Types", value: new Set(state.recentEvents.map((e) => e.event_type)).size },
        ];
      case "event-signals":
        // The component manages its own fetch — no shared state to summarize.
        return [];
      case "live-portfolio":
        // Self-managed fetch — InfoBar is hidden for this view.
        return [];
      case "settings":
        return [
          { label: "Fields", value: Object.keys(state.settings?.fields ?? {}).length },
          { label: "Overrides", value: Object.keys(state.settings?.overrides ?? {}).length },
        ];
      default:
        return [];
    }
  }, [activeView, state]);

  const currentView = useMemo(() => {
    switch (activeView) {
      case "decisions":
        return <DecisionsPage decisions={state.recentDecisions} settings={state.settings} openPositions={state.openPositions?.positions ?? []} />;
      case "orders":
        return <OrdersPage liveOrders={state.liveOrders} liveTrades={state.liveTrades} liveActivity={state.liveActivity} paperActivity={state.paperActivity} tradingMode={state.status?.trading_mode ?? "paper"} daemonTicks={state.daemonTicks} pendingMakers={state.pendingMakers} />;
      case "portfolio":
        return <PortfolioPage summary={state.portfolioSummary} positions={state.closedPositions?.positions ?? []} openPositions={state.openPositions?.positions ?? []} equityCurve={state.equityCurve} daemonTicks={state.daemonTicks} heartbeat={state.daemonHeartbeat} settings={state.settings} />;
      case "events":
        return <EventsPage events={state.recentEvents} report={state.report} />;
      case "event-signals":
        return <EventSmartMoneyPage />;
      case "live-portfolio":
        return (
          <LivePortfolioPage
            liveOrders={state.liveOrders}
            liveTrades={state.liveTrades}
            livePositions={state.livePositions}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={state.settings}
            onSettingsUpdated={(settings) => setState((current) => ({ ...current, settings }))}
            onRefresh={refreshDashboard}
          />
        );
      case "daemon":
        return <DaemonView heartbeat={state.daemonHeartbeat} ticks={state.daemonTicks} />;
      case "overview":
      default:
        return <OverviewPage state={state} />;
    }
  }, [activeView, state]);

  return (
    <div className="app-shell">
      {(() => {
        const mode = state.status?.trading_mode || "paper";
        const modeLive = mode.toLowerCase() === "live";
        const dailyPnl = state.portfolioSummary?.daily_realized_pnl ?? 0;
        const openCount = state.portfolioSummary?.open_positions ?? 0;
        const exposure = state.portfolioSummary?.open_position_notional ?? 0;
        const maxDailyLossRaw = state.settings?.values?.max_daily_loss_usd;
        const maxDailyLoss = typeof maxDailyLossRaw === "number" ? maxDailyLossRaw : 0;
        const dailyLossUsed = dailyPnl < 0 ? Math.min(1, -dailyPnl / (maxDailyLoss || 1)) : 0;
        const dailyLossTone = dailyLossUsed >= 0.75 ? "negative" : dailyLossUsed >= 0.5 ? "blocked" : "muted";
        const safetyStop = state.daemonHeartbeat?.heartbeat?.safety_stop_reason ?? null;
        return (
          <>
            <header className="hero">
              <div className="hero-left">
                <div>
                  <p className="eyebrow">Polymarket Trading Engine</p>
                  <h1>Operator Dashboard</h1>
                </div>
                <div className="hero-kpis">
                  <span className={`pill mode-${modeLive ? "live" : "paper"}`}>
                    {modeLive ? "LIVE" : "PAPER"}
                  </span>
                  <span className={`pill ${dailyPnl >= 0 ? "positive" : "negative"}`}>
                    <span className="info-bar-label">Daily PnL</span>
                    {formatMoney(dailyPnl)}
                  </span>
                  <span className="pill">
                    <span className="info-bar-label">Open</span>
                    {openCount} {openCount > 0 ? `· ${formatMoney(exposure)}` : ""}
                  </span>
                  {maxDailyLoss > 0 && (
                    <span className={`pill ${dailyLossTone}`}>
                      <span className="info-bar-label">Loss cap</span>
                      {(dailyLossUsed * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="hero-meta">
                <span className={`pill stream-${streamStatus}`}>
                  Stream: {streamStatus}
                </span>
                <span className={`pill ${state.auth?.readonly_ready ? "ready" : "blocked"}`}>
                  {state.auth?.readonly_ready ? "Auth Ready" : "Auth Blocked"}
                </span>
                <button type="button" className="refresh-button" onClick={() => void refreshDashboard()}>
                  Refresh
                </button>
              </div>
            </header>
            {safetyStop && (
              <div className="banner error">Safety stop active: {safetyStop}</div>
            )}
          </>
        );
      })()}

      <nav className="nav-strip">
        {VIEWS.map((view) => (
          <button
            key={view.key}
            type="button"
            className={`nav-pill ${activeView === view.key ? "active" : ""}`}
            onClick={() => {
              window.location.hash = view.key;
              setActiveView(view.key);
            }}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {loading && <div className="banner">Loading dashboard...</div>}
      {error && <div className="banner error">{error}</div>}

      {activeView !== "daemon" && activeView !== "event-signals" && activeView !== "live-portfolio" && <InfoBar heartbeat={state.daemonHeartbeat} items={infoBarItems} />}
      {currentView}
    </div>
  );
}
