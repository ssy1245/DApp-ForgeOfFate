import test from "node:test";
import assert from "node:assert/strict";
import { createPriceService } from "./prices.js";

const payload = (time) => ({ bitcoin: { usd: 123, usd_24h_change: -1.25, last_updated_at: time / 1000 } });

test("missing key does not make an upstream request", async () => {
  const prices = createPriceService({ apiKey: "", fetchImpl() { throw Error("must not run"); } });
  assert.equal((await prices()).status, 503);
});

test("concurrent requests share one fetch; cache expiry refreshes prices", async () => {
  let time = 1000000;
  let calls = 0;
  const prices = createPriceService({ apiKey: "test-secret", now: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.hostname, "api.coingecko.com");
    assert.equal(url.searchParams.get("ids").split(",").length, 5);
    assert.equal(options.headers["x-cg-demo-api-key"], "test-secret");
    return { ok: true, json: async () => payload(time) };
  } });
  const results = await Promise.all([prices(), prices(), prices()]);
  assert.equal(calls, 1);
  assert.equal(results[0].body.prices.bitcoin.change24h, -1.25);
  assert.equal(results[0].body.prices.ethereum.usd, null);
  assert.ok(!JSON.stringify(results).includes("test-secret"));
  time += 299999;
  await prices();
  assert.equal(calls, 1);
  time += 2;
  await prices();
  assert.equal(calls, 2);
});

test("rate limits retain old data as stale and back off", async () => {
  let time = 1000000;
  let calls = 0;
  const prices = createPriceService({ apiKey: "test-secret", now: () => time, fetchImpl: async () => {
    calls++;
    return calls === 1 ? { ok: true, json: async () => payload(time) } : { ok: false, status: 429 };
  } });
  await prices();
  time += 300001;
  const response = await prices();
  assert.equal(response.body.prices.bitcoin.usd, 123);
  assert.equal(response.body.prices.bitcoin.stale, true);
  assert.match(response.body.warning, /rate limit/);
  await prices();
  assert.equal(calls, 2);
});

test("raw upstream errors cannot leak credentials", async () => {
  const prices = createPriceService({ apiKey: "test-secret", fetchImpl: async () => { throw Error("test-secret"); } });
  const response = await prices();
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(response).includes("test-secret"));
});

test("null changes are not converted to zero; old source timestamps remain stale", async () => {
  const prices = createPriceService({ apiKey: "test", now: () => 2000000, fetchImpl: async () => ({ ok: true, json: async () => ({ bitcoin: { usd: 123, usd_24h_change: null, last_updated_at: 1000 } }) }) });
  const coin = (await prices()).body.prices.bitcoin;
  assert.equal(coin.change24h, null);
  assert.equal(coin.stale, true);
});
