const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const {Wallet,Interface,parseEther}=require('ethers');
const artifact=require('../../artifacts/contracts/ForgeRecharge.sol/ForgeRecharge.json');
const nftArtifact=require('../../artifacts/contracts/ForgeOfFate.sol/ForgeOfFate.json');
const contract='0x'+'56'.repeat(20),nft='0x'+'34'.repeat(20),epoch='0x'+'ef'.repeat(32),hash='0x'+'cd'.repeat(32);
async function setup(page,game,{pending=false,ready=true,administrator=false,treasuryMatch=true,withdrawal=false,delegated=false,adminChange=false}={}){
 const account=await register(page,administrator,game),wallet=Wallet.createRandom(),abi=new Interface(artifact.abi);
 game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[wallet.address,account.address]);
 const treasury=treasuryMatch?wallet.address:'0x'+'78'.repeat(20);
 const control={sends:[],final:false,reverted:false,ready,receipts:0,credited:true,balance:'20000000000000000',treasuryDenied:false,adminAllowed:(administrator&&treasuryMatch)||delegated,admins:[treasury]};
 await page.exposeFunction('rechargeRpc',({method,params})=>{
  if(method==='eth_blockNumber')return '0x20';
  if(method==='eth_estimateGas')return '0x20000';
  if(method==='eth_sendTransaction'){control.sends.push(params[0]);return null;}
  if(method==='eth_call'){
   const call=abi.parseTransaction({data:params[0].data});
   if(call.name==='deploymentId')return abi.encodeFunctionResult(call.name,[epoch]);
   if(call.name==='treasury')return abi.encodeFunctionResult(call.name,[treasury]);
   if(call.name==='deposit')return abi.encodeFunctionResult(call.name,[1]);
   if(['withdraw','addAdmin','removeAdmin'].includes(call.name))return '0x';
  }
  throw Error('Unexpected RPC '+method);
 });
 await page.addInitScript(address=>{
  const listeners={};let current=address;
  window.ethereum={on(n,f){(listeners[n]||=[]).push(f);},removeListener(n,f){listeners[n]=(listeners[n]||[]).filter(v=>v!==f);},async request(r){
   if(['eth_accounts','eth_requestAccounts'].includes(r.method))return [current];
   if(r.method==='eth_chainId')return '0xaa36a7';
   const result=await window.rechargeRpc(r);
   if(r.method==='eth_sendTransaction')throw Object.assign(Error('User rejected'),{code:4001});
   return result;
  }};
  window.changeRechargeWallet=()=>{current='0x'+'78'.repeat(20);for(const f of listeners.accountsChanged||[])f([current]);};
 },wallet.address);
 await page.route('**/api/chain/tasks',route=>route.fulfill({json:{id:'test-task',state:'pending',checkInterval:30}}));
 await page.route('**/api/config',async route=>{
  const r=await route.fetch(),d=await r.json();d.network.chainId=11155111;
  d.chain={address:nft,chainId:11155111,deploymentId:epoch,abi:nftArtifact.abi};d.chain_error=null;
  d.recharge={address:contract,chainId:11155111,deploymentId:epoch,abi:artifact.abi,treasury,weiPerUnit:'10000000000000000',coinsPerUnit:10000,ready:control.ready};
  await route.fulfill({json:d});
 });
 await page.route('**/api/chain/nfts?*',route=>route.fulfill({json:{chainId:11155111,deploymentId:epoch,blockNumber:20,total:0,proceeds:'0',items:[]}}));
 await page.route('**/api/chain/recharge?*',route=>route.fulfill({json:{account:wallet.address,total:control.final?1:0,items:control.final?[{deposit_id:'1',amount_wei:'10000000000000000',coins:'10000',tx_hash:hash,credited_at:control.credited?1793440000:null}]:[]}}));
 await page.route('**/api/chain/recharge/treasury',route=>(control.treasuryDenied||!control.adminAllowed)?route.fulfill({status:403,json:{detail:'当前钱包不是充值合约管理员，或权限已被移除。'}}):route.fulfill({json:{address:contract,chainId:11155111,deploymentId:epoch,treasury,balanceWei:control.balance,blockNumber:20,account:wallet.address,isAdmin:true,canManageAdmins:treasuryMatch,admins:treasuryMatch?control.admins:[]}}));
 await page.route('**/api/chain/recharge/receipts/*',route=>{control.receipts++;return route.fulfill({json:{chainId:11155111,deploymentId:epoch,state:control.final?(control.reverted?'failed':'confirmed'):'confirming',credit:control.final&&control.credited?{state:'credited',coins:'10000'}:null,receipt:{hash,from:wallet.address,status:control.reverted?0:1,finalized:control.final}}});});
 const record={hash,account:wallet.address,contract,epoch,chainId:11155111,label:adminChange?'添加充值管理员':withdrawal?'提现充值收入':'充值游戏金币',target:'recharge',amountWei:'10000000000000000',submittedAt:1793440000000};
 const key=`forge:transaction:11155111:${contract}:${epoch}:${hash}`;
 if(pending)await page.evaluate(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key,record});
 await page.reload();await page.locator('.nav-item').filter({hasText:'充值金币'}).click();
 const panel=page.locator('.recharge-panel');await expect(panel).toContainText('10,000');
 return {control,panel,wallet,abi,key};
}
const confirm=page=>page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();
test('amount uses exact ETH, backend rate preview and explicit test confirmation; rejected payment is retryable',async({page,game})=>{
 const s=await setup(page,game);await expect(s.panel).toContainText('经济系统尚未定型');
 const amount=s.panel.getByRole('textbox');await amount.fill('0.005');await expect(s.panel).toContainText('预计获得金币：5000');
 for(const invalid of ['0','-1','1e2','0.0000000000000000001','9999999999999999999999999999999999999999999999999999999999999999']){
  await amount.fill(invalid);await expect(s.panel.getByRole('button',{name:'确认充值'})).toBeDisabled();
 }
 await amount.fill('0.01');await s.panel.getByRole('button',{name:'确认充值'}).click();
 await expect(page.getByRole('alertdialog')).toContainText('支付 0.01 测试 ETH');await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);
 const tx=s.control.sends[0];expect(tx.to.toLowerCase()).toBe(contract);expect(BigInt(tx.value)).toBe(parseEther('0.01'));expect(s.abi.parseTransaction({data:tx.data}).name).toBe('deposit');
 await expect(page.locator('.notice')).toContainText('操作已取消');await expect(s.panel.getByRole('button',{name:'确认充值'})).toBeEnabled();
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await expect(s.panel).toContainText('Testing only');
 await page.setViewportSize({width:390,height:844});
 expect(await s.panel.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await s.panel.screenshot({path:'test-results/browser/recharge-mobile.png'});
});
test('saved payment checks recharge receipts, blocks double payment and refreshes credit history',async({page,game})=>{
 const s=await setup(page,game,{pending:true});
 await expect(page.locator('.pending')).toContainText('链上执行成功');await expect(s.panel.getByRole('button',{name:'确认充值'})).toBeDisabled();
 s.control.final=true;await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(page.locator('.pending')).toHaveCount(0);await expect(s.panel).toContainText('已到账');
 expect(s.control.sends).toHaveLength(0);expect(s.control.receipts).toBeGreaterThan(0);
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).toBeNull();
});
test('wallet change during confirmation prevents payment',async({page,game})=>{
 const s=await setup(page,game);await s.panel.getByRole('button',{name:'确认充值'}).click();
 await expect(page.getByRole('alertdialog')).toBeVisible();await page.evaluate(()=>window.changeRechargeWallet());await confirm(page);
 await expect(page.locator('.notice')).toContainText('钱包或登录账号已变化');expect(s.control.sends).toHaveLength(0);
});
test('offline or changed listener blocks payment before wallet prompt',async({page,game})=>{
 const s=await setup(page,game);s.control.ready=false;await s.panel.getByRole('button',{name:'确认充值'}).click();
 await expect(page.locator('.notice')).toContainText('充值监听尚未就绪');expect(s.control.sends).toHaveLength(0);
 await page.getByRole('button',{name:'↻ 刷新状态',exact:true}).click();await expect(s.panel.getByRole('button',{name:'确认充值'})).toBeDisabled();
});


for(const options of [{administrator:false},{administrator:true,treasuryMatch:false}])test(`treasury controls hidden without chain permission: ${JSON.stringify(options)}`,async({page,game})=>{
 const s=await setup(page,game,options);await expect(s.panel.getByRole('region',{name:'管理员提现'})).toHaveCount(0);
});
test('admin withdrawal shows balance, prevents zero/overdraw, uses fixed wallet and exact amount',async({page,game})=>{
 const s=await setup(page,game,{administrator:true,ready:false}); // Custody withdrawals do not depend on credit monitoring.
 const panel=page.locator('.recharge-treasury');await expect(panel).toContainText('合约可提余额：0.02');await expect(panel).toContainText(s.wallet.address);
 const input=panel.getByRole('textbox',{name:'提现金额（测试 ETH）'}),button=panel.getByRole('button',{name:'提现到项目钱包'});
 for(const amount of ['0','-1','0.03','1e2','0.0000000000000000001']){await input.fill(amount);await expect(button).toBeDisabled();}
 await panel.getByRole('button',{name:'填入全部余额'}).click();await expect(input).toHaveValue('0.02');
 await input.fill('0.005');await button.click();await expect(page.getByRole('alertdialog')).toContainText(s.wallet.address);await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);
 const tx=s.control.sends[0],call=s.abi.parseTransaction({data:tx.data});expect(call.name).toBe('withdraw');expect(call.args[0]).toBe(parseEther('0.005'));
 expect(tx.to.toLowerCase()).toBe(contract);expect(BigInt(tx.value||0)).toBe(0n);
 await expect(page.locator('.notice')).toContainText('操作已取消');await expect(button).toBeEnabled();
 await page.getByRole('button',{name:'Switch to English'}).click();await expect(panel).toContainText('Admin withdrawals');
 await page.setViewportSize({width:390,height:844});expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await panel.screenshot({path:'test-results/browser/recharge-treasury-mobile.png'});
});
test('revoked permission after confirmation blocks the wallet send',async({page,game})=>{
 const s=await setup(page,game,{administrator:true});const panel=page.locator('.recharge-treasury');
 await panel.getByRole('textbox',{name:'提现金额（测试 ETH）'}).fill('0.01');await panel.getByRole('button',{name:'提现到项目钱包'}).click();
 await expect(page.getByRole('alertdialog')).toBeVisible();s.control.treasuryDenied=true;await confirm(page);
 await expect(page.locator('.notice')).toContainText('当前钱包不是充值合约管理员');expect(s.control.sends).toHaveLength(0);
 await expect(panel.getByRole('button',{name:'提现到项目钱包'})).toBeDisabled();
});
test('withdrawal recovery blocks another send and refreshes empty balance',async({page,game})=>{
 const s=await setup(page,game,{administrator:true,pending:true,withdrawal:true});const panel=page.locator('.recharge-treasury');
 await expect(panel.getByRole('button',{name:'填入全部余额'})).toBeDisabled();await expect(page.locator('.pending')).toContainText('提现充值收入');
 s.control.balance='0';s.control.final=true;await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(page.locator('.pending')).toHaveCount(0);await expect(panel).toContainText('合约可提余额：0');
 await expect(panel.getByRole('button',{name:'提现到项目钱包'})).toBeDisabled();expect(s.control.sends).toHaveLength(0);
});
test('wallet switch while confirming an admin withdrawal never sends',async({page,game})=>{
 const s=await setup(page,game,{administrator:true});const panel=page.locator('.recharge-treasury');
 await panel.getByRole('textbox',{name:'提现金额（测试 ETH）'}).fill('0.01');await panel.getByRole('button',{name:'提现到项目钱包'}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.evaluate(()=>window.changeRechargeWallet());await confirm(page);
 await expect(page.locator('.notice')).toContainText('钱包或登录账号已变化');expect(s.control.sends).toHaveLength(0);
});


test('on-chain confirmation keeps the saved payment locked until backend credit, including reload',async({page,game})=>{
 const s=await setup(page,game,{pending:true});s.control.final=true;s.control.credited=false;
 await page.getByRole('button',{name:'检查待确认交易',exact:true}).click();
 await expect(s.panel.locator('.recharge-progress')).toContainText('链上已确认，正在等待金币入账');
 await expect(s.panel.getByRole('button',{name:'确认充值',exact:true})).toBeDisabled();
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).not.toBeNull();
 await page.reload();await page.locator('.nav-item').filter({hasText:'充值金币'}).click();
 await expect(page.locator('.recharge-progress')).toContainText('链上已确认，正在等待金币入账');
 await expect(page.locator('.recharge-progress')).toContainText('0.01');
 s.control.credited=true;await page.getByRole('button',{name:'检查当前进度',exact:true}).click();
 await expect(page.locator('.recharge-progress')).toHaveCount(0);
 await expect(page.locator('.notice')).toContainText('充值已到账');
 await expect(page.locator('.recharge-entry')).toContainText('到账时间');expect(s.control.sends).toHaveLength(0);
});
test('quick amount buttons update the quote and preserve entered amount when history refreshes',async({page,game})=>{
 const s=await setup(page,game);
 await s.panel.getByRole('button',{name:'0.02 ETH',exact:true}).click();
 await expect(s.panel.getByRole('textbox',{name:'充值金额（测试 ETH）'})).toHaveValue('0.02');
 await expect(s.panel).toContainText('预计获得金币：20000');
 await s.panel.getByRole('button',{name:'刷新记录',exact:true}).click();
 await expect(s.panel.getByRole('textbox',{name:'充值金额（测试 ETH）'})).toHaveValue('0.02');
 await expect(s.panel).toContainText('暂无充值记录');
 await s.panel.screenshot({path:'test-results/browser/recharge-desktop.png'});
});


test('a finalized failed payment clears pending progress and permits a deliberate retry',async({page,game})=>{
 const s=await setup(page,game,{pending:true});s.control.final=true;s.control.reverted=true;s.control.credited=false;
 await page.getByRole('button',{name:'检查当前进度',exact:true}).click();
 await expect(page.locator('.recharge-progress')).toHaveCount(0);
 await expect(page.locator('.notice')).toContainText('交易执行失败');
 await expect(s.panel.getByRole('button',{name:'确认充值',exact:true})).toBeEnabled();
 expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).toBeNull();expect(s.control.sends).toHaveLength(0);
});

test('root can add and remove admins; malformed, self and duplicate targets are blocked',async({page,game})=>{
 const s=await setup(page,game,{administrator:true}),target=Wallet.createRandom().address;
 const panel=page.getByRole('region',{name:'充值管理员管理'}),input=panel.getByRole('textbox',{name:'新增管理员钱包地址'}),add=panel.getByRole('button',{name:'添加管理员',exact:true});
 await expect(panel).toContainText('主管理员不可移除');
 for(const address of ['abc','example.eth','0x'+'0'.repeat(40),contract,s.wallet.address]){await input.fill(address);await expect(add).toBeDisabled();}
 await input.fill(target);await add.click();await expect(page.getByRole('alertdialog')).toContainText(target);await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);let call=s.abi.parseTransaction({data:s.control.sends[0].data});expect(call.name).toBe('addAdmin');expect(call.args[0]).toBe(target);
 await expect(page.locator('.notice')).toContainText('操作已取消');
 s.control.admins.push(target);await page.getByRole('button',{name:'↻ 刷新状态',exact:true}).click();
 await expect(panel.locator('li')).toHaveCount(2);await expect(add).toBeDisabled();
 await panel.getByRole('button',{name:`移除 ${target}`,exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('将不能再发起提现');await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(2);call=s.abi.parseTransaction({data:s.control.sends[1].data});expect(call.name).toBe('removeAdmin');expect(call.args[0]).toBe(target);
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.recharge-admins')).toContainText('Root administrator');
 expect(await page.locator('.recharge-admins').evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await page.locator('.recharge-treasury').screenshot({path:'test-results/browser/recharge-admins-mobile.png'});
});
test('delegated admin on an ordinary game account can withdraw but cannot manage roles',async({page,game})=>{
 const s=await setup(page,game,{administrator:false,treasuryMatch:false,delegated:true});
 const panel=page.getByRole('region',{name:'管理员提现'});await expect(panel).toContainText('合约可提余额：0.02');
 await expect(panel.getByRole('region',{name:'充值管理员管理'})).toHaveCount(0);
 await panel.getByRole('textbox',{name:'提现金额（测试 ETH）'}).fill('0.005');await panel.getByRole('button',{name:'提现到项目钱包'}).click();
 await expect(page.getByRole('alertdialog')).toContainText('0x'+'78'.repeat(20));await confirm(page);
 await expect.poll(()=>s.control.sends.length).toBe(1);expect(s.abi.parseTransaction({data:s.control.sends[0].data}).name).toBe('withdraw');
});
for(const change of ['wallet','permission','duplicate'])test(`admin add confirmation rechecks ${change} before sending`,async({page,game})=>{
 const s=await setup(page,game,{administrator:true}),target=Wallet.createRandom().address,panel=page.locator('.recharge-admins');
 await panel.getByRole('textbox').fill(target);await panel.getByRole('button',{name:'添加管理员',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
 if(change==='wallet')await page.evaluate(()=>window.changeRechargeWallet());
 if(change==='permission')s.control.treasuryDenied=true;
 if(change==='duplicate')s.control.admins.push(target);
 await confirm(page);
 await expect(page.locator('.notice')).toContainText(change==='wallet'?'钱包或登录账号已变化':change==='permission'?'当前钱包不是充值合约管理员':'该钱包已经是充值管理员');
 expect(s.control.sends).toHaveLength(0);
});
test('saved admin change blocks duplicate submits and completes without a deposit credit',async({page,game})=>{
 const s=await setup(page,game,{administrator:true,pending:true,adminChange:true});
 await expect(page.locator('.recharge-progress')).toContainText('添加充值管理员');
 await expect(page.locator('.recharge-admins').getByRole('button',{name:'添加管理员',exact:true})).toBeDisabled();
 s.control.final=true;s.control.credited=false;
 await page.getByRole('button',{name:'检查当前进度',exact:true}).click();
 await expect(page.locator('.recharge-progress')).toHaveCount(0);await expect(page.locator('.notice')).toContainText('添加充值管理员已确认');
 expect(s.control.sends).toHaveLength(0);expect(await page.evaluate(key=>localStorage.getItem(key),s.key)).toBeNull();
});
