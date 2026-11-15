// @vitest-environment node
import {expect,it} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction} from './schemaMigrations';
import {seedHistoricalPreparation} from './historicalPreparation.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {readFile} from 'node:fs/promises';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['original-owner','different-import-owner','formatting-local-shot','formatting-parent-inputs','formatting-foreign-parent-draft','foreign-draft-source','foreign-audio-source','foreign-audio-artifact-source','foreign-audio-task-source'] as const)('pre-188 private history respects source ownership and original identities: %s',async kind=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated historical databases');
 const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
 const catalog=loadSchemaCatalog(process.cwd()),old={...catalog,current:catalog.current.filter(f=>f.version<'188-')},suffix=randomBytes(6).toString('hex'),source='loop_legacy_source_'+suffix,target='loop_legacy_target_'+suffix,databases:string[]=[];
 const sql=(q:string,db=target)=>context.sql(q,db),literal=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'",localOwner='644f8c5a-b668-48a3-8a25-94c4e502fa04';
 try{
  for(const db of [source,target]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');databases.push(db);}
  sql(freshSchemaTransaction(old),source);const ids=seedHistoricalPreparation(q=>sql(q,source));let parentBoard:string|undefined;
  if(kind==='formatting-local-shot'||kind==='formatting-parent-inputs'||kind==='formatting-foreign-parent-draft'){
   parentBoard=ids.board;const child=randomUUID(),script=randomUUID();
   sql(`INSERT INTO public.production_material_revisions SELECT * FROM jsonb_populate_record(NULL::public.production_material_revisions,(SELECT to_jsonb(m)||jsonb_build_object('id','${script}','revision_number',2,'is_main_script',false,'storage_path','formatting.md') FROM public.production_material_revisions m WHERE id='${ids.script}'));
    INSERT INTO public.review_packages SELECT * FROM jsonb_populate_record(NULL::public.review_packages,(SELECT to_jsonb(p)||jsonb_build_object('id','${child}','revision_number',2,'context_snapshot',context_snapshot||jsonb_build_object('workspace_preparation',jsonb_build_object('formattingOnly',true,'sourceReviewPackageId','${ids.board}'),'continued_project',jsonb_build_object('previousScriptRevisionId','${ids.script}'))) FROM public.review_packages p WHERE id='${ids.board}'));
    INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by)VALUES('${child}','${ids.episode}','${script}','legacy-board','${ids.owner}');
    INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,snapshot)VALUES('${ids.workspace}','${ids.board}','local-extra','local-added','人工增补','{"id":"local-extra","scriptSegment":"人工增补"}');
    ${kind==='formatting-local-shot'?`INSERT INTO public.shot_preparation_drafts SELECT * FROM jsonb_populate_record(NULL::public.shot_preparation_drafts,(SELECT to_jsonb(d)||jsonb_build_object('id','${randomUUID()}','review_package_id','${child}','tts_text','子包编辑口播') FROM public.shot_preparation_drafts d WHERE episode_id='${ids.episode}'));`:''}
    UPDATE local_identity.production_workspaces SET script_revision_id='${script}',storyboard_package_id='${child}',bindings=bindings||'[{"id":"local-clip","itemId":"local-item","shotId":"local-extra","text":"人工增补","source":null}]'::jsonb WHERE id='${ids.workspace}';
    UPDATE local_identity.production_workspace_versions SET script_revision_id='${script}',storyboard_package_id='${child}' WHERE workspace_id='${ids.workspace}';
    UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${ids.episode}';`,source);
   ids.board=child;ids.script=script;
  }
  sql(`INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled,storyboard_enabled,narration_enabled,media_enabled)VALUES('${ids.episode}','${ids.owner}',true,true,true,true);`,source);
  sql(freshSchemaTransaction(catalog));sql(`INSERT INTO local_identity.owners(id,email)VALUES('${localOwner}','current@example.invalid');`);
  const keys=JSON.parse(sql("SELECT jsonb_object_agg(tab,cols) FROM(SELECT n.nspname||'.'||t.relname tab,jsonb_agg(a.attname::text ORDER BY k.i) cols FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(x.indkey)WITH ORDINALITY k(num,i)ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE x.indisprimary AND n.nspname IN('public','local_identity') GROUP BY 1)x",source));
  const tables=JSON.parse(sql("SELECT jsonb_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND(n.nspname='public' OR n.nspname='local_identity' AND c.relname IN('owners','input_episodes','workspace_preparations','production_workspaces','production_workspace_versions','workspace_shot_inputs'))",source));
  const originals:Record<string,any[]>={},owner=kind==='different-import-owner'?localOwner:ids.owner;
  if(owner!==localOwner)sql(`INSERT INTO local_identity.owners(id,email)VALUES('${owner}','original-current@example.invalid');`);
  for(const table of tables){if(!keys[table])continue;const rows=JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM ${table} t`,source));originals[table]=rows;
   for(const row of rows){const key=Object.fromEntries(keys[table].map((k:string)=>[k,row[k]])),hash=createHash('sha256').update(JSON.stringify(row)).digest('hex'),sourceOwner=((kind==='foreign-draft-source'||kind==='formatting-foreign-parent-draft')&&table==='public.shot_preparation_drafts'||kind==='foreign-audio-source'&&table==='public.audio_tracks'||kind==='foreign-audio-artifact-source'&&table==='public.artifacts'&&row.id===ids.audioFile||kind==='foreign-audio-task-source'&&table==='public.tasks'&&row.id===ids.task)?localOwner:owner;sql(`INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('${table}',${literal(key)},'${hash}','${sourceOwner}',${literal(row)})`);}
  }
  const digest=()=>sql('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) FROM local_identity.history_versions h'),before=digest();
  projectHistory({sql});
  const workspace=JSON.parse(sql(`SELECT coalesce((SELECT to_jsonb(w) FROM local_identity.production_workspaces w WHERE id='${ids.workspace}'),'null'::jsonb)`));if(kind==='formatting-foreign-parent-draft'||kind==='foreign-draft-source'||kind==='foreign-audio-source'||kind==='foreign-audio-artifact-source'||kind==='foreign-audio-task-source'){
   expect(sql(`SELECT count(*) FROM local_identity.workspace_narration_inputs WHERE workspace_id='${ids.workspace}'`)).toBe('0');
   expect(sql(`SELECT count(*) FROM local_identity.workspace_caption_inputs WHERE workspace_id='${ids.workspace}'`)).toBe('0');
   expect(sql(`SELECT status FROM local_identity.history_projection_results WHERE table_name='local_identity.production_workspaces' AND row_key->>'id'='${ids.workspace}'`)).toBe('history-only:legacy-adaptation:42501');
   expect(digest()).toBe(before);return;
  }
  expect(workspace,sql('SELECT jsonb_agg(to_jsonb(r)) FROM local_identity.history_projection_results r')).not.toBeNull();expect(workspace).toMatchObject(originals['local_identity.production_workspaces'][0]);expect(workspace.preparation_revision_id).toBe(ids.board);
  const preparation=JSON.parse(sql(`SELECT to_jsonb(p) FROM local_identity.production_preparation_revisions p WHERE id='${ids.board}'`));expect(preparation).toMatchObject({episode_id:ids.episode,script_revision_id:ids.script,source_reference_id:ids.board,source_format:'storyboard/v1',created_by:ids.owner});expect(preparation.manifest.version).toBe('production-preparation/v1');expect(preparation.manifest.shots[0]).not.toHaveProperty('shotType');
  if(parentBoard){
   expect(preparation.parent_preparation_revision_id).toBe(parentBoard);
   expect(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',shot_id,'text',baseline_text,'origin',origin) ORDER BY position) FROM local_identity.production_shot_versions WHERE preparation_revision_id='${ids.board}'`))).toEqual([{id:'shot-01',text:'保留原镜头',origin:'historical-import'},{id:'local-extra',text:'人工增补',origin:'local'}]);
  }
  const versions=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(v)) FROM local_identity.production_workspace_versions v WHERE workspace_id='${ids.workspace}'`));expect(versions).toHaveLength(1);expect(versions[0]).toMatchObject(originals['local_identity.production_workspace_versions'][0]);expect(versions[0].preparation_revision_id).toBe(ids.board);
  expect(JSON.parse(sql(`SELECT jsonb_build_object('owner',owner_id,'enabled',enabled,'storyboard',storyboard_enabled,'media',media_enabled) FROM local_identity.input_episodes WHERE episode_id='${ids.episode}'`))).toEqual({owner:ids.owner,enabled:false,storyboard:false,media:false});
  expect(sql(`SELECT narration_text||':'||mode||':'||audio_track_id FROM local_identity.workspace_narration_inputs WHERE workspace_id='${ids.workspace}' AND preparation_revision_id='${ids.board}'`)).toBe((kind==='formatting-local-shot'?'子包编辑口播':'原采用口播')+':manual:'+ids.audio);
  expect(sql(`SELECT count(*) FROM local_identity.workspace_caption_inputs WHERE workspace_id='${ids.workspace}' AND preparation_revision_id='${ids.board}'`)).toBe('1');
  if(parentBoard)expect(sql(`SELECT imported_from_package_id::text FROM local_identity.workspace_narration_inputs WHERE workspace_id='${ids.workspace}' AND preparation_revision_id='${ids.board}'`)).toBe(kind==='formatting-parent-inputs'?parentBoard:ids.board);
  for(const table of ['public.audio_tracks','public.review_packages','public.shot_preparation_drafts']){const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(t)) FROM ${table} t`));expect(rows).toHaveLength(originals[table].length);for(const row of originals[table])expect(rows).toContainEqual(expect.objectContaining(row));}
  expect(sql(`SELECT count(*) FROM local_identity.credentials WHERE owner_id='${ids.owner}'`)).toBe('0');expect(sql(`SELECT count(*) FROM local_identity.historical_tasks WHERE task_id='${ids.task}'`)).toBe('1');projectHistory({sql});expect(digest()).toBe(before);
  if(kind==='different-import-owner'){
   const restored=target+'_restore',{databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs')),snapshot=databaseSnapshot(context,target,process.cwd());context.sql('CREATE DATABASE '+restored+' TEMPLATE template0','postgres');databases.push(restored);
   sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',target]),restored);assertRestored(snapshot,databaseSnapshot(context,restored,process.cwd()));
  }
 }finally{for(const db of databases.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('an old workspace-only backup keeps edited native bytes and all old version keys through actual Owner recovery',async()=>{
 const f=await productionWorkspaceFixture();try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated historical databases');const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  let response=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(response.status).toBe(200);let w=await f.fillVisuals(response.body);
  response=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:19}});expect(response.status,JSON.stringify(response.body)).toBe(200);w=response.body;await f.closeStudio();
  const bytes=await readFile(join(f.assetRoot,w.project.relativePath)),versions=(await f.c.query('SELECT to_jsonb(v) payload FROM local_identity.production_workspace_versions v WHERE workspace_id=$1',[w.id])).rows.map(r=>r.payload),taskIds=(await f.c.query('SELECT id FROM public.tasks WHERE episode_id=$1',[f.episode])).rows.map(r=>r.id);
  const keys=(await f.c.query("SELECT n.nspname||'.'||t.relname tab,array_agg(a.attname::text ORDER BY k.i) keys FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(x.indkey)WITH ORDINALITY k(num,i)ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE x.indisprimary AND n.nspname IN('public','local_identity') GROUP BY 1")).rows;
  const tables=(await f.c.query("SELECT table_schema||'.'||table_name tab,array_agg(column_name::text) cols FROM information_schema.columns WHERE table_schema IN('public','local_identity') GROUP BY 1 ORDER BY 1")).rows;
  const newTables=new Set(['production_preparation_revisions','production_shots','production_shot_versions','workspace_caption_inputs','workspace_narration_inputs']),physical=new Set(['local_identity.episode_asset_locations','local_identity.episode_storage_lineage']);const lost:Array<{table:string;where:string;params:unknown[]}>=[];
  for(const t of tables){if(t.tab.includes('.history')||t.tab.includes('.historical')||!keys.some(k=>k.tab===t.tab))continue;const where=t.cols.includes('episode_id')?'episode_id=$1':t.cols.includes('workspace_id')?'workspace_id=$1':t.cols.includes('task_id')?'task_id=ANY($1::uuid[])':t.tab==='public.episodes'?'id=$1':null;if(!where)continue;
   const params=t.cols.includes('episode_id')||t.tab==='public.episodes'?[f.episode]:t.cols.includes('workspace_id')?[w.id]:[taskIds],rows=(await f.c.query(`SELECT to_jsonb(t) payload FROM ${t.tab} t WHERE ${where}`,params)).rows.map(r=>r.payload);if(!rows.length)continue;lost.push({table:t.tab,where,params});
   if(newTables.has(t.tab.split('.')[1]))continue;
   for(const original of rows){const row={...original};if(['local_identity.production_workspaces','local_identity.production_workspace_versions','public.audio_tracks'].includes(t.tab))delete row.preparation_revision_id;
    const primary=t.tab==='local_identity.production_workspace_versions'?['workspace_id','project_sha256']:keys.find(k=>k.tab===t.tab)!.keys;
    await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES($1,$2,$3,$4,$5)',[t.tab,Object.fromEntries(primary.map((k:string)=>[k,row[k]])),createHash('sha256').update(JSON.stringify(row)).digest('hex'),f.owner,row]);
   }
  }
  const before=(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) value FROM local_identity.history_versions h')).rows;
  await f.c.query('BEGIN;SET LOCAL session_replication_role=replica');for(const t of lost)if(!physical.has(t.table))await f.c.query(`DELETE FROM ${t.table} WHERE ${t.where}`,t.params);await f.c.query('COMMIT');
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status,await read.clone().text()).toBe(200);const restored=(await read.json()).workspace;expect(restored.project).toEqual(w.project);expect(restored.clips).toEqual(w.clips);expect(restored.preparationRevisionId).toBe(f.board);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(bytes);
  const after=(await f.c.query('SELECT to_jsonb(v) payload FROM local_identity.production_workspace_versions v WHERE workspace_id=$1',[w.id])).rows.map(r=>r.payload);expect(after).toHaveLength(versions.length);for(const v of versions)expect(after).toContainEqual(v);
  const foreign=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(foreign.status).toBe(404);projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});expect((await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) value FROM local_identity.history_versions h')).rows).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('an unsupported old version keeps its raw key and cannot delete a current version sharing the native project SHA',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated historical databases');
 const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
 const catalog=loadSchemaCatalog(process.cwd()),old={...catalog,current:catalog.current.filter(f=>f.version<'188-')},database='loop_legacy_collision_'+randomBytes(6).toString('hex'),sql=(q:string)=>context.sql(q,database);
 context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 try{
  sql(freshSchemaTransaction(old));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(catalog.current.filter(f=>f.version>='188-')));
  const before=sql(`SELECT jsonb_build_object('workspace',(SELECT to_jsonb(w) FROM local_identity.production_workspaces w WHERE id='${ids.workspace}'),'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY revision) FROM local_identity.production_workspace_versions v WHERE workspace_id='${ids.workspace}'))`);
  const script=randomUUID(),board=randomUUID(),artifact=randomUUID();
  sql(`INSERT INTO public.production_material_revisions SELECT * FROM jsonb_populate_record(NULL::public.production_material_revisions,(SELECT to_jsonb(m)||jsonb_build_object('id','${script}','revision_number',2,'is_main_script',false,'storage_path','unsupported.md') FROM public.production_material_revisions m WHERE id='${ids.script}'));
   INSERT INTO public.artifacts SELECT * FROM jsonb_populate_record(NULL::public.artifacts,(SELECT to_jsonb(a)||jsonb_build_object('id','${artifact}','relative_path','unsupported-board.json') FROM public.artifacts a WHERE id='${ids.boardFile}'));
   INSERT INTO public.review_packages SELECT * FROM jsonb_populate_record(NULL::public.review_packages,(SELECT to_jsonb(p)||jsonb_build_object('id','${board}','artifact_id','${artifact}','revision_number',2,'context_snapshot','{"worker_result":{"storyboard":{"version":"storyboard/v999","shots":[{"id":"shot-01","scriptSegment":"不得接入未知版本"}]}}}'::jsonb) FROM public.review_packages p WHERE id='${ids.board}'));`);
  const raw=JSON.parse(sql(`SELECT (to_jsonb(v)-'preparation_revision_id')||jsonb_build_object('script_revision_id','${script}','storyboard_package_id','${board}','revision',2) FROM local_identity.production_workspace_versions v WHERE workspace_id='${ids.workspace}'`));
  const key={workspace_id:ids.workspace,project_sha256:raw.project_sha256},hash=createHash('sha256').update(JSON.stringify(raw)).digest('hex'),literal=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'";
  sql(`INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('local_identity.production_workspace_versions',${literal(key)},'${hash}','${ids.owner}',${literal(raw)})`);
  projectHistory({sql});
  expect(sql(`SELECT jsonb_build_object('workspace',(SELECT to_jsonb(w) FROM local_identity.production_workspaces w WHERE id='${ids.workspace}'),'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY revision) FROM local_identity.production_workspace_versions v WHERE workspace_id='${ids.workspace}'))`)).toBe(before);
  expect(sql(`SELECT count(*) FROM local_identity.production_preparation_revisions WHERE id='${board}'`)).toBe('0');
  expect(sql(`SELECT status FROM local_identity.history_projection_results WHERE payload_sha256='${hash}'`)).toBe('history-only:legacy-adaptation:22023');
  expect(JSON.parse(sql(`SELECT payload FROM local_identity.history_versions WHERE payload_sha256='${hash}'`))).toEqual(raw);
  projectHistory({sql});expect(sql(`SELECT count(*) FROM local_identity.production_workspace_versions WHERE workspace_id='${ids.workspace}'`)).toBe('1');
 }finally{context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('an existing old confirmation cannot supply a new preparation when its selected history belongs to another source Owner',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated historical databases');
 const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
 const catalog=loadSchemaCatalog(process.cwd()),old={...catalog,current:catalog.current.filter(f=>f.version<'188-')},database='loop_legacy_basis_'+randomBytes(6).toString('hex'),sql=(q:string)=>context.sql(q,database),foreign=randomUUID(),literal=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'";
 context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 try{
  sql(freshSchemaTransaction(old));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(catalog.current.filter(f=>f.version>='188-')));sql(`INSERT INTO local_identity.owners(id,email)VALUES('${foreign}','foreign@example.invalid');`);
  const basis=sql(`SELECT to_jsonb(p) FROM local_identity.workspace_preparations p WHERE package_id='${ids.board}'`);
  for(const [table,key]of [['production_workspaces',['id']],['production_workspace_versions',['workspace_id','project_sha256']],['workspace_preparations',['package_id']]]as const){
   const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(t)-'preparation_revision_id') FROM local_identity.${table} t`));
   for(const row of rows){const hash=createHash('sha256').update(JSON.stringify(row)).digest('hex');sql(`INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('local_identity.${table}',${literal(Object.fromEntries(key.map(k=>[k,row[k]])))},'${hash}','${table==='workspace_preparations'?foreign:ids.owner}',${literal(row)})`);}
  }
  sql("BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM local_identity.production_workspaces;DELETE FROM local_identity.production_workspace_versions;DELETE FROM local_identity.workspace_caption_inputs;DELETE FROM local_identity.workspace_narration_inputs;DELETE FROM local_identity.production_preparation_revisions;DELETE FROM local_identity.production_shot_versions;DELETE FROM local_identity.production_shots;COMMIT;");
  const before=sql('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) FROM local_identity.history_versions h');projectHistory({sql});
  expect(sql(`SELECT count(*) FROM local_identity.production_preparation_revisions WHERE id='${ids.board}'`)).toBe('0');
  expect(sql(`SELECT count(*) FROM local_identity.production_workspaces WHERE id='${ids.workspace}'`)).toBe('0');
  expect(sql(`SELECT status FROM local_identity.history_projection_results WHERE table_name='local_identity.production_workspaces'`)).toBe('history-only:legacy-adaptation:42501');
  expect(sql(`SELECT to_jsonb(p) FROM local_identity.workspace_preparations p WHERE package_id='${ids.board}'`)).toBe(basis);
  expect(sql('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text,payload_sha256)::text) FROM local_identity.history_versions h')).toBe(before);
 }finally{context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');}
},120000);
