import{keychainState}from'./keychain.mjs';
import{spawn,execFileSync}from'node:child_process';import{existsSync,readFileSync,openSync,closeSync}from'node:fs';import{join}from'node:path';import{once}from'node:events';
import{projectRoot,root,readDeployment,writePrivateFile}from'./environment.mjs';import{ensureServices}from'./services.mjs';import{inspectRecordedService}from'../local-service-record.mjs';
await ensureServices();const d=readDeployment(),identity=join(projectRoot,'node_modules/vite/bin/vite.js');const valid=r=>inspectRecordedService({pid:r.pid,port:String(d.port),commandIdentity:identity},projectRoot).valid;
if(existsSync(d.recordPath)){const r=JSON.parse(readFileSync(d.recordPath));if(!valid(r))throw Error('Recorded daily service does not match; inspect before retry');keychainState('unlock');console.log(JSON.stringify({alreadyRunning:true,url:`http://127.0.0.1:${d.port}`}));}
else{
 keychainState('unlock');
 const environment={PATH:process.env.PATH,HOME:d.home,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG};
 execFileSync(process.execPath,[join(projectRoot,'scripts/prepare-runtime.mjs')],{cwd:projectRoot,env:environment,stdio:'pipe'});execFileSync(process.execPath,[join(projectRoot,'node_modules/typescript/bin/tsc'),'-p','tsconfig.local-app.json'],{cwd:projectRoot,env:environment,stdio:'pipe'});
 const log=openSync(d.logPath,'a',0o600),child=spawn(process.execPath,[identity,'--config','scripts/runtime/vite.config.mjs'],{cwd:projectRoot,env:environment,detached:true,stdio:['ignore',log,log]});await once(child,'spawn');closeSync(log);const record={pid:child.pid,port:d.port,projectRoot,deploymentFile:d.deploymentFile};let ready=false;
 for(let i=0;i<150;i++){if(valid(record)){ready=true;break;}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}if(!ready){child.kill();throw Error('Daily app failed; inspect '+d.logPath);}writePrivateFile(d.recordPath,JSON.stringify(record)+'\n',{exclusive:true});child.unref();console.log(JSON.stringify({started:true,url:`http://127.0.0.1:${d.port}`,runtimeRoot:root,database:d.database.database,supabaseRequired:false,n8nRequired:false}));
}
