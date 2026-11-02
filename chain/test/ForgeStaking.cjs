const assert=require('node:assert/strict');
const {ethers,network}=require('hardhat');
const fs=require('node:fs'),path=require('node:path'),solc=require('solc');
const source=fs.readFileSync(path.join(__dirname,'fixtures/MarketActor.sol'),'utf8');
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Actor.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode']}}}})));
const actorArtifact=compiled.contracts['Actor.sol'].MarketActor;
const types={Voucher:[{name:'weaponId',type:'bytes32'},{name:'recipient',type:'address'},{name:'level',type:'uint256'},{name:'uri',type:'string'},{name:'deadline',type:'uint256'},{name:'deploymentId',type:'bytes32'}]};
describe('ForgeStaking custody and replay boundaries',function(){
 let nft,staking,authority,a,b,epoch;
 beforeEach(async()=>{
  [authority,a,b]=await ethers.getSigners();epoch=ethers.hexlify(ethers.randomBytes(32));
  nft=await(await ethers.getContractFactory('ForgeOfFate')).deploy(authority.address,epoch);
  staking=await(await ethers.getContractFactory('ForgeStaking')).deploy(nft.target,epoch);
 });
 async function mint(recipient=a.address){
  const v={weaponId:ethers.hexlify(ethers.randomBytes(32)),recipient,level:50,uri:'data:application/json;base64,e30=',deadline:(await ethers.provider.getBlock('latest')).timestamp+600,deploymentId:epoch};
  const signature=await authority.signTypedData({name:'ForgeOfFate',version:'1',chainId:31337,verifyingContract:nft.target},types,v);
  if(recipient===a.address)await(await nft.connect(a).mint(v,signature)).wait();
  else {const actor=await ethers.getContractAt(actorArtifact.abi,recipient);await(await actor.invoke(nft.target,nft.interface.encodeFunctionData('mint',[v,signature]))).wait();}
  return BigInt(v.weaponId);
 }
 async function lock(token){await(await nft.connect(a).approve(staking.target,token)).wait();return (await staking.connect(a).stake(token)).wait();}
 function events(receipt){return receipt.logs.filter(l=>l.address.toLowerCase()===staking.target.toLowerCase()).map(l=>staking.interface.parseLog(l));}
 it('rejects missing collections and empty deployment identities',async()=>{
  const f=await ethers.getContractFactory('ForgeStaking');
  await assert.rejects(f.deploy(ethers.ZeroAddress,epoch),/Invalid collection/);
  await assert.rejects(f.deploy(a.address,epoch),/Invalid collection/);
  await assert.rejects(f.deploy(nft.target,ethers.ZeroHash),/Invalid deployment/);
 });
 it('requires ownership and approval; failed custody creates no position',async()=>{
  const token=await mint();
  await assert.rejects(staking.connect(b).stake(token),/Not owner/);
  await assert.rejects(staking.connect(a).stake(token),/ERC721InsufficientApproval/);
  assert.equal(await staking.nextPositionId(),1n);assert.equal(await staking.activePosition(token),0n);
  await nft.connect(a).approve(b.address,token);
  await assert.rejects(staking.connect(b).stake(token),/Not owner/);
 });
 it('records exact chain timestamps and clears a market listing when custody begins',async()=>{
  const token=await mint();await nft.connect(a).list(token,100n);
  const receipt=await lock(token), e=events(receipt)[0];
  assert.equal(e.name,'Staked');assert.equal(e.args.positionId,1n);assert.equal(e.args.staker,a.address);assert.equal(e.args.tokenId,token);
  assert.equal(e.args.startedAt,BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp));
  assert.equal(await nft.ownerOf(token),staking.target);assert.equal((await nft.listings(token)).price,0n);
  assert.equal((await staking.positions(1)).startedAt,e.args.startedAt);
  await assert.rejects(nft.connect(b).buy(token,a.address,100n,{value:100n}),/Listing changed/);
 });
 it('rejects repeated staking and simultaneous custody of the same NFT',async()=>{
  const token=await mint();await lock(token);
  await assert.rejects(staking.connect(a).stake(token),/Already staked/);
  await assert.rejects(staking.connect(b).stake(token),/Already staked/);
  assert.equal(await staking.nextPositionId(),2n);
 });
 it('only the staker can withdraw, without server approval; repeat withdrawal fails',async()=>{
  const token=await mint();await lock(token);
  await assert.rejects(staking.connect(b).unstake(1),/Not staker/);
  await assert.rejects(staking.connect(a).unstake(99),/Not staker/);
  await network.provider.send('evm_increaseTime',[2*86400+43200]);
  const receipt=await(await staking.connect(a).unstake(1)).wait(), e=events(receipt)[0];
  assert.equal(e.name,'Unstaked');assert.equal(e.args.endedAt,BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp));
  assert.equal(await nft.ownerOf(token),a.address);assert.equal(await staking.activePosition(token),0n);
  await assert.rejects(staking.connect(a).unstake(1),/Already withdrawn/);
 });
 it('restaking creates a fresh position and cannot reopen old rewards',async()=>{
  const token=await mint();await lock(token);await staking.connect(a).unstake(1);await lock(token);
  assert.equal(await staking.activePosition(token),2n);assert.equal(await staking.nextPositionId(),3n);
  assert.notEqual((await staking.positions(1)).endedAt,0n);assert.equal((await staking.positions(2)).endedAt,0n);
  await assert.rejects(staking.connect(a).unstake(1),/Already withdrawn/);
  assert.equal(await nft.ownerOf(token),staking.target);
 });
 it('withdrawing one NFT leaves other positions intact; restaking uses a new ID',async()=>{
  const first=await mint(),second=await mint();await lock(first);await lock(second);
  await staking.connect(a).unstake(1);
  assert.equal(await nft.ownerOf(first),a.address);assert.equal(await staking.activePosition(first),0n);
  assert.equal(await nft.ownerOf(second),staking.target);assert.equal(await staking.activePosition(second),2n);
  assert.equal((await staking.positions(2)).endedAt,0n);
  await lock(first);assert.equal(await staking.activePosition(first),3n);
  await assert.rejects(staking.connect(a).unstake(1),/Already withdrawn/);
  await assert.rejects(staking.connect(b).unstake(2),/Not staker/);
  assert.equal(await nft.ownerOf(first),staking.target);assert.equal(await nft.ownerOf(second),staking.target);
 });
 it('a purchase between approval and staking invalidates the seller and requires fresh buyer approval',async()=>{
  const token=await mint();await nft.connect(a).approve(staking.target,token);await nft.connect(a).list(token,100n);
  await nft.connect(b).buy(token,a.address,100n,{value:100n});
  await assert.rejects(staking.connect(a).stake(token),/Not owner/);
  await assert.rejects(staking.connect(b).stake(token),/ERC721InsufficientApproval/);
  assert.equal(await staking.nextPositionId(),1n);assert.equal(await staking.activePosition(token),0n);
  await nft.connect(b).approve(staking.target,token);await staking.connect(b).stake(token);
  assert.equal((await staking.positions(1)).staker,b.address);
  await assert.rejects(staking.connect(a).unstake(1),/Not staker/);
  await staking.connect(b).unstake(1);assert.equal(await nft.ownerOf(token),b.address);
 });
 it('rejects unsolicited safe transfers and fake receiver calls',async()=>{
  const token=await mint();
  await assert.rejects(nft.connect(a)['safeTransferFrom(address,address,uint256)'](a.address,staking.target,token),/Unexpected NFT/);
  await assert.rejects(staking.onERC721Received(staking.target,a.address,token,'0x'),/Unexpected NFT/);
  assert.equal(await nft.ownerOf(token),a.address);assert.equal(await staking.nextPositionId(),1n);
 });
 it('an unsafe direct transfer never becomes an eligible stake',async()=>{
  const token=await mint();await nft.connect(a).transferFrom(a.address,staking.target,token);
  assert.equal(await staking.activePosition(token),0n);assert.equal(await staking.nextPositionId(),1n);
  await assert.rejects(staking.connect(a).stake(token),/Not owner/);
 });
 it('rejecting receivers roll back withdrawals; reentrancy cannot stake or withdraw twice',async()=>{
  const actor=await new ethers.ContractFactory(actorArtifact.abi,actorArtifact.evm.bytecode.object,a).deploy();
  const token=await mint(actor.target);
  const call=async(contract,fn,args)=>actor.invoke(contract.target,contract.interface.encodeFunctionData(fn,args));
  await call(nft,'approve',[staking.target,token]);await call(staking,'stake',[token]);
  await actor.configure(staking.target,'0x','0x',0,true,false);
  await assert.rejects(call(staking,'unstake',[1]),/NFT rejected/);
  assert.equal((await staking.positions(1)).endedAt,0n);assert.equal(await staking.activePosition(token),1n);
  assert.equal(await nft.ownerOf(token),staking.target);
  await actor.configure(staking.target,staking.interface.encodeFunctionData('unstake',[1]),'0x',0,false,false);
  await call(staking,'unstake',[1]);assert.equal(await actor.callbackOK(),false);
  assert.equal(await nft.ownerOf(token),actor.target);
  await call(nft,'approve',[staking.target,token]);await call(staking,'stake',[token]);
  await actor.configure(staking.target,staking.interface.encodeFunctionData('stake',[token]),'0x',0,false,false);
  await call(staking,'unstake',[2]);assert.equal(await actor.callbackOK(),false);
  assert.equal(await staking.nextPositionId(),3n);
 });
});
