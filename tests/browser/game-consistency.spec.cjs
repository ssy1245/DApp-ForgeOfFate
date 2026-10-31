const { test, expect, register, state, agree, consistent } = require('./fixtures.cjs');
const idle = page => expect(page.locator('.notice')).not.toContainText('中…');
async function clickAction(page, button, endpoint) {
  const response = page.waitForResponse(r => r.url().endsWith('/api' + endpoint) && r.request().method() === 'POST');
  await button.click();
  expect((await response).status()).toBe(200);
  await idle(page);
}
async function resources(page, amount = 100000) {
  await page.getByLabel('添加数量', { exact: true }).fill(String(amount));
  await clickAction(page, page.getByRole('button', { name: '添加资源', exact: true }), '/cheats/resources');
}
async function spawnSword(page, level = 0) {
  await page.getByLabel('初始等级', { exact: true }).fill(String(level));
  await page.getByLabel('数量（每批 1–100 把）', { exact: true }).fill('1');
  await clickAction(page, page.getByRole('button', { name: '刷出 1 把剑', exact: true }), '/cheats/weapons');
  return (await state(page)).weapons[0];
}
async function bag(page) { await page.locator('.nav-item').filter({ hasText: '武器仓库' }).click(); }
async function login(page, username) {
  await page.getByRole('button', { name: '账号登录 / 注册', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').nth(0).fill(username);
  await dialog.locator('input').nth(1).fill('test-password-2026');
  await dialog.locator('button.primary').click();
  await expect(page.locator('.account-name')).toContainText(username);
}

test('normal registration, daily supply, three swords and reload match SQLite', async ({ page, game }) => {
  const user = await register(page, false, game);
  await clickAction(page, page.locator('.claim'), '/claim');
  await page.getByRole('button', { name: '环绕查看', exact: true }).click();
  for (let remaining = 2; remaining >= 0; remaining--) {
    await clickAction(page, page.getByRole('button', { name: '领取一把', exact: true }), '/supply/sword');
    await expect(page.locator('.claim-sword')).toHaveAttribute('title', `今日可领 ${remaining} / 3 把`);
    const data = await consistent(page, game, user.address);
    expect(data.weapons).toHaveLength(3 - remaining);
    expect(data.player.daily_swords_remaining).toBe(remaining);
  }
  await expect(page.getByRole('button', { name: '今日已领完', exact: true })).toBeDisabled();
  await expect(page.locator('.claim')).toBeDisabled();
  await bag(page); await expect(page.locator('.weapon-card')).toHaveCount(3);
  await page.reload(); await consistent(page, game, user.address);
  await expect(page.locator('.cheat-panel')).toHaveCount(0);
});

test('real heating, protected strike, shops and recycle stay consistent', async ({ page, game }) => {
  const user = await register(page, true, game);
  await resources(page);
  const sword = await spawnSword(page);
  await clickAction(page, page.getByRole('button', { name: '免损毁 100 锤', exact: true }), `/cheats/weapons/${sword.id}`);
  const before = await state(page);
  await clickAction(page, page.getByRole('button', { name: '送入熔炉加热' }), `/weapons/${sword.id}/heat`);
  await expect(page.getByRole('button', { name: '取回铁砧', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '取回铁砧', exact: true }).click();
  await expect(page.getByRole('button', { name: '敲下命运之锤' })).toBeEnabled({ timeout: 15000 });
  await clickAction(page, page.getByRole('button', { name: '敲下命运之锤' }), `/weapons/${sword.id}/strike`);
  const after = await consistent(page, game, user.address);
  expect(after.player.materials).toBe(before.player.materials - 4);
  expect(after.weapons[0].heat_charges).toBe(4);
  await expect(page.locator('.level-line').first()).toContainText(`+${after.weapons[0].level}`);
  const shopButton = page.getByRole('button', { name: /购买 \+0 普通剑/ });
  await expect(shopButton).toContainText('2,500');
  await clickAction(page, shopButton, '/shop/sword');
  const bought = (await state(page)).weapons.find(w => w.source === 'coin_shop');
  expect(bought).toMatchObject({ level: 0, quality: '普通', recycle_price: 1000 });
  await clickAction(page, page.locator('.material-pack-button'), '/materials');
  await bag(page); await expect(page.locator('.weapon-card')).toHaveCount(2);
  const snapshot = await state(page);
  const card = page.locator('.weapon-card').first();
  await card.getByRole('button', { name: '系统回收', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect((await state(page)).player.coins).toBe(snapshot.player.coins);
  await card.getByRole('button', { name: '系统回收', exact: true }).click(); await agree(page);
  await expect(page.locator('.weapon-card')).toHaveCount(1);
  const recycled = await consistent(page, game, user.address);
  expect(recycled.player.coins).toBe(snapshot.player.coins + snapshot.weapons[0].recycle_price);
});

test('route choice, seal and language switching preserve the same weapon', async ({ page, game }) => {
  const user = await register(page, true, game);
  const sword = await spawnSword(page, 50);
  await page.getByLabel('武器路线 · 按等级解锁', { exact: true }).selectOption('rapier'); await agree(page); await idle(page);
  await expect(page.getByLabel('武器路线 · 按等级解锁', { exact: true })).toBeDisabled();
  await bag(page);
  await page.getByRole('button', { name: '封存', exact: true }).click(); await agree(page);
  await expect(page.locator('.card-status')).toHaveText('已永久封存');
  expect(game.sql('SELECT branch,status FROM weapons WHERE id=?', [sword.id])[0]).toEqual({ branch: 'rapier', status: 'sealed' });
  await expect(page.getByRole('button', { name: '系统回收', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.locator('.card-status')).toHaveText('Permanently sealed');
  await consistent(page, game, user.address);
  await page.reload();
  await expect(page.locator('html')).toBeVisible();
  await page.locator('.nav-item').filter({ hasText: 'Weapon warehouse' }).click();
  await expect(page.locator('.card-status')).toHaveText('Permanently sealed');
});

test('two immediate UI clicks spend only once', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page);
  const before = await state(page);
  const purchase = page.locator('.material-pack-button');
  await purchase.evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => game.sql("SELECT COUNT(*) AS n FROM operations WHERE address=? AND fingerprint IS NOT NULL", [user.address])[0].n).toBe(2);
  await idle(page);
  const after = await consistent(page, game, user.address);
  expect(after.player.coins).toBe(before.player.coins - 5000);
  expect(after.player.materials).toBe(before.player.materials + 20);
});

test('a lost success response retries with the same operation key', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page);
  const before = await state(page); const keys = [];
  await page.route('**/api/materials', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch(); // A real committed database transaction.
    if (keys.length === 1) await route.abort('connectionreset');
    else await route.fulfill({ response });
  });
  await page.locator('.material-pack-button').click();
  await expect.poll(() => keys.length).toBe(2); await idle(page);
  expect(keys[0]).toBe(keys[1]);
  const after = await consistent(page, game, user.address);
  expect(after.player.coins).toBe(before.player.coins - 5000);
  expect(after.player.materials).toBe(before.player.materials + 20);
});

test('a delayed older poll cannot overwrite a completed purchase', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page);
  const before = await state(page);
  let held, release; const gate = new Promise(resolve => { release = resolve; });
  let captured; const started = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/state', async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  try {
    await clickAction(page, page.locator('.material-pack-button'), '/materials');
    await consistent(page, game, user.address);
  } finally { release(); }
  await expect(page.locator('.resource-gold strong')).toHaveText(new Intl.NumberFormat('zh-CN').format(before.player.coins - 5000));
  await page.waitForTimeout(500);
  await consistent(page, game, user.address);
});

test('two tabs recover stale inventory after one recycles a weapon', async ({ page, context, game }) => {
  const user = await register(page, true, game); await spawnSword(page);
  const other = await context.newPage(); await other.goto('/');
  await expect(other.locator('.account-name')).toContainText(user.username);
  await bag(page); await bag(other);
  await expect(other.locator('.weapon-card')).toHaveCount(1);
  await page.getByRole('button', { name: '系统回收', exact: true }).click(); await agree(page);
  await expect(page.locator('.weapon-card')).toHaveCount(0);
  await other.getByRole('button', { name: '系统回收', exact: true }).click(); await agree(other);
  await expect(other.locator('.weapon-card')).toHaveCount(0);
  await consistent(other, game, user.address);
  expect(game.sql('SELECT coins FROM players WHERE address=?', [user.address])[0].coins).toBe(1000);
  await other.close();
});

test('account changed in another tab refreshes both identity and balances', async ({ page, context, game }) => {
  const first = await register(page, true, game); await resources(page, 500);
  const other = await context.newPage(); await other.goto('/');
  await expect(other.locator('.account-name')).toContainText(first.username);
  await other.getByRole('button', { name: '退出账号', exact: true }).click();
  await expect(other.getByRole('button', { name: '账号登录 / 注册', exact: true })).toBeEnabled();
  const second = await register(other, false, game);
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.account-name')).toContainText(second.username);
  await consistent(page, game, second.address);
  expect(game.sql('SELECT coins FROM players WHERE address=?', [first.address])[0].coins).toBe(500);
  await other.close();
});

test('backend restart and account login restore the same stored state', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page, 12345); await spawnSword(page, 30);
  const before = await state(page);
  await game.restart(); await page.reload(); await consistent(page, game, user.address);
  expect((await state(page)).weapons).toEqual(before.weapons);
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveCount(0);
  await login(page, user.username);
  await consistent(page, game, user.address);
  expect((await state(page)).weapons).toEqual(before.weapons);
});

test('disconnected requests do not fabricate balance changes and recover', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page);
  const before = game.sql('SELECT coins,materials FROM players WHERE address=?', [user.address])[0];
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.locator('.material-pack-button').click();
  await expect(page.locator('.notice')).toHaveClass(/error/);
  expect(game.sql('SELECT coins,materials FROM players WHERE address=?', [user.address])[0]).toEqual(before);
  await page.unroute('**/api/**');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await consistent(page, game, user.address);
  await clickAction(page, page.locator('.material-pack-button'), '/materials');
  await consistent(page, game, user.address);
});

test('expired session removes stale controls and login restores progress', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page, 6789);
  game.sql('DELETE FROM sessions WHERE address=?', [user.address]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.cheat-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '账号登录 / 注册', exact: true })).toBeEnabled();
  await login(page, user.username);
  await consistent(page, game, user.address);
});

test('mobile inventory and language switch keep database values unchanged', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page, 54321); await spawnSword(page, 60);
  await page.setViewportSize({ width: 390, height: 844 }); await bag(page);
  await expect(page.locator('.weapon-card')).toHaveCount(1);
  await consistent(page, game, user.address);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await consistent(page, game, user.address);
  await page.locator('.weapon-reference').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.weapon-reference').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-inventory.png', fullPage: true });
});

test('a stale tab cannot submit a purchase for a newly signed-in account', async ({ page, context, game }) => {
  const first = await register(page, true, game); await resources(page);
  const other = await context.newPage(); await other.goto('/');
  await expect(other.locator('.account-name')).toContainText(first.username);
  await other.getByRole('button', { name: '退出账号', exact: true }).click();
  await expect(other.getByRole('button', { name: '账号登录 / 注册', exact: true })).toBeEnabled();
  const second = await register(other, false, game);
  const response = page.waitForResponse(r => r.url().endsWith('/api/materials'));
  // Do not focus the old tab first: it still displays the old account's funds.
  await page.locator('.material-pack-button').evaluate(button => button.click());
  expect((await response).status()).toBe(409);
  expect(game.sql('SELECT coins FROM players WHERE address=?', [first.address])[0].coins).toBe(100000);
  expect(game.sql('SELECT coins FROM players WHERE address=?', [second.address])[0].coins).toBe(0);
  await expect(page.locator('.account-name')).toContainText(second.username);
  await other.close();
});

test('a late expired-session response does not erase a new login', async ({ page, game }) => {
  const user = await register(page, true, game); await resources(page, 4321);
  game.sql('DELETE FROM sessions WHERE address=?', [user.address]);
  let held = false, release, captured;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/state', async route => {
    if (held) return route.continue();
    held = true; const response = await route.fetch();
    expect(response.status()).toBe(401); captured(); await gate; await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  try {
    await page.getByRole('button', { name: '退出账号', exact: true }).click();
    await expect(page.locator('.account-name')).toHaveCount(0);
    await login(page, user.username);
  } finally { release(); }
  await page.waitForTimeout(300);
  await expect(page.locator('.account-name')).toContainText(user.username);
  await consistent(page, game, user.address);
});
