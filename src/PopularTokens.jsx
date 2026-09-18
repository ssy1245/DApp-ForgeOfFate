import { useEffect, useRef, useState } from "react";

const tokens = [
  { id: "ethereum", symbol: "ETH", name: "Ethereum", icon: "ETH.jpg", padded: true },
  { id: "usd-coin", symbol: "USDC", name: "USD Coin", icon: "USDC.jpg" },
  { id: "dai", symbol: "DAI", name: "Dai Stablecoin", icon: "DAI.png", padded: true },
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", icon: "btc.png" },
  { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped Bitcoin" },
];
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function PopularTokens({ selectedCoin, onSelectCoin }) {
  const [market, setMarket] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const marketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let timer;
    let controller;
    let pending = false;

    async function load() {
      if (disposed || pending) return;
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(load, 60000);
        return;
      }
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      setLoading(true);
      try {
        const response = await fetch("/api/prices", { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.prices) throw new Error(data.error || "Market data is unavailable.");
        if (!disposed) {
          marketRef.current = data;
          setMarket(data);
          setError(data.warning || "");
        }
      } catch {
        if (!disposed) {
          setError(marketRef.current
            ? "Prices could not be refreshed. Showing previously loaded data."
            : "Prices are unavailable. Check the server configuration or try again shortly.");
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!disposed) {
          setClock(Date.now());
          setLoading(false);
          timer = setTimeout(load, 60000);
        }
      }
    }
    function onVisible() { if (!document.hidden) load(); }
    load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshVersion]);

  const updatedTimes = tokens.map(({ id }) => market?.prices[id]?.updatedAt).filter(Number.isFinite);
  const oldestUpdate = updatedTimes.length ? Math.min(...updatedTimes) : null;

  return (
    <section className="panel-card" aria-labelledby="popular-tokens-heading">
      <div className="panel-title">
        <h3 id="popular-tokens-heading">Popular Tokens</h3>
        <button className="market-refresh" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading}>
          {loading ? "Loading..." : "Refresh ↻"}
        </button>
      </div>
      <p className="market-caption">USD prices · 24h change</p>
      {tokens.map((token) => {
        const price = market?.prices[token.id];
        const stale = Boolean(error) || price?.stale || !price?.updatedAt || clock - price.updatedAt * 1000 > 15 * 60000;
        const change = price?.change24h;
        return (
          <button className="token-row token-chart-button" key={token.id} onClick={() => onSelectCoin(token.id)} aria-pressed={selectedCoin === token.id} aria-label={`View ${token.symbol} price chart`}>
            <div className="token-info">
              {token.icon ? (
                <img className={`coin coin-image${token.padded ? " coin-image-padded" : ""}`} src={`/icons/${token.icon}`} alt="" width="38" height="38" />
              ) : <div className="coin" aria-hidden="true">₿</div>}
              <div>
                <div className="token-name">{token.symbol}</div>
                <div className="token-full-name">{token.name}</div>
              </div>
            </div>
            <div className="price">
              {Number.isFinite(price?.usd) ? dollars.format(price.usd) : "—"}
              <div className={`price-change ${!Number.isFinite(change) || stale ? "price-neutral" : change < 0 ? "price-negative" : change === 0 ? "price-neutral" : ""}`}>
                {Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
              </div>
              {price?.usd != null && stale && <span className="market-stale">Stale data</span>}
            </div>
          </button>
        );
      })}
      <p className="market-status" role="status">
        {error || (oldestUpdate ? `Price update: ${new Date(oldestUpdate * 1000).toLocaleString()}` : loading ? "Fetching market prices..." : "Price update time unavailable.")}
      </p>
      <p className="market-source">
        Data by <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">CoinGecko</a> · Cached for 5 min
      </p>
    </section>
  );
}
