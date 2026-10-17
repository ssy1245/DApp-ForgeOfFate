// Local orchestration only. All owned child processes stop on Ctrl+C.
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');const {JsonRpcProvider,Contract}=require('ethers');
process.env.HARDHAT_DISABLE_TELEMETRY_PROMPT='true';
const root=path.resolve(__dirname,'..');process.chdir(root);fs.mkdirSync('.local',{recursive:true,mode:0o700});
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children){try{process.kill(-child.pid,'SIGTERM');}catch{}}process.exitCode=code;setTimeout(()=>process.exit(code),150);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
function launch(args,name,env={}){const fd=fs.openSync(`.local/${name}.log`,'a',0o600);const child=spawn('npm',args,{cwd:root,env:{...process.env,...env},stdio:['ignore',fd,fd],detached:true});fs.closeSync(fd);children.push(child);child.on('error',e=>{console.error(`${name}: ${e.message}`);stop(1);});child.on('exit',code=>{if(!stopping){console.error(`${name} stopped (${code}). See .local/${name}.log`);stop(1);}});return child;}
async function available(url){try{return(await fetch(url,{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
async function waitFor(fn,name){for(let i=0;i<45;i++){if(stopping)throw Error('Startup cancelled');if(await fn())return;await new Promise(r=>setTimeout(r,500));}throw Error(`${name} did not start. See .local logs.`);}
function command(args){return new Promise((resolve,reject)=>{const child=spawn('npm',args,{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Command exited ${code}`)));});}
async function main(){
 const rpc=new JsonRpcProvider('http://127.0.0.1:8545',31337,{staticNetwork:true});
 async function liveChain(){try{return(await rpc.send('eth_chainId',[]))==='0x7a69';}catch{return false;}}
 if(!await liveChain()){console.log('Starting local test chain…');launch(['run','chain'],'chain');await waitFor(liveChain,'Test chain');}
 let deployed=false;try{const info=JSON.parse(fs.readFileSync('.local/deployment.json','utf8'));const c=new Contract(info.address,info.abi,rpc);deployed=(await c.deploymentId())===info.deploymentId;}catch{}
 if(!deployed)await command(['run','deploy']);
 if(!await available('http://127.0.0.1:8000/api/health')){launch(['run','backend'],'backend',{DEMO_MODE:process.argv.includes('--demo')?'1':'0'});await waitFor(()=>available('http://127.0.0.1:8000/api/health'),'Backend');}
 const cfg=await(await fetch('http://127.0.0.1:8000/api/config')).json();if(!cfg.chain)throw Error(cfg.chain_error);
 if(!await available('http://127.0.0.1:5173/')){launch(['run','dev'],'frontend');await waitFor(()=>available('http://127.0.0.1:5173/'),'Frontend');}
 console.log(`\nForge of Fate ready: http://127.0.0.1:5173/\nDEMO mode: ${cfg.demo_mode?'enabled':'disabled'}\nPress Ctrl+C to stop processes started by this command. Existing services are reused.`);
 if(process.argv.includes('--demo')&&!cfg.demo_mode)console.log('An existing backend has DEMO disabled. Stop that backend and restart this command to enable it.');
 setInterval(()=>{},60000);
}
main().catch(e=>{console.error(e.message);stop(1);});
