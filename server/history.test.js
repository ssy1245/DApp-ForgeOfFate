import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryService, normalizeHistory } from './history.js';

test('sorts, deduplicates, and rejects invalid points', () => {
  assert.deepEqual(normalizeHistory([[200, 3], [100, 2], [100, 4], [300, null], [400, -1], [Infinity, 1], [900000, 5]], 1000), [[100, 4], [200, 3]]);
});
test('rejects unsupported coins and ranges without spending quota', async () => {
  let calls = 0;
  const history = createHistoryService({ apiKey: 'test', fetchImpl: async () => { calls++; } });
  assert.equal((await history('../bitcoin', '1')).status, 400);
  assert.equal((await history('bitcoin', 'max')).status, 400);
  assert.equal(calls, 0);
});
test('deduplicates calls and isolates cache by coin and range', async () => {
  let calls = 0;
  const history = createHistoryService({ apiKey: 'test-secret', now: () => 1000, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.hostname, 'api.coingecko.com');
    assert.equal(options.headers['x-cg-demo-api-key'], 'test-secret');
    return { ok: true, json: async () => ({ prices: [[100, 2], [200, 3]] }) };
  } });
  const responses = await Promise.all([history('bitcoin', '1'), history('bitcoin', '1')]);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(responses).includes('test-secret'));
  await history('bitcoin', '1');
  assert.equal(calls, 1);
  await history('bitcoin', '7');
  await history('ethereum', '1');
  assert.equal(calls, 3);
});
test('failed refresh retains history as stale and backs off', async () => {
  let time = 1000, calls = 0;
  const history = createHistoryService({ apiKey: 'test', now: () => time, fetchImpl: async () => {
    calls++;
    return calls === 1 ? { ok: true, json: async () => ({ prices: [[100, 2], [200, 3]] }) } : { ok: false, status: 429 };
  } });
  await history('bitcoin', '1');
  time += 900001;
  const result = await history('bitcoin', '1');
  assert.equal(result.body.stale, true);
  assert.equal(result.body.prices.length, 2);
  await history('bitcoin', '1');
  assert.equal(calls, 2);
});
