import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
export default defineConfig({plugins:[react(),{name:'local-3d-assets',configureServer(server){server.middlewares.use('/models',(req,res,next)=>{const name=(req.url||'').split('?')[0].slice(1);if(!['sword.glb','sword-upgraded.glb','hammer.glb','anvil.glb'].includes(name))return next();const file=path.resolve('../assets/3d',name);if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','model/gltf-binary');fs.createReadStream(file).pipe(res);});},closeBundle(){fs.mkdirSync('dist/models',{recursive:true});for(const name of ['sword.glb','sword-upgraded.glb','hammer.glb','anvil.glb']){const file=path.resolve('../assets/3d',name);if(fs.existsSync(file))fs.copyFileSync(file,`dist/models/${name}`);}}}],server:{strictPort:true,proxy:{'/api':'http://127.0.0.1:8000'}},preview:{proxy:{'/api':'http://127.0.0.1:8000'}}});
