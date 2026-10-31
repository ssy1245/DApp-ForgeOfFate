// Isolated local rehearsal: ephemeral node/data, no user wallets, no public-chain transactions.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {ethers}=require('ethers');
const root=path.resolve(__dirname,'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-staking-'));
let node,provider;
async function main(){
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 node=spawn(process.execPath,[require.resolve('hardhat/internal/cli/cli.js'),'node','--hostname','127.0.0.1','--port',String(port)],{cwd:path.join(root,'chain'),stdio:'ignore'});
 const url=`http://127.0.0.1:${port}`;
 provider=new ethers.JsonRpcProvider(url,31337,{staticNetwork:true});
 let connected=false;
 for(let i=0;i<100;i++){try{await provider.getBlockNumber();connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!connected)throw Error('Isolated node did not start');
 const authority=await provider.getSigner(0),user=await provider.getSigner(1);
 const nftArtifact=JSON.parse(fs.readFileSync(path.join(root,'chain/artifacts/contracts/ForgeOfFate.sol/ForgeOfFate.json')));
 const stakeArtifact=JSON.parse(fs.readFileSync(path.join(root,'chain/artifacts/contracts/ForgeStaking.sol/ForgeStaking.json')));
 const nftEpoch=ethers.hexlify(ethers.randomBytes(32)),stakeEpoch=ethers.hexlify(ethers.randomBytes(32));
 const nft=await new ethers.ContractFactory(nftArtifact.abi,nftArtifact.bytecode,authority).deploy(await authority.getAddress(),nftEpoch);await nft.waitForDeployment();
 const stake=await new ethers.ContractFactory(stakeArtifact.abi,stakeArtifact.bytecode,authority).deploy(nft.target,stakeEpoch);await stake.waitForDeployment();
 async function manifest(contract,epoch,abi,extra){const r=await contract.deploymentTransaction().wait();return {manifestVersion:2,address:contract.target,chainId:31337,deploymentId:epoch,abi,
  deploymentTransaction:r.hash,deploymentBlock:r.blockNumber,deploymentBlockHash:r.blockHash,genesisHash:(await provider.getBlock(0)).hash,runtimeCodeHash:ethers.keccak256(await provider.getCode(contract.target)),...extra};}
 fs.writeFileSync(path.join(dir,'deployment.json'),JSON.stringify(await manifest(nft,nftEpoch,nftArtifact.abi,{mintSigner:await authority.getAddress()})));
 fs.writeFileSync(path.join(dir,'staking-deployment.json'),JSON.stringify(await manifest(stake,stakeEpoch,stakeArtifact.abi,{nftAddress:nft.target,nftDeploymentId:nftEpoch})));
 const types={Voucher:[{name:'weaponId',type:'bytes32'},{name:'recipient',type:'address'},{name:'level',type:'uint256'},{name:'uri',type:'string'},{name:'deadline',type:'uint256'},{name:'deploymentId',type:'bytes32'}]};
 const current=await provider.getBlock('latest');
 const v={weaponId:ethers.hexlify(ethers.randomBytes(32)),recipient:await user.getAddress(),level:50,uri:'data:application/json;base64,e30=',deadline:current.timestamp+600,deploymentId:nftEpoch};
 const sig=await authority.signTypedData({name:'ForgeOfFate',version:'1',chainId:31337,verifyingContract:nft.target},types,v);
 await(await nft.connect(user).mint(v,sig)).wait();const token=BigInt(v.weaponId);
 await(await nft.connect(user).approve(stake.target,token)).wait();
 const start=Math.floor(current.timestamp/86400)*86400+86400+43200;
 await provider.send('evm_setNextBlockTimestamp',[start]);await(await stake.connect(user).stake(token)).wait();
 const env={...process.env,FORGE_NETWORK:'local',FORGE_LOCAL_DIR:dir,FORGE_RPC_URL:url,FORGE_STAKING_COINS_PER_DAY:'100',REHEARSAL_WALLET:await user.getAddress()};
 function check(stage){
  const result=spawnSync(path.join(root,'.venv/bin/python'),[path.join(root,'chain/tests/check_staking_rehearsal.py'),stage],{cwd:root,env,encoding:'utf8',timeout:30000});
  if(result.status!==0)throw Error(`Staking rehearsal ${stage} failed: ${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
 }
 check('before'); // Listener stops here; withdrawal happens while it is offline.
 await provider.send('evm_setNextBlockTimestamp',[start+2*86400]);await(await stake.connect(user).unstake(1)).wait();
 if(await nft.ownerOf(token)!==await user.getAddress())throw Error('Withdrawal ownership mismatch');
 await provider.send('evm_setNextBlockTimestamp',[start+4*86400]);await provider.send('evm_mine',[]);
 check('after');check('restart');
 console.log('PASS: actual local contracts → RPC listener → downtime catch-up → daily mailbox → claim/retry; total 200 coins.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
 if(provider)provider.destroy();
 if(node){node.kill('SIGTERM');await new Promise(resolve=>{if(node.exitCode!==null)return resolve();node.once('exit',resolve);setTimeout(()=>{node.kill('SIGKILL');resolve();},3000).unref();});}
 fs.rmSync(dir,{recursive:true,force:true});
});
