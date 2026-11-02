const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const {Wallet,Interface,ZeroAddress}=require('ethers');
const nftArtifact=require('../../artifacts/contracts/ForgeOfFate.sol/ForgeOfFate.json');
const stakeArtifact=require('../../artifacts/contracts/ForgeStaking.sol/ForgeStaking.json');
const nft='0x'+'34'.repeat(20),staking='0x'+'56'.repeat(20),nftEpoch='0x'+'ab'.repeat(32),epoch='0x'+'ef'.repeat(32),hash='0x'+'cd'.repeat(32);
async function setup(page,game,{approved=false,staked=false,pending=false,pendingAction='质押 NFT',pendingTarget='staking',token='42'}={}){
 const account=await register(page,false,game),wallet=Wallet.createRandom();
 game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[wallet.address,account.address]);
 const control={approved,staked,offline:false,final:false,sends:[],reads:[],receiptReads:0};
 const nftApi=new Interface(nftArtifact.abi),stakeApi=new Interface(stakeArtifact.abi);
 await page.exposeFunction('stakingRpc',({method,params})=>{
  if(method==='eth_blockNumber')return '0x20';
  if(method==='eth_estimateGas')return '0x20000';
  if(method==='eth_sendTransaction'){control.sends.push(params[0]);return null;}
  if(method==='eth_call'){
   const isStake=params[0].to.toLowerCase()===staking.toLowerCase(),api=isStake?stakeApi:nftApi;
   const decoded=api.parseTransaction({data:params[0].data});control.reads.push(decoded.name);
   if(decoded.name==='deploymentId')return api.encodeFunctionResult('deploymentId',[isStake?epoch:nftEpoch]);
   if(decoded.name==='nft')return api.encodeFunctionResult('nft',[nft]);
   if(decoded.name==='ownerOf')return api.encodeFunctionResult('ownerOf',[wallet.address]);
   if(decoded.name==='stake')return api.encodeFunctionResult('stake',[9]);
   if(['approve','unstake'].includes(decoded.name))return '0x';
  }
  throw Error('Unexpected RPC '+method);
 });
 await page.addInitScript(address=>{
  const listeners={};let current=address;
  window.ethereum={on(n,f){(listeners[n]||=[]).push(f);},removeListener(n,f){listeners[n]=(listeners[n]||[]).filter(v=>v!==f);},async request(r){
   if(['eth_accounts','eth_requestAccounts'].includes(r.method))return [current];
   if(r.method==='eth_chainId')return '0xaa36a7';
   const result=await window.stakingRpc(r);
   if(r.method==='eth_sendTransaction')throw Object.assign(Error('User rejected'),{code:4001});
   return result;
  }};
  window.changeStakeWallet=()=>{current='0x'+'78'.repeat(20);for(const f of listeners.accountsChanged||[])f([current]);};
 },wallet.address);
 await page.route('**/api/config',async route=>{
  const r=await route.fetch(),d=await r.json();d.network.chainId=11155111;
  d.chain={address:nft,chainId:11155111,deploymentId:nftEpoch,abi:nftArtifact.abi};d.chain_error=null;
  d.staking={address:staking,chainId:11155111,deploymentId:epoch,nftAddress:nft,abi:stakeArtifact.abi,dailyCoins:1000};
  await route.fulfill({json:d});
 });
 const uri='data:application/json;base64,'+Buffer.from(JSON.stringify({name:'余烬君王',name_en:'Sovereign of Ash',branch:'greatsword',tier_id:'greatsword-60'})).toString('base64');
 await page.route('**/api/chain/nfts?*',route=>route.fulfill({json:{chainId:11155111,deploymentId:nftEpoch,blockNumber:20,total:1,proceeds:'0',items:[{id:token,owner:control.staked?staking:wallet.address,seller:ZeroAddress,price:'0',level:70,uri}]}}));
 await page.route('**/api/chain/staking',route=>control.offline?route.fulfill({status:503,json:{detail:'offline'}}):route.fulfill({json:{account:wallet.address,deploymentId:epoch,chainId:11155111,blockNumber:20,available:control.staked?[]:[{tokenId:token,approved:control.approved}],positions:control.staked?[{tokenId:token,positionId:'9',startedAt:1793440000}]:[]}}));
 await page.route(pendingTarget==='staking'?'**/api/chain/staking/receipts/*':'**/api/chain/receipts/*',route=>{control.receiptReads++;return route.fulfill({json:{chainId:11155111,deploymentId:pendingTarget==='staking'?epoch:nftEpoch,state:control.final?'confirmed':'confirming',receipt:{hash,from:wallet.address,status:1,finalized:control.final}}});});
 const record={hash,account:wallet.address,contract:pendingTarget==='staking'?staking:nft,epoch:pendingTarget==='staking'?epoch:nftEpoch,chainId:11155111,label:pendingAction,tokenId:token,...(pendingTarget==='staking'?{target:'staking'}:{})};
 const key=`forge:transaction:11155111:${record.contract}:${record.epoch}:${hash}`;
 if(pending)await page.evaluate(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key,record});
 await page.reload();await page.locator('.nav-item').nth(2).click();await page.getByRole('button',{name:'NFT 质押',exact:true}).click();
 const panel=page.getByRole('region',{name:'NFT 质押',exact:true});
 await expect(panel.locator('.staking-rate')).toContainText('1,000');
 await expect(panel.getByText('正在读取质押状态…')).toHaveCount(0);
 return {control,panel,wallet,key,nftApi,stakeApi};
}
async function confirm(page){await page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();}

test('approval is limited to one token and does not start staking',async({page,game})=>{
 const s=await setup(page,game);await s.panel.getByRole('button',{name:'授权此 NFT',exact:true}).click();
 await expect(page.getByRole('alertdialog')).toContainText('尚不开始质押');await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);
 const tx=s.control.sends[0],args=s.nftApi.parseTransaction({data:tx.data});
 expect(tx.to.toLowerCase()).toBe(nft);expect(args.name).toBe('approve');expect(args.args[0].toLowerCase()).toBe(staking);expect(args.args[1]).toBe(42n);
 await expect(s.panel).toContainText('操作已取消');await expect(s.panel.getByRole('button',{name:'授权此 NFT',exact:true})).toBeEnabled();
 expect(s.control.reads).not.toContain('stake');
 await expect(s.panel.locator('.weapon-reference')).toHaveAttribute('src','/display/Greatsword/+60Greatsword.png');
 await s.panel.screenshot({path:'test-results/browser/staking-available.png'});
});
for(const action of ['stake','unstake'])test(`${action} uses staking contract with exact identity and preflight`,async({page,game})=>{
 const s=await setup(page,game,{approved:true,staked:action==='unstake'});
 await s.panel.getByRole('button',{name:action==='stake'?'确认质押':'取回 NFT',exact:true}).click();await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);
 const tx=s.control.sends[0],args=s.stakeApi.parseTransaction({data:tx.data});
 expect(tx.to.toLowerCase()).toBe(staking);expect(args.name).toBe(action);expect(args.args[0]).toBe(action==='stake'?42n:9n);
 expect(s.control.reads).toContain('nft');expect(s.control.reads).toContain(action);
 await expect(s.panel).toContainText('操作已取消');
});
test('saved staking transaction recovers through staking receipts without another wallet send',async({page,game})=>{
 const s=await setup(page,game,{approved:true,pending:true});
 await expect(s.panel).toContainText('链上执行成功');
 await expect(s.panel.getByRole('button',{name:'交易确认中',exact:true})).toBeDisabled();
 s.control.staked=true;s.control.final=true;await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(page.locator('.pending')).toHaveCount(0);
 await expect(s.panel.getByRole('button',{name:'取回 NFT',exact:true})).toBeEnabled();
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).toBeNull();expect(s.control.receiptReads).toBeGreaterThan(0);expect(s.control.sends).toHaveLength(0);
 await expect(s.panel.locator('.weapon-reference')).toHaveAttribute('src','/display/Greatsword/+60Greatsword.png');
 await expect(s.panel.locator('.staking-rules')).not.toHaveAttribute('open');
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();
 const english=page.getByRole('region',{name:'NFT staking',exact:true});
 await english.screenshot({path:'test-results/browser/staking-panel.png'});
 await page.setViewportSize({width:390,height:844});
 expect(await english.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(english.getByRole('button',{name:'Withdraw NFT',exact:true})).toBeEnabled();
 await english.screenshot({path:'test-results/browser/staking-mobile.png'});
 await english.locator('.staking-rules summary').click();await expect(english.locator('.staking-rules')).toContainText('08:00 Beijing time');
});
test('wallet switch during staking confirmation sends nothing',async({page,game})=>{
 const s=await setup(page,game,{approved:true});await s.panel.getByRole('button',{name:'确认质押',exact:true}).click();
 await page.evaluate(()=>window.changeStakeWallet());await confirm(page);
 await expect(page.locator('.notice')).toContainText('钱包或登录账号已变化');expect(s.control.sends).toHaveLength(0);
});
test('failed custody reads disable actions until the server recovers',async({page,game})=>{
 const s=await setup(page,game,{staked:true});s.control.offline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(s.panel.getByRole('alert')).toBeVisible();await expect(s.panel.getByRole('button',{name:'取回 NFT',exact:true})).toBeDisabled();
 s.control.offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(s.panel.getByRole('button',{name:'取回 NFT',exact:true})).toBeEnabled();
});

test('compact card opens listing on demand and selects the exact NFT for staking',async({page,game})=>{
 const token='70040015053319833925070134247553094792372603883471276971352987907260594856800';
 const s=await setup(page,game,{token});
 await s.panel.getByRole('button',{name:'返回我的收藏',exact:true}).click();
 const card=page.locator(`[data-weapon-id="${token}"]`);
 await expect(card).toBeVisible();await expect(card.locator('.card-valuation')).toHaveCount(0);
 await expect(card.getByRole('textbox',{name:'挂牌价格',exact:true})).toHaveCount(0);
 await card.getByRole('button',{name:'挂牌出售',exact:true}).click();
 await card.getByRole('textbox',{name:'挂牌价格',exact:true}).fill('0.02');
 await card.getByRole('button',{name:'收起',exact:true}).click();
 await expect(card.getByRole('textbox',{name:'挂牌价格',exact:true})).toHaveCount(0);
 await card.getByRole('button',{name:'质押 NFT',exact:true}).click();
 const row=s.panel.locator(`[data-token="${token}"]`);
 await expect(row).toHaveAttribute('data-selected','true');await expect(row).toBeFocused();
 await expect(row.getByRole('button',{name:'授权此 NFT',exact:true})).toBeEnabled();
 expect(s.control.sends).toHaveLength(0);
 await s.panel.getByRole('button',{name:'返回我的收藏',exact:true}).click();
 await card.getByRole('button',{name:'挂牌出售',exact:true}).click();
 await expect(card.getByRole('textbox',{name:'挂牌价格',exact:true})).toHaveValue('0.02');
 await card.getByRole('button',{name:'收起',exact:true}).click();
 await page.screenshot({path:'test-results/browser/nft-compact-card.png',fullPage:true});
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();
 await expect(card.getByRole('button',{name:'Stake NFT',exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:'List for sale',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await card.screenshot({path:'test-results/browser/nft-compact-card-mobile.png'});
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await card.getByRole('button',{name:'Stake NFT',exact:true}).click();
 await expect(page.getByRole('region',{name:'NFT staking',exact:true}).locator('[data-selected]')).toHaveAttribute('data-token',token);
 const selected=page.getByRole('region',{name:'NFT staking',exact:true}).locator('[data-selected]');
 await expect(selected.locator('.staking-token code')).not.toBeVisible();
 await selected.locator('.staking-token summary').click();await expect(selected.locator('.staking-token code')).toHaveText(token);
 expect(await selected.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('confirmed withdrawal restores wallet collection without a second transaction',async({page,game})=>{
 const s=await setup(page,game,{staked:true,pending:true,pendingAction:'取回 NFT'});
 await expect(s.panel.getByRole('button',{name:'取回确认中',exact:true})).toBeDisabled();
 s.control.staked=false;s.control.final=true;
 await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(s.panel.getByRole('button',{name:'取回 NFT',exact:true})).toHaveCount(0);
 await expect(s.panel.getByRole('button',{name:'授权此 NFT',exact:true})).toBeEnabled();
 await expect(s.panel).toContainText('取回 NFT已确认。');
 await s.panel.getByRole('button',{name:'返回我的收藏',exact:true}).click();
 const card=page.locator('[data-weapon-id="42"]');await expect(card).toContainText('在你的钱包');
 await expect(card.getByRole('button',{name:'挂牌出售',exact:true})).toBeEnabled();
 expect(s.control.sends).toHaveLength(0);expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).toBeNull();
});

// Approval must not be presented as a completed stake, even when current chain reads show approval.
test('pending approval shows its own phase and unlocks staking only after final confirmation',async({page,game})=>{
 const s=await setup(page,game,{approved:true,pending:true,pendingAction:'授权质押 NFT',pendingTarget:'nft'});
 const row=s.panel.locator('[data-token="42"]');
 await expect(row.getByRole('button',{name:'授权确认中',exact:true})).toBeDisabled();
 await expect(row).toContainText('授权交易等待最终确认');
 await expect(row.getByRole('status')).toContainText('授权质押 NFT');
 await expect(row.getByRole('status')).toContainText('链上执行成功');
 await expect(s.panel).not.toContainText('请在钱包中确认操作；尚未提交交易。');
 await expect(s.panel.getByRole('button',{name:'确认质押',exact:true})).toHaveCount(0);
 s.control.final=true;await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(row.getByRole('button',{name:'确认质押',exact:true})).toBeEnabled();
 await expect(row).toContainText('已授权，尚未质押');expect(s.control.sends).toHaveLength(0);
});
