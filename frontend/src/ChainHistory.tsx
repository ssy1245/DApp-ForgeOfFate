import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import './chainHistory.css';

type Status = {state:string;running:boolean;caughtUp:boolean;message:string;headBlock?:number;confirmedBlock?:number;
  scannedBlock?:number;processedBlock?:number;eventCount:number;pendingEvents:number;lastSuccess?:number;
  deployment?:{address:string;chainId:number;deploymentId:string;confirmationPolicy:string}};
type Event = {block_hash:string;log_index:number;block_number:number;transaction_hash:string;name:string;args:Record<string,string>};
const phases:Record<string,string>={not_started:'监听尚未启动',starting:'正在准备监听',syncing:'正在补查链上记录',ready:'已同步确认记录',waiting:'等待部署最终确认',stopped:'监听已停止',error:'连接异常，等待重试',halted:'链上记录发生冲突，监听已暂停'};
const names:Record<string,string>={Transfer:'NFT 转移',Forged:'NFT 铭刻',Listed:'NFT 上架',Unlisted:'NFT 撤单',Purchased:'NFT 成交',Approval:'NFT 授权',ApprovalForAll:'NFT 批量授权',MetadataUpdate:'NFT 元数据更新',BatchMetadataUpdate:'NFT 元数据更新'};

export default function ChainHistory({deploymentId}:{deploymentId?:string}) {
  const {t}=useI18n();
  const [data,setData]=useState<{status:Status;items:Event[]}|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let live=true,request=0;
    const controller=new AbortController();
    async function read(){
      if(document.hidden)return;
      const current=++request;
      try{
        const response=await fetch('/api/chain/events?limit=8',{signal:controller.signal});
        if(!response.ok)throw Error();const result=await response.json();
        if(live&&request===current){setData(result);setFailed(false);}
      }catch{if(live&&request===current)setFailed(true);}
    }
    read();const timer=setInterval(read,5000);window.addEventListener('focus',read);
    return()=>{live=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',read);};
  },[deploymentId]);
  const status=data?.status;
  const mismatch=!!deploymentId&&!!status?.deployment&&status.deployment.deploymentId!==deploymentId;
  const explorer=status?.deployment?.chainId===11155111?'https://sepolia.etherscan.io':null;
  return <section className="chain-history" aria-label={t('链上记录与同步')}>
    <details>
    <summary><h3>{t('链上记录与同步')}</h3><span role="status">{t(failed?'暂时无法读取同步状态':mismatch?'部署配置已变化，请检查监听环境':status?phases[status.state]||'正在准备监听':'正在读取同步状态')}</span><span className="chain-history-toggle"><span className="when-closed">{t('展开')}</span><span className="when-open">{t('收起')}</span><i aria-hidden="true"/></span></summary>
    <div className="chain-history-body">
    <p>{t('市场显示最新链上状态；这里保存确认后的历史，服务器重新启动时会补查。')}</p>
    {status?.deployment&&<p className="chain-history-contract">{t('监听合约')} {explorer?<a href={`${explorer}/address/${status.deployment.address}`} target="_blank" rel="noreferrer">{status.deployment.address}</a>:<code>{status.deployment.address}</code>}</p>}
    {status?.scannedBlock!==undefined&&<dl>{[['节点高度',status.headBlock],['确认边界',status.confirmedBlock],['已扫描',status.scannedBlock],['已处理',status.processedBlock]].map(([label,value])=><div key={label}><dt>{t(String(label))}</dt><dd>{value===undefined?'—':value}</dd></div>)}</dl>}
    {status?.state==='not_started'&&<p>{t('启动本地监听后，这里会显示 NFT 铭刻、交易和转移记录。')}</p>}
    {status?.message&&status.state!=='not_started'&&<p role="alert">{t(status.message)}</p>}
    {!mismatch&&data?.items.length? <ol>{data.items.map(event=><li key={`${event.block_hash}:${event.log_index}`}><span>{t(names[event.name]||'链上事件')} <small>#{event.block_number}</small></span>{explorer?<a href={`${explorer}/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer" title={event.transaction_hash}>{event.transaction_hash.slice(0,10)}…{event.transaction_hash.slice(-6)} ↗</a>:<code title={event.transaction_hash}>{event.transaction_hash.slice(0,10)}…{event.transaction_hash.slice(-6)}</code>}</li>)}</ol>:null}
    {status?.deployment?.confirmationPolicy==='finalized'&&<small>{t('Sepolia 记录等待最终确认；确认之前不会计入这份历史。')}</small>}
    </div>
    </details>
  </section>;
}
