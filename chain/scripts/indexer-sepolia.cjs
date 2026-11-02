// Read-only listener: no wallet key and no transaction submission.
const fs=require('node:fs'), path=require('node:path');
const {parseEnv}=require('node:util');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
try {
 const config=parseEnv(fs.readFileSync(path.join(root,'.env.sepolia'),'utf8'));
 const rpc=(config.SEPOLIA_RPC_URL||'').trim(), url=new URL(rpc);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error();
 const child=spawn(path.join(root,'.venv/bin/python'),['-m','chain.server.indexer',...process.argv.slice(2)],{
  cwd:root,stdio:'inherit',env:{...process.env,FORGE_RECHARGE_WEI_PER_UNIT:config.FORGE_RECHARGE_WEI_PER_UNIT||'10000000000000000',FORGE_RECHARGE_COINS_PER_UNIT:config.FORGE_RECHARGE_COINS_PER_UNIT||'10000',FORGE_NETWORK:'sepolia',FORGE_LOCAL_DIR:path.join(root,'.local/sepolia'),FORGE_RPC_URL:rpc,
   FORGE_INDEX_BATCH:config.FORGE_INDEX_BATCH||'500',
   FORGE_STAKING_COINS_PER_DAY:config.FORGE_STAKING_COINS_PER_DAY||'0'}
 });
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('exit',code=>{process.exitCode=code||0;});
 child.on('error',()=>{console.error('无法启动监听程序，请检查 Python 依赖。');process.exitCode=1;});
}catch{console.error('请检查 .env.sepolia 中的 Sepolia 节点配置。');process.exitCode=1;}
