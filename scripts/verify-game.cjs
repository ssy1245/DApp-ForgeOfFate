// An isolated live API + contract check. It never uses the running game's DB or chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Wallet, NonceManager, JsonRpcProvider, Contract, ContractFactory, parseEther, hexlify, randomBytes } = require('ethers');

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.local'), { recursive: true, mode: 0o700 });
const directory = fs.mkdtempSync(path.join(root, '.local', 'verify-game-'));
fs.chmodSync(directory, 0o700);
const report = { startedAt: new Date().toISOString(), isolated: true, checks: [] };
const children = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log('PASS: ' + name); };

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(command, args, name, env = {}) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  children.add(child);
  child.once('error', error => { child.launchError = error; children.delete(child); });
  child.once('exit', () => children.delete(child));
  return child;
}

async function run(command, args, name, env = {}) {
  const child = launch(command, args, name, env);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(name + ' failed; see ' + path.join(directory, name + '.log'))));
  });
}

async function stop(child) {
  if (!children.has(child)) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([exited, delay(3000)]);
  if (children.has(child)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await exited;
  }
}

async function untilReady(request, child, name) {
  for (let i = 0; i < 120; i++) {
    if (!children.has(child)) throw Error(name + ' stopped; ' + (child.launchError?.message || 'see ' + path.join(directory, name + '.log')));
    try { if (await request()) return; } catch {}
    await delay(250);
  }
  throw Error(name + ' did not become ready');
}

function apiClient(base, token) {
  let cookie;
  async function request(route, body, { key = randomUUID(), expected = 200 } = {}) {
    const response = await fetch(base + '/api' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await response.json();
    assert.equal(response.status, expected, route + ': ' + JSON.stringify(data));
    return data;
  }
  return { request, state: async () => {
    const state = await request('/state');
    assert.ok(!Object.hasOwn(state.player, 'ap'), 'Public state must not restore energy');
    return state;
  } };
}

async function main() {
  const chainPort = await freePort();
  let apiPort = await freePort();
  while (apiPort === chainPort) apiPort = await freePort();
  const rpcUrl = `http://127.0.0.1:${chainPort}`, apiUrl = `http://127.0.0.1:${apiPort}`;
  const env = { FORGE_LOCAL_DIR: directory, LOCAL_RPC_URL: rpcUrl, DEMO_MODE: '1' };
  report.chainPort = chainPort; report.apiPort = apiPort;
  await run('npm', ['run', 'compile', '-w', 'contracts'], 'compile');
  const chain = launch(process.execPath, [require.resolve('hardhat/internal/cli/cli'), 'node', '--config', path.join(root, 'contracts/hardhat.config.cjs'), '--hostname', '127.0.0.1', '--port', String(chainPort)], 'chain');
  await untilReady(async () => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    return (await response.json()).result === '0x7a69';
  }, chain, 'chain');
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  provider.pollingInterval = 100;
  try {
    const funder = await provider.getSigner(0);
    const authority = Wallet.createRandom(), epoch = hexlify(randomBytes(32));
    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/contracts/ForgeOfFate.sol/ForgeOfFate.json')));
    const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, funder).deploy(authority.address, epoch);
    await deployed.waitForDeployment();
    fs.writeFileSync(path.join(directory, 'mint-key'), authority.privateKey, { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'deployment.json'), JSON.stringify({ address: await deployed.getAddress(), chainId: 31337, deploymentId: epoch, mintSigner: authority.address, abi: artifact.abi }), { mode: 0o600 });
    const startBackend = () => launch(path.join(root, '.venv/bin/python'), ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], 'backend', env);
    let backend = startBackend();
    const ready = () => untilReady(async () => (await fetch(apiUrl + '/api/config')).ok, backend, 'backend');
    await ready();
    const cfg = await (await fetch(apiUrl + '/api/config')).json(), balance = cfg.balance;
    assert.equal(cfg.chain.deploymentId, epoch);
    assert.ok(!Object.keys(balance).some(key => key.endsWith('_ap')));
    const credentials = { username: 'verify_' + randomUUID().slice(0, 8), password: randomUUID() };
    const player = apiClient(apiUrl);
    await player.request('/session', {});
    await player.request('/account/register', credentials);
    const claimKey = randomUUID();
    await player.request('/claim', {}, { key: claimKey });
    await player.request('/claim', {}, { key: claimKey });
    await player.request('/claim', {}, { expected: 409 });
    assert.equal((await player.state()).player.materials, balance.daily_materials);
    const dailyIds = [];
    for (let i = 0; i < balance.daily_swords; i++) {
      const key = randomUUID(), first = await player.request('/supply/sword', {}, { key });
      assert.deepEqual(await player.request('/supply/sword', {}, { key }), first);
      dailyIds.push(first.weapon_id);
    }
    await player.request('/supply/sword', {}, { expected: 409 });
    assert.equal((await player.state()).player.materials, balance.daily_materials);
    check('Registration, daily supply, three free swords and retry limits');

    const forged = await player.request('/forge', {}), wid = forged.weapon_id;
    const beforeHeat = await player.state();
    assert.equal(beforeHeat.player.materials, balance.daily_materials - balance.forge_materials);
    await player.request(`/weapons/${wid}/heat`, {});
    await delay((balance.heat_seconds + 0.2) * 1000);
    const strikeKey = randomUUID(), body = { shield: true, expected_level: 0, expected_strikes: 0, expected_protected_left: 0 };
    const result = await player.request(`/weapons/${wid}/strike`, body, { key: strikeKey });
    assert.deepEqual(await player.request(`/weapons/${wid}/strike`, body, { key: strikeKey }), result);
    await player.request(`/weapons/${wid}/strike`, body, { expected: 409 });
    const afterStrike = await player.state(), sword = afterStrike.weapons.find(item => item.id === wid);
    assert.equal(afterStrike.player.materials, beforeHeat.player.materials - balance.heat_materials - balance.strike_materials);
    assert.equal(sword.heat_charges, balance.heat_strikes - 1);
    const recycleKey = randomUUID();
    await player.request(`/weapons/${wid}/recycle`, {}, { key: recycleKey });
    await player.request(`/weapons/${wid}/recycle`, {}, { key: recycleKey });
    assert.equal((await player.state()).player.coins, sword.recycle_price);
    const beforeFailure = await player.state();
    await player.request('/materials', {}, { expected: 409 });
    assert.deepEqual(await player.state(), beforeFailure);
    await player.request('/cheats/resources', { resource: 'all', amount: 1 }, { expected: 403 });
    check('Real heating, protected strike, stale/repeated requests, recycle and insufficient funds');

    await player.request('/account/logout', {});
    const restored = apiClient(apiUrl);
    await restored.request('/account/login', credentials);
    assert.deepEqual(await restored.state(), beforeFailure);
    const boundWallet = Wallet.createRandom();
    const challenge = await restored.request('/auth/challenge', { address: boundWallet.address });
    await restored.request('/auth/login', { challenge_id: challenge.challenge_id, signature: await boundWallet.signMessage(challenge.message) });
    const boundState = await restored.state();
    for (const resource of ['materials', 'shields', 'coins']) assert.equal(boundState.player[resource], beforeFailure.player[resource]);
    assert.deepEqual(boundState.weapons.map(item => item.id), beforeFailure.weapons.map(item => item.id));
    check('Account login and wallet binding preserve material-only progress');

    const wa = Wallet.createRandom().connect(provider), wb = Wallet.createRandom().connect(provider);
    for (const wallet of [wa, wb]) await (await funder.sendTransaction({ to: wallet.address, value: parseEther('2') })).wait();
    async function walletClient(wallet) {
      const client = apiClient(apiUrl), c = await client.request('/auth/challenge', { address: wallet.address });
      const logged = await client.request('/auth/login', { challenge_id: c.challenge_id, signature: await wallet.signMessage(c.message) });
      return apiClient(apiUrl, logged.token);
    }
    const tester = await walletClient(wa), buyer = await walletClient(wb);
    await run(path.join(root, '.venv/bin/python'), ['scripts/create_dev_accounts.py', '--demo-wallet', wa.address], 'tester-fixture', env);
    await tester.request('/cheats/resources', { resource: 'all', amount: 100000 });
    const routes = [];
    for (const branch of ['longsword', 'rapier', 'greatsword']) {
      const spawned = await tester.request('/cheats/weapons', { count: 1, level: 20 });
      if (branch !== 'longsword') await tester.request(`/weapons/${spawned.weapon_id}/branch`, { branch });
      routes.push({ branch, id: spawned.weapon_id });
    }
    const routeBefore = await tester.state();
    for (const route of routes) await tester.request(`/weapons/${route.id}/heat`, {});
    await delay((balance.heat_seconds + 0.2) * 1000);
    for (const route of routes) await tester.request(`/weapons/${route.id}/strike`, { shield: true, expected_level: 20, expected_strikes: 0, expected_protected_left: 0 });
    const routeCost = routes.reduce((sum, route) => sum + balance.weapon_economy[route.branch].strike_materials, 0);
    assert.equal((await tester.state()).player.materials, routeBefore.player.materials - routes.length * balance.heat_materials - routeCost);
    check('All three weapon routes charge their configured iron cost without energy');

    const shopBefore = await tester.state();
    await tester.request('/materials', {});
    const bought = await tester.request('/shop/sword', {}), shopAfter = await tester.state();
    assert.equal(shopAfter.player.materials, shopBefore.player.materials + balance.material_pack_size);
    assert.equal(shopAfter.player.coins, shopBefore.player.coins - balance.material_pack_price - balance.coin_sword_price);
    const boughtSword = shopAfter.weapons.find(item => item.id === bought.weapon_id);
    assert.equal(boughtSword.level, balance.coin_sword_level);
    await tester.request(`/weapons/${bought.weapon_id}/recycle`, {});
    assert.equal((await tester.state()).player.coins, shopAfter.player.coins + boughtSword.recycle_price);
    check('Gold purchases iron and a refined sword; system recycle credits the displayed amount');

    const seeded = await tester.request('/demo/seed', {});
    await tester.request(`/weapons/${seeded.weapon_id}/seal`, {});
    await buyer.request(`/weapons/${seeded.weapon_id}/voucher`, {}, { expected: 404 });
    const authorization = await tester.request(`/weapons/${seeded.weapon_id}/voucher`, {});
    const sellerContract = new Contract(cfg.chain.address, cfg.chain.abi, new NonceManager(wa));
    const buyerContract = sellerContract.connect(new NonceManager(wb));
    const id = BigInt(seeded.weapon_id), price = parseEther('0.01');
    await (await sellerContract.mint(authorization.voucher, authorization.signature)).wait();
    assert.equal(await sellerContract.ownerOf(id), wa.address);
    await tester.request(`/weapons/${seeded.weapon_id}/voucher`, {}, { expected: 409 });
    await (await sellerContract.list(id, price)).wait();
    await (await buyerContract.buy(id, wa.address, price, { value: price })).wait();
    assert.equal(await buyerContract.ownerOf(id), wb.address);
    assert.equal(await sellerContract.proceeds(wa.address), price);
    await (await sellerContract.withdraw()).wait();
    assert.equal(await sellerContract.proceeds(wa.address), 0n);
    await (await buyerContract.list(id, price)).wait();
    await (await buyerContract['safeTransferFrom(address,address,uint256)'](wb.address, wa.address, id)).wait();
    assert.equal((await sellerContract.listings(id)).price, 0n);
    check('Seal, signed NFT mint, list, buy, withdraw and transfer run on the isolated chain');

    const beforeRestart = await restored.state();
    await stop(backend); backend = startBackend(); await ready();
    assert.deepEqual(await restored.state(), beforeRestart);
    assert.equal((await tester.state()).weapons.find(item => item.id === seeded.weapon_id).status, 'sealed');
    check('Backend restart preserves accounts, weapons, resources and authenticated sessions');
    report.passed = true;
  } finally { provider.destroy(); }
}

main().catch(error => { report.passed = false; report.error = error.message; console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await Promise.all([...children].map(stop));
  report.completedAt = new Date().toISOString();
  const output = path.join(directory, 'verification.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log('Verification report: ' + output);
});
