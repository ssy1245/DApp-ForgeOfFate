// Reproducible verification using isolated databases, local chains and browser profiles.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const directory=path.join(root,'.local','test-runs',new Date().toISOString().replaceAll(':','-'));
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const suites=[
 ['contracts',['run','test:contracts']],
 ['backend',['run','test:backend']],
 ['deployment-service',['run','test:deploy:service']],
 ['transaction-client',['run','test:client']],
 ['i18n',['run','test:i18n','-w','frontend']],
 ['weapon-lore',['run','test:lore','-w','frontend']],
 ['build-and-models',['run','test:models','-w','frontend']],
 ['browser',['run','test:browser']],
 ['game-chain-integration',['run','verify:game']],
];
(async()=>{
 const results=[];
 for(const [name,args] of suites){
  console.log(`\nRunning ${name}`);
  const start=Date.now(),log=fs.createWriteStream(path.join(directory,name+'.log'),{mode:0o600});
  const child=spawn('npm',args,{cwd:root,stdio:['ignore','pipe','pipe']});
  for(const [stream,target] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{log.write(chunk);target.write(chunk);});
  const exitCode=await new Promise(resolve=>{child.once('error',error=>{log.write(error.message);resolve(-1);});child.once('close',code=>resolve(code??-1));});
  await new Promise(resolve=>log.end(resolve));
  results.push({name,command:'npm '+args.join(' '),exitCode,durationMs:Date.now()-start});
  fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({createdAt:new Date().toISOString(),results},null,2)+'\n',{mode:0o600});
 }
 console.log('\n'+results.map(r=>`${r.exitCode===0?'PASS':'FAIL'} ${r.name}`).join('\n'));
 console.log('Verification results: '+path.join(directory,'results.json'));
 process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
