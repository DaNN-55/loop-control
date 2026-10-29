// @vitest-environment node
import {expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionHash} from './scriptProductionStore';
import {nativeWorkerPort} from './workerDatabase';
import {runCodexWorker,type ClaimedWorkerTask} from '../worker/codexRunner';
import {executeNativeNarration} from './narrationWorker';
import {prepareNativeAttemptOutput} from './nativeAttemptOutput';
import {verifyArtifactIndex} from '../worker/mediaLibrary';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
export async function narrationFixture(origin?:string,onBase?:(f:Awaited<ReturnType<typeof productionWorkspaceFixture>>)=>void){
 const f=await productionWorkspaceFixture({origin,migrations:['db/local/087-workspace-narration.sql'],runtime:{narrationReady:async()=>{},checkReferences:async()=>{},wake(){}}});
 onBase?.(f);
 try{
 const version=randomUUID(),connection=randomUUID(),secret=randomUUID();
 const policy={asset_root:f.assetRoot,narration:{execution_path:'external',credential_ref:version,executor:{provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',prompt_version:'narration-v1'},budget_cents:10,max_attempts:1}};
 await f.c.query('BEGIN');
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'volcengine_tts','volcengine_tts','Controlled narration',$2,$3,'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse')",[connection,f.owner,version]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'volcengine_tts','volcengine_tts','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',$3)",[version,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
 await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,policy]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');
 await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2) WHERE id=$1',[f.episode,account]);
 await f.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Controlled fixture',$3)",[f.episode,f.board,f.owner]);
 await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);
 await f.c.query('COMMIT');
 const modulePath=join(f.root,'controlled-narration.mjs'),submissions=join(f.root,'submissions.jsonl'),responseMode=join(f.root,'response-mode');
 await writeFile(responseMode,'success');
 await copyFile('/private/tmp/loop-152-orchestration/media/controlled-narration-tone.mp3',join(f.assetRoot,`episodes/${f.episode}/voice.mp3`));
 await writeFile(modulePath,`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-narration-secret'},fetcher:async(url,init)=>{const mode=readFileSync(${JSON.stringify(responseMode)},'utf8');appendFileSync(${JSON.stringify(submissions)},JSON.stringify({url:String(url),body:JSON.parse(init.body)})+'\\n');if(mode==='delay')await new Promise(resolve=>setTimeout(resolve,400));if(mode==='unknown')throw Error('Controlled transport break');if(mode==='reject')return new Response('controlled rejection',{status:400});return new Response('data: '+JSON.stringify({code:0,data:readFileSync(${JSON.stringify(join(f.assetRoot,`episodes/${f.episode}/voice.mp3`))}).toString('base64')})+'\\n');}};}`);
 const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);
 const defaults=await f.request('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1});expect(defaults.status,JSON.stringify(defaults.body)).toBe(200);
 async function authorize(){const script=(await f.c.query('SELECT sha256 FROM public.production_material_revisions WHERE id=$1',[f.script])).rows[0];await f.c.query("INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) VALUES($1,$2,$3,$4,$5,true,$6,now()) ON CONFLICT(episode_id) DO UPDATE SET enabled=true",[f.episode,f.owner,f.script,script.sha256,{executionFingerprint:productionHash(policy)},'a'.repeat(64)]);}
 let worker=f.workerPool(),port=nativeWorkerPort(worker);
 async function execute(taskId:string,expectSuccess=true){
  const task=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}) as Array<Record<string,any>>)[0];expect(task,'Task claimed by actual loop_worker').toBeTruthy();
  const fence={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};
  let executionError:unknown;
  let outputs:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
  const result=await runCodexWorker({actualCostCents:1,claimNextTask:async()=>({taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:f.assetRoot,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask),verifyAssetRoot:async()=>{},verifyArtifacts:async(p,a)=>outputs?outputs.verify(a):verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts:a}),execute:async p=>{try{outputs=await prepareNativeAttemptOutput(p,fence);return await executeNativeNarration(worker,{mode:'controlled',modulePath},outputs.taskPackage,fence);}catch(error){executionError=JSON.stringify(error,Object.getOwnPropertyNames(error));throw error;}},reportResult:async(_id,_attempt,result)=>{if(result.status==='completed')await outputs!.publish(worker,result);else await port.rpc('report_worker_result',{...fence,p_result:result});}});
  if(expectSuccess&&result?.status!=='completed'&&await readFile(responseMode,'utf8')==='success')throw Error(String(executionError)+' '+JSON.stringify((await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[taskId])).rows[0]));
  return result;
 }
 return{...f,made:made.body,authorize,execute,restartWorker:async()=>{await worker.end();worker=f.workerPool();port=nativeWorkerPort(worker);},responseMode,submissions,read:async()=>{const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);return(await response.json()).workspace;},close:async()=>{await worker.end();await f.close();}};
 }catch(error){await f.close();throw error;}
}
