# Market prices API

The Node-side middleware exposes `GET /api/prices` in both `npm run dev` and
`npm run preview`. It queries the CoinGecko Demo API for ETH, USDC, DAI, BTC,
and WBTC. No wallet connection or model API key is required.

## Local setup

Set `COIN_API_KEY` in the project root `.env` file (see `.env.example`), then run
`npm run dev`. Restart the server after changing the key. Never prefix this
variable with `VITE_`, commit `.env`, or put the key in client code.

The browser checks once per minute while the tab is visible. All visitors to
the same server process share a five-minute cache and concurrent refreshes are
combined into one upstream request. Failures back off for one minute. Previously
loaded prices remain visible with a stale-data indication when refreshing fails.
Source timestamps older than 15 minutes or missing timestamps are marked stale.
Missing prices and changes display a dash; they are not replaced with sample data.

Continuous use of one process at one query per five minutes is about 8,640
successful upstream calls per 30 days. Multiple processes, restarts, and other
uses of the key can increase usage. Check the provider dashboard for actual quota.

## Historical charts

`GET /api/history?coin=bitcoin&days=1` returns sanitized `[timestamp, USD price]`
pairs for the same five coins and ranges `1`, `7`, or `30`. Each coin/range is
cached for 15 minutes. Concurrent requests share one fetch, and failures back
off for one minute while retaining previous data as stale. The frontend pauses
polling when hidden and rejects obsolete responses after selection changes.

Historical queries consume additional credits beyond the current-price estimate
above. Continuous use of even one chart alongside prices can exceed a 10,000-call
monthly allowance; switching coins/ranges or running multiple servers adds usage.

Run all server behavior checks with `node --test server/*.test.js`.

## Deployment

`npm run build` creates static frontend assets only. The API and its key are not
included in `dist`. Static hosting alone therefore cannot serve live prices.
For production, run `priceMiddleware(createPriceService({ apiKey }))` in a Node
server, or adapt it to the deployment platform's server function. Route
`/api/prices` and `/api/history` to that backend and set `COIN_API_KEY` as a server secret.
Also mount `historyMiddleware(createHistoryService({ apiKey }))` for charts.
Vite preview is for local verification, not a production hosting service.

## Sources

- https://docs.coingecko.com/demo/reference/simple-price
- https://docs.coingecko.com/demo/reference/authentication

- https://docs.coingecko.com/demo/reference/coins-id-market-chart
