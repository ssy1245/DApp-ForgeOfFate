const {test,expect,register,state}=require('./fixtures.cjs');
const dialog=page=>page.getByRole('dialog');
const focus=page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
async function spawn(page,level=4){
 await page.getByLabel('初始等级',{exact:true}).fill(String(level));
 await page.getByLabel('数量（每批 1–100 把）',{exact:true}).fill('1');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/cheats/weapons')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'刷出 1 把剑',exact:true}).click();
 const id=(await(await response).json()).weapon_id;
 await expect(page.locator('.notice')).not.toContainText('中…');return id;
}
async function prepare(page,game){
 await register(page,true,game);const id=await spawn(page);
 await page.getByRole('button',{name:'环绕查看',exact:true}).click();return id;
}
async function level(page,game,id,value){
 game.sql('UPDATE weapons SET level=?,heat_charges=5,heat_ready_at=0 WHERE id=?',[value,id]);
 game.sql('UPDATE players SET materials=1000 WHERE address=(SELECT owner FROM weapons WHERE id=?)',[id]);
 await focus(page);
 await expect(page.locator('.forge-current-level')).toContainText(`+${value}`);
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
}
// Deterministic server snapshots for UI tests. Real random draws, deduplication
// and transaction boundaries are exercised by test_weapon_mutations.py.
async function strike(page,game,id,from,to,mutation=null,{loseResponse=false}={}){
 await level(page,game,id,from);let requests=0;const keys=[];
 const row=game.sql('SELECT branch,mutation_checked_level FROM weapons WHERE id=?',[id])[0];
 const branch=mutation?.changed?mutation.branch:row.branch;
 const result={result:(mutation?.reached_level??to)-from===2?'double':'up',level:to,status:'active',branch,shield_used:false,mutation};
 await page.route(`**/api/weapons/${id}/strike`,async route=>{
  requests++;keys.push(route.request().headers()['idempotency-key']);
  if(requests===1)game.sql('UPDATE weapons SET level=?,branch=?,mutation_checked_level=?,strikes=strikes+1,heat_charges=heat_charges-1 WHERE id=?',[to,branch,mutation?.level??row.mutation_checked_level,id]);
  if(loseResponse&&requests===1)await route.abort('connectionreset');else await route.fulfill({json:result});
 },{times:loseResponse?2:1});
 await page.getByRole('button',{name:'敲下命运之锤'}).click();
 await expect(page.locator('.notice')).not.toContainText('中…');return keys;
}
const mutation=(branch,changed,reached_level)=>({branch,changed,reached_level,chance:.3,level:branch==='rapier'?5:10});

test('server Rapier mutation is already applied; result popup blocks input and never submits a route choice',async({page,game})=>{
 const id=await prepare(page,game);let changes=0;
 page.on('request',r=>{if(r.url().endsWith(`/weapons/${id}/branch`))changes++;});
 await strike(page,game,id,4,5,mutation('rapier',true,6));
 await expect(dialog(page)).toContainText('突变成功 · 刺剑');
 await expect(dialog(page)).toContainText('此后不再参与任何路线突变判定');
 expect(game.sql('SELECT branch,level FROM weapons WHERE id=?',[id])[0]).toEqual({branch:'rapier',level:5});
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeDisabled();
 await dialog(page).getByRole('heading').evaluate(el=>{el.tabIndex=-1;el.focus();});await page.keyboard.press('Space');
 await expect(dialog(page)).toBeVisible();
 await dialog(page).getByRole('button',{name:'继续锻造',exact:true}).focus();
 await expect(dialog(page).getByRole('button',{name:'继续锻造',exact:true})).toBeInViewport();
 await page.screenshot({path:'test-results/browser/mutation-rapier.png'});
 await dialog(page).getByRole('button',{name:'继续锻造',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);expect(changes).toBe(0);
 await strike(page,game,id,9,10);await expect(dialog(page)).toHaveCount(0);
 await expect(page.locator('.weapon-routes [data-route=greatsword]')).toContainText('不会再次判定');
});

test('failed Rapier stays silent and retains levels, later Greatsword can succeed; reload does not replay and mobile English fits',async({page,game})=>{
 const id=await prepare(page,game);
 await strike(page,game,id,4,6,mutation('rapier',false,6));await expect(dialog(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
 expect(game.sql('SELECT branch,level FROM weapons WHERE id=?',[id])[0]).toEqual({branch:'longsword',level:6});
 await page.reload();
 await expect(page.locator('.workshop-view')).toHaveAttribute('data-weapon-id',id);await expect(dialog(page)).toHaveCount(0);
 await strike(page,game,id,4,5);await expect(dialog(page)).toHaveCount(0);
 await strike(page,game,id,9,10,mutation('greatsword',true,11));
 await expect(dialog(page)).toContainText('突变成功 · 巨剑');
 await dialog(page).getByRole('button',{name:'Switch to English',exact:true}).click();await page.setViewportSize({width:390,height:844});
 await expect(dialog(page)).toContainText('Mutation · Greatsword');await expect(dialog(page)).toContainText('Your new route starts at +10');
 expect(await dialog(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await expect(dialog(page).getByRole('button',{name:'Continue forging',exact:true})).toBeInViewport();
 await dialog(page).screenshot({path:'test-results/browser/mutation-greatsword-mobile.png'});
 await dialog(page).getByRole('button',{name:'Continue forging',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);
 expect(game.sql('SELECT branch,level FROM weapons WHERE id=?',[id])[0]).toEqual({branch:'greatsword',level:10});
});

test('both failed checks keep Knight Sword without popups or pausing forging; no extra mutation on rereaching the milestones',async({page,game})=>{
 const id=await prepare(page,game);
 await strike(page,game,id,4,5,mutation('rapier',false,5));await expect(dialog(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
 await strike(page,game,id,9,11,mutation('greatsword',false,11));await expect(dialog(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'敲下命运之锤'})).toBeEnabled();
 await expect(page.locator('.weapon-routes button')).toHaveCount(0);
 await strike(page,game,id,9,10);await expect(dialog(page)).toHaveCount(0);
 expect(game.sql('SELECT branch,mutation_checked_level FROM weapons WHERE id=?',[id])[0]).toEqual({branch:'longsword',mutation_checked_level:10});
});

test('lost committed mutation response retries the same operation and shows the saved result once',async({page,game})=>{
 const id=await prepare(page,game);
 const keys=await strike(page,game,id,4,5,mutation('rapier',true,5),{loseResponse:true});
 await expect(dialog(page)).toContainText('突变成功 · 刺剑');expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
 expect(game.sql('SELECT strikes,heat_charges FROM weapons WHERE id=?',[id])[0]).toEqual({strikes:1,heat_charges:4});
 await page.keyboard.press('Escape');await focus(page);await expect(dialog(page)).toHaveCount(0);
});

test('invalidated weapon closes the result; importing a high-level sword does not invent a mutation',async({page,game})=>{
 const id=await prepare(page,game);await strike(page,game,id,4,5,mutation('rapier',true,5));await expect(dialog(page)).toBeVisible();
 game.sql("UPDATE weapons SET status='destroyed' WHERE id=?",[id]);await focus(page);await expect(dialog(page)).toHaveCount(0);
 await expect(page.locator('.workshop-view')).toHaveAttribute('data-weapon-id','');await spawn(page,30);await expect(dialog(page)).toHaveCount(0);
 const current=await state(page);expect(current.weapons.every(w=>w.branch==='longsword'&&w.mutation_checked_level===10)).toBe(true);
});
