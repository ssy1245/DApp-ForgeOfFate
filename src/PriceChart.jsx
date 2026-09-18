import { useEffect, useId, useState } from "react";

const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "usd-coin", symbol: "USDC", name: "USD Coin" },
  { id: "dai", symbol: "DAI", name: "Dai" },
  { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped Bitcoin" },
];
const RANGES = [{ days: "1", label: "24H" }, { days: "7", label: "7D" }, { days: "30", label: "30D" }];
const W = 760, H = 300, LEFT = 12, RIGHT = 88, TOP = 20, BOTTOM = 36;
const priceText = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: value < 2 ? 4 : 2, maximumFractionDigits: value < 2 ? 4 : 2,
}).format(value);
const timeText = (value, days) => new Date(value).toLocaleString(undefined, days === "1"
  ? { hour: "2-digit", minute: "2-digit" }
  : { month: "short", day: "numeric" });

export default function PriceChart({ coin, onCoinChange }) {
  const [days, setDays] = useState("1");
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null);
  const [revision, setRevision] = useState(0);
  const gradientId = useId();
  const selected = COINS.find((item) => item.id === coin) || COINS[0];
  const range = RANGES.find((item) => item.days === days);

  useEffect(() => {
    let disposed = false;
    let timer;
    let controller;
    let busy = false;
    setHistory(null);
    setHover(null);
    setError("");
    setLoading(true);
    async function load() {
      if (disposed || busy) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 60000); return; }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      setLoading(true);
      try {
        const response = await fetch(`/api/history?${new URLSearchParams({ coin, days })}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.prices) || data.prices.length < 2) {
          throw new Error(data.error || "Price history is unavailable.");
        }
        if (!disposed) { setHistory(data); setError(data.warning || ""); setHover(null); }
      } catch (failure) {
        if (!disposed) setError(failure.name === "AbortError" ? "The price history request timed out. Please retry." : "Unable to load price history. Please retry shortly.");
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!disposed) { setLoading(false); timer = setTimeout(load, 15 * 60000); }
      }
    }
    function onVisible() { if (!document.hidden) load(); }
    load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, [coin, days, revision]);

  // Never show the previous coin's series while the selection is changing.
  const current = history?.coin === coin && history?.days === days ? history : null;
  const points = current?.prices || [];
  const values = points.map((point) => point[1]);
  const low = points.length ? Math.min(...values) : 0;
  const high = points.length ? Math.max(...values) : 1;
  const padding = Math.max((high - low) * 0.15, high * 0.00001);
  const minY = low - padding, maxY = high + padding;
  const start = points[0]?.[0] ?? 0, end = points.at(-1)?.[0] ?? 1;
  const x = (time) => LEFT + (time - start) / Math.max(end - start, 1) * (W - LEFT - RIGHT);
  const y = (value) => TOP + (maxY - value) / (maxY - minY) * (H - TOP - BOTTOM);
  const path = points.map(([time, value], index) => `${index ? "L" : "M"}${x(time).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const index = hover === null ? points.length - 1 : Math.min(hover, points.length - 1);
  const active = points[index];
  const change = points.length ? (points.at(-1)[1] / points[0][1] - 1) * 100 : null;
  const color = change !== null && change < 0 ? "#ff8d9c" : "#8b7bff";
  const stale = current && (current.stale || error || Date.now() - current.updatedAt > 2 * 60 * 60 * 1000);

  function inspectPoint(event) {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * W;
    const targetTime = start + Math.max(0, Math.min(1, (svgX - LEFT) / (W - LEFT - RIGHT))) * (end - start);
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i][0] - targetTime) < Math.abs(points[nearest][0] - targetTime)) nearest = i;
    }
    setHover(nearest);
  }

  return (
    <section className="trend-card" aria-labelledby="trend-heading">
      <div className="trend-heading-row">
        <div><p className="trend-eyebrow">MARKET OVERVIEW</p><h1 id="trend-heading">Price Trends</h1></div>
        <span className={`trend-badge${stale ? " is-stale" : ""}`}>{loading ? "Updating..." : !current ? "Unavailable" : stale ? "Stale data" : "Market data"}</span>
      </div>
      <div className="trend-controls">
        <div className="trend-tabs" role="group" aria-label="Chart coin">
          {COINS.map((item) => <button key={item.id} aria-pressed={coin === item.id} onClick={() => onCoinChange(item.id)}>{item.symbol}</button>)}
        </div>
        <div className="trend-ranges" role="group" aria-label="Chart time range">
          {RANGES.map((item) => <button key={item.days} aria-pressed={days === item.days} onClick={() => setDays(item.days)}>{item.label}</button>)}
        </div>
      </div>
      <div className="trend-summary">
        <div>
          <p className="trend-coin-name">{selected.name} <span>/ USD</span></p>
          <div className="trend-price">{active ? priceText(active[1]) : "—"}</div>
          <p className="trend-point-time">{active ? new Date(active[0]).toLocaleString() : "Historical market prices"}</p>
        </div>
        <div className="trend-change" style={{ color: change === null ? "#94a3b8" : change < 0 ? "#ff8d9c" : "#20e0a0" }}>
          {change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
          <span>Over displayed {range.label} range</span>
        </div>
      </div>
      {points.length ? (
        <div className="trend-plot" tabIndex={0} role="group" aria-label={`${selected.name} price chart. Use left and right arrow keys to inspect prices.`}
          onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
            }
          }} onBlur={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} onPointerMove={inspectPoint} onPointerDown={inspectPoint} onPointerLeave={() => setHover(null)} role="img" aria-label={`${selected.name} historical price line, USD`}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.24" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
            {[0, 1, 2, 3, 4].map((tick) => {
              const value = minY + (maxY - minY) * tick / 4;
              return <g key={tick}><line x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} stroke="#243147" strokeDasharray="3 5" /><text x={W - RIGHT + 12} y={y(value) + 4} className="chart-axis-label">{priceText(value)}</text></g>;
            })}
            <path d={`${path} L${x(end)},${H - BOTTOM} L${x(start)},${H - BOTTOM} Z`} fill={`url(#${gradientId})`} />
            <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {[0, 1, 2, 3].map((tick) => {
              const time = start + (end - start) * tick / 3;
              return <text key={tick} x={x(time)} y={H - 8} textAnchor={tick === 0 ? "start" : tick === 3 ? "end" : "middle"} className="chart-axis-label">{timeText(time, days)}</text>;
            })}
            {hover !== null && active && <g><line x1={x(active[0])} x2={x(active[0])} y1={TOP} y2={H - BOTTOM} stroke="#9ba7bc" strokeDasharray="4 4" /><circle cx={x(active[0])} cy={y(active[1])} r="5" fill={color} stroke="#fff" strokeWidth="2" /></g>}
          </svg>
          <p className="trend-chart-hint">Hover, tap, or use arrow keys to inspect a price.</p>
        </div>
      ) : <div className="trend-empty" role="status">{loading ? "Loading price history..." : "Price history could not be loaded."}</div>}
      <div className="trend-extremes"><span>Period low <strong>{points.length ? priceText(low) : "—"}</strong></span><span>Period high <strong>{points.length ? priceText(high) : "—"}</strong></span></div>
      {error && <p className="wallet-error" role="status">{error}{current ? " Showing previous data." : ""}</p>}
      <footer className="trend-footer"><span>Data by <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">CoinGecko</a> · Cached for 15 min</span><button onClick={() => setRevision((value) => value + 1)} disabled={loading}>{loading ? "Updating..." : "Refresh ↻"}</button></footer>
    </section>
  );
}
