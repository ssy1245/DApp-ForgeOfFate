const { test, expect, register, state } = require('./fixtures.cjs');
const fs = require('node:fs');

test('batch spawning follows the chosen route and clamps the level when switching', async ({ page, game }) => {
  await register(page, true, game);
  const panel = page.locator('.cheat-panel');
  const route = panel.getByRole('combobox', { name: '基础武器', exact: true });
  const level = panel.getByLabel('初始等级', { exact: true });
  const spawn = panel.getByRole('button', { name: '刷出 2 把剑', exact: true });
  await panel.getByLabel('数量（每批 1–100 把）', { exact: true }).fill('2');
  await expect(route.locator('option')).toHaveCount(3);
  await expect(level).toHaveAttribute('max', '90');
  await panel.getByRole('button', { name: '+90', exact: true }).click();
  await route.selectOption('rapier');
  await expect(level).toHaveValue('80');
  await expect(level).toHaveAttribute('max', '80');
  await expect(panel.getByRole('button', { name: '+90', exact: true })).toHaveCount(0);
  await route.selectOption('greatsword');
  await expect(level).toHaveValue('70');
  await expect(level).toHaveAttribute('max', '70');
  await level.fill('71');
  await expect(spawn).toBeDisabled();
  await level.fill('');
  await expect(spawn).toBeDisabled();
  await route.selectOption('longsword');
  await expect(level).toHaveValue('0');
  let total = 0;
  for (const [branch, cap] of [['longsword', 90], ['rapier', 80], ['greatsword', 70]]) {
    await route.selectOption(branch);
    await expect(level).toHaveAttribute('max', String(cap));
    await panel.getByRole('button', { name: `+${cap}`, exact: true }).click();
    const sent = page.waitForResponse(r => r.url().endsWith('/api/cheats/weapons') && r.request().method() === 'POST');
    await spawn.click();
    const response = await sent;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ count: 2, level: cap, branch });
    total += 2;
    await expect.poll(async () => (await state(page)).weapons.length).toBe(total);
    const swords = (await state(page)).weapons.filter(w => w.branch === branch);
    expect(swords).toHaveLength(2);
    expect(swords.every(w => w.level === cap && w.max_level === cap && w.demo === 1)).toBe(true);
    await expect(route).toBeEnabled();
  }
  await page.reload();
  expect((await state(page)).weapons).toHaveLength(6);
});

test('cheat form fields align within their cards on desktop and mobile in both languages', async ({ page, game }) => {
  await register(page, true, game);
  fs.mkdirSync('test-results/cheat-menu', { recursive: true });
  for (const [locale, width] of [['zh', 1440], ['en', 390]]) {
    await page.getByRole('button', { name: locale === 'en' ? 'Switch to English' : '切换为中文', exact: true }).click();
    await page.setViewportSize({ width, height: 1000 });
    const panel = page.locator('.cheat-panel');
    await panel.scrollIntoViewIfNeeded();
    const fields = await panel.locator('.cheat-section label').evaluateAll(labels => labels.map(label => {
      const a = label.getBoundingClientRect(), b = label.querySelector('input,select').getBoundingClientRect();
      return { left: b.left - a.left, width: b.width - a.width };
    }));
    expect(fields.every(field => Math.abs(field.left) < 1 && Math.abs(field.width) < 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/cheat-menu/${locale}-${width}.png` });
  }
});
