import{readPreparedRuntimeRelease}from'../../src/orchestration/runtimeBuild.ts';
import{keychainState}from'./keychain.mjs';
import{loadHarnessProductionEnvironment}from'./harness-production-config.mjs';
import{spawn,execFileSync}from'node:child_process';import{existsSync,readFileSync,renameSync,openSync,closeSync,constants}from'node:fs';import{join}from'node:path';import{once}from'node:events';
import{projectRoot,readDeployment,writePrivateFile}from'./environment.mjs';import{ensureServices}from'./services.mjs';import{inspectRecordedService}from'../local-service-record.mjs';
const expectedRelease=process.env.LOOP_EXPECTED_RUNTIME_RELEASE;
if(expectedRelease!==undefined&&!/^[a-f0-9]{64}$/.test(expectedRelease))throw Error('Invalid expected runtime release');
const productionEnvironment=await loadHarnessProductionEnvironment({runtimeRoot:join(projectRoot,'.loop-control/local')});
keychainState('unlock');await ensureServices();const d=readDeployment(),identity=join(projectRoot,'node_modules/vite/bin/vite.js');const valid=r=>inspectRecordedService({pid:r.pid,port:String(d.port),commandIdentity:identity},projectRoot).valid;
let running=existsSync(d.recordPath)?JSON.parse(readFileSync(d.recordPath)):null;
if(running&&!valid(running)){
 let exited=false;try{process.kill(running.pid,0);}catch(error){if(error.code==='ESRCH')exited=true;else throw error;}
 if(!exited)throw Error('Recorded daily service does not match; inspect before retry');
 renameSync(d.recordPath,d.recordPath+'.stale-'+Date.now());running=null;
}
if(running){if(expectedRelease&&running.runtimeRelease?.id!==expectedRelease)throw Error('Running runtime differs from expected release');keychainState('unlock');console.log(`本地服务已在运行，访问地址：http://127.0.0.1:${d.port}`);}
else{
 keychainState('unlock');
 const environment={PATH:process.env.PATH,HOME:d.home,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG};
 execFileSync(process.execPath,[join(projectRoot,'scripts/prepare-runtime.mjs')],{cwd:projectRoot,env:environment,stdio:'pipe'});
 const runtimeRelease=await readPreparedRuntimeRelease(projectRoot);if(expectedRelease&&runtimeRelease.id!==expectedRelease)throw Error('Prepared runtime differs from expected release');environment.LOOP_RUNTIME_RELEASE=JSON.stringify(runtimeRelease);
 environment.LOOP_RUNTIME_LOG_PATH=d.logPath;
 for(const key of ['LOOP_HARNESS_HANDOFF_ROOT','LOOP_HARNESS_HANDOFF_OWNER_ID'])if(process.env[key]!==undefined)environment[key]=process.env[key];
 Object.assign(environment,productionEnvironment);
 const log=openSync(d.logPath,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600),child=spawn(process.execPath,[identity,'--config','scripts/runtime/vite.config.mjs'],{cwd:projectRoot,env:environment,detached:true,stdio:['ignore',log,log]});await once(child,'spawn');closeSync(log);const record={pid:child.pid,port:d.port,projectRoot,deploymentFile:d.deploymentFile,runtimeRelease,logPath:d.logPath};let ready=false;
 for(let i=0;i<150;i++){if(valid(record)){ready=true;break;}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}if(!ready){child.kill();throw Error('Daily app failed; inspect '+d.logPath);}writePrivateFile(d.recordPath,JSON.stringify(record)+'\n',{exclusive:true});child.unref();console.log(`本地服务启动成功，访问地址：http://127.0.0.1:${d.port}`);
}
