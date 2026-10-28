// Sepolia receipt/finality tests use deterministic RPC responses and never send transactions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getCreateAddress } = require('ethers');
const { prepare, createService } = require('../scripts/lib/deployment.cjs');
const { network } = require('../scripts/lib/sepolia.cjs');
const hash = char => '0x' + char.repeat(64);
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sepolia-check-'));
  const txHash = hash('a'), from = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const data = { finalized: 10, chainId: 11155111, receipt: null, fail: false };
  const provider = {
    async send(method) { assert.equal(method, 'eth_chainId'); if (data.fail) throw Error('https://provider.invalid/private-key'); return '0x' + data.chainId.toString(16); },
    async getBlock(height) { if (height === 'finalized') return data.finalized === null ? null : { number: data.finalized, hash: hash('f') }; return { number: height, hash: height === 0 ? hash('0') : hash('b') }; },
    async getBalance() { return 1000000000000000n; },
    async getTransaction(id) { return id === txHash ? { to: null, from, data: plan.data, value: 0n, nonce: 3, chainId: 11155111n } : null; },
    async getTransactionReceipt(id) { return id === txHash ? data.receipt : null; },
    async getCode() { return '0x60016000'; },
  };
  const plan = await prepare({ artifact: { contractName: 'DeploymentProbe', abi: [], bytecode: '0x60016000' }, args: [], deployer: from, network, module: 'deployment-probe', deploymentId: hash('d'), provider });
  const origin = 'http://127.0.0.1:5174';
  let server;
  const start = async () => {
    server = createService({ plan, provider, directory, origin });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  };
  await start();
  const request = async (action = 'status', body) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/deploy/${action}`, body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: result.status, value: await result.json() };
  };
  const begin = () => request('begin', { deploymentId: plan.deploymentId });
  const record = () => request('record', { deploymentId: plan.deploymentId, transactionHash: txHash });
  const mine = (status = 1) => { data.receipt = { status, blockNumber: 20, blockHash: hash('b'), contractAddress: status ? getCreateAddress({ from, nonce: 3 }) : null }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, data, plan, request, begin, record, mine, async restart() { await new Promise(resolve => server.close(resolve)); await start(); } };
}
test('Sepolia: included success remains pending until finality, then survives restart', async t => {
  const f = await fixture(t);
  assert.equal(f.plan.confirmationPolicy, 'sepolia-finalized');
  assert.deepEqual(f.plan.network.rpcUrls, []);
  await f.begin(); f.mine();
  assert.equal((await f.record()).value.state.phase, 'confirming');
  assert.equal(fs.existsSync(path.join(f.directory, 'deployment.json')), false);
  assert.equal((await f.begin()).status, 409);
  await f.restart(); assert.equal((await f.request()).value.state.phase, 'confirming');
  f.data.finalized = 20;
  const confirmed = (await f.request()).value;
  assert.equal(confirmed.state.phase, 'confirmed');
  assert.equal(confirmed.state.manifest.confirmationPolicy, 'sepolia-finalized');
  assert.equal(confirmed.state.manifest.chainId, 11155111);
  await f.restart(); assert.deepEqual((await f.request()).value.state.manifest, confirmed.state.manifest);
});
test('Sepolia: failed receipt cannot enable another spend before finality', async t => {
  const f = await fixture(t); await f.begin(); f.mine(0);
  assert.equal((await f.record()).value.state.phase, 'confirming');
  assert.equal((await f.begin()).status, 409);
  f.data.finalized = 20;
  assert.equal((await f.request()).value.state.phase, 'failed');
  assert.equal((await f.begin()).status, 200);
  assert.equal(fs.existsSync(path.join(f.directory, 'deployment.json')), false);
});
test('Sepolia: no finality fallback, RPC secrets are redacted and recovery remains visible', async t => {
  const f = await fixture(t); await f.begin(); await f.record(); f.mine();
  f.data.finalized = null;
  let status = (await f.request()).value;
  assert.equal(status.healthy, false); assert.equal(status.state.phase, 'submitted');
  assert.equal(fs.existsSync(path.join(f.directory, 'deployment.json')), false);
  f.data.fail = true;
  status = (await f.request()).value;
  assert.equal(status.healthy, false); assert.equal(status.plan.deploymentId, f.plan.deploymentId);
  assert.doesNotMatch(JSON.stringify(status), /provider.invalid|private-key/);
  await f.restart(); assert.equal((await f.request()).value.state.transactionHash, hash('a'));
  f.data.fail = false; f.data.finalized = 20;
  assert.equal((await f.request()).value.state.phase, 'confirmed');
});
test('Sepolia: wrong network blocks new sends and never creates a receipt file', async t => {
  const f = await fixture(t); f.data.chainId = 1;
  assert.equal((await f.begin()).status, 409);
  assert.equal((await f.request()).value.healthy, false);
  assert.equal(fs.existsSync(path.join(f.directory, 'deployment.json')), false);
});
test('Sepolia: altered saved address is not trusted even with the correct transaction hash', async t => {
  const f = await fixture(t); await f.begin(); f.mine(); f.data.finalized = 20;
  assert.equal((await f.record()).value.state.phase, 'confirmed');
  const file = path.join(f.directory, 'deployment.json');
  const saved = JSON.parse(fs.readFileSync(file)); saved.address = '0x' + '1'.repeat(40);
  fs.writeFileSync(file, JSON.stringify(saved));
  await f.restart();
  const status = (await f.request()).value;
  assert.equal(status.healthy, false); assert.match(status.warning, /部署记录与链上核验不一致/);
  assert.equal(JSON.parse(fs.readFileSync(file)).address, saved.address);
});
