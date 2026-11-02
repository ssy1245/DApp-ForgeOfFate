const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const {Wallet}=require('ethers');
const epoch='0x'+'ab'.repeat(32),contract='0x'+'34'.repeat(20),hash='0x'+'cd'.repeat(32);
async function setup(page,game,withCard=false){
 const account=await register(page,false,game),wallet=Wallet.createRandom();
 game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[wallet.address,account.address]);
 const record={hash,account:wallet.address,contract,epoch,chainId:11155111,label:'挂牌 NFT',...(withCard?{tokenId:'42'}:{})};
 const chain={address:contract,deploymentId:epoch,chainId:11155111,abi:[]};
 let currentChain=chain,receipt={chainId:11155111,deploymentId:epoch,state:'confirming',receipt:{hash,from:wallet.address,status:1,finalized:false}};
 let items=withCard?[{id:'42',owner:wallet.address,seller:'0x'+'00'.repeat(20),price:'0',level:70,uri:''}]:[],offline=false;
 const install=async target=>{
  await target.addInitScript(address=>{window.ethereum={on(){},removeListener(){},request:async({method})=>method==='eth_accounts'?[address]:method==='eth_chainId'?'0xaa36a7':null};},wallet.address);
  await target.route('**/api/chain/tasks',route=>route.fulfill({json:{id:'test-task',state:'pending',checkInterval:30}}));
 await target.route('**/api/config',async route=>{const response=await route.fetch();const data=await response.json();data.network.chainId=11155111;data.chain=currentChain;data.chain_error=null;await route.fulfill({json:data});});
  await target.route('**/api/chain/nfts?*',route=>offline?route.fulfill({status:503,json:{detail:'offline'}}):route.fulfill({json:{chainId:11155111,deploymentId:currentChain.deploymentId,blockNumber:20,total:items.length,items,proceeds:'0'}}));
  await target.route('**/api/chain/receipts/*',route=>route.fulfill({json:receipt}));
 };
 await install(page);
 const key=`forge:transaction:11155111:${contract}:${epoch}:${hash}`;
 await page.evaluate(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key,record});
 await page.reload();await expect(page.locator('.pending')).toBeVisible();
 return{record,key,install,wallet,setItems(value){items=value;},setOffline(value){offline=value;},setReceipt(data){receipt=data;},getReceipt(){return receipt;},setChain(value){currentChain=value;},chain};
}
const check=page=>page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
const saved=(page,key)=>page.evaluate(key=>localStorage.getItem(key),key);

test('included transactions survive reload and a new tab; final success clears the shared record',async({page,game,context})=>{
 const s=await setup(page,game);await check(page);await expect(page.locator('.notice')).toContainText('仍待最终确认');expect(await saved(page,s.key)).not.toBeNull();
 const other=await context.newPage();await s.install(other);await other.goto(game.url);await expect(other.locator('.pending')).toBeVisible();
 s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});
 await check(other);await expect(other.locator('.notice')).toContainText('挂牌 NFT已确认');await expect(other.locator('.pending')).toHaveCount(0);await expect(page.locator('.pending')).toHaveCount(0);expect(await saved(page,s.key)).toBeNull();await other.close();
});
test('a reverted but unfinalized transaction stays pending until final failure',async({page,game})=>{
 const s=await setup(page,game);s.setReceipt({...s.getReceipt(),receipt:{...s.getReceipt().receipt,status:0}});await check(page);await expect(page.locator('.pending')).toBeVisible();expect(await saved(page,s.key)).not.toBeNull();
 s.setReceipt({...s.getReceipt(),state:'failed',receipt:{...s.getReceipt().receipt,finalized:true}});await check(page);await expect(page.locator('.notice')).toContainText('交易执行失败');await expect(page.locator('.pending')).toHaveCount(0);
});
for(const mismatch of ['sender','hash','epoch'])test(`a receipt with mismatched ${mismatch} cannot clear the original pending record`,async({page,game})=>{
 const s=await setup(page,game),r={...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}};
 if(mismatch==='sender')r.receipt.from=contract;else if(mismatch==='hash')r.receipt.hash=epoch;else r.deploymentId=hash;
 s.setReceipt(r);await check(page);await expect(page.locator('.notice.error')).toBeVisible();await expect(page.locator('.pending')).toBeVisible();expect(await saved(page,s.key)).not.toBeNull();
});
test('changing deployments hides but preserves the original transaction; switching back recovers it',async({page,game})=>{
 const s=await setup(page,game);s.setChain({...s.chain,deploymentId:hash});await check(page);await expect(page.locator('.notice')).toContainText('记录已保留');await expect(page.locator('.pending')).toHaveCount(0);expect(await saved(page,s.key)).not.toBeNull();
 s.setChain(s.chain);await page.reload();await expect(page.locator('.pending')).toBeVisible();
});
test('a missing receipt after a reorg remains pending and is never reported as failed',async({page,game})=>{
 const s=await setup(page,game);s.setReceipt({...s.getReceipt(),state:'pending',receipt:null});await check(page);await expect(page.locator('.notice')).toContainText('仍待最终确认');expect(await saved(page,s.key)).not.toBeNull();
});

test('a restored successful transaction checks finality automatically without another wallet send',async({page,game})=>{
 const s=await setup(page,game);
 await expect(page.locator('.pending-progress')).toContainText('链上执行成功');
 s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});
 await expect(page.locator('.pending')).toHaveCount(0,{timeout:40000});
 expect(await saved(page,s.key)).toBeNull();
 await expect(page.locator('.notice')).toContainText('挂牌 NFT已确认');
});
test('automatic receipt checks survive RPC failure and resume on focus without clearing the record',async({page,game})=>{
 const s=await setup(page,game);let available=false;
 await page.route('**/api/chain/receipts/*',route=>available?route.fulfill({json:{...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}}}):route.fulfill({status:503,json:{detail:'offline'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.pending-progress')).toContainText('稍后自动重试');
 expect(await saved(page,s.key)).not.toBeNull();available=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.pending')).toHaveCount(0);
 expect(await saved(page,s.key)).toBeNull();
});

const market=async page=>{await page.locator('.nav-item').nth(2).click();return page.locator('.weapon-card[data-nft]');};
test('card restores pending progress, then updates listing and price after finality',async({page,game})=>{
 const s=await setup(page,game,true),card=await market(page);
 await expect(card.locator('.card-status')).toHaveText('等待链上确认');
 await expect(card.locator('.nft-action-feedback')).toContainText('链上执行成功');
 await expect(card.getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 s.setItems([{id:'42',owner:s.wallet.address,seller:s.wallet.address,price:'10000000000000000',level:70,uri:''}]);
 s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});
 await check(page);
 await expect(card.locator('.card-status')).toHaveText('正在出售');
 await expect(card.locator('.card-valuation')).toContainText('0.01');
 await expect(card.locator('.nft-action-feedback')).toContainText('挂牌 NFT已确认');
 await expect(card.getByRole('button',{name:'更新价格',exact:true})).toBeEnabled();
 await page.screenshot({path:'test-results/browser/market-card-feedback.png',fullPage:true});
});
test('external transfer refreshes owner and removes old owner controls on manual refresh',async({page,game})=>{
 const s=await setup(page,game,true),card=await market(page);
 s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});await check(page);
 await expect(card.locator('.card-status')).toHaveText('在你的钱包 · 未挂牌');
 const owner=Wallet.createRandom().address;
 s.setItems([{id:'42',owner,seller:'0x'+'00'.repeat(20),price:'0',level:70,uri:''}]);
 await page.getByRole('button',{name:'↻ 刷新状态',exact:true}).click();
 await expect(card).toHaveCount(0);
 await expect(page.getByText('暂无持有的 NFT',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'在售市场',exact:true}).click();
 await expect(card).toHaveCount(0);
});
test('failed transaction stays unlisted and gives inline retry feedback',async({page,game})=>{
 const s=await setup(page,game,true),card=await market(page);
 s.setReceipt({...s.getReceipt(),state:'failed',receipt:{...s.getReceipt().receipt,status:0,finalized:true}});await check(page);
 await expect(card.locator('.nft-action-feedback.error')).toContainText('交易执行失败');
 await expect(card.locator('.card-status')).toHaveText('在你的钱包 · 未挂牌');
 await expect(card.getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
});
test('failed post-transaction sync disables stale controls and recovers on manual refresh',async({page,game})=>{
 const s=await setup(page,game,true),card=await market(page);
 s.setOffline(true);s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});await check(page);
 await expect(page.locator('.market-sync-error')).toBeVisible();
 await expect(card.getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 s.setOffline(false);await page.getByRole('button',{name:'↻ 刷新状态',exact:true}).click();
 await expect(page.locator('.market-sync-error')).toHaveCount(0);
 await expect(card.getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
});

test('collection and market separate ownership from active listings; gifting has no UI',async({page,game})=>{
 const s=await setup(page,game,true),card=await market(page);
 await expect(page.getByLabel('接收钱包地址',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'直接转移',exact:true})).toHaveCount(0);
 s.setReceipt({...s.getReceipt(),state:'confirmed',receipt:{...s.getReceipt().receipt,finalized:true}});await check(page);
 const buyer=Wallet.createRandom().address;
 s.setItems([{id:'42',owner:buyer,seller:buyer,price:'10000000000000000',level:70,uri:''}]);
 await page.getByRole('button',{name:'↻ 刷新状态',exact:true}).click();
 await expect(card).toHaveCount(0);
 await page.getByRole('button',{name:'在售市场',exact:true}).click();
 await expect(card).toHaveCount(1);
 await expect(card.getByRole('button',{name:'购买收藏品',exact:true})).toBeEnabled();
});
