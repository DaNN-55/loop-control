import {LocalMediaRootSettings,inspectMediaRoot,verifyMediaRootBinding} from '../../dist/local-app/local-app/mediaRootSettings.js';
import {mediaRootWorkerSettings,persistMediaRootDeployment,readMediaRootAuthorization,readPendingMediaRootDeployment,recoverMediaRootDeployment} from './media-root.mjs';
import {SecretAdministration} from '../../dist/local-app/local-app/secretAdministration.js';
import {createRuntimeStatusReader} from '../../dist/local-app/local-app/runtimeStatus.js';
import{configuredKeychainStore}from'../../dist/local-app/local-app/keychainStore.js';import{createPexelsLiveProbe}from'../../dist/local-app/local-app/pexelsLiveProbe.js';
import{createProviderProbe}from'../../dist/local-app/local-app/providerProbe.js';
import{LocalAccountCommands}from'../../dist/local-app/local-app/accountCommands.js';
import{appendFileSync}from'node:fs';import{join}from'node:path';
import{createLocalDatabase}from'../../dist/local-app/local-app/catalog.js';import{createLocalHandler}from'../../dist/local-app/local-app/localRoute.js';import{readMediaDeployment}from'../../dist/local-app/local-app/mediaDeployment.js';import{startNativeWorkerService}from'../../dist/local-app/local-app/localWorkerService.js';import{LocalEpisodeCommands}from'../../dist/local-app/local-app/episodeCommands.js';import{LocalConnections}from'../../dist/local-app/local-app/connections.js';import{startNativeAutomation}from'../../dist/local-app/local-app/nativeAutomation.js';import{nativeBackup}from'../../dist/local-app/local-app/nativeBackup.js';
export async function createNativeApplication(d){
 if(readPendingMediaRootDeployment(d)){const recovery=createLocalDatabase(d.database);try{d=recoverMediaRootDeployment(d,(await recovery.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding);}finally{await recovery.end();}}
 let current,active=d,closed=false;
 const activate=async binding=>{
  if(closed)throw Error('Native application is closing');
  const next={...active,mediaRoot:binding.path,mediaRootBinding:binding,worker:await mediaRootWorkerSettings(active,binding)};
  const replacement=await createNativeInstance(next,activate);
  if(closed){await replacement.close();throw Error('Native application is closing');}
  const previous=current;current=replacement;active=next;await previous.close();
 };
 current=await createNativeInstance(d,activate);
 return{handler:(q,r)=>current.handler(q,r),close:async()=>{if(closed)return;closed=true;await current.close();}};
}
async function createNativeInstance(d,activate){
 const pool=createLocalDatabase(d.database);let worker,episodes,accounts,automation,mediaRootSettings,closing;function close(){return closing??=(async()=>{accounts?.close();mediaRootSettings?.close();await automation?.stop();await episodes?.close();await worker?.stop();await pool.end();})();}
 try{
 readMediaRootAuthorization(d);
 const binding=d.mediaRootBinding??await inspectMediaRoot(d.mediaRoot);
 await verifyMediaRootBinding(binding,d.worker?.minimumFreeBytes??0);
 await pool.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,d.storageOwnerId??d.secretAdministration?.adminOwnerId??null]);
 const sourceRoots=await readMediaDeployment(pool,d.mediaRoot);const environment={PATH:process.env.PATH,HOME:d.home,TMPDIR:process.env.TMPDIR,LOOP_STATE_DIR:d.stateDirectory,...(d.openChatCut?{OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node}:{}),...(process.env.LOOP_LOCAL_OFFLINE==='1'?{NODE_OPTIONS:'--import '+join(d.projectRoot,'scripts/runtime/offline-guard.mjs')}:{})};
 worker=d.worker?await startNativeWorkerService({...d.worker,studioPort:d.openChatCut?.port,projectRoot:d.projectRoot,applicationDatabase:{host:d.database.host,port:d.database.port,database:d.database.database},database:d.workerDatabase,mediaRoot:d.mediaRoot,environment}):undefined;
 const store=d.connections?.keychain?configuredKeychainStore(d.connections.keychain,d.prepareKeychainAccess):undefined;
 const probe=d.connections?.verification==='manual'?createProviderProbe(d.connections.network,undefined,undefined,{manualVerification:true}):d.connections?.verification==='providers-budgeted'?createProviderProbe(d.connections.network,undefined,d.connections.readOnlyVerification):d.connections?.verification==='pexels-offline'?Object.assign(createPexelsLiveProbe({reserveRequest:()=>false}),{networkAvailable:false}):undefined;
 const secrets=d.secretAdministration&&store?new SecretAdministration(pool,d.secretAdministration,store):undefined;
 const connections=new LocalConnections(pool,store,probe);episodes=worker?new LocalEpisodeCommands(pool,d.mediaRoot,{...d.worker,...worker,checkReferences:(c,refs)=>connections.assertBlueprintReferences(c,refs)}):undefined;
 episodes?.startScriptContinuation();
 accounts=new LocalAccountCommands(pool,d.mediaRoot,episodes);
 automation=await startNativeAutomation({backupsEnabled:d.automaticBackups!==false,pool,projectRoot:d.projectRoot,recordSchedule:!worker,mediaRoot:d.mediaRoot,stateDirectory:d.stateDirectory,backup:nativeBackup(d.projectRoot,d.database.database,d.mediaRoot,d.backupRoot,{script:d.backupScript,environment:d.backupEnvironment}),...(d.controlledNotifications?{send:async m=>appendFileSync(join(d.stateDirectory,'notification-private.jsonl'),JSON.stringify({id:m.eventId,at:new Date().toISOString()})+'\n',{mode:0o600})}:{})});
 mediaRootSettings=new LocalMediaRootSettings(pool,d.mediaRoot,{minimumFreeBytes:d.worker?.minimumFreeBytes??0,retainedRoots:[d.worker?.alignment?.cacheDirectory].filter(p=>typeof p==='string'),protectedRoots:[...sourceRoots,d.runtimeRoot,d.projectRoot,d.stateDirectory,d.backupRoot,d.openChatCut?.root,d.worker?.alignment?.cacheDirectory].filter(p=>typeof p==='string'),persist:binding=>persistMediaRootDeployment(d,binding),activate});
 const runtimeStatus=createRuntimeStatusReader({pool,projectRoot:d.projectRoot,mediaRoot:d.mediaRoot,mountPath:d.worker?.mountPath,minimumFreeBytes:d.worker?.minimumFreeBytes,worker:worker?.status});
 return{handler:createLocalHandler({origin:`http://127.0.0.1:${d.port}`,pool,mediaRoot:d.mediaRoot,historyRoot:join(d.runtimeRoot,'history/content'),mediaRootSettings,secrets,connections,episodes,accounts,automation,runtimeStatus}),close};
 }catch(error){await close();throw error;}
}
