// Sepolia receipt/finality tests use deterministic RPC responses and never send transactions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getCreateAddress, Interface, Wallet } = require('ethers');
const { prepare, createService } = require('../scripts/lib/deployment.cjs');
const { loadPlan, nftHooks, selectModule } = require('../scripts/lib/deployment-modules.cjs');
const { network } = require('../scripts/lib/sepolia.cjs');
const hash = char => '0x' + char.repeat(64);
async function fixture(t, nft = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sepolia-check-'));
  const txHash = hash('a'), from = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const data = { finalized: 10, chainId: 11155111, receipt: null, fail: false, wrongSigner: false, wrongEpoch: false, publishFail: false };
  const provider = {
    async send(method) { assert.equal(method, 'eth_chainId'); if (data.fail) throw Error('https://provider.invalid/private-key'); return '0x' + data.chainId.toString(16); },
    async getBlock(height) { if (height === 'finalized') return data.finalized === null ? null : { number: data.finalized, hash: hash('f') }; return { number: height, hash: height === 0 ? hash('0') : hash('b') }; },
    async getBalance() { return 1000000000000000n; },
    async getTransaction(id) { return id === txHash ? { to: null, from, data: plan.data, value: 0n, nonce: 3, chainId: 11155111n } : null; },
    async getTransactionReceipt(id) { return id === txHash ? data.receipt : null; },
    async getCode() { return '0x60016000'; },
    async call(tx) {
      assert.equal(tx.blockTag, 20);
      const abi = new Interface(plan.abi);
      const method = abi.parseTransaction({ data: tx.data }).name;
      return abi.encodeFunctionResult(method, [method === 'mintSigner'
        ? data.wrongSigner ? from : plan.mintSigner : data.wrongEpoch ? hash('e') : plan.deploymentId]);
    },
  };
  const gameDirectory = path.join(directory, 'game');
  const options = { root: path.resolve(__dirname, '../..'), directory, gameDirectory, deployer: from, provider, network, module: 'forge-of-fate', compile: async () => {} };
  const plan = nft ? await loadPlan(options) : await prepare({ artifact: { contractName: 'DeploymentProbe', abi: [], bytecode: '0x60016000' }, args: [], deployer: from, network, module: 'deployment-probe', deploymentId: hash('d'), provider });
  const origin = 'http://127.0.0.1:5174';
  let server;
  const start = async () => {
    const hooks = nftHooks({ plan, provider, gameDirectory });
    if (nft) {
      const publish = hooks.publishManifest;
      hooks.publishManifest = manifest => { if (data.publishFail) throw Error('simulated disk failure'); return publish(manifest); };
    }
    server = createService({ plan, provider, directory, origin, hooks });
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
  return { directory, gameDirectory, data, plan, request, begin, record, mine, reloadPlan: () => loadPlan(options),
    async restart() { await new Promise(resolve => server.close(resolve)); await start(); } };
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

test('NFT: default module, immutable build and signer survive restart without exposing the key', async t => {
  assert.equal(selectModule([]), 'forge-of-fate');
  assert.equal(selectModule(['--module', 'deployment-probe']), 'deployment-probe');
  assert.throws(() => selectModule(['--module', '../bad']));
  const f = await fixture(t, true);
  const keyFile = path.join(f.gameDirectory, 'mint-key');
  const key = fs.readFileSync(keyFile, 'utf8');
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(new Wallet(key).address, f.plan.mintSigner);
  assert.equal(f.plan.contractName, 'ForgeOfFate');
  assert.deepEqual(f.plan.constructorArgs, [f.plan.mintSigner, f.plan.deploymentId]);
  assert.deepEqual(await f.reloadPlan(), f.plan);
  assert.equal(JSON.stringify((await f.request()).value).includes(key), false);
  assert.equal(fs.readFileSync(path.join(f.directory, 'plan.json'), 'utf8').includes(key), false);
  assert.equal(fs.existsSync(path.join(f.gameDirectory, 'deployment.json')), false);
});
test('NFT: only finalized and verified deployment publishes the version 2 game manifest', async t => {
  const f = await fixture(t, true);
  const gameFile = path.join(f.gameDirectory, 'deployment.json');
  await f.begin(); f.mine();
  assert.equal((await f.record()).value.state.phase, 'confirming');
  assert.equal(fs.existsSync(gameFile), false);
  f.data.finalized = 20;
  const confirmed = (await f.request()).value;
  assert.equal(confirmed.healthy, true);
  const manifest = confirmed.state.manifest;
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.mintSigner, f.plan.mintSigner);
  for (const key of ['abi', 'address', 'chainId', 'deploymentTransaction', 'deploymentBlock', 'deploymentBlockHash', 'genesisHash', 'runtimeCodeHash', 'deploymentId']) assert.ok(manifest[key]);
  assert.deepEqual(JSON.parse(fs.readFileSync(gameFile)), manifest);
  await f.restart();
  assert.deepEqual((await f.request()).value.state.manifest, manifest);
  assert.deepEqual(await f.reloadPlan(), f.plan);
  assert.equal((await f.begin()).status, 409);
});
test('NFT: a crash between receipt and game publication resumes without a second transaction', async t => {
  const f = await fixture(t, true);
  await f.begin(); f.mine(); f.data.finalized = 20; f.data.publishFail = true;
  assert.equal((await f.record()).status, 503);
  assert.equal((await f.request()).value.state.transactionHash, hash('a'));
  assert.equal(fs.existsSync(path.join(f.directory, 'deployment.json')), true);
  assert.equal(fs.existsSync(path.join(f.gameDirectory, 'deployment.json')), false);
  assert.equal((await f.begin()).status, 409);
  f.data.publishFail = false; await f.restart();
  assert.equal((await f.request()).value.state.phase, 'confirmed');
  assert.equal(fs.existsSync(path.join(f.gameDirectory, 'deployment.json')), true);
});
test('NFT: missing or changed mint keys block deployment and are never regenerated', async t => {
  const f = await fixture(t, true), keyFile = path.join(f.gameDirectory, 'mint-key');
  const original = fs.readFileSync(keyFile);
  fs.unlinkSync(keyFile);
  await assert.rejects(f.reloadPlan, /密钥缺失/);
  assert.equal((await f.begin()).status, 409);
  assert.equal(fs.existsSync(keyFile), false);
  fs.writeFileSync(keyFile, Wallet.createRandom().privateKey);
  await assert.rejects(f.reloadPlan, /授权地址或构造参数/);
  assert.equal((await f.request()).value.healthy, false);
  fs.writeFileSync(keyFile, original);
  assert.deepEqual(await f.reloadPlan(), f.plan);
});
test('NFT: altered build or constructor parameters cannot become a new plan', async t => {
  const f = await fixture(t, true);
  const file = path.join(f.directory, 'build-info.json'), build = fs.readFileSync(file);
  fs.writeFileSync(file, '{}'); await assert.rejects(f.reloadPlan, /编译资料/);
  fs.writeFileSync(file, build);
  const changed = { ...f.plan, constructorArgs: [f.plan.mintSigner, hash('e')] };
  fs.writeFileSync(path.join(f.directory, 'plan.json'), JSON.stringify(changed));
  await assert.rejects(f.reloadPlan, /构造参数/);
});
test('NFT: chain signer and deployment identity must match before game publication', async t => {
  const f = await fixture(t, true);
  await f.begin(); f.mine(); f.data.finalized = 20;
  for (const field of ['wrongSigner', 'wrongEpoch']) {
    f.data[field] = true;
    const result = await f.record();
    assert.equal(result.status, 409);
    assert.match(result.value.error, /链上铸造授权地址或部署标识/);
    assert.equal(fs.existsSync(path.join(f.gameDirectory, 'deployment.json')), false);
    f.data[field] = false;
  }
  assert.equal((await f.request()).value.state.phase, 'confirmed');
});
test('NFT: preexisting or modified game manifests are never overwritten', async t => {
  const f = await fixture(t, true);
  const target = path.join(f.gameDirectory, 'deployment.json');
  fs.writeFileSync(target, JSON.stringify({ deploymentId: hash('e') }));
  assert.equal((await f.begin()).status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(target)), { deploymentId: hash('e') });
  await assert.rejects(f.reloadPlan, /工作台记录缺失/);
  fs.unlinkSync(target);
  await f.begin(); f.mine(); f.data.finalized = 20; await f.record();
  const changed = JSON.parse(fs.readFileSync(target)); changed.address = '0x' + '1'.repeat(40);
  fs.writeFileSync(target, JSON.stringify(changed));
  await f.restart();
  const status = (await f.request()).value;
  assert.equal(status.healthy, false); assert.match(status.warning, /清单与核验结果不同/);
  assert.deepEqual(JSON.parse(fs.readFileSync(target)), changed);
});
