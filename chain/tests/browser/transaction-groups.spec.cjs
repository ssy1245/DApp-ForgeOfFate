const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const {Wallet,Interface,keccak256,toUtf8Bytes}=require('ethers');
const nftArtifact=require('../../artifacts/contracts/ForgeOfFate.sol/ForgeOfFate.json');
const stakingArtifact=require('../../artifacts/contracts/ForgeStaking.sol/ForgeStaking.json');
const rechargeArtifact=require('../../artifacts/contracts/ForgeRecharge.sol/ForgeRecharge.json');
const nft='0x'+'34'.repeat(20),recharge='0x'+'56'.repeat(20),epoch='0x'+'ef'.repeat(32);
const staking='0x'+'78'.repeat(20);
const hashes={staking:'0x'+'de'.repeat(32),nft:'0x'+'ab'.repeat(32),recharge:'0x'+'cd'.repeat(32)};
const hashForToken=id=>id==='42'?hashes.nft:keccak256(toUtf8Bytes('NFT '+id));
const group=(page,target)=>page.locator(`.pending[data-transaction-group="${target}"]`);
const openRecharge=page=>page.locator('.nav-item').filter({hasText:'充值金币'}).click();
const openMarket=page=>page.locator('.nav-item').filter({hasText:'命运集市'}).click();
const confirm=page=>page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();
const check=(page,target)=>group(page,target).getByRole('button',{name:'检查待确认交易',exact:true}).click();

async function setup(page,game,{saved=[],nftOffline=false,tokens=['42'],listed=false}={}){
 const account=await register(page,false,game),wallet=Wallet.createRandom();
 game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[wallet.address,account.address]);
 const abis={nft:new Interface(nftArtifact.abi),recharge:new Interface(rechargeArtifact.abi)};
 const control={purchaseRequests:[],purchaseConflict:false,sends:[],tasks:[],nftOffline,tokens,results:{},holdWallet:false,releaseWallet:null,final:{nft:false,recharge:false,staking:false},failed:{nft:false,recharge:false,staking:false},credited:false};
 const records={
  staking:{hash:hashes.staking,account:wallet.address,contract:staking,epoch,chainId:11155111,label:'质押 NFT',tokenId:'42',target:'staking'},
  nft:{hash:hashes.nft,account:wallet.address,contract:nft,epoch,chainId:11155111,label:'铭刻 NFT',tokenId:'42'},
  recharge:{hash:hashes.recharge,account:wallet.address,contract:recharge,epoch,chainId:11155111,label:'充值游戏金币',target:'recharge',amountWei:'10000000000000000',submittedAt:1793440000000}
 };
 const key=p=>`forge:transaction:${p.chainId}:${p.contract}:${p.epoch}:${p.hash}`;
 await page.exposeFunction('groupRpc',async({method,params})=>{
  if(method==='eth_blockNumber')return '0x20';
  if(method==='eth_estimateGas')return '0x20000';
  if(method==='eth_sendTransaction'){
   const tx=params[0],target=tx.to.toLowerCase()===recharge?'recharge':'nft';
   const tokenId=target==='nft'?abis.nft.parseTransaction({data:tx.data}).args[0].toString():undefined,hash=target==='nft'?hashForToken(tokenId):hashes.recharge;
   control.sends.push({target,tx,hash,tokenId});
   if(control.holdWallet)await new Promise(resolve=>{control.releaseWallet=resolve;});
   return hash;
  }
  if(method==='eth_getTransactionByHash'){
   const {target,tx,hash}=control.sends.find(s=>s.hash===params[0]);
   return {hash,from:wallet.address,to:tx.to,input:tx.data,value:tx.value||'0x0',nonce:target==='nft'?'0x0':'0x1',gas:'0x20000',gasPrice:'0x1',chainId:'0xaa36a7',type:'0x0',v:'0x1b',r:'0x'+'11'.repeat(32),s:'0x'+'22'.repeat(32),blockNumber:null,blockHash:null,transactionIndex:null};
  }
  if(method==='eth_call'){
   const target=params[0].to.toLowerCase()===recharge?'recharge':'nft',abi=abis[target],call=abi.parseTransaction({data:params[0].data});
   if(call.name==='deploymentId')return abi.encodeFunctionResult(call.name,[epoch]);
   if(call.name==='treasury')return abi.encodeFunctionResult(call.name,[wallet.address]);
   if(call.name==='deposit')return abi.encodeFunctionResult(call.name,[1]);
  }
  throw Error('Unexpected RPC '+method);
 });
 await page.addInitScript(address=>{
  window.ethereum={on(){},removeListener(){},async request(r){
   if(['eth_accounts','eth_requestAccounts'].includes(r.method))return [address];
   if(r.method==='eth_chainId')return '0xaa36a7';
   if(r.method==='eth_sendTransaction'&&window.purchaseError)throw {code:window.purchaseError,message:'Wallet request failed'};
   return window.groupRpc(r);
  }};
 },wallet.address);
 await page.route('**/api/config',async route=>{
  const r=await route.fetch(),d=await r.json();d.network.chainId=11155111;
  d.chain={address:nft,chainId:11155111,deploymentId:epoch,abi:nftArtifact.abi};d.chain_error=null;
  d.staking={address:staking,chainId:11155111,deploymentId:epoch,nftAddress:nft,abi:stakingArtifact.abi,dailyCoins:1000};
  d.recharge={address:recharge,chainId:11155111,deploymentId:epoch,abi:rechargeArtifact.abi,treasury:wallet.address,weiPerUnit:'10000000000000000',coinsPerUnit:10000,ready:true};
  await route.fulfill({json:d});
 });
 await page.route('**/api/chain/purchases{,/**}',route=>{
  const path=new URL(route.request().url()).pathname;
  control.purchaseRequests.push({path,body:route.request().postDataJSON()});
  if(control.purchaseConflict&&path.endsWith('/purchases'))return route.fulfill({status:409,json:{detail:'该 NFT 正在被购买，请等待交易完成后刷新。'}});
  return route.fulfill({json:path.endsWith('/purchases')?{id:'aa'.repeat(32),expiresAt:Date.now()/1000+300}:{ok:true}});
 });
 await page.route('**/api/chain/tasks',route=>{control.tasks.push(route.request().postDataJSON());return route.fulfill({json:{id:'test-task',state:'pending',checkInterval:30}});});
 await page.route('**/api/chain/nfts?*',route=>route.fulfill({json:{chainId:11155111,deploymentId:epoch,blockNumber:20,total:control.tokens.length,proceeds:'10000000000000000',items:control.tokens.map(id=>({id,owner:listed?nft:wallet.address,seller:listed?nft:'0x'+'00'.repeat(20),price:listed?'10000000000000000':'0',level:70,uri:''}))}}));
 await page.route('**/api/chain/recharge?*',route=>route.fulfill({json:{account:wallet.address,total:0,items:[]}}));
 await page.route('**/api/chain/recharge/treasury',route=>route.fulfill({status:403,json:{detail:'no access'}}));
 await page.route('**/api/chain/staking',route=>route.fulfill({json:{account:wallet.address,deploymentId:epoch,chainId:11155111,blockNumber:20,available:control.tokens.map(tokenId=>({tokenId,approved:false})),positions:[]}}));
 const receipt=(target,hash)=>{
  const outcome=control.results[hash]||{final:control.final[target],failed:control.failed[target]};
  return {chainId:11155111,deploymentId:epoch,state:outcome.final?(outcome.failed?'failed':'confirmed'):'confirming',credit:target==='recharge'&&control.credited?{state:'credited',coins:'10000'}:null,receipt:{hash,from:wallet.address,status:outcome.failed?0:1,finalized:outcome.final}};
 };
 for(const [target,path] of [['nft',''],['staking','staking/'],['recharge','recharge/']])await page.route(`**/api/chain/${path}receipts/*`,route=>target==='nft'&&control.nftOffline?route.fulfill({status:503,json:{detail:'offline'}}):route.fulfill({json:receipt(target,route.request().url().split('/').at(-1))}));
 for(const target of saved)await page.evaluate(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key:key(records[target]),record:records[target]});
 await page.reload();await expect(page.locator('.account-name')).toContainText(account.username);
 return {control,records,key,account,wallet};
}
async function listNFT(page,token='42'){
 await openMarket(page);
 const card=page.locator(`.weapon-card[data-nft][data-weapon-id="${token}"]`),button=card.getByRole('button',{name:'挂牌出售',exact:true});
 await button.click();await card.getByRole('textbox',{name:'挂牌价格',exact:true}).fill('0.01');await button.click();
}
async function deposit(page){
 await openRecharge(page);await page.getByRole('button',{name:'确认充值',exact:true}).click();await confirm(page);
}

test('broadcast releases the shared wallet prompt; both groups persist independently and recover after reload',async({page,game})=>{
 const s=await setup(page,game);
 await listNFT(page);await expect(group(page,'nft')).toContainText('链上执行成功');
 await expect(page.getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 await deposit(page);await expect(group(page,'recharge')).toContainText('链上执行成功');
 await expect(page.locator('.pending')).toHaveCount(2);await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 expect(s.control.sends.map(s=>s.target)).toEqual(['nft','recharge']);
 expect(s.control.tasks.some(t=>t.target==='nft'&&t.tx_hash===hashes.nft)).toBe(true);
 expect(s.control.tasks.some(t=>t.target==='recharge'&&t.tx_hash===hashes.recharge)).toBe(true);
 await page.reload();await openRecharge(page);await expect(page.locator('.pending')).toHaveCount(2);
 s.control.final.recharge=true;await check(page,'recharge');
 await expect(page.locator('.recharge-progress')).toContainText('等待金币入账');
 await expect(group(page,'nft')).toContainText('链上执行成功');
 await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 s.control.final.nft=true;s.control.failed.nft=true;await check(page,'nft');
 await expect(group(page,'nft')).toHaveCount(0);await expect(group(page,'recharge')).toBeVisible();
 await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 await openMarket(page);await expect(page.getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
 s.control.credited=true;await check(page,'recharge');await expect(page.locator('.pending')).toHaveCount(0);
 await openRecharge(page);await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeEnabled();
 expect(s.control.sends).toHaveLength(2);
});

test('a saved mint allows a recharge, while NFT actions remain locked',async({page,game})=>{
 const s=await setup(page,game,{saved:['nft']});
 await openMarket(page);await expect(page.getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 await deposit(page);await expect(page.locator('.pending')).toHaveCount(2);
 expect(s.control.sends.map(s=>s.target)).toEqual(['recharge']);
});

test('a saved recharge allows an NFT transaction, while recharge remains locked',async({page,game})=>{
 const s=await setup(page,game,{saved:['recharge']});
 await openRecharge(page);await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 await listNFT(page);await expect(page.locator('.pending')).toHaveCount(2);
 expect(s.control.sends.map(s=>s.target)).toEqual(['nft']);
});

test('an unavailable NFT receipt does not prevent automatic recharge completion or clear its NFT record',async({page,game})=>{
 const s=await setup(page,game,{saved:['nft','recharge'],nftOffline:true});
 await expect(group(page,'nft')).toContainText('稍后自动重试');
 await expect(group(page,'recharge')).toContainText('链上执行成功');
 s.control.final.recharge=true;s.control.credited=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(group(page,'recharge')).toHaveCount(0);await expect(group(page,'nft')).toBeVisible();
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key(s.records.nft))).not.toBeNull();
 expect(s.control.sends).toHaveLength(0);
});

test('wallet signing remains serial, then the other group unlocks immediately after broadcast',async({page,game})=>{
 const s=await setup(page,game);s.control.holdWallet=true;
 await listNFT(page);await expect.poll(()=>s.control.sends.length).toBe(1);
 await openRecharge(page);await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 s.control.holdWallet=false;s.control.releaseWallet();
 await expect(group(page,'nft')).toBeVisible();await expect(page.getByRole('button',{name:'确认充值',exact:true})).toBeEnabled();
 // Let the post-broadcast config read finish before closing its browser context.
 await expect(group(page,'nft')).toContainText('链上执行成功');
});

const nftCard=(page,id)=>page.locator(`.weapon-card[data-nft][data-weapon-id="${id}"]`);
test('each NFT locks independently; one polling pass completes multiple weapons without clearing another',async({page,game})=>{
 const s=await setup(page,game,{saved:['nft'],tokens:['42','43','44']});
 await openMarket(page);
 await expect(nftCard(page,'42').getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 await expect(nftCard(page,'43').getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'提取',exact:true})).toBeEnabled();
 await listNFT(page,'43');await expect(page.locator('.pending[data-token-id="43"]')).toBeVisible();
 await expect(nftCard(page,'43').getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 await listNFT(page,'44');await expect(group(page,'nft')).toHaveCount(3);
 expect(s.control.sends.map(tx=>tx.tokenId)).toEqual(['43','44']);
 await page.reload();await openMarket(page);await expect(group(page,'nft')).toHaveCount(3);
 for(const id of ['42','43','44'])await expect(nftCard(page,id).getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 s.control.results[hashForToken('43')]={final:true,failed:true};
 s.control.results[hashForToken('44')]={final:true,failed:false};
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(group(page,'nft')).toHaveCount(1);
 await expect(page.locator('.pending[data-token-id="42"]')).toBeVisible();
 await expect(nftCard(page,'42').getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 for(const id of ['43','44'])await expect(nftCard(page,id).getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
 await expect(nftCard(page,'43').locator('.nft-action-feedback')).toContainText('交易执行失败');
 await expect(nftCard(page,'44').locator('.nft-action-feedback')).toContainText('挂牌 NFT已确认');
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key(s.records.nft))).not.toBeNull();
 expect(s.control.sends).toHaveLength(2);
});

test('mint pending locks its hex warehouse ID without blocking a different sealed weapon',async({page,game})=>{
 const s=await setup(page,game,{saved:['nft'],tokens:[]});
 const ids=['42','43'].map(id=>'0x'+BigInt(id).toString(16).padStart(64,'0'));
 for(const id of ids)game.sql("INSERT INTO weapons(id,owner,level,status,created) VALUES(?,?,80,'sealed',1)",[id,s.account.address]);
 await page.reload();await page.locator('.nav-item').filter({hasText:'武器仓库'}).click();
 const card=id=>page.locator(`.weapon-card[data-weapon-id="${id}"]`);
 await expect(card(ids[0]).getByRole('button',{name:'等待链上确认',exact:true})).toBeDisabled();
 await expect(card(ids[1]).getByRole('button',{name:'铭刻 NFT ↗',exact:true})).toBeEnabled();
 expect(s.control.sends).toHaveLength(0);
});

test('staking and market share only the same weapon lock and show each pending action correctly',async({page,game})=>{
 const s=await setup(page,game,{saved:['staking'],tokens:['42','43','44']});
 await openMarket(page);
 await expect(nftCard(page,'42').getByRole('button',{name:'挂牌出售',exact:true})).toBeDisabled();
 await listNFT(page,'43');await expect(group(page,'nft')).toHaveCount(2);
 await page.getByRole('button',{name:'NFT 质押',exact:true}).click();
 const row=id=>page.locator(`.staking-item[data-token="${id}"]`);
 await expect(row('42').getByRole('button',{name:'交易确认中',exact:true})).toBeDisabled();
 await expect(row('42').locator('.nft-action-feedback')).toContainText('质押 NFT');
 await expect(row('43').getByRole('button',{name:'交易确认中',exact:true})).toBeDisabled();
 await expect(row('43').locator('.nft-action-feedback')).toContainText('挂牌 NFT');
 await expect(row('44').getByRole('button',{name:'授权此 NFT',exact:true})).toBeEnabled();
 s.control.final.staking=true;s.control.failed.staking=true;
 await page.locator('.pending[data-token-id="42"]').getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(row('42').getByRole('button',{name:'授权此 NFT',exact:true})).toBeEnabled();
 await expect(row('43').getByRole('button',{name:'交易确认中',exact:true})).toBeDisabled();
 expect(s.control.sends.map(tx=>tx.tokenId)).toEqual(['43']);
});


test('purchase reserves before sending and restores its server lock ID after reload',async({page,game})=>{
 const s=await setup(page,game,{listed:true});
 await openMarket(page);await page.getByRole('button',{name:'在售市场',exact:true}).click();
 await page.getByRole('button',{name:'购买收藏品',exact:true}).click();
 await expect(group(page,'nft')).toBeVisible();
 expect(s.control.purchaseRequests.map(r=>r.path)).toEqual(['/api/chain/purchases','/api/chain/purchases/'+ 'aa'.repeat(32)+'/begin']);
 expect(s.control.purchaseRequests[0].body).toMatchObject({token_id:'42',seller:nft,price_wei:'10000000000000000'});
 await expect.poll(()=>s.control.tasks.some(t=>t.tx_hash===hashes.nft&&t.purchase_lock_id==='aa'.repeat(32))).toBe(true);
 s.control.tasks=[];
 await page.reload();await expect(group(page,'nft')).toBeVisible();
 await expect.poll(()=>s.control.tasks.some(t=>t.tx_hash===hashes.nft&&t.purchase_lock_id==='aa'.repeat(32))).toBe(true);
 expect(s.control.sends).toHaveLength(1);
 expect(s.control.purchaseRequests.some(r=>r.path.endsWith('/release'))).toBe(false);
});

test('a conflicting purchase never opens a wallet transaction',async({page,game})=>{
 const s=await setup(page,game,{listed:true});s.control.purchaseConflict=true;
 await openMarket(page);await page.getByRole('button',{name:'在售市场',exact:true}).click();
 await page.getByRole('button',{name:'购买收藏品',exact:true}).click();
 await expect(page.locator('.notice.error')).toContainText('正在被购买');
 expect(s.control.sends).toHaveLength(0);
 expect(s.control.purchaseRequests).toHaveLength(1);
});

for(const [error,released] of [[4001,true],[-32603,false]])test(`wallet error ${error} ${released?'releases':'retains'} the purchase lock`,async({page,game})=>{
 const s=await setup(page,game,{listed:true});
 await page.evaluate(code=>window.purchaseError=code,error);
 await openMarket(page);await page.getByRole('button',{name:'在售市场',exact:true}).click();
 await page.getByRole('button',{name:'购买收藏品',exact:true}).click();
 await expect(page.locator('.notice.error')).toBeVisible();
 expect(s.control.purchaseRequests.some(r=>r.path.endsWith('/begin'))).toBe(true);
 expect(s.control.purchaseRequests.some(r=>r.path.endsWith('/release'))).toBe(released);
 expect(s.control.tasks.some(t=>t.tx_hash)).toBe(false);
});
