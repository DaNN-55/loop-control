// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,unlink,chmod,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {seedHistoricalPreparation,seedRecordedWorkspacePreparation} from './historicalPreparation.fixture';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('imports an existing preparation deterministically without rewriting the old package, project, shots, tasks or audio and refuses conflicting provenance',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const source=(await f.c.query('SELECT to_jsonb(p) value FROM public.review_packages p WHERE p.id=$1',[f.board])).rows[0].value;
  const originalBytes=await readFile(join(f.assetRoot,w.project.relativePath));
  const facts=async()=>({
   tasks:(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,
   audio:(await f.c.query('SELECT to_jsonb(a) value FROM public.audio_tracks a WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,
   drafts:(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,
   workspace:(await f.c.query("SELECT to_jsonb(w)-'preparation_revision_id' value FROM local_identity.production_workspaces w WHERE id=$1",[w.id])).rows[0].value,
  });
  const before=await facts();
  const adopt=(script=f.script,owner=f.owner)=>ownerTransaction(f.pool,owner,false,async c=>(await c.query('SELECT local_identity.adopt_production_preparation($1,$2,$3) id',[f.episode,script,f.board])).rows[0].id);
  expect(await adopt()).toBe(f.board);expect(await adopt()).toBe(f.board);
  const baseline=(await f.c.query('SELECT * FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0];
  expect(baseline).toMatchObject({episode_id:f.episode,script_revision_id:f.script,source_format:'storyboard/v1',source_reference_id:f.board,origin:'historical-import'});
  expect(baseline.source_evidence.package).toEqual(source);
  expect(baseline.manifest.version).toBe('production-preparation/v1');
  expect(baseline.manifest.shots.map((s:any)=>({id:s.id,text:s.scriptSegment,oldClassification:Object.hasOwn(s,'shotType')}))).toEqual([
   {id:'shot-1',text:'第一镜',oldClassification:false},{id:'shot-2',text:'缺少素材的第二镜。',oldClassification:false},
  ]);
  expect((await f.c.query('SELECT shot_id,baseline_text FROM local_identity.production_shot_versions WHERE preparation_revision_id=$1 ORDER BY position',[f.board])).rows).toEqual([
   {shot_id:'shot-1',baseline_text:'第一镜'},{shot_id:'shot-2',baseline_text:'缺少素材的第二镜。'},
  ]);
  expect(await facts()).toEqual(before);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(originalBytes);
  expect((await f.c.query('SELECT to_jsonb(p) value FROM public.review_packages p WHERE id=$1',[f.board])).rows[0].value).toEqual(source);
  await expect(adopt(f.script,f.other)).rejects.toMatchObject({code:'42501'});
  await expect(adopt(randomUUID())).rejects.toMatchObject({code:'40001'});
  const worker=f.workerPool();try{await expect(worker.query('SELECT local_identity.adopt_production_preparation($1,$2,$3)',[f.episode,f.script,f.board])).rejects.toMatchObject({code:'42501'});}finally{await worker.end();}
  await f.c.query("UPDATE public.review_packages SET context_snapshot=jsonb_set(context_snapshot,'{worker_result,storyboard,shots,0,scriptSegment}',to_jsonb('changed source'::text)) WHERE id=$1",[f.board]);
  await expect(adopt()).rejects.toMatchObject({code:'40001'});
  expect((await f.c.query('SELECT manifest,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0]).toEqual({manifest:baseline.manifest,source_evidence:baseline.source_evidence});
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('formatting-only script continuation keeps canonical shot versions and their authored origin including locally added shots',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 制作样例\n\n## 正文\n\n第一段。\n\n第二段。'});
 try{
  expect((await f.send('start')).status).toBe(200);
  // This case intentionally preserves populated authored-era input rows. New default preparations no longer create that legacy source.
  const id=randomUUID(),location=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0],source=(await f.c.query('SELECT storage_path,sha256 FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0];
  const board={version:'storyboard/v1',audioCues:[],shots:['第一段。','第二段。'].map((scriptSegment,index)=>({id:'shot-'+String(index+1).padStart(2,'0'),scriptSegment,durationSeconds:5,targetSpec:'9:16',shotType:'b_roll',productionMethod:'历史作者基准',inputBasis:[{relativePath:source.storage_path,sha256:source.sha256}]}))},bytes=Buffer.from(JSON.stringify(board)+'\n'),file={relativePath:`${location.directory_relative_path}/preparation/${id}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
  await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes,{flag:'wx'});await seedRecordedWorkspacePreparation(f.c,{episodeId:f.newEpisode,scriptRevisionId:f.main!,preparationId:id,ownerId:f.owner,file,board});
  const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main,reviewPackageId:id});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const inserted=await f.send('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'人工新增镜头'}});expect(inserted.status,JSON.stringify(inserted.body)).toBe(200);w=inserted.body;
  const previous=w.storyboardPackageId,oldProject=w.project,oldClips=w.clips;
  // A migrated workspace retains its original old-table rows; current continuation must not copy them again.
  await f.c.query("INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,snapshot) SELECT $1,$2,shot_id,CASE origin WHEN 'local' THEN 'local-added' ELSE 'script-segment' END,baseline_text,snapshot FROM local_identity.production_shot_versions WHERE preparation_revision_id=$2",[w.id,previous]);
  const oldInputs=(await f.c.query('SELECT to_jsonb(s) value FROM local_identity.workspace_shot_inputs s WHERE workspace_id=$1 ORDER BY shot_id',[w.id])).rows.map(r=>r.value);
  await f.c.query("UPDATE local_identity.production_preparation_revisions SET source_evidence=jsonb_set(source_evidence,'{shot_inputs}',$2::jsonb) WHERE id=$1",[previous,JSON.stringify(oldInputs)]);
  const versions=async(id:string)=>(await f.c.query('SELECT shot_id,position,origin,baseline_text,snapshot FROM local_identity.production_shot_versions WHERE preparation_revision_id=$1 ORDER BY position',[id])).rows;
  const original=await versions(previous);expect(w.preparation.origin).toBe('script-segment');expect(original).toHaveLength(3);
  const revision=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:'# 制作样例\n## 正文\n> 第一段。\n> 第二段。\n',reason:'仅排版'});expect(revision.status,JSON.stringify(revision.body)).toBe(200);
  const resumed=await f.send('resumeWorkspaceEditing',{workspaceId:w.id,expectedRevision:w.revision,expectedScriptRevisionId:revision.body.id,expectedProjectSha256:oldProject.sha256});expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);w=resumed.body;
  expect(w.preparation.origin).toBe('script-segment');expect(w.project).toEqual(oldProject);expect(w.clips).toEqual(oldClips);
  expect(await versions(w.storyboardPackageId)).toEqual(original);expect(await versions(previous)).toEqual(original);
  expect((await f.c.query('SELECT parent_preparation_revision_id FROM local_identity.production_preparation_revisions WHERE id=$1',[w.storyboardPackageId])).rows[0].parent_preparation_revision_id).toBe(previous);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspace_versions v LEFT JOIN local_identity.production_preparation_revisions p ON p.id=v.preparation_revision_id WHERE v.workspace_id=$1 AND (p.id IS NULL OR p.script_revision_id<>v.script_revision_id)',[w.id])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspace_versions WHERE workspace_id=$1 AND script_revision_id=$2 AND preparation_revision_id=$3',[w.id,revision.body.id,w.storyboardPackageId])).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT to_jsonb(s) value FROM local_identity.workspace_shot_inputs s WHERE workspace_id=$1 ORDER BY shot_id',[w.id])).rows.map(r=>r.value)).toEqual(oldInputs);
  expect((await f.c.query('SELECT source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[w.storyboardPackageId])).rows[0].source_evidence.shot_inputs).toEqual(oldInputs);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['missing','sha','size','manifest','permission'] as const)('known canonical preparations still verify their actual frozen file on current reads and commands (%s)',async kind=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 let original:Buffer|undefined;
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const source=(await f.c.query('SELECT file_reference,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0];
  original=await readFile(join(f.assetRoot,f.boardPath));
  if(kind==='missing')await unlink(join(f.assetRoot,f.boardPath));
  else if(kind==='sha'){const corrupt=Buffer.from(original);corrupt[0]^=1;await writeFile(join(f.assetRoot,f.boardPath),corrupt);}
  else if(kind==='size')await writeFile(join(f.assetRoot,f.boardPath),Buffer.concat([original,Buffer.from(' ')]));
  else if(kind==='permission')await chmod(join(f.assetRoot,f.boardPath),0o000);
  else{
   const altered=JSON.parse(original.toString('utf8'));altered.shots[0].scriptSegment='文件与声明不同。';const bytes=Buffer.from(JSON.stringify(altered)),sha=createHash('sha256').update(bytes).digest('hex');
   await writeFile(join(f.assetRoot,f.boardPath),bytes);
   // Reproduce a restored metadata-only import: its declared hash matches bytes, but its frozen JSON does not.
   const evidence=structuredClone(source.source_evidence);evidence.artifact.sha256=sha;evidence.artifact.file_size=bytes.length;
   await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=$1',[evidence.artifact.id,sha,bytes.length]);
   await f.c.query('UPDATE local_identity.production_preparation_revisions SET file_reference=$2,source_evidence=$3 WHERE id=$1',[f.board,{...source.file_reference,sha256:sha,fileSize:bytes.length},evidence]);
  }
  expect((await f.c.query('SELECT local_identity.preparation_source_current($1) current',[f.board])).rows[0].current).toBe(true); // SQL metadata alone cannot prove host bytes.
  const denied=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'不得写入'}});expect(denied.status,JSON.stringify(denied.body)).toBe(409);
  expect((await f.c.query('SELECT revision,project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0]).toEqual({revision:String(w.revision),project_sha256:w.project.sha256});
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);const observed=(await read.json()).workspace;
  expect(observed.readiness.deliverable).toBe(false);expect(observed.readiness.missingSources).toContain(f.boardPath);
 }finally{if(original){if(kind==='permission')await chmod(join(f.assetRoot,f.boardPath),0o644);await writeFile(join(f.assetRoot,f.boardPath),original);}await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('current Owner preparation and native shot edits use canonical lineage without writing the old workspace shot-input table',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  expect((await f.c.query('SELECT preparation_revision_id FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].preparation_revision_id).toBe(f.board);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);
  const frozen=(await f.c.query('SELECT manifest,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0];
  const changed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'原生新增镜头'}});expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;
  expect(w.clips).toHaveLength(3);const added=w.clips.find((c:any)=>!['shot-1','shot-2'].includes(c.shotId));expect(added).toBeTruthy();
  expect((await f.c.query('SELECT origin FROM local_identity.production_shot_versions WHERE preparation_revision_id=$1 AND shot_id=$2',[f.board,added.shotId])).rows[0].origin).toBe('local');
  expect((await f.c.query('SELECT manifest,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[f.board])).rows[0]).toEqual(frozen);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);
  await f.restart();const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const reopened=(await response.json()).workspace;
  expect(reopened.clips.map((c:any)=>c.id)).toEqual(w.clips.map((c:any)=>c.id));expect(reopened.preparation.shots.find((s:any)=>s.shotId===added.shotId).origin).toBe('local-added');
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('188 backfills original preparation and local-shot lineage atomically, keeps every old field and source, refuses script ambiguity and restores the nonempty graph',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated migration fixtures');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>f.version<'189-')},previous={...catalog,current:catalog.current.filter(f=>f.version<'188-')};
 const suffix=randomBytes(6).toString('hex'),database='loop_preparation_import_'+suffix,restored='loop_preparation_import_restore_'+suffix,created:string[]=[];
 const sql=(query:string,db=database)=>context.sql(query,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous));const ids=seedHistoricalPreparation(sql);
  sql(`INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,snapshot) VALUES('${ids.workspace}','${ids.board}','local-added-shot','local-added','','{"id":"local-added-shot"}');UPDATE local_identity.production_workspaces SET bindings=bindings||'[{"id":"manual-local-clip","itemId":"local-native-item","shotId":"local-added-shot","text":"原生新增镜头","source":null}]'::jsonb WHERE id='${ids.workspace}';`);
  const before=snapshot(),oldWorkspace=sql('SELECT to_jsonb(w) FROM local_identity.production_workspaces w'),oldVersions=sql('SELECT jsonb_agg(to_jsonb(v)) FROM local_identity.production_workspace_versions v');
  const ledger=Object.fromEntries(Object.entries(before.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256])),pending=schemaMigrationPlan(ledger,catalog);
  expect(pending.map(f=>f.version)).toEqual(['188-import-existing-production-preparations.sql']);const migration=migrationTransaction(pending);
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  const anotherScript=randomUUID();
  const conflicting=migration.replace('BEGIN;',`BEGIN;INSERT INTO public.production_material_revisions SELECT (jsonb_populate_record(NULL::public.production_material_revisions,to_jsonb(m)||jsonb_build_object('id','${anotherScript}','revision_number',2,'is_main_script',false))).* FROM public.production_material_revisions m WHERE id='${ids.script}';UPDATE local_identity.workspace_preparations SET script_revision_id='${anotherScript}' WHERE package_id='${ids.board}';`);
  expect(()=>sql(conflicting)).toThrow(/Conflicting preparation provenance/);assertRestored(before,snapshot());
  sql(migration);const after=snapshot();
  const changedTables=['local_identity.production_preparation_revisions','local_identity.production_shots','local_identity.production_shot_versions','local_identity.production_workspaces','local_identity.production_workspace_versions'];
  for(const [table,rows]of Object.entries(before.rows))if(!changedTables.includes(table))expect(after.rows[table],table).toEqual(rows);
  expect(sql("SELECT to_jsonb(w)-'preparation_revision_id' FROM local_identity.production_workspaces w")).toBe(oldWorkspace);
  expect(sql("SELECT jsonb_agg(to_jsonb(v)-'preparation_revision_id') FROM local_identity.production_workspace_versions v")).toBe(oldVersions);
  expect(sql('SELECT preparation_revision_id::text FROM local_identity.production_workspaces')).toBe(ids.board);
  expect(sql('SELECT preparation_revision_id::text FROM local_identity.production_workspace_versions')).toBe(ids.board);
  expect(JSON.parse(sql('SELECT jsonb_agg(jsonb_build_object(\'id\',shot_id,\'text\',baseline_text,\'origin\',origin) ORDER BY position) FROM local_identity.production_shot_versions'))).toEqual([
   {id:'shot-01',text:'保留原镜头',origin:'historical-import'},{id:'local-added-shot',text:'',origin:'local'},
  ]);
  expect(sql(`SELECT source_evidence#>>'{package,context_snapshot,worker_result,storyboard,shots,0,shotType}' FROM local_identity.production_preparation_revisions WHERE id='${ids.board}'`)).toBe('b_roll');
  expect(sql("SELECT bool_and(NOT snapshot ? 'shotType') FROM local_identity.production_shot_versions")).toBe('t');
  expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);
  const applied=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${ids.episode}'`,restored)).toBe(ids.audio);
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
