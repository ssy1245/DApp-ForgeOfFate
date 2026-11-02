import { useEffect, useRef, useState } from 'react';
import { formatEther } from 'ethers';
import { LanguageSwitch, useI18n } from './i18n';
import './deploy.css';

type Wallet = {
  isMetaMask?: boolean;
  request: (request: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};
type Deployment = {
  healthy?: boolean; warning?: string; balanceWei?: string | null;
  plan: { deploymentId: string; module: string; contractName: string; mintSigner?: string; nftAddress?: string; deployer: string; data: string; dataHash: string; value: string;
    network: { chainId: number; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number } } };
  state: { phase: 'ready' | 'awaiting_wallet' | 'submitted' | 'confirming' | 'confirmed' | 'failed'; intent: string | null;
    deploymentBlock?: number; finalizedBlock?: number;
    transactionHash: string | null; manifest?: { address: string; deploymentBlock: number; [key: string]: unknown } };
};
const phases = { ready: '等待部署', awaiting_wallet: '等待钱包确认或恢复交易', submitted: '等待本地链确认', confirming: '等待 Sepolia 最终确认', confirmed: '部署成功，记录已保存', failed: '交易执行失败，可以重新部署' };
const storageKey = (id: string) => 'forge:deployment:' + id;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function DeployApp() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<Deployment | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState(''), [chainId, setChainId] = useState('');
  const [busy, setBusy] = useState(false), [healthy, setHealthy] = useState(false);
  const [error, setError] = useState(''), [serviceError, setServiceError] = useState('');
  const [recoveryHash, setRecoveryHash] = useState('');
  const working = useRef(false), alive = useRef(true), revision = useRef(0), requests = useRef(0);
  const current = useRef(snapshot); current.current = snapshot;
  const notifyWalletChange = () => { revision.current++; };

  async function call(action = 'status', body?: object) {
    const response = await fetch('/api/deploy/' + action, {
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    let result;
    try { result = await response.json(); } catch { throw Error('请先启动本地部署入口。'); }
    if (!response.ok) throw Error(result.error || '部署服务暂不可用。');
    return result as Deployment;
  }
  async function refresh() {
    if (working.current) return;
    const request = ++requests.current;
    try {
      const result = await call();
      if (alive.current && request === requests.current) { setSnapshot(result); setHealthy(result.healthy !== false); setServiceError(result.warning || ''); }
    } catch (failure) {
      if (alive.current && request === requests.current) { setHealthy(false); setServiceError(failure instanceof Error ? failure.message : '部署服务暂不可用。'); }
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true, timer: number;
    const poll = async () => { await refresh(); if (active) timer = window.setTimeout(poll, current.current?.plan.network.chainId === 11155111 ? 10000 : 3000); };
    void poll();
    window.addEventListener('focus', refresh);
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.info?.rdns === 'io.metamask' && detail.provider?.request) setWallet(detail.provider);
    };
    window.addEventListener('eip6963:announceProvider', announce);
    if (window.ethereum?.isMetaMask) setWallet(window.ethereum);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => { active = false; alive.current = false; requests.current++; clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener('eip6963:announceProvider', announce); };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    let active = true;
    const accounts = (values: string[]) => { notifyWalletChange(); setAccount(values[0] || ''); };
    const network = (value: string) => { notifyWalletChange(); setChainId(value); };
    const disconnect = () => { notifyWalletChange(); setAccount(''); setChainId(''); };
    wallet.on?.('accountsChanged', accounts); wallet.on?.('chainChanged', network); wallet.on?.('disconnect', disconnect);
    const version = revision.current;
    Promise.all([wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' })]).then(([values, id]) => {
      if (active && version === revision.current) { setAccount(values[0] || ''); setChainId(id); }
    }).catch(() => {});
    return () => { active = false; wallet.removeListener?.('accountsChanged', accounts); wallet.removeListener?.('chainChanged', network); wallet.removeListener?.('disconnect', disconnect); };
  }, [wallet]);
  useEffect(() => {
    if (!snapshot) return;
    let saved = '';
    try { saved = localStorage.getItem(storageKey(snapshot.plan.deploymentId)) || ''; } catch {}
    setRecoveryHash(snapshot.state.transactionHash || saved);
  }, [snapshot?.plan.deploymentId, snapshot?.state.transactionHash]);

  async function run(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true; requests.current++; setBusy(true); setError('');
    try { await work(); }
    catch (failure: any) {
      const code = failure?.code ?? failure?.data?.originalError?.code;
      setError(code === 4001 ? '你取消了钱包操作。' : code === -32002 ? '钱包中已有待处理请求，请先打开 MetaMask。'
        : failure instanceof Error && !code ? failure.message : '钱包操作未完成，请检查 MetaMask；若已发送交易，请用交易哈希恢复。');
    } finally { working.current = false; setBusy(false); void refresh(); }
  }
  async function checkedWallet(plan: Deployment['plan']) {
    if (!wallet) throw Error('请在安装 MetaMask 的浏览器中打开。');
    const [values, id] = await Promise.all([wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' })]);
    setAccount(values[0] || ''); setChainId(id);
    if (!values[0] || !same(values[0], plan.deployer)) throw Error('请切换到配置中的项目钱包。');
    if (BigInt(id) !== BigInt(plan.network.chainId)) throw Error(plan.network.chainId === 11155111 ? '请切换到 Ethereum Sepolia。' : '请切换到部署演练网络。');
    return values[0] as string;
  }
  async function connect() {
    if (!wallet) throw Error('请在安装 MetaMask 的浏览器中打开。');
    const plan = current.current?.plan; if (!plan) return;
    await wallet.request({ method: 'eth_requestAccounts' });
    const id = '0x' + plan.network.chainId.toString(16);
    try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] }); }
    catch (failure: any) {
      if (failure?.code !== 4902) throw failure;
      if (plan.network.chainId === 11155111) throw Error('请在 MetaMask 中开启显示测试网络，并选择 Ethereum Sepolia。');
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{ ...plan.network, chainId: id }] });
      await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] });
    }
    await checkedWallet(plan);
  }
  async function deploy() {
    const plan = current.current?.plan; if (!plan || !wallet) return;
    const generation = revision.current;
    const from = await checkedWallet(plan);
    const tx = { from, chainId: '0x' + plan.network.chainId.toString(16), data: plan.data, value: plan.value };
    await wallet.request({ method: 'eth_estimateGas', params: [tx] });
    if (generation !== revision.current) throw Error('钱包已变化，请重新检查后部署。');
    const reserved = await call('begin', { deploymentId: plan.deploymentId }); setSnapshot(reserved);
    let requested = false;
    try {
      await checkedWallet(plan);
      if (generation !== revision.current) throw Error('钱包已变化，请重新检查后部署。');
      requested = true;
      const hash = await wallet.request({ method: 'eth_sendTransaction', params: [tx] });
      if (!/^0x[\da-f]{64}$/i.test(hash)) throw Error('钱包未返回有效交易哈希，请在 MetaMask 中查看交易记录。');
      setRecoveryHash(hash);
      try { localStorage.setItem(storageKey(plan.deploymentId), hash); } catch { /* The visible hash remains available for recovery. */ }
      setSnapshot(await call('record', { deploymentId: plan.deploymentId, transactionHash: hash }));
    } catch (failure: any) {
      if (!requested || failure?.code === 4001) {
        try { setSnapshot(await call('reject', { intent: reserved.state.intent })); } catch { /* Retain the server lock if recovery is uncertain. */ }
      }
      throw failure;
    }
  }
  async function recover() {
    const plan = current.current?.plan; if (!plan) return;
    const hash = recoveryHash.trim();
    setSnapshot(await call('record', { deploymentId: plan.deploymentId, transactionHash: hash }));
    try { localStorage.setItem(storageKey(plan.deploymentId), hash); } catch {}
  }
  function download() {
    if (!snapshot?.state.manifest) return;
    const blob = new Blob([JSON.stringify(snapshot.state.manifest, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = (snapshot.plan.network.chainId === 11155111 ? 'sepolia' : 'local') + '-deployment-' + snapshot.plan.deploymentId.slice(2, 10) + '.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const plan = snapshot?.plan, state = snapshot?.state;
  const sepolia = plan?.network.chainId === 11155111;
  const nft = plan?.module === 'forge-of-fate';
  const staking = plan?.module === 'forge-staking';
  const recharge = plan?.module === 'forge-recharge';
  const noBalance = sepolia && snapshot?.balanceWei === '0';
  const matched = !!plan && !!account && same(account, plan.deployer);
  const correctChain = !!plan && chainId !== '' && BigInt(chainId) === BigInt(plan.network.chainId);
  return <main className="deployment-page">
    <header><div><span className="deployment-eyebrow">FORGE OF FATE · {sepolia || !plan ? 'SEPOLIA' : 'LOCAL TEST'}</span><h1>{t('合约部署工作台')}</h1></div><div className="deployment-navigation"><a href="http://127.0.0.1:5173/">{t('返回游戏')}</a><LanguageSwitch /></div></header>
    <p className="deployment-intro">{t(sepolia || !plan ? '使用 MetaMask 在 Ethereum Sepolia 部署合约。手续费从项目钱包的 Sepolia 测试 ETH 余额扣除。' : '先在本地走通钱包部署流程。测试 ETH 由本地节点提供，不消耗 Sepolia 余额。')}</p>
    {plan && <div className="deployment-banner">{t(nft ? '部署武器 NFT 与 ETH 交易市场。卖家自行定价并提取成交收益；游戏币保留在服务器。' : staking ? '部署 NFT 质押合约。持有人可随时取回；游戏金币由服务器按有效质押时长结算到奖励邮箱。' : recharge ? '部署测试 ETH 充值合约。合约记录付款金额，后端按测试比例兑换游戏金币；不发行代币。' : '本轮仅部署一个验证合约，不包含 NFT 或充值功能。')}</div>}
    {(error || serviceError) && <div className="deployment-error" role="alert">{t(error || serviceError)}</div>}
    {!plan && <section><h2>{t('连接本地部署服务')}</h2><p>{t('在项目目录运行 npm run deploy:console，再打开终端显示的部署页面。')}</p><button onClick={() => void refresh()}>{t('重新检查')}</button></section>}
    {plan && <div className="deployment-grid">
      <section><h2><span>01</span>{t('连接部署钱包')}</h2><dl>
        <dt>{t('目标网络')}</dt><dd>{plan.network.chainName} · {plan.network.chainId}</dd>
        <dt>{t('配置中的项目钱包')}</dt><dd className="deployment-code">{plan.deployer}</dd>
        <dt>{t('当前钱包')}</dt><dd className="deployment-code">{account || t('尚未连接')}</dd>
        {sepolia && snapshot?.balanceWei != null && <><dt>{t('项目钱包余额')}</dt><dd>{formatEther(snapshot.balanceWei)} Sepolia ETH</dd></>}
      </dl><p className={matched && correctChain ? 'deployment-ok' : ''}>{t(matched && correctChain ? '钱包与网络已匹配。' : sepolia ? '请使用配置中的项目钱包，并切换到 Ethereum Sepolia。' : '请使用配置中的项目钱包，并切换到部署演练网络。')}</p>
        <button disabled={busy || !healthy} onClick={() => void run(connect)}>{t('连接 MetaMask / 切换网络')}</button>
        {!wallet && <p>{t('未检测到 MetaMask，请在安装扩展的浏览器中打开此地址。')}</p>}
        {noBalance && <p>{t('项目钱包暂无 Sepolia 测试 ETH，请先补充测试币用于手续费。')}</p>}
      </section>
      <section><h2><span>02</span>{t('核对并部署')}</h2><dl>
        <dt>{t(nft ? '武器 NFT / 市场合约' : staking ? 'NFT 质押合约' : recharge ? '充值合约' : '测试合约')}</dt><dd>{plan.contractName}</dd><dt>{t('发送金额')}</dt><dd>0 ETH</dd>
        {nft && <><dt>{t('铸造授权地址')}</dt><dd className="deployment-code" data-testid="mint-signer">{plan.mintSigner}</dd></>}
        {recharge && <><dt>{t('主管理员 / 固定收款钱包')}</dt><dd className="deployment-code">{plan.deployer}</dd><dt>{t('管理员权限')}</dt><dd>{t('项目钱包可增删管理员；管理员能提现，资金只进入固定项目钱包。')}</dd></>}
        {staking && <><dt>{t('关联 NFT 合约')}</dt><dd className="deployment-code" data-testid="staking-nft-address">{plan.nftAddress}</dd></>}
        <dt>{t('部署内容指纹')}</dt><dd className="deployment-code">{plan.dataHash}</dd>
      </dl>{nft && <p>{t('铸造授权密钥由本机保存，用于核准游戏武器。部署由你的 MetaMask 钱包确认，无需向服务器提供钱包私钥。')}</p>}
        <p>{t('钱包会显示预计手续费。点击后，请在 MetaMask 中核对并确认。')}</p>
        <button className="primary" disabled={busy || !healthy || noBalance || !matched || !correctChain || !state || !['ready', 'failed'].includes(state.phase)} onClick={() => void run(deploy)}>{t(busy ? '正在处理…' : sepolia ? '部署到 Sepolia' : '部署本地测试合约')}</button>
      </section>
      <section className="deployment-result"><h2><span>03</span>{t('部署结果与恢复')}</h2>
        <p className="deployment-status" role="status">{t(!healthy ? '暂时无法核验部署状态' : sepolia && state?.phase === 'submitted' ? '等待 Sepolia 打包交易' : phases[state!.phase])}</p>
        {state?.phase === 'confirming' && <p>{t`交易已进入区块 ${state.deploymentBlock}，最终确认进度为 ${state.finalizedBlock}。确认完成后保存部署记录。`}</p>}
        {state?.transactionHash && <dl><dt>{t('交易哈希')}</dt><dd className="deployment-code">{sepolia ? <a href={'https://sepolia.etherscan.io/tx/' + state.transactionHash} target="_blank" rel="noopener noreferrer">{state.transactionHash}</a> : state.transactionHash}</dd></dl>}
        {healthy && state?.phase === 'confirmed' && state.manifest && <><dl><dt>{t('合约地址')}</dt><dd className="deployment-code" data-testid="deployed-address">{state.manifest.address}</dd><dt>{t('部署区块')}</dt><dd>{state.manifest.deploymentBlock}</dd></dl>
          <p>{t('地址和交易回执已通过节点核验，并保存在本轮部署记录目录。')}</p><button onClick={download}>{t('下载部署记录')}</button></>}
        {nft && healthy && state?.phase === 'confirmed' && <p data-testid="nft-game-ready">{t(sepolia
          ? 'NFT 配置已保存。请重新启动游戏服务（npm start 或 npm run start:demo），再刷新游戏页面；启动器会连接该合约并启动事件监听。'
          : 'NFT 配置已写入本轮隔离目录，未改动日常游戏的部署和存档。')}</p>}
        {staking && healthy && state?.phase === 'confirmed' && <p>{t('质押配置已保存。设定每日游戏金币奖励并重启监听后，服务器会补扫质押记录并投递奖励邮件。')}</p>}
        {sepolia && healthy && state?.phase === 'confirmed' && state.manifest && <p><a href={'https://sepolia.etherscan.io/address/' + state.manifest.address} target="_blank" rel="noopener noreferrer">{t('在区块浏览器查看合约')}</a></p>}
        {state && ['awaiting_wallet', 'submitted', 'confirming'].includes(state.phase) && <div className="deployment-recovery"><p>{t('已发出的交易不会因刷新而重新发送。若钱包已发送但页面未收到结果，请粘贴交易哈希继续核验。')}</p>
          <label htmlFor="deployment-hash">{t('部署交易哈希')}</label><input id="deployment-hash" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
          <button disabled={busy || !/^0x[\da-f]{64}$/i.test(recoveryHash.trim())} onClick={() => void run(recover)}>{t('检查并恢复交易')}</button>
        </div>}
        <p className="deployment-footnote">{t(sepolia ? '关闭本机服务不会删除 Sepolia 合约。再次启动会继续原来的部署计划和交易记录，请保留 .local/sepolia/。' : '关闭终端会结束这条测试链；下次启动是新一轮演练。历史文件保留，当前游戏存档不受影响。')}</p>
      </section>
    </div>}
  </main>;
}
