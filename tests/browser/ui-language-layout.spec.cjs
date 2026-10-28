const { test, expect, register, state } = require('./fixtures.cjs');
const fs = require('node:fs');

async function englishOnly(page) {
  const untranslated = await page.locator('body').evaluate(body => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      if (!element || element.closest('[lang="zh-CN"],script,style,option')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => rect.width && rect.height) && /\p{Script=Han}/u.test(node.textContent)) found.push(node.textContent.trim());
    }
    for (const element of body.querySelectorAll('[aria-label],[placeholder],img[alt]')) {
      if (element.closest('[lang="zh-CN"]') || !element.getClientRects().length) continue;
      for (const attr of ['aria-label', 'placeholder', 'alt']) {
        const value = element.getAttribute(attr);
        if (value && /\p{Script=Han}/u.test(value)) found.push(`${attr}: ${value}`);
      }
    }
    return found;
  });
  expect(untranslated).toEqual([]);
}

async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('new controls default to a quiet layout, with complete English across game surfaces', async ({ page, game }) => {
  const user = await register(page, false, game);
  game.sql("UPDATE accounts SET role='tester' WHERE username=?", [user.username]);
  await page.reload();
  await expect(page.locator('.cheat-heading')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.cheat-content')).toBeHidden();
  await expect(page.locator('.forge-rules').first()).not.toHaveAttribute('open');
  await expect(page.locator('.view-settings')).not.toHaveAttribute('open');
  await expect(page.locator('.hud-heading')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sword-supply-hud,.walk-pad,.workshop-entry kbd')).toHaveCount(0);
  await page.locator('.cheat-heading').click();
  await page.getByRole('button', { name: '添加资源', exact: true }).click();
  await page.getByLabel('初始等级', { exact: true }).fill('50');
  await page.getByRole('button', { name: '刷出 3 把剑', exact: true }).click();
  await expect.poll(async () => (await state(page)).weapons.length).toBe(3);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await englishOnly(page);
  await page.locator('.forge-rules summary').first().click();
  await page.locator('.forge-rules summary').last().click();
  await page.locator('.view-settings summary').click();
  await expect(page.getByLabel('Look sensitivity', { exact: true })).toBeVisible();
  await englishOnly(page);
  await page.locator('.view-settings summary').click();
  await page.locator('.hud-heading').click();
  await englishOnly(page);
  await page.locator('.hud-heading').click();
  await page.getByRole('button', { name: 'Open in-game warehouse', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Weapon warehouse', exact: true })).toBeVisible();
  await englishOnly(page);
  await page.getByRole('button', { name: 'Back to game' }).click();
  await page.locator('.forge-card .weapon-lore-trigger').click();
  await expect(page.locator('.weapon-lore-dialog')).toBeVisible();
  await englishOnly(page);
  await page.locator('.weapon-lore-dialog').getByRole('button', { name: 'Close', exact: false }).click();
  await page.locator('.nav-item').nth(1).click();
  await englishOnly(page);
  await page.locator('.weapon-card').first().getByRole('button', { name: 'Recycle', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await englishOnly(page);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.nav-item').nth(2).click();
  await expect(page.getByRole('heading', { name: 'NFT features are being prepared' })).toBeVisible();
  await englishOnly(page);
  await page.getByRole('button', { name: '切换为中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'NFT 功能准备中' })).toBeVisible();
  await expect(page.locator('.chain-history')).toContainText('链上记录与同步');
  expect((await state(page)).weapons.length).toBe(3);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in / Register', exact: true }).click();
  await expect(page.locator('.account-dialog')).toBeVisible();
  await englishOnly(page);
  await page.locator('.account-dialog').getByRole('button', { name: 'Create account', exact: true }).click();
  await englishOnly(page);
});

test('Chinese and English workshop layouts fit desktop and narrow screens', async ({ page, game }) => {
  await register(page, false, game);
  await page.locator('.claim').click();
  await page.getByRole('button', { name: '环绕查看', exact: true }).click();
  await page.getByRole('button', { name: '领取一把', exact: true }).click();
  await expect(page.locator('.workshop-view')).not.toHaveAttribute('data-weapon-id', '');
  fs.mkdirSync('test-results/ui-review', { recursive: true });
  for (const locale of ['zh', 'en']) {
    await page.getByRole('button', { name: locale === 'en' ? 'Switch to English' : '切换为中文', exact: true }).click();
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.nav-item').first().click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await fits(page);
      const scene = await page.locator('.workshop-view').boundingBox();
      const hud = await page.locator('.forge-hud').boundingBox();
      expect(hud.x).toBeGreaterThanOrEqual(scene.x);
      expect(hud.x + hud.width).toBeLessThanOrEqual(scene.x + scene.width);
      await expect(page.locator('.sword-supply-hud,.walk-pad')).toHaveCount(0);
      if (locale === 'en') await englishOnly(page);
      await page.screenshot({ path: `test-results/ui-review/workshop-${locale}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: locale === 'en' ? 'Open in-game warehouse' : '打开场景仓库', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.keyboard.press('Escape');
      await page.locator('.nav-item').nth(1).click(); await fits(page);
      await page.locator('.nav-item').nth(2).click(); await fits(page);
      await page.locator('.nav-item').first().click();
    }
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
