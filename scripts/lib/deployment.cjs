// Shared unsigned deployment preparation and receipt verification. Never signs.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { ContractFactory, getAddress, getCreateAddress, keccak256 } = require('ethers');

class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new PublicError(message, status); };
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function save(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

async function prepare({ artifact, args, deployer, network, module, deploymentId, provider }) {
  if (![31338, 11155111].includes(network.chainId)) fail('不支持这个部署网络。');
  if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(network.chainId)) fail('节点网络与部署计划不一致。');
  if (Object.keys(artifact.linkReferences || {}).length) fail('合约尚有未链接的库。');
  const tx = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...args);
  const genesis = await provider.getBlock(0);
  return {
    version: 2, module, contractName: artifact.contractName, deploymentId,
    confirmationPolicy: network.chainId === 11155111 ? 'sepolia-finalized' : 'local-latest',
    network, deployer: getAddress(deployer), constructorArgs: args, abi: artifact.abi,
    data: tx.data, value: '0x0', dataHash: keccak256(tx.data), genesisHash: genesis.hash,
    createdAt: new Date().toISOString(),
  };
}

function createService({ plan, provider, directory, origin, server = http.createServer() }) {
  if (![31338, 11155111].includes(plan.network.chainId)
      || plan.confirmationPolicy !== (plan.network.chainId === 11155111 ? 'sepolia-finalized' : 'local-latest')) fail('部署计划的确认策略无效。');
  const stateFile = path.join(directory, 'state.json');
  const manifestFile = path.join(directory, 'deployment.json');
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { deploymentId: plan.deploymentId, phase: 'ready', intent: null, transactionHash: null };
  if (state.deploymentId !== plan.deploymentId) fail('部署计划已变化，请刷新页面。', 409);
  if (fs.existsSync(manifestFile)) {
    const saved = JSON.parse(fs.readFileSync(manifestFile));
    if (saved.deploymentId !== plan.deploymentId) fail('本轮已有部署记录，不能覆盖。', 409);
    // Recover if the manifest was saved just before the process stopped.
    state = { ...state, phase: 'submitted', transactionHash: saved.deploymentTransaction };
  }
  let tail = Promise.resolve();
  const commit = next => { next = { ...next, deploymentId: plan.deploymentId }; save(stateFile, next); state = next; };
  const exclusive = work => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
  const guardNetwork = async () => {
    // send() avoids a provider's cached network when a local node has restarted.
    if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(plan.network.chainId)
        || !equal((await provider.getBlock(0))?.hash, plan.genesisHash)) {
      fail('节点网络或链历史与部署记录不一致，请检查配置。', 409);
    }
  };
  const validateTransaction = tx => {
    if (tx.to !== null || !equal(tx.from, plan.deployer) || !equal(tx.data, plan.data)
        || tx.value !== 0n || tx.chainId !== BigInt(plan.network.chainId)) {
      fail('这笔交易不属于当前部署计划。', 409);
    }
  };
  const verify = async hash => {
    await guardNetwork();
    const tx = await provider.getTransaction(hash);
    if (!tx) fail('节点暂未找到交易，请保留交易哈希后重试。', 409);
    validateTransaction(tx);
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) return { phase: 'submitted', transactionHash: hash, nonce: tx.nonce };
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || !equal(block.hash, receipt.blockHash)) fail('交易区块已变化，请稍后重新检查。', 409);
    if (plan.confirmationPolicy === 'sepolia-finalized') {
      const finalized = await provider.getBlock('finalized');
      if (!finalized?.hash || !Number.isSafeInteger(finalized.number)) fail('节点暂时无法读取最终确认进度，请稍后重试。', 503);
      if (finalized.number < receipt.blockNumber) return { phase: 'confirming', transactionHash: hash, nonce: tx.nonce,
        deploymentBlock: receipt.blockNumber, finalizedBlock: finalized.number };
    }
    if (receipt.status !== 1) return { phase: 'failed', transactionHash: hash, nonce: tx.nonce };
    const address = getCreateAddress({ from: tx.from, nonce: tx.nonce });
    if (!equal(receipt.contractAddress, address)) fail('部署回执中的合约地址不匹配。', 409);
    const code = await provider.getCode(address, receipt.blockNumber);
    if (code === '0x' || await provider.getCode(address) !== code) fail('合约代码不存在或已变化。', 409);
    const manifest = {
      manifestVersion: 1, module: plan.module, contractName: plan.contractName,
      deploymentId: plan.deploymentId, chainId: plan.network.chainId, network: plan.network.chainName,
      address, deployer: plan.deployer, abi: plan.abi, constructorArgs: plan.constructorArgs,
      deploymentTransaction: hash, deploymentBlock: receipt.blockNumber, deploymentBlockHash: receipt.blockHash,
      genesisHash: plan.genesisHash, creationDataHash: plan.dataHash, runtimeCodeHash: keccak256(code),
      confirmationPolicy: plan.confirmationPolicy, recordedAt: new Date().toISOString(),
    };
    // Re-read after the RPC calls so a reset/reorg cannot silently certify stale data.
    if (!equal((await provider.getBlock(receipt.blockNumber))?.hash, receipt.blockHash)) fail('交易区块已变化，请稍后重新检查。', 409);
    if (fs.existsSync(manifestFile)) {
      const old = JSON.parse(fs.readFileSync(manifestFile));
      if (!equal(old.deploymentTransaction, hash)) fail('本轮已有部署记录，不能覆盖。', 409);
      for (const key of Object.keys(manifest).filter(key => key !== 'recordedAt')) {
        if (JSON.stringify(old[key]) !== JSON.stringify(manifest[key])) fail('已保存的部署记录与链上核验不一致，请保留文件并排查。', 409);
      }
      return { phase: 'confirmed', transactionHash: hash, nonce: tx.nonce, manifest: old };
    }
    save(manifestFile, manifest);
    return { phase: 'confirmed', transactionHash: hash, nonce: tx.nonce, manifest };
  };
  const refresh = async () => {
    if (state.transactionHash && ['submitted', 'confirming', 'confirmed'].includes(state.phase)) {
      const result = await verify(state.transactionHash);
      if (state.phase === 'confirmed' && result.phase !== 'confirmed') fail('已记录的部署无法在当前链上验证。', 409);
      commit({ ...state, ...result });
    } else await guardNetwork();
    const balanceWei = plan.network.chainId === 11155111 ? (await provider.getBalance(plan.deployer)).toString() : null;
    return { plan, state, healthy: true, balanceWei };
  };
  const actions = {
    async begin(body) {
      if (body.deploymentId !== plan.deploymentId) fail('部署计划已变化，请刷新页面。', 409);
      await guardNetwork();
      if (!['ready', 'failed'].includes(state.phase)) fail('已有部署正在处理，请继续检查原交易。', 409);
      commit({ phase: 'awaiting_wallet', intent: crypto.randomUUID(), transactionHash: null });
      return { plan, state };
    },
    async reject(body) {
      if (body.intent !== state.intent || state.phase !== 'awaiting_wallet') fail('部署状态已变化，请刷新页面。', 409);
      // Called only for explicit wallet rejection; uncertain sends remain locked.
      commit({ phase: 'ready', intent: null, transactionHash: null });
      return { plan, state };
    },
    async record(body) {
      if (!/^0x[\da-f]{64}$/i.test(body.transactionHash || '')) fail('交易哈希格式无效。');
      if (body.deploymentId !== plan.deploymentId) fail('部署计划已变化，请刷新页面。', 409);
      if (state.phase === 'ready') fail('请先开始当前部署。', 409);
      if (state.transactionHash && !equal(state.transactionHash, body.transactionHash)) {
        // Resolve the original first; a mined original always wins.
        // A speed-up may already have replaced the original in the mempool.
        // Re-check a mined original, but do not require the dropped one to exist.
        if (state.phase === 'confirmed' || await provider.getTransactionReceipt(state.transactionHash)) await refresh();
        if (state.phase === 'confirmed') return { plan, state };
        const replacement = await provider.getTransaction(body.transactionHash);
        if (!replacement) fail('节点暂未找到交易，请保留交易哈希后重试。', 409);
        validateTransaction(replacement);
        if (replacement.nonce !== state.nonce) fail('替换交易必须使用原交易的序号。', 409);
      }
      const result = await verify(body.transactionHash);
      commit({ ...state, ...result });
      return { plan, state };
    },
  };
  server.on('request', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method === 'GET' && req.url === '/api/deploy/status') {
        // Keep the saved plan visible during an RPC outage so a pending hash can
        // still be recovered. No send/retry is enabled while verification fails.
        const result = await exclusive(async () => {
          try { return await refresh(); }
          catch (error) { return { plan, state, healthy: false, warning: error instanceof PublicError ? error.message : '节点或记录暂不可用，请保留交易哈希后重试。' }; }
        });
        res.end(JSON.stringify(result)); return;
      }
      const action = req.url?.match(/^\/api\/deploy\/(begin|reject|record)$/)?.[1];
      if (req.method !== 'POST' || !action) fail('接口不存在。', 404);
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') fail('请从本机部署页面操作。', 403);
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2048) fail('请求过大。', 413); }
      let body;
      try { body = JSON.parse(raw); if (!body || Array.isArray(body) || typeof body !== 'object') throw Error(); }
      catch { fail('请求格式无效。'); }
      res.end(JSON.stringify(await exclusive(() => actions[action](body))));
    } catch (error) {
      // Never return provider errors/URLs or request payloads to the browser/logs.
      res.statusCode = error instanceof PublicError ? error.status : 503;
      res.end(JSON.stringify({ error: error instanceof PublicError ? error.message : '节点或记录暂不可用，请保留交易哈希后重试。' }));
    }
  });
  server.requestTimeout = 15000;
  return server;
}
module.exports = { prepare, createService, save, PublicError };
