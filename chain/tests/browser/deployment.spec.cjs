const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { JsonRpcProvider, Contract, Wallet, hexlify, randomBytes } = require('ethers');
const root = path.resolve(__dirname, '../../..');
const deployer = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Public Hardhat account; local chain only.
const other = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
const test = base.extend({
  deploymentModule: ['deployment-probe', { option: true }],
  rehearsal: async ({ deploymentModule }, use) => {
    const ports = new Set(); while (ports.size < 3) ports.add(await freePort());
    const [rpcPort, apiPort, uiPort] = [...ports];
    const origin = `http://127.0.0.1:${uiPort}`, rpc = `http://127.0.0.1:${rpcPort}`;
    let output = '';
    const child = spawn(process.execPath, ['chain/scripts/deploy-console-local.cjs', '--test', '--module', deploymentModule], { cwd: root,
      env: { ...process.env, FORGE_DEPLOYER_ADDRESS: deployer, FORGE_DEPLOY_RPC_PORT: String(rpcPort), FORGE_DEPLOY_API_PORT: String(apiPort), FORGE_DEPLOY_UI_PORT: String(uiPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    let provider;
    try {
      await expect.poll(() => { if (child.exitCode !== null) throw Error(output); return output.includes('部署页面：'); }, { timeout: 45000 }).toBeTruthy();
      provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
      const status = async () => { const response = await fetch(origin + '/api/deploy/status'); return { code: response.status, body: await response.json() }; };
      const post = async (action, body, from = origin) => {
        const response = await fetch(origin + '/api/deploy/' + action, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { code: response.status, body: await response.json() };
      };
      const directory = output.match(/记录目录：([^\n]+)/)[1].trim();
      await use({ origin, rpc, provider, status, post, directory });
    } finally {
      provider?.destroy();
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  },
});

test.describe('NFT business deployment', () => {
  test.use({ deploymentModule: 'forge-of-fate' });
  test('publishes matching game configuration, mints, and reconnects the backend/indexer', async ({ page, rehearsal }) => {
    const controls = await wallet(page, rehearsal);
    const { body: { plan } } = await rehearsal.status();
    await expect(page.getByTestId('mint-signer')).toHaveText(plan.mintSigner);
    await expect(page.getByText('武器 NFT / 市场合约', { exact: true })).toBeVisible();
    controls.rejectNext = true;
    await deployButton(page).click();
    await expect(page.getByRole('alert')).toContainText('你取消了钱包操作。');
    await expect(deployButton(page)).toBeEnabled();
    const gameDirectory = path.join(rehearsal.directory, 'game');
    expect(fs.existsSync(path.join(gameDirectory, 'deployment.json'))).toBe(false);
    controls.loseNext = true;
    await deployButton(page).click();
    await expect(page.getByRole('alert')).toContainText('钱包操作未完成');
    await page.reload();
    await page.getByLabel('部署交易哈希', { exact: true }).fill(controls.sent[0]);
    await page.getByRole('button', { name: '检查并恢复交易' }).click();
    await expect(confirmed(page)).toBeVisible();
    await expect(page.getByTestId('nft-game-ready')).toContainText('本轮隔离目录');
    const manifest = JSON.parse(fs.readFileSync(path.join(gameDirectory, 'deployment.json')));
    expect(manifest).toEqual((await rehearsal.status()).body.state.manifest);
    expect(manifest.manifestVersion).toBe(2);
    const authority = new Wallet(fs.readFileSync(path.join(gameDirectory, 'mint-key'), 'utf8').trim());
    expect(manifest.mintSigner).toBe(authority.address);
    const contract = new Contract(manifest.address, manifest.abi, await rehearsal.provider.getSigner(deployer));
    const voucher = { weaponId: hexlify(randomBytes(32)), recipient: deployer, level: 50,
      uri: 'data:application/json;base64,e30=', deadline: (await rehearsal.provider.getBlock('latest')).timestamp + 600, deploymentId: plan.deploymentId };
    const signature = await authority.signTypedData({ name: 'ForgeOfFate', version: '1', chainId: 31338, verifyingContract: manifest.address },
      { Voucher: [{ name: 'weaponId', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'level', type: 'uint256' },
        { name: 'uri', type: 'string' }, { name: 'deadline', type: 'uint256' }, { name: 'deploymentId', type: 'bytes32' }] }, voucher);
    await (await contract.mint(voucher, signature)).wait();
    expect(await contract.ownerOf(BigInt(voucher.weaponId))).toBe(deployer);
    // Read the exported file through the actual Python game and indexer twice.
    // The helper admits 31338 only inside its own disposable test process.
    for (let i = 0; i < 2; i++) {
      const { stdout } = await promisify(execFile)(path.join(root, '.venv/bin/python'),
        ['chain/tests/check_deployment_game.py', gameDirectory, rehearsal.rpc, BigInt(voucher.weaponId).toString()], { cwd: root });
      expect(JSON.parse(stdout)).toEqual({ connected: true, indexed: true, nftCount: 1 });
    }
    const { loadPlan, nftHooks } = require('../../scripts/lib/deployment-modules.cjs');
    const { createService } = require('../../scripts/lib/deployment.cjs');
    const savedPlan = await loadPlan({ root, directory: rehearsal.directory, gameDirectory, module: 'forge-of-fate', deployer,
      provider: rehearsal.provider, network: plan.network, compile: async () => { throw Error('Restart must reuse the build'); } });
    const service = createService({ plan: savedPlan, provider: rehearsal.provider, directory: rehearsal.directory, origin: rehearsal.origin,
      hooks: nftHooks({ plan: savedPlan, provider: rehearsal.provider, gameDirectory }) });
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${service.address().port}/api/deploy/status`);
      expect((await response.json()).state.manifest).toEqual(manifest);
    } finally { await new Promise(resolve => service.close(resolve)); }
    await page.reload(); await expect(confirmed(page)).toBeVisible();
    expect(controls.sent).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Switch to English' }).click();
    expect((await page.locator('main section').allInnerTexts()).join('\n')).not.toMatch(/\p{Script=Han}/u);
    await expect(page.locator('.deployment-banner')).toContainText('Deploy weapon NFTs');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(root, 'test-results/nft-deployment-mobile.png'), fullPage: true });
  });
});

async function wallet(page, rehearsal) {
  const controls = { account: deployer, chainId: '0x1', known: false, connected: false, rejectNext: false, loseNext: false, sent: [], methods: [] };
  await page.exposeFunction('localTestWallet', async request => {
    controls.methods.push(request.method);
    try {
      let result;
      switch (request.method) {
        case 'eth_accounts': result = controls.connected ? [controls.account] : []; break;
        case 'eth_requestAccounts': controls.connected = true; result = [controls.account]; break;
        case 'eth_chainId': result = controls.chainId; break;
        case 'wallet_switchEthereumChain':
          if (!controls.known) return { error: { code: 4902, message: 'Unknown chain' } };
          controls.chainId = request.params[0].chainId; result = null; break;
        case 'wallet_addEthereumChain':
          expect(request.params[0].chainId).toBe('0x7a6a'); controls.known = true; result = null; break;
        case 'eth_sendTransaction':
          if (controls.rejectNext) { controls.rejectNext = false; return { error: { code: 4001, message: 'User rejected' } }; }
          result = await rehearsal.provider.send(request.method, request.params); controls.sent.push(result);
          if (controls.loseNext) { controls.loseNext = false; return { error: { code: -32603, message: 'Disconnected after send' } }; }
          break;
        default: result = await rehearsal.provider.send(request.method, request.params);
      }
      return { result };
    } catch { return { error: { code: -32603, message: 'Local test wallet failure' } }; }
  });
  await page.addInitScript(() => {
    const listeners = {};
    const provider = {
      isMetaMask: true,
      async request(request) { const result = await window.localTestWallet(request); if (result.error) throw Object.assign(new Error(result.error.message), result.error); return result.result; },
      on(event, callback) { (listeners[event] ||= new Set()).add(callback); },
      removeListener(event, callback) { listeners[event]?.delete(callback); },
    };
    window.emitWalletEvent = (event, value) => { for (const callback of listeners[event] || []) callback(value); };
    // EIP-6963 discovery is exercised without window.ethereum.
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns: 'io.metamask' }, provider } })));
  });
  await page.goto(rehearsal.origin + '/deploy');
  await page.getByRole('button', { name: '连接 MetaMask / 切换网络', exact: true }).click();
  await expect(page.getByText('钱包与网络已匹配。', { exact: true })).toBeVisible();
  return controls;
}
const deployButton = page => page.getByRole('button', { name: '部署本地测试合约', exact: true });
const confirmed = page => page.getByRole('status').filter({ hasText: '部署成功，记录已保存' });

test('local deployment: rejection, real receipt, download, refresh and idempotency', async ({ page, rehearsal }) => {
  const controls = await wallet(page, rehearsal);
  expect(controls.methods).toContain('wallet_addEthereumChain');
  controls.rejectNext = true;
  await deployButton(page).click();
  await expect(page.getByRole('alert')).toContainText('你取消了钱包操作。');
  await expect(deployButton(page)).toBeEnabled();
  expect((await rehearsal.status()).body.state.phase).toBe('ready');
  await deployButton(page).click();
  await expect(confirmed(page)).toBeVisible();
  const { body } = await rehearsal.status();
  const manifest = JSON.parse(fs.readFileSync(path.join(rehearsal.directory, 'deployment.json')));
  expect(body.state.manifest).toEqual(manifest);
  expect(manifest.chainId).toBe(31338);
  const contract = new Contract(manifest.address, manifest.abi, rehearsal.provider);
  expect(await contract.deployer()).toBe(deployer);
  expect(await contract.deploymentId()).toBe(body.plan.deploymentId);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载部署记录', exact: true }).click();
  expect(JSON.parse(fs.readFileSync(await (await downloadEvent).path()))).toEqual(manifest);
  await page.reload(); await expect(confirmed(page)).toBeVisible();
  await expect(deployButton(page)).toBeDisabled();
  for (let i = 0; i < 2; i++) expect((await rehearsal.post('record', { deploymentId: body.plan.deploymentId, transactionHash: controls.sent[0] })).body.state.manifest).toEqual(manifest);
  expect(controls.sent).toHaveLength(1);
  expect(fs.existsSync(path.join(rehearsal.directory, 'game.sqlite3'))).toBe(false);
});

test('wrong account/network, parallel intent and unrelated receipts are rejected', async ({ page, rehearsal }) => {
  const controls = await wallet(page, rehearsal);
  controls.account = other;
  await page.evaluate(address => window.emitWalletEvent('accountsChanged', [address]), other);
  await expect(deployButton(page)).toBeDisabled();
  controls.account = deployer; controls.chainId = '0x1';
  await page.evaluate(address => { window.emitWalletEvent('accountsChanged', [address]); window.emitWalletEvent('chainChanged', '0x1'); }, deployer);
  await expect(deployButton(page)).toBeDisabled();
  const { body: { plan } } = await rehearsal.status();
  const data = { deploymentId: plan.deploymentId };
  expect((await rehearsal.post('begin', data, 'https://foreign.example')).code).toBe(403);
  const attempts = await Promise.all([rehearsal.post('begin', data), rehearsal.post('begin', data)]);
  expect(attempts.map(x => x.code).sort()).toEqual([200, 409]);
  expect((await rehearsal.post('record', { ...data, transactionHash: 'no-hash' })).code).toBe(400);
  expect((await rehearsal.post('record', { ...data, transactionHash: '0x' + '1'.repeat(64) })).code).toBe(409);
  const send = params => rehearsal.provider.send('eth_sendTransaction', [params]);
  const wrongFrom = await send({ from: other, data: plan.data, value: '0x0' });
  const transfer = await send({ from: deployer, to: other, value: '0x1' });
  const changedData = plan.data.slice(0, -2) + (plan.data.endsWith('01') ? '02' : '01');
  const tampered = await send({ from: deployer, data: changedData, value: '0x0' });
  for (const transactionHash of [wrongFrom, transfer, tampered]) {
    const result = await rehearsal.post('record', { ...data, transactionHash });
    expect(result.code).toBe(409); expect(result.body.error).toBe('这笔交易不属于当前部署计划。');
  }
  expect(fs.existsSync(path.join(rehearsal.directory, 'deployment.json'))).toBe(false);
  expect((await rehearsal.status()).body.state.phase).toBe('awaiting_wallet');
});

test('lost wallet response recovers after reload; reset cannot show stale success', async ({ page, rehearsal }) => {
  const controls = await wallet(page, rehearsal); controls.loseNext = true;
  await deployButton(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(controls.sent).toHaveLength(1);
  expect((await rehearsal.status()).body.state.phase).toBe('awaiting_wallet');
  await page.reload();
  await expect(page.getByLabel('部署交易哈希', { exact: true })).toBeVisible();
  await expect(deployButton(page)).toBeDisabled();
  await page.getByLabel('部署交易哈希', { exact: true }).fill(controls.sent[0]);
  await page.getByRole('button', { name: '检查并恢复交易', exact: true }).click();
  await expect(confirmed(page)).toBeVisible();
  expect(controls.sent).toHaveLength(1);
  await rehearsal.provider.send('hardhat_reset', []);
  await expect(page.getByRole('status')).toHaveText('暂时无法核验部署状态');
  await expect(page.getByRole('button', { name: '下载部署记录', exact: true })).toHaveCount(0);
  await expect(deployButton(page)).toBeDisabled();
  expect(fs.existsSync(path.join(rehearsal.directory, 'deployment.json'))).toBe(true);
});

test('pending receipt resumes after reload without resending, mobile English layout', async ({ page, rehearsal }) => {
  const controls = await wallet(page, rehearsal);
  await rehearsal.provider.send('evm_setAutomine', [false]);
  await deployButton(page).click();
  await expect(page.getByRole('status')).toHaveText('等待本地链确认');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('等待本地链确认');
  const { body: { plan } } = await rehearsal.status();
  expect((await rehearsal.post('begin', { deploymentId: plan.deploymentId })).code).toBe(409);
  // MetaMask's speed-up replaces the pending transaction with the same nonce.
  const original = await rehearsal.provider.getTransaction(controls.sent[0]);
  const replacement = await rehearsal.provider.send('eth_sendTransaction', [{ from: deployer, data: plan.data, value: '0x0',
    nonce: '0x' + original.nonce.toString(16), gas: '0x' + original.gasLimit.toString(16),
    maxFeePerGas: '0x' + (original.maxFeePerGas * 2n).toString(16), maxPriorityFeePerGas: '0x' + (original.maxPriorityFeePerGas * 2n).toString(16) }]);
  const recovered = await rehearsal.post('record', { deploymentId: plan.deploymentId, transactionHash: replacement });
  expect(recovered.code).toBe(200); expect(recovered.body.state.transactionHash).toBe(replacement);
  await rehearsal.provider.send('evm_mine', []);
  await expect(confirmed(page)).toBeVisible();
  expect((await rehearsal.status()).body.state.manifest.deploymentTransaction).toBe(replacement);
  expect(controls.sent).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contract deployment workspace' })).toBeVisible();
  expect((await page.locator('main section').allInnerTexts()).join('\n')).not.toMatch(/\p{Script=Han}/u);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(root, 'test-results/deployment-mobile.png'), fullPage: true });
});

test('without a wallet, shows setup instructions and never enables deployment', async ({ page, rehearsal }) => {
  await page.goto(rehearsal.origin + '/deploy');
  await expect(page.getByText('未检测到 MetaMask，请在安装扩展的浏览器中打开此地址。')).toBeVisible();
  await expect(deployButton(page)).toBeDisabled();
  expect((await rehearsal.status()).body.state.phase).toBe('ready');
});

test('a failed creation receipt allows a fresh attempt; saved records survive API reconstruction', async ({ page, rehearsal }) => {
  await wallet(page, rehearsal);
  const { body: { plan } } = await rehearsal.status();
  await rehearsal.post('begin', { deploymentId: plan.deploymentId });
  await rehearsal.provider.send('evm_setAutomine', [false]);
  const tx = { from: deployer, data: plan.data, value: '0x0' };
  const gas = BigInt(await rehearsal.provider.send('eth_estimateGas', [tx]));
  const hash = await rehearsal.provider.send('eth_sendTransaction', [{ ...tx, gas: '0x' + (gas - 1000n).toString(16) }]);
  await rehearsal.provider.send('evm_mine', []);
  const failed = await rehearsal.post('record', { deploymentId: plan.deploymentId, transactionHash: hash });
  expect(failed.body.state.phase).toBe('failed');
  expect(fs.existsSync(path.join(rehearsal.directory, 'deployment.json'))).toBe(false);
  await rehearsal.provider.send('evm_setAutomine', [true]);
  await page.reload(); await expect(deployButton(page)).toBeEnabled();
  await deployButton(page).click(); await expect(confirmed(page)).toBeVisible();

  // Recreate only the verification service against its saved plan/state and the
  // same live chain. The normal launcher intentionally creates a fresh rehearsal.
  const { createService } = require('../../scripts/lib/deployment.cjs');
  const saved = JSON.parse(fs.readFileSync(path.join(rehearsal.directory, 'deployment.json')));
  const service = createService({ plan, provider: rehearsal.provider, directory: rehearsal.directory, origin: rehearsal.origin });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${service.address().port}/api/deploy/status`);
    expect((await response.json()).state.manifest).toEqual(saved);
  } finally { await new Promise(resolve => service.close(resolve)); }
});

test('Sepolia UI shows test-ETH fees, switches only to Sepolia and never adds a private RPC', async ({ page, rehearsal }) => {
  const response = (await rehearsal.status()).body;
  response.plan.network = { chainId: 11155111, chainName: 'Ethereum Sepolia', rpcUrls: [], nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 } };
  response.balanceWei = '0'; response.healthy = true;
  await page.route('**/api/deploy/status', route => route.fulfill({ json: response }));
  await page.addInitScript(address => {
    window.walletRequests = [];
    window.ethereum = { isMetaMask: true, async request(request) {
      window.walletRequests.push(request);
      if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') return [address];
      if (request.method === 'eth_chainId') return '0x1';
      if (request.method === 'wallet_switchEthereumChain') throw Object.assign(new Error('Unknown chain'), { code: 4902 });
      throw Error('Unexpected wallet operation');
    } };
  }, deployer);
  await page.goto(rehearsal.origin + '/deploy');
  await expect(page.getByText('项目钱包暂无 Sepolia 测试 ETH，请先补充测试币用于手续费。')).toBeVisible();
  await expect(page.getByRole('button', { name: '部署到 Sepolia', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '连接 MetaMask / 切换网络', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请在 MetaMask 中开启显示测试网络，并选择 Ethereum Sepolia。');
  const requests = await page.evaluate(() => window.walletRequests);
  expect(requests.find(request => request.method === 'wallet_switchEthereumChain').params).toEqual([{ chainId: '0xaa36a7' }]);
  expect(requests.some(request => ['wallet_addEthereumChain', 'eth_sendTransaction'].includes(request.method))).toBe(false);
  expect(await page.locator('main').innerText()).not.toContain('本地测试 ETH');
});

test('Sepolia UI waits for finality, displays explorer links and disables stale success', async ({ page, rehearsal }) => {
  const response = (await rehearsal.status()).body;
  response.plan.network = { chainId: 11155111, chainName: 'Ethereum Sepolia', rpcUrls: [], nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 } };
  const hash = '0x' + 'a'.repeat(64);
  response.balanceWei = '1000000000000000'; response.healthy = true;
  response.state = { phase: 'confirming', transactionHash: hash, deploymentBlock: 20, finalizedBlock: 10 };
  await page.route('**/api/deploy/status', route => route.fulfill({ json: response }));
  await page.goto(rehearsal.origin + '/deploy');
  await expect(page.getByRole('status')).toHaveText('等待 Sepolia 最终确认');
  await expect(page.getByRole('button', { name: '下载部署记录' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: hash })).toHaveAttribute('href', 'https://sepolia.etherscan.io/tx/' + hash);
  response.state = { ...response.state, phase: 'confirmed', manifest: { address: other, deploymentBlock: 20 } };
  await page.reload(); await expect(confirmed(page)).toBeVisible();
  await expect(page.getByRole('link', { name: '在区块浏览器查看合约' })).toHaveAttribute('href', 'https://sepolia.etherscan.io/address/' + other);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Switch to English' }).click();
  expect((await page.locator('main section').allInnerTexts()).join('\n')).not.toMatch(/\p{Script=Han}/u);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(root, 'test-results/sepolia-deployment-mobile.png'), fullPage: true });
  response.healthy = false; response.warning = '节点或记录暂不可用，请保留交易哈希后重试。';
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Unable to verify deployment status');
  await expect(page.getByRole('button', { name: 'Download deployment record' })).toHaveCount(0);
});
