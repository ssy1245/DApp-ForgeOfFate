const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const {Wallet}=require('ethers');
const epoch='0x'+'ab'.repeat(32),contract='0x'+'34'.repeat(20),hash='0x'+'cd'.repeat(32);
async function setup(page,game){
 const account=await register(page,false,game),wallet=Wallet.createRandom();
 game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[wallet.address,account.address]);
 const record={hash,account:wallet.address,contract,epoch,chainId:11155111,label:'挂牌 NFT'};
 const chain={address:contract,deploymentId:epoch,chainId:11155111,abi:[]};
 let currentChain=chain,receipt={chainId:11155111,deploymentId:epoch,state:'confirming',receipt:{hash,from:wallet.address,status:1,finalized:false}};
 const install=async target=>{
  await target.addInitScript(address=>{window.ethereum={on(){},removeListener(){},request:async({method})=>method==='eth_accounts'?[address]:method==='eth_chainId'?'0xaa36a7':null};},wallet.address);
  await target.route('**/api/config',async route=>{const response=await route.fetch();const data=await response.json();data.network.chainId=11155111;data.chain=currentChain;data.chain_error=null;await route.fulfill({json:data});});
  await target.route('**/api/chain/nfts?*',route=>route.fulfill({json:{chainId:11155111,deploymentId:currentChain.deploymentId,blockNumber:20,total:0,items:[],proceeds:'0'}}));
  await target.route('**/api/chain/receipts/*',route=>route.fulfill({json:receipt}));
 };
 await install(page);
 const key=`forge:transaction:11155111:${contract}:${epoch}:${hash}`;
 await page.evaluate(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key,record});
 await page.reload();await expect(page.locator('.pending')).toBeVisible();
 return{record,key,install,setReceipt(data){receipt=data;},getReceipt(){return receipt;},setChain(value){currentChain=value;},chain};
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
