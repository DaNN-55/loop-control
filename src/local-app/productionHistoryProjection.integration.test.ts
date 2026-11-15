// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {workspacePexelsFixture} from './workspacePexels.fixture';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('history projection restores an independent production graph and actual adopted sources without reviving execution or changing the archive',async()=>{
 const f=await formalWorkflowFixture({controlled:true,videoConfiguration:false,freshAccount:true,blank:true});let sound:Awaited<ReturnType<typeof workspaceAudioFixture>>|undefined;
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated history projection');
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const script='# 历史独立制作\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n- 字幕：关闭\n\n## 正文\n### 段落 01\n- 口播：独立基准保存第一镜。\n- 画面来源：图片\n- 镜头时长（秒）：2\n\n### 段落 02\n- 口播：原音轨和第二镜关系保持。\n- 画面来源：图片\n- 镜头时长（秒）：2\n';
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'history.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(script).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);expect((await f.send('start')).status).toBe(200);
  let response=await f.send('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(response.status,JSON.stringify(response.body)).toBe(200);let w=response.body;
  const send=async(command:string,data:Record<string,unknown>)=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'history.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  const audio=await f.send('importMaterial',{sourceKind:'file',sourcePath:'history.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(audio.status).toBe(200);
  for(const clip of [...w.clips]){
   await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
   await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:clip.text,materialRevisionId:audio.body.id});await send('confirmWorkspaceNarration',{clipId:clip.id});
   const id=w.narration.find((n:any)=>n.clipId===clip.id).audioTrackId,decision=await send('prepareWorkspaceCandidate',{candidateId:id,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:id,adoptionId:decision.adoptionId});
   await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  }
  const reload=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);w=(await r.json()).workspace;};
  const runWorker=async(id:string,config:Record<string,unknown>={})=>{const worker=f.workerPool();try{const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:2})as any[])[0];expect(task).toBeTruthy();const result=await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath,...config});expect(result.status).toBe('completed');return result;}finally{await worker.end();}};
  await workspaceImageGenerationFixture([],undefined,f.controlled!);const imageConnection=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
  await send('requestWorkspaceImageCandidates',{targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:imageConnection},prompt:'历史恢复的受控图片',settings:{size:'1024x1024',quality:'low',count:1},referenceMaterialRevisionIds:[],reservationCents:100});
  await f.controlled!.execute(w.visualTasks[0].taskId);await reload();let visual=w.visualCandidates.find((v:any)=>v.kind==='image'&&v.status==='available');expect(visual).toBeTruthy();let adoption=await send('prepareWorkspaceVisualCandidate',{candidateId:visual.id,durationPolicy:'keep-target',motionPolicy:'preserve-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:visual.id,adoptionId:adoption.adoptionId});await send('retainWorkspaceImageCandidate',{candidateId:visual.id});
  const clip=w.clips[0];await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.controlled!.narrationSettings,text:'未采用的新草稿，保留原人工声音。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});const voiceTask=w.narration.find((n:any)=>n.clipId===clip.id).taskId;await f.controlled!.execute(voiceTask);await reload();const rejected=w.candidates.find((c:any)=>c.taskId===voiceTask);expect(rejected).toBeTruthy();await send('rejectWorkspaceCandidate',{candidateId:rejected.id});
  sound=await workspaceAudioFixture({existing:f.controlled!,mountPath:f.mountPath});const soundConnection=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id;
  await send('prepareWorkspaceAudio',{kind:'bgm',selection:{capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:soundConnection},description:'历史配乐',query:'tone',anchor:'absolute',offsetSeconds:0,durationSeconds:4});const music=w.audio.preparations.find((p:any)=>p.kind==='bgm');await sound.executeAudio(music.taskId);await reload();await send('adoptWorkspaceAudio',{preparationId:music.id});
  const pexels=await workspacePexelsFixture(undefined,[],f.controlled!);const pexelsConfig={media:{mode:'controlled',modulePath:join(f.root,'controlled-video.mjs')}};await send('searchWorkspacePexelsVideos',{targetItemId:w.clips[1].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:pexels.version},query:'ocean'});const search=w.pexels.requests[0];await runWorker(search.taskId,pexelsConfig);await reload();await send('previewWorkspacePexelsVideo',{searchId:search.id,resultId:22});const preview=w.pexels.requests[0];await runWorker(preview.taskId,pexelsConfig);await reload();await send('importWorkspacePexelsVideo',{previewId:preview.id});visual=w.visualCandidates.find((v:any)=>v.source?.id===22);expect(visual).toBeTruthy();adoption=await send('prepareWorkspaceVisualCandidate',{candidateId:visual.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:visual.id,adoptionId:adoption.adoptionId});
  await send('exportWorkspace',{});const output=w.exports[0];expect(output.status,JSON.stringify(output)).toBe('ready');await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});await send('prepareWorkspaceDelivery',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'历史完整制作图',description:'仅受控测试',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const delivered=await runWorker(w.deliveries[0].taskId);await reload();expect(w.deliveries[0].verified).toBe(true);
  const projectBytes=await readFile(join(f.assetRoot,w.project.relativePath));
  const keys=(await f.c.query("SELECT n.nspname||'.'||t.relname table_name,array_agg(a.attname::text ORDER BY k.i) columns FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(num,i) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE x.indisprimary AND n.nspname IN ('public','local_identity') GROUP BY 1")).rows;
  const tables=(await f.c.query("SELECT table_schema||'.'||table_name table_name,array_agg(column_name::text) columns FROM information_schema.columns WHERE table_schema IN ('public','local_identity') GROUP BY 1 ORDER BY 1")).rows;
  const archived:Array<{table:string;rows:any[];where:string;params:unknown[]}>=[];
  const taskIds=(await f.c.query('SELECT id FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows.map((r:any)=>r.id);
  for(const table of tables){
   if(!/^(public|local_identity)\.[a-z_]+$/.test(table.table_name)||table.table_name.includes('.history')||table.table_name.includes('.historical'))continue;
   const where=table.columns.includes('episode_id')?'episode_id=$1':table.columns.includes('workspace_id')?'workspace_id=$1':table.columns.includes('task_id')?'task_id=ANY($1::uuid[])':null;if(!where)continue;
   const params=table.columns.includes('episode_id')?[f.newEpisode]:table.columns.includes('workspace_id')?[w.id]:[taskIds];const rows=(await f.c.query(`SELECT to_jsonb(t) payload FROM ${table.table_name} t WHERE ${where}`,params)).rows.map((r:any)=>r.payload);if(!rows.length)continue;
   const primary=keys.find((k:any)=>k.table_name===table.table_name)?.columns;if(!primary)continue;
   archived.push({table:table.table_name,rows,where,params});
   for(const row of rows)await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table.table_name,Object.fromEntries(primary.map((k:string)=>[k,row[k]])),createHash('sha256').update(JSON.stringify(row)).digest('hex'),f.owner,row]);
  }
  // Episodes use an id key rather than episode_id; retain it explicitly.
  const episode=(await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.newEpisode])).rows[0].payload;
  await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',['public.episodes',{id:f.newEpisode},createHash('sha256').update(JSON.stringify(episode)).digest('hex'),f.owner,episode]);
  const archiveHash=async()=>(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) value FROM local_identity.history_versions h')).rows[0].value,before=await archiveHash();
  const physicalTables=new Set(['local_identity.episode_asset_locations','local_identity.episode_storage_lineage']);
  // SQL business recovery cannot recreate host filesystem authority. Keep this machine's verified registration for the positive read path.
  await f.c.query('BEGIN;SET LOCAL session_replication_role=replica');for(const table of archived)if(!physicalTables.has(table.table))await f.c.query(`DELETE FROM ${table.table} WHERE ${table.where}`,table.params);await f.c.query('DELETE FROM public.episodes WHERE id=$1',[f.newEpisode]);await f.c.query('COMMIT');
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  for(const name of ['production_preparation_revisions','production_shots','production_shot_versions','production_workspaces','production_workspace_versions','workspace_caption_inputs','workspace_narration_inputs','workspace_narrations','workspace_narration_requests','workspace_narration_submissions','workspace_audio_preparations','workspace_audio_requests','workspace_visual_candidates','workspace_visual_image_choices','workspace_candidate_decisions','workspace_pexels_requests','workspace_exports','workspace_deliveries']){
   const original=archived.find(t=>t.table==='local_identity.'+name);expect(original,name).toBeTruthy();
   const restored=(await f.c.query(`SELECT to_jsonb(t) payload FROM local_identity.${name} t WHERE ${original!.where}`,original!.params)).rows.map((r:any)=>r.payload);expect(restored.length,name).toBe(original!.rows.length);expect(restored,name).toEqual(expect.arrayContaining(original!.rows));
  }
  expect((await f.c.query('SELECT enabled,storyboard_enabled,narration_enabled,media_enabled,visual_media_enabled,alignment_enabled,preview_enabled,studio_enabled,delivery_enabled FROM local_identity.input_episodes WHERE episode_id=$1',[f.newEpisode])).rows[0]).toEqual({enabled:false,storyboard_enabled:false,narration_enabled:false,media_enabled:false,visual_media_enabled:false,alignment_enabled:false,preview_enabled:false,studio_enabled:false,delivery_enabled:false});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.historical_tasks WHERE task_id=ANY($1::uuid[])',[taskIds])).rows[0].n).toBe(taskIds.length);
  const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status,await read.clone().text()).toBe(200);const restored=(await read.json()).workspace;expect(restored.project.sha256).toBe(w.project.sha256);expect(restored.usedNarration.map((n:any)=>({shotId:n.shotId,audioTrackId:n.audioTrackId,text:n.text}))).toEqual(w.usedNarration.map((n:any)=>({shotId:n.shotId,audioTrackId:n.audioTrackId,text:n.text})));
  expect(restored.visualCandidates.map((v:any)=>({id:v.id,status:v.status,sha256:v.sha256}))).toEqual(w.visualCandidates.map((v:any)=>({id:v.id,status:v.status,sha256:v.sha256})));expect(restored.candidates.find((c:any)=>c.id===rejected.id)?.status).toBe('rejected');expect(restored.audio.mix).toEqual(w.audio.mix);expect(restored.deliveries[0].verified).toBe(true);expect(restored.exports[0].artifact.sha256).toBe(output.artifact.sha256);
  for(const artifact of delivered.artifacts){const response=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status,artifact.relativePath).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(artifact.sha256);}
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(projectBytes);projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});expect(await archiveHash()).toBe(before);
  const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs')),restoredDatabase='loop_history_graph_restore_'+randomUUID().replaceAll('-','').slice(0,12),snapshot=databaseSnapshot(context,f.database,process.cwd());context.sql('CREATE DATABASE '+restoredDatabase+' TEMPLATE template0','postgres');
  try{context.sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]),restoredDatabase);assertRestored(snapshot,databaseSnapshot(context,restoredDatabase,process.cwd()));}finally{context.sql('DROP DATABASE '+restoredDatabase+' WITH (FORCE)','postgres');}
  if(process.env.LOOP_STORY_EVIDENCE){const evidence=join(process.env.LOOP_STORY_EVIDENCE,'history-production');await mkdir(evidence,{recursive:true});await copyFile(join(f.assetRoot,output.artifact.relativePath),join(evidence,'restored-production.mp4'));await writeFile(join(evidence,'project.json'),projectBytes);await writeFile(join(evidence,'receipt.json'),JSON.stringify({episodeId:f.newEpisode,preparationRevisionId:w.preparationRevisionId,sourceRows:Object.fromEntries(archived.map(t=>[t.table,t.rows.length])),usedNarration:restored.usedNarration,visualCandidates:restored.visualCandidates.map((v:any)=>({id:v.id,status:v.status,sha256:v.sha256})),deliveryArtifacts:delivered.artifacts,archiveUnchanged:await archiveHash()===before,fullDatabaseRoundtrip:true},null,2));}
  for(const table of archived.filter(t=>physicalTables.has(t.table)))expect((await f.c.query(`SELECT to_jsonb(t) payload FROM ${table.table} t WHERE ${table.where}`,table.params)).rows.map((r:any)=>r.payload)).toEqual(table.rows);
  await f.c.query('DELETE FROM local_identity.episode_asset_locations WHERE episode_id=$1',[f.newEpisode]);
  const missingAuthority=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(missingAuthority.status,await missingAuthority.clone().text()).toBe(409);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(projectBytes);
 }finally{await sound?.close();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['other-owner','current-parent-owner','forged-owner-proof','row-owner','other-episode','missing-parent','invalid-key','current-record','rollback'] as const)('history request projection preserves provenance and current state: %s',async kind=>{
 const f=await productionWorkspaceFixture();try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated history projection');const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);const w=prepared.body,id=randomUUID(),episode=kind==='other-episode'?randomUUID():f.episode;
  if(episode!==f.episode)await f.c.query("INSERT INTO public.episodes SELECT (jsonb_populate_record(NULL::public.episodes,to_jsonb(e)||jsonb_build_object('id',$2::uuid,'main_script_revision_id',NULL))).* FROM public.episodes e WHERE id=$1",[f.episode,episode]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot)VALUES($1,$2,'generate_narration','ready',$3)",[id,episode,{output:{relative_path:`episodes/${episode}/audio/history-${id}.mp3`,required_artifact_types:['narration_audio']}}]);
  await f.c.query("INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot)VALUES($1,$2,$3,$4,$5,$6,'manual-upload','{}')",[id,w.id,f.episode,w.clips[0].id,w.clips[0].shotId,'a'.repeat(64)]);
  const payloads:Record<string,any>={};
  for(const table of ['public.tasks','local_identity.workspace_narration_requests']){
   const key=table==='public.tasks'?'id':'task_id',payload=(await f.c.query(`SELECT to_jsonb(t) payload FROM ${table} t WHERE ${key}=$1`,[id])).rows[0].payload;payloads[table]=payload;
   if(kind==='missing-parent'&&table==='public.tasks')continue;
   await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES($1,$2,$3,$4,$5)',[table,{[key]:kind==='invalid-key'&&table!=='public.tasks'?randomUUID():id},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),(['other-owner','current-parent-owner'].includes(kind)&&table==='public.tasks'||kind==='forged-owner-proof'||kind==='row-owner'&&table!=='public.tasks')?f.other:f.owner,payload]);
  }
  if(kind==='forged-owner-proof')for(const table of ['public.accounts','public.episodes']){
   const payload=(await f.c.query(table==='public.accounts'?'SELECT to_jsonb(a) payload FROM public.accounts a JOIN public.episodes e ON e.account_id=a.id WHERE e.id=$1':'SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload;
   await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES($1,$2,$3,$4,$5)',[table,{id:payload.id},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.other,payload]);
  }
  const originalArchive=(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) value FROM local_identity.history_versions h')).rows;
  await f.c.query('DELETE FROM local_identity.workspace_narration_requests WHERE task_id=$1',[id]);if(kind!=='current-parent-owner')await f.c.query('DELETE FROM public.tasks WHERE id=$1',[id]);
  if(kind==='current-record'){
   await f.c.query('INSERT INTO public.tasks SELECT * FROM jsonb_populate_record(NULL::public.tasks,$1)',[payloads['public.tasks']]);payloads['local_identity.workspace_narration_requests'].request_snapshot={currentRecord:'preserve this version'};
   await f.c.query('INSERT INTO local_identity.workspace_narration_requests SELECT * FROM jsonb_populate_record(NULL::local_identity.workspace_narration_requests,$1)',[payloads['local_identity.workspace_narration_requests']]);
  }
  const run=()=>projectHistory({sql:(sql:string)=>context.sql(kind==='rollback'?sql.replace(' COMMIT;',' SELECT 1/0;COMMIT;'):sql,f.database)});
  if(kind==='rollback'){expect(run).toThrow(/division by zero/);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE id=$1',[id])).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.history_projection_results')).rows[0].n).toBe(0);}
  else{
   run();const status=(await f.c.query("SELECT status FROM local_identity.history_projection_results WHERE table_name='local_identity.workspace_narration_requests'")).rows[0].status;
   expect(status).toBe({'other-owner':'history-only:source-owner','current-parent-owner':'history-only:source-owner','forged-owner-proof':'history-only:source-owner','row-owner':'history-only:source-owner','other-episode':'history-only:cross-episode-parent','missing-parent':'history-only:missing-parent','invalid-key':'history-only:invalid-key','current-record':'current-preserved'}[kind]);
  }
  const rows=(await f.c.query('SELECT to_jsonb(r) payload FROM local_identity.workspace_narration_requests r WHERE task_id=$1',[id])).rows.map((r:any)=>r.payload);expect(rows).toEqual(kind==='current-record'?[payloads['local_identity.workspace_narration_requests']]:[]);
  expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(w.project.sha256);
  expect((await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) value FROM local_identity.history_versions h')).rows).toEqual(originalArchive);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('restored in-flight narration stays unclaimable and cannot restore paid-call confirmation or login authority',async()=>{
 const f=await narrationFixture();let worker:ReturnType<typeof f.workerPool>|undefined;
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated history projection');const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>)=>{const r=await f.chosenRequest(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const clip=w.clips[0];await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.narrationSettings,text:'保留请求，不重复执行。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});const id=w.narration.find((n:any)=>n.clipId===clip.id).taskId;
  const original=(await f.c.query('SELECT to_jsonb(t) payload FROM public.tasks t WHERE id=$1',[id])).rows[0].payload;expect(original.status).toBe('ready');
  for(const table of ['public.tasks','local_identity.workspace_narration_requests','local_identity.workspace_call_confirmations']){
   const where=table==='public.tasks'?'id=$1':table.endsWith('requests')?'task_id=$1':'workspace_id=$1',parameter=table.endsWith('confirmations')?w.id:id;
   for(const {payload}of(await f.c.query(`SELECT to_jsonb(t) payload FROM ${table} t WHERE ${where}`,[parameter])).rows){const key=table.endsWith('requests')?{task_id:payload.task_id}:{id:payload.id};await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES($1,$2,$3,$4,$5)',[table,key,createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.owner,payload]);}
  }
  const login=(await f.c.query('SELECT to_jsonb(c) payload FROM local_identity.credentials c ORDER BY owner_id')).rows;
  const unsupported={owner_id:f.other,password_hash:'synthetic-history-not-a-login'};await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES($1,$2,$3,$4,$5)',['local_identity.credentials',{owner_id:f.other},createHash('sha256').update(JSON.stringify(unsupported)).digest('hex'),f.owner,unsupported]);
  await f.c.query('BEGIN;SET LOCAL session_replication_role=replica');await f.c.query('DELETE FROM local_identity.workspace_narration_requests WHERE task_id=$1',[id]);await f.c.query('DELETE FROM public.tasks WHERE id=$1',[id]);await f.c.query('DELETE FROM local_identity.workspace_call_confirmations WHERE workspace_id=$1',[w.id]);await f.c.query('COMMIT');
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  const restored=(await f.c.query('SELECT status,claimed_at,input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0];expect(restored).toEqual({status:'blocked',claimed_at:null,input_snapshot:original.input_snapshot});
  worker=f.workerPool();expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:2})).toEqual([]);expect((await f.c.query('SELECT count(*)::int n FROM public.task_runs WHERE task_id=$1',[id])).rows[0].n).toBe(0);await expect(readFile(f.submissions,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_call_confirmations WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);expect((await f.c.query('SELECT to_jsonb(c) payload FROM local_identity.credentials c ORDER BY owner_id')).rows).toEqual(login);
  for(const table of ['local_identity.credentials','local_identity.workspace_call_confirmations'])expect((await f.c.query('SELECT DISTINCT status FROM local_identity.history_projection_results WHERE table_name=$1',[table])).rows).toEqual([{status:'history-only:excluded-local-table'}]);
 }finally{await worker?.end();await f.close();}
},120000);
