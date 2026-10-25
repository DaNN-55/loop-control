import{configuredKeychainStore}from'../../dist/local-app/local-app/keychainStore.js';import{createPexelsLiveProbe}from'../../dist/local-app/local-app/pexelsLiveProbe.js';
import{createProviderProbe}from'../../dist/local-app/local-app/providerProbe.js';
import{LocalAccountCommands}from'../../dist/local-app/local-app/accountCommands.js';
import{appendFileSync}from'node:fs';import{join}from'node:path';
import{createLocalDatabase}from'../../dist/local-app/local-app/catalog.js';import{createLocalHandler}from'../../dist/local-app/local-app/localRoute.js';import{readMediaDeployment}from'../../dist/local-app/local-app/mediaDeployment.js';import{startNativeWorkerService}from'../../dist/local-app/local-app/localWorkerService.js';import{LocalEpisodeCommands}from'../../dist/local-app/local-app/episodeCommands.js';import{LocalConnections}from'../../dist/local-app/local-app/connections.js';import{startNativeAutomation}from'../../dist/local-app/local-app/nativeAutomation.js';import{nativeBackup}from'../../dist/local-app/local-app/nativeBackup.js';
export async function createNativeApplication(d){
 const pool=createLocalDatabase(d.database);let worker,episodes,accounts,automation,closing;function close(){return closing??=(async()=>{accounts?.close();await automation?.stop();await episodes?.close();await worker?.stop();await pool.end();})();}
 try{await readMediaDeployment(pool,d.mediaRoot);const environment={PATH:process.env.PATH,HOME:d.home,TMPDIR:process.env.TMPDIR,LOOP_N8N_STATE_DIR:d.stateDirectory,...(d.openChatCut?{OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node}:{}),...(process.env.LOOP_LOCAL_OFFLINE==='1'?{NODE_OPTIONS:'--import '+join(d.projectRoot,'scripts/local/offline-guard.mjs')}:{})};
 worker=d.worker?await startNativeWorkerService({...d.worker,studioPort:d.openChatCut?.port,projectRoot:d.projectRoot,applicationDatabase:{host:d.database.host,port:d.database.port,database:d.database.database},database:d.workerDatabase,mediaRoot:d.mediaRoot,environment}):undefined;
 const store=d.connections?.keychain?configuredKeychainStore(d.connections.keychain):undefined;
 const probe=d.connections?.verification==='providers-budgeted'?createProviderProbe(d.connections.network):d.connections?.verification==='pexels-offline'?Object.assign(createPexelsLiveProbe({reserveRequest:()=>false}),{networkAvailable:false}):undefined;
 const connections=new LocalConnections(pool,store,probe);episodes=worker?new LocalEpisodeCommands(pool,d.mediaRoot,{...d.worker,...worker,checkReferences:(c,refs)=>connections.assertBlueprintReferences(c,refs)}):undefined;
 accounts=new LocalAccountCommands(pool,d.mediaRoot,episodes);
 automation=await startNativeAutomation({pool,projectRoot:d.projectRoot,recordSchedule:!worker,mediaRoot:d.mediaRoot,stateDirectory:d.stateDirectory,backup:nativeBackup(d.projectRoot,d.database.database,d.mediaRoot,join(d.projectRoot,'.loop-control/stage-d/backups',d.database.database)),...(d.controlledNotifications?{send:async m=>appendFileSync(join(d.stateDirectory,'notification-private.jsonl'),JSON.stringify({id:m.eventId,at:new Date().toISOString()})+'\n',{mode:0o600})}:{})});
 return{handler:createLocalHandler({origin:`http://127.0.0.1:${d.port}`,pool,mediaRoot:d.mediaRoot,connections,episodes,accounts,automation}),close};
 }catch(error){await close();throw error;}
}
