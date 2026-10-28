const {test,expect,register}=require('./fixtures.cjs');

test('chain history distinguishes a stopped listener, saved progress and a chain conflict',async({page,game})=>{
  await register(page,false,game);
  await page.getByRole('button',{name:'命运集市',exact:false}).click();
  const panel=page.getByRole('region',{name:'链上记录与同步'});
  await expect(panel.getByRole('status')).toHaveText('监听尚未启动');
  const manifest={address:'0x'+'11'.repeat(20),chainId:11155111,deploymentId:'fixture',deploymentBlock:1,confirmationPolicy:'finalized'};
  game.sql('INSERT INTO chain_environment VALUES(1,?,?)',['fixture',JSON.stringify(manifest)]);
  game.sql("INSERT INTO chain_scan(id,scanned_block,scanned_hash,processed_block,head_block,confirmed_block,state,updated_at,last_success,rpc_ok) VALUES(1,100,?,100,110,100,'ready',?,?,1)",['0x'+'22'.repeat(32),Date.now()/1000,Date.now()/1000]);
  const tx='0x'+'33'.repeat(32);
  game.sql('INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?,?)',['0x'+'22'.repeat(32),0,100,tx,0,manifest.address,'Transfer',JSON.stringify({tokenId:(2n**255n).toString(),to:manifest.address}),1]);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(panel.getByRole('status')).toHaveText('已同步确认记录');
  await expect(panel.getByText('NFT 转移',{exact:false})).toBeVisible();
  await expect(panel.locator('a').last()).toHaveAttribute('href','https://sepolia.etherscan.io/tx/'+tx);
  await expect(panel.locator('dd')).toHaveText(['110','100','100','100']);
  game.sql("UPDATE chain_scan SET state='halted',message=? WHERE id=1",['已保存的确认区块发生变化，监听已暂停；请核对节点或恢复匹配的备份。']);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(panel.getByRole('alert')).toContainText('监听已暂停');
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('region',{name:'On-chain history and sync'}).getByRole('alert')).toContainText('Indexing is paused');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('region',{name:'On-chain history and sync'}).screenshot({path:'test-results/chain-history.png'});
});
