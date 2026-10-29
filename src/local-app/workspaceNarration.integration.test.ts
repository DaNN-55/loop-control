// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionHash} from './scriptProductionStore';
import {nativeWorkerPort} from './workerDatabase';
import {runCodexWorker,type ClaimedWorkerTask} from '../worker/codexRunner';
import {executeNativeNarration} from './narrationWorker';
import {prepareNativeAttemptOutput} from './nativeAttemptOutput';
import {verifyArtifactIndex} from '../worker/mediaLibrary';
import {readWorkspaceNarrationTarget} from './workspaceNarration';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner can prepare disabled narration before editing without queuing external tasks',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/087-workspace-narration.sql']});
 try{
  await f.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Controlled fixture',$3)",[f.episode,f.board,f.owner]);
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
  expect(made.status,JSON.stringify(made.body)).toBe(200);
  const saved=await f.request('saveWorkspaceNarration',{workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,mode:'none',text:'保留完整正文。'});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.narration[0].mode).toBe('none');
  expect((await f.request('generateWorkspaceNarration',{workspaceId:made.body.id,expectedRevision:saved.body.revision,clipId:made.body.clips[0].id})).status).toBe(409);
 }finally{await f.close();}
},120_000);

async function narrationFixture(){
 const f=await productionWorkspaceFixture({migrations:['db/local/087-workspace-narration.sql'],runtime:{narrationReady:async()=>{},checkReferences:async()=>{},wake(){}}});
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
}
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('confirmed narration uses the real Worker, survives restart and assembles actual duration without duplicate submissions',async()=>{
 const f=await narrationFixture();try{
  const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const save=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'完整口播不能删词。'});expect(save.status,JSON.stringify(save.body)).toBe(200);
  expect((await f.request('generateWorkspaceNarration',base)).status).toBe(409);
  expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);
  expect((await f.request('generateWorkspaceNarration',base)).status).toBe(409);await f.authorize();
  const generated=await f.request('generateWorkspaceNarration',base);expect(generated.status,JSON.stringify(generated.body)).toBe(200);const task=generated.body.narration[0].taskId;
  expect((await f.request('generateWorkspaceNarration',base)).body.narration[0].taskId).toBe(task);
  await f.restart();await f.restartWorker();expect(await f.execute(task)).toEqual({status:'completed',taskId:task});await f.restart();
  const ready=await f.read();
  expect((await readWorkspaceNarrationTarget(f.c,f.assetRoot,w.id,w.clips[0].id)).durationSeconds).toBe(2.4);expect(ready.narration[0].audioTrackId).toBeTruthy();expect(ready.narration[0].durationSeconds).toBe(2.4);expect(ready.narration[0].durationSeconds).toBeLessThan(2.5);
  const assembled=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(assembled.status,JSON.stringify(assembled.body)).toBe(200);expect(assembled.body.narration[0].adoptedAudioTrackId).toBe(ready.narration[0].audioTrackId);
  const project=JSON.parse(await readFile(join(f.assetRoot,assembled.body.project.relativePath),'utf8'));const item=project.timelines[0].items.find((i:any)=>i.id===ready.narration[0].itemId);expect(item.durationInFrames).toBe(72);expect(item.sourceAssetId).toBe('audio-track-'+ready.narration[0].audioTrackId);expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId).startFrame).toBe(72);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:assembled.body.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);await f.closeStudio();
 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('unknown paid submissions stay blocked across restart and input changes; definite rejection allows one explicit retry',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'结果未知的完整输入。'})).status).toBe(200);await f.request('confirmWorkspaceNarration',base);
  const queued=await f.request('generateWorkspaceNarration',base);await writeFile(f.responseMode,'unknown');expect((await f.execute(queued.body.narration[0].taskId))?.status).toBe('blocked');await f.restart();await f.restartWorker();
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true})).status).toBe(409);
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'修改输入也不应重复未知请求。'})).status).toBe(200);await f.request('confirmWorkspaceNarration',base);expect((await f.request('generateWorkspaceNarration',{...base,retry:true})).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const second={...base,clipId:w.clips[1].id};await f.request('saveWorkspaceNarration',{...second,mode:'tts',text:'明确拒绝可以由 Owner 重试。'});await f.request('confirmWorkspaceNarration',second);const rejected=await f.request('generateWorkspaceNarration',second);await writeFile(f.responseMode,'reject');expect((await f.execute(rejected.body.narration[1].taskId))?.status).toBe('failed');
  await writeFile(f.responseMode,'success');const retry=await f.request('generateWorkspaceNarration',{...second,retry:true});expect(retry.status,JSON.stringify(retry.body)).toBe(200);expect(retry.body.narration[1].taskId).not.toBe(rejected.body.narration[1].taskId);expect((await f.execute(retry.body.narration[1].taskId))?.status).toBe('completed');
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('both first narration tracks assemble and crop an available source without invalidating the other shot',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const jobs:string[]=[];
  for(const clip of w.clips){const base={workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:clip.text});await f.request('confirmWorkspaceNarration',base);const q=await f.request('generateWorkspaceNarration',base);expect(q.status,JSON.stringify(q.body)).toBe(200);jobs.push(q.body.narration.find((n:any)=>n.clipId===clip.id).taskId);}
  for(const job of jobs)expect((await f.execute(job))?.status).toBe('completed');
  const before=await f.read();
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'four-second.mp4',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/landscape-red-blue.mp4')).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});
  expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const matched=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:imported.body.id});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=matched.body;
  expect(w.narration[1].inputFingerprint).toBe(before.narration[1].inputFingerprint);expect(w.narration[1].audioTrackId).toBe(before.narration[1].audioTrackId);
  // Matching this shot after speech does not discard its paid output. Confirm only its new visual choice.
  await f.request('confirmWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id});
  for(let i=0;i<2;i++){const next=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(next.status,JSON.stringify(next.body)).toBe(200);w=next.body;}
  expect(w.narration.every((n:any)=>n.adoptedAudioTrackId===n.audioTrackId)).toBe(true);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).durationInFrames).toBe(72);expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId).startFrame).toBe(72);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a running task may register its immutable output but late speech cannot replace changed input or advance delivery',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'旧输入。'});await f.request('confirmWorkspaceNarration',base);const q=await f.request('generateWorkspaceNarration',base);await writeFile(f.responseMode,'delay');const running=f.execute(q.body.narration[0].taskId);
  for(let i=0;i<50;i++){if(await readFile(f.submissions,'utf8').catch(()=>''))break;await new Promise(resolve=>setTimeout(resolve,10));}
  const changed=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'Owner 已手工修改的新输入。'});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect((await running)?.status).toBe('completed');
  const refreshed=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refreshed.status).toBe(200);expect(refreshed.body.narration[0].text).toBe('Owner 已手工修改的新输入。');expect(refreshed.body.narration[0].audioTrackId).toBeNull();expect(refreshed.body.project.sha256).toBe(w.project.sha256);expect(refreshed.body.readiness.deliverable).toBe(false);
 }finally{await f.close();}
},120_000);
