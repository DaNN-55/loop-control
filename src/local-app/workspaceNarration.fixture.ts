import {videoProviders,type VideoProvider} from '../worker/videoProviderCatalog';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
// @vitest-environment node
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionHash} from './scriptProductionStore';
import {nativeWorkerPort} from './workerDatabase';
import {runCodexWorker,type ClaimedWorkerTask} from '../worker/codexRunner';
import {executeNativeMedia} from './mediaWorker';
import {executeNativeNarration} from './narrationWorker';
import {prepareNativeAttemptOutput} from './nativeAttemptOutput';
import {verifyArtifactIndex} from '../worker/mediaLibrary';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {episodeFileIO} from './episodeFiles';
import {resolveEpisodeStorageLocation} from './episodeStorageLocation';
export async function narrationFixture(origin?:string,onBase?:(f:Awaited<ReturnType<typeof productionWorkspaceFixture>>)=>void,videoConfiguration:boolean|VideoProvider|{provider:VideoProvider|'bailian';model:string}=false,skipWorkspace=false,options?:{voice?:string;video?:string;testRootParent?:string;mountPath?:string;databaseName?:string;migrations?:string[];episodeRelativePath?:(episodeId:string)=>string}|string[]){
 const controlledMedia=Array.isArray(options)?undefined:options,migrations=Array.isArray(options)?options:options?.migrations??[];
 const f=await productionWorkspaceFixture({testRootParent:controlledMedia?.testRootParent,databaseName:controlledMedia?.databaseName,episodeRelativePath:controlledMedia?.episodeRelativePath,origin,migrations:['db/local/087-workspace-narration.sql',...migrations],runtime:{...(controlledMedia?.mountPath?{mountPath:controlledMedia.mountPath}:{}),postReady:async()=>{},mediaReady:async()=>{},narrationReady:async()=>{},checkReferences:async()=>{},wake(){}}});
 onBase?.(f);
 try{
 const version=randomUUID(),connection=randomUUID(),secret=randomUUID();
 const videoVersion=randomUUID(),provider=typeof videoConfiguration==='object'?videoConfiguration.provider:typeof videoConfiguration==='string'?videoConfiguration:'volcengine';
 const {adapter,endpoint,models:[defaultModel]}=provider==='bailian'?{adapter:'wan_video',endpoint:'https://dashscope.aliyuncs.com',models:['wan2.6-i2v-flash']}:videoProviders[provider];
 const model=typeof videoConfiguration==='object'?videoConfiguration.model:defaultModel;
 const policy={asset_root:f.assetRoot,narration:{execution_path:'external',credential_ref:version,executor:{provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',prompt_version:'narration-v1'},budget_cents:10,max_attempts:1},...(videoConfiguration?{a_roll:{execution_path:'external',credential_ref:videoVersion,executor:{provider,adapter,model:defaultModel}}}:{})};
 await f.c.query('BEGIN');
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'volcengine_tts','volcengine_tts','Controlled narration',$2,$3,'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse')",[connection,f.owner,version]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'volcengine_tts','volcengine_tts','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',$3)",[version,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
 await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
 if(videoConfiguration){
 const vc=randomUUID(),vs=randomUUID();
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,$4,$5,'Controlled narration video',$2,$3,$6)",[vc,f.owner,videoVersion,provider,adapter,endpoint]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,$4,$5,$6,$3)",[videoVersion,vc,vs,provider,adapter,endpoint]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[videoVersion,f.owner,vs]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[videoVersion,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[videoVersion,f.owner]);
 if(model!==defaultModel)await f.c.query('INSERT INTO local_identity.connection_model_settings(connection_id,owner_id,enabled_models,revision) VALUES($1,$2,$3,$4)',[vc,f.owner,[model],randomUUID()]);
 }
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,policy]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');
 await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2) WHERE id=$1',[f.episode,account]);
 await f.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Controlled fixture',$3)",[f.episode,f.board,f.owner]);
 await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);
 await f.c.query('COMMIT');
 const videoModulePath=join(f.root,'controlled-video.mjs'),videoSubmissions=join(f.root,'video-submissions.jsonl');
 await writeFile(videoModulePath,`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-t05-video-secret'},fetcher:async(input,init={})=>{if(init.method==='POST'){appendFileSync(${JSON.stringify(videoSubmissions)},init.body+'\\n');return Response.json({id:'controlled-t05-video',task_id:'controlled-t05-video',code:0,data:{task_id:'controlled-t05-video'},output:{task_id:'controlled-t05-video'}});}const host=new URL(String(input)).hostname;if(host==='ark.cn-beijing.volces.com')return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/t05.mp4'}});if(host==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-a717.oss-accelerate.aliyuncs.com/t05.mp4'}});if(host==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/t05.mp4'}}});if(host==='api-singapore.klingai.com')return Response.json({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.klingai.com/t05.mp4'}]}}});return new Response(readFileSync(${JSON.stringify(controlledMedia?.video??workspaceTestMedia('landscape-red-blue.mp4'))}),{headers:{'content-type':'video/mp4'}});}};}`);
 const modulePath=join(f.root,'controlled-narration.mjs'),submissions=join(f.root,'submissions.jsonl'),responseMode=join(f.root,'response-mode');
 await writeFile(responseMode,'success');
 await copyFile(controlledMedia?.voice??workspaceTestMedia('controlled-narration-tone.mp3'),join(f.root,'controlled-voice.mp3'));
 await writeFile(modulePath,`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async ref=> 'synthetic-narration-'+ref},fetcher:async(url,init)=>{const mode=readFileSync(${JSON.stringify(responseMode)},'utf8');appendFileSync(${JSON.stringify(submissions)},JSON.stringify({url:String(url),body:JSON.parse(init.body),resourceId:init.headers['X-Api-Resource-Id'],credentialRef:init.headers['X-Api-Key']?.replace('synthetic-narration-','')})+'\\n');if(mode==='delay')await new Promise(resolve=>setTimeout(resolve,400));if(mode==='unknown')throw Error('Controlled transport break');if(mode==='reject')return new Response('controlled rejection',{status:400});return new Response('data: '+JSON.stringify({code:0,data:readFileSync(${JSON.stringify(join(f.root,'controlled-voice.mp3'))}).toString('base64')})+'\\n');}};}`);
 const made=skipWorkspace?{status:200,body:null}:await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});assert.equal(made.status,200,JSON.stringify(made.body));
 const defaults=await f.request('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1});assert.equal(defaults.status,200,JSON.stringify(defaults.body));
 async function authorize(){const script=(await f.c.query('SELECT sha256 FROM public.production_material_revisions WHERE id=$1',[f.script])).rows[0];await f.c.query("INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) VALUES($1,$2,$3,$4,$5,true,$6,now()) ON CONFLICT(episode_id) DO UPDATE SET enabled=true",[f.episode,f.owner,f.script,script.sha256,{executionFingerprint:productionHash(policy)},'a'.repeat(64)]);}
 let worker=f.workerPool(),port=nativeWorkerPort(worker);
 async function execute(taskId:string,expectSuccess=true,workerCapacity=1,workspaceSpeechFromConnections=false){
  const task=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:workerCapacity}) as Array<Record<string,any>>)[0];assert.ok(task,'Task claimed by actual loop_worker');
  const location=await resolveEpisodeStorageLocation(worker,f.root,String(task.episode_id));
  const fence={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};
  let executionError:unknown;
  let outputs:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
  const result=await runCodexWorker({actualCostCents:1,claimNextTask:async()=>({taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:location.assetRoot,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask),verifyAssetRoot:async()=>{},verifyArtifacts:async(p,a)=>outputs?outputs.verify(a):verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts:a,storage:await episodeFileIO(worker,location.assetRoot,p.episode.id)}),execute:async p=>{try{outputs=await prepareNativeAttemptOutput(p,fence,[],await episodeFileIO(worker,location.assetRoot,p.episode.id,true));return task.task_type==='generate_narration'?await executeNativeNarration(worker,{mode:'controlled',modulePath,workspaceSpeechFromConnections},outputs.taskPackage,fence):await executeNativeMedia(worker,{mode:'controlled',modulePath:videoModulePath},outputs.taskPackage,fence);}catch(error){executionError=JSON.stringify(error,Object.getOwnPropertyNames(error));throw error;}},reportResult:async(_id,_attempt,result)=>{if(result.status==='completed')await outputs!.publish(worker,result);else await port.rpc('report_worker_result',{...fence,p_result:result});}});
  if(expectSuccess&&result?.status!=='completed'&&await readFile(responseMode,'utf8')==='success')throw Error(String(executionError)+' '+JSON.stringify((await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[taskId])).rows[0]));
  return result;
 }
 const narrationSettings={selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:version},voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1},videoSelection={capability:'video',provider,adapter,model,connectionVersionId:videoVersion};
 // Callers opt into a chosen current service. Raw request remains available for missing-selection and legacy assertions.
 const chosenRequest:typeof f.request=(command,data={},options={})=>f.request(command,command==='saveWorkspaceNarration'&&data.mode==='tts'?{...narrationSettings,...data}:command==='generateWorkspaceNarration'?{reservationCents:100,...data}:['requestWorkspaceVisualCandidate','generateWorkspaceImage'].includes(command)?{selection:videoSelection,...data}:data,options);
 return{...f,chosenRequest,videoSelection,narrationSettings:{selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:version},voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1},controlledVoicePath:join(f.root,'controlled-voice.mp3'),made:made.body,authorize,execute,videoSubmissions,restartWorker:async()=>{await worker.end();worker=f.workerPool();port=nativeWorkerPort(worker);},responseMode,submissions,read:async()=>{const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});assert.equal(response.status,200);return(await response.json()).workspace;},close:async()=>{await worker.end();await f.close();}};
 }catch(error){await f.close();throw error;}
}

// Explicit Owner setup for tests that begin from an already adopted first voice.
// Selected speech always remains a candidate until these public commands succeed.
export async function adoptInitialNarration(f:{request:(command:string,data:Record<string,unknown>)=>Promise<{status:number;body:any}>},workspace:any){
 let w=workspace;
 for(const n of w.narration.filter((n:any)=>n.audioTrackId&&!n.adoptedAudioTrackId)){
  const candidate=w.candidates.find((v:any)=>v.taskId===n.taskId&&v.status==='available');if(!candidate)continue;
  const prepared=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate'});assert.equal(prepared.status,200,JSON.stringify(prepared.body));
  const adopted=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});assert.equal(adopted.status,200,JSON.stringify(adopted.body));w=adopted.body;
 }
 return w;
}
