const hre=require('hardhat'); const fs=require('node:fs'); const path=require('node:path');
async function main(){
 const dir=path.resolve(__dirname,'../../.local'); fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const keyPath=path.join(dir,'mint-key');
 if(!fs.existsSync(keyPath)) fs.writeFileSync(keyPath,hre.ethers.Wallet.createRandom().privateKey,{mode:0o600});
 const authority=new hre.ethers.Wallet(fs.readFileSync(keyPath,'utf8').trim());
 const epoch=hre.ethers.hexlify(hre.ethers.randomBytes(32));
 const contract=await (await hre.ethers.getContractFactory('ForgeOfFate')).deploy(authority.address,epoch); await contract.waitForDeployment();
 const artifact=await hre.artifacts.readArtifact('ForgeOfFate');
 const info={address:await contract.getAddress(),chainId:31337,deploymentId:epoch,mintSigner:authority.address,abi:artifact.abi};
 fs.writeFileSync(path.join(dir,'deployment.json'),JSON.stringify(info,null,2));
 console.log('Forge of Fate deployed:',info.address,'— local configuration saved. Restart backend after redeployment.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
