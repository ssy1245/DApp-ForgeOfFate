import { useI18n, LanguageSwitch } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther } from 'ethers';
import ForgeScene from './ForgeScene';
import CheatPanel from './CheatPanel';
import WorkshopStorage from './WorkshopStorage';
import ChainHistory from './ChainHistory';
import ChainDiagnostics from './ChainDiagnostics';
import Mailbox from './Mailbox';
import './workshopPage.css';
import {type Pending, readPending, writePending, removePending, samePending, matchesPending, storageAvailable, finalReceipt} from '../../chain/client/transactions';
import WeaponCard from './WeaponCard';
import WeaponLore from './WeaponLore';
import IronIcon, { IronAmount } from './IronIcon';
import GoldIcon, { GoldAmount } from './GoldIcon';
import WardIcon, { WardAmount } from './WardIcon';
import { useConfirmation } from './ConfirmationDialog';
import { nftWeaponDetails } from './weaponImages';
import { swordBranches, maxSwordLevel } from './swordTiers';
import { IMPACT_MS, SWING_MS } from './forgeMotion';

declare global {interface Window {ethereum?:any}}
type Weapon={max_level?:number;branch?:string;branch_locked?:boolean;strike_materials?:number;id:string;name:string;name_en?:string;tier_id?:string;level:number;status:string;strikes:number;protected_left:number;demo:number;quality:string;source:string;heat_ready_at:number;heat_charges:number;recycle_price:number;probabilities:Record<string,number>};
type NFT={branch?:string;id:string;owner:string;seller:string;price:bigint;level:number;name:string;name_en?:string;tier_id?:string;demo:boolean};
const short=(s:string)=>s?`${s.slice(0,6)}…${s.slice(-4)}`:'—';
const outcome:Record<string,string>={up:'强化成功 · +1',double:'大成功 · +2',down:'强化降级 · −1',destroy:'武器已损毁',saved:'保护生效 · 等级不变'};

export default function App(){
 const {t, name, locale, number: formatCoins} = useI18n();
 const {askConfirmation, confirmationDialog} = useConfirmation();
 const [config,setConfig]=useState<any>(null),[state,setState]=useState<any>(null),[session,setSession]=useState<{token?:string;address:string;guest?:boolean;username?:string;role?:string;player_id?:string;wallet_address?:string|null;wallet_verified?:boolean}|null>(null);
 const [accountMode,setAccountMode]=useState<'login'|'register'|null>(null),[username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [workshopPlace,setWorkshopPlace]=useState('empty');
 const [syncError,setSyncError]=useState(false);
 const [lastResult,setLastResult]=useState('');
 const [now,setNow]=useState(Date.now()/1000);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()/1000),250);return()=>clearInterval(timer);},[]);
 const [tab,setTab]=useState('forge'),[shield,setShield]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(false),[hit,setHit]=useState(0),[nfts,setNfts]=useState<NFT[]>([]),[prices,setPrices]=useState<Record<string,string>>({}),[proceeds,setProceeds]=useState(0n),[pendingRecords,setPendingRecords]=useState<Pending[]>(()=>readPending());
 const [cardFeedback,setCardFeedback]=useState<Record<string,{message:string;error?:boolean}>>({});
 const [cardOperation,setCardOperation]=useState<{id:string;label:string}|null>(null);
 const [marketError,setMarketError]=useState(false);
 const [marketView,setMarketView]=useState<'mine'|'listings'>('mine');
 const cardTell=(id:string,message:string,error=false)=>{setCardFeedback(old=>({...old,[id]:{message,error}}));};
 const bootstrap=useRef<Promise<any>|null>(null);
 const stateRequest=useRef(0), nftRequest=useRef(0);
 const generation=useRef(0), lock=useRef(false), sessionRef=useRef(session);sessionRef.current=session;
 const [walletAccount,setWalletAccount]=useState(''),[walletChain,setWalletChain]=useState('');
 const walletGeneration=useRef(0);
 const walletMatches=!!session?.wallet_verified&&walletAccount.toLowerCase()===session.wallet_address?.toLowerCase();
 const walletReady=walletMatches&&walletChain===String(config?.network?.chainId);
 const balance=config?.balance;
 const weapon:Weapon|undefined=state?.weapons.find((w:Weapon)=>w.id===state.player.workshop_weapon_id&&w.status==='active');
 const workshopKey=`${state?.player.address||''}:${state?.player.workshop_revision??0}`;
 const workshopKeyRef=useRef(workshopKey);workshopKeyRef.current=workshopKey;
 useEffect(()=>{setLastResult('');setShield(false);setHit(0);},[workshopKey,weapon?.id]);
 const maxLevel=weapon?.max_level??maxSwordLevel(weapon?.branch,balance?.max_level??100);
 const branchUnlockLevel=Math.min(...swordBranches.map(branch=>branch.unlock_level));
 const heatCost=balance?.heat_materials??2;
 const strikeCost=weapon?.strike_materials??balance?.strike_materials??2;
 const heatShortage=weapon?.status==='active'&&weapon.level<maxLevel&&weapon.heat_charges===0&&(state?.player.materials??0)<heatCost?`加热需要 ${heatCost} 铁块，当前剩余 ${state?.player.materials??0}。请领取每日补给或补充铁块。`:'';
 const strikeShortage=weapon?.status==='active'&&weapon.level<maxLevel&&(state?.player.materials??0)<strikeCost?`强化需要 ${strikeCost} 铁块，当前剩余 ${state?.player.materials??0}。`:'';
 async function chooseBranch(branch:string){
  if(!weapon||branch===(weapon.branch||'longsword'))return;
  const route=swordBranches.find(item=>item.id===branch);
  if(branch!=='longsword'&&!await askConfirmation(`选定${route?.name||'该'}路线后无法再更换，降级也不会解除锁定。确定选择？`))return;
  action('选择突变路线',`/weapons/${weapon.id}/branch`,{branch});
 }
 const minted=new Set(nfts.map(n=>`0x${BigInt(n.id).toString(16).padStart(64,'0')}`));
 const pending=pendingRecords.find(p=>matchesPending(p,config?.chain,session?.wallet_address));
 const activePending=!!pending;
 useEffect(()=>{const sync=()=>setPendingRecords(readPending());window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 const tell=(s:string,bad=false)=>{setNotice(s);setError(bad);};
 async function api(path:string,opts:RequestInit={},token=sessionRef.current?.token){
  const requestGeneration=generation.current, requestSession=sessionRef.current;
  const r=await fetch(`/api${path}`,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...opts.headers}});
  const data=await r.json().catch(()=>{throw Error('游戏服务暂未连接，请确认后端已启动。');});if(!r.ok){if(r.status===401&&!path.startsWith('/account/')&&requestGeneration===generation.current&&requestSession===sessionRef.current){bootstrap.current=null;sessionRef.current=null;setSession(null);setState(null);queueMicrotask(()=>refresh().catch(()=>{}));}throw Error(typeof data.detail==='string'?data.detail:'请求失败，请检查输入。');}return data;
 }
 async function loadNFTs(cfg:any,account?:string,signal?:AbortSignal){
  if(!cfg?.chain){setNfts([]);setProceeds(0n);return;}
  const g=generation.current, request=++nftRequest.current;
  let offset=0, block:number|undefined, total=0, proceeds='0';const list:NFT[]=[];
  do {
   const query=new URLSearchParams({offset:String(offset),limit:'50',...(account?{account}:{}),...(block===undefined?{}:{block:String(block)})});
   const data=await api(`/chain/nfts?${query}`,{signal});
   if(g!==generation.current||request!==nftRequest.current)return;
   if(data.deploymentId!==cfg.chain.deploymentId||data.chainId!==cfg.chain.chainId)throw Error('部署信息已变化，请刷新页面。');
   block=data.blockNumber;total=data.total;proceeds=data.proceeds;
   for(const item of data.items){let appearance=nftWeaponDetails(null);try{const raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(item.uri.split(',')[1]),c=>c.charCodeAt(0))));appearance=nftWeaponDetails(raw);}catch{}list.push({...item,price:BigInt(item.price),...appearance});}
   offset+=data.items.length;
   if(!data.items.length)break;
  }while(offset<total);
  if(!signal?.aborted&&g===generation.current&&request===nftRequest.current){setNfts(list);setProceeds(BigInt(proceeds));setMarketError(false);}
 }
 useEffect(()=>{
  if(tab!=='market'||!config?.chain)return;
  const controller=new AbortController(),g=generation.current;let inFlight=false;
  const update=async()=>{
   if(document.hidden||inFlight||lock.current)return;
   inFlight=true;
   try{await loadNFTs(config,sessionRef.current?.wallet_verified?sessionRef.current.wallet_address||undefined:undefined,controller.signal);}
   catch{if(!controller.signal.aborted&&g===generation.current)setMarketError(true);}
   finally{inFlight=false;}
  };
  void update();const timer=setInterval(update,15000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[tab,session?.address,session?.wallet_address,config?.chain?.address,config?.chain?.deploymentId]);

 async function readGameState(){
  const g=generation.current, request=++stateRequest.current;
  const data=await api('/state');
  if(g!==generation.current||request!==stateRequest.current)return;
  if(data.player.address!==sessionRef.current?.address){switchArchive(null);await refresh();return;}
  setSyncError(false);setState(data);updateIdentity(data.player);
 }
 async function refresh(){
  const g=generation.current;const cfg=await api('/config',{},undefined);if(g!==generation.current)return;setConfig(cfg);
  if(!sessionRef.current){bootstrap.current??=api('/session',{method:'POST'}).catch(e=>{bootstrap.current=null;throw e;});const s=await bootstrap.current;if(g!==generation.current)return;sessionRef.current=s;setSession(s);}
  await readGameState();if(g!==generation.current)return;
  await loadNFTs(cfg,sessionRef.current?.wallet_verified?sessionRef.current.wallet_address||undefined:undefined);
 }

 useEffect(()=>{
  refresh().catch(e=>tell(e.message,true));
  const provider=window.ethereum;
  let live=true;
  const syncWallet=async()=>{const version=walletGeneration.current;try{const accounts=await provider?.request({method:'eth_accounts'});const chain=await provider?.request({method:'eth_chainId'});if(live&&version===walletGeneration.current){setWalletAccount(accounts?.[0]||'');setWalletChain(chain?String(BigInt(chain)):'');}}catch{if(live){setWalletAccount('');setWalletChain('');}}};
  const reset=()=>{walletGeneration.current++;setWalletAccount('');setWalletChain('');tell('钱包账户或网络已变化，游戏账号和存档保持不变。');void syncWallet();};
  void syncWallet();provider?.on('accountsChanged',reset);provider?.on('chainChanged',reset);
  return()=>{live=false;provider?.removeListener('accountsChanged',reset);provider?.removeListener('chainChanged',reset);};
 },[]);
 function updateIdentity(player:any){
  const current=sessionRef.current;if(!current||current.address!==player.address)return;
  if(current.wallet_address===player.wallet_address&&current.wallet_verified===player.wallet_verified&&current.player_id===player.player_id)return;
  const next={...current,player_id:player.player_id,wallet_address:player.wallet_address,wallet_verified:player.wallet_verified,guest:player.guest};sessionRef.current=next;setSession(next);
 }
 useEffect(()=>{
  if(!state?.player.daily_swords_reset_at)return;
  let live=true;
  const g=generation.current;
  const update=()=>{if(document.hidden)return;const request=++stateRequest.current;api('/state').then(data=>{if(!live||g!==generation.current||request!==stateRequest.current)return;if(data.player.address!==sessionRef.current?.address){switchArchive(null);refresh().catch(()=>{});return;}setSyncError(false);setState(data);updateIdentity(data.player);}).catch(()=>{if(live&&g===generation.current&&request===stateRequest.current)setSyncError(true);});};
  const timer=setInterval(update,5000);
  const midnight=setTimeout(update,Math.max(0,state.player.daily_swords_reset_at*1000-Date.now()+250));
  document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);
  return()=>{live=false;clearInterval(timer);clearTimeout(midnight);document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
 },[state?.player.address,state?.player.daily_swords_reset_at]);
 async function run(label:string,fn:()=>Promise<void>,onError?:(message:string)=>void){if(lock.current)return;lock.current=true;stateRequest.current++;setBusy(label);try{await fn();}catch(e:any){const message=e.code===4001||e.code==='ACTION_REJECTED'?'操作已取消。':e.shortMessage||e.message||'操作失败';tell(message,true);onError?.(message);}finally{lock.current=false;setBusy('');}}
 function switchArchive(next:any){generation.current++;setNotice('');setError(false);setSyncError(false);bootstrap.current=null;sessionRef.current=next;setSession(next);setState(null);setLastResult('');setShield(false);setProceeds(0n);setNfts([]);setCardFeedback({});setCardOperation(null);setMarketError(false);}
 async function accountSubmit(){await run(accountMode==='register'?'注册账号':'登录账号',async()=>{if(!username||!password)throw Error('用户名和密码不能为空。');if(username.length<3||username.length>24)throw Error('用户名需为 3–24 个汉字、字母、数字或下划线。');if(password.length<8||password.length>20)throw Error('密码需为 8–20 位。');const next=await api(`/account/${accountMode}`,{method:'POST',body:JSON.stringify({username,password})});switchArchive(next);setPassword('');setAccountMode(null);await refresh();tell(`欢迎，${next.username}。游戏档案已恢复。`);});}
 async function logoutAccount(){await run('退出账号',async()=>{await api('/account/logout',{method:'POST'});switchArchive(null);await refresh();tell('已退出账号，当前使用新的临时档案。登录后可恢复原进度。');});}
 async function login(){await run('绑定钱包',async()=>{
  if(!sessionRef.current?.username){setAccountMode('login');throw Error('请先登录游戏账号，再绑定钱包。');}
  if(!window.ethereum)throw Error('请在安装 MetaMask 的浏览器中打开。');
  const g=generation.current,player=sessionRef.current.address;
  const provider=new BrowserProvider(window.ethereum);await provider.send('eth_requestAccounts',[]);
  const cfg=await api('/config'),network=cfg.network;
  if(!network)throw Error('游戏服务暂未连接，请确认后端已启动。');
  const chainId='0x'+network.chainId.toString(16);
  try{await provider.send('wallet_switchEthereumChain',[{chainId}]);}catch(e:any){
   if(e.code===4902&&network.rpcUrls.length)await provider.send('wallet_addEthereumChain',[{chainId,chainName:network.chainName,rpcUrls:network.rpcUrls,blockExplorerUrls:network.blockExplorerUrls,nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18}}]);
   else if(e.code===4902)throw Error('请在 MetaMask 中开启测试网络并选择 Ethereum Sepolia。');else throw e;
  }
  const fresh=new BrowserProvider(window.ethereum);
  if((await fresh.getNetwork()).chainId!==BigInt(network.chainId))throw Error('钱包网络与当前游戏环境不一致，请重新连接钱包。');
  const version=walletGeneration.current,signer=await fresh.getSigner(),address=await signer.getAddress();
  const stillCurrent=()=>{if(g!==generation.current||player!==sessionRef.current?.address)throw Error('当前登录账号已变化，请刷新后重新操作。');if(version!==walletGeneration.current)throw Error('钱包已变化，请重新连接。');};
  stillCurrent();setWalletAccount(address);setWalletChain(String(network.chainId));
  if(sessionRef.current?.wallet_address&&sessionRef.current.wallet_address.toLowerCase()!==address.toLowerCase())throw Error('此账号已绑定其他钱包，请切回原钱包。当前不支持换绑。');
  const headers={'X-Forge-Player':player};
  const challenge=await api('/wallet/challenge',{method:'POST',headers,body:JSON.stringify({address})});stillCurrent();
  const signature=await signer.signMessage(challenge.message);stillCurrent();
  const next=await api('/wallet/bind',{method:'POST',headers,body:JSON.stringify({challenge_id:challenge.challenge_id,signature})});stillCurrent();
  sessionRef.current=next;setSession(next);setWalletAccount(address);setWalletChain(String(network.chainId));
  await refresh();tell('钱包验证成功，已绑定当前账号。游戏进度保持不变。');
 });}
 async function mutate(path:string,body?:any,refreshState=true){const g=generation.current;const options={method:'POST',headers:{'Idempotency-Key':crypto.randomUUID(),'X-Forge-Player':sessionRef.current?.address||'',...(/\/(heat|strike)$/.test(path)?{'X-Forge-Workshop-Revision':String(state.player.workshop_revision)}:{})},...(body?{body:JSON.stringify(body)}:{})};try{let response;try{response=await api(path,options);}catch(e){if(!(e instanceof TypeError)||g!==generation.current)throw e;response=await api(path,options);}if(g!==generation.current)throw Error('当前登录账号已变化，请刷新后重新操作。');if(refreshState)await readGameState();return response;}catch(e){await readGameState().catch(()=>{setSyncError(true);});throw e;}}
 async function action(label:string,path:string,body?:any){const g=generation.current,key=workshopKey;await run(label,async()=>{const striking=path.endsWith('/strike');const r=await mutate(path,body,!striking);if(r.weapon_id)setLastResult('');if(r.result){if(key===workshopKeyRef.current){setLastResult(r.result);setHit(h=>h+1);}await new Promise(resolve=>setTimeout(resolve,IMPACT_MS));if(g!==generation.current)return;if(r.shield_used||r.status==='destroyed')setShield(false);await readGameState();tell(outcome[r.result],r.result==='destroy');await new Promise(resolve=>setTimeout(resolve,SWING_MS-IMPACT_MS));}else tell(r.message);});}
 async function takeOut(id:string){
  if(!id)return;
  if(id===weapon?.id){setTab('forge');return;}
  await run('取出武器',async()=>{const data=await mutate('/workshop/equip',{weapon_id:id,expected_revision:state.player.workshop_revision});setTab('forge');tell(data.message);});
 }
 async function storeCurrent(){if(!weapon)return;await action('存入仓库','/workshop/store',{weapon_id:weapon.id,expected_revision:state.player.workshop_revision});}
 async function strikeWeapon(){if(!weapon||weapon.status!=='active')return;if(strikeShortage){tell(strikeShortage,true);return;}if(workshopPlace!=='anvil'){tell('先将加热后的武器放回铁砧。',true);return;}await action('敲击强化',`/weapons/${weapon.id}/strike`,{shield,expected_level:weapon.level,expected_strikes:weapon.strikes,expected_protected_left:weapon.protected_left});}
 async function heatWeapon(){if(!weapon)return;if(heatShortage){tell(heatShortage,true);return;}await action('加热武器',`/weapons/${weapon.id}/heat`);}
 async function mintWeapon(w:Weapon){
  if(!sessionRef.current?.wallet_verified){await login();if(!sessionRef.current?.wallet_verified)return;}
  await transact('铭刻 NFT',async(c,guard)=>{
   const r=await api(`/weapons/${w.id}/voucher`,{method:'POST',headers:{'X-Forge-Player':sessionRef.current?.address||''}});
   guard();return c.mint(r.voucher,r.signature);
  },BigInt(w.id).toString());
 }
 async function checkedSigner(){if(!sessionRef.current||!config?.chain)throw Error('请先登录并确认合约已部署。');if(!window.ethereum)throw Error('未检测到钱包。');const p=new BrowserProvider(window.ethereum);const signer=await p.getSigner();if((await p.getNetwork()).chainId!==BigInt(config.chain.chainId))throw Error('钱包网络与当前游戏环境不一致，请重新连接钱包。');const current=await api('/session',{method:'POST'});if(current.address!==sessionRef.current.address)throw Error('当前登录账号已变化，请刷新后重新操作。');if(!current.wallet_verified||(await signer.getAddress()).toLowerCase()!==current.wallet_address?.toLowerCase())throw Error('当前钱包与账号绑定的钱包不一致，请切回已绑定钱包。');const c=new Contract(config.chain.address,config.chain.abi,signer);if(await c.deploymentId()!==config.chain.deploymentId)throw Error('部署信息已变化，请刷新页面。');return c;}
 function savePending(p:Pending){
  setPendingRecords(records=>[...records.filter(old=>!samePending(old,p)),p]);
  if(!writePending(p))throw Error(`交易已提交，但浏览器无法保存记录。请保存交易哈希：${p.hash}`);
 }
 function clearPending(p:Pending){
  if(!removePending(p))throw Error('浏览器无法更新交易记录，请保留当前页面并重试。');
  setPendingRecords(records=>records.filter(old=>!samePending(old,p)));
 }
 const [pendingProgress,setPendingProgress]=useState<{hash:string;message:string}|null>(null);
 function showReceiptProgress(p:Pending,data:any){
  const message=data.state==='confirming'
   ?data.receipt?.status===1?'链上执行成功，正在等待网络最终确认；无需再次付费。':'交易已打包但执行失败，等待最终确认后才能重试。'
   :'交易已提交，正在等待链上打包；页面会自动检查。';
  setPendingProgress({hash:p.hash,message});
 }
 async function readReceipt(p:Pending,signal?:AbortSignal){
  const g=generation.current,data=await api(`/chain/receipts/${p.hash}`,{signal}),receipt=finalReceipt(data,p);
  if(g===generation.current)showReceiptProgress(p,data);
  return receipt;
 }
 useEffect(()=>{
  if(!pending)return;
  const record=pending,g=generation.current,controller=new AbortController();
  let live=true,inFlight=false;
  const update=async()=>{
   if(!live||inFlight||document.hidden||lock.current)return;
   inFlight=true;
   try{
    const cfg=await api('/config',{signal:controller.signal});
    if(!live||g!==generation.current)return;
    if(!matchesPending(record,cfg.chain,sessionRef.current?.wallet_address)){await refresh();return;}
    const receipt=await readReceipt(record,controller.signal);
    if(!live||g!==generation.current||!receipt||lock.current)return;
    await run('同步交易结果',()=>finishTransaction(record,receipt));
   }catch{
    if(live&&g===generation.current)setPendingProgress({hash:record.hash,message:'暂时无法检查交易，记录已保留，稍后自动重试。'});
   }finally{inFlight=false;}
  };
  void update();const timer=setInterval(update,10000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{live=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[pending?.hash,session?.address,config?.chain?.address,config?.chain?.deploymentId]);
 async function waitReceipt(p:Pending,isCurrent:()=>boolean){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline&&isCurrent()){
   const data=await api(`/chain/receipts/${p.hash}`),receipt=finalReceipt(data,p);
   if(isCurrent())showReceiptProgress(p,data);
   if(receipt)return receipt;
   if(data.state==='confirming')tell('交易已打包，正在等待网络最终确认。请勿重复提交。');
   await new Promise(resolve=>setTimeout(resolve,1500));
  }
  return null;
 }
 async function transact(label:string,send:(c:Contract,guard:()=>void)=>Promise<any>,tokenId?:string){
  if(!sessionRef.current?.wallet_verified){await login();if(!sessionRef.current?.wallet_verified)return;}
  await run(label,async()=>{
   const chain=config?.chain,account=sessionRef.current!.wallet_address!,player=sessionRef.current!.address;
   const g=generation.current,walletVersion=walletGeneration.current;
   const isCurrent=()=>g===generation.current&&walletVersion===walletGeneration.current&&player===sessionRef.current?.address;
   const guard=()=>{if(!isCurrent())throw Error('钱包或登录账号已变化，请重新操作。');};
   if(activePending||readPending().some(p=>matchesPending(p,chain,account)))throw Error('已有交易等待确认，请先检查交易状态。');
   if(!storageAvailable())throw Error('浏览器无法保存交易记录，请允许本站存储后再进行链上操作。');
   if(tokenId){setCardOperation({id:tokenId,label});cardTell(tokenId,'请在钱包中确认操作；尚未提交交易。');}
   const c=await checkedSigner();guard();
   const tx=await send(c,guard);
   // A wallet change after broadcast cannot undo the transaction. Retain its original identity.
   const record={hash:tx.hash,account,contract:chain.address,epoch:chain.deploymentId,chainId:chain.chainId,label,...(tokenId?{tokenId}:{})};
   savePending(record);setCardOperation(null);
   if(!isCurrent())return;
   tell(`${label}已提交，等待链上确认：${short(tx.hash)}`);
   const receipt=await waitReceipt(record,isCurrent);
   if(!isCurrent())return;
   if(!receipt){tell('交易仍待最终确认，记录已保存，可稍后检查。');return;}
   await finishTransaction(record,receipt);
  },message=>{if(tokenId){setCardOperation(null);cardTell(tokenId,message,true);}});
 }
 async function finishTransaction(p:Pending,receipt:{status:number}){
  clearPending(p);
  if(p.tokenId)cardTell(p.tokenId,receipt.status===1?`${p.label}已确认。`:'交易执行失败，可以重新操作。',receipt.status!==1);
  tell(receipt.status===1?`${p.label}已确认。`:'交易执行失败，可以重新操作。',receipt.status!==1);
  try{await refresh();}catch{setMarketError(true);tell('交易结果已确认，但页面数据刷新失败，请刷新状态。',true);}
 }
 async function checkPending(){await run('检查交易',async()=>{
  if(!pending)return;
  const g=generation.current,cfg=await api('/config');
  if(!matchesPending(pending,cfg.chain,sessionRef.current?.wallet_address)){
   await refresh();tell('交易所属环境已变化，记录已保留；切回原环境后可继续检查。');return;
  }
  const receipt=await readReceipt(pending);
  if(g!==generation.current)return;
  if(!receipt){tell('交易仍待最终确认，记录已保存，可稍后检查。');return;}
  await finishTransaction(pending,receipt);
 });}
 const percent=(p:number)=>`${(p*100).toFixed(1)}%`;
 let probs=weapon?.probabilities||{};if(weapon?.status==='active'&&shield&&weapon.protected_left===0){probs={...probs,saved:probs.destroy,destroy:0};}
 const hasMinted=weapon&&minted.has(weapon.id);
 const disabled=!!busy||!session||syncError;
 const canToggleShield=!disabled&&!!weapon&&weapon.status==='active'&&weapon.level<maxLevel&&(shield||(weapon.protected_left===0&&(state?.player.shields??0)>0));
 useEffect(()=>{
  if(!weapon||weapon.status!=='active'||weapon.level>=maxLevel||(state?.player.shields??0)<1)setShield(false);
 },[weapon?.id,weapon?.status,weapon?.level,maxLevel,state?.player.shields]);
 useEffect(()=>{
  const toggle=(event:KeyboardEvent)=>{
   if(event.code!=='KeyQ'||event.repeat||event.isComposing||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
   if(tab!=='forge'||!canToggleShield||lock.current||document.hidden)return;
   if(document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]'))return;
   const target=event.target;
   if(target instanceof Element&&(target.closest('input:not([type="checkbox"]),textarea,select,[contenteditable="true"],[role="textbox"]')||(target instanceof HTMLElement&&target.isContentEditable)))return;
   event.preventDefault();setShield(value=>!value);
  };
  window.addEventListener('keydown',toggle);return()=>window.removeEventListener('keydown',toggle);
 },[tab,canToggleShield]);
 const chainDisabled=disabled||marketError||activePending||!!session?.wallet_verified&&!walletReady;
 const visibleNFTs=nfts.filter(n=>marketView==='mine'&&session?.wallet_verified?n.owner.toLowerCase()===session.wallet_address?.toLowerCase():n.price>0n);
 const warming=!!weapon&&weapon.heat_charges>0&&weapon.heat_ready_at>now;
 const hot=!!weapon&&weapon.heat_charges>0&&!warming;
 return <div className="app-shell" lang={locale==='en'?'en':'zh-CN'}>{confirmationDialog}
  <aside className="sidebar"><a className="brand" href="#"><span className="brand-mark">⚒</span><span>FORGE<span className="brand-small">OF FATE</span></span></a><div className="nav-label">{t("你的锻造之旅")}</div>{[['forge','⚒',t('锻造工坊')],['bag','▦',t('武器仓库')],['market','◇',t('命运集市')],['mail','✉',t('奖励邮箱')]].map(([id,icon,label])=><button key={id} className={`nav-item ${tab===id?'selected':''}`} onClick={()=>setTab(id)}><span>{icon}</span>{label}{id==='mail'&&state?.player.mail_count>0?<span className={`mail-badge ${state.player.mail_unread>0?'has-unread':''}`} aria-label={t`待领取邮件 ${state.player.mail_count} 封`}>{state.player.mail_count>99?'99+':state.player.mail_count}</span>:<b>›</b>}</button>)}<div className="sidebar-bottom"><div className="network-dot"/> {config?.network?.chainName||t('正在连接…')}<span>{t("内部测试 · 测试币无真实价值")}</span><small>{t("每一锤，都是一次选择。")}</small></div></aside>
  <div className="workspace"><header className="topbar"><div className="breadcrumb">{t("命运锻造所 ")}<span>/</span> {tab==='forge'?t('锻造工坊'):tab==='bag'?t('武器仓库'):tab==='mail'?t('奖励邮箱'):t('命运集市')}</div><div className="header-actions"><LanguageSwitch/>{config?.demo_mode&&<span className="demo-badge">{t("DEMO 模式")}</span>}{session?.username?<button className="wallet" disabled={!!busy} onClick={login}>{t(session.wallet_address?'验证钱包':'绑定钱包')}</button>:<span className="save-status">{t('临时档案')}</span>}{session?.username?<><span className="account-name">{session.username} · {state?.player.role==='tester'?t('测试账号'):t('普通账号')}</span><button className="quiet" disabled={!!busy} onClick={logoutAccount}>{t("退出账号")}</button></>:<button className="secondary" disabled={disabled} onClick={()=>setAccountMode('login')}>{t("账号登录 / 注册")}</button>}</div></header>
   {accountMode&&<div className="account-overlay" onClick={()=>{if(!busy){setAccountMode(null);setPassword('');}}}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={e=>e.stopPropagation()}><div className="account-dialog-heading"><h2 id="account-title">{accountMode==='register'?t('注册并保存当前档案'):t('登录游戏账号')}</h2><LanguageSwitch/></div><p>{accountMode==='register'?t('新账号默认为普通账号，会保留当前剑和资源，无需连接钱包。'):t('登录会切换至该账号的存档；新玩家可注册以保留当前进度。')}</p><form noValidate onSubmit={e=>{e.preventDefault();accountSubmit();}}><label>{t("用户名")}<input autoFocus required minLength={3} maxLength={24} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder={t("3–24 位中文、字母、数字或下划线")}/></label><label>{t("密码")}<input required type="password" minLength={8} maxLength={20} autoComplete={accountMode==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder={t("8–20 位")}/></label><button className="primary" disabled={!!busy}>{busy?t(busy):(accountMode==='register'?t('注册账号'):t('登录'))}</button></form>{error&&<p role="alert">{t(notice)}</p>}<div className="account-links"><button className="quiet" disabled={!!busy} onClick={()=>{setAccountMode(accountMode==='login'?'register':'login');setPassword('');}}>{accountMode==='login'?t('注册新账号'):t('已有账号，去登录')}</button><button className="quiet" disabled={!!busy} onClick={()=>{setAccountMode(null);setPassword('');}}>{t("关闭")}</button></div></section></div>}
   <main><div className="page-heading"><div><h1>{tab==='forge'?t('让下一锤，改写命运。'):tab==='bag'?t('每一道锤痕，都属于你。'):tab==='mail'?t('收好每一天的奖励。'):t('让传奇，找到下一位主人。')}</h1><p>{tab==='forge'?t('取用武器、加热、敲击。每次进度都会保存。'):tab==='bag'?t('管理武器、永久封存，并将你的作品铸造成收藏品。'):tab==='mail'?t('查看每日奖励，领取后加入游戏金币余额。'):t('收藏封存的武器，所有权与交易记录保存在当前连接的区块链。')}</p></div><button className="quiet" disabled={!!busy} onClick={()=>run('刷新',refresh)}>{t("↻ 刷新状态")}</button></div>
   <div className="resources">{[[t('铁块'),'IRON',state?.player.materials,'⬡'],[t('保护符'),'WARD',state?.player.shields,''],[t('游戏金币'),'GOLD',state?.player.coins,'◉']].map(([label,unit,value,icon])=><div className={`resource${unit==='IRON'?' resource-iron':unit==='GOLD'?' resource-gold':unit==='WARD'?' resource-ward':''}`} key={unit}><span className="resource-icon">{unit==='IRON'?<IronIcon size="large"/>:unit==='GOLD'?<GoldIcon size="large"/>:unit==='WARD'?<WardIcon size="large"/>:icon}</span><div><span>{label}</span><strong>{unit==='GOLD'&&typeof value==='number'?formatCoins(value):value??'—'}</strong></div></div>)}<button className="claim" disabled={disabled||!state?.player.can_claim} onClick={()=>action('领取资源','/claim')}>{state&&!state.player.can_claim?t('今日已领取 ✓'):t('领取每日补给')}<small><IronAmount amount={balance?.daily_materials??200}/> · <WardAmount amount={balance?.daily_shields??5}/> {t(" · UTC 零点重置")}</small></button></div>
   {tab!=='mail'&&session?.username&&state?.player.mail_count>0&&<div className="mail-arrival" role="status"><span aria-hidden="true">✉</span><div><strong>{t(state?.player.mail_notice_count?'邮箱有新消息':'邮箱有待领取奖励')}</strong><small>{state.player.mail_notice_count?t`${state.player.mail_count} 封邮件，${state.player.mail_unread} 封未读`:t`${state.player.mail_count} 封待领取，${state.player.mail_unread} 封未读`}</small></div><button className="secondary" onClick={()=>setTab('mail')}>{t('查看邮件')}</button></div>}
   {session?.username&&<div className="service-note wallet-status" role="status"><strong>{t(session.wallet_address?'已关联钱包：':'尚未绑定钱包')}</strong>{session.wallet_address&&<span title={session.wallet_address}>{short(session.wallet_address)} · {t(!session.wallet_verified?'需要签名验证':walletReady?'已验证，钱包已就绪':!walletAccount?'请连接已绑定钱包':!walletMatches?'当前钱包不匹配，链上操作已暂停':'请切换到游戏所用网络')}</span>}<span className="wallet-connected">{t('网站当前连接的钱包：')}{walletAccount?<code>{walletAccount}</code>:t('尚未连接')}</span>{!session.wallet_verified&&<small>{t('注册账号不会自动绑定钱包。请核对上面的地址；如需使用另一个钱包，请先在 MetaMask 中将该账户连接到此网站，再点击绑定。')}</small>}<small>{t('一账号一钱包；签名验证不收 Gas，不授权转账。')}</small></div>}
   {syncError&&<div className="service-note" role="status">{t('与服务器的同步已中断，当前显示上次保存的数据，恢复连接后会自动更新。')}</div>}
   {(tab==='bag'||tab==='market')&&config?.chain_error&&<div className="service-note">{t(config.chain_error)}</div>}
   <div className={`notice ${error?'error':''} ${!notice&&!busy?'notice-idle':''}`} role="status"><span>{busy?'◌':'✦'}</span>{busy?t`${t(busy)}中… `:''}{t(notice)}</div>
   {pending&&<div className="pending">{t("待确认：")}{t(pending.label)} · <span title={pending.hash}>{short(pending.hash)}</span>{pending.chainId===11155111&&<a href={`https://sepolia.etherscan.io/tx/${pending.hash}`} target="_blank" rel="noreferrer">{t("查看交易")}</a>}<button onClick={checkPending} disabled={!!busy}>{t("检查待确认交易")}</button><small className="pending-progress">{t(pendingProgress?.hash===pending.hash?pendingProgress.message:'交易已提交，正在自动检查确认状态。')}</small></div>}
   {tab==='forge'&&state?.can_rescue&&<div className="daily-swords"><button className="secondary" disabled={disabled} onClick={()=>action('领取普通测试剑','/test/supply')}>{t('没有可强化的剑？领取一把普通测试剑')}</button></div>}
   {tab==='forge'&&<div className="forge-layout"><section className="forge-card"><div className="panel-top"><span>{t("01 / 锻造台")}</span><span className="live-dot">{t("领剑 → 加热 → 锻造")}</span></div><WorkshopStorage weapon={weapon} storedCount={(state?.weapons.length||0)-(weapon?1:0)} disabled={disabled} onStore={storeCurrent} onOpen={()=>setTab('bag')}/><div className="scene"><ForgeScene supplyRemaining={state?.player.daily_swords_remaining??null} supplyTotal={balance?.daily_swords??3} onClaimSword={()=>action('领取基础剑','/supply/sword')} storageWeapons={syncError?[]:state?.weapons||[]} storageFeedback={syncError?'与服务器的同步已中断，当前显示上次保存的数据，恢复连接后会自动更新。':busy?'正在处理操作，请稍候。':notice} onStoreWeapon={storeCurrent} workshopKey={workshopKey} weapons={syncError?[]:(state?.weapons||[]).filter((w:Weapon)=>w.status==='active')} onSelectWeapon={takeOut} level={syncError?0:weapon?.level||0} hit={hit} weapon={syncError?undefined:weapon} result={lastResult} busy={disabled} probabilities={probs} shield={shield} canToggleShield={canToggleShield} shields={state?.player.shields||0} onShield={setShield} onPlacement={setWorkshopPlace} onHeat={heatWeapon} heatWarning={heatShortage} strikeWarning={strikeShortage} strikeMaterials={strikeCost} feedback={error&&!busy?notice:''} onStrike={strikeWeapon} visualTiers={balance?.visual_tiers} maxLevel={maxLevel} heatSeconds={balance?.heat_seconds??3} heatStrikes={balance?.heat_strikes??5}/><div className="scene-caption"><span>EMBER FORGE</span><small>{t("余烬未熄，传奇未定")}</small></div><div className="scene-tag">{weapon?`${name(weapon)} +${weapon.level}`:t('等待一把新武器')}</div></div><div className="forge-footer"><span>{t("从领剑处领取基础剑，也可以消耗铁块锻造新武器。")}</span><button className="secondary" disabled={disabled} onClick={()=>action('锻造武器','/forge')}>{t("＋ 锻造新武器 ")}<small><IronAmount amount={balance?.forge_materials??10}/></small></button></div>{weapon&&<WeaponLore weapon={weapon}/>}</section>
   <section className="control-card"><div className="panel-top"><span>{t("02 / 命运之锤")}</span><span>{t("风险与回报")}</span></div><label className="field-label" htmlFor="workshop-weapon">{t("从仓库取用")}</label><select id="workshop-weapon" value={weapon?.id||''} disabled={disabled} onChange={e=>takeOut(e.target.value)}><option value="" disabled>{t("工坊空闲 · 选择武器取出")}</option>{state?.weapons.filter((w:Weapon)=>w.status==='active').map((w:Weapon)=><option key={w.id} value={w.id}>{w.demo?'[DEMO] ':''}{name(w)} +{w.level} · {w.id===weapon?.id?t('工坊中'):t('仓库中')} · {short(w.id)}</option>)}</select><label className="field-label" htmlFor="weapon-branch">{t("武器路线 · 按等级解锁")}</label><select id="weapon-branch" value={weapon?.branch||'longsword'} disabled={disabled||!weapon||weapon.status!=='active'||weapon.branch_locked||weapon.level<branchUnlockLevel} onChange={e=>chooseBranch(e.target.value)}>{swordBranches.map(branch=><option key={branch.id} value={branch.id} disabled={!weapon||weapon.level<branch.unlock_level||weapon.level>branch.max_level}>{t`${name(branch)} · +${branch.unlock_level} 解锁 · 最高 +${branch.max_level}`}</option>)}</select><details className="forge-rules"><summary>{t("查看路线规则")}</summary><small className="risk-note">{t("基础剑 +5 可选择刺剑，+10 可选择巨剑，也可继续骑士剑路线。骑士剑最高 +")}{maxSwordLevel('longsword')}{t("，刺剑最高 +")}{maxSwordLevel('rapier')}{t("，巨剑最高 +")}{maxSwordLevel('greatsword')}{t("；目标路线需容纳当前等级。选定刺剑或巨剑后路线固定；降级保留路线，低于门槛时恢复基础外观。")}</small></details><div className="level-line"><span>{t("当前等级")}<strong>+{weapon?.level??0}</strong></span><span>{t("路线等级上限")}<strong>+{maxLevel}</strong></span><span>{t("上链门槛")}<strong>+{balance?.mint_level??50}</strong></span></div><div className="progress"><div style={{width:`${Math.min((weapon?.level||0)/(balance?.mint_level||20)*100,100)}%`}}/></div><div className="probability-title">{t("下一锤的命运 ")}<small>{t("服务端结算 · 暂定数值")}</small></div><div className="probabilities">{[['up',t('普通升级'),'+1'],['double',t('大成功'),'+2'],['down',t('降级'),'−1'],['destroy',t('永久损毁'),'×'],...(probs.saved?[['saved',t('保护后不变'),'—']]:[])].map(([id,label,symbol])=><div key={id} className={`prob ${id}`}><span><b>{symbol}</b>{label}</span><strong>{weapon&&weapon.level<maxLevel?percent(probs[id]||0):'—'}</strong></div>)}</div><label className="shield-toggle"><input type="checkbox" checked={shield} aria-keyshortcuts="Q" disabled={!canToggleShield} onChange={e=>setShield(e.target.checked)}/><span><b>{t("启用保护符 · Q")}</b><small>{t("仅挡住损毁时消耗 1 张，仍可能降级")}</small></span><span className="shield-icon"><WardIcon size="medium"/></span></label><div className="stage-info">{weapon?.protected_left?t`✦ 无敌阶段 · 剩余 ${weapon.protected_left} 锤免损毁`:t`距离免损毁阶段还需 ${Math.max(0,(balance?.protection_trigger||10)-(weapon?.strikes||0))} 锤`}</div><button className="secondary heat-button" disabled={disabled||!weapon||weapon.status!=='active'||weapon.level>=maxLevel||weapon.heat_charges>0} onClick={heatWeapon}>♨ {weapon&&weapon.level>=maxLevel?t('已达到路线等级上限'):heatShortage?t('铁块不足，无法加热'):warming?t('加热中…'):hot?t`热量剩余 ${weapon.heat_charges} 锤`:t('送入熔炉加热')}<small>{balance?.heat_seconds??3} {t(" 秒 · ")}<IronAmount amount={heatCost}/> {t(" · 可敲 ")}{balance?.heat_strikes??5} {t(" 锤")}</small></button><button className="primary strike" disabled={disabled||!weapon||weapon.status!=='active'||!hot||workshopPlace!=='anvil'||weapon.level>=maxLevel||!!strikeShortage} onClick={strikeWeapon}>{t("⚒ 敲下命运之锤 ")}<span><IronAmount amount={strikeCost}/></span></button>{strikeShortage&&<small className="risk-note" role="alert">{t(strikeShortage)}</small>}<details className="forge-rules"><summary>{t("消耗与损毁说明")}</summary><small className="risk-note">{t("每次敲击都会消耗铁块，降级、保护生效与损毁也照常扣除。损毁会永久失去当前武器及已投入资源。")}</small></details></section></div>}
   {tab==='bag'&&<section className="inventory"><div className="section-title"><h2>{t("武器仓库 ")}<span>{state?.weapons.length||0}</span></h2><button className="secondary" disabled={disabled} onClick={()=>action('锻造武器','/forge')}>{t("＋ 锻造新武器")}<small><IronAmount amount={balance?.forge_materials??10}/></small></button></div><p className="warehouse-summary">{t('取出另一把武器时，当前工坊武器会自动存回仓库；存入不会消耗资源。')}</p>{!state?.weapons.length?<div className="empty">⚒<h3>{t("这里等待着你的第一把武器")}</h3><p>{t("到工坊左侧领剑处领取基础剑，再领取材料开始锻造。")}</p></div>:<div className="weapon-grid">{state.weapons.map((w:Weapon)=><WeaponCard key={w.id} weapon={w} serial={short(w.id)} status={w.status==='active'?(w.id===weapon?.id?t('工坊中'):t('仓库中')):minted.has(w.id)?t('已铸造 NFT'):w.status==='sealed'?t('已永久封存'):w.level>=(w.max_level??maxSwordLevel(w.branch))?t('路线满级'):t('可继续强化')} statusTone={w.status==='sealed'?'sealed':'active'} valueLabel={w.status==='active'?t('系统回收估值'):t('封存状态')} value={w.status==='active'?<GoldAmount amount={formatCoins(w.recycle_price)}/>:minted.has(w.id)?t('已铭刻'):t('待铭刻')}>{w.status==='active'?<><button className="secondary card-main-action" disabled={disabled} onClick={()=>takeOut(w.id)}>{w.id===weapon?.id?t('返回工坊'):t('取出并继续锻造')}</button><button className="quiet" disabled={disabled} onClick={async()=>{if(await askConfirmation(`回收后武器消失，获得 ${formatCoins(w.recycle_price)} 游戏金币。确定？`))action('系统回收',`/weapons/${w.id}/recycle`);}}>{t("系统回收")}</button><button className="primary" disabled={disabled||w.level<balance?.mint_level} onClick={async()=>{if(await askConfirmation('封存后永久固定属性，不能再强化或卖给系统。确定封存？'))action('永久封存',`/weapons/${w.id}/seal`);}}>{t("封存")}{w.level<balance?.mint_level?t`（需 +${balance?.mint_level}）`:''}</button></>:minted.has(w.id)?<button className="secondary" onClick={()=>setTab('market')}>{t("查看链上收藏 ↗")}</button>:<button className="primary" disabled={chainDisabled||!config?.chain} onClick={()=>mintWeapon(w)}>{t("铭刻 NFT ↗")}</button>}</WeaponCard>)}</div>}</section>}
   {tab==='market'&&state?.player.can_cheat&&<ChainDiagnostics key={`${session?.address}:${config?.chain?.deploymentId||''}`} token={session?.token} walletAccount={walletAccount} walletChain={walletChain} boundWallet={session?.wallet_address} verified={session?.wallet_verified} expectedChainId={config?.network?.chainId}/>}
   {tab==='market'&&<section className="inventory"><div className="section-title"><h2>{t("链上收藏与交易 ")}<span>{visibleNFTs.length}</span></h2><div className="withdraw"><span>{t("可提取收益 ")}{formatEther(proceeds)} ETH</span><button className="secondary" disabled={chainDisabled||proceeds===0n} onClick={()=>transact('提取交易收益',c=>c.withdraw())}>{t("提取")}</button></div></div><p className="section-description">{t("成交款进入卖家的合约余额，可随时提取到钱包。系统金币与测试 ETH 分开结算。")}</p>{marketError&&<p className="market-sync-error" role="alert">{t('链上信息暂未同步，正在自动重试；暂时无法交易。')}</p>}<div className="market-views" role="group" aria-label={t('收藏与市场')}><button className="quiet" disabled={!session?.wallet_verified} aria-pressed={marketView==='mine'&&!!session?.wallet_verified} onClick={()=>setMarketView('mine')}>{t('我的收藏')}</button><button className="quiet" aria-pressed={marketView==='listings'||!session?.wallet_verified} onClick={()=>setMarketView('listings')}>{t('在售市场')}</button></div><ChainHistory deploymentId={config?.chain?.deploymentId}/>{!visibleNFTs.length?<div className="empty">◇<h3>{t(config?.chain?(marketView==='mine'&&session?.wallet_verified?"暂无持有的 NFT":"暂无挂牌藏品"):"NFT 功能准备中")}</h3><p>{t(config?.chain?"铭刻或购买后可在我的收藏中查看；售出后会移出收藏。":"完成 NFT 业务合约部署后，这里将开放铭刻与交易。普通锻造和仓库现在就能使用。")}</p></div>:<div className="weapon-grid">{visibleNFTs.map(n=>{const mine=n.owner.toLowerCase()===session?.wallet_address?.toLowerCase();const listed=n.price>0n;const waiting=pending?.tokenId===n.id;const operating=cardOperation?.id===n.id;const feedback=cardFeedback[n.id];const message=waiting?(pendingProgress?.hash===pending.hash?pendingProgress.message:'交易已提交，正在自动检查确认状态。'):operating?'请在钱包中确认操作；尚未提交交易。':feedback?.message;return <WeaponCard key={n.id} weapon={n} serial={`#${short(n.id)}`} nft status={waiting?t('等待链上确认'):operating?t('等待钱包确认'):listed?t('正在出售'):mine?t('在你的钱包 · 未挂牌'):t('未挂牌')} statusTone={listed?'listed':'sealed'} detail={<><span>{t("持有人")}</span><span title={n.owner}>{short(n.owner)}{mine?t(' · 你'):''}</span></>} valueLabel={t("挂牌价格")} value={listed?formatEther(n.price):t('未设置')} valueUnit={listed?t('测试 ETH'):undefined}>{mine&&<p className="nft-custody-note">{t('NFT 已在你的钱包中，可挂牌出售。')}</p>}{message&&<p className={`nft-action-feedback${!waiting&&!operating&&feedback?.error?' error':''}`} role="status" aria-live="polite">{t(message)}</p>}{mine?<><input disabled={chainDisabled} aria-label={t("挂牌价格")} placeholder={t("挂牌价格（测试 ETH）")} value={prices[n.id]||''} onChange={e=>setPrices({...prices,[n.id]:e.target.value})}/><button className="primary" disabled={chainDisabled} onClick={()=>transact('挂牌 NFT',c=>{const price=parseEther(prices[n.id]||'0');if(price<=0n)throw Error('请输入大于零的 ETH 价格。');return c.list(n.id,price);},n.id)}>{listed?t('更新价格'):t('挂牌出售')}</button>{listed&&<button className="quiet" disabled={chainDisabled} onClick={()=>transact('撤销挂牌',c=>c.cancel(n.id),n.id)}>{t("撤销挂牌")}</button>}</>:<button className="primary" disabled={chainDisabled||!listed} onClick={()=>transact('购买 NFT',c=>c.buy(n.id,n.seller,n.price,{value:n.price}),n.id)}>{listed?t('购买收藏品'):t('等待持有人挂牌')}</button>}</WeaponCard>;})}</div>}</section>}
   {tab==='mail'&&<Mailbox key={session?.address||'guest'} account={session?.username?session.address:undefined} canTest={!!state?.player.can_cheat} busy={disabled} summaryVersion={`${state?.player.mail_count||0}:${state?.player.mail_unread||0}`} onAction={action}/>}
   {tab!=='mail'&&state?.player.can_cheat&&<CheatPanel busy={disabled} maxLevel={balance?.max_level??100} heatStrikes={balance?.heat_strikes??5} weapon={weapon} onAction={action}/>}
   {tab!=='mail'&&<div className="bottom-panels"><div><h3>{t("工坊补给")}</h3><p>{t("使用游戏金币购买铁块、普通剑或保护符。")}</p></div><div className="supply-actions"><button className="secondary" disabled={disabled||state?.player.coins<(balance?.coin_sword_price??2500)} onClick={()=>action('购买普通剑','/shop/sword')}>{t("购买 +")}{balance?.coin_sword_level??0} {t(" 普通剑 · ")}<GoldAmount amount={formatCoins(balance?.coin_sword_price??2500)}/></button><button className="secondary material-pack-button" disabled={disabled||state?.player.coins<(balance?.material_pack_price??5000)} onClick={()=>action('购买铁块','/materials')}><IronIcon size="large"/><span className="material-pack-copy">{t("补充 ")}{balance?.material_pack_size??20} {t(" 铁块")}<small><GoldAmount amount={formatCoins(balance?.material_pack_price??5000)}/></small></span></button><button className="secondary ward-pack-button" disabled={disabled||state?.player.coins<(balance?.shield_pack_price??2500)} onClick={()=>action('购买保护符','/shop/wards')}><WardIcon size="large"/><span className="material-pack-copy">{t`购买 ${balance?.shield_pack_size??1} 张保护符`}<small><GoldAmount amount={formatCoins(balance?.shield_pack_price??2500)}/></small></span></button>{state?.player.can_cheat&&<button className="quiet" disabled={disabled||!!state?.player.demo_claimed||!config?.chain} onClick={()=>action('领取演示武器','/demo/seed')}>{t("领取 DEMO 达标武器")}</button>}</div></div>}<footer>FORGE OF FATE <span>{t("游戏进度由本机服务保存 · 链上交易通过钱包确认")}</span></footer>
  </main></div></div>;
}
