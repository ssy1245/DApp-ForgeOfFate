// Ephemeral local accounts and database only. No Sepolia RPC or wallet secrets.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {ethers}=require('ethers');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-recharge-'));
let node,provider;
async function main(){
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 node=spawn(process.execPath,[require.resolve('hardhat/internal/cli/cli.js'),'node','--hostname','127.0.0.1','--port',String(port)],{cwd:path.join(root,'chain'),stdio:'ignore'});
 const url=`http://127.0.0.1:${port}`;provider=new ethers.JsonRpcProvider(url,31337,{staticNetwork:true});
 let connected=false;
 for(let i=0;i<100;i++){try{await provider.getBlockNumber();connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!connected)throw Error('Isolated node did not start');
 const treasury=await provider.getSigner(0),user=await provider.getSigner(1),delegate=await provider.getSigner(2);
 const artifact=JSON.parse(fs.readFileSync(path.join(root,'chain/artifacts/contracts/ForgeRecharge.sol/ForgeRecharge.json')));
 const epoch=ethers.hexlify(ethers.randomBytes(32));
 const recharge=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,treasury).deploy(await treasury.getAddress(),epoch);await recharge.waitForDeployment();
 const r=await recharge.deploymentTransaction().wait();
 fs.writeFileSync(path.join(dir,'recharge-deployment.json'),JSON.stringify({manifestVersion:2,module:'forge-recharge',address:recharge.target,chainId:31337,deploymentId:epoch,treasury:await treasury.getAddress(),abi:artifact.abi,
  deploymentTransaction:r.hash,deploymentBlock:r.blockNumber,deploymentBlockHash:r.blockHash,genesisHash:(await provider.getBlock(0)).hash,runtimeCodeHash:ethers.keccak256(await provider.getCode(recharge.target))}));
 const env={...process.env,FORGE_NETWORK:'local',FORGE_LOCAL_DIR:dir,FORGE_RPC_URL:url,FORGE_RECHARGE_WEI_PER_UNIT:'10000000000000000',FORGE_RECHARGE_COINS_PER_UNIT:'10000',REHEARSAL_WALLET:await user.getAddress(),REHEARSAL_ADMIN:await delegate.getAddress()};
 function check(stage){
  const result=spawnSync(path.join(root,'.venv/bin/python'),[path.join(root,'chain/tests/check_recharge_rehearsal.py'),stage],{cwd:root,env,encoding:'utf8',timeout:30000});
  if(result.status!==0)throw Error(`Recharge rehearsal ${stage} failed: ${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
 }
 await(await recharge.addAdmin(await delegate.getAddress())).wait();
 await(await recharge.connect(user).deposit({value:ethers.parseEther('0.01')})).wait();check('before');
 // Listener is stopped for three actual transactions. A fresh process must catch them up.
 for(const value of [ethers.parseEther('0.005'),500000000000n,500000000000n])await(await recharge.connect(user).deposit({value})).wait();
 const beforeBlock=Number(BigInt(await provider.send('eth_blockNumber',[])));
 const before=await provider.getBalance(await treasury.getAddress(),beforeBlock);
 const withdrawn=await(await recharge.connect(delegate).withdraw(ethers.parseEther('0.015001'))).wait();
 if(await provider.getBalance(await treasury.getAddress(),withdrawn.blockNumber)!==before+ethers.parseEther('0.015001'))throw Error('Withdrawal did not reach fixed treasury');
 await(await recharge.removeAdmin(await delegate.getAddress())).wait();
 let denied=false;try{await recharge.connect(delegate).withdraw.staticCall(1);}catch{denied=true;}
 if(!denied)throw Error('Revoked delegate still has withdrawal access');
 check('after');
 await(await recharge.addAdmin(await delegate.getAddress())).wait();check('restart');
 console.log('PASS: delegated withdrawal → fixed treasury → revocation → re-add; local RPC catch-up/restart still exactly 15001 coins, no admin-change or withdrawal credit.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
 provider?.destroy();
 if(node){node.kill('SIGTERM');await new Promise(resolve=>{if(node.exitCode!==null)return resolve();node.once('exit',resolve);setTimeout(()=>{node.kill('SIGKILL');resolve();},3000).unref();});}
 fs.rmSync(dir,{recursive:true,force:true});
});
