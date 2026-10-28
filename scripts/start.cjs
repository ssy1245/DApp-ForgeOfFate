// Normal user entry: Sepolia backend + game UI. No mining or automatic deployment.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const sepolia = require('./lib/sepolia.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.local/sepolia');
const children = []; let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function launch(command, args, name, env = {}) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); children.push(child);
  child.on('error', () => { console.error(`${name} 无法启动，请检查 .local/sepolia/ 下的日志。`); stop(1); });
  child.on('exit', () => { if (!stopping) { console.error(`${name} 已停止，请检查 .local/sepolia/ 下的日志。`); stop(1); } });
}
async function unused(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', () => reject(Error(`端口 ${port} 已被占用，请先关闭旧游戏服务；不会复用其他网络的后端。`))); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    if (stopping) throw Error('启动已停止。');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('服务启动超时，请检查 .local/sepolia/ 下的日志。');
}
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--demo')) throw Error('运行 npm start，或 npm run start:demo。');
  const config = sepolia.settings(root);
  await Promise.all([8000, 5173].map(unused));
  const provider = sepolia.connect(config.rpc);
  try { await sepolia.check(provider); } catch { throw Error('Sepolia 节点检查未通过，请运行 npm run check:sepolia。'); } finally { provider.destroy(); }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const demo = process.argv.includes('--demo');
  launch(process.execPath, ['scripts/backend-sepolia.cjs', ...(demo ? ['--demo'] : [])], 'backend');
  await ready('http://127.0.0.1:8000/api/health');
  const cfg = await (await fetch('http://127.0.0.1:8000/api/config')).json();
  if (cfg.network?.chainId !== 11155111 || cfg.network?.name !== 'sepolia') throw Error('后端网络不匹配，已停止启动。');
  if (fs.existsSync(path.join(directory, 'deployment.json'))) {
    launch(process.execPath, ['scripts/indexer-sepolia.cjs'], 'indexer');
  }
  launch(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort', '--config', path.join(root, 'frontend/vite.config.ts'), path.join(root, 'frontend')], 'frontend', { FORGE_API_TARGET: 'http://127.0.0.1:8000' });
  await ready('http://127.0.0.1:5173/');
  console.log(`游戏页面：http://127.0.0.1:5173/\n网络：Ethereum Sepolia（11155111）；存档：.local/sepolia/\n测试菜单：${cfg.demo_mode ? '开启' : '关闭'}。NFT 与充值仍待后续开发，启动不会自动部署。\n部署工作台请另行运行 npm run deploy:console。按 Ctrl+C 停止本次服务。`);
}
main().catch(error => { console.error(error.message); stop(1); });
