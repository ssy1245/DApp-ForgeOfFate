const { test, expect, register, state, agree, consistent } = require('./fixtures.cjs');
const panel = page => page.getByRole('region', { name: '工坊武器与仓库', exact: true });
const scene = page => page.locator('.workshop-view');
const idle = page => expect(page.locator('.notice')).not.toContainText('中…');
const focus = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const card = (page, id) => page.locator(`.weapon-card[data-weapon-id="${id}"]`);
async function spawn(page, level=0) {
  await page.getByLabel('初始等级', { exact: true }).fill(String(level));
  await page.getByLabel('数量（每批 1–100 把）', { exact: true }).fill('1');
  const response = page.waitForResponse(r => r.url().endsWith('/api/cheats/weapons') && r.request().method()==='POST');
  await page.getByRole('button', { name: '刷出 1 把剑', exact: true }).click();
  const id = (await (await response).json()).weapon_id; await idle(page); return id;
}
async function prepare(page, game, {level=0, second=true}={}) {
  const user = await register(page, true, game);
  await page.getByRole('button', { name: '添加资源', exact: true }).click(); await idle(page);
  const a = await spawn(page, level), b = second ? await spawn(page, 20) : undefined;
  await expect(scene(page)).toHaveAttribute('data-weapon-id', a);
  await page.getByRole('button', { name: '环绕查看', exact: true }).click();
  return {...user, a, b};
}
async function empty(page) {
  await expect(panel(page)).toContainText('工坊空闲');
  await expect(scene(page)).toHaveAttribute('data-weapon-id', '');
  await expect(scene(page)).toHaveAttribute('data-place', 'empty');
  await expect(page.getByRole('button', { name: '敲下命运之锤' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '送入熔炉加热' })).toBeDisabled();
}
async function take(page, id) {
  await panel(page).getByRole('button', {name:'打开武器仓库', exact:false}).click();
  await card(page,id).getByRole('button', {name:'取出并继续锻造',exact:true}).click();
  await expect(scene(page)).toHaveAttribute('data-weapon-id', id);
  await idle(page);
}
async function atWorkshop(page) {
  await expect(page.locator('.scene[tabindex]')).toBeFocused();
  await expect.poll(async()=>Math.round((await scene(page).boundingBox()).y)).toBe(16);
}
async function position(page, location) {
  if (location==='held'||location==='cabinet-1') {
    await page.getByRole('button',{name:'拿起长剑',exact:true}).click();
    await expect(scene(page)).toHaveAttribute('data-place','held');
    if(location==='cabinet-1') await page.getByRole('button',{name:'放入展示柜 1',exact:true}).click();
  } else if(location==='furnace') {
    await page.getByRole('button',{name:'送入熔炉加热'}).click(); await idle(page);
  }
  await expect(scene(page)).toHaveAttribute('data-place',location);
}

test('store A, take B, preserve empty workshop and selected weapon across reloads', async ({page,game}) => {
  const user=await prepare(page,game,{level:35});
  const before=await state(page);
  await panel(page).getByRole('button',{name:'打开武器仓库',exact:false}).click();
  await card(page,user.a).getByRole('button',{name:'返回工坊',exact:true}).click();
  await atWorkshop(page);
  await page.getByRole('button',{name:'环绕查看',exact:true}).click();
  await position(page,'held');
  await panel(page).getByRole('button',{name:'存入仓库',exact:true}).click(); await empty(page);
  await page.reload(); await empty(page);
  expect((await state(page)).player.workshop_weapon_id).toBeNull();
  await take(page,user.b);
  await atWorkshop(page);
  await expect(scene(page)).toHaveAttribute('data-place','anvil');
  await page.reload(); await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await take(page,user.a);
  const after=await consistent(page,game,user.address);
  expect(after.weapons).toEqual(before.weapons);
  for(const key of ['coins','materials','shields']) expect(after.player[key]).toBe(before.player[key]);
  await panel(page).screenshot({path:'test-results/workshop-storage-controls.png'});
});

test('taking another weapon swaps atomically and returning does not restore a stale hand pose', async ({page,game}) => {
  const user=await prepare(page,game);
  await position(page,'held');
  await page.getByLabel('从仓库取用',{exact:true}).selectOption(user.b);
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await expect(scene(page)).toHaveAttribute('data-place','anvil');
  await page.getByLabel('从仓库取用',{exact:true}).selectOption(user.a);
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.a);
  await expect(scene(page)).toHaveAttribute('data-place','anvil');
  await consistent(page,game,user.address);
});

test('storing a warming weapon preserves the heating deadline without charging again', async ({page,game}) => {
  const user=await prepare(page,game);
  const deadline=Date.now()/1000+60;
  game.sql('UPDATE weapons SET heat_ready_at=?,heat_charges=5 WHERE id=?',[deadline,user.a]);
  await focus(page);await expect(scene(page)).toHaveAttribute('data-place','furnace');
  const before=await state(page);
  await panel(page).getByRole('button',{name:'存入仓库',exact:true}).click();await empty(page);
  await take(page,user.a);
  await expect(scene(page)).toHaveAttribute('data-place','furnace');
  await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeDisabled();
  const after=await consistent(page,game,user.address);
  expect(after.weapons).toEqual(before.weapons);
  expect(after.player.materials).toBe(before.player.materials);
});

for(const location of ['anvil','held','furnace','cabinet-1']) {
  test(`database deletion clears ${location} without selecting the next weapon`, async ({page,game}) => {
    const user=await prepare(page,game); await position(page,location);
    game.sql('DELETE FROM weapons WHERE id=?',[user.a]);
    // This intentionally waits for the real five-second poll; no focus or manual refresh.
    await empty(page);
    await expect(scene(page)).not.toHaveAttribute('data-display-ids',new RegExp(user.a));
    const data=await consistent(page,game,user.address);
    expect(data.player.workshop_weapon_id).toBeNull();
    expect(data.weapons.map(w=>w.id)).toEqual([user.b]);
    await take(page,user.b);
  });
}

for(const change of ['sealed','destroyed','recycled','owner']) {
  test(`external ${change} clears a held weapon and storage actions`, async ({page,game}) => {
    const user=await prepare(page,game,{level:50}); await position(page,'held');
    if(change==='owner') game.sql('UPDATE weapons SET owner=? WHERE id=?',['0x'+'99'.repeat(20),user.a]);
    else game.sql('UPDATE weapons SET status=? WHERE id=?',[change,user.a]);
    await focus(page); await empty(page);
    await panel(page).getByRole('button',{name:'打开武器仓库'}).click();
    if(change==='sealed') {
      await expect(card(page,user.a)).toContainText('已永久封存');
      await expect(card(page,user.a).getByRole('button',{name:'取出并继续锻造',exact:true})).toHaveCount(0);
    } else await expect(card(page,user.a)).toHaveCount(0);
    expect((await state(page)).player.workshop_weapon_id).toBeNull();
  });
}

test('deleting a displayed stored weapon clears its cabinet without dropping current B', async ({page,game}) => {
  const user=await prepare(page,game); await position(page,'cabinet-1');
  await page.getByLabel('从仓库取用',{exact:true}).selectOption(user.b);
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await expect(scene(page)).toHaveAttribute('data-display-ids',new RegExp(user.a));
  game.sql('DELETE FROM weapons WHERE id=?',[user.a]); await focus(page);
  await expect(scene(page)).not.toHaveAttribute('data-display-ids',new RegExp(user.a));
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await consistent(page,game,user.address);
});

test('storing from a cabinet clears the current display too', async ({page,game}) => {
  const user=await prepare(page,game); await position(page,'cabinet-1');
  await panel(page).getByRole('button',{name:'存入仓库',exact:true}).click();
  await empty(page);
  await expect(scene(page)).not.toHaveAttribute('data-display-ids',new RegExp(user.a));
});

test('A removed after opening a confirmation cannot be recycled or replaced by B', async ({page,game}) => {
  const user=await prepare(page,game);
  await panel(page).getByRole('button',{name:'打开武器仓库'}).click();
  await card(page,user.a).getByRole('button',{name:'系统回收',exact:true}).click();
  game.sql('DELETE FROM weapons WHERE id=?',[user.a]);
  await agree(page); await expect(card(page,user.a)).toHaveCount(0);
  expect((await state(page)).player.coins).toBe(1000);
  await expect(card(page,user.b)).toHaveCount(1);
  await page.locator('.nav-item').filter({hasText:'锻造工坊'}).click(); await empty(page);
});

test('backend refuses a delayed heat after another tab stores the weapon', async ({page,context,game}) => {
  const user=await prepare(page,game);
  const other=await context.newPage(); await other.goto('/');
  await expect(scene(other)).toHaveAttribute('data-weapon-id',user.a);
  let release,seen;const gate=new Promise(resolve=>release=resolve), started=new Promise(resolve=>seen=resolve);
  await page.route(`**/api/weapons/${user.a}/heat`,async route=>{seen();await gate;await route.continue();});
  const response=page.waitForResponse(r=>r.url().endsWith(`/weapons/${user.a}/heat`));
  const before=game.sql('SELECT materials FROM players WHERE address=?',[user.address])[0].materials;
  await page.getByRole('button',{name:'送入熔炉加热'}).click(); await started;
  try {await panel(other).getByRole('button',{name:'存入仓库',exact:true}).click();await empty(other);} finally {release();}
  expect((await response).status()).toBe(409);await empty(page);
  expect(game.sql('SELECT materials FROM players WHERE address=?',[user.address])[0].materials).toBe(before);
  await other.close();
});

test('state polling continues while an operation response is delayed', async ({page,game}) => {
  const user=await prepare(page,game); await position(page,'held');
  let release,seen;const gate=new Promise(resolve=>release=resolve), started=new Promise(resolve=>seen=resolve);
  await page.route('**/api/cheats/resources',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response});});
  await page.getByRole('button',{name:'添加资源',exact:true}).click();await started;
  try {
    game.sql('DELETE FROM weapons WHERE id=?',[user.a]);
    await empty(page); // Polling must not be suspended by the in-flight operation.
  } finally {release();}
  await idle(page);await consistent(page,game,user.address);
});

test('disconnection hides stale held/display models and recovery uses database truth', async ({page,game}) => {
  const user=await prepare(page,game);await position(page,'held');
  await page.route('**/api/state',route=>route.abort('internetdisconnected'));
  await focus(page);
  await expect(page.getByText('与服务器的同步已中断，当前显示上次保存的数据，恢复连接后会自动更新。')).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-place','empty');
  game.sql('DELETE FROM weapons WHERE id=?',[user.a]);
  await page.unroute('**/api/state');await focus(page);await empty(page);
  await take(page,user.b);
});

test('external level, branch and heat changes update the selected weapon without changing identity', async ({page,game}) => {
  const user=await prepare(page,game);
  game.sql("UPDATE weapons SET level=30,branch='rapier',heat_charges=3,heat_ready_at=0 WHERE id=?",[user.a]);
  await focus(page);
  await expect(panel(page)).toContainText('+30');
  await expect(page.locator('[data-route=rapier]')).toHaveAttribute('data-current','true');
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.a);
  await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
  await consistent(page,game,user.address);
});

test('warehouse controls fit mobile width and switch language', async ({page,game}) => {
  const user=await prepare(page,game);
  await page.setViewportSize({width:390,height:844});
  await panel(page).scrollIntoViewIfNeeded();
  await panel(page).getByRole('button',{name:'存入仓库',exact:true}).click();await empty(page);
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await expect(page.getByRole('region',{name:'Workshop weapon and storage'})).toContainText('Workshop empty');
  await page.getByRole('button',{name:/Open warehouse/}).click();
  await card(page,user.b).getByRole('button',{name:'Take out and forge',exact:true}).click();
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await atWorkshop(page);
  await page.getByRole('button',{name:/Open warehouse/}).click();
  await card(page,user.b).getByRole('button',{name:'Return to workshop',exact:true}).click();
  await atWorkshop(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

const inGameStorage = page => page.getByRole('dialog',{name:'武器仓库',exact:true});
const storedItem = (dialog,id) => dialog.locator(`.scene-warehouse-item[data-weapon-id="${id}"]`);

test('in-game warehouse stores and retrieves without leaving the expanded scene', async ({page,game}) => {
  const user=await prepare(page,game,{level:35});const before=await state(page);
  await scene(page).getByRole('button',{name:'展开',exact:true}).click();
  await scene(page).getByRole('button',{name:'打开场景仓库',exact:true}).click();
  const dialog=inGameStorage(page);await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'存入仓库',exact:true}).click();
  await expect(dialog.locator('.scene-warehouse-current')).toContainText('工坊空闲');
  await expect(scene(page)).toHaveAttribute('data-place','empty');
  await storedItem(dialog,user.b).getByRole('button',{name:'取出武器',exact:true}).click();
  await expect(dialog.locator('.scene-warehouse-current')).toHaveAttribute('data-weapon-id',user.b);
  await expect(storedItem(dialog,user.b)).toHaveCount(0);
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  const after=await consistent(page,game,user.address);
  expect(after.weapons).toEqual(before.weapons);
  expect(after.player.materials).toBe(before.player.materials);
  await expect.poll(()=>dialog.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await page.screenshot({path:'test-results/in-game-warehouse.png'});
  await dialog.getByRole('button',{name:'返回游玩'}).click();
  await expect(dialog).toHaveCount(0);await expect(scene(page)).toHaveClass(/workshop-expanded/);
  await expect(scene(page)).toHaveAttribute('data-place','anvil');
});

test('in-game warehouse refreshes deleted and sealed items and displays failed take-out', async ({page,game}) => {
  const user=await prepare(page,game,{level:50});
  await scene(page).getByRole('button',{name:'打开场景仓库'}).click();
  const dialog=inGameStorage(page);
  game.sql("UPDATE weapons SET status='sealed' WHERE id=?",[user.a]);await focus(page);
  await expect(storedItem(dialog,user.a).getByRole('button',{name:'不可取用'})).toBeDisabled();
  await expect(dialog.locator('.scene-warehouse-current')).toContainText('工坊空闲');
  await page.route('**/api/workshop/equip',async route=>{game.sql('DELETE FROM weapons WHERE id=?',[user.b]);await route.continue();});
  await storedItem(dialog,user.b).getByRole('button',{name:'取出武器',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('找不到属于当前账号的武器');
  await expect(storedItem(dialog,user.b)).toHaveCount(0);
  await expect(scene(page)).toHaveAttribute('data-weapon-id','');
  await consistent(page,game,user.address);
});

test('walk to the warehouse and press E; modal releases controls and Escape returns paused', async ({page,game}) => {
  const user=await prepare(page,game);const before=await state(page);
  await scene(page).getByRole('button',{name:'第一人称',exact:true}).click();
  const canvas=scene(page).locator('canvas');const bounds=await canvas.boundingBox();
  await canvas.click({position:{x:bounds.width*.4,y:bounds.height*.55}});
  await expect(scene(page)).toHaveAttribute('data-active','true');
  await page.keyboard.down('KeyW');await page.keyboard.down('KeyA');
  try {await expect(scene(page)).toHaveAttribute('data-near','warehouse');}
  finally {await page.keyboard.up('KeyW');await page.keyboard.up('KeyA');}
  await page.keyboard.press('KeyE');const dialog=inGameStorage(page);
  await expect(dialog).toBeVisible();await expect(scene(page)).toHaveAttribute('data-active','false');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement===null)).toBe(true);
  await page.keyboard.press('KeyE');await page.keyboard.press('KeyW');
  expect((await state(page)).weapons).toEqual(before.weapons);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(scene(page)).toHaveAttribute('data-active','false');
  await consistent(page,game,user.address);
});

test('in-game warehouse is usable in English on mobile and keeps keyboard focus inside', async ({page,game}) => {
  const user=await prepare(page,game);await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await scene(page).getByRole('button',{name:'Open in-game warehouse'}).click();
  const dialog=page.getByRole('dialog',{name:'Weapon warehouse',exact:true});await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await storedItem(dialog,user.b).getByRole('button',{name:'Take out weapon',exact:true}).click();
  await expect(dialog.locator('.scene-warehouse-current')).toHaveAttribute('data-weapon-id',user.b);
  await expect(storedItem(dialog,user.b)).toHaveCount(0);
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await expect.poll(()=>dialog.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await page.screenshot({path:'test-results/in-game-warehouse-mobile.png'});
  await dialog.getByRole('button',{name:'Back to game'}).click();
  await expect(scene(page)).toHaveAttribute('data-weapon-id',user.b);
  await consistent(page,game,user.address);
});


test('warehouse shows the current weapon once and ignores unrelated forge feedback',async({page,game})=>{
 const user=await prepare(page,game,{level:21,second:false});
 await page.getByRole('button',{name:/领取每日补给/}).click();await idle(page);
 await scene(page).getByRole('button',{name:'打开场景仓库'}).click();const dialog=inGameStorage(page);
 await expect(dialog.locator('.scene-warehouse-current')).toHaveAttribute('data-weapon-id',user.a);
 await expect(storedItem(dialog,user.a)).toHaveCount(0);await expect(dialog.locator('.scene-warehouse-list')).toContainText('仓库里没有其他武器');
 await expect(dialog.getByRole('status')).toHaveText('仓库中的武器保留等级、热量和保护进度。');
 await dialog.getByRole('button',{name:'存入仓库',exact:true}).click();
 await expect(dialog.locator('.scene-warehouse-current')).toContainText('工坊空闲');await expect(storedItem(dialog,user.a)).toHaveCount(1);
 await expect(dialog.getByRole('status')).toContainText('已存入仓库');
 await storedItem(dialog,user.a).getByRole('button',{name:'取出武器',exact:true}).click();
 await expect(storedItem(dialog,user.a)).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'返回游玩'})).toBeFocused();
 await dialog.screenshot({path:'test-results/browser/warehouse-single-current.png'});
});

test('daily swords arrive in hand, preserve the previous sword and move normally to the furnace or anvil',async({page,game})=>{
 const user=await prepare(page,game,{level:21,second:false});
 const original=(await state(page)).weapons.find(w=>w.id===user.a);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/supply/sword'));
 await page.getByRole('button',{name:'领取一把',exact:true}).click();const id=(await(await response).json()).weapon_id;
 await expect(scene(page)).toHaveAttribute('data-weapon-id',id);await expect(scene(page)).toHaveAttribute('data-place','held');
 let current=await state(page);expect(current.weapons.find(w=>w.id===user.a)).toEqual(original);
 await page.getByRole('button',{name:'放回锻造台',exact:true}).click();await expect(scene(page)).toHaveAttribute('data-place','anvil');
 await page.getByRole('button',{name:'拿起长剑',exact:true}).click();await expect(scene(page)).toHaveAttribute('data-place','held');
 await page.getByRole('button',{name:'放入熔炉',exact:true}).click();await expect(scene(page)).toHaveAttribute('data-place','furnace');
 const warming=(await state(page)).weapons.find(w=>w.id===id);
 const second=page.waitForResponse(r=>r.url().endsWith('/api/supply/sword'));
 await page.getByRole('button',{name:'领取一把',exact:true}).click();const next=(await(await second).json()).weapon_id;
 await expect(scene(page)).toHaveAttribute('data-weapon-id',next);await expect(scene(page)).toHaveAttribute('data-place','held');
 current=await consistent(page,game,user.address);expect(current.weapons.find(w=>w.id===id)).toEqual(warming);
 expect(current.weapons).toHaveLength(3);expect(current.player.daily_swords_remaining).toBe(1);
});

test('lost daily handoff response retries once without creating a second sword or putting it on the anvil',async({page,game})=>{
 await register(page,false,game);await page.getByRole('button',{name:'环绕查看',exact:true}).click();const keys=[];
 await page.route('**/api/supply/sword',async route=>{
  keys.push(route.request().headers()['idempotency-key']);const response=await route.fetch();
  if(keys.length===1)await route.abort('connectionreset');else await route.fulfill({response});
 });
 await page.getByRole('button',{name:'领取一把',exact:true}).click();
 await expect(scene(page)).toHaveAttribute('data-place','held');expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
 const current=await state(page);expect(current.weapons).toHaveLength(1);expect(current.player.daily_swords_remaining).toBe(2);
 expect(current.player.workshop_weapon_id).toBe(current.weapons[0].id);
});
