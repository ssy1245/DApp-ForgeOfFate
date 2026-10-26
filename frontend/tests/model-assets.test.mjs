import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { modelUrl, referenceImageUrl, displayImageUrl } from '../src/modelAssets.ts';
import { inspectRgbaPng } from './png-alpha.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const assets = path.join(projectRoot, 'assets/3d');
const referenceAssets = path.join(projectRoot, 'assets/reference_page');
const displayAssets = path.join(projectRoot, 'assets/display');
const catalog = JSON.parse(await fs.readFile(path.join(assets, 'sword-tiers.json'), 'utf8'));
const branches = JSON.parse(await fs.readFile(path.join(assets, 'sword-branches.json'), 'utf8'));
const models = [...new Set([
  ...catalog.map(tier => tier.model),
  ...branches.flatMap(branch => branch.tiers ?? []).map(tier => tier.model),
  'hammer',
])];

for (const mode of ['development', 'preview']) {
  test(`${mode} serves models, references, transparent weapon displays and item icons`, async () => {
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
        const {artworkTier, nftWeaponDetails, referenceImageUrl} = await server.ssrLoadModule('/src/weaponImages.ts');
        const { branchTiers, swordTier, nextSwordTier, swordBranches, maxSwordLevel, pendingSwordLevels, localizedName } = await server.ssrLoadModule('/src/swordTiers.ts');
        for (const branch of swordBranches) {
          const tiers = branchTiers(branch.id);
          assert.deepEqual(tiers.map(tier => tier.min_level), branch.id === 'rapier' ? [0, 5, 10, 20, 30, 40, 50, 60, 70] : branch.id === 'longsword' ? [0, 10, 20, 30, 40, 50, 60, 70, 80] : [0, 10, 20, 30, 40, 50, 60]);
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
          greatsword: ['Ember Longsword', "Blacksmith's Greatsword", 'Emberforged Greatsword', 'Abyssal Dragonbone', 'Moltenvein Dragonbone', 'Abyssal Furnace', 'Sovereign of Ash'],
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
            assert.equal(artworkTier({branch: branch.id, level}).reference, stage.reference);
            assert.equal(artworkTier({branch: branch.id, level}).display, stage.display);
          }
        }
        for (const tier of catalog) {
          assert.equal(artworkTier({level: tier.min_level, tier_id: tier.id}).reference, tier.reference);
          assert.equal(artworkTier({level: tier.min_level, tier_id: tier.id}).display, tier.display);
        }
        assert.equal(artworkTier({level: 50, branch: 'unknown', name: 'Unrecognized relic'}), undefined);
        const details = nftWeaponDetails({name: '炽翼天使 +80', attributes: [{trait_type: 'Weapon Type', value: 'rapier'}, {trait_type: 'Demo', value: true}]});
        assert.equal(details.branch, 'rapier');
        assert.equal(details.demo, true);
        assert.equal(artworkTier({...details, level: 80}).reference, 'Rapier/+70rapier.png');
        assert.equal(nftWeaponDetails({tier_id: 'last-dawn'}).tier_id, 'last-dawn');
        assert.equal(nftWeaponDetails({attributes: null}).demo, false);
        assert.equal(referenceImageUrl('Weathered Sword Orthographic Views.png'), '/weapon-images/Weathered%20Sword%20Orthographic%20Views.png');
        assert.equal(referenceImageUrl('Greatsword/+40GreatSword.png'), '/weapon-images/Greatsword/+40GreatSword.png');
        assert.equal(displayImageUrl('KnightSword/+80KnightSword.png'), '/display/KnightSword/+80KnightSword.png');
        assert.equal(maxSwordLevel('longsword'), 90);
        assert.equal(maxSwordLevel('greatsword'), 70);
        assert.equal(maxSwordLevel('rapier'), 80);
        assert.deepEqual(pendingSwordLevels('longsword'), []);
        assert.deepEqual(pendingSwordLevels('greatsword'), []);
        const knight = branchTiers('longsword');
        assert.deepEqual(knight.slice(1).map(tier => tier.model), [10, 20, 30, 40, 50, 60, 70, 80].map(level => `KnightSword/+${level}KnightSword`));
        assert.equal(swordTier(69, knight).model, 'KnightSword/+60KnightSword');
        assert.equal(swordTier(70, knight).model, 'KnightSword/+70KnightSword');
        assert.equal(swordTier(79, knight).model, 'KnightSword/+70KnightSword');
        for (const level of [80, 89, 90]) assert.equal(swordTier(level, knight).model, 'KnightSword/+80KnightSword');
        assert.equal(nextSwordTier(80, knight), undefined);
        assert.equal(nextSwordTier(90, knight), undefined);
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
        assert.deepEqual(greatsword.slice(1).map(tier => tier.model), [10, 20, 30, 40, 50, 60].map(level => `GreatSword/+${level}GreatSword`));
        assert.equal(swordTier(9, greatsword).model, 'sword');
        assert.equal(swordTier(10, greatsword).model, 'GreatSword/+10GreatSword');
        assert.equal(nextSwordTier(9, greatsword).min_level, 10);
        assert.equal(nextSwordTier(10, greatsword).min_level, 20);
        for (const [level, modelLevel] of [[19, 10], [20, 20], [29, 20], [30, 30], [39, 30], [40, 40], [49, 40], [50, 50], [59, 50], [60, 60], [69, 60], [70, 60], [100, 60]]) {
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
      for (const tier of catalog) {
        assert.ok(tier.reference, `Every weapon stage needs artwork: ${tier.id}`);
        const response = await fetch(`http://127.0.0.1:${address.port}${referenceImageUrl(tier.reference)}`);
        assert.equal(response.status, 200, tier.reference);
        assert.match(response.headers.get('content-type'), /^image\/png/);
        const actual = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(actual.subarray(0,8), Buffer.from([137,80,78,71,13,10,26,10]));
        assert.deepEqual(actual, await fs.readFile(path.join(referenceAssets, tier.reference)));
        const frame = tier.reference_frame;
        if (frame) {
          assert.equal(frame.image_width, actual.readUInt32BE(16));
          assert.equal(frame.image_height, actual.readUInt32BE(20));
          assert.ok(frame.width > 0 && frame.height > 0 && frame.x >= 0 && frame.y >= 0);
          assert.ok(frame.x + frame.width <= frame.image_width && frame.y + frame.height <= frame.image_height);
        }
        assert.ok(tier.display, `Every weapon stage needs a transparent display: ${tier.id}`);
        const displayResponse = await fetch(`http://127.0.0.1:${address.port}${displayImageUrl(tier.display)}`);
        assert.equal(displayResponse.status, 200, tier.display);
        assert.match(displayResponse.headers.get('content-type'), /^image\/png/);
        const displayBytes = Buffer.from(await displayResponse.arrayBuffer());
        assert.deepEqual(displayBytes, await fs.readFile(path.join(displayAssets, tier.display)));
        const alpha = inspectRgbaPng(displayBytes);
        assert.ok(alpha.transparent > alpha.width * alpha.height * .5, `Display must contain real transparent space: ${tier.id}`);
        for (const [x,y] of [[0,0],[alpha.width-1,0],[0,alpha.height-1],[alpha.width-1,alpha.height-1]]) {
          assert.ok(alpha.pixel(x,y)[3] <= 1, `Display corner must be transparent: ${tier.id}`);
        }
        assert.ok(alpha.bounds.left > 0 && alpha.bounds.right < alpha.width-1 && alpha.bounds.top > 0 && alpha.bounds.bottom < alpha.height-1, `Sword must fit without clipped opaque edges: ${tier.id}`);
        assert.ok(alpha.bounds.bottom - alpha.bounds.top > alpha.height * .65, `Sword must be large enough to read: ${tier.id}`);
      }
      for (const basename of ['Fe-icon', 'Gold-icon', 'protect']) {
        const source = path.join(assets, 'tools', basename + '.png');
        let route = '/@fs' + source;
        if (mode === 'preview') {
          const emittedAssets = await fs.readdir(path.join(projectRoot, 'frontend/dist/assets'));
          const asset = emittedAssets.find(name => name.startsWith(basename + '-') && name.endsWith('.png'));
          assert.ok(asset, 'The build must include ' + basename);
          route = '/assets/' + asset;
        }
        const response = await fetch('http://127.0.0.1:' + address.port + route);
        assert.equal(response.status, 200, basename + ' must load in both modes');
        assert.match(response.headers.get('content-type'), /^image\/png/);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(bytes, await fs.readFile(source));
        const alpha = inspectRgbaPng(bytes);
        assert.ok(alpha.transparent > alpha.width * alpha.height * .2, basename + ' needs real transparency');
        // The supplied ward keeps its faint top-edge glow; the source is used unchanged.
        assert.ok(alpha.edgeMax <= (basename === 'protect' ? 16 : 1), basename + ' must not have an opaque background');
        for (const [x,y] of [[0,0],[alpha.width-1,0],[0,alpha.height-1],[alpha.width-1,alpha.height-1]]) {
          assert.equal(alpha.pixel(x,y)[3], 0, basename + ' corner must be transparent');
        }
        assert.ok(alpha.bounds.left > 0 && alpha.bounds.right < alpha.width-1 && alpha.bounds.top > 0 && alpha.bounds.bottom < alpha.height-1, basename + ' must not be clipped');
      }
    } finally {
      if (mode === 'development') await server.close();
      else await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
}
