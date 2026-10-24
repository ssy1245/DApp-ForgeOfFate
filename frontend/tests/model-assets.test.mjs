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
        const { branchTiers, swordTier, nextSwordTier, swordBranches } = await server.ssrLoadModule('/src/swordTiers.ts');
        for (const branch of swordBranches) {
          const tiers = branchTiers(branch.id);
          assert.deepEqual(tiers.map(tier => tier.min_level), branch.id === 'rapier' ? [0, 5, 10, 20, 30, 40, 50] : [0, 10, 20, 30, 40, 50]);
          assert.equal(branch.unlock_level, 5);
          assert.equal(swordTier(4, tiers).name, '余烬长剑');
          assert.equal(swordTier(5, tiers).name, branch.id === 'rapier' ? '轻型刺剑' : '余烬长剑');
          for (const level of [50, 51, 60, 70, 100]) {
            assert.deepEqual(swordTier(level, tiers), swordTier(50, tiers));
            assert.equal(nextSwordTier(level, tiers), undefined);
          }
        }
        const rapier = branchTiers('rapier');
        assert.deepEqual(rapier.slice(1).map(tier => tier.model), [
          'rapier/l0-slim sowrd', 'rapier/l1-slim-sword+3d+model', 'rapier/l2-slim-sword+3d+model',
          'rapier/l3-slim+sword+3d+model', 'rapier/l4-rapier+3d+model', 'rapier/l5-rapier+3d+model',
        ]);
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
