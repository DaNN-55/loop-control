// @vitest-environment node
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {freshProductionFixture} from './freshProduction.fixture';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
const fresh=()=>freshProductionFixture();
async function confirmScriptWithoutPlanner(f:Awaited<ReturnType<typeof fresh>>|Awaited<ReturnType<typeof formalWorkflowFixture>>){
 const started=await f.send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');
 expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND (provider='codex' OR task_type IN('prepare_visual_brief','draft_storyboard','draft_storyboard_revision'))",[f.newEpisode])).rows[0].n).toBe(0);
}
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('Owner prepares a confirmed fresh script before visual materials exist without a planner',async()=>{const f=await fresh();try{await confirmScriptWithoutPlanner(f);const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.scriptRevisionId).toBe(f.main);expect(prepared.body.preparation.origin).toBe('script-segment');expect(prepared.body.readiness.placeholders.length).toBeGreaterThan(0);}finally{await f.close();}},120000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('Owner builds a formal incomplete draft without old storyboard approvals',async()=>{const f=await fresh();try{
 const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(imported.status).toBe(200);
 await confirmScriptWithoutPlanner(f);
 const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.readiness.placeholders.length).toBeGreaterThan(0);
 const get=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(get.status).toBe(200);expect((await get.json()).workspace.id).toBe(prepared.body.id);
 let w=prepared.body;
 // Existing 084+ workspaces can have no 095 lineage rows. GET stays read-only.
 await f.c.query('DELETE FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id]);const upgradedRead=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),upgraded=(await upgradedRead.json()).workspace;expect(upgraded.preparation.shots).toHaveLength(w.clips.length);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);
 const authorized=await f.send('authorizeWorkspacePreparation',{workspaceId:w.id,expectedRevision:w.revision,enabled:true});expect(authorized.status).toBe(409);expect(authorized.body.error).toContain('请在生成时确认本次调用');
 const added=await f.send('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'新增的本地口播。'}});expect(added.status,JSON.stringify(added.body)).toBe(200);w=added.body;const local=w.clips.find((c:any)=>c.shotId.startsWith('added-'));
 const saved=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:local.id,mode:'none',text:'新增的本地口播。'});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 expect((await f.c.query('SELECT shot_type FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND shot_id=$2',[w.id,local.shotId])).rows[0].shot_type).toBeNull();
 expect((await f.c.query('SELECT baseline_text,origin FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND shot_id=$2',[w.id,local.shotId])).rows[0]).toEqual({baseline_text:'',origin:'local-added'});
 expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}},120000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('first formal adoption preserves the latest unsubmitted legacy Studio document',async()=>{
 const f=await productionWorkspaceFixture();try{
 await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.episode]);
 const opened=await f.request('openStudio',{projectRelativePath:f.boardPath});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
 const {editStudioDocument}=await import('./studioDocument.fixture');
 await editStudioDocument(opened.body.studioUrl,opened.body.workspace.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=19;});
 const data={reviewPackageId:f.board,expectedScriptRevisionId:f.script};const denied=await f.request('prepareWorkspace',data);expect(denied.status,JSON.stringify(denied.body)).toBe(409);
 const kept=await f.request('prepareWorkspace',{...data,legacyDecision:'preserve'});expect(kept.status,JSON.stringify(kept.body)).toBe(200);
 const doc=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${kept.body.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(doc.status).toBe(200);expect((await doc.json()).project.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(19);
 expect(kept.body.recovery.decision).toBe('preserve');const backup=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${kept.body.recovery.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(backup.status).toBe(200);expect((await backup.json()).project.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(19);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('late legacy render reports retain artifacts without advancing or approving the adopted workspace',async()=>{
 const f=await productionWorkspaceFixture();const worker=f.workerPool();try{
 const {nativeWorkerPort}=await import('./workerDatabase'),port=nativeWorkerPort(worker),task=randomUUID(),video=`episodes/${f.episode}/late-old-render.mp4`,fs=await import('node:fs/promises'),crypto=await import('node:crypto');
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
 const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot;
 snapshot.output={required_artifact_types:['render','review_qc_report'],relative_path:video,review_stage:'qc_review',content_type:'video/mp4'};
 await f.c.query("UPDATE local_identity.input_episodes SET enabled=true,studio_enabled=true WHERE episode_id=$1",[f.episode]);await f.c.query("UPDATE public.episodes SET stage='render_ready' WHERE id=$1",[f.episode]);
 await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES($1,$2,'generate_review_render','ready',$3,'openchatcut','openchatcut@0.2.14','review-render-v1')",[task,f.episode,snapshot]);
 const claimed=(await port.rpc('claim_next_worker_task',{p_task_id:task,p_worker_capacity:1}) as any[])[0];expect(claimed).toBeTruthy();
 const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;expect(w.id).toBeTruthy();
 const artifacts=[];for(const[ordinal,artifactType]of claimed.input_snapshot.output.required_artifact_types.entries()){const path=ordinal===0?claimed.input_snapshot.output.relative_path:`${(await import('node:path')).dirname(claimed.input_snapshot.review_render.project_relative_path)}/${artifactType.includes('qc')?'qc-report.json':artifactType.includes('runtime')?'openchatcut-runtime.json':'project.json'}`;await fs.mkdir((await import('node:path')).dirname(`${f.assetRoot}/${path}`),{recursive:true});if(artifactType==='render')await fs.copyFile(`${f.assetRoot}/${f.videoPath}`,`${f.assetRoot}/${path}`);else await fs.writeFile(`${f.assetRoot}/${path}`,JSON.stringify({fixture:'late legacy',artifactType}));const bytes=await fs.readFile(`${f.assetRoot}/${path}`);artifacts.push({artifactType,relativePath:path,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length});}
 await port.rpc('report_worker_result',{p_task_id:task,p_attempt:claimed.attempt,p_lease_token:claimed.lease_token,p_result:{version:'worker-result/v1',taskId:task,status:'completed',artifacts,validation:{passed:true,checks:[{name:'controlled_late_result',passed:true,detail:'Existing valid fixture bytes registered after workspace adoption.'}]},actualCostCents:0,retry:{shouldRetry:false,reason:'Legacy result retained.'},blockers:[],nextStep:'Historical evidence only.'}});
 const current=await fetch(`${f.origin}/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}}),raw=await current.json(),body={...raw.sections,tasks:raw.sections.tasks??raw.patches?.tasks?.rows,artifacts:raw.sections.artifacts??raw.patches?.artifacts?.rows};expect(body.episode.stage).toBe('render_ready');expect(body.tasks.find((t:any)=>t.id===task).status).toBe('completed');expect(body.artifacts.some((a:any)=>a.producer_task_id===task)).toBe(true);expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await read.json()).workspace.project.sha256).toBe(w.project.sha256);
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET LOCAL ROLE loop_owner');await expect(f.c.query('SELECT public.record_publish_package_verification($1,$2,1)',[f.episode,'a'.repeat(64)])).rejects.toThrow('exact confirmed workspace delivery');await f.c.query('ROLLBACK');
 }finally{await worker.end();await f.close();}
},120000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('fresh formal and added shots generate through the real controlled Provider Worker without legacy approval',async()=>{
 const f=await formalWorkflowFixture({controlled:true});try{
 await confirmScriptWithoutPlanner(f);
 let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
 const send=async(name:string,extra={})=>{const result=await f.send(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;return result.body;};
 const speechVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id,videoVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='seedance_video'")).rows[0].id;

 await f.send('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1});
 await send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'新增正文不是主脚本基准。'}});
 for(const clip of [w.clips[0],w.clips.find((c:any)=>c.shotId.startsWith('added-'))]){
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:speechVersion},text:clip.text,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:50});
  const n=w.narration.find((n:any)=>n.shotId===clip.shotId);expect(n.taskId).toBeTruthy();if(!f.controlled)throw Error('Controlled Worker fixture required');expect((await f.controlled.execute(n.taskId))?.status).toBe('completed');
  await send('refreshWorkspaceNarration');
  const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;const voice=w.narration.find((n:any)=>n.shotId===clip.shotId);expect(voice.durationSeconds).toBeGreaterThan(2);expect(voice.audioTrackId).toBeTruthy();
 }
 expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 expect(w.candidates.find((n:any)=>n.shotId.startsWith('added-')).mainScriptText).toBe('');
 const local=w.clips.find((c:any)=>c.shotId.startsWith('added-'));

 const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'local-first.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
 await send('requestWorkspaceVisualCandidate',{selection:{capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:videoVersion},targetItemId:local.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'局部新镜头的受控视觉生成。',durationSeconds:4,reservationCents:90});const visual=w.visualTasks[0];expect(visual.taskId).toBeTruthy();expect((await f.controlled!.execute(visual.taskId))?.status).toBe('completed');
 const got=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await got.json()).workspace;expect(w.visualCandidates.find((v:any)=>v.shotId===local.shotId)?.status).toBe('available');
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('retired planner retries cannot alter historical tasks or the confirmed script',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 普通脚本\n\n## 正文\n普通脚本原文：今天展示上传画面。'});try{
 const taskId=randomUUID(),snapshot={capability:'storyboard_planning',script_revision_id:f.main,harness:{id:randomUUID(),model:'historical-model',content:'Owner确认的旧规划输入'},allowed_tools:['read','write']};
 // This is immutable historical fixture data, not a new request through a retired API.
 await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version,budget_limit_cents) VALUES($1,$2,'draft_storyboard','failed',$3,'codex','historical-model','historical-planning-v1',37)",[taskId,f.newEpisode,snapshot]);
 const historical=async()=>({task:(await f.c.query('SELECT to_jsonb(t) record FROM public.tasks t WHERE id=$1',[taskId])).rows[0].record,script:(await f.c.query('SELECT to_jsonb(r) record FROM public.production_material_revisions r WHERE id=$1',[f.main])).rows[0].record,taskCount:(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n});
 const before=await historical();
 for(const [command,data]of[
  ['retryWorkspacePlanning',{expectedScriptRevisionId:f.main,taskId}],
  ['replanWorkspace',{expectedScriptRevisionId:f.main,planningTaskId:taskId}],
  ['requestStructureRevision',{reviewPackageId:randomUUID(),reason:'旧规划修订'}],
 ]as const){const r=await f.send(command,data);expect(r.status,JSON.stringify(r.body)).toBe(410);expect(r.body.error).toContain('已退役');}
 expect(await historical()).toEqual(before);
 }finally{await f.close();}
},120000);
