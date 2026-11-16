// @vitest-environment node
import {expect,it} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {nativeWorkerPort} from './workerDatabase';
import {ownerTransaction} from './ownerTransaction';
import {shotCaptionContractToDatabase} from '../shotCaptions';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {seedHistoricalPreparation} from './historicalPreparation.fixture';
import {registerProductionPreparation} from './productionPreparationStore';
import {narrationFixture} from './workspaceNarration.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('new workspace caption preparation and edits never create retired shot drafts and survive reopen',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 独立字幕\n\n## 正文\n\n字幕与旧审核草稿分开保存。'});
 try{
  expect((await f.send('start')).status).toBe(200);
  const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const retired=async()=>(await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.newEpisode])).rows[0].n;
  expect(await retired()).toBe(0);
  const contract=defaultShotCaptionContract('独立保存的新字幕','independent');contract.cues=[{id:'owner-caption',text:contract.text,startMs:0,endMs:1200}];
  const saved=await f.send('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  expect(w.captions[0].contract.text).toBe(contract.text);expect(w.captions[0].timing).toBe('current');expect(await retired()).toBe(0);
  const persisted=(await f.c.query('SELECT contract FROM local_identity.workspace_caption_inputs WHERE workspace_id=$1 AND shot_id=$2',[w.id,w.clips[0].shotId])).rows;
  expect(persisted).toHaveLength(1);expect(persisted[0].contract).toMatchObject({text:contract.text,content_mode:'independent'});
  await f.restart();
  const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const reopened=(await response.json()).workspace;
  expect(reopened.captions[0].contract).toEqual(w.captions[0].contract);expect(reopened.captions[0].timing).toBe('current');expect(await retired()).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('speech submission freezes the current independent caption input without rewriting the historical caption cache',async()=>{
 const f=await narrationFixture();
 try{
  let w=f.made;const clip=w.clips[0];
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.chosenRequest(command,{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,...data});expect(r.status,`${command}: ${JSON.stringify(r.body)}`).toBe(200);w=r.body;};
  await send('saveWorkspaceNarration',{mode:'tts',text:'真正提交的口播正文。'});
  const original=(await f.c.query('SELECT subtitle_text,caption_contract FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[f.episode,f.board,clip.shotId])).rows;
  const contract=defaultShotCaptionContract('这份字幕来自当前独立输入。','independent');contract.cues=[{id:'current-caption',text:contract.text,startMs:0,endMs:900}];
  await send('saveWorkspaceCaptions',{captionContract:contract});await send('confirmWorkspaceNarration');await send('generateWorkspaceNarration');
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[w.narration[0].taskId])).rows[0].input_snapshot;
  expect(snapshot.acoustic_alignment.confirmed_text).toBe(contract.text);expect(snapshot.media.narration.text).toBe('真正提交的口播正文。');
  expect((await f.c.query('SELECT subtitle_text,caption_contract FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[f.episode,f.board,clip.shotId])).rows).toEqual(original);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('adopted native audio can align and confirm current captions without any retired draft and rejects a late result after editing',async()=>{
 const f=await productionWorkspaceFixture({runtime:{postReady:async()=>{},wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,alignment_enabled=true WHERE episode_id=$1',[f.episode]);
  // The historical project fixture predates the current explicit material approval receipt.
  await f.c.query('INSERT INTO public.material_revision_approvals(material_revision_id,approved_by) VALUES($1,$2)',[f.script,f.owner]);
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,...data});expect(r.status,`${command}: ${JSON.stringify(r.body)}`).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=await f.request('importMaterial',{sourceKind:'file',sourcePath:'voice.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(upload.status).toBe(200);
  await send('saveWorkspaceNarration',{mode:'manual',text:'独立字幕对齐。',materialRevisionId:upload.body.id});await send('confirmWorkspaceNarration');
  const candidate=w.candidates.find((c:any)=>c.id===w.narration[0].audioTrackId),prepared=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate'});expect(prepared.status).toBe(200);
  const adopted=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status).toBe(200);w=adopted.body;
  const port=nativeWorkerPort(worker),claim=async(id:string)=>(await port.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1})as any[])[0];
  const complete=async(task:any,model?:string)=>{
   expect(task?.task_id).toBeTruthy();const frozen=task.input_snapshot.acoustic_alignment;
   const result={version:'acoustic-alignment/v1',status:'completed',method:'local_whisperx',granularity:'phrase',inputVersion:frozen.input_version,audioSha256:frozen.audio_sha256,textFingerprint:frozen.text_fingerprint,provider:'whisperx',model:model??task.model,connectionVersionId:null,wordCount:1,cues:[{id:'aligned',text:frozen.confirmed_text,startMs:100,endMs:900,confidence:.99}],reviewIssues:[],attempts:[],detail:'Controlled alignment response',generatedAt:new Date().toISOString()};
   const bytes=Buffer.from(JSON.stringify(result)),path=task.input_snapshot.output.relative_path;await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
   await port.rpc('report_worker_result',{p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token,p_result:{version:'worker-result/v1',taskId:task.task_id,status:'completed',acousticAlignment:result,artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],validation:{passed:true,checks:[{name:'controlled_alignment',passed:true,detail:'Fixed external seam response'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'completed'},nextStep:'Owner checks timing'}});
  };
  const contract=defaultShotCaptionContract('独立字幕对齐。','independent');contract.cues=[{id:'manual',text:contract.text,startMs:0,endMs:900}];
  await send('saveWorkspaceCaptions',{captionContract:contract});
  // Retain the original unversioned task contract: readable only against its proven original baseline.
  // Explicit historical fixture: current manual upload no longer fabricates this retired row.
  const oldDraft=(await f.c.query("INSERT INTO public.shot_preparation_drafts(episode_id,review_package_id,shot_id,audio_mode,subtitle_text,current_audio_track_id) VALUES($1,$2,$3,'source',$4,$5) ON CONFLICT(episode_id,review_package_id,shot_id) DO UPDATE SET subtitle_text=excluded.subtitle_text,current_audio_track_id=excluded.current_audio_track_id RETURNING id",[f.episode,f.board,w.clips[0].shotId,contract.text,candidate.id])).rows[0].id;
  expect((await f.c.query("SELECT to_regprocedure('local_identity.request_workspace_caption_alignment(uuid,uuid,text,boolean,uuid,text,uuid)') value")).rows[0].value).toBeNull();
  // Recorded unversioned task, created only by the fixture: no legacy queue is retained.
  const oldId=randomUUID(),oldAudio=(await f.c.query('SELECT relative_path,sha256,file_size FROM public.audio_tracks WHERE id=$1',[candidate.id])).rows[0],oldModel='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn';
  const oldSnapshot={capability:'acoustic_alignment',workspace_caption:{workspace_id:w.id,shot_id:w.clips[0].shotId},shot_preparation:{draft_id:oldDraft,review_package_id:f.board,shot_id:w.clips[0].shotId},
   executor:{provider:'whisperx',adapter:'whisperx_local',model:oldModel,prompt_version:'whisperx-alignment-v1'},
   acoustic_alignment:{confirmed_text:contract.text,text_fingerprint:createHash('sha256').update(contract.text).digest('hex'),audio_relative_path:oldAudio.relative_path,audio_sha256:oldAudio.sha256,input_version:createHash('sha256').update('retained pre-independent alignment').digest('hex'),voice:'',speaking_rate:1,strategy:'local'},
   input_artifacts:[{artifactType:'audio_track',relativePath:oldAudio.relative_path,sha256:oldAudio.sha256,fileSize:Number(oldAudio.file_size)}],
   output:{required_artifact_types:['acoustic_alignment_evidence'],content_type:'application/json',relative_path:`${f.episodeRelativePath}/alignment/${oldId}.json`,review_stage:'production_ready'},allowed_tools:['read','write']};
  const old=(await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES($1,$2,'align_shot_captions','ready',$3,0,2,'whisperx',$4,'whisperx-alignment-v1') RETURNING *",[oldId,f.episode,oldSnapshot,oldModel])).rows[0];
  await f.c.query("UPDATE local_identity.workspace_caption_evidence SET task_id=$2,method='waiting' WHERE workspace_id=$1 AND shot_id=$3",[w.id,old.id,w.clips[0].shotId]);
  await complete(await claim(old.id));
  expect((await f.request('prepareWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:old.id,expectedInputFingerprint:w.captions[0].inputFingerprint})).status).toBe(200);
  const next=randomUUID(),manifest=(await f.c.query('SELECT manifest FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0].manifest,location=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path;
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n'),file={relativePath:`${location}/preparation/${next}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes);
  await ownerTransaction(f.pool,f.owner,false,c=>registerProductionPreparation(c,f.assetRoot,{episodeId:f.episode,scriptRevisionId:f.script,preparationRevisionId:next,file,manifest}));
  // Isolate a baseline replacement while preserving exactly the same native project, text and audio.
  await f.c.query('UPDATE local_identity.production_workspaces SET preparation_revision_id=$2 WHERE id=$1',[w.id,next]);
  const wrongBaseline=await f.request('prepareWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:old.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(wrongBaseline.status,JSON.stringify(wrongBaseline.body)).toBe(409);
  expect((await f.c.query('SELECT preparation_revision_id,project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0]).toEqual({preparation_revision_id:next,project_sha256:w.project.sha256});
  await f.c.query('UPDATE local_identity.production_workspaces SET preparation_revision_id=$2 WHERE id=$1',[w.id,f.board]);
  // Model a current native project whose registered adopted voice no longer has an old input row.
  await f.c.query('UPDATE local_identity.workspace_caption_inputs SET imported_from_draft_id=NULL,imported_from_package_id=NULL WHERE episode_id=$1',[f.episode]);
  await f.c.query('UPDATE local_identity.workspace_narration_inputs SET imported_from_draft_id=NULL,imported_from_package_id=NULL WHERE episode_id=$1',[f.episode]);
  await f.c.query('DELETE FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.episode]);
  await send('saveWorkspaceCaptions',{captionContract:contract});
  let request=await send('requestWorkspaceCaptionAlignment',{localOnly:true});w=request.workspace;
  expect(request.task.input_snapshot).not.toHaveProperty('shot_preparation');
  expect(request.task.input_snapshot.workspace_caption).toMatchObject({version:'workspace-caption/v2',workspace_id:w.id,preparation_revision_id:f.board,shot_id:w.clips[0].shotId});
  await complete(await claim(request.task.id),'wrong-frozen-model');
  const wrongModel=await f.request('prepareWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:request.task.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(wrongModel.status,JSON.stringify(wrongModel.body)).toBe(409);
  request=await send('requestWorkspaceCaptionAlignment',{localOnly:true});w=request.workspace;
  await complete(await claim(request.task.id));
  await send('applyWorkspaceCaptionAlignment',{taskId:request.task.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(w.captions[0].contract.cues[0].startMs).toBe(100);
  await send('confirmWorkspaceCaptionText',{expectedInputFingerprint:w.captions[0].inputFingerprint});expect(w.captions[0].textConfirmed).toBe(true);
  const queued=await send('requestWorkspaceCaptionAlignment',{localOnly:true});w=queued.workspace;const before=w.captions[0].inputFingerprint,late=await claim(queued.task.id);
  await send('saveWorkspaceCaptions',{captionContract:{...contract,text:'修改后的字幕。',cues:[]}});await complete(late);
  const stale=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:late.task_id,expectedInputFingerprint:before});expect(stale.status,JSON.stringify(stale.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await worker.end();await f.close();}
},150000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('caption inputs preserve Owner, current-preparation and direct-write fences and follow the original exact deletion protocol',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 权限与删除\n\n## 正文\n\n只有所有者可以保存当前字幕。'});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const contract=shotCaptionContractToDatabase(defaultShotCaptionContract('独立字幕','independent'));
  const save=(owner=f.owner,clip=w.clips[0].id,input:unknown=contract)=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.save_production_caption_input($1,$2,$3)',[w.id,clip,input]));
  const rows=async()=>(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.workspace_caption_inputs i WHERE episode_id=$1 ORDER BY shot_id',[f.newEpisode])).rows;
  const before=await rows();
  await expect(save(f.other)).rejects.toMatchObject({code:'42501'});
  expect(await ownerTransaction(f.pool,f.other,true,async c=>(await c.query('SELECT * FROM local_identity.workspace_caption_inputs WHERE episode_id=$1',[f.newEpisode])).rowCount)).toBe(0);
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('UPDATE local_identity.workspace_caption_inputs SET contract=$2 WHERE workspace_id=$1',[w.id,contract]))).rejects.toMatchObject({code:'42501'});
  const worker=f.workerPool();try{await expect(worker.query('SELECT local_identity.save_production_caption_input($1,$2,$3)',[w.id,w.clips[0].id,contract])).rejects.toMatchObject({code:'42501'});}finally{await worker.end();}
  await expect(save(f.owner,randomUUID())).rejects.toMatchObject({code:'22023'});await expect(save(f.owner,w.clips[0].id,{})).rejects.toMatchObject({code:'22023'});
  await expect(save(f.owner,w.clips[0].id,{...contract,content_mode:'follow_tts'})).rejects.toMatchObject({code:'40001'});
  expect(await rows()).toEqual(before);
  const lifecycle=(command:string,data:Record<string,unknown>={},token=f.token)=>f.post('episode-lifecycle',command,{episodeId:f.newEpisode,...data},{token});
  expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);await expect(save()).rejects.toMatchObject({code:'40001'});
  const plan=await lifecycle('planDeletion');expect(plan.status,JSON.stringify(plan.body)).toBe(200);const data={confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  expect((await lifecycle('deleteEpisode',data,f.otherToken)).status).toBe(404);expect((await lifecycle('deleteEpisode',{...data,confirmation:'wrong'})).status).toBe(409);expect(await rows()).toEqual(before);
  const deleted=await lifecycle('deleteEpisode',data);expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);expect(await rows()).toEqual([]);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[f.episode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('189 imports nonempty historical caption inputs without changing any original row and preserves atomic rollback and full restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated migration fixtures');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>f.version<'190-')},previous={...catalog,current:catalog.current.filter(f=>f.version<'189-')},seedCatalog={...previous,current:previous.current.filter(f=>f.version<'188-')};
 const suffix=randomBytes(6).toString('hex'),database='loop_caption_import_'+suffix,restored='loop_caption_restore_'+suffix,created:string[]=[];const sql=(q:string,db=database)=>context.sql(q,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(seedCatalog));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(previous.current.filter(f=>f.version.startsWith('188-'))));
  const literal=shotCaptionContractToDatabase(defaultShotCaptionContract('原字幕，原样保留。','independent'));literal.cues=[{id:'original-cue',text:literal.text,start_ms:150,end_ms:1200}];
  sql(`UPDATE public.shot_preparation_drafts SET caption_contract='${JSON.stringify(literal)}'::jsonb WHERE episode_id='${ids.episode}';`);
  const before=snapshot(),ledger=Object.fromEntries(Object.entries(before.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256])),pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(f=>f.version)).toEqual(['189-independent-workspace-caption-inputs.sql']);const migration=migrationTransaction(pending);
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  sql(migration);const after=snapshot();for(const [n,rows]of Object.entries(before.rows))expect(after.rows[n],n).toEqual(rows);
  expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);for(const item of before.security)expect(after.security).toContainEqual(item);
  expect(JSON.parse(sql(`SELECT contract FROM local_identity.workspace_caption_inputs WHERE workspace_id='${ids.workspace}' AND preparation_revision_id='${ids.board}'`))).toEqual(literal);
  expect(()=>sql(`UPDATE local_identity.workspace_caption_inputs SET imported_from_package_id='${randomUUID()}' WHERE workspace_id='${ids.workspace}';`)).toThrow(/foreign key constraint/);
  expect(()=>sql(`UPDATE local_identity.workspace_caption_inputs SET shot_id='wrong-original-shot' WHERE workspace_id='${ids.workspace}';`)).toThrow(/foreign key constraint/);
  expect(()=>sql(`UPDATE local_identity.workspace_caption_inputs SET imported_from_package_id=NULL WHERE workspace_id='${ids.workspace}';`)).toThrow(/check constraint/);
  assertRestored(after,snapshot());
  const cleanup='DELETE FROM local_identity.workspace_caption_inputs WHERE episode_id = p_episode_id;\n\n';const original=before.catalog.functions.find((f:any)=>f.schema==='public'&&f.name==='delete_episode'),current=after.catalog.functions.find((f:any)=>f.schema==='public'&&f.name==='delete_episode');expect(current.definition.replace(cleanup,'')).toBe(original.definition);
  const applied=Object.fromEntries(Object.entries(after.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${ids.episode}'`,restored)).toBe(ids.audio);
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
