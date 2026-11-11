import{readPreparedRuntimeRelease,assertRuntimeRelease}from'../../src/orchestration/runtimeBuild.ts';
import{pathToFileURL}from'node:url';
import{createLogStorage}from'./log-storage.mjs';
import{execFile}from'node:child_process';
import{promisify}from'node:util';

import {mediaRootWorkerSettings,persistMediaRootDeployment,readMediaRootAuthorization,readPendingMediaRootDeployment,recoverMediaRootDeployment,migrationProofQuery,verifyMediaRootMigrationProof,mediaRootPendingPath} from './media-root.mjs';





import{appendFileSync}from'node:fs';import{unlink}from'node:fs/promises';import{join}from'node:path';

export async function createNativeApplication(d){
 const runtimeRelease=d.runtimeRelease??(process.env.LOOP_RUNTIME_RELEASE?JSON.parse(process.env.LOOP_RUNTIME_RELEASE):await readPreparedRuntimeRelease(d.projectRoot));
 await assertRuntimeRelease(d.projectRoot,runtimeRelease);d={...d,runtimeRelease};
 const load=path=>import(pathToFileURL(join(runtimeRelease.root,'dist/local-app',path)).href);
 const {LocalMediaRootSettings,inspectMediaRoot,verifyMediaRootBinding}=await load('local-app/mediaRootSettings.js');
 const {SecretAdministration}=await load('local-app/secretAdministration.js');
 const {createRuntimeStatusReader}=await load('local-app/runtimeStatus.js');
 const {configuredKeychainStore}=await load('local-app/keychainStore.js');
 const {createPexelsLiveProbe}=await load('local-app/pexelsLiveProbe.js');
 const {createProviderProbe}=await load('local-app/providerProbe.js');
 const {LocalAccountCommands}=await load('local-app/accountCommands.js');
 const {createLocalDatabase}=await load('local-app/catalog.js');
 const {createLocalHandler}=await load('local-app/localRoute.js');
 const {readRuntimeLogs}=await load('local-app/runtimeLogs.js');
 const {readMediaDeployment}=await load('local-app/mediaDeployment.js');
 const {startNativeWorkerService}=await load('local-app/localWorkerService.js');
 const {LocalEpisodeCommands}=await load('local-app/episodeCommands.js');
 const {LocalConnections}=await load('local-app/connections.js');
 const {startNativeAutomation}=await load('local-app/nativeAutomation.js');
 const {nativeBackup}=await load('local-app/nativeBackup.js');

 const pending=readPendingMediaRootDeployment(d);
 if(pending){const recovery=createLocalDatabase(d.database);try{const state=(await recovery.query("SELECT local_identity.media_root_binding() binding,coalesce(nullif(current_setting('loop.restore_state',true),''),'ready') restore_state")).rows[0];const proof=pending.publication?.operation==='migration'?(await recovery.query(migrationProofQuery(pending.publication))).rows[0].media_root_publication_proof:undefined;d=recoverMediaRootDeployment(d,state.binding,{restoreState:state.restore_state,migrationProof:proof});}finally{await recovery.end();}}
 let current,active=d,closed=false,paused=false,previousPending;const requests=new Set();
 const finish=async migration=>{const pool=createLocalDatabase(active.database);try{const row=(await pool.query(migrationProofQuery(migration))).rows[0].media_root_publication_proof;verifyMediaRootMigrationProof(row,migration);await pool.query('SELECT local_identity.finish_media_root_migration($1,$2)',[migration.planId,migration.manifestSha256]);await unlink(mediaRootPendingPath(active)).catch(e=>{if(e.code!=='ENOENT')throw e;});}finally{await pool.end();}};
 const quiesce=async()=>{if(paused)throw Error('Storage operation already in progress');paused=true;const waiting=[...requests];let timer;try{await Promise.race([Promise.all(waiting),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Active requests must finish before migration')),30000);})]);}catch(error){paused=false;throw error;}finally{clearTimeout(timer);}};
 const releaseQuiescence=()=>{paused=false;};
 const activate=async(binding,migration)=>{
  if(closed)throw Error('Native application is closing');
  if(active.mediaRoot!==binding.path){
   const next={...active,mediaRoot:binding.path,mediaRootBinding:binding,worker:await mediaRootWorkerSettings(active,binding)};
   const replacement=await createNativeInstance(next,activate,{quiesce,releaseQuiescence,resumeMigration});
   if(closed){await replacement.close();throw Error('Native application is closing');}
   previousPending=current;current=replacement;active=next;
  }
  if(previousPending){await previousPending.close();previousPending=undefined;}
  if(migration)await finish(migration);
 };
 const resumeMigration=async(id,sha)=>{const pool=createLocalDatabase(active.database);let row;try{row=(await pool.query('SELECT local_identity.media_root_publication_proof($1,$2) proof',[id,sha])).rows[0].proof;verifyMediaRootMigrationProof(row,{planId:id,manifestSha256:sha});}finally{await pool.end();}await activate(row.manifest.targetBinding,{planId:id,manifestSha256:sha});return{id,status:'completed',path:row.manifest.targetBinding.path,manifest:row.manifest,manifestSha256:sha,progress:row.progress,originalsRetained:true};};
 current=await createNativeInstance(d,activate,{quiesce,releaseQuiescence,resumeMigration});
 const authorization=readMediaRootAuthorization(d);if(authorization?.operation==='migration'&&readPendingMediaRootDeployment(d))await finish(authorization);
 return{handler:(q,r)=>{
  const maintenance=new URL(q.url??'/', 'http://local').pathname==='/api/local/media-root';
  if(paused&&!maintenance&&q.method!=='GET'){r.writeHead(409,{'Content-Type':'application/json'});r.end(JSON.stringify({error:'媒体根正在迁移，请读取同一计划进度。'}));return;}
  if(!maintenance){let complete;const done=new Promise(resolve=>{complete=resolve;});requests.add(done);const finishRequest=()=>{requests.delete(done);complete();};r.once('finish',finishRequest);r.once('close',finishRequest);}
  return current.handler(q,r);
 },close:async()=>{if(closed)return;closed=true;await previousPending?.close();await current.close();}};
async function createNativeInstance(d,activate,lifecycle){
 const pool=createLocalDatabase(d.database);let worker,episodes,accounts,automation,mediaRootSettings,closing;function close(){return closing??=(async()=>{accounts?.close();mediaRootSettings?.close();await automation?.stop();await episodes?.close();await worker?.stop();await pool.end();})();}
 try{
 const authorization=readMediaRootAuthorization(d);if(authorization?.operation==='migration'){const proof=(await pool.query(migrationProofQuery(authorization))).rows[0].media_root_publication_proof;verifyMediaRootMigrationProof(proof,authorization);}
 const binding=d.mediaRootBinding??await inspectMediaRoot(d.mediaRoot);
 await verifyMediaRootBinding(binding,d.worker?.minimumFreeBytes??0);
 await pool.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,coalesce($5::uuid,CASE WHEN local_identity.media_root_binding() IS NULL THEN $6::uuid END))',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,d.storageOwnerId??null,d.secretAdministration?.adminOwnerId??null]);
 const sourceRoots=await readMediaDeployment(pool,d.mediaRoot);const environment={PATH:process.env.PATH,HOME:d.home,TMPDIR:process.env.TMPDIR,LOOP_STATE_DIR:d.stateDirectory,...(d.openChatCut?{OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node}:{}),...(process.env.LOOP_LOCAL_OFFLINE==='1'?{NODE_OPTIONS:'--import '+join(d.projectRoot,'scripts/runtime/offline-guard.mjs')}:{})};
 const visualCommand=d.worker?.visualCommand?.map(value=>value===join(d.projectRoot,'scripts/runtime/codex.mjs')?join(runtimeRelease.root,'scripts/runtime/codex.mjs'):value);
 const confirmedGeneration=d.purpose==='local-daily'&&!!d.connections?.keychain&&['manual','providers-budgeted'].includes(d.connections?.verification);
 const workspaceGenerationFromConnections=confirmedGeneration&&d.worker?.media?.mode==='live';
 const workspaceSpeechFromConnections=confirmedGeneration&&d.worker?.narration?.mode==='live';
 const media=workspaceGenerationFromConnections?{...d.worker.media,workspaceGenerationFromConnections}:d.worker?.media;
 const narration=workspaceSpeechFromConnections?{...d.worker.narration,workspaceSpeechFromConnections}:d.worker?.narration;
 worker=d.worker?await startNativeWorkerService({...d.worker,media,narration,visualCommand,studioPort:d.openChatCut?.port,projectRoot:d.projectRoot,runtimeRelease:d.runtimeRelease,applicationDatabase:{host:d.database.host,port:d.database.port,database:d.database.database},database:d.workerDatabase,mediaRoot:d.mediaRoot,environment}):undefined;
 const store=d.connections?.keychain?configuredKeychainStore(d.connections.keychain,d.prepareKeychainAccess):undefined;
 const generationOptions={...(workspaceGenerationFromConnections?{workspaceGenerationFromConnections}:{}),...(workspaceSpeechFromConnections?{workspaceSpeechFromConnections}:{})};
 const probe=d.connections?.verification==='manual'?createProviderProbe(d.connections.network,undefined,undefined,{manualVerification:true,...generationOptions}):d.connections?.verification==='providers-budgeted'?createProviderProbe(d.connections.network,undefined,d.connections.readOnlyVerification,generationOptions):d.connections?.verification==='pexels-offline'?Object.assign(createPexelsLiveProbe({reserveRequest:()=>false}),{networkAvailable:false}):undefined;
 const secrets=d.secretAdministration&&store?new SecretAdministration(pool,d.secretAdministration,store):undefined;
 const connections=new LocalConnections(pool,store,probe);episodes=worker?new LocalEpisodeCommands(pool,d.mediaRoot,{...d.worker,...worker,checkReferences:(c,refs,options)=>connections.assertBlueprintReferences(c,refs,options)}):undefined;
 episodes?.startScriptContinuation();
 accounts=new LocalAccountCommands(pool,d.mediaRoot,episodes);
 automation=await startNativeAutomation({backupsEnabled:d.automaticBackups!==false,pool,projectRoot:d.projectRoot,runtimeRelease:d.runtimeRelease,recordSchedule:!worker,mediaRoot:d.mediaRoot,stateDirectory:d.stateDirectory,backup:nativeBackup(d.projectRoot,d.database.database,d.mediaRoot,d.backupRoot,{script:d.backupScript,environment:d.backupEnvironment}),...(d.controlledNotifications?{send:async m=>appendFileSync(join(d.stateDirectory,'notification-private.jsonl'),JSON.stringify({id:m.eventId,at:new Date().toISOString()})+'\n',{mode:0o600})}:{})});
 const historyRoot=join(d.runtimeRoot,'history/content');
 const storageResources=[{kind:'program',path:d.projectRoot},{kind:'runtime',path:d.runtimeRoot},{kind:'state',path:d.stateDirectory},{kind:'program',path:d.openChatCut?.root},{kind:'model-cache',path:d.worker?.alignment?.cacheDirectory},{kind:'history',path:historyRoot},{kind:'backup',path:d.backupRoot},{kind:'secrets'}].filter(r=>r.path||r.kind==='secrets');
 mediaRootSettings=new LocalMediaRootSettings(pool,d.mediaRoot,{resources:storageResources,pendingOperations:async()=>readPendingMediaRootDeployment(d)?[{kind:'publication',reason:'本机存储配置发布尚未完成，请先恢复原操作。'}]:[],minimumFreeBytes:d.worker?.minimumFreeBytes??0,retainedRoots:[d.worker?.alignment?.cacheDirectory].filter(p=>typeof p==='string'),protectedRoots:[...sourceRoots,historyRoot,d.runtimeRoot,d.projectRoot,d.stateDirectory,d.backupRoot,d.openChatCut?.root,d.worker?.alignment?.cacheDirectory].filter(p=>typeof p==='string'),...lifecycle,persist:(binding,publication)=>persistMediaRootDeployment(d,binding,publication),activate});
 const runtimeStatus=createRuntimeStatusReader({pool,projectRoot:d.projectRoot,mediaRoot:d.mediaRoot,mountPath:d.worker?.mountPath,minimumFreeBytes:d.worker?.minimumFreeBytes,worker:worker?.status,runtimeRelease:d.runtimeRelease,workerRelease:()=>worker?.runtimeRelease?.id??null});
 const logFile=process.env.LOOP_RUNTIME_LOG_PATH??d.logPath??join(d.runtimeRoot,'app-private.log');
 const storage=createLogStorage(d.runtimeRoot,logFile);
 const choose=async()=>{try{const {stdout}=await promisify(execFile)('/usr/bin/osascript',['-e','on run argv\nactivate\nreturn POSIX path of (choose folder with prompt "选择日志存储文件夹" default location (POSIX file (item 1 of argv)))\nend run','--',storage.read().activeDirectory],{timeout:120000,maxBuffer:8192});return{path:stdout.trim()};}catch(error){if(/\(-128\)/.test(String(error.stderr)))return{cancelled:true};throw Error('Directory chooser unavailable');}};
 return{handler:createLocalHandler({origin:`http://127.0.0.1:${d.port}`,pool,mediaRoot:d.mediaRoot,stateDirectory:d.stateDirectory,historyRoot,mediaRootSettings,secrets,connections,episodes,accounts,automation,runtimeStatus,recoverOutput:worker?.recoverOutput,logs:{read:()=>readRuntimeLogs([join(d.runtimeRoot,'app-private.log'),logFile]),storage:{...storage,choose}}}),close};
 }catch(error){await close();throw error;}
}

}
