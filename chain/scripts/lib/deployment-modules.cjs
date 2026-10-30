// Public deployment plans and private mint authorization keys have separate files.
const fs = require('node:fs');
const path = require('node:path');
const { Wallet, Contract, ContractFactory, hexlify, randomBytes, keccak256 } = require('ethers');
const { prepare, save, PublicError } = require('./deployment.cjs');

const modules = { 'forge-of-fate': 'ForgeOfFate', 'deployment-probe': 'DeploymentProbe' };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const fail = message => { throw new PublicError(message, 409); };
function selectModule(args, fallback = 'forge-of-fate') {
  if (!args.length) return fallback;
  if (args.length === 2 && args[0] === '--module' && Object.hasOwn(modules, args[1])) return args[1];
  fail('模块无效。可用 --module forge-of-fate 或 --module deployment-probe。');
}
function mintSigner(gameDirectory, create = false) {
  const file = path.join(gameDirectory, 'mint-key');
  if (!fs.existsSync(file)) {
    if (!create) fail('铸造授权密钥缺失，请恢复原 mint-key；不能为已有部署生成新密钥。');
    fs.mkdirSync(gameDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, Wallet.createRandom().privateKey, { flag: 'wx', mode: 0o600 });
  }
  try {
    if (!fs.lstatSync(file).isFile()) throw Error();
    fs.chmodSync(file, 0o600);
    return new Wallet(fs.readFileSync(file, 'utf8').trim()).address;
  } catch { fail('铸造授权密钥无法读取，请恢复原 mint-key。'); }
}

async function verifyBuild(plan, directory) {
  const buildBytes = fs.readFileSync(path.join(directory, 'build-info.json'));
  if (keccak256(buildBytes) !== plan.buildInfoHash) fail('编译资料与固定计划不一致，请恢复原 build-info.json。');
  const build = JSON.parse(buildBytes);
  const compiled = build.output.contracts['contracts/ForgeOfFate.sol'].ForgeOfFate;
  const transaction = await new ContractFactory(compiled.abi, '0x' + compiled.evm.bytecode.object)
    .getDeployTransaction(...plan.constructorArgs);
  if (transaction.data !== plan.data || JSON.stringify(compiled.abi) !== JSON.stringify(plan.abi)) {
    fail('部署内容与保存的编译资料不一致，请恢复原计划。');
  }
}

async function loadPlan({ root, directory, gameDirectory, module, deployer, provider, network, compile }) {
  const planFile = path.join(directory, 'plan.json');
  const nft = module === 'forge-of-fate';
  if (fs.existsSync(planFile)) {
    const plan = JSON.parse(fs.readFileSync(planFile));
    if (plan.version !== 2 || plan.module !== module || plan.contractName !== modules[module]
        || plan.network.chainId !== network.chainId || !same(plan.deployer, deployer)
        || plan.confirmationPolicy !== (network.chainId === 11155111 ? 'sepolia-finalized' : 'local-latest')
        || keccak256(plan.data) !== plan.dataHash || !same(plan.genesisHash, (await provider.getBlock(0)).hash)) {
      fail('已有部署计划与配置不一致。请保留记录并核对项目钱包，不能覆盖原计划。');
    }
    if (nft) {
      if (!same(plan.mintSigner, mintSigner(gameDirectory)) || plan.constructorArgs.length !== 2
          || !same(plan.constructorArgs[0], plan.mintSigner) || plan.constructorArgs[1] !== plan.deploymentId) {
        fail('铸造授权地址或构造参数与原计划不一致，请恢复匹配的密钥和计划。');
      }
      await verifyBuild(plan, directory);
      if (fs.existsSync(path.join(gameDirectory, 'deployment.json')) && !fs.existsSync(path.join(directory, 'deployment.json'))) {
        fail('游戏已有部署清单，但工作台记录缺失，请恢复原部署记录。');
      }
    }
    return { ...plan, network }; // Never expose a saved/private RPC URL.
  }
  if (['state.json', 'deployment.json'].some(file => fs.existsSync(path.join(directory, file)))) {
    fail('部署计划缺失，但已有交易记录。请恢复原 plan.json，不要重新部署。');
  }
  if (nft && fs.existsSync(path.join(gameDirectory, 'deployment.json'))) fail('游戏已有 NFT 部署清单，请恢复对应计划，不能覆盖或重新部署。');
  await compile();
  const contractName = modules[module];
  const artifactDirectory = path.join(root, 'chain/artifacts/contracts', contractName + '.sol');
  const artifact = JSON.parse(fs.readFileSync(path.join(artifactDirectory, contractName + '.json')));
  const deploymentId = hexlify(randomBytes(32));
  const signer = nft ? mintSigner(gameDirectory, true) : undefined;
  const plan = await prepare({ artifact, args: nft ? [signer, deploymentId] : [deploymentId],
    deployer, deploymentId, module, provider, network });
  const debug = JSON.parse(fs.readFileSync(path.join(artifactDirectory, contractName + '.dbg.json')));
  const build = fs.readFileSync(path.resolve(artifactDirectory, debug.buildInfo));
  fs.writeFileSync(path.join(directory, 'build-info.json'), build, { mode: 0o600 });
  if (nft) Object.assign(plan, { mintSigner: signer, buildInfoHash: keccak256(build) });
  save(planFile, plan);
  return plan;
}

function nftHooks({ plan, provider, gameDirectory }) {
  if (plan.module !== 'forge-of-fate') return {};
  const target = path.join(gameDirectory, 'deployment.json');
  const checkReady = () => {
    if (!same(mintSigner(gameDirectory), plan.mintSigner)) fail('铸造授权密钥与部署计划不匹配，不能继续。');
    if (fs.existsSync(target)) {
      const old = JSON.parse(fs.readFileSync(target));
      if (old.manifestVersion !== 2 || old.module !== plan.module || old.deploymentId !== plan.deploymentId
          || old.chainId !== plan.network.chainId || !same(old.mintSigner, plan.mintSigner)) {
        fail('游戏已有不同的 NFT 部署清单，不能覆盖。');
      }
    }
  };
  return {
    checkReady,
    async verifyContract(address, blockNumber) {
      checkReady();
      const contract = new Contract(address, plan.abi, provider);
      const [signer, epoch] = await Promise.all([
        contract.mintSigner({ blockTag: blockNumber }), contract.deploymentId({ blockTag: blockNumber }),
      ]);
      if (!same(signer, plan.mintSigner) || epoch !== plan.deploymentId) fail('链上铸造授权地址或部署标识不匹配。');
      return { manifestVersion: 2, mintSigner: plan.mintSigner, buildInfoHash: plan.buildInfoHash };
    },
    publishManifest(manifest) {
      checkReady();
      // Hard-link a complete temporary file: atomic publication without overwriting
      // an existing game deployment, even if another process writes concurrently.
      if (!fs.existsSync(target)) {
        const temp = target + '.' + hexlify(randomBytes(8)).slice(2) + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        try { fs.linkSync(temp, target); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        finally { fs.unlinkSync(temp); }
      }
      const saved = JSON.parse(fs.readFileSync(target));
      if (JSON.stringify(saved) !== JSON.stringify(manifest)) fail('游戏部署清单与核验结果不同，请保留原文件并排查；未覆盖。');
    },
  };
}
module.exports = { selectModule, loadPlan, mintSigner, nftHooks };
