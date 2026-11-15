// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {canonicalFingerprint} from './configurationCommands';
import {csrfFor} from './sessions';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('174 preserves nonempty legacy review history through a full restore, removes only retired producers and fails closed',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Review cleanup requires an isolated fixture container');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const available=loadSchemaCatalog(process.cwd()),catalog={...available,current:available.current.filter(f=>Number(f.version.slice(0,3))<=174)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<174)},cleanup=catalog.current.find(f=>f.version==='174-remove-retired-shot-review-entries.sql')!;
 const removed=['local_identity.request_shot_revision(uuid,uuid,jsonb,text)','public.request_shot_structure_revision(uuid,uuid,jsonb,text)','public.canonical_storyboard_structure_revision_operation(jsonb)','public.create_storyboard_annotation(uuid,text,text)','public.review_pre_render_member(uuid,text,text,text)','public.create_storyboard_revision_task_after_changes_requested()','public.create_storyboard_revision_review_package()'];
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([a-z_.]+\([^;]*\));$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('('))));
 const triggers=new Set(['public.approvals.create_storyboard_revision_task_after_changes_requested','public.tasks.create_storyboard_revision_review_package_after_task']);
 const suffix=randomBytes(6).toString('hex'),source='loop_review_source_'+suffix,restored='loop_review_restore_'+suffix,created:string[]=[];
 const assetRoot=await realpath(await mkdtemp('/private/tmp/loop-review-history-')),stat=await lstat(assetRoot,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),episode=randomUUID(),task=randomUUID(),oldRevision=randomUUID(),board=randomUUID(),pre=randomUUID(),artifact=randomUUID();
 const asOwner=(id:string,q:string,db=restored)=>sql(`BEGIN; SELECT set_config('loop.owner_id','${id}',true); SET SESSION AUTHORIZATION loop_app; ${q}; COMMIT;`,db);
 try{
  for(const db of [source,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),source);
  sql(`BEGIN;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','review-history@example.invalid'),('${other}','review-other@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','review-history','Historical review fixture','Asia/Shanghai');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES('${account}','${assetRoot}','${stat.dev}','${stat.ino}');
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Retained old review','storyboard_review');
   INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES
    ('${task}','${episode}','generate_a_roll','completed','{"clip_selection":{"start_seconds":1,"duration_seconds":2},"input_artifacts":[]}','ffmpeg','historical','historical-v1'),
    ('${oldRevision}','${episode}','draft_storyboard_revision','ready','{"marker":"retained old revision","capability":"storyboard_planning"}','codex','historical','storyboard-revision-v1');
   INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES('${artifact}','${episode}','${task}','render','episodes/${episode}/historical.mp4','${'a'.repeat(64)}',123);
   INSERT INTO public.review_packages(id,episode_id,task_id,stage,revision_number,context_snapshot) VALUES
    ('${board}','${episode}','${task}','storyboard_review',1,'{"worker_result":{"storyboard":{"version":"storyboard/v1","shots":[{"id":"S01","scriptSegment":"历史完整正文","durationSeconds":3}]}}}'),
    ('${pre}','${episode}','${task}','production_ready',1,jsonb_build_object('storyboard_review_package_id','${board}'));
   INSERT INTO public.storyboard_review_shots(review_package_id,shot_id) VALUES('${board}','S01');
   INSERT INTO public.pre_render_review_members(review_package_id,member_key,member_kind,source_task_id,artifact_id,evidence_snapshot) VALUES('${pre}','shot:S01','shot_media','${task}','${artifact}','{"historical":"preserve exact evidence"}');
   INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2);
   COMMIT;`,source);
  // Populate the old records using their real Owner entrypoints, before removal.
  asOwner(owner,`SELECT public.create_storyboard_annotation('${board}','S01','Retain this historical note')`,source);
  asOwner(owner,`SELECT public.review_pre_render_member('${pre}','shot:S01','approved','Retain the original member decision')`,source);
  const before=snapshot(source),ledger=Object.fromEntries(Object.entries(before.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));
  expect(before.rows['public.review_annotations'].rows).toBe(1);expect(before.rows['public.pre_render_review_member_decisions'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  sql(`CREATE VIEW public.review_cleanup_dependency AS SELECT review_package_id FROM public.review_pre_render_member(NULL::uuid,'probe','approved','dependency')`);
  expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.review_cleanup_dependency');assertRestored(before,snapshot());
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));
  const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const removedFunctions=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(removedFunctions).toHaveLength(7);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name)),triggers:before.catalog.triggers.filter((t:{table:string;name:string})=>!triggers.has(t.table+'.'+t.name))});
  const removedAcl=new Set(removedFunctions.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));
  expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!removedAcl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const finalLedger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(finalLedger).toEqual({...ledger,[cleanup.version]:cleanup.sha256});expect(schemaMigrationPlan(finalLedger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  const read=`SELECT jsonb_build_object('annotations',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.review_annotations a WHERE review_package_id='${board}'),'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.pre_render_review_member_decisions d WHERE review_package_id='${pre}'))`;
  expect(asOwner(owner,read)).toContain('Retain this historical note');expect(asOwner(owner,read)).toContain('Retain the original member decision');
  expect(asOwner(other,read)).toContain('"decisions": []');expect(asOwner(other,read)).toContain('"annotations": []');
  for(const actor of ['loop_app','loop_worker'])for(const call of [
   `local_identity.request_shot_revision('${episode}','${board}','{"kind":"delete","shotId":"S01"}','retired')`,
   `public.request_shot_structure_revision('${episode}','${board}','{"kind":"delete","shotId":"S01"}','retired')`,
   `public.create_storyboard_annotation('${board}','S01','retired')`,
   `public.review_pre_render_member('${pre}','shot:S01','changes_requested','retired')`,
  ])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42883/);
  expect(()=>asOwner(owner,`INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id) VALUES('${episode}','storyboard_review','changes_requested','Direct write denied','${owner}')`)).toThrow(/42501/);
  expect(sql(`SELECT local_identity.current_worker_task(t) FROM public.tasks t WHERE id='${oldRevision}'`)).toBe('f');
  expect(sql(`SET SESSION AUTHORIZATION loop_worker; SELECT count(*) FROM local_identity.claim_input_task('${oldRevision}',2)`)).toBe('0');
  // Neither a rejected caller nor an old Worker claim may alter retained history.
  assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(assetRoot,{recursive:true,force:true});}}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired shot review HTTP requests preserve Owner and CSRF fences and never replay a successful old receipt',async()=>{
 const f=await formalWorkflowFixture({blank:true});try{
  const state=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.tasks t WHERE episode_id=$1),'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.review_packages p WHERE episode_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.audit_events a WHERE episode_id=$1)) value",[f.newEpisode])).rows[0].value;
  const before=await state();
  for(const command of ['requestStructureRevision','annotateStoryboard']){
   const data={episodeId:f.newEpisode,reviewPackageId:randomUUID(),shotId:'S01',operation:{kind:'delete',shotId:'S01'},reason:'Retired Owner request'},idempotencyKey=randomUUID(),body={command,data,idempotencyKey};
   await f.c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[f.owner,idempotencyKey,canonicalFingerprint(body),{legacySuccess:true}]);
   const send=async(token=f.token,csrf=true)=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
   expect((await send(randomUUID())).status).toBe(401);expect((await send(f.token,false)).status).toBe(403);expect((await send(f.otherToken)).status).toBe(404);
   for(let i=0;i<2;i++){const response=await send();expect(response.status,JSON.stringify(response.body)).toBe(410);expect(response.body.legacySuccess).toBeUndefined();}
  }
  expect((await f.request('reviewPreRenderMember',{episodeId:f.newEpisode,reviewPackageId:randomUUID(),memberKey:'shot:S01',decision:'changes_requested',reason:'Unknown old command'})).status).toBe(400);
  expect(await state()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a leased historical revision result retains evidence without producing or approving a new storyboard and keeps lease and frozen-path guards',async()=>{
 const f=await productionWorkspaceFixture(),worker=f.workerPool();try{
  const task=randomUUID(),lease=randomUUID(),path=`${f.episodeRelativePath}/native-tasks/${task}/historical-storyboard.json`,storyboard={version:'storyboard/v1',shots:[{id:'old-S01',scriptSegment:'历史原文不覆盖当前正文。',durationSeconds:3}]},bytes=Buffer.from(JSON.stringify(storyboard)),sha=createHash('sha256').update(bytes).digest('hex');
  await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=$1',[f.episode]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,max_attempts,claimed_at,lease_token,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'draft_storyboard_revision','running',1,1,clock_timestamp(),$3,'codex','historical','storyboard-revision-v1',$4)",[task,f.episode,lease,{capability:'storyboard_planning',native_episode_relative_path:f.episodeRelativePath,native_output_namespace:task,output:{required_artifact_types:['storyboard'],relative_path:path,content_type:'application/json',review_stage:'storyboard_review'},storyboard_revision:{base_review_package_id:f.board}}]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,started_at,lease_token) VALUES($1,0,'running','{}',clock_timestamp(),$2)",[task,lease]);
  const evidence=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'packages',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.review_packages p WHERE episode_id=$1),'approvals',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.approvals a WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const before=await evidence(),port=nativeWorkerPort(worker),artifact={artifactType:'storyboard',relativePath:path,sha256:sha,fileSize:bytes.length};
  expect((await f.c.query("SELECT local_identity.input_task_allowed($1,'draft_storyboard_revision') allowed",[f.episode])).rows[0].allowed).toBe(true);
  expect((await f.c.query('SELECT local_identity.current_worker_task(t) allowed FROM public.tasks t WHERE id=$1',[task])).rows[0].allowed).toBe(false);
  const result={version:'worker-result/v1',taskId:task,status:'completed',storyboard,artifacts:[artifact],validation:{passed:true,checks:[{name:'historical_evidence',passed:true,detail:'Retain the original result without automatic review approval.'}]},actualCostCents:0,retry:{shouldRetry:false,reason:'Historical receipt only.'},blockers:[],nextStep:'Retain historical evidence.'};
  const report=(p_result:unknown,p_lease_token=lease)=>port.rpc('report_worker_result',{p_task_id:task,p_attempt:0,p_lease_token,p_result});
  await expect(report(result,randomUUID())).rejects.toMatchObject({code:'42501'});
  await expect(report({...result,artifacts:[{...artifact,relativePath:path.replace('historical-storyboard','wrong-output')}]})).rejects.toMatchObject({code:'22023'});
  expect((await f.c.query("SELECT status,(SELECT count(*)::int FROM public.artifacts WHERE producer_task_id=$1) artifacts FROM public.tasks WHERE id=$1",[task])).rows[0]).toEqual({status:'running',artifacts:0});
  await report(result);
  expect((await f.c.query('SELECT status,lease_token FROM public.tasks WHERE id=$1',[task])).rows[0]).toEqual({status:'completed',lease_token:null});
  expect((await f.c.query('SELECT relative_path,sha256,file_size FROM public.artifacts WHERE producer_task_id=$1',[task])).rows).toEqual([{relative_path:path,sha256:sha,file_size:String(bytes.length)}]);
  expect((await f.c.query('SELECT result FROM public.task_runs WHERE task_id=$1 AND attempt=0',[task])).rows[0].result).toEqual(result);
  expect(await evidence()).toEqual(before);
 }finally{await worker.end();await f.close();}
},120000);
