const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ethers, network } = require('hardhat');
const solc = require('solc');
const types = {Voucher:[{name:'weaponId',type:'bytes32'},{name:'recipient',type:'address'},{name:'level',type:'uint256'},{name:'uri',type:'string'},{name:'deadline',type:'uint256'},{name:'deploymentId',type:'bytes32'}]};
const source = fs.readFileSync(require('node:path').join(__dirname,'fixtures/MarketActor.sol'),'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Actor.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode']}}}})));
assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0);
const artifact = compiled.contracts['Actor.sol'].MarketActor;

describe('ForgeOfFate transaction boundaries', function(){
 let c,authority,a,b,d,actor,epoch,domain;
 beforeEach(async()=>{
  [authority,a,b,d]=await ethers.getSigners();epoch=ethers.hexlify(ethers.randomBytes(32));
  c=await(await ethers.getContractFactory('ForgeOfFate')).deploy(authority.address,epoch);await c.waitForDeployment();
  actor=await new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,a).deploy();await actor.waitForDeployment();
  domain={name:'ForgeOfFate',version:'1',chainId:31337,verifyingContract:await c.getAddress()};
 });
 async function voucher(recipient=a.address,overrides={},customDomain=domain){
  const v={weaponId:ethers.hexlify(ethers.randomBytes(32)),recipient,level:50,uri:'data:application/json;base64,e30=',deadline:(await ethers.provider.getBlock('latest')).timestamp+600,deploymentId:epoch,...overrides};
  return [v,await authority.signTypedData(customDomain,types,v)];
 }
 async function mint(){const [v,s]=await voucher();await(await c.connect(a).mint(v,s)).wait();return BigInt(v.weaponId);}
 const encode=(fn,args=[])=>c.interface.encodeFunctionData(fn,args);
 const invoke=(fn,args=[],value=0n)=>actor.invoke(c.target,encode(fn,args),{value});
 const configure=(nft='0x',eth='0x',value=0n,rejectNFT=false,rejectETH=false)=>actor.configure(c.target,nft,eth,value,rejectNFT,rejectETH);
 const balance=()=>ethers.provider.getBalance(c.target);
 it('refuses a zero signing authority',async()=>{await assert.rejects((await ethers.getContractFactory('ForgeOfFate')).deploy(ethers.ZeroAddress,epoch),/Invalid signer/);});
 it('binds every voucher field and its verifying contract; malformed signatures do not mint',async()=>{
  const [v,s]=await voucher();
  for(const changed of [{weaponId:ethers.ZeroHash},{uri:'changed'},{deadline:v.deadline+1}])await assert.rejects(c.connect(a).mint({...v,...changed},s),/Invalid signature/);
  const [other,signature]=await voucher(a.address,{}, {...domain,verifyingContract:actor.target});
  await assert.rejects(c.connect(a).mint(other,signature),/Invalid signature/);
  await assert.rejects(c.connect(a).mint(v,'0x1234'),/ECDSAInvalidSignatureLength/);
  assert.deepEqual([...await c.allTokens()],[]);
 });
 it('accepts a voucher at its deadline and refuses it one second later',async()=>{
  const deadline=(await ethers.provider.getBlock('latest')).timestamp+30;
  const [v,s]=await voucher(a.address,{deadline});
  await network.provider.send('evm_setNextBlockTimestamp',[deadline]);await(await c.connect(a).mint(v,s)).wait();
  const [late,sig]=await voucher(a.address,{deadline});
  await network.provider.send('evm_setNextBlockTimestamp',[deadline+1]);await network.provider.send('evm_mine');
  await assert.rejects(c.connect(a).mint(late,sig),/Expired voucher/);
 });
 it('rejects unauthorized cancellation, approval-based listing and zero-address transfers',async()=>{
  const id=await mint();await(await c.connect(a).approve(b.address,id)).wait();
  await assert.rejects(c.connect(b).list(id,1n),/Not owner/);await assert.rejects(c.connect(b).cancel(id),/Not owner/);
  await(await c.connect(a).list(id,1n)).wait();await assert.rejects(c.connect(a).transferFrom(a.address,ethers.ZeroAddress,id),/ERC721InvalidReceiver/);
  assert.equal((await c.listings(id)).price,1n);assert.equal(await c.ownerOf(id),a.address);
 });
 it('does not sell on stale lower or higher prices, underpayment or overpayment',async()=>{
  const id=await mint();await(await c.connect(a).list(id,200n)).wait();
  for(const stale of [100n,300n])await assert.rejects(c.connect(b).buy(id,a.address,stale,{value:stale}),/Listing changed/);
  for(const value of [0n,199n,201n])await assert.rejects(c.connect(b).buy(id,a.address,200n,{value}),/Wrong payment/);
  assert.equal(await c.ownerOf(id),a.address);assert.equal(await c.proceeds(a.address),0n);assert.equal(await balance(),0n);
 });
 it('allows only one of two competing mined purchases to succeed',async()=>{
  const id=await mint();await(await c.connect(a).list(id,100n)).wait();
  let first,second;
  await network.provider.send('evm_setAutomine',[false]);
  try {
   first=await c.connect(b).buy(id,a.address,100n,{value:100n,gasLimit:300000});
   second=await c.connect(d).buy(id,a.address,100n,{value:100n,gasLimit:300000});
   await network.provider.send('evm_mine');
  } finally {await network.provider.send('evm_setAutomine',[true]);}
  const results=await Promise.all([ethers.provider.getTransactionReceipt(first.hash),ethers.provider.getTransactionReceipt(second.hash)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[0,1]);
  assert.equal(await c.ownerOf(id),results[0].status===1?b.address:d.address);
  assert.equal(await c.proceeds(a.address),100n);assert.equal(await balance(),100n);
 });
 it('rolls back ownership, listing, ETH and credit if the buyer rejects the NFT',async()=>{
  const id=await mint();await(await c.connect(a).list(id,100n)).wait();await configure('0x','0x',0n,true);
  await assert.rejects(invoke('buy',[id,a.address,100n],100n),/NFT rejected/);
  assert.equal(await c.ownerOf(id),a.address);assert.equal((await c.listings(id)).price,100n);
  assert.equal(await c.proceeds(a.address),0n);assert.equal(await balance(),0n);
  await configure();await(await invoke('buy',[id,a.address,100n],100n)).wait();assert.equal(await c.ownerOf(id),actor.target);
 });
 it('rejected safe mint leaves no token, metadata or consumed voucher',async()=>{
  const [v,s]=await voucher(actor.target);const id=BigInt(v.weaponId);await configure('0x','0x',0n,true);
  await assert.rejects(invoke('mint',[v,s]),/NFT rejected/);assert.equal(await c.exists(id),false);assert.equal(await c.levels(id),0n);assert.deepEqual([...await c.allTokens()],[]);
  await configure();await(await invoke('mint',[v,s])).wait();assert.equal(await c.tokenURI(id),v.uri);assert.deepEqual([...await c.allTokens()],[id]);
 });
 it('safe-mint callback can transfer the NFT without duplicating or losing its snapshot',async()=>{
  const [v,s]=await voucher(actor.target);const id=BigInt(v.weaponId);
  await configure(encode('transferFrom',[actor.target,b.address,id]));await(await invoke('mint',[v,s])).wait();
  assert.equal(await actor.callbackOK(),true);assert.equal(await c.ownerOf(id),b.address);assert.equal(await c.levels(id),50n);assert.equal(await c.tokenURI(id),v.uri);
  await assert.rejects(invoke('mint',[v,s]),/Already minted/);
 });
 for(const callback of ['transfer','relist'])it(`purchase callback can ${callback}; final ownership/listing and seller credit remain consistent`,async()=>{
  const id=await mint();await(await c.connect(a).list(id,100n)).wait();
  await configure(callback==='transfer'?encode('transferFrom',[actor.target,d.address,id]):encode('list',[id,300n]));
  const receipt=await(await invoke('buy',[id,a.address,100n],100n)).wait();
  assert.equal(await actor.callbackOK(),true);assert.equal(await c.ownerOf(id),callback==='transfer'?d.address:actor.target);
  assert.equal((await c.listings(id)).price,callback==='transfer'?0n:300n);assert.equal(await c.proceeds(a.address),100n);
  const names=receipt.logs.filter(l=>l.address===c.target).map(l=>c.interface.parseLog(l).name);assert.equal(names.at(-1),'Purchased');
 });
 it('blocks nested purchase even if the receiver already has enough ETH',async()=>{
  const first=await mint(),second=await mint();await(await c.connect(a).list(first,100n)).wait();await(await c.connect(a).list(second,100n)).wait();
  await(await a.sendTransaction({to:actor.target,value:100n})).wait();await configure(encode('buy',[second,a.address,100n]),'0x',100n);
  await(await invoke('buy',[first,a.address,100n],100n)).wait();assert.equal(await actor.callbackOK(),false);
  assert.equal((await actor.callbackResult()).slice(0,10),ethers.id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await c.ownerOf(second),a.address);assert.equal((await c.listings(second)).price,100n);assert.equal(await c.proceeds(a.address),100n);
 });
 it('failed withdrawal restores seller credit and permits retry; other sellers cannot take it',async()=>{
  const [v,s]=await voucher(actor.target);await(await invoke('mint',[v,s])).wait();const id=BigInt(v.weaponId);
  await(await invoke('list',[id,100n])).wait();await(await c.connect(b).buy(id,actor.target,100n,{value:100n})).wait();
  await configure('0x','0x',0n,false,true);await assert.rejects(invoke('withdraw'),/Payment failed/);
  assert.equal(await c.proceeds(actor.target),100n);assert.equal(await balance(),100n);await assert.rejects(c.connect(d).withdraw(),/No proceeds/);
  await configure('0x',encode('withdraw'));await(await invoke('withdraw')).wait();
  assert.equal(await actor.callbackOK(),false);assert.equal((await actor.callbackResult()).slice(0,10),ethers.id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await c.proceeds(actor.target),0n);assert.equal(await balance(),0n);assert.equal(await ethers.provider.getBalance(actor.target),100n);
 });
 it('accumulates exact proceeds across sales and pays only the entitled seller',async()=>{
  for(const price of [100n,201n]){const id=await mint();await(await c.connect(a).list(id,price)).wait();await(await c.connect(b).buy(id,a.address,price,{value:price})).wait();}
  const before=await ethers.provider.getBalance(a.address);const receipt=await(await c.connect(a).withdraw()).wait();
  assert.equal(await ethers.provider.getBalance(a.address),before+301n-receipt.fee);assert.equal(await balance(),0n);assert.equal(await c.proceeds(b.address),0n);
 });
});
