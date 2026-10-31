import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const messages = JSON.parse(await fs.readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await fs.readFile(new URL('../../assets/3d/sword-tiers.json', import.meta.url), 'utf8'));

test('Chinese and English UI, runtime messages, weapon identities and saved preference', async t => {
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1280, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } };
  try {
    const { createTranslator, translate, readLocale, persistLocale, LANGUAGE_STORAGE_KEY } = await server.ssrLoadModule('/src/locale.ts');
    const { LanguageProvider } = await server.ssrLoadModule('/src/i18n.tsx');
    const { default: WeaponCard } = await server.ssrLoadModule('/src/WeaponCard.tsx');
    const { default: CheatPanel } = await server.ssrLoadModule('/src/CheatPanel.tsx');
    const { GoldAmount } = await server.ssrLoadModule('/src/GoldIcon.tsx');
    const { WardAmount } = await server.ssrLoadModule('/src/WardIcon.tsx');
    const { ConfirmationDialog } = await server.ssrLoadModule('/src/ConfirmationDialog.tsx');
    const { default: App } = await server.ssrLoadModule('/src/App.tsx');
    const english = createTranslator('en'), chinese = createTranslator('zh');
    const page = (locale, child) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, child));
    const text = html => html.replace(/<[^>]*>/g, '').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');
    const parameters = key => [...key.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1])).sort();

    await t.test('every app-owned Chinese source message has an English entry', async () => {
      const branches = JSON.parse(await fs.readFile(new URL('../../assets/3d/sword-branches.json', import.meta.url), 'utf8'));
      const knownNames = new Set([...catalog, ...branches].map(item => item.name));
      const bilingualLanguageControls = new Set(['Forge of Fate · 命运锻造所', '语言', '切换为中文', '中文']);
      const missing = [];
      for (const file of (await fs.readdir(path.join(root, 'src'))).filter(file => /\.tsx?$/.test(file))) {
        const content = await fs.readFile(path.join(root, 'src', file), 'utf8');
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        function inspect(node) {
          let value;
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) value = node.text.trim();
          if (ts.isTemplateExpression(node)) value = (node.head.text + node.templateSpans.map((span, i) => `{${i}}` + span.literal.text).join('')).trim();
          if (value && /\p{Script=Han}/u.test(value) && !knownNames.has(value) && messages[value] === undefined && !(file === 'i18n.tsx' && bilingualLanguageControls.has(value))) {
            missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} ${value}`);
          }
          ts.forEachChild(node, inspect);
        }
        inspect(source);
      }
      assert.deepEqual(missing, [], 'Add an English translation when adding visible messages or runtime notices.');
    });

    await t.test('every translated template preserves all parameters', () => {
      for (const [key, value] of Object.entries(messages)) {
        assert.ok(value.trim(), key);
        assert.doesNotMatch(value, /\p{Script=Han}/u, key);
        assert.deepEqual(parameters(value), parameters(key), key);
      }
    });
    await t.test('server responses and pending actions translate without changing user data', () => {
      const cases = [
        ['已领取一把 +0 普通剑，今日还可领 2 把。', 'Claimed one +0 common sword. You can claim 2 more today.'],
        ['加热需要 2 铁块，当前剩余 0。请领取每日补给或补充铁块。', 'Heating requires 2 iron; you have 0. Claim daily supplies or buy more iron.'],
        ['已放入熔炉，加热 3 秒后可敲击 5 次。', 'Weapon placed in the furnace. After 3 seconds, it will be ready for 5 strikes.'],
        ['已刷出 3 把 +50 精良剑。', 'Spawned 3 +50 Refined swords.'],
        ['已生成 3 把 +70 巨剑。', 'Spawned 3 +70 Greatsword weapons.'],
        ['已选择巨剑路线。该路线已固定，无法再更换。', 'Selected the Greatsword route. This choice is permanent.'],
        ['刺剑路线最高 +80，当前等级过高，无法切换。', 'The Rapier route is capped at +80. Your current level is too high to switch.'],
        ['铭刻 NFT已提交，等待链上确认：0x123…abcd', 'Mint NFT submitted. Waiting for confirmation: 0x123…abcd'],
        ['已从展示柜 2拿起武器。', 'Weapon picked up from Display cabinet 2.'],
        ['武器已回收，获得 100000000 金币。', 'Weapon recycled for 100000000 gold.'],
        ['欢迎，铁块。游戏档案已恢复。', 'Welcome, 铁块. Your game save has been restored.'],
      ];
      for (const [source, expected] of cases) {
        assert.equal(english(source), expected);
        assert.equal(chinese(source), source);
      }
      assert.equal(english`回收后武器消失，获得 ${'100,000,000'} 游戏金币。确定？`, 'Recycling removes this weapon and grants 100,000,000 gold. Continue?');
      assert.equal(chinese`今日可领 ${2} / ${3} 把`, '今日可领 2 / 3 把');
    });
    await t.test('language storage is resilient to missing, invalid or disabled storage', () => {
      const values = new Map();
      const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
      assert.equal(readLocale(storage), 'zh');
      persistLocale('en', storage);
      assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'en');
      assert.equal(readLocale(storage), 'en');
      values.set(LANGUAGE_STORAGE_KEY, 'unexpected');
      assert.equal(readLocale(storage), 'zh');
      assert.equal(readLocale({ getItem() { throw Error('blocked'); } }), 'zh');
      assert.doesNotThrow(() => persistLocale('en', { setItem() { throw Error('blocked'); } }));
    });
    await t.test('all 23 weapon cards and NFT cards use the selected language', () => {
      for (const tier of catalog) for (const nft of [false, true]) {
        const weapon = { ...tier, tier_id: tier.id, level: tier.min_level, quality: '精良', demo: true };
        const props = locale => ({ weapon, nft, serial: '#123', status: translate(locale, '已永久封存'), valueLabel: translate(locale, '系统回收估值'), value: '100,000,000', valueUnit: translate(locale, '金币'), children: React.createElement('button', null, translate(locale, '查看武器')) });
        const en = page('en', React.createElement(WeaponCard, props('en')));
        const zh = page('zh', React.createElement(WeaponCard, props('zh')));
        assert.ok(text(en).includes(tier.name_en), tier.id);
        assert.ok(text(zh).includes(tier.name), tier.id);
        assert.doesNotMatch(text(en), /\p{Script=Han}/u, tier.id);
        assert.ok(en.includes('alt='), tier.id);
        assert.ok(en.includes('data-branch='), tier.id);
      }
    });
    await t.test('English test menu retains route IDs and displays their level caps', () => {
      const html = page('en', React.createElement(CheatPanel, { busy: false, maxLevel: 100, heatStrikes: 5, weapon: { id: 'test', name: catalog[0].name, level: 0, status: 'active' }, onAction: async () => {} }));
      assert.doesNotMatch(text(html), /\p{Script=Han}/u);
      for (const [route,label,limit] of [['longsword','Knight Sword',90],['rapier','Rapier',80],['greatsword','Greatsword',70]]) {
        assert.ok(html.includes(`value="${route}"`));
        assert.ok(text(html).includes(`${label} · Max +${limit}`));
      }
    });
    await t.test('currency amounts and confirmation controls follow the language', () => {
      for (const locale of ['zh', 'en']) {
        const amount = page(locale, React.createElement(GoldAmount, { amount: '100,000,000' }));
        assert.match(amount, /Gold-icon/);
        assert.match(text(amount), locale === 'en' ? /Gold/ : /金币/);
        const wards = page(locale, React.createElement(WardAmount, { amount: 5 }));
        assert.match(wards, /protect/);
        assert.match(text(wards), locale === 'en' ? /Wards/ : /保护符/);
        const dialog = page(locale, React.createElement(ConfirmationDialog, { message: '回收后武器消失，获得 100,000,000 游戏金币。确定？', onAnswer() {} }));
        assert.match(dialog, /role="alertdialog"/);
        assert.match(text(dialog), locale === 'en' ? /Recycling removes this weapon/ : /回收后武器消失/);
        assert.match(text(dialog), locale === 'en' ? /Cancel/ : /取消/);
        assert.match(text(dialog), locale === 'en' ? /Confirm/ : /确认/);
      }
    });
    await t.test('initial workshop is fully English and Chinese remains available', () => {
      const en = text(page('en', React.createElement(App)));
      const zh = text(page('zh', React.createElement(App)));
      assert.match(en, /Workshop/);
      assert.match(en, /Claim daily supplies/);
      assert.match(en, /Workshop empty · take a weapon from storage/);
      assert.match(en, /Store weapon/);
      assert.match(en, /Open warehouse/);
      assert.doesNotMatch(en.replace('中文', ''), /\p{Script=Han}/u);
      assert.match(zh, /锻造工坊/);
      assert.match(zh, /领取每日补给/);
      assert.match(zh, /工坊空闲/);
      assert.match(zh, /存入仓库/);
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await server.close();
  }
});
