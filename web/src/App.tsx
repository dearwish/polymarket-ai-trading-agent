import { useEffect, useMemo, useState } from "react";

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

type ReportPayload = {
  session_id: string;
  generated_at: string;
  summary: string;
  items: string[];
};

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

function PnlChart({ positions }: { positions: ClosedPosition[] }) {
  const points = useMemo(() => {
    if (!positions.length) return "";
    const max = Math.max(...positions.map((item) => item.cumulative_pnl), 0.01);
    const min = Math.min(...positions.map((item) => item.cumulative_pnl), 0);
    const range = Math.max(max - min, 0.01);
    return positions
      .map((item, index) => {
        const x = positions.length === 1 ? 0 : (index / (positions.length - 1)) * 100;
        const y = 100 - ((item.cumulative_pnl - min) / range) * 100;
        return `${x},${y}`;
      })
      .join(" ");
  }, [positions]);

  if (!positions.length) {
    return <div className="empty-state">No closed positions yet.</div>;
  }

  return (
    <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [auth, setAuth] = useState<AuthPayload | null>(null);
  const [liveActivity, setLiveActivity] = useState<LiveActivityPayload | null>(null);
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummaryPayload | null>(null);
  const [closedPositions, setClosedPositions] = useState<ClosedPositionsPayload | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [statusData, authData, liveData, portfolioData, positionsData, reportData] = await Promise.all([
          fetchJson<StatusPayload>("/api/status"),
          fetchJson<AuthPayload>("/api/auth"),
          fetchJson<LiveActivityPayload>("/api/live/activity"),
          fetchJson<PortfolioSummaryPayload>("/api/portfolio/summary"),
          fetchJson<ClosedPositionsPayload>("/api/portfolio/closed-positions"),
          fetchJson<ReportPayload>("/api/report"),
        ]);
        setStatus(statusData);
        setAuth(authData);
        setLiveActivity(liveData);
        setPortfolioSummary(portfolioData);
        setClosedPositions(positionsData);
        setReport(reportData);
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

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Polymarket AI Agent</p>
          <h1>Operator Dashboard</h1>
          <p className="subtitle">Live monitoring for signals, trades, orders, and portfolio state.</p>
        </div>
        <div className="hero-meta">
          <span className={`pill ${auth?.readonly_ready ? "ready" : "blocked"}`}>
            {auth?.readonly_ready ? "Readonly Ready" : "Auth Blocked"}
          </span>
          <span className={`pill ${status?.live_trading_enabled ? "ready" : "blocked"}`}>
            {status?.live_trading_enabled ? "Live Enabled" : "Live Disabled"}
          </span>
        </div>
      </header>

      {loading && <div className="banner">Loading dashboard...</div>}
      {error && <div className="banner error">{error}</div>}

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
          <h2>Live Snapshot</h2>
          <p>{liveActivity?.preflight.market.question || "n/a"}</p>
          <dl>
            <div><dt>Implied</dt><dd>{formatPct(liveActivity?.preflight.market.implied_probability)}</dd></div>
            <div><dt>Fair</dt><dd>{formatPct(liveActivity?.preflight.assessment.fair_probability)}</dd></div>
            <div><dt>Confidence</dt><dd>{formatPct(liveActivity?.preflight.assessment.confidence)}</dd></div>
            <div><dt>Blockers</dt><dd>{liveActivity?.preflight.blockers.join(", ") || "none"}</dd></div>
          </dl>
        </article>
      </section>

      <section className="grid detail-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>PnL Curve</h2>
            <span>{closedPositions?.count ?? 0} realized trades</span>
          </div>
          <PnlChart positions={closedPositions?.positions ?? []} />
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

      <section className="grid detail-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Closed Trades</h2>
            <span>Latest realized positions</span>
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
                </tr>
              </thead>
              <tbody>
                {(closedPositions?.positions ?? []).map((position) => (
                  <tr key={`${position.market_id}-${position.closed_at}`}>
                    <td>{position.market_id}</td>
                    <td>{position.side}</td>
                    <td>{formatMoney(position.size_usd)}</td>
                    <td className={position.realized_pnl >= 0 ? "positive" : "negative"}>
                      {formatMoney(position.realized_pnl)}
                    </td>
                    <td>{formatMoney(position.cumulative_pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Recent Log</h2>
            <span>{report?.summary || "n/a"}</span>
          </div>
          <ul className="event-list">
            {(report?.items ?? []).slice(0, 8).map((item, index) => (
              <li key={`${report?.session_id}-${index}`}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
