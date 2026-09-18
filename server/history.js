const COINS = new Set(["bitcoin", "ethereum", "usd-coin", "dai", "wrapped-bitcoin"]);
const DAYS = new Set(["1", "7", "30"]);
const CACHE_MS = 15 * 60 * 1000;

export function normalizeHistory(prices, now = Date.now()) {
  if (!Array.isArray(prices)) return [];
  const unique = new Map();
  for (const point of prices) {
    if (Array.isArray(point) && Number.isFinite(point[0]) && point[0] > 0
      && point[0] <= now + 60000 && Number.isFinite(point[1]) && point[1] > 0) {
      unique.set(point[0], point[1]);
    }
  }
  return [...unique].sort((a, b) => a[0] - b[0]);
}

export function createHistoryService({ apiKey, fetchImpl = fetch, now = Date.now }) {
  const entries = new Map();
  return async function getHistory(coin, days) {
    if (!COINS.has(coin) || !DAYS.has(days)) {
      return { status: 400, body: { error: "Choose a supported coin and range (1, 7, or 30 days)." } };
    }
    if (!apiKey?.trim()) return { status: 503, body: { error: "Market API key is not configured on the server." } };
    const key = `${coin}:${days}`;
    if (!entries.has(key)) entries.set(key, { cached: null, until: 0, retry: 0, pending: null, warning: null });
    const entry = entries.get(key);
    const result = () => entry.cached
      ? { status: 200, body: { ...entry.cached, warning: entry.warning, stale: Boolean(entry.warning) || now() - entry.cached.updatedAt > 2 * 60 * 60 * 1000 } }
      : { status: 503, body: { error: entry.warning } };
    if (entry.pending) return entry.pending;
    if (now() < entry.retry || (entry.cached && now() < entry.until)) return result();
    entry.pending = (async () => {
      try {
        const url = new URL(`https://api.coingecko.com/api/v3/coins/${coin}/market_chart`);
        url.search = new URLSearchParams({ vs_currency: "usd", days }).toString();
        const response = await fetchImpl(url, {
          headers: { "x-cg-demo-api-key": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(12000), redirect: "error",
        });
        if (!response.ok) {
          entry.warning = response.status === 429
            ? "Historical data rate limit reached. Try again later."
            : response.status === 401 || response.status === 403
              ? "Historical data access was denied. Check the API key and plan."
              : "Historical data is temporarily unavailable.";
          throw new Error("History request failed");
        }
        const data = await response.json();
        const prices = normalizeHistory(data.prices, now());
        if (prices.length < 2) throw new Error("Not enough price points");
        entry.cached = { coin, days, prices, updatedAt: prices.at(-1)[0], fetchedAt: now() };
        entry.until = now() + CACHE_MS;
        entry.retry = 0;
        entry.warning = null;
      } catch {
        entry.warning ||= "Unable to load price history. Please try again shortly.";
        entry.retry = now() + 60000;
      }
      return result();
    })();
    try { return await entry.pending; } finally { entry.pending = null; }
  };
}

export function historyMiddleware(getHistory) {
  return async (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/history") return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      return res.end(JSON.stringify({ error: "Method not allowed." }));
    }
    try {
      const url = new URL(req.url, "http://localhost");
      const { status, body } = await getHistory(url.searchParams.get("coin") || "bitcoin", url.searchParams.get("days") || "1");
      res.statusCode = status;
      res.end(JSON.stringify(body));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Historical data is temporarily unavailable." }));
    }
  };
}
