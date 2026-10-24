import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tiers from '../assets/3d/sword-tiers.json';
import branches from '../assets/3d/sword-branches.json';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(root, '../assets/3d');
const models = [...new Set([...tiers, ...branches.flatMap(branch => branch.tiers ?? [])].map(tier => `${tier.model}.glb`)), 'hammer.glb', 'anvil.glb'];
export default defineConfig({
  plugins: [react(), {
    name: 'local-3d-assets',
    configureServer(server) {
      server.middlewares.use('/models', (req, res, next) => {
        let name: string;
        try { name = decodeURIComponent((req.url || '').split('?')[0].slice(1)); }
        catch { res.statusCode = 400; res.end(); return; }
        if (!models.includes(name)) return next();
        const file = path.join(assets, name);
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'model/gltf-binary');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const target = path.join(root, 'dist/models');
      fs.mkdirSync(target, { recursive: true });
      for (const name of models) {
        const file = path.join(assets, name);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
      }
    }
  }],
  server: { strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } }
});
