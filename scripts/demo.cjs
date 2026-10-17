// Uses ephemeral random wallets on the local chain; no private keys are persisted or printed.
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {Wallet,NonceManager,JsonRpcProvider,Contract,parseEther}=require('ethers');
const provider=new JsonRpcProvider('http://127.0.0.1:8545');
async function api(path,token,body={},key){const r=await fetch(`http://127.0.0.1:8000/api${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),'Idempotency-Key':key||randomUUID()},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(`${r.status}: ${data.detail}`);return data;}
async function main(){
 const cfg=await(await fetch('http://127.0.0.1:8000/api/config')).json();assert(cfg.demo_mode,'Start backend with DEMO_MODE=1');assert(cfg.chain,'Deploy contracts first');
 const funder=await provider.getSigner(0);const wa=Wallet.createRandom().connect(provider),wb=Wallet.createRandom().connect(provider);
 for(const w of[wa,wb])await(await funder.sendTransaction({to:w.address,value:parseEther('2')})).wait();
 async function login(w){const c=await api('/auth/challenge',null,{address:w.address});return(await api('/auth/login',null,{challenge_id:c.challenge_id,signature:await w.signMessage(c.message)})).token;}
 const a=await login(wa),b=await login(wb);
 const key=randomUUID();await api('/claim',a,{},key);await api('/claim',a,{},key);
 const forged=await api('/forge',a);const forgedState=await(await fetch('http://127.0.0.1:8000/api/state',{headers:{Authorization:`Bearer ${a}`}})).json();const w=forgedState.weapons.find(w=>w.id===forged.weapon_id);
 await api(`/weapons/${w.id}/heat`,a);await new Promise(r=>setTimeout(r,(cfg.balance.heat_seconds+0.1)*1000));
 await api(`/weapons/${w.id}/strike`,a,{shield:true,expected_level:w.level,expected_strikes:w.strikes,expected_protected_left:w.protected_left});
 await api(`/weapons/${w.id}/recycle`,a);
 await api('/materials',a).then(()=>{throw Error('Unexpected free material purchase');},e=>assert.match(e.message,/409/));
 require('node:child_process').execFileSync('.venv/bin/python',['scripts/create_dev_accounts.py','--demo-wallet',wa.address],{stdio:'pipe'});
 const demo=await api('/demo/seed',a);await api(`/weapons/${demo.weapon_id}/seal`,a);
 await assert.rejects(api(`/weapons/${demo.weapon_id}/voucher`,b),/404/);
 const authorization=await api(`/weapons/${demo.weapon_id}/voucher`,a);
 const ca=new Contract(cfg.chain.address,cfg.chain.abi,new NonceManager(wa)),cb=ca.connect(new NonceManager(wb));
 const id=BigInt(demo.weapon_id);await(await ca.mint(authorization.voucher,authorization.signature)).wait();assert.equal(await ca.ownerOf(id),wa.address);
 await assert.rejects(api(`/weapons/${demo.weapon_id}/voucher`,a),/409/);
 const price=parseEther('0.01');await(await ca.list(id,price)).wait();await(await cb.buy(id,wa.address,price,{value:price})).wait();assert.equal(await ca.ownerOf(id),wb.address);assert.equal(await ca.proceeds(wa.address),price);
 await(await ca.withdraw()).wait();assert.equal(await ca.proceeds(wa.address),0n);
 await(await cb.list(id,price)).wait();await(await cb['safeTransferFrom(address,address,uint256)'](wb.address,wa.address,id)).wait();assert.equal((await ca.listings(id)).price,0n);assert.equal(await ca.ownerOf(id),wa.address);
 console.log('PASS: wallet signature login → daily claim/retry → forge → protected strike → system recycle → DEMO weapon → seal → backend-signed NFT mint → list → wallet B purchase → seller withdrawal → direct transfer clears listing.');
 console.log('Buyer and seller were ephemeral local test wallets. DEMO NFT remains visible in the local collection.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
