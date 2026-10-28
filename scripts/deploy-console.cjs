// Sepolia deployment console. Signs only in MetaMask; persistent plan, no local chain.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { hexlify, randomBytes, keccak256 } = require('ethers');
const { prepare, createService, save, PublicError } = require('./lib/deployment.cjs');
const sepolia = require('./lib/sepolia.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.local/sepolia/deploy-console/deployment-probe');
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
  if (process.argv.length > 2) throw new PublicError('运行 npm run deploy:console 即可，部署网络固定为 Sepolia。');
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
  const planFile = path.join(directory, 'plan.json');
  let plan;
  if (fs.existsSync(planFile)) {
    plan = JSON.parse(fs.readFileSync(planFile));
    if (plan.version !== 2 || plan.module !== 'deployment-probe' || plan.network.chainId !== sepolia.network.chainId
        || plan.confirmationPolicy !== 'sepolia-finalized' || plan.deployer.toLowerCase() !== config.deployer.toLowerCase()
        || keccak256(plan.data) !== plan.dataHash || plan.genesisHash !== (await provider.getBlock(0)).hash) {
      throw new PublicError('已有部署计划与配置不一致。请保留记录并核对项目钱包，不能覆盖原计划。');
    }
    // Public network metadata always comes from the built-in allowlist.
    plan = { ...plan, network: sepolia.network };
    console.log('继续使用已保存的 Sepolia 部署计划。');
  } else {
    if (['state.json', 'deployment.json'].some(file => fs.existsSync(path.join(directory, file)))) throw new PublicError('部署计划缺失，但已有交易记录。请恢复原 plan.json，不要重新部署。');
    const hardhat = path.join(path.dirname(require.resolve('hardhat/package.json')), 'internal/cli/cli.js');
    const compile = run([hardhat, 'compile'], path.join(root, 'contracts'), {}, 'compile');
    if (await new Promise(resolve => compile.once('exit', resolve)) !== 0) throw new PublicError('合约编译失败，请检查 compile.log。');
    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/contracts/DeploymentProbe.sol/DeploymentProbe.json')));
    const deploymentId = hexlify(randomBytes(32));
    plan = await prepare({ artifact, args: [deploymentId], deployer: config.deployer, deploymentId, module: 'deployment-probe', provider, network: sepolia.network });
    // Keep the exact public source/build input with this immutable plan.
    const debug = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/contracts/DeploymentProbe.sol/DeploymentProbe.dbg.json')));
    const buildPath = path.resolve(root, 'contracts/artifacts/contracts/DeploymentProbe.sol', debug.buildInfo);
    fs.copyFileSync(buildPath, path.join(directory, 'build-info.json'));
    save(planFile, plan);
  }
  if (stopping) return;
  createService({ plan, provider, directory, origin, server }); server.removeListener('request', starting);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const frontend = run([vite, '--host', '127.0.0.1', '--port', '5174', '--strictPort'], path.join(root, 'frontend'), { FORGE_API_TARGET: 'http://127.0.0.1:8010' }, 'frontend');
  frontend.on('exit', () => { if (!stopping) { console.error('部署页面已停止，请检查 frontend.log。'); void shutdown(1); } });
  for (let i = 0; i < 60; i++) {
    if (stopping) return;
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) {
        console.log(`部署页面：${origin}/deploy\n网络：Ethereum Sepolia（11155111）。交易由你在 MetaMask 中确认。\n部署计划与记录：${directory}\n关闭后重新启动会继续原计划，不会自动重新部署。`); return;
      }
    } catch {}
    await pause(250);
  }
  throw new PublicError('部署页面未能启动，请检查 frontend.log。');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
main().catch(error => { console.error(error instanceof PublicError ? error.message : '无法连接 Sepolia 或读取部署资料。请检查本地配置与节点服务；节点地址未输出。'); void shutdown(1); });
