const assert=require('node:assert/strict');
const {ethers}=require('hardhat');
describe('ForgeRecharge test ETH receipts',function(){
 let recharge,treasury,a,b,epoch;
 beforeEach(async()=>{[treasury,a,b]=await ethers.getSigners();epoch=ethers.hexlify(ethers.randomBytes(32));recharge=await(await ethers.getContractFactory('ForgeRecharge')).deploy(treasury.address,epoch);});
 it('pins deployment and treasury; rejects zero identities',async()=>{
  assert.equal(await recharge.treasury(),treasury.address);assert.equal(await recharge.deploymentId(),epoch);
  const f=await ethers.getContractFactory('ForgeRecharge');
  await assert.rejects(f.deploy(ethers.ZeroAddress,epoch),/Invalid treasury/);
  await assert.rejects(f.deploy(treasury.address,ethers.ZeroHash),/Invalid deployment/);
 });
 it('records actual payment and payer with unique IDs, independent of any exchange rate',async()=>{
  for(const [i,who,amount] of [[1,a,ethers.parseEther('0.01')],[2,b,1n],[3,a,ethers.parseEther('0.005')]]){
   const receipt=await(await recharge.connect(who).deposit({value:amount})).wait();
   const event=recharge.interface.parseLog(receipt.logs[0]);
   assert.equal(event.name,'Deposited');assert.equal(event.args.depositId,BigInt(i));assert.equal(event.args.payer,who.address);assert.equal(event.args.amount,amount);
  }
  assert.equal(await recharge.nextDepositId(),4n);
  assert.equal(await ethers.provider.getBalance(recharge.target),ethers.parseEther('0.015')+1n);
 });
 it('rejects empty and plain transfers without consuming a deposit ID',async()=>{
  await assert.rejects(recharge.connect(a).deposit(),/Empty deposit/);
  await assert.rejects(a.sendTransaction({to:recharge.target,value:1n}));
  assert.equal(await recharge.nextDepositId(),1n);assert.equal(await ethers.provider.getBalance(recharge.target),0n);
 });
 it('only admins withdraw; withdrawals never emit a recharge receipt',async()=>{
  await recharge.connect(a).deposit({value:100n});
  await assert.rejects(recharge.connect(a).withdraw(1),/Not admin/);
  await assert.rejects(recharge.withdraw(0),/Invalid amount/);await assert.rejects(recharge.withdraw(101),/Invalid amount/);
  const receipt=await(await recharge.withdraw(100)).wait();
  assert.deepEqual(receipt.logs.map(l=>recharge.interface.parseLog(l).name),['Withdrawn']);
  assert.equal(await recharge.nextDepositId(),2n);assert.equal(await ethers.provider.getBalance(recharge.target),0n);
  await assert.rejects(recharge.withdraw(100),/Invalid amount/);
 });
 it('treasury alone grants roles; delegated withdrawals always pay the fixed treasury',async()=>{
  assert.equal(await recharge.isAdmin(treasury.address),true);
  assert.deepEqual([...await recharge.getAdmins()],[treasury.address]);
  await assert.rejects(recharge.connect(a).addAdmin(a.address),/Not treasury/);
  const receipt=await(await recharge.addAdmin(a.address)).wait();
  const event=recharge.interface.parseLog(receipt.logs[0]);
  assert.equal(event.name,'AdminAdded');assert.equal(event.args.admin,a.address);assert.equal(event.args.operator,treasury.address);
  await assert.rejects(recharge.connect(a).addAdmin(b.address),/Not treasury/);
  await assert.rejects(recharge.connect(a).removeAdmin(treasury.address),/Not treasury/);
  await recharge.connect(b).deposit({value:100n});
  const before=await ethers.provider.getBalance(treasury.address);
  await(await recharge.connect(a).withdraw(40)).wait();
  assert.equal(await ethers.provider.getBalance(treasury.address),before+40n);
  assert.equal(await ethers.provider.getBalance(recharge.target),60n);
  assert.equal(await recharge.nextDepositId(),2n);
 });
 it('revocation blocks an already prepared withdrawal, supports re-add, and leaves other admins intact',async()=>{
  await recharge.addAdmin(a.address);await recharge.addAdmin(b.address);await recharge.deposit({value:100n});
  const prepared=await recharge.connect(a).withdraw.populateTransaction(10);
  const receipt=await(await recharge.removeAdmin(a.address)).wait();
  const event=recharge.interface.parseLog(receipt.logs[0]);
  assert.equal(event.name,'AdminRemoved');assert.equal(event.args.admin,a.address);assert.equal(event.args.operator,treasury.address);
  await assert.rejects(a.sendTransaction(prepared),/Not admin/);
  assert.equal(await recharge.isAdmin(a.address),false);assert.equal(await recharge.isAdmin(b.address),true);
  assert.deepEqual([...await recharge.getAdmins()],[treasury.address,b.address]);
  await assert.rejects(recharge.removeAdmin(a.address),/Not admin/);
  await recharge.addAdmin(a.address);await(await recharge.connect(a).withdraw(10)).wait();
  assert.equal((await recharge.getAdmins()).length,3);
  assert.equal(await ethers.provider.getBalance(recharge.target),90n);
 });
 it('rejects zero/self/duplicate admins and cannot remove root',async()=>{
  for(const address of [ethers.ZeroAddress,recharge.target])await assert.rejects(recharge.addAdmin(address),/Invalid admin/);
  await assert.rejects(recharge.addAdmin(treasury.address),/Already admin/);
  await assert.rejects(recharge.removeAdmin(treasury.address),/Cannot remove treasury/);
  await assert.rejects(recharge.removeAdmin(b.address),/Not admin/);
  await recharge.addAdmin(a.address);await assert.rejects(recharge.addAdmin(a.address),/Already admin/);
  assert.equal(await recharge.nextDepositId(),1n);
 });
 it('bounds the admin list and frees a slot after revocation',async()=>{
  const admins=Array.from({length:31},()=>ethers.Wallet.createRandom().address);
  for(const address of admins)await recharge.addAdmin(address);
  assert.equal((await recharge.getAdmins()).length,32);
  await assert.rejects(recharge.addAdmin(a.address),/Admin limit/);
  await recharge.removeAdmin(admins[15]);await recharge.addAdmin(a.address);
  const list=[...await recharge.getAdmins()];assert.equal(list.length,32);assert.equal(new Set(list).size,32);
  assert.ok(!list.includes(admins[15]));assert.ok(list.includes(treasury.address));
 });
});
