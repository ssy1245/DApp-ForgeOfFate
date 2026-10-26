import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(new URL('../../assets/stories/weapons/knightsword-stories.md', import.meta.url), 'utf8');
const rapierSource = await fs.readFile(new URL('../../assets/stories/weapons/rapier-stories.md', import.meta.url), 'utf8');
const greatswordSource = await fs.readFile(new URL('../../assets/stories/weapons/greatsword-stories.md', import.meta.url), 'utf8');
const catalog = JSON.parse(await fs.readFile(new URL('../../assets/3d/sword-tiers.json', import.meta.url), 'utf8'));
const knights = catalog.filter(tier => tier.branch === 'longsword');
const rapiers = catalog.filter(tier => tier.branch === 'rapier');
const greatswords = catalog.filter(tier => tier.branch === 'greatsword');
const documents = [{ source, tiers: knights }, { source: rapierSource, tiers: rapiers }, { source: greatswordSource, tiers: greatswords }];

test('weapon descriptions and stories use the authored Markdown and correct weapon identity', async t => {
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { parseWeaponLore, getWeaponLore } = await server.ssrLoadModule('/src/weaponLoreData.ts');
    const { LanguageProvider } = await server.ssrLoadModule('/src/i18n.tsx');
    const { default: WeaponLore } = await server.ssrLoadModule('/src/WeaponLore.tsx');

    await t.test('three documents cover all twenty-three weapons with separate descriptions and stories', () => {
      const ids = documents.flatMap(({ source }) => parseWeaponLore(source).map(entry => entry.tierId));
      assert.equal(new Set(ids).size, catalog.length);
      assert.deepEqual([...ids].sort(), catalog.map(tier => tier.id).sort());
      for (const { source, tiers } of documents) {
        const entries = parseWeaponLore(source);
        assert.deepEqual(entries.map(entry => entry.tierId), tiers.map(tier => tier.id));
        for (const entry of entries) {
          assert.ok(entry.description.trim(), entry.tierId);
          assert.ok(entry.story.length >= 2, entry.tierId);
          assert.ok(entry.story.every(paragraph => paragraph.trim()), entry.tierId);
          assert.doesNotMatch(entry.description, /###|参考图|整合讨论稿/);
          assert.ok(entry.story.every(paragraph => !/###|参考图|整合讨论稿/.test(paragraph)));
        }
        assert.deepEqual(parseWeaponLore(source.replaceAll('\n', '\r\n')), entries);
        const edited = source.replace(entries[0].description, 'A revised description.');
        assert.equal(parseWeaponLore(edited)[0].description, 'A revised description.');
        assert.deepEqual(parseWeaponLore(edited)[0].story, entries[0].story);
      }
    });

    await t.test('English descriptions and stories cover every stage with matching paragraph boundaries', () => {
      for (const { source, tiers } of documents) {
        const zh = parseWeaponLore(source, 'zh'), en = parseWeaponLore(source, 'en');
        assert.deepEqual(en.map(entry => entry.tierId), tiers.map(tier => tier.id));
        for (let index = 0; index < zh.length; index++) {
          assert.equal(en[index].story.length, zh[index].story.length, zh[index].tierId);
          assert.ok(en[index].description.trim(), en[index].tierId);
          assert.doesNotMatch(en[index].description, /\p{Script=Han}|###|参考图/u);
          for (const paragraph of en[index].story) {
            assert.ok(paragraph.trim(), en[index].tierId);
            assert.doesNotMatch(paragraph, /\p{Script=Han}|###|参考图/u);
            assert.doesNotMatch(paragraph, /\b(?:I|me|my|myself|we|our|ours|us)\b/i);
          }
          const weapon = { tier_id: zh[index].tierId, level: tiers[index].min_level };
          assert.deepEqual(getWeaponLore(weapon, 'zh'), zh[index]);
          assert.deepEqual(getWeaponLore(weapon, 'en'), en[index]);
        }
        assert.deepEqual(parseWeaponLore(source.replaceAll('\n', '\r\n'), 'en'), en);
        const edited = source.replace(en[0].description, 'An edited English description.');
        assert.equal(parseWeaponLore(edited, 'en')[0].description, 'An edited English description.');
        assert.deepEqual(parseWeaponLore(edited, 'zh'), zh);
        assert.deepEqual(parseWeaponLore(edited, 'en')[0].story, en[0].story);
      }
    });

    await t.test('every level maps to its route and final stories persist through each level cap', () => {
      const routes = [{ branch: 'longsword', tiers: knights, max: 90 }, { branch: 'rapier', tiers: [knights[0], ...rapiers], max: 80 }, { branch: 'greatsword', tiers: [knights[0], ...greatswords], max: 70 }];
      for (const { branch, tiers, max } of routes) for (let level = 0; level <= max; level++) for (const locale of ['zh', 'en']) {
        const expected = [...tiers].reverse().find(tier => level >= tier.min_level);
        assert.equal(getWeaponLore({ branch, level }, locale)?.tierId, expected.id, `${locale} ${branch} +${level}`);
      }
      for (const locale of ['zh', 'en']) {
        assert.deepEqual(getWeaponLore({ branch: 'longsword', level: 90 }, locale), getWeaponLore({ branch: 'longsword', level: 80 }, locale));
        assert.deepEqual(getWeaponLore({ branch: 'rapier', level: 80 }, locale), getWeaponLore({ branch: 'rapier', level: 70 }, locale));
        assert.deepEqual(getWeaponLore({ branch: 'greatsword', level: 70 }, locale), getWeaponLore({ branch: 'greatsword', level: 60 }, locale));
      }
    });

    await t.test('frozen NFT identities win over live levels without mixing routes', () => {
      const inherited = knights.find(tier => tier.min_level === 60);
      assert.equal(getWeaponLore({ tier_id: inherited.id, level: 90 })?.tierId, inherited.id);
      assert.equal(getWeaponLore({ name_en: `[DEMO] ${inherited.name_en} +90`, level: 90 })?.tierId, inherited.id);
      for (const relic of [rapiers.at(-1), greatswords.at(-1)]) for (const locale of ['zh', 'en']) {
        assert.equal(getWeaponLore({ tier_id: relic.id, branch: 'longsword', level: 90 }, locale)?.tierId, relic.id);
        assert.equal(getWeaponLore({ name_en: `[DEMO] ${relic.name_en} +80`, level: 80 }, locale)?.tierId, relic.id);
      }
      assert.equal(getWeaponLore({ branch: 'rapier', level: 4 })?.tierId, knights[0].id);
      assert.equal(getWeaponLore({ branch: 'greatsword', level: 9 })?.tierId, knights[0].id);
      assert.equal(getWeaponLore({ branch: 'unknown', level: 60, name: 'Unknown relic' }), undefined);
    });

    await t.test('reader entry is translated and only appears when the weapon has content', () => {
      const render = (locale, weapon) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, React.createElement(WeaponLore, { weapon })));
      const weapon = { branch: 'longsword', level: 90 };
      const zh = render('zh', weapon), en = render('en', weapon);
      assert.match(zh, /武器描述与故事/);
      assert.match(en, /Description &amp; story/);
      assert.match(en, /aria-haspopup="dialog"/);
      assert.doesNotMatch(en, /\p{Script=Han}/u);
      assert.doesNotMatch(zh, /<dialog/);
      assert.match(render('en', { branch: 'rapier', level: 80 }), /Description &amp; story/);
      assert.match(render('en', { branch: 'greatsword', level: 70 }), /Description &amp; story/);
      assert.equal(render('zh', { branch: 'unknown', level: 60, name: 'Unknown relic' }), '');
    });
  } finally {
    await server.close();
  }
});
