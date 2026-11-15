import {saveHistoricalPlanFixture} from './historicalSavedPlan.fixture';
// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {historicalProductionScriptV2} from '../reviews/productionScript.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';
import {restoreCreatedEpisode} from './episodeCreationRestore.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['full-backup','history-projection'] as const)('restores an adopted saved plan with image, music, cover and current native edits (%s)',async(mode)=>{
 const storage=await mkdtemp('/private/tmp/loop-d-plan-restore-');await mkdir(join(storage,'state'));
 const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');
 const script=historicalProductionScriptV2.replace('填写已上传图片的素材名称','原图').replace('生成时长（秒）：默认','生成时长（秒）：2').replace('字幕：开启','字幕：关闭').replace('背景音乐素材：默认','背景音乐素材：配乐').replace('- 转场：cut','- 转场：cut\n- 封面素材：原封面');
 const f=await formalWorkflowFixture({databaseName:source,mountPath:join(storage,'state','mounted'),freshAccount:true,scriptText:script});try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target);
  const upload=async(name:string,type:'image'|'audio',path:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const image=await upload('原图.png','image',workspaceTestMedia('still-striped.png'),'visual_reference'),music=await upload('配乐.mp3','audio',workspaceTestMedia('controlled-narration-tone.mp3'),'background_music'),cover=await upload('原封面.png','image',workspaceTestMedia('still-striped.png'),'cover');
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.plan.segments[0].firstFrame.material?.id).toBe(image.id);expect(saved.body.plan.bgm.material?.id).toBe(music.id);expect((await f.send('start')).status).toBe(200);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const old=await response.json(),imported=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:old.planSha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===image.id),prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations.find((p:any)=>p.kind==='bgm').id});
  const opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).transform.x=5;});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});await send('closeWorkspaceStudio');
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].account_id,prefix=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0].directory_relative_path;
  const snapshots=new Map<string,string>();for(const table of ['local_identity.script_productions','local_identity.production_preparation_revisions','local_identity.workspace_audio_preparations','public.production_material_revisions'])snapshots.set(table,context.sql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t WHERE episode_id='${f.newEpisode}'`,source));
  if(mode==='history-projection'){
   const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
   const tables=['input_episodes','production_preparation_revisions','production_shots','production_shot_versions','production_workspaces','production_workspace_versions','workspace_shot_inputs','workspace_caption_inputs','workspace_narration_inputs','workspace_audio_preparations','workspace_visual_candidates','workspace_visual_image_choices','workspace_candidate_decisions','workspace_legacy_recoveries','script_productions'];
   const keys=(await f.c.query("SELECT t.relname table_name,array_agg(a.attname::text ORDER BY k.i) columns FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(num,i) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE x.indisprimary AND n.nspname='local_identity' GROUP BY 1")).rows;
   const archived:Array<{table:string;where:string;parameter:string;rows:any[]}>=[];
   for(const table of tables){
    const columns=(await f.c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='local_identity' AND table_name=$1",[table])).rows.map(r=>r.column_name),where=columns.includes('episode_id')?'episode_id=$1':'workspace_id=$1',parameter=columns.includes('episode_id')?f.newEpisode:w.id;
    const rows=(await f.c.query(`SELECT to_jsonb(t) payload FROM local_identity.${table} t WHERE ${where}`,[parameter])).rows.map(r=>r.payload);if(!rows.length)continue;
    archived.push({table,where,parameter,rows});const primary=keys.find(k=>k.table_name===table)!.columns;
    for(const payload of rows)await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',['local_identity.'+table,Object.fromEntries(primary.map((key:string)=>[key,payload[key]])),createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.owner,payload]);
   }
   for(const required of ['input_episodes','production_preparation_revisions','production_workspaces','workspace_caption_inputs','workspace_audio_preparations','workspace_visual_candidates','script_productions'])expect(archived.some(a=>a.table===required),required).toBe(true);
   const archiveDigest=async()=>(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) value FROM local_identity.history_versions h')).rows[0].value,before=await archiveDigest(),project=await readFile(join(f.assetRoot,w.project.relativePath));
   await f.c.query('BEGIN;SET LOCAL session_replication_role=replica');for(const record of archived)await f.c.query(`DELETE FROM local_identity.${record.table} WHERE ${record.where}`,[record.parameter]);await f.c.query('COMMIT');
   projectHistory({sql:(sql:string)=>context.sql(sql,source)});
   expect((await f.c.query('SELECT count(*)::int n FROM local_identity.script_productions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
   for(const record of archived){
    if(record.table==='script_productions'||record.table==='input_episodes')continue;
    const rows=(await f.c.query(`SELECT to_jsonb(t) payload FROM local_identity.${record.table} t WHERE ${record.where}`,[record.parameter])).rows.map(r=>r.payload);expect(rows,record.table).toHaveLength(record.rows.length);expect(rows,record.table).toEqual(expect.arrayContaining(record.rows));
   }
   const flags=(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.input_episodes i WHERE episode_id=$1',[f.newEpisode])).rows[0].value;for(const [key,value]of Object.entries(flags))if(key==='enabled'||key.endsWith('_enabled'))expect(value,key).toBe(false);
   const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status,await read.clone().text()).toBe(200);const current=(await read.json()).workspace;
   expect(current.project.sha256).toBe(w.project.sha256);expect(current.preparation).toMatchObject({origin:'saved-plan',authorized:false,planSha256:old.planSha256});expect(current.coverInputs).toEqual(w.coverInputs);expect(current.audio.mix).toEqual(w.audio.mix);expect(current.visualCandidates.map((c:any)=>({id:c.id,status:c.status,sha256:c.sha256}))).toEqual(w.visualCandidates.map((c:any)=>({id:c.id,status:c.status,sha256:c.sha256})));
   expect(await readFile(join(f.assetRoot,current.project.relativePath))).toEqual(project);projectHistory({sql:(sql:string)=>context.sql(sql,source)});expect(await archiveDigest()).toBe(before);
   expect((await f.c.query("SELECT payload FROM local_identity.history_versions WHERE table_name='local_identity.script_productions' AND payload->>'episode_id'=$1",[f.newEpisode])).rows.map(r=>r.payload)).toEqual(archived.find(a=>a.table==='script_productions')!.rows);
   for(const table of ['review_packages','shot_preparation_drafts','approvals','tasks'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n,table).toBe(0);
   return;
  }
  const evidence=join(process.env.LOOP_STORY_EVIDENCE!,'saved-plan-source-restore');await mkdir(evidence,{recursive:true});
  await restoreCreatedEpisode({f,context,storage,source,target,episode:f.newEpisode,accountId:account,prefix,w,evidence,volumeMount:'/',phase:'saved-plan-image',expectedTransformX:5,verifyRestored:async({workspace,project,query,sourceOffline}:any)=>{
   expect(sourceOffline).toBe(true);expect(workspace.preparation).toMatchObject({origin:'saved-plan',authorized:false,planSha256:old.planSha256});expect(workspace.coverInputs).toEqual([expect.objectContaining({source:{version:'workspace-cover-source/v1',kind:'material',id:cover.id,sha256:cover.sha256}})]);expect(workspace.audio.mix.sounds).toHaveLength(1);expect(project.timelines[0].items.find((i:any)=>i.id===workspace.clips[0].itemId)).toMatchObject({kind:'image',transform:{x:5}});
   for(const[table,before]of snapshots)expect(query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t WHERE episode_id='${f.newEpisode}'`),table).toBe(before);for(const table of ['review_packages','shot_preparation_drafts','approvals','tasks'])expect(query(`SELECT count(*) FROM public.${table} WHERE episode_id='${f.newEpisode}'`),table).toBe('0');
  }});
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
