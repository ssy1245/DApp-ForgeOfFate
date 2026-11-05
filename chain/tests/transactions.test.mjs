import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../client/transactions.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {readPending,writePending,removePending,samePending,matchesPending,storageAvailable,finalReceipt,conflictsWithPending}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const p={hash:'0x'+'ab'.repeat(32),account:'0x'+'12'.repeat(20),contract:'0x'+'34'.repeat(20),epoch:'0x'+'56'.repeat(32),chainId:11155111,label:'Mint NFT'};
const chain={address:p.contract,deploymentId:p.epoch,chainId:p.chainId};
class Storage {
 map=new Map();get length(){return this.map.size;}key(i){return [...this.map.keys()][i]??null;}getItem(k){return this.map.get(k)??null;}setItem(k,v){this.map.set(k,v);}removeItem(k){this.map.delete(k);}
}
const response=(status=1)=>({chainId:p.chainId,deploymentId:p.epoch,state:status?'confirmed':'failed',receipt:{hash:p.hash,from:p.account,status,finalized:true}});

test('pending records survive reload, do not overwrite other transactions and remove only the completed one',()=>{
 const storage=new Storage(),legacy=new Storage();const second={...p,hash:'0x'+'cd'.repeat(32)};
 assert.ok(writePending(p,storage));assert.ok(writePending(second,storage));assert.deepEqual(readPending(storage,legacy),[p,second]);
 assert.ok(removePending(p,storage));assert.deepEqual(readPending(storage,legacy),[second]);
});
test('matching scopes records to wallet, chain, contract and deployment epoch',()=>{
 assert.ok(matchesPending(p,chain,p.account.toUpperCase()));
 for(const changed of [{chainId:1},{address:p.account},{deploymentId:p.hash}])assert.equal(matchesPending(p,{...chain,...changed},p.account),false);
 assert.equal(matchesPending(p,chain,p.contract),false);assert.equal(matchesPending(p,null,p.account),false);
 assert.ok(samePending(p,{...p,hash:'0x'+p.hash.slice(2).toUpperCase()}));
});
test('legacy session record is migrated only after durable persistence',()=>{
 const storage=new Storage(),legacy=new Storage();legacy.setItem('forge:pending',JSON.stringify(p));
 assert.deepEqual(readPending(storage,legacy),[p]);assert.equal(legacy.getItem('forge:pending'),null);
 assert.deepEqual(readPending(storage,new Storage()),[p]);
 const failed=new Storage();failed.setItem=()=>{throw Error('quota');};legacy.setItem('forge:pending',JSON.stringify(p));
 assert.deepEqual(readPending(failed,legacy),[p]);assert.notEqual(legacy.getItem('forge:pending'),null);
});
test('malformed and unrelated storage entries cannot crash or invent a pending transaction',()=>{
 const storage=new Storage();writePending(p,storage);storage.setItem('forge:transaction:broken','{');storage.setItem('forge:transaction:wrong-key',JSON.stringify(p));storage.setItem('other-data','[]');
 assert.deepEqual(readPending(storage,new Storage()),[p]);assert.equal(writePending({...p,hash:'bad'},storage),false);assert.equal(writePending({...p,chainId:'1'},storage),false);
});
test('unavailable storage is reported before submitting and never causes an uncaught reader error',()=>{
 const storage={get length(){throw Error('denied');},getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
 assert.equal(storageAvailable(storage),false);assert.deepEqual(readPending(storage,new Storage()),[]);assert.equal(writePending(p,storage),false);assert.equal(removePending(p,storage),false);
 assert.equal(storageAvailable(new Storage()),true);
});
test('both successful and reverted receipts wait for explicit finality',()=>{
 for(const status of [0,1]){const data=response(status);assert.equal(finalReceipt({...data,receipt:{...data.receipt,finalized:false}},p),null);assert.equal(finalReceipt({...data,receipt:{...data.receipt,finalized:undefined}},p),null);assert.equal(finalReceipt(data,p).status,status);}
 assert.equal(finalReceipt({...response(),receipt:null,state:'pending'},p),null);
});
test('foreign network, epoch, sender or transaction cannot complete a saved operation',()=>{
 const data=response();
 for(const change of [{chainId:1},{deploymentId:p.hash},{receipt:{...data.receipt,from:p.contract}},{receipt:{...data.receipt,hash:p.epoch}}])assert.throws(()=>finalReceipt({...data,...change},p));
});
test('invalid or contradictory terminal states cannot complete a saved operation',()=>{
 const data=response();assert.throws(()=>finalReceipt({...data,state:'failed'},p));assert.throws(()=>finalReceipt({...data,receipt:{...data.receipt,status:2}},p));
});

test('optional NFT identity survives recovery without losing large token precision',()=>{
 const storage=new Storage(),tokenId='70040015053319833925070134247553094792372603883471276971352987907260594856800';
 assert.ok(writePending({...p,tokenId},storage));
 assert.equal(readPending(storage,new Storage())[0].tokenId,tokenId);
 for(const value of [42,'-1','42x','', '9'.repeat(79)])assert.equal(writePending({...p,tokenId:value},storage),false);
});


test('recharge receipts retain target across reload and stay separate from NFT transactions',()=>{
 const storage=new Storage(),recharge={...p,contract:'0x'+'78'.repeat(20),target:'recharge',label:'Top up coins'};
 assert.ok(writePending(p,storage));assert.ok(writePending(recharge,storage));
 const saved=readPending(storage,new Storage());assert.deepEqual(saved,[p,recharge]);
 assert.equal(matchesPending(recharge,chain,p.account),false);
 assert.ok(removePending(recharge,storage));assert.deepEqual(readPending(storage,new Storage()),[p]);
 assert.equal(writePending({...p,target:'arbitrary-route'},storage),false);
});

test('recharge progress retains amount and time while malformed display values cannot crash recovery',()=>{
 const storage=new Storage(),record={...p,target:'recharge',amountWei:'10000000000000000',submittedAt:1793440000000};
 assert.ok(writePending(record,storage));assert.deepEqual(readPending(storage,new Storage()),[record]);
 for(const amountWei of ['-1','0','1.5',String(2n**256n),'9'.repeat(79)])assert.equal(writePending({...record,amountWei},storage),false);
 for(const submittedAt of [0,-1,NaN,9007199254740991,'today'])assert.equal(writePending({...record,submittedAt},storage),false);
});

test('weapon locks span mint, trade and staking without losing uint256 precision or blocking other weapons',()=>{
 const id='70040015053319833925070134247553094792372603883471276971352987907260594856800';
 for(const target of [undefined,'staking']){
  const record={...p,target,tokenId:id};
  for(const operationTarget of ['nft','staking']){
   assert.equal(conflictsWithPending(record,{target:operationTarget,tokenId:id,label:'质押 NFT'}),true);
   assert.equal(conflictsWithPending(record,{target:operationTarget,tokenId:'0x'+BigInt(id).toString(16),label:'铭刻 NFT'}),true);
   assert.equal(conflictsWithPending(record,{target:operationTarget,tokenId:(BigInt(id)+1n).toString(),label:'挂牌 NFT'}),false);
  }
  assert.equal(conflictsWithPending(record,{target:'recharge',label:'充值游戏金币'}),false);
 }
});
test('recharge and proceeds keep their own duplicate protection; unidentified legacy NFT records fail closed',()=>{
 const deposit={...p,target:'recharge',label:'充值游戏金币'};
 for(const label of ['充值游戏金币','提现充值收入','添加充值管理员'])assert.equal(conflictsWithPending(deposit,{target:'recharge',label}),true);
 const proceeds={...p,label:'提取交易收益'};
 assert.equal(conflictsWithPending(proceeds,{target:'nft',label:'提取交易收益'}),true);
 assert.equal(conflictsWithPending(proceeds,{target:'nft',tokenId:'42',label:'挂牌 NFT'}),false);
 assert.equal(conflictsWithPending({...p,tokenId:'42'},{target:'nft',label:'提取交易收益'}),false);
 assert.equal(conflictsWithPending(p,{target:'nft',tokenId:'42',label:'挂牌 NFT'}),true);
 assert.equal(conflictsWithPending(p,{target:'recharge',label:'充值游戏金币'}),false);
});


test('purchase reservation identity survives storage and rejects malformed lock IDs',()=>{
 const storage=new Storage(),legacy=new Storage(),purchase={...p,tokenId:'42',purchaseLockId:'aa'.repeat(32)};
 assert.ok(writePending(purchase,storage));
 assert.deepEqual(readPending(storage,legacy),[purchase]);
 assert.equal(writePending({...purchase,purchaseLockId:'bad'},storage),false);
});
