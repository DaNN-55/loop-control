import{execFileSync}from'node:child_process';
import{existsSync,readFileSync}from'node:fs';
import{join}from'node:path';
import{performance}from'node:perf_hooks';
import{root,env,writePrivateFile}from'./environment.mjs';
import{readDeployment,deploymentFile}from'./deployment.mjs';
import{inspectOfflineAssets,assertOfflinePrepared,preparationFiles}from'./offline-preparation.mjs';
const selected=deploymentFile();if(!selected)throw Error('Pass --deployment with an approved private file');
const d=readDeployment(selected),{receipt}=preparationFiles(d),save=r=>writePrivateFile(receipt,JSON.stringify(r,null,2)+'\n');
const pointer=join(root,'default-deployment.json');
if(process.argv.includes('--set-default')){
 if(existsSync(pointer))throw Error('Default pointer already exists; inspect before changing selection');
 for(const file of[join(root,'state/app.json'),d.recordPath])if(existsSync(file)){
  const r=JSON.parse(readFileSync(file));if(!Number.isSafeInteger(r.pid)||r.pid<=1)throw Error('Invalid service record; inspect before changing selection');
  try{process.kill(r.pid,0);throw Error('Recorded service is alive; stop before changing selection');}catch(e){if(e.code!=='ESRCH')throw e;}
 }
}
save({version:1,passed:false,phase:'preparing'});
try{
 const{manifest,identity}=await inspectOfflineAssets(d);
 execFileSync(process.execPath,[join(d.projectRoot,'scripts/prepare-runtime.mjs')],{cwd:d.projectRoot,env,stdio:'pipe'});
 execFileSync(process.execPath,[join(d.projectRoot,'node_modules/typescript/bin/tsc'),'-p','tsconfig.local-app.json'],{cwd:d.projectRoot,env,stdio:'pipe'});
 const{alignmentEnvironment,assertAlignmentReady}=await import('../../dist/local-app/local-app/alignmentWorker.js');
 const{assertMediaReady}=await import('../../dist/local-app/local-app/mediaWorker.js');
 if(d.worker?.media)await assertMediaReady(d.worker.media,d.openChatCut?{a_roll:{execution_path:'local',executor:{provider:'openchatcut'}}}:{},{PATH:env.PATH,HOME:d.home,...(d.openChatCut?{OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node}:{})});
 const c=d.worker?.alignment;if(!c)throw Error('Alignment configuration required for this offline deployment');
 const began=performance.now(),raw=execFileSync(c.python,[join(d.projectRoot,'scripts/local/initialize-whisperx.py')],{env:alignmentEnvironment(c.cacheDirectory),timeout:120000,maxBuffer:65536,encoding:'utf8'});
 const runtime=JSON.parse(raw.trim().split('\n').at(-1));
 if(runtime.python!==manifest.python||manifest.packages.some(p=>runtime.packages[p.name.toLowerCase().replaceAll('_','-')]!==p.version))throw Error('Offline Python package versions differ');
 const initializationMs=performance.now()-began,probe=performance.now();await assertAlignmentReady(d.projectRoot,d.mediaRoot,c,manifest.model);
 save({version:1,passed:true,preparedAt:new Date().toISOString(),identity,localMediaDependenciesChecked:Boolean(d.worker?.media),initializationMs,initializationSafetyLimitMs:120000,modelProbeMs:performance.now()-probe,modelProbeTimeoutMs:30000,downloads:0,onlineProviderRequests:0});
 if(process.argv.includes('--set-default')){
  await assertOfflinePrepared(d);
  writePrivateFile(pointer,JSON.stringify({version:1,deploymentFile:selected})+'\n',{exclusive:true});
 }
 console.log(JSON.stringify({passed:true,downloads:0,modelProbeTimeoutMs:30000,defaultSelected:process.argv.includes('--set-default')}));
}catch(error){save({version:1,passed:false,phase:'failed'});throw error;}
