import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tiers from '../assets/3d/sword-tiers.json';
import branches from '../assets/3d/sword-branches.json';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(root, '../assets/3d');
const references = path.resolve(root, '../assets/reference_page');
const displayAssets = path.resolve(root, '../assets/display');
const configuredTiers = [...tiers, ...branches.flatMap(branch => branch.tiers ?? [])];
const models = [...new Set(configuredTiers.map(tier => `${tier.model}.glb`)), 'hammer.glb', 'anvil.glb'];
const portraits = [...new Set(configuredTiers.map(tier => tier.reference).filter((name): name is string => !!name))];
const displays = [...new Set(configuredTiers.map(tier => tier.display).filter((name): name is string => !!name))];
export default defineConfig({
  plugins: [react(), {
    name: 'local-3d-assets',
    configureServer(server) {
      server.middlewares.use('/display', (req, res, next) => {
        let name: string;
        try { name = decodeURIComponent((req.url || '').split('?')[0].slice(1)); }
        catch { res.statusCode = 400; res.end(); return; }
        if (!displays.includes(name)) return next();
        const file = path.join(displayAssets, name);
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'image/png');
        fs.createReadStream(file).pipe(res);
      });
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
      server.middlewares.use('/weapon-images', (req, res, next) => {
        let name: string;
        try { name = decodeURIComponent((req.url || '').split('?')[0].slice(1)); }
        catch { res.statusCode = 400; res.end(); return; }
        if (!portraits.includes(name)) return next();
        const file = path.join(references, name);
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'image/png');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const target = path.join(root, 'dist/models');
      fs.mkdirSync(target, { recursive: true });
      for (const name of models) {
        const file = path.join(assets, name);
        if (fs.existsSync(file)) {
          const destination = path.join(target, name);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(file, destination);
        }
      }
      for (const name of portraits) {
        const destination = path.join(root, 'dist/weapon-images', name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(references, name), destination);
      }
      for (const name of displays) {
        const destination = path.join(root, 'dist/display', name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(displayAssets, name), destination);
      }
    }
  }],
  server: { strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } }
});
