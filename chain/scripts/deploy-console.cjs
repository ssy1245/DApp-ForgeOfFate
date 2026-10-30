// Sepolia deployment console. Signs only in MetaMask; persistent plan, no local chain.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createService, PublicError } = require('./lib/deployment.cjs');
const { selectModule, loadPlan, nftHooks } = require('./lib/deployment-modules.cjs');
const sepolia = require('./lib/sepolia.cjs');
const root = path.resolve(__dirname, '../..');
const gameDirectory = path.join(root, '.local/sepolia');
let directory;
const origin = 'http://127.0.0.1:5174';
const children = [];
let server, provider, stopping = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  // Keep the exclusive API socket until child services and writes have stopped.
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    await Promise.race([ended, pause(1500)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }));
  server?.close(); server?.closeAllConnections(); provider?.destroy(); process.exitCode = code;
}
function run(args, cwd, env, name) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600);
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); children.push(child);
  child.on('error', () => { console.error('部署服务无法启动，请检查本轮日志。'); void shutdown(1); });
  return child;
}
async function main() {
  const module = selectModule(process.argv.slice(2));
  directory = path.join(gameDirectory, 'deploy-console', module);
  let config;
  try { config = sepolia.settings(root); } catch (error) { throw new PublicError(error.message); }
  // Bind the fixed API port before touching persistent files. This is also the
  // process ownership lock; the OS releases it on a crash, so restarts are safe.
  server = http.createServer();
  const starting = (_req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '正在连接 Sepolia，请稍候。' })); };
  server.on('request', starting);
  await new Promise((resolve, reject) => { server.once('error', () => reject(new PublicError('端口 8010 已被占用，请先关闭旧部署入口。'))); server.listen(8010, '127.0.0.1', resolve); });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  provider = sepolia.connect(config.rpc);
  await sepolia.check(provider);
  const plan = await loadPlan({ root, directory, gameDirectory, module, deployer: config.deployer, provider, network: sepolia.network, compile: async () => {
    const hardhat = path.join(path.dirname(require.resolve('hardhat/package.json')), 'internal/cli/cli.js');
    const compile = run([hardhat, 'compile'], path.join(root, 'chain'), {}, 'compile');
    if (await new Promise(resolve => compile.once('exit', resolve)) !== 0) throw new PublicError('合约编译失败，请检查 compile.log。');
  } });
  if (stopping) return;
  const hooks = nftHooks({ plan, provider, gameDirectory });
  hooks.checkReady?.();
  createService({ plan, provider, directory, origin, server, hooks }); server.removeListener('request', starting);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const frontend = run([vite, '--host', '127.0.0.1', '--port', '5174', '--strictPort'], path.join(root, 'frontend'), { FORGE_API_TARGET: 'http://127.0.0.1:8010' }, 'frontend');
  frontend.on('exit', () => { if (!stopping) { console.error('部署页面已停止，请检查 frontend.log。'); void shutdown(1); } });
  for (let i = 0; i < 60; i++) {
    if (stopping) return;
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) {
        console.log(`部署页面：${origin}/deploy\n合约：${plan.contractName}\n网络：Ethereum Sepolia（11155111）。交易由你在 MetaMask 中确认。\n部署计划与记录：${directory}\n关闭后重新启动会继续原计划，不会自动重新部署。`); return;
      }
    } catch {}
    await pause(250);
  }
  throw new PublicError('部署页面未能启动，请检查 frontend.log。');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
main().catch(error => { console.error(error instanceof PublicError ? error.message : '无法连接 Sepolia 或读取部署资料。请检查本地配置与节点服务；节点地址未输出。'); void shutdown(1); });
