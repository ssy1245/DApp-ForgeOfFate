// Dedicated, disposable local node + unsigned deployment API + browser UI.
// No Sepolia transaction, game database, wallet private key or mint key is used.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');
const { JsonRpcProvider, FetchRequest, isAddress, ZeroAddress, hexlify, randomBytes, toBeHex, parseEther } = require('ethers');
const { prepare, createService, save } = require('./lib/deployment.cjs');
const root = path.resolve(__dirname, '..');
const children = [];
let server, provider, stopping = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function port(name, fallback) {
  const number = Number(process.env[name] || fallback);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw Error('端口配置无效。');
  return number;
}
async function unused(number) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', () => reject(Error(`端口 ${number} 已被占用，请先停止旧部署入口。`))); probe.listen(number, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  server?.close(); server?.closeAllConnections(); provider?.destroy();
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([ended, pause(1500)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }));
  process.exitCode = code;
}
function run(args, cwd, env, directory, name) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600);
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); children.push(child);
  child.on('error', () => { console.error('部署演练服务无法启动。'); void shutdown(1); });
  return child;
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--test') throw Error('此入口仅供隔离自动测试使用；日常操作请运行 npm run deploy:console 连接 Sepolia。');
  const rpcPort = port('FORGE_DEPLOY_RPC_PORT', 8546), apiPort = port('FORGE_DEPLOY_API_PORT', 8010), uiPort = port('FORGE_DEPLOY_UI_PORT', 5174);
  if (new Set([rpcPort, apiPort, uiPort]).size !== 3) throw Error('三个服务必须使用不同端口。');
  // An explicit public address override is useful for isolated automated tests.
  const configFile = path.join(root, '.env.sepolia');
  const configured = process.env.FORGE_DEPLOYER_ADDRESS || (fs.existsSync(configFile) ? parseEnv(fs.readFileSync(configFile, 'utf8')).PROJECT_WALLET_ADDRESS : '');
  const deployer = (configured || '').trim();
  if (!isAddress(deployer) || deployer === ZeroAddress) throw Error('请先在 .env.sepolia 填写 PROJECT_WALLET_ADDRESS 公开地址。无需私钥。');
  await Promise.all([rpcPort, apiPort, uiPort].map(unused));
  const base = path.join(root, '.local/deploy-console'); fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(base, 'run-')); fs.chmodSync(directory, 0o700);
  console.log('准备独立的本地部署演练。记录目录：' + directory);
  const hardhat = path.join(path.dirname(require.resolve('hardhat/package.json')), 'internal/cli/cli.js');
  const compile = run([hardhat, 'compile'], path.join(root, 'contracts'), {}, directory, 'compile');
  const code = await new Promise(resolve => compile.once('exit', resolve));
  if (code !== 0) throw Error('合约编译失败，请查看本轮 compile.log。');
  const chain = run([hardhat, 'node', '--hostname', '127.0.0.1', '--port', String(rpcPort)], path.join(root, 'contracts'), { FORGE_DEPLOY_REHEARSAL: '1' }, directory, 'chain');
  const rpc = `http://127.0.0.1:${rpcPort}`, origin = `http://127.0.0.1:${uiPort}`;
  // Probe with fetch first to avoid noisy provider retries during node startup.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (chain.exitCode !== null || stopping) throw Error('本地演练节点已停止。');
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(1000) });
      const value = await response.json();
      if (value.result === '0x7a6a') { ready = true; break; }
    } catch {}
    await pause(250);
  }
  if (!ready) throw Error('独立测试链未能启动。');
  const rpcRequest = new FetchRequest(rpc); rpcRequest.timeout = 5000;
  provider = new JsonRpcProvider(rpcRequest, undefined, { cacheTimeout: -1 });
  // Funds exist only on this owned, disposable local node (chain ID 31338).
  await provider.send('hardhat_setBalance', [deployer, toBeHex(parseEther('10'))]);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/contracts/DeploymentProbe.sol/DeploymentProbe.json')));
  const deploymentId = hexlify(randomBytes(32));
  const plan = await prepare({ artifact, args: [deploymentId], deployer, deploymentId, module: 'deployment-probe', provider,
    network: { chainId: 31338, chainName: 'Forge Deployment Local', rpcUrls: [rpc], nativeCurrency: { name: 'Local ETH', symbol: 'ETH', decimals: 18 } } });
  save(path.join(directory, 'plan.json'), plan);
  server = createService({ plan, provider, directory, origin });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(apiPort, '127.0.0.1', resolve); });
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const frontend = run([vite, '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], path.join(root, 'frontend'), { FORGE_API_TARGET: `http://127.0.0.1:${apiPort}` }, directory, 'frontend');
  for (const child of [chain, frontend]) child.on('exit', () => { if (!stopping) { console.error('部署演练服务已停止。'); void shutdown(1); } });
  for (let i = 0; i < 120; i++) {
    if (stopping) return;
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { console.log(`部署页面：${origin}/deploy\n本地网络 31338；项目钱包已获得 10 个本地测试 ETH。\n按 Ctrl+C 结束。本轮记录保留；下次启动是新的演练链。`); return; } } catch {}
    await pause(250);
  }
  throw Error('部署页面未能启动。');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
main().catch(error => { console.error(error.message?.includes('http') ? '部署演练启动失败，请检查本地配置。' : error.message); void shutdown(1); });
