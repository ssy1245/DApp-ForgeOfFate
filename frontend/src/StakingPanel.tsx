import {useEffect,useRef,useState} from 'react';
import {useI18n} from './i18n';
import './staking.css';

type Snapshot={account:string;deploymentId:string;chainId:number;available:{tokenId:string;approved:boolean}[];positions:{tokenId:string;positionId:string;startedAt:number}[]};
type Props={config:any;account?:string;disabled:boolean;nfts:{id:string;name:string;name_en?:string;level:number}[];revision:string;message?:string;pendingAction?:{tokenId?:string;label:string;message:string};selectedToken?:string|null;onBack:()=>void;
 feedback:Record<string,{message:string;error?:boolean}>;onAction:(action:'approve'|'stake'|'unstake',token:string,position?:string)=>Promise<void>};
export default function StakingPanel({config,account,disabled,nfts,revision,message,pendingAction,feedback,onAction,selectedToken,onBack}:Props){
 const {t,name,locale}=useI18n();
 const [data,setData]=useState<Snapshot|null>(null),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true);
 const selectedRow=useRef<HTMLElement|null>(null),focusedRow=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  const row=selectedRow.current;
  if(!loading&&row&&row!==focusedRow.current){row.scrollIntoView({block:'center',behavior:'smooth'});row.focus({preventScroll:true});focusedRow.current=row;}
 },[data,loading,selectedToken]);
 useEffect(()=>{
  if(!config||!account){setData(null);setLoading(false);return;}
  let live=true,inFlight=false;const controller=new AbortController();
  const update=async()=>{
   if(document.hidden||inFlight)return;inFlight=true;
   try{
    const response=await fetch('/api/chain/staking',{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error();const snapshot:Snapshot=await response.json();
    if(snapshot.account.toLowerCase()!==account.toLowerCase()||snapshot.deploymentId!==config.deploymentId||snapshot.chainId!==config.chainId)throw Error();
    if(live){setData(snapshot);setFailed(false);}
   }catch{if(live)setFailed(true);}finally{inFlight=false;if(live)setLoading(false);}
  };
  setLoading(true);void update();const timer=setInterval(update,15000);window.addEventListener('focus',update);
  document.addEventListener('visibilitychange',update);
  return()=>{live=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[config?.address,config?.deploymentId,account,revision]);
 const blocked=disabled||loading||failed;
 const label=(id:string)=>{const nft=nfts.find(n=>n.id===id);return nft?name(nft):`NFT #${id}`;};
 const waiting=(id:string)=>pendingAction?.tokenId===id;
 const result=(id:string)=>waiting(id)?<p className="nft-action-feedback" role="status">{t(pendingAction!.label)} · {t(pendingAction!.message)}</p>:feedback[id]&&<p className={`nft-action-feedback${feedback[id].error?' error':''}`} role="status">{t(feedback[id].message)}</p>;
 const waitLabel=pendingAction?.label==='授权质押 NFT'?'授权确认中':pendingAction?.label==='取回 NFT'?'取回确认中':'交易确认中';
 return <section className="staking-panel" aria-label={t('NFT 质押')}>
  <div className="staking-heading"><h3>{t('NFT 质押')}</h3><button className="quiet" onClick={onBack}>{t('返回我的收藏')}</button></div>
  <p>{t('质押后 NFT 由质押合约保管，可随时取回。奖励按 UTC 日历日的实际质押时长折算，通过邮箱领取。')}</p>
  {!config?<p>{t('质押合约尚未配置。部署完成后刷新页面。')}</p>:!account?<p>{t('请先绑定钱包，再查看质押。')}</p>:<>
   <p className="staking-rate">{config.dailyCoins?t`每把每日 ${config.dailyCoins} 游戏金币`:t('等待服务器确认奖励费率；取回功能不受影响。')}</p>
   <small>{t('北京时间每日 08:00 跨日后，待链上最终确认再发放前一日奖励；服务器停机后会补发。')}</small>
   {failed&&<p role="alert">{t('质押状态暂时无法读取，正在重试。')}</p>}
   {loading&&<p role="status">{t('正在读取质押状态…')}</p>}
   {message&&<p className="nft-action-feedback" role="status">{t(message)}</p>}
   <h4>{t('质押中的 NFT')} · {data?.positions.length??0}</h4>
   {data?.positions.map(position=><article className="staking-item" key={position.positionId} data-position={position.positionId} data-token={position.tokenId} data-selected={selectedToken===position.tokenId||undefined} ref={selectedToken===position.tokenId?selectedRow:undefined} tabIndex={-1}>
    <strong>{label(position.tokenId)}</strong><small>#{position.tokenId}</small>
    <span>{t('质押开始时间')} · {new Date(position.startedAt*1000).toLocaleString(locale==='en'?'en-US':'zh-CN')}</span>
    <small>{t('取回后 NFT 回到绑定钱包；已产生的奖励仍通过邮箱结算。')}</small>
    {result(position.tokenId)}<button className="secondary" disabled={blocked||waiting(position.tokenId)} onClick={()=>void onAction('unstake',position.tokenId,position.positionId)}>{t(waiting(position.tokenId)?waitLabel:'取回 NFT')}</button>
   </article>)}
   {!loading&&!data?.positions.length&&<p>{t('暂无质押中的 NFT。')}</p>}
   <h4>{t('可质押的 NFT')} · {data?.available.length??0}</h4>
   {data?.available.map(item=><article className="staking-item" key={item.tokenId} data-token={item.tokenId} data-selected={selectedToken===item.tokenId||undefined} ref={selectedToken===item.tokenId?selectedRow:undefined} tabIndex={-1}>
    <strong>{label(item.tokenId)}</strong><small>#{item.tokenId}</small>
    <span>{t(waiting(item.tokenId)?pendingAction?.label==='授权质押 NFT'?'授权交易等待最终确认，确认后可继续质押。':'交易处理中，正在同步 NFT 状态。':item.approved?'已授权，尚未质押；暂不计算奖励。':'先授权这一枚 NFT，再确认质押。')}</span>{result(item.tokenId)}
    <button className="primary" disabled={blocked||waiting(item.tokenId)||!config.dailyCoins} onClick={()=>void onAction(item.approved?'stake':'approve',item.tokenId)}>{t(waiting(item.tokenId)?waitLabel:item.approved?'确认质押':'授权此 NFT')}</button>
   </article>)}
   {!loading&&!data?.available.length&&<p>{t('钱包中暂无可质押的游戏 NFT。')}</p>}
  </>}
 </section>;
}
