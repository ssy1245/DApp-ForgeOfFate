import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { formatEther } from 'ethers';
import { GoldAmount } from './GoldIcon';
import './mailbox.css';

type Mail = {id:string;kind:'staking_daily'|'test'|'trade_sold';trade?:{token_id:string;buyer:string;seller:string;price_wei:string;transaction_hash:string;chain_id:number;contract:string;block_number:number};reward_day:string;coins:number;created_at:number;read_at:number|null};
type Inbox = {owner:string;items:Mail[];total:number;unread:number;totalCoins:string;offset:number;limit:number};
type Props = {account?:string;canTest:boolean;busy:boolean;summaryVersion:string;onAction:(label:string,path:string,body?:any)=>Promise<void>};
const pageSize = 30;

export default function Mailbox({account,canTest,busy,summaryVersion,onAction}:Props){
 const {t,locale,number:formatCoins}=useI18n();
 const [data,setData]=useState<Inbox|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 const [pending,setPending]=useState(false),[testCoins,setTestCoins]=useState(1000);
 const actionLock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!account){setLoading(false);return;}
  let live=true,sequence=0;
  const controller=new AbortController();
  async function read(){
   if(document.hidden)return;
   const current=++sequence;
   try{
    const response=await fetch(`/api/mail?offset=${offset}&limit=${pageSize}`,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error();
    const result:Inbox=await response.json();
    if(result.owner!==account)throw Error();
    if(!live||current!==sequence)return;
    if(offset>0&&offset>=result.total){setOffset(Math.max(0,Math.ceil(result.total/pageSize)-1)*pageSize);return;}
    setData(result);setFailed(false);setSelected(id=>result.items.some(mail=>mail.id===id)?id:null);
   }catch{if(live&&current===sequence)setFailed(true);}
   finally{if(live&&current===sequence)setLoading(false);}
  }
  setLoading(true);void read();
  const timer=setInterval(read,15000);window.addEventListener('focus',read);document.addEventListener('visibilitychange',read);
  return()=>{live=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',read);document.removeEventListener('visibilitychange',read);};
 },[account,offset,revision,summaryVersion]);
 const disabled=busy||pending||loading||failed;
 async function perform(label:string,path:string,body?:any){
  if(actionLock.current||busy)return;
  actionLock.current=true;setPending(true);
  try{await onAction(label,path,body);}
  finally{actionLock.current=false;if(alive.current){setPending(false);setRevision(value=>value+1);}}
 }
 async function openMail(mail:Mail){
  setSelected(mail.id);
  if(mail.read_at===null)await perform('阅读奖励邮件',`/mail/${mail.id}/read`);
 }
 const current=data?.items.find(mail=>mail.id===selected);
 const title=(mail:Mail)=>t(mail.kind==='trade_sold'?'交易成功':mail.kind==='test'?'测试奖励邮件':'每日质押奖励');
 if(!account)return <section className="reward-mailbox mail-empty" aria-label={t('奖励邮箱')}><span aria-hidden="true">✉</span><h2>{t('登录后查看奖励')}</h2><p>{t('奖励邮件保存在游戏账号中，登录后即可查看和领取。')}</p></section>;
 return <section className="reward-mailbox" aria-label={t('奖励邮箱')}>
  <header className="mail-toolbar"><div><h2>{t('收件箱')} <span>{data?.total??0}</span></h2><p>{t('待领取金币')} <GoldAmount amount={data?new Intl.NumberFormat(locale==='en'?'en-US':'zh-CN').format(BigInt(data.totalCoins)):'—'}/></p></div>
   <div className="mail-toolbar-actions"><button className="quiet" disabled={busy||pending} onClick={()=>setRevision(value=>value+1)}>{t('刷新邮箱')}</button><button className="primary" disabled={disabled||!data||data.totalCoins==='0'} onClick={()=>perform('一键收取奖励','/mail/claim-all')}>{t('一键收取')}</button></div>
  </header>
  <p className="mail-help">{t('奖励邮件领取后金币入账并移出收件箱。成交通知不含金币，可阅读后删除；一键收取只处理奖励。')}</p>
  {failed&&<p className="mail-error" role="alert">{t('邮箱暂时无法读取，请刷新邮箱后重试。')}</p>}
  {!data&&loading?<p className="mail-loading" role="status">{t('正在读取奖励邮件…')}</p>:data?.total===0?<div className="mail-empty"><span aria-hidden="true">✉</span><h3>{t('暂无待领取邮件')}</h3><p>{t('后续每日质押收益会通过邮件送达。')}</p></div>:data&&<div className="mail-layout">
   <div className="mail-list" aria-label={t('奖励邮件列表')}>{data.items.map(mail=><button className={`mail-row ${selected===mail.id?'selected':''}`} key={mail.id} data-mail-id={mail.id} disabled={busy||pending||loading||failed} aria-pressed={selected===mail.id} onClick={()=>openMail(mail)}>
    <span className="mail-row-icon" aria-hidden="true">{mail.read_at===null?'✉':'▤'}</span><span className="mail-row-copy"><strong>{title(mail)}</strong><span>{mail.reward_day} · UTC</span><small>{t(mail.read_at===null?'未读':mail.kind==='trade_sold'?'已读':'已读，待领取')}</small></span>{mail.kind==='trade_sold'?<span>{t('成交通知')}</span>:<GoldAmount amount={formatCoins(mail.coins)}/>} 
   </button>)}</div>
   <article className="mail-detail" aria-label={t('邮件内容')}>{current?current.kind==='trade_sold'&&current.trade?<><div className="mail-detail-heading"><span className="mail-kind">{t('成交通知')}</span><h3>{t('交易成功')}</h3><p>{t('通知日期（UTC）')} · {current.reward_day}</p></div><p>{t('你的 NFT 已成交，并已移出你的收藏与游戏仓库。成交款记入合约可提取收益，请前往集市提取到钱包。')}</p><dl className="trade-mail-details"><dt>NFT</dt><dd>#{current.trade.token_id}</dd><dt>{t('成交价格')}</dt><dd>{formatEther(current.trade.price_wei)} {t('测试 ETH')}</dd><dt>{t('买家钱包')}</dt><dd>{current.trade.buyer}</dd><dt>{t('交易哈希')}</dt><dd>{current.trade.chain_id===11155111?<a href={`https://sepolia.etherscan.io/tx/${current.trade.transaction_hash}`} target="_blank" rel="noreferrer">{current.trade.transaction_hash}</a>:current.trade.transaction_hash}</dd></dl><button className="primary" disabled={disabled} onClick={()=>perform('删除通知邮件',`/mail/${current.id}/dismiss`)}>{t('删除通知邮件')}</button></>:<><div className="mail-detail-heading"><span className={`mail-kind ${current.kind==='test'?'test':''}`}>{t(current.kind==='test'?'DEMO 测试':'质押收益')}</span><h3>{title(current)}</h3><p>{t('奖励日期（UTC）')} · {current.reward_day}</p></div>
    <p>{t(current.kind==='test'?'这是一封测试奖励邮件，用于体验邮箱和领取流程，不代表真实质押收益。':'你的当日质押收益已结算。领取后，附件中的金币将加入当前游戏账号。')}</p>
    <div className="mail-attachment"><span>{t('奖励附件')}</span><GoldAmount amount={formatCoins(current.coins)}/></div>
    <button className="primary mail-claim" disabled={disabled} onClick={()=>perform('领取邮件奖励',`/mail/${current.id}/claim`)}>{t('领取奖励并删除邮件')}</button>
   </>:<div className="mail-detail-placeholder"><span aria-hidden="true">✉</span><p>{t('选择一封邮件，查看奖励内容。')}</p></div>}</article>
  </div>}
  {!!data&&data.total>pageSize&&<nav className="mail-pagination" aria-label={t('邮件分页')}><button className="quiet" disabled={disabled||offset===0} onClick={()=>{setSelected(null);setOffset(value=>Math.max(0,value-pageSize));}}>{t('上一页')}</button><span>{t`第 ${Math.floor(offset/pageSize)+1} / ${Math.ceil(data.total/pageSize)} 页`}</span><button className="quiet" disabled={disabled||offset+pageSize>=data.total} onClick={()=>{setSelected(null);setOffset(value=>value+pageSize);}}>{t('下一页')}</button></nav>}
  {canTest&&<aside className="mail-test-tools"><div><strong>{t('测试邮件 · 仅测试账号')}</strong><p>{t('生成邮件后仍需领取，才会增加金币。')}</p></div><label>{t('测试奖励金币')}<input type="number" min={1} max={1000000} step={1} disabled={busy||pending} value={Number.isNaN(testCoins)?'':testCoins} onChange={event=>setTestCoins(event.target.valueAsNumber)}/></label><button className="secondary" disabled={busy||pending||!Number.isInteger(testCoins)||testCoins<1||testCoins>1000000} onClick={()=>perform('发送测试奖励邮件','/cheats/mail',{coins:testCoins})}>{t('生成测试邮件')}</button></aside>}
 </section>;
}
