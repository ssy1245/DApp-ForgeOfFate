const COIN_IDS = ["ethereum", "usd-coin", "dai", "bitcoin", "wrapped-bitcoin"];
const CACHE_MS = 5 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;

export function createPriceService({ apiKey, fetchImpl = fetch, now = Date.now, cacheMs = CACHE_MS }) {
  let cached = null;
  let refreshAfter = 0;
  let retryAfter = 0;
  let failure = null;
  let pending = null;

  function snapshot() {
    const prices = Object.fromEntries(COIN_IDS.map((id) => {
      const price = cached.prices[id];
      return [id, {
        ...price,
        stale: Boolean(failure) || !price.updatedAt || now() - price.updatedAt * 1000 > STALE_MS,
      }];
    }));
    return { status: 200, body: { prices, fetchedAt: cached.fetchedAt, warning: failure, source: "CoinGecko" } };
  }

  async function refresh() {
    try {
      const url = new URL("https://api.coingecko.com/api/v3/simple/price");
      url.search = new URLSearchParams({
        ids: COIN_IDS.join(","),
        vs_currencies: "usd",
        include_24hr_change: "true",
        include_last_updated_at: "true",
      }).toString();
      const response = await fetchImpl(url, {
        headers: { "x-cg-demo-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
      if (!response.ok) {
        const messages = {
          401: "Market API key was rejected. Check the server configuration.",
          403: "Market data access was denied. Check the API plan and key.",
          429: "Market data rate limit reached. Please try again later.",
        };
        failure = messages[response.status] ?? "Market data provider is temporarily unavailable.";
        throw new Error("Upstream request failed");
      }
      const data = await response.json();
      const prices = Object.fromEntries(COIN_IDS.map((id) => {
        const item = data[id];
        return [id, {
          usd: Number.isFinite(item?.usd) && item.usd > 0 ? item.usd : null,
          change24h: Number.isFinite(item?.usd_24h_change) ? item.usd_24h_change : null,
          updatedAt: Number.isFinite(item?.last_updated_at) && item.last_updated_at > 0
            && item.last_updated_at * 1000 <= now() + 60000 ? item.last_updated_at : null,
        }];
      }));
      if (!Object.values(prices).some((price) => price.usd !== null)) {
        throw new Error("No valid prices returned");
      }
      cached = { prices, fetchedAt: now() };
      refreshAfter = now() + cacheMs;
      failure = null;
      retryAfter = 0;
    } catch {
      // Never expose upstream bodies, request headers, or credentials to the client.
      failure ||= "Unable to load market prices. Please try again later.";
      retryAfter = now() + 60000;
    }
    return cached ? snapshot() : { status: 503, body: { error: failure } };
  }

  return async function getPrices() {
    if (!apiKey?.trim()) {
      return { status: 503, body: { error: "Market data is not configured. Set COIN_API_KEY on the server and restart it." } };
    }
    if (pending) return pending;
    if (now() < retryAfter) return cached ? snapshot() : { status: 503, body: { error: failure } };
    if (cached && now() < refreshAfter) return snapshot();
    pending = refresh();
    try { return await pending; } finally { pending = null; }
  };
}

export function priceMiddleware(getPrices) {
  return async function handlePrices(req, res, next) {
    if (req.url?.split("?")[0] !== "/api/prices") return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.statusCode = 405;
      return res.end(JSON.stringify({ error: "Method not allowed." }));
    }
    try {
      const result = await getPrices();
      res.statusCode = result.status;
      res.end(JSON.stringify(result.body));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Market data is temporarily unavailable." }));
    }
  };
}
