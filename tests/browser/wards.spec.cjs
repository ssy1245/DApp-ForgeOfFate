const { test, expect, register, state } = require('./fixtures.cjs');
const ward = page => page.locator('.shield-toggle input');
const hud = page => page.locator('.hud-ward-status');
const hudWard = page => hud(page).getByRole('checkbox');
const idle = page => expect(page.locator('.notice')).not.toContainText('中…');

async function prepare(page,game) {
  const user=await register(page,true,game);
  game.sql('UPDATE players SET shields=2,materials=10000 WHERE address=?',[user.address]);
  await page.getByLabel('数量（每批 1–100 把）',{exact:true}).fill('1');
  await page.getByLabel('初始等级',{exact:true}).fill('5');
  await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();await idle(page);
  await expect(hud(page)).toContainText('剩余 2 张');
  await page.getByRole('button',{name:'环绕查看',exact:true}).click();
  return {...user,id:(await state(page)).weapons[0].id};
}

test('Q and HUD checkbox stay in sync, ignore typing/modals and update stock in compact and expanded HUD',async({page,game},testInfo)=>{
  const user=await prepare(page,game);
  await expect(hudWard(page)).not.toBeChecked();
  await expect(hud(page)).toContainText('保护符未开启');
  await page.keyboard.down('q');await page.keyboard.down('q');await page.keyboard.up('q');
  await expect(ward(page)).toBeChecked();
  await expect(hudWard(page)).toBeChecked();
  await expect(hud(page)).toContainText('保护符已开启');
  expect((await state(page)).player.shields).toBe(2);
  await page.keyboard.press('q');await expect(ward(page)).not.toBeChecked();
  await expect(hudWard(page)).not.toBeChecked();
  await hudWard(page).check();await expect(ward(page)).toBeChecked();
  // Q also works while the checkbox retains focus after a click.
  await page.keyboard.press('q');await expect(hudWard(page)).not.toBeChecked();
  await expect(ward(page)).not.toBeChecked();
  await page.getByLabel('初始等级',{exact:true}).focus();await page.keyboard.press('q');
  await expect(ward(page)).not.toBeChecked();
  await page.getByRole('button',{name:'打开场景仓库',exact:true}).click();
  await page.keyboard.press('q');await expect(ward(page)).not.toBeChecked();
  await page.getByRole('button',{name:'返回游玩',exact:true}).click();
  await page.getByRole('button',{name:'展开武器面板',exact:true}).click();
  await expect(hud(page)).toContainText('剩余 2 张');
  await page.keyboard.press('q');await expect(ward(page)).toBeChecked();
  await expect(hudWard(page)).toBeChecked();
  await hud(page).screenshot({path:testInfo.outputPath('ward-enabled.png')});
  game.sql('UPDATE players SET shields=0 WHERE address=?',[user.address]);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(hud(page)).toContainText('剩余 0 张');
  await expect(ward(page)).not.toBeChecked();await expect(ward(page)).toBeDisabled();
  await expect(hudWard(page)).not.toBeChecked();await expect(hudWard(page)).toBeDisabled();
  await page.keyboard.press('q');await expect(ward(page)).not.toBeChecked();
});

test('nonlethal strikes keep ward armed; preventing destruction consumes one and clears it',async({page,game},testInfo)=>{
  const user=await prepare(page,game);
  await page.getByRole('button',{name:'送入熔炉加热',exact:false}).click();
  await expect(page.getByRole('button',{name:'取回铁砧',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'取回铁砧',exact:true}).click();
  await expect(page.getByRole('button',{name:'敲下命运之锤',exact:false})).toBeEnabled();
  await page.keyboard.press('q');await expect(ward(page)).toBeChecked();
  // Deterministic UI responses; real server consumption and randomness are
  // exercised separately by test_wards.py against the actual API.
  const results=[['up',1,false],['down',-1,false],['saved',0,true]];
  await page.route('**/api/weapons/*/strike',async route=>{
    expect(route.request().postDataJSON().shield).toBe(true);
    const [result,delta,used]=results.shift();
    const w=game.sql('SELECT * FROM weapons WHERE id=?',[user.id])[0];
    game.sql('UPDATE weapons SET level=level+?,strikes=strikes+1,heat_charges=heat_charges-1 WHERE id=?',[delta,user.id]);
    game.sql('UPDATE players SET materials=materials-2,shields=shields-? WHERE address=?',[used?1:0,user.address]);
    await route.fulfill({json:{result,level:w.level+delta,strikes:w.strikes+1,protected_left:0,status:'active',shield_used:used,heat_charges:w.heat_charges-1}});
  });
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'敲下命运之锤',exact:false}).click();await idle(page);
    if(i<2){await expect(ward(page)).toBeChecked();await expect(hudWard(page)).toBeChecked();await expect(hud(page)).toContainText('剩余 2 张');}
    else {await expect(ward(page)).not.toBeChecked();await expect(hudWard(page)).not.toBeChecked();await expect(hud(page)).toContainText('剩余 1 张');}
  }
  await page.getByRole('button',{name:'展开武器面板',exact:true}).click();
  await expect(hud(page)).toContainText('剩余 1 张');
  await page.screenshot({path:testInfo.outputPath('ward-count.png')});
});

test('Q works in first-person and stage immunity prevents activation',async({page,game})=>{
  const user=await prepare(page,game);
  await page.getByRole('button',{name:'第一人称',exact:true}).click();
  await page.locator('.scene canvas').click();
  await page.keyboard.press('q');await expect(ward(page)).toBeChecked();
  await page.keyboard.press('q');await expect(ward(page)).not.toBeChecked();
  await page.keyboard.press('Escape');
  game.sql('UPDATE weapons SET protected_left=2 WHERE id=?',[user.id]);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(hud(page)).toContainText('阶段保护中，不耗符');
  await expect(hudWard(page)).not.toBeChecked();await expect(hudWard(page)).toBeDisabled();
  await page.keyboard.press('q');await expect(ward(page)).not.toBeChecked();
  await expect(hud(page)).toContainText('剩余 2 张');
});

test('buying a ward updates stock, enables Q and disables the shop when gold is spent',async({page,game},testInfo)=>{
  const user=await prepare(page,game);
  game.sql('UPDATE players SET shields=0,coins=2500 WHERE address=?',[user.address]);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(hud(page)).toContainText('剩余 0 张');
  await expect(hudWard(page)).toBeDisabled();
  const buy=page.getByRole('button',{name:/购买 1 张保护符/});
  await expect(buy).toBeEnabled();await expect(page.locator('.supply-product-ward .supply-product-price')).toContainText('2,500');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/shop/wards')&&r.request().method()==='POST');
  await buy.click();expect((await response).status()).toBe(200);await idle(page);
  await expect(hud(page)).toContainText('剩余 1 张');
  await expect(hudWard(page)).toBeEnabled();await expect(hudWard(page)).not.toBeChecked();
  await expect(buy).toBeDisabled();
  expect((await state(page)).player.coins).toBe(0);
  await page.locator('.bottom-panels').screenshot({path:testInfo.outputPath('ward-shop.png')});
  await hudWard(page).focus();await page.keyboard.press('q');await expect(hudWard(page)).toBeChecked();
  await page.reload();await expect(hud(page)).toContainText('剩余 1 张');
  await expect(buy).toBeDisabled();
});
