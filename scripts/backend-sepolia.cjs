// Prepare a separate backend environment. This never deploys or signs transactions.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
try {
  const config = parseEnv(fs.readFileSync(path.join(root, '.env.sepolia'), 'utf8'));
  const rpc = (config.SEPOLIA_RPC_URL || '').trim();
  const url = new URL(rpc);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error();
  if (process.argv.slice(2).some(arg => arg !== '--demo')) throw Error();
  const child = spawn(path.join(root, '.venv/bin/python'), ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8000', '--reload', '--reload-dir', 'backend', '--reload-dir', 'chain/server', '--reload-dir', 'assets/3d', '--reload-include', 'balance.json', '--reload-include', 'sword-tiers.json', '--reload-include', 'sword-branches.json'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, FORGE_NETWORK: 'sepolia', FORGE_LOCAL_DIR: path.join(root, '.local/sepolia'), FORGE_RPC_URL: rpc, DEMO_MODE: process.argv.includes('--demo') ? '1' : '0' },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => { process.exitCode = code || 0; });
  child.on('error', () => { console.error('无法启动后端，请先安装 Python 依赖。'); process.exitCode = 1; });
} catch {
  console.error('请先填写 .env.sepolia 的完整节点地址，并运行 npm run check:sepolia。');
  process.exitCode = 1;
}
