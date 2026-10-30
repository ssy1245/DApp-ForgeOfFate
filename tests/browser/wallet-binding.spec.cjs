const { test, expect, register, state, consistent } = require('./fixtures.cjs');
const { Wallet, getBytes } = require('ethers');

async function installWallet(page, wallet) {
  await page.exposeFunction('walletProof', async message => wallet.signMessage(getBytes(message)));
  await page.addInitScript(address => {
    const listeners = {};
    window.testWallet = { address, chain: '0x7a69', reject: false, hold: false, signed: 0, transactions: 0 };
    window.ethereum = {
      on(name, fn) { (listeners[name] ||= []).push(fn); },
      removeListener(name, fn) { listeners[name] = (listeners[name] || []).filter(item => item !== fn); },
      async request({ method, params }) {
        const w = window.testWallet;
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [w.address];
        if (method === 'eth_chainId') return w.chain;
        if (method === 'wallet_switchEthereumChain') { w.chain = params[0].chainId; return null; }
        if (method === 'personal_sign') {
          w.signed++;
          if (w.reject) throw Object.assign(new Error('Rejected'), { code: 4001 });
          if (w.hold) await new Promise(resolve => { w.release = resolve; });
          return window.walletProof(params[0]);
        }
        if (method === 'eth_sendTransaction') { w.transactions++; throw Error('No transactions expected'); }
        throw Error('Unexpected method: ' + method);
      },
    };
    window.changeWallet = (address, chain = window.testWallet.chain) => {
      window.testWallet.address = address; window.testWallet.chain = chain;
      for (const fn of listeners.accountsChanged || []) fn([address]);
      for (const fn of listeners.chainChanged || []) fn(chain);
    };
  }, wallet.address);
}

test('explicit proof binds without moving save; switching wallets and networks preserves account', async ({ page, game }, testInfo) => {
  const wallet = Wallet.createRandom();
  await installWallet(page, wallet);
  const account = await register(page, false, game);
  await page.getByRole('button', { name: '领取每日补给', exact: false }).click();
  await expect.poll(async () => (await state(page)).player.materials).toBeGreaterThan(0);
  const before = await state(page);
  await page.getByRole('button', { name: '绑定钱包', exact: true }).click();
  await expect(page.locator('.wallet-status')).toContainText('已验证，钱包已就绪');
  await page.screenshot({path:testInfo.outputPath('wallet-bound.png'),fullPage:true});
  const after = await consistent(page, game, account.address);
  expect(after.player.player_id).toBe(before.player.player_id);
  expect(after.player.materials).toBe(before.player.materials);
  expect(after.player.wallet_address).toBe(wallet.address);
  expect(await page.evaluate(() => window.testWallet.transactions)).toBe(0);
  await page.evaluate(address => window.changeWallet(address), Wallet.createRandom().address);
  await expect(page.locator('.wallet-status')).toContainText('当前钱包不匹配');
  expect((await state(page)).player.address).toBe(account.address);
  await expect(page.locator('.account-name')).toContainText(account.username);
  await page.evaluate(address => window.changeWallet(address, '0x1'), wallet.address);
  await expect(page.locator('.wallet-status')).toContainText('请切换到游戏所用网络');
  await game.restart(); await page.reload();
  await expect(page.locator('.wallet-status')).toContainText('已验证，钱包已就绪');
  await consistent(page, game, account.address);
});

test('rejected signature leaves wallet unbound and account intact', async ({ page, game }) => {
  await installWallet(page, Wallet.createRandom());
  const account = await register(page, false, game);
  await page.evaluate(() => { window.testWallet.reject = true; });
  await page.getByRole('button', { name: '绑定钱包', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('操作已取消');
  await expect(page.locator('.wallet-status')).toContainText('尚未绑定钱包');
  expect((await state(page)).player.wallet_address).toBeNull();
  expect((await state(page)).player.address).toBe(account.address);
});

test('second account cannot bind a wallet owned by another account', async ({ page, game }) => {
  await installWallet(page, Wallet.createRandom());
  await register(page, false, game);
  await page.getByRole('button', { name: '绑定钱包', exact: true }).click();
  await expect(page.locator('.wallet-status')).toContainText('已验证，钱包已就绪');
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await register(page, false, game);
  await page.getByRole('button', { name: '绑定钱包', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('此钱包已绑定其他账号');
  expect((await state(page)).player.wallet_address).toBeNull();
});

test('wallet changes during signature never bind the wrong account', async ({ page, game }) => {
  const wallet = Wallet.createRandom();
  await installWallet(page, wallet);
  const account = await register(page, false, game);
  await page.evaluate(() => { window.testWallet.hold = true; });
  await page.getByRole('button', { name: '绑定钱包', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testWallet.signed)).toBe(1);
  await page.evaluate(address => { window.changeWallet(address); window.testWallet.release(); }, Wallet.createRandom().address);
  await expect(page.locator('.notice')).toContainText('钱包已变化');
  expect((await state(page)).player.wallet_address).toBeNull();
  expect((await state(page)).player.address).toBe(account.address);
});


test('verified wallet mismatch disables NFT actions while ordinary game stays available', async ({ page, game }) => {
  const wallet = Wallet.createRandom();
  const deploymentId = '0x' + 'ab'.repeat(32);
  await installWallet(page, wallet);
  await page.route('**/api/config', async route => {
    const response = await route.fetch(); const data = await response.json();
    data.chain = {address:Wallet.createRandom().address,abi:[],chainId:31337,deploymentId};data.chain_error=null;
    await route.fulfill({json:data});
  });
  await page.route('**/api/chain/nfts?*', route => route.fulfill({json:{
    chainId:31337,deploymentId,blockNumber:1,total:1,proceeds:'0',
    items:[{id:'42',owner:wallet.address,seller:'0x'+'0'.repeat(40),price:'0',level:50,uri:''}],
  }}));
  await register(page, false, game);
  await page.getByRole('button', {name:'绑定钱包',exact:true}).click();
  await expect(page.locator('.wallet-status')).toContainText('已验证，钱包已就绪');
  await page.locator('.nav-item').nth(2).click();
  await expect(page.getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
  await page.evaluate(address=>window.changeWallet(address),Wallet.createRandom().address);
  await expect(page.getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'直接转移',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'领取每日补给',exact:false})).toBeEnabled();
  expect(await page.evaluate(()=>window.testWallet.transactions)).toBe(0);
});
