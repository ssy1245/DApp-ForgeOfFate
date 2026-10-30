// Read-only preparation check. This does not load settings into the game or deploy contracts.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { isAddress, ZeroAddress } = require('ethers');

const root = path.resolve(__dirname, '../..');
const sepoliaChainId = 11155111n;

function checkAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && isAddress(value) && value.toLowerCase() !== ZeroAddress;
}

async function main() {
  const args = process.argv.slice(2);
  let configPath = path.join(root, '.env.sepolia');
  let offline = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline') offline = true;
    else if (args[i] === '--config' && args[i + 1] && !args[i + 1].startsWith('--')) {
      configPath = path.resolve(args[++i]);
    } else {
      console.error('用法：npm run check:sepolia -- [--offline] [--config 配置文件路径]');
      process.exitCode = 2;
      return;
    }
  }

  let config;
  try {
    config = parseEnv(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(error.code === 'ENOENT'
      ? '未找到准备配置。请将 .env.sepolia.example 复制为项目根目录的 .env.sepolia 并填写。'
      : '无法读取准备配置，请检查文件权限和格式。');
    process.exitCode = 2;
    return;
  }

  const wallet = (config.PROJECT_WALLET_ADDRESS || '').trim();
  const rpc = (config.SEPOLIA_RPC_URL || '').trim();
  const buyer = (config.DEMO_BUYER_ADDRESS || '').trim();
  const errors = [];
  if (!wallet) errors.push('请填写 PROJECT_WALLET_ADDRESS：部署及收款共用的钱包公开地址。');
  else if (!checkAddress(wallet)) errors.push('PROJECT_WALLET_ADDRESS 无效，请从 MetaMask 重新复制完整的 0x 钱包地址。');
  if (!rpc) errors.push('请填写 SEPOLIA_RPC_URL：Sepolia 的 HTTP(S) 节点连接地址。');
  else {
    try {
      const url = new URL(rpc);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
        throw new Error('Invalid RPC endpoint');
      }
    } catch {
      errors.push('SEPOLIA_RPC_URL 格式无效，请填写服务商提供的完整 HTTP(S) 接口地址。');
    }
  }
  if (buyer && !checkAddress(buyer)) errors.push('DEMO_BUYER_ADDRESS 无效；可以先留空，或填写第二个钱包公开地址。');
  else if (buyer && buyer.toLowerCase() === wallet.toLowerCase()) {
    errors.push('DEMO_BUYER_ADDRESS 应与项目钱包不同，用于双账户购买演示；也可以先留空。');
  }
  if (errors.length) {
    errors.forEach(message => console.error(`- ${message}`));
    process.exitCode = 2;
    return;
  }

  console.log('配置格式通过：项目钱包同时用于部署和收款。');
  console.log(buyer ? '第二个演示钱包已填写。' : '第二个演示钱包尚未填写，不影响当前准备。');
  if (offline) {
    console.log('本次仅检查格式，尚未验证节点是否可用或属于 Sepolia。');
    return;
  }

  // Never print the endpoint or provider response: either may contain an API credential.
  try {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('HTTP failure');
    const data = await response.json();
    if (data.error || data.jsonrpc !== '2.0' || data.id !== 1 || typeof data.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(data.result)) {
      throw new Error('Invalid RPC response');
    }
    if (BigInt(data.result) !== sepoliaChainId) {
      console.error('节点可以连接，但返回的链 ID 不是 Sepolia（11155111）。请检查所选网络。');
      process.exitCode = 1;
      return;
    }
    console.log('节点检查通过：Ethereum Sepolia（11155111）。');
    const finalityResponse=await fetch(rpc,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:2,method:'eth_getBlockByNumber',params:['finalized',false]}),
      signal:AbortSignal.timeout(10000),redirect:'error'
    });
    const finality=await finalityResponse.json();
    if(!finalityResponse.ok||finality.error||finality.id!==2||!/^0x[0-9a-fA-F]+$/.test(finality.result?.number||'')||!/^0x[0-9a-fA-F]{64}$/.test(finality.result?.hash||'')){
      console.error('链 ID 正确，但无法读取 finalized 确认边界。监听不会降级为最新区块，请检查节点服务。');process.exitCode=1;return;
    }
    console.log('节点可读取 finalized 确认边界。');
    console.log('已验证配置格式、节点网络与最终确认查询，未检查钱包控制权、余额或合约部署。未发送任何交易。');
  } catch {
    console.error('节点检查失败：请检查网络连接、服务商密钥、访问限制和服务状态。RPC 地址未输出。');
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('准备检查未完成，请确认 Node.js 和项目依赖符合项目要求。');
  process.exitCode = 1;
});
