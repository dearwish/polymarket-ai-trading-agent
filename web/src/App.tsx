import { useEffect, useMemo, useState } from "react";

type ViewKey = "overview" | "decisions" | "orders" | "portfolio" | "events";

type StatusPayload = {
  trading_mode: string;
  market_family: string;
  live_trading_enabled: boolean;
  open_positions: number;
  available_usd: number;
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

type PortfolioSummaryPayload = {
  open_positions: number;
  closed_positions: number;
  total_realized_pnl: number;
  daily_realized_pnl: number;
  open_position_notional: number;
};

type ClosedPosition = {
  market_id: string;
  side: string;
  size_usd: number;
  entry_price: number;
  exit_price: number;
  close_reason: string;
  realized_pnl: number;
  cumulative_pnl: number;
  closed_at: string | null;
};

type ClosedPositionsPayload = {
  count: number;
  positions: ClosedPosition[];
};

type EquityPoint = {
  sequence: number;
  market_id: string;
  closed_at: string | null;
  realized_pnl: number;
  equity: number;
};

type EquityCurvePayload = {
  count: number;
  points: EquityPoint[];
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

type DashboardState = {
  status: StatusPayload | null;
  auth: AuthPayload | null;
  liveActivity: LiveActivityPayload | null;
  portfolioSummary: PortfolioSummaryPayload | null;
  closedPositions: ClosedPositionsPayload | null;
  equityCurve: EquityCurvePayload | null;
  report: ReportPayload | null;
  recentEvents: RecentEvent[];
  recentDecisions: DecisionItem[];
  liveOrders: LiveOrder[];
  liveTrades: LiveTrade[];
};

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "decisions", label: "Decisions" },
  { key: "orders", label: "Orders & Trades" },
  { key: "portfolio", label: "Portfolio" },
  { key: "events", label: "Event Log" },
];

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
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

function shortText(value: string | undefined, limit = 88): string {
  if (!value) return "n/a";
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function eventPayloadSummary(payload: Record<string, unknown>): string {
  if (typeof payload.question === "string") return payload.question;
  if (typeof payload.market_id === "string") return `market ${payload.market_id}`;
  if (typeof payload.status === "string") return `status ${payload.status}`;
  return JSON.stringify(payload).slice(0, 96);
}

function getInitialView(): ViewKey {
  const hash = window.location.hash.replace("#", "") as ViewKey;
  return VIEWS.some((item) => item.key === hash) ? hash : "overview";
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

function OverviewPage({ state }: { state: DashboardState }) {
  const { auth, status, portfolioSummary, liveActivity, equityCurve } = state;
  return (
    <>
      <section className="grid cards">
        <article className="card">
          <h2>Account</h2>
          <p>{auth?.wallet_address || "n/a"}</p>
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
            <div><dt>Rejected Orders</dt><dd>{status?.rejected_orders ?? 0}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Portfolio</h2>
          <dl>
            <div><dt>Total PnL</dt><dd>{formatMoney(portfolioSummary?.total_realized_pnl)}</dd></div>
            <div><dt>Daily PnL</dt><dd>{formatMoney(portfolioSummary?.daily_realized_pnl)}</dd></div>
            <div><dt>Closed Trades</dt><dd>{portfolioSummary?.closed_positions ?? 0}</dd></div>
            <div><dt>Open Notional</dt><dd>{formatMoney(portfolioSummary?.open_position_notional)}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Last Poll</h2>
          <p>{liveActivity?.preflight.market.question || "n/a"}</p>
          <dl>
            <div><dt>Time Remaining</dt><dd>{liveActivity ? `${liveActivity.last_poll.time_remaining_minutes.toFixed(1)} min` : "n/a"}</dd></div>
            <div><dt>Yes Trades</dt><dd>{liveActivity?.last_poll.trade_counts.yes ?? 0}</dd></div>
            <div><dt>No Trades</dt><dd>{liveActivity?.last_poll.trade_counts.no ?? 0}</dd></div>
            <div><dt>Total Trades</dt><dd>{liveActivity?.last_poll.trade_counts.total ?? 0}</dd></div>
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
              <strong>{liveActivity?.preflight.assessment.suggested_side || "n/a"}</strong>
            </div>
            <div>
              <label>Edge</label>
              <strong>{formatPct(liveActivity?.preflight.assessment.edge)}</strong>
            </div>
            <div>
              <label>Time Remaining</label>
              <strong>{liveActivity ? `${Math.max(liveActivity.last_poll.time_remaining_seconds, 0)}s` : "n/a"}</strong>
            </div>
            <div>
              <label>Tracked Orders</label>
              <strong>{liveActivity?.tracked_orders.count ?? 0}</strong>
            </div>
            <div>
              <label>Recent Trades</label>
              <strong>{liveActivity?.recent_trades.count ?? 0}</strong>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function DecisionsPage({ decisions }: { decisions: DecisionItem[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Recent Decisions</h2>
        <span>{decisions.length} items</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((item, index) => (
              <tr key={`${item.logged_at}-${index}`}>
                <td>{item.logged_at}</td>
                <td>{item.event_type}</td>
                <td>{shortText(eventPayloadSummary(item.payload), 120)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const preview = content.length > 180 ? `${content.slice(0, 180)}...` : content;
  return (
    <li className="event-entry">
      <div className="event-entry-header">
        <div>
          <strong>{title}</strong>
          <div className="event-time">{timestamp}</div>
        </div>
        <button type="button" className="toggle-button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <pre className="event-preview">{expanded ? content : preview}</pre>
    </li>
  );
}

function OrdersPage({ liveOrders, liveTrades, liveActivity }: { liveOrders: LiveOrder[]; liveTrades: LiveTrade[]; liveActivity: LiveActivityPayload | null }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const selectedOrder = liveOrders.find((order) => order.order_id === selectedOrderId) ?? liveOrders[0];
  const selectedTrade = liveTrades.find((trade) => trade.trade_id === selectedTradeId) ?? liveTrades[0];
  return (
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
          <div>
            <label>Selected Order</label>
            <strong>{selectedOrder?.order_id || "n/a"}</strong>
            <p className="detail-copy">
              status={selectedOrder?.status || "n/a"} | side={selectedOrder?.side || "n/a"} | market={selectedOrder?.market_id || "n/a"}
            </p>
            <p className="detail-copy">
              price={selectedOrder?.price ?? "n/a"} | size={selectedOrder?.size ?? "n/a"} | matched={selectedOrder?.size_matched ?? "n/a"}
            </p>
            <p className="detail-copy">created={selectedOrder?.created_at || "n/a"} | asset={selectedOrder?.asset_id || "n/a"}</p>
          </div>
          <div>
            <label>Selected Trade</label>
            <strong>{selectedTrade?.trade_id || "n/a"}</strong>
            <p className="detail-copy">
              status={selectedTrade?.status || "n/a"} | side={selectedTrade?.side || "n/a"} | market={selectedTrade?.market_id || "n/a"}
            </p>
            <p className="detail-copy">
              price={selectedTrade?.price ?? "n/a"} | size={selectedTrade?.size ?? "n/a"} | amount={selectedTrade?.amount ?? "n/a"}
            </p>
            <p className="detail-copy">created={selectedTrade?.created_at || "n/a"} | asset={selectedTrade?.asset_id || "n/a"}</p>
          </div>
          <div>
            <label>Live Preflight</label>
            <strong>{liveActivity?.preflight.market.question || "n/a"}</strong>
            <p className="detail-copy">blockers={liveActivity?.preflight.blockers.join(", ") || "none"}</p>
            <p className="detail-copy">
              implied={formatPct(liveActivity?.preflight.market.implied_probability)} | fair={formatPct(liveActivity?.preflight.assessment.fair_probability)}
            </p>
            <p className="detail-copy">
              confidence={formatPct(liveActivity?.preflight.assessment.confidence)} | liquidity={formatMoney(liveActivity?.preflight.market.liquidity_usd)}
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}

function PortfolioPage({ summary, positions, equityCurve }: { summary: PortfolioSummaryPayload | null; positions: ClosedPosition[]; equityCurve: EquityCurvePayload | null }) {
  return (
    <section className="grid detail-grid">
      <article className="panel">
        <div className="panel-header">
          <h2>Equity Curve</h2>
          <span>{equityCurve?.count ?? 0} closed points</span>
        </div>
        <PnlChart points={equityCurve?.points ?? []} />
        <div className="axis-labels">
          <span>{equityCurve?.points[0]?.closed_at?.slice(0, 10) || "start"}</span>
          <span>{equityCurve?.points[equityCurve.points.length - 1]?.closed_at?.slice(0, 10) || "latest"}</span>
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <h2>Portfolio Metrics</h2>
          <span>Realized performance</span>
        </div>
        <dl>
          <div><dt>Total Realized PnL</dt><dd>{formatMoney(summary?.total_realized_pnl)}</dd></div>
          <div><dt>Daily Realized PnL</dt><dd>{formatMoney(summary?.daily_realized_pnl)}</dd></div>
          <div><dt>Closed Positions</dt><dd>{summary?.closed_positions ?? 0}</dd></div>
          <div><dt>Open Position Notional</dt><dd>{formatMoney(summary?.open_position_notional)}</dd></div>
        </dl>
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
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>PnL</th>
                <th>Cumulative</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={`${position.market_id}-${position.closed_at}`}>
                  <td>{position.market_id}</td>
                  <td>{position.side}</td>
                  <td>{formatMoney(position.size_usd)}</td>
                  <td className={position.realized_pnl >= 0 ? "positive" : "negative"}>{formatMoney(position.realized_pnl)}</td>
                  <td>{formatMoney(position.cumulative_pnl)}</td>
                  <td>{position.close_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!positions.length && <div className="empty-state">No closed positions yet.</div>}
        </div>
      </article>
    </section>
  );
}

function EventsPage({ events, report }: { events: RecentEvent[]; report: ReportPayload | null }) {
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
              timestamp={item.logged_at}
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
              timestamp={report?.generated_at || "n/a"}
              content={item}
            />
          ))}
        </ul>
      </article>
    </section>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>(getInitialView);
  const [state, setState] = useState<DashboardState>({
    status: null,
    auth: null,
    liveActivity: null,
    portfolioSummary: null,
    closedPositions: null,
    equityCurve: null,
    report: null,
    recentEvents: [],
    recentDecisions: [],
    liveOrders: [],
    liveTrades: [],
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onHashChange = () => setActiveView(getInitialView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [
          status,
          auth,
          liveActivity,
          portfolioSummary,
          closedPositions,
          equityCurve,
          report,
          recentEvents,
          recentDecisions,
          liveOrders,
          liveTrades,
        ] = await Promise.all([
          fetchJson<StatusPayload>("/api/status"),
          fetchJson<AuthPayload>("/api/auth"),
          fetchJson<LiveActivityPayload>("/api/live/activity"),
          fetchJson<PortfolioSummaryPayload>("/api/portfolio/summary"),
          fetchJson<ClosedPositionsPayload>("/api/portfolio/closed-positions"),
          fetchJson<EquityCurvePayload>("/api/portfolio/equity-curve"),
          fetchJson<ReportPayload>("/api/report"),
          fetchJson<RecentEventsPayload>("/api/events/recent?limit=12"),
          fetchJson<DecisionsPayload>("/api/decisions/recent?limit=20"),
          fetchJson<LiveOrdersPayload>("/api/live/orders"),
          fetchJson<LiveTradesPayload>("/api/live/trades?limit=20"),
        ]);
        setState({
          status,
          auth,
          liveActivity,
          portfolioSummary,
          closedPositions,
          equityCurve,
          report,
          recentEvents: recentEvents.events,
          recentDecisions: recentDecisions.decisions,
          liveOrders: liveOrders.orders,
          liveTrades: liveTrades.trades,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown dashboard error");
      } finally {
        setLoading(false);
      }
    }

    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events/stream?limit=12&interval_seconds=5");
    source.addEventListener("recent_events", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as RecentEventsPayload;
      setState((current) => ({ ...current, recentEvents: payload.events }));
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, []);

  const currentView = useMemo(() => {
    switch (activeView) {
      case "decisions":
        return <DecisionsPage decisions={state.recentDecisions} />;
      case "orders":
        return <OrdersPage liveOrders={state.liveOrders} liveTrades={state.liveTrades} liveActivity={state.liveActivity} />;
      case "portfolio":
        return <PortfolioPage summary={state.portfolioSummary} positions={state.closedPositions?.positions ?? []} equityCurve={state.equityCurve} />;
      case "events":
        return <EventsPage events={state.recentEvents} report={state.report} />;
      case "overview":
      default:
        return <OverviewPage state={state} />;
    }
  }, [activeView, state]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Polymarket AI Agent</p>
          <h1>Operator Dashboard</h1>
          <p className="subtitle">Live monitoring for signals, trades, orders, and portfolio state.</p>
        </div>
        <div className="hero-meta">
          <span className={`pill ${state.auth?.readonly_ready ? "ready" : "blocked"}`}>
            {state.auth?.readonly_ready ? "Readonly Ready" : "Auth Blocked"}
          </span>
          <span className={`pill ${state.status?.live_trading_enabled ? "ready" : "blocked"}`}>
            {state.status?.live_trading_enabled ? "Live Enabled" : "Live Disabled"}
          </span>
        </div>
      </header>

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

      {currentView}
    </div>
  );
}
