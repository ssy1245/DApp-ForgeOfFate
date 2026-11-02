import {useEffect,useState} from 'react';
import {formatEther,parseEther,getAddress,ZeroAddress} from 'ethers';
import {useI18n} from './i18n';

type Access={balance:bigint;canManage:boolean;admins:string[]};
type Props={config:any;account:string;disabled:boolean;revision:string;onWithdraw:(wei:bigint)=>Promise<void>;onAdminChange:(address:string,enabled:boolean)=>Promise<void>};
export default function RechargeTreasury({config,account,disabled,revision,onWithdraw,onAdminChange}:Props){
 const {t}=useI18n();const [access,setAccess]=useState<Access|null>(null),[seen,setSeen]=useState(false),[amount,setAmount]=useState(''),[failed,setFailed]=useState(false),[admin,setAdmin]=useState('');
 const balance=access?.balance??null;
 let wei=0n;try{if(/^\d+(\.\d{1,18})?$/.test(amount.trim()))wei=parseEther(amount.trim());}catch{}
 let address='';try{address=getAddress(admin.trim());}catch{}
 const invalid=!!admin.trim()&&(!address||address===ZeroAddress||address.toLowerCase()===config.address.toLowerCase());
 const exists=!!address&&access?.admins.some(a=>a.toLowerCase()===address.toLowerCase());
 useEffect(()=>{
  let live=true,inFlight=false;const abort=new AbortController();
  const update=async()=>{
   if(document.hidden||inFlight)return;inFlight=true;
   try{
    const response=await fetch('/api/chain/recharge/treasury',{signal:abort.signal,cache:'no-store'});
    if(!response.ok)throw Error();const data=await response.json();
    if(data.chainId!==config.chainId||data.deploymentId!==config.deploymentId||data.address.toLowerCase()!==config.address.toLowerCase()||data.treasury.toLowerCase()!==config.treasury.toLowerCase()||data.account?.toLowerCase()!==account.toLowerCase()||data.isAdmin!==true)throw Error();
    const value=BigInt(data.balanceWei),canManage=data.canManageAdmins===true&&account.toLowerCase()===config.treasury.toLowerCase();
    if(value<0n||!Array.isArray(data.admins)||data.admins.length>32)throw Error();
    const admins=data.admins.map((a:string)=>getAddress(a));
    if(live){setAccess({balance:value,canManage,admins});setSeen(true);setFailed(false);}
   }catch{if(live){setAccess(null);setFailed(true);}}finally{inFlight=false;}
  };
  void update();
  return()=>{live=false;abort.abort();};
 },[config.address,config.chainId,config.deploymentId,config.treasury,account,revision]);
 // Ordinary players never see management controls. Previously authorized users see revocation/errors.
 if(!seen&&!access)return null;
 return <section className="recharge-treasury" aria-label={t('管理员提现')}>
  <h3>{t('管理员提现')}</h3>
  <p>{t('提取充值合约中的测试 ETH，收款钱包已固定。不会扣除玩家金币，也不会再次发放金币。')}</p>
  <small>{t('固定收款钱包')}</small><code className="treasury-address">{config.treasury}</code>
  <p>{t('合约可提余额：')}{balance===null?'—':formatEther(balance)} {t('测试 ETH')}</p>
  {failed&&<p role="alert">{t('提现权限或合约余额暂时无法核验，已暂停操作，请刷新状态。')}</p>}
  <label>{t('提现金额（测试 ETH）')}<input inputMode="decimal" value={amount} disabled={disabled||!access} onChange={e=>setAmount(e.target.value)}/></label>
  <div className="treasury-actions">
   <button className="secondary" disabled={disabled||balance===null||balance===0n||failed} onClick={()=>setAmount(formatEther(balance!))}>{t('填入全部余额')}</button>
   <button className="primary" disabled={disabled||failed||balance===null||wei<=0n||wei>=2n**256n||wei>balance} onClick={()=>void onWithdraw(wei)}>{t('提现到项目钱包')}</button>
  </div>
  <small>{t('需要当前管理员钱包在 MetaMask 确认并支付测试 Gas。资金只进入固定项目钱包。')}</small>
  {access?.canManage&&<section className="recharge-admins" aria-label={t('充值管理员管理')}>
   <h3>{t('充值管理员管理')} <small>{access.admins.length} / 32</small></h3>
   <p>{t('只有项目钱包可以增删管理员。普通管理员只能提现到项目钱包；移除生效后失去提现权限。主管理员不可移除。')}</p>
   <ul>{access.admins.map(a=><li key={a} data-admin={a}><code>{a}</code>{a.toLowerCase()===config.treasury.toLowerCase()?<span>{t('主管理员')}</span>:<button className="quiet" disabled={disabled} aria-label={t`移除 ${a}`} onClick={()=>void onAdminChange(a,false)}>{t('移除管理员')}</button>}</li>)}</ul>
   <label>{t('新增管理员钱包地址')}<input value={admin} maxLength={80} placeholder="0x…" autoComplete="off" spellCheck={false} disabled={disabled} aria-invalid={invalid} onChange={e=>setAdmin(e.target.value)}/></label>
   {invalid&&<p role="alert">{t('请输入有效的钱包地址，不支持零地址、合约自身或 ENS 名称。')}</p>}
   {exists&&<p>{t('该钱包已经是充值管理员。')}</p>}
   <button className="secondary" disabled={disabled||!address||invalid||exists||access.admins.length>=32} onClick={()=>void onAdminChange(address,true)}>{t('添加管理员')}</button>
   <small>{t('权限变更需要钱包签名和链上确认；每次变更都有链上记录。')}</small>
  </section>}
 </section>;
}
