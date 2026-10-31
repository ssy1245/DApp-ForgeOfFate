const {test,expect,register}=require('../../../tests/browser/fixtures.cjs');
const address='0x'+'11'.repeat(20), tx='0x'+'22'.repeat(32);
function snapshot(){return {checkedAt:Date.now()/1000,
  network:{name:'Ethereum Sepolia',expectedChainId:11155111,actualChainId:11155111,status:'ok',message:'节点网络与游戏配置一致。',headBlock:150,finalizedBlock:120,finalityStatus:'ok'},
  contracts:[{id:'nft-market',name:'NFT / 市场合约',address,status:'ok',message:'NFT 合约与当前配置匹配。',transactionHash:tx,deploymentBlock:100,
    mintSigner:address,checks:[{label:'链上代码',status:'ok'},{label:'部署身份',status:'ok'}]},
    {id:'staking',name:'NFT 质押合约',status:'disabled',message:'尚未实现，不影响 NFT 交易。',checks:[]},
    {id:'recharge',name:'充值合约',status:'disabled',message:'充值暂缓，当前未启用。',checks:[]}],
  indexer:{state:'ready',running:true,caughtUp:true,scannedBlock:120,processedBlock:120,pendingEvents:0,lastSuccess:Date.now()/1000,deploymentMatches:true}};}

test('diagnostics are restricted to test accounts and stop on collapse or logout',async({page,game})=>{
  await register(page,false,game);
  await page.getByRole('button',{name:'命运集市',exact:false}).click();
  await expect(page.getByRole('region',{name:'链上状态',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async()=> (await fetch('/api/chain/diagnostics')).status)).toBe(403);

  await page.getByRole('button',{name:'退出账号',exact:true}).click();
  await register(page,true,game);
  let requests=0;
  await page.route('**/api/chain/diagnostics',route=>{requests++;return route.fulfill({json:snapshot()});});
  await page.getByRole('button',{name:'命运集市',exact:false}).click();
  const panel=page.getByRole('region',{name:'链上状态',exact:true});
  await expect(panel.getByText('NFT 合约与当前配置匹配。')).toBeVisible();
  await panel.getByRole('button',{name:'收起检查'}).click();
  const paused=requests;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(panel.getByRole('button',{name:'重新检查'})).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(requests).toBe(paused);
  await panel.getByRole('button',{name:'展开检查'}).click();
  await expect.poll(()=>requests).toBeGreaterThan(paused);
  await page.getByRole('button',{name:'退出账号',exact:true}).click();
  await expect(panel).toHaveCount(0);
});

test('diagnostics show independent wallet, contract and sync checks with failure recovery and mobile English',async({page,game})=>{
  await page.addInitScript(()=>{
    window.walletCalls=[];const listeners={};
    window.ethereum={request:async({method})=>{window.walletCalls.push(method);if(method==='eth_accounts')return ['0x'+'11'.repeat(20)];if(method==='eth_chainId')return '0xaa36a7';throw Error('Unexpected wallet request');},
      on:(name,fn)=>{listeners[name]=fn;},removeListener:(name)=>{delete listeners[name];}};
  });
  const account=await register(page,true,game);
  game.sql('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',[address,account.address]);
  await page.reload();
  let mode='ok',requests=0;
  await page.route('**/api/chain/diagnostics',route=>{
    requests++;
    if(mode==='fail')return route.fulfill({status:503,json:{detail:'unavailable'}});
    const data=snapshot();
    if(mode==='pending'){data.contracts[0]={id:'nft-market',name:'NFT / 市场合约',status:'waiting',message:'交易已打包，等待最终确认后保存游戏配置。',transactionHash:tx,deploymentBlock:130,checks:[]};}
    return route.fulfill({json:data});
  });
  await page.getByRole('button',{name:'命运集市',exact:false}).click();
  const panel=page.getByRole('region',{name:'链上状态',exact:true});
  await expect(panel.getByText('钱包与绑定账号、游戏网络一致。')).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('正常');
  await expect(panel.locator('dd')).toHaveText(['150','120','120','120']);
  await expect(panel.getByRole('article',{name:'NFT 质押合约'}).getByText('未启用')).toBeVisible();
  await expect(panel.getByRole('link',{name:address+' ↗'})).toHaveAttribute('href','https://sepolia.etherscan.io/address/'+address);
  await expect(panel.getByRole('link',{name:'查看部署交易',exact:false})).toHaveAttribute('href','https://sepolia.etherscan.io/tx/'+tx);
  await panel.screenshot({path:'test-results/diagnostics-desktop.png'});
  mode='fail';await panel.getByRole('button',{name:'重新检查'}).click();
  await expect(panel.getByRole('alert')).toHaveText('检查暂时失败，请重新检查。');
  await expect(panel.getByText('NFT 合约与当前配置匹配。')).toHaveCount(0);
  mode='pending';await panel.getByRole('button',{name:'重新检查'}).click();
  await expect(panel.getByText('交易已打包，等待最终确认后保存游戏配置。')).toBeVisible();
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  const english=page.getByRole('region',{name:'Chain status',exact:true});
  await expect(english.getByText('The transaction is included. Game configuration will be saved after finality.')).toBeVisible();
  expect(await english.innerText()).not.toMatch(/\p{Script=Han}/u);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await english.screenshot({path:'test-results/diagnostics-mobile.png'});
  expect(await page.evaluate(()=>window.walletCalls.every(method=>['eth_accounts','eth_chainId'].includes(method)))).toBe(true);
  expect(requests).toBeGreaterThanOrEqual(3);
});
