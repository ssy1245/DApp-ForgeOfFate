import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { modelUrl } from '../src/modelAssets.ts';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const assets = path.join(projectRoot, 'assets/3d');
const catalog = JSON.parse(await fs.readFile(path.join(assets, 'sword-tiers.json'), 'utf8'));
const branches = JSON.parse(await fs.readFile(path.join(assets, 'sword-branches.json'), 'utf8'));
const models = [...new Set([
  ...catalog.map(tier => tier.model),
  ...branches.flatMap(branch => branch.tiers ?? []).map(tier => tier.model),
  'hammer',
])];

for (const mode of ['development', 'preview']) {
  test(`${mode} serves every configured model from its current folder`, async () => {
    const options = {
      root: path.join(projectRoot, 'frontend'),
      configFile: path.join(projectRoot, 'frontend/vite.config.ts'),
    };
    const server = mode === 'development'
      ? await createServer({ ...options, server: { host: '127.0.0.1', port: 5179, strictPort: false, hmr: false } })
      : await preview({ ...options, preview: { host: '127.0.0.1', port: 4179, strictPort: false } });
    try {
      if (mode === 'development') await server.listen();
      if (mode === 'development') {
        const { branchTiers, swordTier, nextSwordTier, swordBranches, maxSwordLevel, pendingSwordLevels, localizedName } = await server.ssrLoadModule('/src/swordTiers.ts');
        for (const branch of swordBranches) {
          const tiers = branchTiers(branch.id);
          assert.deepEqual(tiers.map(tier => tier.min_level), branch.id === 'rapier' ? [0, 5, 10, 20, 30, 40, 50, 60, 70] : branch.id === 'longsword' ? [0, 10, 20, 30, 40, 50, 60, 70, 80] : [0, 10, 20, 30, 40, 50]);
          assert.equal(branch.unlock_level, branch.id === 'greatsword' ? 10 : 5);
          assert.equal(swordTier(4, tiers).name, '余烬长剑');
          assert.equal(swordTier(5, tiers).name, branch.id === 'rapier' ? '精铁刺剑' : '余烬长剑');
          for (let level = tiers.at(-1).min_level; level <= maxSwordLevel(branch.id); level++) {
            assert.deepEqual(swordTier(level, tiers), tiers.at(-1));
            assert.equal(nextSwordTier(level, tiers), undefined);
          }
        }
        const englishNames = {
          longsword: ['Ember Longsword', "Knight's Iron Sword", 'Silver Oath', 'Kingdom Guardian', 'Blade of Valor', 'Royal Court Blade', 'Royal Oathblade', 'Golden Oath', 'The Last Dawn'],
          rapier: ['Ember Longsword', 'Iron Rapier', 'Silverthorn', 'Courtly Rapier', 'Fleur-de-Lis', 'Royal Vow', 'Crimson Crown', 'Scarlet Oath', "Seraph's Wing"],
          greatsword: ['Ember Longsword', "Blacksmith's Greatsword", 'Emberforged Greatsword', 'Abyssal Dragonbone', 'Abyssal Furnace', 'Sovereign of Ash'],
        };
        for (const branch of swordBranches) {
          assert.ok(branch.name_en);
          assert.equal(localizedName(branch, 'en'), branch.name_en);
          const tiers = branchTiers(branch.id);
          assert.deepEqual(tiers.map(tier => localizedName(tier, 'en')), englishNames[branch.id]);
          for (let level = 0; level <= branch.max_level; level++) {
            const stage = swordTier(level, tiers);
            assert.equal(localizedName(stage), stage.name);
            assert.equal(localizedName(stage, 'en'), stage.name_en);
          }
        }
        // Previously minted NFTs may only have a name; preserve that original text.
        assert.equal(localizedName({name: 'Legacy NFT'}, 'en'), 'Legacy NFT');
        assert.equal(maxSwordLevel('longsword'), 80);
        assert.equal(maxSwordLevel('greatsword'), 60);
        assert.equal(maxSwordLevel('rapier'), 80);
        assert.deepEqual(pendingSwordLevels('longsword'), []);
        assert.deepEqual(pendingSwordLevels('greatsword'), []);
        const knight = branchTiers('longsword');
        assert.deepEqual(knight.slice(1).map(tier => tier.model), [10, 20, 30, 40, 50, 60, 70, 80].map(level => `KnightSword/+${level}KnightSword`));
        assert.equal(swordTier(69, knight).model, 'KnightSword/+60KnightSword');
        assert.equal(swordTier(70, knight).model, 'KnightSword/+70KnightSword');
        assert.equal(swordTier(79, knight).model, 'KnightSword/+70KnightSword');
        assert.equal(swordTier(80, knight).model, 'KnightSword/+80KnightSword');
        assert.equal(nextSwordTier(70, knight).min_level, 80);
        assert.equal(nextSwordTier(79, knight).min_level, 80);
        const rapier = branchTiers('rapier');
        assert.deepEqual(rapier.slice(1).map(tier => tier.model), [
          'rapier/+5rapier', 'rapier/+10rapier', 'rapier/+20rapier',
          'rapier/+30rapier', 'rapier/+40rapier', 'rapier/+50rapier', 'rapier/+60rapier', 'rapier/+70rapier',
        ]);
        assert.equal(swordTier(59, rapier).model, 'rapier/+50rapier');
        assert.equal(swordTier(60, rapier).model, 'rapier/+60rapier');
        assert.equal(swordTier(69, rapier).model, 'rapier/+60rapier');
        for (const level of [70, 79, 80]) assert.equal(swordTier(level, rapier).model, 'rapier/+70rapier');
        assert.equal(nextSwordTier(60, rapier).min_level, 70);
        assert.equal(nextSwordTier(70, rapier), undefined);
        assert.deepEqual(pendingSwordLevels('rapier'), []);
        const greatsword = branchTiers('greatsword');
        assert.deepEqual(greatsword.slice(1).map(tier => tier.model), [10, 20, 30, 40, 50].map(level => `GreatSword/+${level}GreatSword`));
        assert.equal(swordTier(9, greatsword).model, 'sword');
        assert.equal(swordTier(10, greatsword).model, 'GreatSword/+10GreatSword');
        assert.equal(nextSwordTier(9, greatsword).min_level, 10);
        assert.equal(nextSwordTier(10, greatsword).min_level, 20);
        for (const [level, modelLevel] of [[19, 10], [20, 20], [29, 20], [30, 30], [39, 30], [40, 40], [49, 40], [50, 50], [100, 50]]) {
          assert.equal(swordTier(level, greatsword).model, `GreatSword/+${modelLevel}GreatSword`);
        }
      }
      const address = server.httpServer.address();
      for (const model of models) {
        const response = await fetch(`http://127.0.0.1:${address.port}${modelUrl(model)}`);
        assert.equal(response.status, 200, model);
        const actual = Buffer.from(await response.arrayBuffer());
        const expected = await fs.readFile(path.join(assets, `${model}.glb`));
        assert.equal(actual.subarray(0, 4).toString(), 'glTF', `Expected a GLB, not an HTML fallback: ${model}`);
        assert.deepEqual(actual, expected, `Loaded model must match the source file: ${model}`);
      }
    } finally {
      if (mode === 'development') await server.close();
      else await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
}
