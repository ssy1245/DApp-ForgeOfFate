const {test,expect,register,state,agree}=require('./fixtures.cjs');
async function spawn(page,level){
 await page.getByLabel('初始等级',{exact:true}).fill(String(level));await page.getByLabel('数量（每批 1–100 把）',{exact:true}).fill('1');
 await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();
 await expect(page.locator('.workshop-view')).not.toHaveAttribute('data-weapon-id','');
 return (await state(page)).weapons[0];
}
test('forge monitor matches server price and per-strike odds, protection, cap and empty states',async({page,game})=>{
 await register(page,true,game);await page.getByText('放大锻造屏',{exact:true}).click();
 const monitor=page.getByRole('region',{name:'锻造实时屏'});
 await expect(monitor).toContainText('等待一把新武器');await expect(monitor).toHaveAttribute('data-price','');
 const sword=await spawn(page,10);
 await expect(monitor).toHaveAttribute('data-level','10');await expect(monitor).toHaveAttribute('data-price',String(sword.recycle_price));
 await expect(monitor).toContainText(`${(sword.probabilities.destroy*100).toFixed(1)}%`);
 await expect(monitor.locator('dl').nth(1).locator('dt')).toHaveText(['大成功 → +12','成功 → +11','降级 → +9','损毁 → 永久消失']);
 game.sql('UPDATE players SET shields=5 WHERE address=(SELECT owner FROM weapons WHERE id=?)',[sword.id]);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.locator('.control-card .shield-toggle input').check();
 await expect(monitor).toContainText('保护生效');await expect(monitor.locator('dl>div').filter({hasText:'损毁 →'})).toContainText('0.0%');
 await page.getByRole('button',{name:'查看锻造屏',exact:true}).click();
 await page.locator('.forge-monitor-readable summary').click();
 await page.locator('.workshop-view canvas').screenshot({path:'test-results/browser/forge-monitor-world.png'});
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();
 await page.getByText('Enlarge forge monitor',{exact:true}).click();
 await expect(page.getByRole('region',{name:'Live forge monitor'}).locator('dl').nth(1).locator('dt')).toHaveText(['Great success → +12','Success → +11','Downgrade → +9','Destroyed → Lost forever','Protected → +10']);
 await page.getByText('Enlarge forge monitor',{exact:true}).click();
 await page.locator('.workshop-view canvas').screenshot({path:'test-results/browser/forge-monitor-english.png'});
 await page.getByRole('button',{name:'切换为中文',exact:true}).click();
 await page.getByText('放大锻造屏',{exact:true}).click();
 game.sql('UPDATE weapons SET level=90 WHERE id=?',[sword.id]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(monitor).toHaveAttribute('data-level','90');await expect(monitor).toContainText('已达到路线等级上限');
 await expect(monitor).not.toContainText('%');
 game.sql("UPDATE weapons SET status='destroyed' WHERE id=?",[sword.id]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(monitor).toHaveAttribute('data-price','');await expect(monitor).toContainText('等待一把新武器');
});
test('route cards explain unlocks, reset confirmation, irreversible choice and bilingual mobile layout',async({page,game})=>{
 await register(page,true,game);const sword=await spawn(page,4);const routes=page.getByRole('region',{name:'选择武器路线'});
 await expect(routes).toContainText('骑士剑是起点');await expect(routes.getByRole('button',{name:'转为刺剑',exact:true})).toBeDisabled();
 await expect(routes.locator('[data-route=rapier]')).toContainText('还需强化 1 级');
 game.sql('UPDATE weapons SET level=5 WHERE id=?',[sword.id]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(routes.getByRole('button',{name:'转为刺剑',exact:true})).toBeEnabled();await expect(routes.getByRole('button',{name:'转为巨剑',exact:true})).toBeDisabled();
 await routes.getByRole('button',{name:'转为刺剑',exact:true}).click();await agree(page);
 await expect(routes.locator('[data-route=rapier]')).toHaveAttribute('data-current','true');await expect(routes).toContainText('不能转回骑士剑');
 await expect(routes.locator('[data-route=greatsword] button')).toBeDisabled();
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.setViewportSize({width:390,height:844});
 const english=page.getByRole('region',{name:'Choose a weapon route'});await expect(english).toContainText('Your route is fixed');
 expect(await english.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await english.screenshot({path:'test-results/browser/weapon-routes-mobile.png'});
});
