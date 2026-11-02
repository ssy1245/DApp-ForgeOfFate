import {useEffect,useRef,useState} from 'react';
import {useI18n} from './i18n';
import WeaponArtwork from './WeaponArtwork';
import GoldIcon from './GoldIcon';
import {artworkTier,type WeaponIdentity} from './weaponImages';
import {swordBranches} from './swordTiers';
import './staking.css';

type Snapshot={account:string;deploymentId:string;chainId:number;available:{tokenId:string;approved:boolean}[];positions:{tokenId:string;positionId:string;startedAt:number}[]};
type Props={config:any;account?:string;disabled:boolean;nfts:(WeaponIdentity&{id:string;price?:bigint})[];revision:string;message?:string;pendingActions?:{tokenId?:string;label:string;message:string}[];selectedToken?:string|null;onBack:()=>void;
 feedback:Record<string,{message:string;error?:boolean}>;onAction:(action:'approve'|'stake'|'unstake',token:string,position?:string)=>Promise<void>};
export default function StakingPanel({config,account,disabled,nfts,revision,message,pendingActions=[],feedback,onAction,selectedToken,onBack}:Props){
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
  setLoading(true);void update();
  return()=>{live=false;controller.abort();};
 },[config?.address,config?.deploymentId,account,revision]);
 const blocked=disabled||loading||failed;
 const available=(data?.available||[]).filter(item=>!(nfts.find(n=>n.id===item.tokenId)?.price??0n));
 const compactId=(id:string)=>id.length>16?`${id.slice(0,7)}…${id.slice(-5)}`:id;
 const identity=(id:string)=>{
  const nft=nfts.find(n=>n.id===id),tier=nft&&artworkTier(nft);
  const route=swordBranches.find(route=>route.id===(nft?.branch||tier?.branch));
  return {nft,route,label:nft?name(nft):`NFT #${compactId(id)}`};
 };
 const artwork=(nft:WeaponIdentity|undefined)=>nft?<WeaponArtwork weapon={nft} nft/>:<div className="staking-art-placeholder"><span aria-hidden="true">⚔</span><small>{t('藏品信息同步中')}</small></div>;
 const tokenNumber=(id:string)=><details className="staking-token"><summary aria-label={t`查看 NFT 完整编号 ${id}`}>#{compactId(id)}</summary><code>{id}</code></details>;
 const pendingFor=(id:string)=>pendingActions.find(action=>action.tokenId===id);
 const waiting=(id:string)=>!!pendingFor(id);
 const result=(id:string)=>waiting(id)?<p className="nft-action-feedback" role="status">{t(pendingFor(id)!.label)} · {t(pendingFor(id)!.message)}</p>:feedback[id]&&<p className={`nft-action-feedback${feedback[id].error?' error':''}`} role="status">{t(feedback[id].message)}</p>;
 const waitLabel=(id:string)=>pendingFor(id)?.label==='授权质押 NFT'?'授权确认中':pendingFor(id)?.label==='取回 NFT'?'取回确认中':'交易确认中';
 return <section className="staking-panel" aria-label={t('NFT 质押')}>
  <header className="staking-heading">
   <div className="staking-heading-title"><span className="staking-emblem" aria-hidden="true"><svg viewBox="0 0 48 56" fill="none"><path d="M24 3 44 12v19c0 10-20 22-20 22S4 41 4 31V12L24 3Z"/><path d="m24 11 12 7v12c0 6-12 14-12 14s-12-8-12-14V18l12-7Z"/><path d="M24 16v23m-6-12h12m-6-11 3 5-3 4-3-4 3-5Z"/></svg></span><div><span className="staking-eyebrow">FORGE OF FATE · NFT</span><h3>{t('NFT 质押')}</h3><p>{t('让藏品为工坊积攒金币。')}</p></div></div>
   <button className="quiet staking-back" onClick={onBack}><span aria-hidden="true">←</span> {t('返回我的收藏')}</button>
  </header>
  <div className="staking-overview">
   <div className="staking-rate"><span>{t('每把每日奖励')}</span><div><GoldIcon size="large"/><strong>{config?.dailyCoins?String(config.dailyCoins).replace(/\B(?=(\d{3})+(?!\d))/g,','):'—'}</strong><small>{t('游戏金币')}</small></div><p>{t('按时长折算 · 邮箱领取')}</p></div>
   <div className="staking-stat"><span>{t('质押中的 NFT')}</span><strong>{data&&!loading?data.positions.length:'—'}</strong><small>{t('随时可取回')}</small></div>
   <div className="staking-stat"><span>{t('可质押的 NFT')}</span><strong>{data&&!loading?available.length:'—'}</strong><small>{t('来自绑定钱包')}</small></div>
  </div>
  <details className="staking-rules"><summary>{t('奖励与取回规则')}<span aria-hidden="true">＋</span></summary><div><p>{t('质押后 NFT 由质押合约保管，可随时取回。奖励按 UTC 日历日的实际质押时长折算，通过邮箱领取。')}</p><p>{t('北京时间每日 08:00 跨日后，待链上最终确认再发放前一日奖励；服务器停机后会补发。')}</p></div></details>
  {!config?<p className="staking-empty">{t('质押合约尚未配置。部署完成后刷新页面。')}</p>:!account?<p className="staking-empty">{t('请先绑定钱包，再查看质押。')}</p>:<>
   {!config.dailyCoins&&<p className="staking-notice">{t('等待服务器确认奖励费率；取回功能不受影响。')}</p>}
   {failed&&<p className="staking-notice error" role="alert">{t('质押状态暂时无法读取，请点击刷新状态重试。')}</p>}
   {loading&&<p className="staking-notice" role="status">{t('正在读取质押状态…')}</p>}
   {message&&<p className="nft-action-feedback" role="status">{t(message)}</p>}
   <h4 className="staking-section-heading">{t('质押中的 NFT')}<span>{data?.positions.length??0}</span></h4>
   <div className="staking-items">
   {data?.positions.map(position=>{
    const {nft,route,label}=identity(position.tokenId),date=new Date(position.startedAt*1000);
    return <article className="staking-item" key={position.positionId} data-branch={route?.id} data-position={position.positionId} data-token={position.tokenId} data-selected={selectedToken===position.tokenId||undefined} ref={selectedToken===position.tokenId?selectedRow:undefined} tabIndex={-1}>
     <div className="staking-item-art">{artwork(nft)}</div>
     <div className="staking-item-body">
      <div className="staking-item-top"><span className={`staking-badge${waiting(position.tokenId)?' pending':''}`}><i/>{t(waiting(position.tokenId)?'等待链上确认':'质押中')}</span>{tokenNumber(position.tokenId)}</div>
      <h5>{label}</h5><span className="staking-route">{route?name(route):t('链上藏品')}</span>
      <dl className="staking-position-details"><div><dt>{t('质押开始时间')}</dt><dd><time dateTime={date.toISOString()}>{date.toLocaleDateString(locale==='en'?'en-US':'zh-CN')}<span>{date.toLocaleTimeString(locale==='en'?'en-US':'zh-CN',{hour:'2-digit',minute:'2-digit'})}</span></time></dd></div><div><dt>{t('奖励发放')}</dt><dd>{t('奖励邮箱')}</dd></div></dl>
      {result(position.tokenId)}
      <div className="staking-item-actions"><p>{t('取回后 NFT 回到绑定钱包；已产生的奖励仍通过邮箱结算。')}</p><button className="secondary staking-action" disabled={blocked||waiting(position.tokenId)} onClick={()=>void onAction('unstake',position.tokenId,position.positionId)}>{t(waiting(position.tokenId)?waitLabel(position.tokenId):'取回 NFT')}<span aria-hidden="true">↗</span></button></div>
     </div>
    </article>;
   })}
   </div>
   {!loading&&!failed&&!data?.positions.length&&<p className="staking-empty"><span aria-hidden="true">◇</span>{t('暂无质押中的 NFT。')}</p>}
   <h4 className="staking-section-heading">{t('可质押的 NFT')}<span>{available.length}</span></h4>
   <div className="staking-items">
   {available.map(item=>{
    const {nft,route,label}=identity(item.tokenId);
    return <article className="staking-item" key={item.tokenId} data-branch={route?.id} data-token={item.tokenId} data-selected={selectedToken===item.tokenId||undefined} ref={selectedToken===item.tokenId?selectedRow:undefined} tabIndex={-1}>
     <div className="staking-item-art">{artwork(nft)}</div>
     <div className="staking-item-body">
      <div className="staking-item-top"><span className="staking-badge available"><i/>{t(waiting(item.tokenId)?'等待链上确认':'在你的钱包')}</span>{tokenNumber(item.tokenId)}</div>
      <h5>{label}</h5><span className="staking-route">{route?name(route):t('链上藏品')}</span>
      <ol className="staking-steps" aria-label={t('质押步骤')}><li data-active={!item.approved||pendingFor(item.tokenId)?.label==='授权质押 NFT'}><b>01</b><span>{t('授权此 NFT')}</span></li><li data-active={item.approved&&!(pendingFor(item.tokenId)?.label==='授权质押 NFT')}><b>02</b><span>{t('确认质押')}</span></li></ol>
      <p className="staking-item-note">{t(waiting(item.tokenId)?pendingFor(item.tokenId)?.label==='授权质押 NFT'?'授权交易等待最终确认，确认后可继续质押。':'交易处理中，正在同步 NFT 状态。':item.approved?'已授权，尚未质押；暂不计算奖励。':'先授权这一枚 NFT，再确认质押。')}</p>{result(item.tokenId)}
      <div className="staking-item-actions"><button className="primary staking-action" disabled={blocked||waiting(item.tokenId)||!config.dailyCoins} onClick={()=>void onAction(item.approved?'stake':'approve',item.tokenId)}>{t(waiting(item.tokenId)?waitLabel(item.tokenId):item.approved?'确认质押':'授权此 NFT')}<span aria-hidden="true">↗</span></button></div>
     </div>
    </article>;
   })}
   </div>
   {!loading&&!failed&&!available.length&&<p className="staking-empty"><span aria-hidden="true">◇</span>{t('钱包中暂无可质押的游戏 NFT。')}</p>}
  </>}
 </section>;
}
