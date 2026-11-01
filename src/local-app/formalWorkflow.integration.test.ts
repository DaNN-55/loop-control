// @vitest-environment node
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
const fresh=()=>formalWorkflowFixture();
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('Owner confirms a fresh script before visual materials exist',async()=>{const f=await fresh();try{const started=await f.send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');}finally{await f.close();}},120000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('Owner builds a formal incomplete draft without old storyboard approvals',async()=>{const f=await fresh();try{
 const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(imported.status).toBe(200);
 const started=await f.send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);
 const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.readiness.placeholders.length).toBeGreaterThan(0);
 const get=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(get.status).toBe(200);expect((await get.json()).workspace.id).toBe(prepared.body.id);
 let w=prepared.body;
 // Existing 084+ workspaces can have no 095 lineage rows. GET stays read-only.
 await f.c.query('DELETE FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id]);const upgradedRead=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),upgraded=(await upgradedRead.json()).workspace;expect(upgraded.preparation.shots).toHaveLength(w.clips.length);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);
 const authorized=await f.send('authorizeWorkspacePreparation',{workspaceId:w.id,expectedRevision:w.revision,enabled:true});expect(authorized.status,JSON.stringify(authorized.body)).toBe(200);expect(authorized.body.preparation.authorized).toBe(true);
 const added=await f.send('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'新增的本地口播。'}});expect(added.status,JSON.stringify(added.body)).toBe(200);w=added.body;const local=w.clips.find((c:any)=>c.shotId.startsWith('added-'));
 const saved=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:local.id,mode:'none',text:'新增的本地口播。'});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 const type=await f.send('confirmWorkspaceShot',{workspaceId:w.id,expectedRevision:w.revision,clipId:local.id,shotType:'a_roll'});expect(type.status,JSON.stringify(type.body)).toBe(200);
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
 expect((await f.send('start')).status).toBe(200);let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
 const send=async(name:string,extra={})=>{const result=await f.send(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;return result.body;};
 const speechVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id,videoVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='seedance_video'")).rows[0].id;

 await send('authorizeWorkspacePreparation',{enabled:true});await f.send('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1});
 await send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'新增正文不是主脚本基准。'}});
 for(const clip of [w.clips[0],w.clips.find((c:any)=>c.shotId.startsWith('added-'))]){
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:speechVersion},text:clip.text,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:50});
  const n=w.narration.find((n:any)=>n.shotId===clip.shotId);expect(n.taskId).toBeTruthy();if(!f.controlled)throw Error('Controlled Worker fixture required');expect((await f.controlled.execute(n.taskId))?.status).toBe('completed');
  await send('refreshWorkspaceNarration');
  const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;const voice=w.narration.find((n:any)=>n.shotId===clip.shotId);expect(voice.durationSeconds).toBeGreaterThan(2);expect(voice.audioTrackId).toBeTruthy();
 }
 expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 expect(w.candidates.find((n:any)=>n.shotId.startsWith('added-')).mainScriptText).toBe('');
 const local=w.clips.find((c:any)=>c.shotId.startsWith('added-'));await send('confirmWorkspaceShot',{clipId:local.id,shotType:'a_roll'});

 const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'local-first.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
 await send('requestWorkspaceVisualCandidate',{selection:{capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:videoVersion},targetItemId:local.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'局部新镜头的受控视觉生成。',durationSeconds:4,reservationCents:90});const visual=w.visualTasks[0];expect(visual.taskId).toBeTruthy();expect((await f.controlled!.execute(visual.taskId))?.status).toBe('completed');
 const got=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await got.json()).workspace;expect(w.visualCandidates.find((v:any)=>v.shotId===local.shotId)?.status).toBe('available');
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('ordinary scripts use the selected real planner task and verified artifact before preparation confirmation',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 普通脚本\n\n## 正文\n普通脚本原文：今天展示上传画面。'});const worker=f.workerPool();try{
 const fs=await import('node:fs/promises'),path=await import('node:path');await f.send('importMaterial',{sourceKind:'file',sourcePath:'ordinary.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
 expect((await f.send('start')).status).toBe(200);const first=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(first.status,JSON.stringify(first.body)).toBe(200);expect(first.body.planning).toBe(true);
 const selectionA=(await f.c.query('SELECT selection FROM local_identity.episode_planning_selections WHERE episode_id=$1',[f.newEpisode])).rows[0].selection;expect((await f.send('saveWorkspacePlanningSelection',{expectedSelectionRevision:1,selection:{...selectionA,model:'gpt-5.6-codex',budgetCents:60}})).status).toBe(200);
 const {nativeWorkerPort}=await import('./workerDatabase'),{runWorkspaceDeliveryProcess}=await import('./workspaceDelivery.fixture');let task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:first.body.taskId,p_worker_capacity:1}) as any[])[0];expect(task).toBeTruthy();
 const failed=await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath,visualCommand:[process.execPath,'-e','process.exit(1)']});expect(failed.status).toBe('failed');
 let second:any;for(let attempt=0;attempt<200&&!second;attempt++){second=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:first.body.taskId,p_worker_capacity:1}) as any[])[0];if(!second)await new Promise(done=>setTimeout(done,50));}expect(second?.attempt).toBe(Number(task.attempt)+1);expect((await runWorkspaceDeliveryProcess(f,second,{mountPath:f.mountPath,visualCommand:[process.execPath,'-e','process.exit(1)']})).status).toBe('failed');
 const unchanged=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(unchanged.body).toMatchObject({planning:true,taskId:first.body.taskId,status:'failed'});
 const foreign=await f.send('retryWorkspacePlanning',{expectedScriptRevisionId:f.main,taskId:randomUUID()});expect(foreign.status).toBe(409);
 const retried=await f.send('retryWorkspacePlanning',{expectedScriptRevisionId:f.main,taskId:first.body.taskId});expect(retried.status,JSON.stringify(retried.body)).toBe(200);expect(retried.body.taskId).not.toBe(first.body.taskId);task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:retried.body.taskId,p_worker_capacity:1}) as any[])[0];expect(task).toBeTruthy();expect(task.model).toBe(selectionA.model);expect(task.input_snapshot.harness.model).toBe(selectionA.model);expect(task.budget_limit_cents).toBe(0);

 const command=path.join(f.root,'controlled-ordinary-planner.mjs');await fs.writeFile(command,`import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{join,dirname}from'node:path';import{createHash}from'node:crypto';let text='';for await(const b of process.stdin)text+=b;const p=JSON.parse(text),main=p.assets.inputs.find(x=>x.artifactType==='main_script'),board={version:'storyboard/v1',shots:[{id:'ordinary-1',scriptSegment:readFileSync(join(p.assets.allowedRoot,main.relativePath),'utf8').trim(),durationSeconds:3,shotType:'a_roll',productionMethod:'展示Owner上传的原画面',targetSpec:'9:16',inputBasis:p.assets.inputs.map(x=>({relativePath:x.relativePath,sha256:x.sha256}))}],audioCues:[]},bytes=Buffer.from(JSON.stringify(board));const output=join(p.assets.allowedRoot,p.output.relativePath);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,bytes);console.log(JSON.stringify({version:'worker-result/v1',taskId:p.task.id,status:'completed',artifacts:[{artifactType:'storyboard',relativePath:p.output.relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],storyboard:board,validation:{passed:true,checks:[{name:'controlled_planner',passed:true,detail:'Original plain script and uploaded visual are frozen inputs.'}]},actualCostCents:0,retry:{shouldRetry:false,reason:'Controlled Adapter completed.'},blockers:[],nextStep:'Owner confirms preparation matching.'}));`);
 const result=await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath,visualCommand:[process.execPath,command]});expect(result.status,JSON.stringify(result)).toBe('completed');
 const packageId=(await f.c.query('SELECT id FROM public.review_packages WHERE task_id=$1',[retried.body.taskId])).rows[0].id;const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main,reviewPackageId:packageId});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.preparation.origin).toBe('planner');expect(prepared.body.clips[0].text).toBe('# 普通脚本\n\n## 正文\n普通脚本原文：今天展示上传画面。');expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await worker.end();await f.close();}
},180000);
