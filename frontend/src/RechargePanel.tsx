import {useEffect,useState} from 'react';
import {formatEther,parseEther} from 'ethers';
import type {Pending} from '../../chain/client/transactions';
import {useI18n} from './i18n';
import GoldIcon from './GoldIcon';
import RechargeTreasury from './RechargeTreasury';
import './recharge.css';

type Entry={deposit_id:string;amount_wei:string;coins:string;tx_hash:string;credited_at:number|null};
type Props={config:any;account?:string;onAdminChange:(address:string,enabled:boolean)=>Promise<void>;disabled:boolean;revision:string;message?:string;walletReady:boolean;busy:string;pending?:Pending;progress?:string;onCheck:()=>Promise<void>;onRecharge:(wei:bigint)=>Promise<void>;onWithdraw:(wei:bigint)=>Promise<void>};
function TransactionLink({hash,chainId}:{hash:string;chainId?:number}){
 const {t}=useI18n();const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
 return <div className="recharge-tx-link"><code title={hash}>{hash.slice(0,10)}…{hash.slice(-8)}</code>
  <button className="quiet" onClick={async()=>{try{await navigator.clipboard.writeText(hash);setCopied(true);setFailed(false);}catch{setFailed(true);}}}>{t(copied?'已复制':'复制交易哈希')}</button>
  {chainId===11155111&&<a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">{t('查看交易')} ↗</a>}
  {failed&&<small role="alert">{t('复制失败，请手动选择交易哈希。')}<code className="full-hash">{hash}</code></small>}
 </div>;
}
export default function RechargePanel({config,account,onAdminChange,disabled,revision,message,walletReady,busy,pending,progress,onCheck,onRecharge,onWithdraw}:Props){
 const {t,locale}=useI18n();
 const [amount,setAmount]=useState('0.01'),[items,setItems]=useState<Entry[]>([]),[total,setTotal]=useState(0),[failed,setFailed]=useState(false),[page,setPage]=useState(0),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 let wei=0n;try{if(/^\d+(\.\d{1,18})?$/.test(amount.trim()))wei=parseEther(amount.trim());}catch{}
 const estimate=config&&wei>0n?wei*BigInt(config.coinsPerUnit)/BigInt(config.weiPerUnit):0n;
 const invalid=amount.trim()!==''&&(wei<=0n||wei>=2n**256n||estimate>9007199254740991n);
 const waitingWallet=!pending&&['充值游戏金币','提现充值收入','添加充值管理员','移除充值管理员'].includes(busy);
 const withdrawing=(pending?.label||busy)==='提现充值收入';
 const managing=['添加充值管理员','移除充值管理员'].includes(pending?.label||busy);
 const creditWaiting=pending?.label==='充值游戏金币'&&progress==='链上已确认，正在等待金币入账；无需再次付款。';
 useEffect(()=>{
  if(!account){setItems([]);setTotal(0);setLoading(false);return;}
  let live=true,inFlight=false;const abort=new AbortController();setLoading(true);
  const update=async()=>{
   if(document.hidden||inFlight)return;inFlight=true;
   try{const r=await fetch(`/api/chain/recharge?offset=${page*20}&limit=20`,{signal:abort.signal,cache:'no-store'});
    if(!r.ok)throw Error();const data=await r.json();if(data.account.toLowerCase()!==account.toLowerCase())throw Error();
    if(live){setItems(data.items);setTotal(data.total);setFailed(false);}
   }catch{if(live)setFailed(true);}finally{inFlight=false;if(live)setLoading(false);}
  };
  void update();const timer=setInterval(update,10000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{live=false;abort.abort();clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[account,config?.deploymentId,revision,page,retry]);
 return <section className="recharge-panel" aria-label={t('充值金币')}>
  <div className="recharge-heading"><div><span className="recharge-eyebrow">FORGE TREASURY</span><h2>{t('充值金币')}</h2></div><span className="recharge-test-badge">{t('仅限测试')}</span></div>
  <p className="recharge-description">{t('仅用于测试：使用测试 ETH 兑换服务器内游戏金币。金额和比例为演示设定，经济系统尚未定型，游戏金币不能兑换回 ETH。')}</p>
  {message&&<p className="recharge-alert" role="alert">{t(message)}</p>}
  {!config?<div className="recharge-empty">{t('充值合约尚未部署。部署完成后刷新状态。')}</div>:<div className="recharge-compose">
   <div className="recharge-form">
    <span className={`recharge-service ${config.ready?'ready':''}`}>{t(config.ready?'充值服务已就绪':'等待充值监听就绪，请稍后刷新状态。')}</span>
    <label htmlFor="recharge-amount">{t('充值金额（测试 ETH）')}</label>
    <div className="recharge-input"><input id="recharge-amount" inputMode="decimal" autoComplete="off" maxLength={80} aria-invalid={invalid} aria-describedby={invalid?'recharge-amount-error':undefined} value={amount} disabled={disabled} onChange={e=>setAmount(e.target.value)}/><span>ETH</span></div>
    <div className="recharge-presets" role="group" aria-label={t('快捷充值金额')}>{['0.005','0.01','0.02'].map(value=><button key={value} disabled={disabled} aria-pressed={amount===value} onClick={()=>setAmount(value)}>{value} ETH</button>)}</div>
    {invalid&&<small id="recharge-amount-error" className="recharge-alert">{t('请输入大于零的有效金额，最多 18 位小数。')}</small>}
    {!account?<p className="recharge-hint">{t('请先绑定钱包，再进行充值。')}</p>:!walletReady&&<p className="recharge-hint">{t('请在页面顶部连接已绑定钱包，并切换到游戏网络。')}</p>}
   </div>
   <div className="recharge-quote">
    <span>{t('预计获得金币：')}</span><strong className="recharge-coin-value"><GoldIcon size="large"/>{estimate.toString()}</strong>
    <p className="recharge-rate">{formatEther(config.weiPerUnit)} {t('测试 ETH')} = {config.coinsPerUnit.toLocaleString()} {t('游戏金币')}</p>
    <button className="primary recharge-submit" aria-label={t('确认充值')} disabled={disabled||!account||!config.ready||wei<=0n||invalid} onClick={()=>void onRecharge(wei)}>{t(pending?'交易处理中':waitingWallet?'等待钱包确认':'确认充值')}<span aria-hidden="true">↗</span></button>
    <small>{t('Gas 另付。链上最终确认后由后端自动入账；不足 1 金币的部分累计到该钱包后续充值，不用重复付款。')}</small>
   </div>
  </div>}
  <ol className="recharge-steps" aria-label={t('充值流程')}><li className={waitingWallet?'current':''}><b>01</b>{t('钱包确认')}</li><li className={pending&&!creditWaiting?'current':''}><b>02</b>{t('链上最终确认')}</li><li className={creditWaiting?'current':''}><b>03</b>{t(managing?'权限更新':withdrawing?'提现完成':'金币到账')}</li></ol>
  {(waitingWallet||pending)&&<div className="recharge-progress" role="status" aria-live="polite">
   <strong><span className="recharge-pulse" aria-hidden="true"/>{t(pending?.label||busy)}</strong>
   <p>{t(pending?(progress||'交易已提交，正在自动检查确认状态。'):'请在钱包中确认操作；尚未提交交易。')}</p>
   {pending&&<><div className="recharge-progress-meta">{pending.amountWei&&<span>{formatEther(pending.amountWei)} {t('测试 ETH')}</span>}{pending.submittedAt&&<time dateTime={new Date(pending.submittedAt).toISOString()}>{new Date(pending.submittedAt).toLocaleString(locale==='en'?'en-GB':'zh-CN')}</time>}</div><TransactionLink hash={pending.hash} chainId={config?.chainId}/><button className="quiet" disabled={!!busy} onClick={()=>void onCheck()}>{t('检查当前进度')}</button><small>{t('记录已保存，刷新后会继续检查，请勿重复付款。')}</small></>}
  </div>}
  <div className="recharge-history-heading"><h3>{t('充值记录')} <span>{total}</span></h3><button className="quiet" disabled={loading||!account} onClick={()=>setRetry(retry+1)}>{t('刷新记录')}</button></div>
  {failed&&<p className="recharge-alert" role="alert">{t('充值记录暂时无法读取，正在重试。')}</p>}
  {loading&&items.length===0?<p role="status">{t('正在读取充值记录…')}</p>:!failed&&items.length===0&&<div className="recharge-empty"><span aria-hidden="true">◇</span><strong>{t('暂无充值记录')}</strong><small>{t('确认后的充值会保存在这里，可随时查看金额和到账状态。')}</small></div>}
  {items.map(item=><article key={item.deposit_id} className="recharge-entry">
   <div className="recharge-entry-main"><span>{formatEther(item.amount_wei)} {t('测试 ETH')}</span><strong>+{item.coins} {t('游戏金币')}</strong><span className={`recharge-entry-status ${item.credited_at!==null?'credited':''}`}>{t(item.credited_at!==null?'已到账':'等待后台入账')}</span></div>
   <div className="recharge-entry-meta"><small>#{item.deposit_id}</small>{item.credited_at!==null&&<time dateTime={new Date(item.credited_at*1000).toISOString()}>{t('到账时间')}: {new Date(item.credited_at*1000).toLocaleString(locale==='en'?'en-GB':'zh-CN')}</time>}</div>
   <TransactionLink hash={item.tx_hash} chainId={config?.chainId}/>
  </article>)}
  {total>20&&<div className="recharge-pages"><button disabled={loading||page===0} onClick={()=>setPage(page-1)}>{t('上一页')}</button><span>{page+1} / {Math.ceil(total/20)}</span><button disabled={loading||(page+1)*20>=total} onClick={()=>setPage(page+1)}>{t('下一页')}</button></div>}
  {account&&config?.treasury&&<RechargeTreasury key={`${account}:${config.address}:${config.deploymentId}`} config={config} account={account} disabled={disabled} revision={revision} onWithdraw={onWithdraw} onAdminChange={onAdminChange}/>}
 </section>;
}
