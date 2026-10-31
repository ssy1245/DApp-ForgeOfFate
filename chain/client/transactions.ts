// Browser recovery records are hints. Completion must come from the matching chain receipt.
export type Pending = {hash:string; account:string; contract:string; epoch:string; chainId:number; label:string; tokenId?:string; target?:'staking'};
const PREFIX = 'forge:transaction:';
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
function valid(value:any): value is Pending {
  return !!value && hashPattern.test(value.hash) && addressPattern.test(value.account)
    && addressPattern.test(value.contract) && hashPattern.test(value.epoch)
    && Number.isSafeInteger(value.chainId) && value.chainId > 0
    && (value.target === undefined || value.target === 'staking')
    && (value.tokenId === undefined || (typeof value.tokenId === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value.tokenId)))
    && typeof value.label === 'string' && value.label.length > 0 && value.label.length < 100;
}
function key(p:Pending) { return `${PREFIX}${p.chainId}:${p.contract.toLowerCase()}:${p.epoch.toLowerCase()}:${p.hash.toLowerCase()}`; }
export function samePending(a:Pending,b:Pending) { return key(a) === key(b); }
export function matchesPending(p:Pending, chain:any, account?:string|null) {
  return !!chain && p.chainId === chain.chainId && p.contract.toLowerCase() === chain.address.toLowerCase()
    && p.epoch.toLowerCase() === chain.deploymentId.toLowerCase() && p.account.toLowerCase() === account?.toLowerCase();
}
export function readPending(storage?:Storage, legacy?:Storage):Pending[] {
  const records = new Map<string,Pending>();
  try {
    storage ??= window.localStorage;
    for(let i=0;i<storage.length;i++) {
      const name = storage.key(i);
      if(!name?.startsWith(PREFIX))continue;
      try { const p=JSON.parse(storage.getItem(name)||'null'); if(valid(p)&&key(p)===name)records.set(name,p); } catch { /* Ignore malformed entries, not other valid records. */ }
    }
    legacy ??= window.sessionStorage;
    const p=JSON.parse(legacy.getItem('forge:pending')||'null');
    if(valid(p)) {
      records.set(key(p),p);
      storage.setItem(key(p),JSON.stringify(p));
      legacy.removeItem('forge:pending');
    }
  } catch { /* SSR or disabled browser storage must not crash the game. */ }
  return [...records.values()];
}
export function storageAvailable(storage?:Storage) {
  try { storage ??= window.localStorage; const name=PREFIX+'probe';storage.setItem(name,'1');storage.removeItem(name);return true; } catch { return false; }
}
export function writePending(p:Pending, storage?:Storage) {
  try { if(!valid(p))return false;(storage??window.localStorage).setItem(key(p),JSON.stringify(p));return true; } catch { return false; }
}
export function removePending(p:Pending, storage?:Storage) {
  try { (storage??window.localStorage).removeItem(key(p));return true; } catch { return false; }
}
export function finalReceipt(data:any,p:Pending):{status:number}|null {
  if(data.chainId!==p.chainId||data.deploymentId?.toLowerCase()!==p.epoch.toLowerCase())throw Error('部署信息已变化，请刷新页面。');
  const r=data.receipt;
  if(!r)return null;
  if(r.hash?.toLowerCase()!==p.hash.toLowerCase()||r.from?.toLowerCase()!==p.account.toLowerCase())throw Error('交易回执与当前钱包记录不匹配，请检查交易哈希。');
  if(r.finalized!==true)return null;
  if(![0,1].includes(r.status)||data.state!==(r.status===1?'confirmed':'failed'))throw Error('交易状态暂时无法读取，请稍后重试。');
  return r;
}
