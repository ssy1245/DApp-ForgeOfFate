const { test, expect, register, state } = require('./fixtures.cjs');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');

function deliver(game, owner, amounts) {
  const ids = amounts.map(() => randomUUID());
  const rows = amounts.map((amount, i) => [ids[i], owner, 'staking_daily', `2026-10-${String(1 + i % 30).padStart(2, '0')}`, randomUUID(), amount, 1000 + i]);
  game.sql(`INSERT INTO reward_mail(id,owner,kind,reward_day,source_key,coins,created_at) VALUES ${rows.map(() => '(?,?,?,?,?,?,?)').join(',')}`, rows.flat());
  return ids;
}
async function openInbox(page) {
  await page.locator('.nav-item').filter({ hasText: '奖励邮箱' }).click();
  await expect(page.locator('.mail-toolbar h2')).toContainText('收件箱');
  await expect(page.locator('.mail-loading')).toHaveCount(0);
}
async function openMail(page, id) {
  await page.locator(`.mail-row[data-mail-id="${id}"]`).click();
  await expect(page.getByRole('button', { name: '领取奖励并删除邮件', exact: true })).toBeEnabled();
}
function coins(game, address) { return game.sql('SELECT coins FROM players WHERE address=?', [address])[0].coins; }
function ledger(game, address) { return game.sql('SELECT * FROM reward_mail_claims WHERE owner=?', [address]); }

test('opening mail only marks it read; collecting removes it and preserves the balance on reload', async ({ page, game }) => {
  const user = await register(page, false, game);
  const ids = deliver(game, user.address, [500, 800]);
  await openInbox(page);
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await openMail(page, ids[0]);
  expect(coins(game, user.address)).toBe(0);
  expect(game.sql('SELECT read_at FROM reward_mail WHERE id=?', [ids[0]])[0].read_at).not.toBeNull();
  await expect(page.locator('.mail-test-tools')).toHaveCount(0);
  await page.getByRole('button', { name: '领取奖励并删除邮件', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await expect.poll(() => coins(game, user.address)).toBe(500);
  expect(ledger(game, user.address)).toHaveLength(1);
  await expect(page.locator('.resource-gold strong')).toHaveText('500');
  await page.reload(); await openInbox(page);
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: '一键收取', exact: true }).click();
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  expect(coins(game, user.address)).toBe(1300);
  expect(ledger(game, user.address)).toHaveLength(2);
});

test('new mail announces itself without reloading and stays visible until all rewards are collected', async ({ page, game }) => {
  const user = await register(page, false, game);
  await expect(page.locator('.mail-arrival')).toHaveCount(0);
  const [id] = deliver(game, user.address, [400]);
  await expect(page.locator('.mail-arrival')).toContainText('1 封待领取，1 封未读');
  await expect(page.locator('.mail-badge.has-unread')).toHaveText('1');
  await page.getByRole('button', { name: '查看邮件', exact: true }).click();
  await openMail(page, id);
  await page.locator('.nav-item').filter({ hasText: '锻造工坊' }).click();
  await expect(page.locator('.mail-arrival')).toContainText('1 封待领取，0 封未读');
  await expect(page.locator('.mail-badge')).toHaveText('1');
  await expect(page.locator('.mail-badge.has-unread')).toHaveCount(0);
  await page.getByRole('button', { name: '查看邮件', exact: true }).click();
  await page.getByRole('button', { name: '一键收取', exact: true }).click();
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  await page.locator('.nav-item').filter({ hasText: '锻造工坊' }).click();
  await expect(page.locator('.mail-arrival')).toHaveCount(0);
  await expect(page.locator('.mail-badge')).toHaveCount(0);
  expect(coins(game, user.address)).toBe(400);
});

test('lost responses and double clicks cannot duplicate test delivery or reward collection', async ({ page, game }) => {
  const user = await register(page, true, game);
  await openInbox(page);
  const keys = [];
  await page.route('**/api/cheats/mail', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '生成测试邮件', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('.mail-row')).toHaveCount(1);
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1);
  expect(coins(game, user.address)).toBe(0);
  const id = game.sql('SELECT id FROM reward_mail WHERE owner=?', [user.address])[0].id;
  await openMail(page, id);
  const claimKeys = [];
  await page.route(`**/api/mail/${id}/claim`, async route => {
    claimKeys.push(route.request().headers()['idempotency-key']);
    if (claimKeys.length === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '领取奖励并删除邮件', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  expect(claimKeys).toHaveLength(2); expect(new Set(claimKeys).size).toBe(1);
  expect(coins(game, user.address)).toBe(1000); expect(ledger(game, user.address)).toHaveLength(1);
});

test('two tabs racing single and bulk collection credit each mail exactly once', async ({ page, game }) => {
  const user = await register(page, false, game);
  const ids = deliver(game, user.address, [100, 200, 300]);
  await openInbox(page); await openMail(page, ids[0]);
  const other = await page.context().newPage();
  await other.goto('/'); await openInbox(other);
  let waiting = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const hold = async route => { if (++waiting === 2) release(); await gate; await route.continue(); };
  await page.route(`**/api/mail/${ids[0]}/claim`, hold);
  await other.route('**/api/mail/claim-all', hold);
  await Promise.all([
    page.getByRole('button', { name: '领取奖励并删除邮件', exact: true }).click(),
    other.getByRole('button', { name: '一键收取', exact: true }).click(),
  ]);
  await expect.poll(() => coins(game, user.address)).toBe(600);
  await expect.poll(() => ledger(game, user.address).length).toBe(3);
  await expect(other.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新邮箱', exact: true }).click();
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  expect(new Set(ledger(game, user.address).map(row => row.mail_id)).size).toBe(3);
  await other.close();
});

test('last-page collection repairs pagination and collect-all includes hidden pages', async ({ page, game }) => {
  const user = await register(page, false, game);
  deliver(game, user.address, Array(31).fill(10));
  await openInbox(page); await expect(page.locator('.mail-row')).toHaveCount(30);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  const id = await page.locator('.mail-row').getAttribute('data-mail-id');
  await openMail(page, id);
  await page.getByRole('button', { name: '领取奖励并删除邮件', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(30);
  await page.getByRole('button', { name: '一键收取', exact: true }).click();
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  expect(coins(game, user.address)).toBe(310); expect(ledger(game, user.address)).toHaveLength(31);
});

test('failed reads disable stale collection and delayed mail cannot leak across sign-out', async ({ page, game }) => {
  const user = await register(page, false, game); deliver(game, user.address, [321]);
  await openInbox(page); await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.route('**/api/mail?*', route => route.abort('failed'));
  await page.getByRole('button', { name: '刷新邮箱', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱暂时无法读取');
  await expect(page.getByRole('button', { name: '一键收取', exact: true })).toBeDisabled();
  await page.unroute('**/api/mail?*');
  let requested, release;
  const started = new Promise(resolve => { requested = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/mail?*', async route => { const response = await route.fetch(); requested(); await gate; await route.fulfill({ response }); });
  await page.getByRole('button', { name: '刷新邮箱', exact: true }).click(); await started;
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await expect(page.getByText('登录后查看奖励', { exact: true })).toBeVisible();
  release(); await page.unrouteAll({ behavior: 'wait' });
  await expect(page.locator('.mail-row')).toHaveCount(0);
  const next = await register(page, false, game); await openInbox(page);
  await expect(page.getByText('暂无待领取邮件', { exact: true })).toBeVisible();
  expect(coins(game, user.address)).toBe(0); expect(coins(game, next.address)).toBe(0);
});

test('mail details and test tools fit desktop Chinese and mobile English', async ({ page, game }) => {
  const user = await register(page, true, game);
  const [id] = deliver(game, user.address, [1200]);
  await openInbox(page); await openMail(page, id);
  fs.mkdirSync('test-results/mailbox', { recursive: true });
  for (const [locale, width] of [['zh', 1440], ['en', 390]]) {
    await page.getByRole('button', { name: locale === 'en' ? 'Switch to English' : '切换为中文', exact: true }).click();
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (locale === 'en') expect(await page.locator('.reward-mailbox').innerText()).not.toMatch(/\p{Script=Han}/u);
    await page.locator('.reward-mailbox').screenshot({ path: `test-results/mailbox/${locale}-${width}.png` });
  }
  expect((await state(page)).player.coins).toBe(0);
});


test('sale notifications show exact ETH amount, cannot award gold and can be dismissed',async({page,game})=>{
 const user=await register(page,false,game),id=randomUUID();
 const trade={token_id:'70040015053319833925070134247553094792372603883471276971352987907260594856800',buyer:'0x'+'12'.repeat(20),seller:'0x'+'34'.repeat(20),price_wei:'10000000000000001',transaction_hash:'0x'+'ab'.repeat(32),chain_id:11155111,contract:'0x'+'56'.repeat(20),block_number:123};
 game.sql('INSERT INTO notice_mail(id,owner,source_key,payload,created_at) VALUES(?,?,?,?,?)',[id,user.address,'sale-test',JSON.stringify(trade),1793440000]);
 await expect(page.locator('.mail-arrival')).toContainText('邮箱有新消息');
 await expect(page.locator('.mail-badge.has-unread')).toHaveText('1');
 await openInbox(page);
 await expect(page.getByRole('button',{name:'一键收取',exact:true})).toBeDisabled();
 await page.locator('.mail-row').click();
 await expect(page.locator('.mail-detail')).toContainText('交易成功');
 await expect(page.locator('.mail-detail')).toContainText(trade.token_id);
 await expect(page.locator('.mail-detail')).toContainText('0.010000000000000001');
 await expect(page.getByRole('button',{name:'领取奖励并删除邮件',exact:true})).toHaveCount(0);
 expect(coins(game,user.address)).toBe(0);
 await page.screenshot({path:'test-results/browser/sale-notification.png',fullPage:true});
 await page.getByRole('button',{name:'删除通知邮件',exact:true}).click();
 await expect(page.locator('.mail-row')).toHaveCount(0);
 expect(coins(game,user.address)).toBe(0);expect(ledger(game,user.address)).toHaveLength(0);
 await page.reload();await openInbox(page);await expect(page.locator('.mail-row')).toHaveCount(0);
});
