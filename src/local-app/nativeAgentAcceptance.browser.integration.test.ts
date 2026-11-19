// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {Pool} from 'pg';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {configuredKeychainStore} from './keychainStore';
import {StudioAgentBridge} from './studioAgentBridge';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(process.env.LOOP_NATIVE_AGENT_ACCEPTANCE!=='1')('uses existing real model connections to edit an isolated native project and deliver it through the UI',async()=>{
 const evidence=process.env.LOOP_NATIVE_AGENT_EVIDENCE!,deploymentModule=process.env.LOOP_NATIVE_AGENT_DEPLOYMENT!;if(!evidence||!deploymentModule)throw Error('Explicit private acceptance paths required');await mkdir(evidence,{recursive:true,mode:0o700});
 const {keychainState}=await import(new URL('./keychain.mjs','file://'+deploymentModule).href);keychainState('unlock');
 const {readDeployment}=await import(deploymentModule),d=readDeployment(),daily=new Pool(d.database);
 const existing=await ownerTransaction(daily,d.storageOwnerId??d.secretAdministration.adminOwnerId,true,async c=>(await c.query("SELECT v.id,v.provider,v.adapter,b.secret_ref,s.enabled_models FROM public.list_external_connection_versions(NULL) v JOIN local_identity.connection_bindings b ON b.version_id=v.id LEFT JOIN local_identity.connection_model_settings s ON s.connection_id=v.connection_id WHERE v.is_current AND v.revoked_at IS NULL AND v.adapter IN('openai_responses','deepseek_responses') AND public.connection_version_is_verified(v.id) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=v.id AND p.mode='live' AND p.outcome='verified')")).rows);await daily.end();
 let bridge:StudioAgentBridge|undefined;
 const calls:Array<{provider:string;model:string;status:number}>=[];
 const f=await productionWorkspaceFixture({runtime:{studioAgentEnvironment:(c,id)=>bridge!.environment(c,id),revokeStudioAgent:id=>bridge!.revoke(id)}});let vite:import('vite').ViteDevServer|undefined;const workers=f.workerPool();
 const signal=(name:string,value:unknown)=>writeFile(join(evidence,name),JSON.stringify(value,null,2),{mode:0o600});
 try{
  // Copy only credential references and their already-established qualification
  // into the disposable Owner. No credential is copied or persisted in this DB.
  await ownerTransaction(f.pool,f.owner,false,async c=>{
  for(const source of existing){const key=randomUUID(),connection=randomUUID(),version=randomUUID();await c.query('INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode) VALUES($1,$2,$3,$4,$5,$6,\'keychain\')',[f.owner,key,{command:'create',name:source.provider+' existing connection',provider:source.provider,adapter:source.adapter},connection,version,source.secret_ref]);await c.query('SELECT local_identity.apply_connection_intent($1)',[key]);await c.query("SELECT local_identity.record_connection_probe($1,'live','verified')",[version]);if(source.enabled_models)await c.query('INSERT INTO local_identity.connection_model_settings(connection_id,owner_id,enabled_models,revision) VALUES($1,$2,$3,$4)',[connection,f.owner,source.enabled_models,randomUUID()]);}
  });
  bridge=await new StudioAgentBridge(f.pool,configuredKeychainStore(d.connections.keychain,d.prepareKeychainAccess),async(url,init)=>{const body=JSON.parse(String(init?.body));const response=await fetch(url,init);calls.push({provider:new URL(String(url)).hostname,model:body.model,status:response.status});await signal('model-calls.json',calls);return response;}).start();
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);await f.fillVisuals(prepared.body);
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'ui-vite'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'native-acceptance',configureServer(server){server.middlewares.use('/__native-acceptance',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__native-acceptance','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原生剪辑流程验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.scratch/**']},proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  await signal('browser.json',{url:`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__native-acceptance?view=episodes&episode=${f.episode}&step=workspace`,email:f.email,password:f.password,episode:f.episode,backend:f.origin,fixtureRoot:f.root,files:{video:join(f.assetRoot,f.videoPath)}});
  console.log('Private native acceptance ready');
  let done=false;const processed=new Set<string>();
  for(let tick=0;tick<3600;tick++){
   try{await readFile(join(evidence,'done.json'));done=true;break;}catch{}
   for(const task of (await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='prepare_publish_package' AND status='ready'",[f.episode])).rows){if(processed.has(task.id))continue;processed.add(task.id);const claimed=(await nativeWorkerPort(workers).rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1}) as any[])[0];await signal('delivery-worker.json',await runWorkspaceDeliveryProcess(f,claimed,{studio:true,delivery:true}));}
   const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});if(response.ok)await signal('workspace.json',(await response.json()).workspace);await pause(500);
  }
  expect(done).toBe(true);const workspace=JSON.parse(await readFile(join(evidence,'workspace.json'),'utf8'));expect(calls.some(c=>c.status===200)).toBe(true);expect(workspace.exports.some((x:any)=>x.confirmed)).toBe(true);expect(workspace.deliveries.some((x:any)=>x.verified)).toBe(true);await signal('accepted.json',{realModelCalls:calls,workspace});
 }finally{await vite?.close();await bridge?.close();await f.close();await signal('cleanup.json',{closed:true});}
},1900000);
