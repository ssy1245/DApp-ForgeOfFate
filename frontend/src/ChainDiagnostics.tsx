import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import './chainDiagnostics.css';

type CheckState = 'ok' | 'error' | 'waiting' | 'disabled' | 'unknown';
type ContractStatus = {id:string;name:string;status:CheckState;message:string;address?:string;
  mintSigner?:string;mintMessage?:string;transactionHash?:string;deploymentBlock?:number;
  checks:{label:string;status:CheckState}[]};
type Diagnostics = {checkedAt:number;network:{name:string;expectedChainId:number;actualChainId:number|null;
  status:CheckState;message:string;headBlock:number|null;finalizedBlock:number|null;finalityStatus:CheckState};
  contracts:ContractStatus[];indexer:{state:string;running:boolean;caughtUp:boolean;scannedBlock?:number;
    processedBlock?:number;pendingEvents?:number;lastSuccess?:number;deploymentMatches:boolean|null}};
type Props = {token?:string;walletAccount:string;walletChain:string;boundWallet?:string|null;verified?:boolean;expectedChainId?:number};
const labels:Record<CheckState,string>={ok:'正常',error:'检查异常',waiting:'等待就绪',disabled:'未启用',unknown:'尚未核验'};
const syncLabels:Record<string,string>={not_started:'监听尚未启动',starting:'正在准备监听',syncing:'正在补查链上记录',
  ready:'已同步确认记录',waiting:'等待部署最终确认',stopped:'监听已停止',error:'连接异常，等待重试',halted:'链上记录发生冲突，监听已暂停'};

export default function ChainDiagnostics({token,walletAccount,walletChain,boundWallet,verified,expectedChainId}:Props){
  const {t,locale}=useI18n();
  const [open,setOpen]=useState(true),[data,setData]=useState<Diagnostics|null>(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(!open)return;
    let live=true,inFlight=false;
    const controller=new AbortController();
    async function read(){
      if(inFlight||document.hidden||!live)return;
      inFlight=true;setBusy(true);
      try{
        const response=await fetch('/api/chain/diagnostics',{signal:controller.signal,cache:'no-store',
          headers:token?{Authorization:`Bearer ${token}`}:{}});
        if(!response.ok){
          if(live){setData(null);setFailure([401,403,404].includes(response.status)?'当前账号或模式无权查看链上诊断。':'检查暂时失败，请重新检查。');}
          return;
        }
        const next=await response.json();
        if(live){setData(next);setFailure('');}
      }catch{if(live){setData(null);setFailure('检查暂时失败，请重新检查。');}}
      finally{inFlight=false;if(live)setBusy(false);}
    }
    refresh.current=()=>{void read();};
    void read();const timer=setInterval(read,30000);
    window.addEventListener('focus',read);document.addEventListener('visibilitychange',read);
    return()=>{live=false;controller.abort();clearInterval(timer);refresh.current=()=>{};
      window.removeEventListener('focus',read);document.removeEventListener('visibilitychange',read);};
  },[open,token]);
  const expected=data?.network.expectedChainId??expectedChainId;
  const walletStatus:CheckState=!walletAccount||!verified||!boundWallet?'waiting':
    walletAccount.toLowerCase()!==boundWallet.toLowerCase()||walletChain!==String(expected)?'error':'ok';
  const walletMessage=!walletAccount?'请连接已绑定钱包':!verified||!boundWallet?'请先签名绑定游戏账号。':
    walletAccount.toLowerCase()!==boundWallet.toLowerCase()?'当前钱包与绑定账号不匹配。':
    walletChain!==String(expected)?'钱包网络与游戏配置不匹配。':'钱包与绑定账号、游戏网络一致。';
  const explorer=expected===11155111?'https://sepolia.etherscan.io':null;
  const badge=(status:CheckState,text=labels[status])=><span className={`diagnostic-badge diagnostic-${status}`}>{t(text)}</span>;
  const height=(value?:number|null)=>value==null||value<0?'—':value.toLocaleString(locale==='en'?'en-US':'zh-CN');
  const date=(value?:number)=>value?new Date(value*1000).toLocaleTimeString(locale==='en'?'en-US':'zh-CN'):'—';
  const sync=data?.indexer;
  const caughtUp=!!sync?.caughtUp&&data?.network.finalizedBlock!=null&&(sync.processedBlock??-1)>=data.network.finalizedBlock;
  const syncState:CheckState=!sync?'unknown':sync.deploymentMatches===false||['halted','error'].includes(sync.state)?'error':
    !sync.running?'waiting':caughtUp?'ok':'waiting';
  const overall:CheckState=!data?'unknown':[data.network.status,walletStatus,syncState,...data.contracts.map(c=>c.status)].includes('error')
    ||data.network.finalityStatus==='error'?'error':[data.network.status,walletStatus,syncState,...data.contracts.map(c=>c.status)].some(s=>s==='waiting'||s==='unknown')?'waiting':'ok';
  return <section className="chain-diagnostics" aria-label={t('链上状态')}>
    <header className="diagnostic-heading"><div><span className="diagnostic-eyebrow">{t('测试账号 · 开发工具')}</span><h3>{t('链上状态')}</h3></div>
      <div className="diagnostic-actions">{open&&<><span role="status">{failure?badge('error'):badge(overall)}</span>
        <button className="secondary" disabled={busy} onClick={()=>refresh.current()}>{t(busy?'正在检查…':'重新检查')}</button></>}
        <button className="quiet" aria-expanded={open} aria-controls="chain-diagnostics-content" onClick={()=>setOpen(v=>!v)}>{t(open?'收起检查':'展开检查')}</button></div>
    </header>
    {open&&<div id="chain-diagnostics-content">
      <p className="diagnostic-intro">{t('只读检查，不签名、不发交易。展开时每 30 秒更新，收起后停止检查。')}</p>
      {failure&&<p className="diagnostic-warning" role="alert">{t(failure)}</p>}
      <div className="diagnostic-connections">
        <article><header><h4>{t('后端节点')}</h4>{badge(data?.network.status??'unknown')}</header>
          <p>{data?.network.name??'—'} · {t('目标链 ID')} {expected??'—'}</p>
          <p>{t('节点链 ID')} {data?.network.actualChainId??'—'}</p><p>{t(data?.network.message??'正在读取节点状态。')}</p>
          {data?.network.finalityStatus==='error'&&<p className="diagnostic-warning">{t('无法读取最终确认边界，监听不会降级处理。')}</p>}
        </article>
        <article><header><h4>{t('当前浏览器钱包')}</h4>{badge(walletStatus)}</header>
          <code>{walletAccount||'—'}</code><p>{t('钱包链 ID')} {walletChain||'—'}</p><p>{t(walletMessage)}</p>
        </article>
      </div>
      {data&&<div className="diagnostic-contracts">{data.contracts.map(contract=><article key={contract.id} aria-label={t(contract.name)}>
        <header><h4>{t(contract.name)}</h4>{badge(contract.status)}</header>
        {contract.address&&<p className="diagnostic-address">{explorer?<a href={`${explorer}/address/${contract.address}`} target="_blank" rel="noreferrer">{contract.address} ↗</a>:<code>{contract.address}</code>}</p>}
        <p>{t(contract.message)}</p>
        {contract.checks.length>0&&<ul>{contract.checks.map(check=><li key={check.label}><span>{t(check.label)}</span>{badge(check.status)}</li>)}</ul>}
        {contract.mintSigner&&<p><span>{t('铸造授权地址')}</span><code>{contract.mintSigner}</code></p>}
        {contract.mintMessage&&<p className="diagnostic-warning">{t(contract.mintMessage)}</p>}
        {contract.deploymentBlock!=null&&<p>{t('部署区块')} {height(contract.deploymentBlock)}</p>}
        {explorer&&contract.transactionHash&&<a href={`${explorer}/tx/${contract.transactionHash}`} target="_blank" rel="noreferrer">{t('查看部署交易')} ↗</a>}
      </article>)}</div>}
      <div className="diagnostic-sync"><header><h4>{t('监听与确认进度')}</h4>{badge(syncState,sync?.deploymentMatches===false?'监听与当前合约不匹配':sync?.state==='ready'&&!caughtUp?'正在补查链上记录':sync?syncLabels[sync.state]||'正在准备监听':'正在读取同步状态')}</header>
        <dl>{[['最新区块',data?.network.headBlock],['最终确认区块',data?.network.finalizedBlock],['已扫描',sync?.scannedBlock],['已处理',sync?.processedBlock]].map(([label,value])=><div key={label}><dt>{t(String(label))}</dt><dd>{height(value as number|null)}</dd></div>)}</dl>
        <p>{t('钱包已打包与最终确认是两个阶段；历史同步还可能稍晚。')}</p>
        <p>{t('待处理事件')} {sync?.pendingEvents??'—'} · {t('最近同步成功')} {date(sync?.lastSuccess)}</p>
      </div>
      <footer>{t('最近检查')} {date(data?.checkedAt)}</footer>
    </div>}
  </section>;
}
