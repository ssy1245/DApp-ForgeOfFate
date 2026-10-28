// Read secrets only on the server; callers must never log raw provider errors.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { isAddress, ZeroAddress, getAddress, FetchRequest, JsonRpcProvider } = require('ethers');

const network = Object.freeze({ chainId: 11155111, chainName: 'Ethereum Sepolia', rpcUrls: [],
  blockExplorerUrls: ['https://sepolia.etherscan.io'], nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 } });
function settings(root) {
  let config;
  try { config = parseEnv(fs.readFileSync(path.join(root, '.env.sepolia'), 'utf8')); }
  catch { throw Error('请先填写项目根目录的 .env.sepolia。'); }
  const address = (config.PROJECT_WALLET_ADDRESS || '').trim(), rpc = (config.SEPOLIA_RPC_URL || '').trim();
  if (!isAddress(address) || address.toLowerCase() === ZeroAddress) throw Error('PROJECT_WALLET_ADDRESS 必须是项目钱包的完整公开地址。');
  try {
    const url = new URL(rpc);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) throw Error();
  } catch { throw Error('请填写有效的 SEPOLIA_RPC_URL；节点地址不会发送给浏览器。'); }
  return { deployer: getAddress(address), rpc };
}
function connect(rpc) {
  const request = new FetchRequest(rpc); request.timeout = 8000;
  // Explicit RPC checks below enforce the chain, without logging failed auto-discovery.
  return new JsonRpcProvider(request, network.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
}
async function check(provider) {
  if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(network.chainId)) throw Error('节点不是 Ethereum Sepolia（11155111）。');
  const finalized = await provider.getBlock('finalized');
  if (!finalized?.hash || !Number.isSafeInteger(finalized.number)) throw Error('节点无法读取 finalized 确认边界。');
}
module.exports = { network, settings, connect, check };
