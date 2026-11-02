const {test,expect,register,state,consistent}=require('./fixtures.cjs');
const idle=page=>expect(page.locator('.notice')).not.toContainText('中…');
const cost=page=>page.locator('[data-cost=strike] .material-amount');
const refresh=page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));

test('forge costs follow route boundaries, downgrades and weapon switches, and match actual charges',async({page,game})=>{
 const user=await register(page,true,game);
 await expect(page.locator('[data-cost=strike]')).toContainText('—');
 await expect(page.locator('.forge-actions .prob strong')).toHaveText(['—','—','—','—']);
 await page.getByRole('button',{name:'添加资源',exact:true}).click();await idle(page);
 await page.getByLabel('数量（每批 1–100 把）',{exact:true}).fill('1');
 await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();await idle(page);
 const first=(await state(page)).weapons[0];
 for(const [branch,level,expected] of [['longsword',0,2],['longsword',9,2],['longsword',10,4],['longsword',9,2],['rapier',5,3],['rapier',4,2],['rapier',5,3],['greatsword',10,7],['greatsword',9,2],['greatsword',10,7]]){
  game.sql('UPDATE weapons SET branch=?,level=? WHERE id=?',[branch,level,first.id]);await refresh(page);
  await expect(cost(page)).toHaveText(`${expected}  铁块`);
  const current=(await state(page)).weapons.find(w=>w.id===first.id);expect(current.strike_materials).toBe(expected);
  await expect(page.locator('.forge-actions .prob strong')).toHaveText(['double','up','down','destroy'].map(key=>(current.probabilities[key]*100).toFixed(1)+'%'));
 }
 for(const [branch,expected] of [['longsword',4],['rapier',3],['greatsword',7]]){
  await page.getByRole('combobox',{name:/基础武器/}).selectOption(branch);
  await page.getByLabel('初始等级',{exact:true}).fill('20');
  await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();await idle(page);
  const weapon=(await state(page)).weapons[0];
  game.sql('UPDATE weapons SET protected_left=3 WHERE id=?',[weapon.id]);
  await page.getByLabel('从仓库取用',{exact:true}).selectOption(weapon.id);await idle(page);
  await expect(cost(page)).toContainText(`${expected}  铁块`);
  const before=await state(page);
  await page.getByRole('button',{name:'送入熔炉加热'}).click();await idle(page);
  const heated=await state(page);expect(heated.player.materials).toBe(before.player.materials-2);
  await expect(page.getByRole('button',{name:'取回铁砧',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'取回铁砧',exact:true}).click();
  const strike=page.getByRole('button',{name:'敲下命运之锤'});await expect(strike).toBeEnabled();await strike.click();await idle(page);
  const after=await consistent(page,game,user.address);expect(after.player.materials).toBe(heated.player.materials-expected);
  expect(after.weapons.find(w=>w.id===weapon.id).heat_charges).toBe(4);
  game.sql('UPDATE players SET materials=? WHERE address=?',[expected-1,user.address]);await refresh(page);
  await expect(strike).toBeDisabled();await expect(page.locator('.forge-actions [role=alert]')).toContainText(`强化需要 ${expected} 铁块`);
  game.sql('UPDATE players SET materials=1000 WHERE address=?',[user.address]);await refresh(page);
 }
});

test('forge and supplies show ordered bilingual outcomes and readable cards on desktop and mobile',async({page,game},testInfo)=>{
 const user=await register(page,true,game);
 await page.getByRole('button',{name:'添加资源',exact:true}).click();await idle(page);
 await page.getByLabel('数量（每批 1–100 把）',{exact:true}).fill('1');
 await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();await idle(page);
 game.sql('UPDATE players SET coins=20000 WHERE address=?',[user.address]);
 game.sql('UPDATE weapons SET heat_charges=5,heat_ready_at=0 WHERE owner=?',[user.address]);await refresh(page);
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
 const actions=page.locator('.forge-actions'),supplies=page.locator('.workshop-supplies');
 await expect(actions.locator('.prob>span')).toHaveText(['+2大成功','+1成功','−1降级','×永久损毁']);
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();
 await expect(actions.locator('.prob>span')).toHaveText(['+2Great success','+1Success','−1Downgrade','×Destruction']);
 await expect(supplies.locator('.supply-product')).toHaveCount(3);
 await supplies.scrollIntoViewIfNeeded();
 await expect.poll(()=>supplies.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
 await supplies.screenshot({path:testInfo.outputPath('supplies-desktop.png')});
 await page.setViewportSize({width:1120,height:1000});await actions.screenshot({path:testInfo.outputPath('forge-actions-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 for(const panel of [actions,supplies]){
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await actions.screenshot({path:testInfo.outputPath('forge-actions-mobile.png')});
 await supplies.screenshot({path:testInfo.outputPath('supplies-mobile.png')});
});
