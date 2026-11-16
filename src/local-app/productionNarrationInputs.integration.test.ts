// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {ownerTransaction} from './ownerTransaction';
import {registerProductionPreparation} from './productionPreparationStore';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {seedHistoricalPreparation,seedRecordedWorkspacePreparation} from './historicalPreparation.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('current manual narration saves independent inputs and preparation-bound audio without creating retired shot drafts',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 独立口播\n\n## 正文\n\n当前口播直接使用制作基准。'});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'voice.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(imported.status).toBe(200);
  const caption=w.captions[0].contract,clip=w.clips[0];
  const save=()=>f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,mode:'manual',text:'已明确保存的人工口播。',materialRevisionId:imported.body.id});
  const saved=await save();expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  expect((await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect(w.narration[0]).toMatchObject({mode:'manual',text:'已明确保存的人工口播。',adoptedAudioTrackId:null});expect(w.captions[0].contract).toEqual(caption);
  const audio=w.narration[0].audioTrackId,input=(await f.c.query('SELECT mode,narration_text,audio_track_id,preparation_revision_id FROM local_identity.workspace_narration_inputs WHERE workspace_id=$1 AND shot_id=$2',[w.id,clip.shotId])).rows[0];
  expect(input).toEqual({mode:'manual',narration_text:'已明确保存的人工口播。',audio_track_id:audio,preparation_revision_id:w.preparationRevisionId});
  const track=(await f.c.query('SELECT a.*,t.input_snapshot FROM public.audio_tracks a JOIN public.tasks t ON t.id=a.source_task_id WHERE a.id=$1',[audio])).rows[0];
  expect(track.preparation_revision_id).toBe(w.preparationRevisionId);expect(track.source_review_package_id).toBeNull();
  expect(track.input_snapshot.workspace_narration).toMatchObject({version:'workspace-narration/v2',workspace_id:w.id,shot_id:clip.shotId,preparation_revision_id:w.preparationRevisionId});
  expect(track.input_snapshot).not.toHaveProperty('storyboard_review_package_id');expect(track.input_snapshot).not.toHaveProperty('shot_preparation');
  const tasks=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n;
  const again=await save();expect(again.status).toBe(200);w=again.body;expect(w.narration[0].audioTrackId).toBe(audio);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(tasks);
  await f.restart();const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const reopened=(await response.json()).workspace;
  expect(reopened.narration[0]).toMatchObject({mode:'manual',text:'已明确保存的人工口播。',audioTrackId:audio,adoptedAudioTrackId:null});expect(reopened.captions[0].contract).toEqual(caption);
  const lifecycle=(command:string,data:Record<string,unknown>={},token=f.token)=>f.post('episode-lifecycle',command,{episodeId:f.newEpisode,...data},{token});
  expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);const plan=await lifecycle('planDeletion');expect(plan.status).toBe(200);
  const data={confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  expect((await lifecycle('deleteEpisode',data,f.otherToken)).status).toBe(404);expect((await lifecycle('deleteEpisode',{...data,confirmation:'incorrect'})).status).toBe(409);
  expect((await lifecycle('deleteEpisode',data)).status).toBe(200);
  for(const table of ['local_identity.workspace_narration_inputs','local_identity.production_preparation_revisions','public.audio_tracks'])expect((await f.c.query(`SELECT count(*)::int n FROM ${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[f.episode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([[false,false],[true,false],[false,true]])('current speech executes with independent preparation=%s and historical snapshot=%s and records its real audio provenance',async(independent,historicalSnapshot)=>{
 const f=await formalWorkflowFixture({controlled:true,freshAccount:true,scriptText:'# 独立生成\n\n## 正文\n\n当前确认的独立口播。'});
 try{
  expect((await f.send('start')).status).toBe(200);let legacyPreparation:string|undefined;
  if(historicalSnapshot){
   legacyPreparation=randomUUID();const location=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0],source=(await f.c.query('SELECT storage_path,sha256 FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0];
   const board={version:'storyboard/v1',audioCues:[],shots:[{id:'shot-01',scriptSegment:'当前确认的独立口播。',durationSeconds:5,targetSpec:'9:16',shotType:'b_roll',productionMethod:'历史测试来源',inputBasis:[{relativePath:source.storage_path,sha256:source.sha256}]}]},bytes=Buffer.from(JSON.stringify(board)+'\n'),file={relativePath:`${location.directory_relative_path}/preparation/${legacyPreparation}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
   await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes,{flag:'wx'});
   await seedRecordedWorkspacePreparation(f.c,{episodeId:f.newEpisode,scriptRevisionId:f.main!,preparationId:legacyPreparation,ownerId:f.owner,file,board});
  }
  const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main,...(legacyPreparation?{reviewPackageId:legacyPreparation}:{})});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;const clip=w.clips[0],settings=f.controlled!.narrationSettings;
  let preparation=w.preparationRevisionId;
  if(independent){
   preparation=randomUUID();const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0];
   const manifest={version:'production-preparation/v1',shots:[{id:clip.shotId,scriptSegment:'当前确认的独立口播。',durationSeconds:3,targetSpec:'9:16',visualSource:'image'}]},bytes=Buffer.from(JSON.stringify(manifest)+'\n');
   const file={relativePath:`${location.directory_relative_path}/preparation/${preparation}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
   await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes,{flag:'wx'});
   await ownerTransaction(f.pool,f.owner,false,c=>registerProductionPreparation(c,f.assetRoot,{episodeId:f.newEpisode,scriptRevisionId:f.main!,preparationRevisionId:preparation,file,manifest}));
   await f.c.query('UPDATE local_identity.production_workspaces SET preparation_revision_id=$2 WHERE id=$1',[w.id,preparation]);
   await f.c.query('UPDATE local_identity.production_preparation_revisions SET invalidated_at=clock_timestamp() WHERE id=$1',[w.preparationRevisionId]);
  }
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...(['saveWorkspaceNarration','confirmWorkspaceNarration','generateWorkspaceNarration'].includes(command)?{clipId:clip.id}:{}),...data});expect(r.status,`${command}: ${JSON.stringify(r.body)}`).toBe(200);w=r.body;};
  await send('saveWorkspaceNarration',{mode:'tts',...settings,text:'当前确认的独立口播。'});expect(w.narration[0]).toMatchObject({voice:settings.voice,speakingRate:1,languageCode:'zh-CN'});
  await send('confirmWorkspaceNarration');await send('generateWorkspaceNarration',{reservationCents:100});const id=w.narration[0].taskId;
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;
  expect(snapshot.workspace_narration).toMatchObject({version:'workspace-narration/v2',workspace_id:w.id,shot_id:clip.shotId,preparation_revision_id:preparation});
  expect(snapshot).not.toHaveProperty('shot_preparation');expect(snapshot).not.toHaveProperty('storyboard_review_package_id');expect(snapshot.audio_track).not.toHaveProperty('source_review_package_id');
  const dispatchCurrent=async()=>(await f.c.query("SELECT local_identity.provider_dispatch_context_current($1,'speech') valid",[id])).rows[0].valid;expect(await dispatchCurrent()).toBe(true);
  for(const patch of [{version:'workspace-narration/future'},{preparation_revision_id:randomUUID()},{workspace_id:randomUUID()},{shot_id:'unrelated-shot'}]){
   await f.c.query('BEGIN');try{await f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{workspace_narration}',input_snapshot->'workspace_narration'||$2::jsonb) WHERE id=$1",[id,JSON.stringify(patch)]);expect(await dispatchCurrent()).toBe(false);}finally{await f.c.query('ROLLBACK');}
  }
  await f.c.query('BEGIN');try{await f.c.query("UPDATE local_identity.workspace_narration_requests SET request_snapshot=jsonb_set(request_snapshot,'{target,preparationRevisionId}',to_jsonb($2::text)) WHERE task_id=$1",[id,randomUUID()]);expect(await dispatchCurrent()).toBe(false);}finally{await f.c.query('ROLLBACK');}
  expect(await dispatchCurrent()).toBe(true);
  if(historicalSnapshot){
   // Controlled original-format request, never a rewrite of real history or a product adapter write.
   await f.c.query("INSERT INTO public.shot_preparation_drafts(episode_id,review_package_id,shot_id,audio_mode,subtitle_text,tts_text,tts_voice,tts_speaking_rate,tts_language_code) VALUES($1,$2,$3,'tts',$4,$4,$5,1,'zh-CN')",[f.newEpisode,w.preparationRevisionId,clip.shotId,'当前确认的独立口播。',settings.voice]);
   const draft=(await f.c.query('SELECT id FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[f.newEpisode,w.preparationRevisionId,clip.shotId])).rows[0];
   const legacy={...snapshot,storyboard_review_package_id:w.preparationRevisionId,shot_preparation:{draft_id:draft.id,episode_id:f.newEpisode,review_package_id:w.preparationRevisionId,shot_id:clip.shotId},audio_track:{...snapshot.audio_track,source_review_package_id:w.preparationRevisionId}};delete legacy.workspace_narration;delete legacy.audio_track.preparation_revision_id;
   await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[id,legacy]);
   await f.c.query("UPDATE local_identity.workspace_narration_requests SET request_snapshot=jsonb_set(request_snapshot,'{target}',((request_snapshot->'target')-'preparationRevisionId')||jsonb_build_object('storyboardPackageId',$2::text)) WHERE task_id=$1",[id,w.preparationRevisionId]);
   expect(await dispatchCurrent()).toBe(true);
  }
  const task=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0];
  await f.controlled!.execute(id);await send('refreshWorkspaceNarration');expect(w.narration[0]).toMatchObject({status:'completed',text:'当前确认的独立口播。'});
  const audio=(await f.c.query('SELECT preparation_revision_id,source_review_package_id,id FROM public.audio_tracks WHERE source_task_id=$1',[id])).rows[0];expect(audio).toMatchObject({preparation_revision_id:historicalSnapshot?null:preparation,source_review_package_id:historicalSnapshot?w.preparationRevisionId:null});
  const proposal=await f.send('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:audio.id,durationPolicy:'use-candidate'});expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);
  await send('adoptWorkspaceCandidate',{candidateId:audio.id,adoptionId:proposal.body.adoptionId});expect(w.usedNarration[0]).toMatchObject({audioTrackId:audio.id,text:'当前确认的独立口播。'});
  expect((await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(historicalSnapshot?1:0);
  const retained=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;for(const key of ['workspace_narration','media','audio_track','production_context','workspace_target'])expect(retained[key]).toEqual(task.input_snapshot[key]);
 }finally{await f.close();}
},120000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('independent voice inputs retain Owner, current script, preparation, historical and direct-write fences',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 权限\n\n## 正文\n\n只允许当前所有者保存。'}),worker=f.workerPool();
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status).toBe(200);const w=made.body,shot=w.clips[0].shotId;
  const save=(owner=f.owner,target=shot,audio:string|null=null,mode='none')=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.save_production_narration_input($1,$2,$3,$4,$5,$6,$7,$8)',[w.id,target,mode,'Owner 的新输入',null,null,null,audio]));
  await save();const rows=async()=>(await f.c.query('SELECT * FROM local_identity.workspace_narration_inputs WHERE workspace_id=$1',[w.id])).rows,before=await rows();
  expect(await ownerTransaction(f.pool,f.other,true,async c=>(await c.query('SELECT * FROM local_identity.workspace_narration_inputs WHERE workspace_id=$1',[w.id])).rows)).toEqual([]);
  await expect(save(f.other)).rejects.toMatchObject({code:'42501'});await expect(save(f.owner,'missing-shot')).rejects.toMatchObject({code:'22023'});await expect(save(f.owner,shot,randomUUID(),'manual')).rejects.toMatchObject({code:'22023'});
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('UPDATE local_identity.workspace_narration_inputs SET narration_text=$2 WHERE workspace_id=$1',[w.id,'bypass']))).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT * FROM local_identity.workspace_narration_inputs')).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT local_identity.save_production_narration_input($1,$2,$3,$4,$5,$6,$7,$8)',[w.id,shot,'none','bypass',null,null,null,null])).rejects.toMatchObject({code:'42501'});
  await f.c.query('UPDATE public.episodes SET main_script_revision_id=NULL WHERE id=$1',[f.newEpisode]);await expect(save()).rejects.toMatchObject({code:'40001'});await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[f.newEpisode,f.main]);
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[f.newEpisode]);await expect(save()).rejects.toMatchObject({code:'40001'});await f.c.query('DELETE FROM local_identity.historical_episodes WHERE episode_id=$1',[f.newEpisode]);
  await f.c.query('UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1',[f.newEpisode]);await expect(save()).rejects.toMatchObject({code:'40001'});expect(await rows()).toEqual(before);
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('190 imports historical voice values and confirmation evidence exactly, rolls back atomically and restores the full nonempty graph',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated migration fixtures');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>f.version<'191-')},previous={...catalog,current:catalog.current.filter(f=>f.version<'190-')},seedCatalog={...previous,current:previous.current.filter(f=>f.version<'188-')};
 const suffix=randomBytes(6).toString('hex'),database='loop_voice_import_'+suffix,restored='loop_voice_restore_'+suffix,created:string[]=[];const sql=(q:string,db=database)=>context.sql(q,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(seedCatalog));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(previous.current.filter(f=>f.version>='188-')));
  sql(`UPDATE public.shot_preparation_drafts SET tts_voice='original-voice',tts_speaking_rate=1.25,tts_language_code='zh-CN',tts_override_voice='original-voice' WHERE episode_id='${ids.episode}';
   INSERT INTO local_identity.workspace_narrations(workspace_id,episode_id,clip_id,shot_id,mode,input_fingerprint,confirmed_fingerprint,manual_audio_track_id) VALUES('${ids.workspace}','${ids.episode}','${randomUUID()}','shot-01','manual',repeat('f',64),repeat('f',64),'${ids.audio}');`);
  const audioRows=JSON.parse(sql('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audio_tracks a'));
  const before=snapshot(),ledger=Object.fromEntries(Object.entries(before.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256])),pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(f=>f.version)).toEqual(['190-independent-workspace-narration-inputs.sql']);const migration=migrationTransaction(pending);
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());sql(migration);const after=snapshot();
  for(const [n,rows]of Object.entries(before.rows))if(n!=='public.audio_tracks')expect(after.rows[n],n).toEqual(rows);
  expect(JSON.parse(sql("SELECT jsonb_agg(to_jsonb(a)-'preparation_revision_id' ORDER BY id) FROM public.audio_tracks a"))).toEqual(audioRows);expect(sql('SELECT count(*) FROM public.audio_tracks WHERE preparation_revision_id IS NOT NULL')).toBe('0');
  expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);for(const item of before.security)if(item.identity!=='local_identity.lock_current_caption_workspace(p_workspace uuid)')expect(after.security).toContainEqual(item);
  expect(JSON.parse(sql(`SELECT jsonb_build_object('mode',mode,'text',narration_text,'voice',voice,'rate',speaking_rate,'language',language_code,'override',voice_override,'track',audio_track_id,'source',imported_from_package_id) FROM local_identity.workspace_narration_inputs WHERE workspace_id='${ids.workspace}'`))).toEqual({mode:'manual',text:'原采用口播',voice:'original-voice',rate:1.25,language:'zh-CN',override:true,track:ids.audio,source:ids.board});
  expect(()=>sql(`UPDATE local_identity.workspace_narration_inputs SET imported_from_package_id='${randomUUID()}' WHERE workspace_id='${ids.workspace}';`)).toThrow(/foreign key constraint/);
  expect(()=>sql(`UPDATE local_identity.workspace_narration_inputs SET imported_from_package_id=NULL WHERE workspace_id='${ids.workspace}';`)).toThrow(/check constraint/);
  const oldDelete=before.catalog.functions.find((f:any)=>f.schema==='public'&&f.name==='delete_episode').definition,newDelete=after.catalog.functions.find((f:any)=>f.schema==='public'&&f.name==='delete_episode').definition;
  const strip=(definition:string)=>definition.replace('DELETE FROM local_identity.workspace_narration_inputs WHERE episode_id = p_episode_id;\n\n','').replace(/DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;\nDELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;\nDELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;\n/g,'');
  expect(strip(newDelete)).toBe(strip(oldDelete));
  const applied=Object.fromEntries(Object.entries(after.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT confirmed_fingerprint FROM local_identity.workspace_narrations WHERE workspace_id='${ids.workspace}'`,restored)).toBe('f'.repeat(64));expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${ids.episode}'`,restored)).toBe(ids.audio);
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
