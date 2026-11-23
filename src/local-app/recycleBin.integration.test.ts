// @vitest-environment node
// Dedicated random PostgreSQL fixture + real Owner HTTP/files. Never uses daily data.
import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir,lstat,rename,access,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {csrfFor} from './sessions';
import {loadSchemaCatalog,migrationTransaction,schemaMigrationPlan,verifySchemaLedger} from './schemaMigrations';
const enabled=process.env.LOOP_RECYCLE_ACCEPTANCE==='1';
const migration='160-episode-recycle-bin.sql';

export async function recycleFixture(migrations:string[]=[]){
 const f=await productionWorkspaceFixture({migrations:['db/local/'+migration,...migrations]});
 const recycle=(command:string,data:Record<string,unknown>={},options:Parameters<typeof f.post>[3]={})=>f.post('recycle-bin',command,command==='saveRecycleLimit'?data:{episodeId:f.episode,...data},options);
 const get=async(path='recycle-bin',token=f.token)=>{const r=await fetch(f.origin+'/api/local/'+path,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
 const keyed=async(command:string,data:Record<string,unknown>,key:string,token=f.token)=>{const r=await fetch(f.origin+'/api/local/recycle-bin',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 return{...f,recycle,get,keyed};
}

async function registeredEpisode(f:Awaited<ReturnType<typeof recycleFixture>>,bytes=45_000_000){
 const episode=randomUUID(),task=randomUUID(),relativePath=`episodes/${episode}`,directory=join(f.assetRoot,relativePath),path=join(directory,'owned.bin'),content=Buffer.alloc(bytes,episode.charCodeAt(0));
 await mkdir(directory,{recursive:true});await writeFile(path,content);const identity=await lstat(directory,{bigint:true});
 const source=(await f.c.query('SELECT account_id,blueprint_version_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0];
 await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$3,$4,'storyboard_approved')",[episode,source.account_id,source.blueprint_version_id,'quota '+episode]);
 await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[episode,f.owner]);
 await f.c.query('INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root,directory_relative_path,directory_device_id,directory_inode_id,layout_version) VALUES($1,$2,$3,$4,$5,$6,2) ON CONFLICT(episode_id) DO UPDATE SET directory_relative_path=excluded.directory_relative_path,directory_device_id=excluded.directory_device_id,directory_inode_id=excluded.directory_inode_id,layout_version=2',[episode,source.account_id,f.assetRoot,relativePath,String(identity.dev),String(identity.ino)]);
 await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','completed','{}')",[task,episode]);
 await f.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'render',$3,$4,$5)",[episode,task,relativePath+'/owned.bin',createHash('sha256').update(content).digest('hex'),bytes]);
 return{episode,task,path,directory,bytes};
}

it.skipIf(!enabled)('quota counts real registered bytes, sweeps safe FIFO on mutation, preserves newest and oversized item',async()=>{
 const f=await recycleFixture();try{
  const settings=(await f.get()).body;expect((await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:settings.settingsRevision})).status).toBe(200);
  const a=await registeredEpisode(f),b=await registeredEpisode(f),c=await registeredEpisode(f);
  for(const item of[a,b]){const r=await f.recycle('recycleEpisode',{episodeId:item.episode});expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.sizeBytes).toBe(item.bytes);}
  expect((await f.get()).body.usedBytes).toBe(90_000_000);
  const third=await f.recycle('recycleEpisode',{episodeId:c.episode});expect(third.status,JSON.stringify(third.body)).toBe(200);
  const state=(await f.get()).body;expect(state.items.map((x:any)=>x.episodeId),JSON.stringify(state)).toEqual([b.episode,c.episode]);expect(state.usedBytes).toBe(90_000_000);expect(state.overLimit).toBe(false);
  await expect(access(a.path)).rejects.toMatchObject({code:'ENOENT'});await access(b.path);await access(c.path);
  const huge=await registeredEpisode(f,101_000_000),added=await f.recycle('recycleEpisode',{episodeId:huge.episode});expect(added.status,JSON.stringify(added.body)).toBe(200);
  expect((await f.get()).body).toMatchObject({overLimit:true,usedBytes:101_000_000});await access(huge.path);
  await f.restart();const read1=(await f.get()).body,read2=(await f.get()).body;expect(read2).toEqual(read1);expect(read2.items.map((x:any)=>x.episodeId)).toEqual([huge.episode]);
  const saved=await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:read2.settingsRevision});expect(saved.status,JSON.stringify(saved.body)).toBe(200);await access(huge.path);expect((await f.get()).body.overLimit).toBe(true);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('unknown and running work block entry; offline or changed files block restore; protected manual files survive quota',async()=>{
 const f=await recycleFixture();try{
  const bytes=await readFile(join(f.assetRoot,f.videoPath));
  const pending=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','running','{}')",[pending,f.episode]);expect((await f.recycle('recycleEpisode')).status).toBe(409);
  await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[pending]);const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state) VALUES($1,$2,'video',1,'submitting')",[pending,account]);expect((await f.recycle('recycleEpisode')).status).toBe(409);
  await f.c.query('DELETE FROM public.paid_generation_reservations WHERE task_id=$1',[pending]);await f.c.query('DELETE FROM public.tasks WHERE id=$1',[pending]);
  const recycled=await f.recycle('recycleEpisode');expect(recycled.status,JSON.stringify(recycled.body)).toBe(200);
  const cleanupKey=randomUUID();await f.c.query("INSERT INTO local_identity.episode_deletion_intents(owner_id,idempotency_key,payload_hash,episode_id,manifest) VALUES($1,$2,$3,$4,$5)",[f.owner,cleanupKey,'a'.repeat(64),f.episode,{title:'controlled pending cleanup',path:join(f.assetRoot,f.episodeRelativePath),targets:[]}]);
  expect((await f.recycle('restoreRecycledEpisode',{revision:recycled.body.revision})).status).toBe(409);expect((await f.get('deletion-cleanups')).body).toEqual(expect.arrayContaining([expect.objectContaining({cleanupKey,phase:'prepared'})]));await f.c.query('DELETE FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[cleanupKey]);
  const directory=join(f.assetRoot,f.episodeRelativePath),away=directory+'.offline';await rename(directory,away);
  expect((await f.get()).body.items[0].protection).toBeTruthy();expect((await f.recycle('restoreRecycledEpisode',{revision:recycled.body.revision})).status).toBe(409);await rename(away,directory);
  await writeFile(join(f.assetRoot,f.videoPath),Buffer.concat([bytes,Buffer.from('changed')]));expect((await f.recycle('restoreRecycledEpisode',{revision:recycled.body.revision})).status).toBe(409);await writeFile(join(f.assetRoot,f.videoPath),bytes);
  expect((await f.recycle('restoreRecycledEpisode',{revision:recycled.body.revision})).status).toBe(200);
  const a=await registeredEpisode(f,60_000_000);await writeFile(join(a.directory,'manual.txt'),'unregistered original');const b=await registeredEpisode(f,60_000_000);
  expect((await f.recycle('recycleEpisode',{episodeId:a.episode})).status).toBe(200);expect((await f.recycle('recycleEpisode',{episodeId:b.episode})).status).toBe(200);
  const state=(await f.get()).body;expect(state.items.find((x:any)=>x.episodeId===a.episode).protection).toBeTruthy();expect((await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:state.settingsRevision})).status).toBe(200);
  await access(a.path);expect(await readFile(join(a.directory,'manual.txt'),'utf8')).toBe('unregistered original');expect((await f.get()).body.items.map((x:any)=>x.episodeId)).toEqual([a.episode]);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('hardlinked bytes are counted once and protected, account cannot orphan trash, concurrent restore has one winner',async()=>{
 const f=await recycleFixture();try{
  const a=await registeredEpisode(f,200_000),b=await registeredEpisode(f,200_000);await unlink(b.path);await link(a.path,b.path);
  await f.c.query('UPDATE public.artifacts SET sha256=$2 WHERE episode_id=$1',[b.episode,createHash('sha256').update(await readFile(a.path)).digest('hex')]);
  const aa=await f.recycle('recycleEpisode',{episodeId:a.episode}),bb=await f.recycle('recycleEpisode',{episodeId:b.episode});expect(aa.status,JSON.stringify(aa.body)).toBe(200);expect(bb.status,JSON.stringify(bb.body)).toBe(200);
  const state=(await f.get()).body;expect(state.usedBytes).toBe(200_000);expect(state.items).toHaveLength(2);expect(state.items.every((x:any)=>!!x.protection)).toBe(true);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;expect((await f.post('configuration','deleteAccount',{accountId:account,confirmation:'Studio153 fixture'})).status).toBe(409);
  const results=await Promise.all([f.recycle('restoreRecycledEpisode',{episodeId:a.episode,revision:aa.body.revision}),f.recycle('restoreRecycledEpisode',{episodeId:a.episode,revision:aa.body.revision})]);expect(results.map(r=>r.status).sort()).toEqual([200,404]);
  expect((await f.get()).body.items.map((x:any)=>x.episodeId)).toEqual([b.episode]);await access(a.path);await access(b.path);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('real Owner recycle hides catalog, survives restart and restores IDs, frozen evidence and original archive state',async()=>{
 const f=await recycleFixture();try{
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);expect((await f.c.query("SELECT local_identity.input_task_allowed($1,'draft_storyboard_revision') allowed",[f.episode])).rows[0].allowed).toBe(true);
  const before=(await f.c.query('SELECT id,main_script_revision_id,stage,archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0];
  const bytes=await readFile(join(f.assetRoot,f.videoPath));
  const counts=async()=>({tasks:(await f.c.query('SELECT id,input_snapshot FROM public.tasks WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,materials:(await f.c.query('SELECT id,sha256 FROM public.production_material_revisions WHERE episode_id=$1 ORDER BY id',[f.episode])).rows});const evidence=await counts();
  expect((await f.get()).body).toMatchObject({limitBytes:5_000_000_000,items:[]});
  const removed=await f.recycle('recycleEpisode');expect(removed.status,JSON.stringify(removed.body)).toBe(200);expect(removed.body.recycled).toBe(true);expect(removed.body.sizeBytes).toBeGreaterThan(bytes.length);
  expect((await f.c.query("SELECT local_identity.input_task_allowed($1,'draft_storyboard_revision') allowed",[f.episode])).rows[0].allowed).toBe(false);const worker=f.workerPool();try{await expect(worker.query('SELECT * FROM local_identity.plan_input_tasks($1)',[f.episode])).rejects.toMatchObject({code:'42883'});}finally{await worker.end();}
  expect((await f.get('catalog?view=operations&q='+f.episode)).body.episodes).toEqual([]);
  expect((await f.get('catalog?view=episodes&q='+f.episode+'&visibility=archived')).body.episodes).toEqual([]);
  const write=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(write.status,JSON.stringify(write.body)).toBe(409);
  await f.restart();const state=await f.get();expect(state.body.items).toEqual([expect.objectContaining({episodeId:f.episode,revision:removed.body.revision,archivedBefore:false})]);
  expect(await counts()).toEqual(evidence);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(bytes);
  const restored=await f.recycle('restoreRecycledEpisode',{revision:removed.body.revision});expect(restored.status,JSON.stringify(restored.body)).toBe(200);
  expect((await f.c.query('SELECT id,main_script_revision_id,stage,archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0]).toEqual(before);expect(await counts()).toEqual(evidence);
  expect((await f.get('catalog?view=episodes&q='+f.episode)).body.episodes).toEqual([expect.objectContaining({id:f.episode})]);
  await f.c.query("UPDATE public.episodes SET archived_at='2026-01-01T00:00:00Z',stage='production_completed' WHERE id=$1",[f.episode]);
  const done=await f.recycle('recycleEpisode');expect(done.status,JSON.stringify(done.body)).toBe(200);expect((await f.get()).body.items[0].archivedBefore).toBe(true);
  expect((await f.recycle('restoreRecycledEpisode',{revision:done.body.revision})).status).toBe(200);
  expect((await f.c.query('SELECT stage,archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0]).toEqual({stage:'production_completed',archived_at:new Date('2026-01-01T00:00:00Z')});
  expect((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).status).toBe(409);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('recycle enforces Owner, CSRF, revision, durable duplicate receipts and explicit permanent confirmation',async()=>{
 const f=await recycleFixture();try{
  expect((await f.recycle('recycleEpisode',{}, {token:f.otherToken})).status).toBe(404);expect((await f.recycle('recycleEpisode',{}, {csrf:false})).status).toBe(403);
  const key=randomUUID(),data={episodeId:f.episode},first=await f.keyed('recycleEpisode',data,key);expect(first.status,JSON.stringify(first.body)).toBe(200);
  await f.restart();expect(await f.keyed('recycleEpisode',data,key)).toEqual(first);expect((await f.keyed('restoreRecycledEpisode',{...data,revision:first.body.revision},key)).status).toBe(409);
  expect((await f.get('recycle-bin',f.otherToken)).body.items).toEqual([]);
  const stale=await f.recycle('restoreRecycledEpisode',{revision:randomUUID()});expect(stale.status,JSON.stringify(stale.body)).toBe(409);
  expect((await f.recycle('restoreRecycledEpisode',{revision:first.body.revision},{token:f.otherToken})).status).toBe(404);
  const state=(await f.get()).body;const saved=await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:state.settingsRevision});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.recycle('saveRecycleLimit',{limitBytes:200_000_000,expectedRevision:state.settingsRevision})).status).toBe(409);expect((await f.recycle('saveRecycleLimit',{limitBytes:99,expectedRevision:saved.body.settingsRevision})).status).toBe(400);
  const plan=await f.recycle('planRecyclePurge',{revision:first.body.revision});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  const confirm={revision:first.body.revision,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  expect((await f.recycle('purgeRecycledEpisode',{...confirm,confirmation:'wrong'})).status).toBe(409);expect((await f.recycle('purgeRecycledEpisode',{...confirm,expectedRevision:'stale'})).status).toBe(409);expect((await f.recycle('purgeRecycledEpisode',{...confirm,expectedPath:f.root})).status).toBe(409);
  const purged=await f.recycle('purgeRecycledEpisode',confirm);expect(purged.status,JSON.stringify(purged.body)).toBe(200);expect(purged.body.cleanupPending).toBe(false);expect((await f.get()).body.items).toEqual([]);expect((await f.c.query('SELECT id FROM public.episodes WHERE id=$1',[f.episode])).rows).toEqual([]);await expect(access(join(f.assetRoot,f.videoPath))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('recycle schema applies forward without rewriting existing migration checksums',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);
 const context=runtimeContext();context.assertDatabase();
 const before=JSON.parse(context.sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"));
 const catalog=loadSchemaCatalog(process.cwd()),recycleVersion='226-recycle-eligibility.sql';
 const installedThroughExcel=schemaMigrationPlan(before,catalog).filter(file=>file.version<recycleVersion).map(file=>'db/current/'+file.version);
 const f=await recycleFixture(installedThroughExcel);try{
  const ledger=async()=>Object.fromEntries((await f.c.query('SELECT version,sha256 FROM local_identity.schema_migrations ORDER BY version')).rows.map(row=>[row.version,row.sha256]));
  const beforeRecycle=await ledger();
  const priorGeneration=verifySchemaLedger(beforeRecycle,catalog);
  expect(beforeRecycle['225-structured-import-script.sql']).toBe(catalog.current.find(file=>file.version==='225-structured-import-script.sql')?.sha256);
  if(!Object.hasOwn(beforeRecycle,recycleVersion)){
   const [next]=schemaMigrationPlan(beforeRecycle,catalog);
   expect(next.version).toBe(recycleVersion);
   await f.c.query(migrationTransaction([next]));
  }
  const after=await ledger();
  expect(verifySchemaLedger(after,catalog)).toBe(priorGeneration);
  for(const [version,sha] of Object.entries(beforeRecycle))expect(after[version]).toBe(sha);
  const historicalHash=createHash('sha256').update(await readFile('db/archive/legacy-v1/'+migration)).digest('hex');
  expect(catalog.legacy.find(file=>file.version===migration)?.sha256).toBe(historicalHash);
  if((Object.hasOwn(before,'clean-v2.sql')||Object.hasOwn(before,'clean-v3.sql'))&&!Object.hasOwn(before,migration))expect(after[migration]).toBeUndefined();
  else expect(after[migration]).toBe(historicalHash);
  expect(after[recycleVersion]).toBe(createHash('sha256').update(await readFile('db/current/'+recycleVersion)).digest('hex'));
  expect((await f.c.query("SELECT count(*)::int count FROM local_identity.episode_recycle_bin")).rows[0].count).toBe(0);
  expect((await f.c.query("SELECT local_identity.is_recycled_episode($1) recycled",[f.episode])).rows[0].recycled).toBe(false);
  const policies=(await f.c.query("SELECT policyname FROM pg_policies WHERE schemaname='local_identity' AND tablename IN ('episode_recycle_bin','recycle_bin_settings')")).rows;
  expect(policies).toHaveLength(2);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('batch preview projects FIFO and protected bytes through Owner HTTP without changing files or membership',async()=>{
 const f=await recycleFixture(['db/current/226-recycle-eligibility.sql']);try{
  const settings=(await f.get()).body;
  expect((await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:settings.settingsRevision})).status).toBe(200);
  const protectedItem=await registeredEpisode(f,30_000_000);
  const manual=join(protectedItem.directory,'manual.txt');
  await writeFile(manual,'unregistered original');
  const newlyShared=await registeredEpisode(f,5_000_000),oldestSafe=await registeredEpisode(f,35_000_000),first=await registeredEpisode(f,30_000_000),second=await registeredEpisode(f,30_000_000);
  for(const item of[protectedItem,newlyShared,oldestSafe])expect((await f.recycle('recycleEpisode',{episodeId:item.episode})).status).toBe(200);
  const sharedLink=join(f.root,'shared-owner-file.bin');
  await link(newlyShared.path,sharedLink);
  const before=(await f.get()).body;
  const items=[first.episode,second.episode];
  const preview=await f.keyed('previewBatchRecycle',{episodeIds:items},randomUUID());
  expect(preview.status,JSON.stringify(preview.body)).toBe(200);
  expect(preview.body).toMatchObject({
   currentBytes:70_000_021,afterMoveBytes:130_000_021,projectedBytes:95_000_021,limitBytes:100_000_000,
   candidates:[{episodeId:oldestSafe.episode,sizeBytes:35_000_000}],
   retained:[{episodeId:protectedItem.episode,reason:expect.any(String)},{episodeId:newlyShared.episode,reason:expect.any(String)}],
   items:items.map(episodeId=>({episodeId,status:'ready',sizeBytes:30_000_000})),
  });
  expect(JSON.stringify(preview.body)).not.toContain(f.assetRoot);
  expect((await f.get()).body).toEqual(before);
  for(const item of[protectedItem,newlyShared,oldestSafe,first,second])expect((await lstat(item.path)).size).toBe(item.bytes);
  expect(await readFile(manual,'utf8')).toBe('unregistered original');
  expect((await lstat(sharedLink)).size).toBe(newlyShared.bytes);
  const foreign=await f.keyed('previewBatchRecycle',{episodeIds:items},randomUUID(),f.otherToken);
  expect(foreign.status,JSON.stringify(foreign.body)).toBe(200);
  expect(foreign.body.items).toEqual(items.map(episodeId=>({episodeId,status:'skipped',reason:'生产单不存在或无管理权限。'})));
  expect(foreign.body.candidates).toEqual([]);
  const lateLink=join(f.root,'became-shared-after-preview.bin');
  await link(oldestSafe.path,lateLink);
  const command={episodeIds:items,cleanup:preview.body.candidates.map(({episodeId,revision}:any)=>({episodeId,revision})),previewKey:preview.body.previewKey};
  const confirmed=await f.keyed('batchRecycleEpisodes',command,randomUUID());
  expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  expect(confirmed.body).toMatchObject({items:items.map(episodeId=>({episodeId,status:'success'})),cleanup:{items:[{episodeId:oldestSafe.episode,status:'failed',reason:expect.any(String)}],usedBytes:130_000_021}});
  expect((await f.get()).body.items).toHaveLength(5);
  for(const item of[protectedItem,newlyShared,oldestSafe,first,second])await access(item.path);
  expect((await lstat(lateLink)).size).toBe(oldestSafe.bytes);

 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('the confirmed batch cleans only previewed old entries, shields new moves and retries just failed items',async()=>{
 const f=await recycleFixture(['db/current/226-recycle-eligibility.sql']);try{
  const settings=(await f.get()).body;
  expect((await f.recycle('saveRecycleLimit',{limitBytes:100_000_000,expectedRevision:settings.settingsRevision})).status).toBe(200);
  const old=await registeredEpisode(f,30_000_000),first=await registeredEpisode(f,60_000_000),second=await registeredEpisode(f,60_000_000);
  expect((await f.recycle('recycleEpisode',{episodeId:old.episode})).status).toBe(200);
  const episodeIds=[first.episode,second.episode];
  const plan=await f.keyed('previewBatchRecycle',{episodeIds},randomUUID());
  expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  expect(plan.body).toMatchObject({afterMoveBytes:150_000_000,projectedBytes:120_000_000,candidates:[{episodeId:old.episode}]});
  const command={episodeIds,cleanup:plan.body.candidates.map(({episodeId,revision}:any)=>({episodeId,revision})),previewKey:plan.body.previewKey};
  expect((await f.keyed('batchRecycleEpisodes',{...command,cleanup:[]},randomUUID())).status).toBe(409);
  const pending=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','running','{}')",[pending,first.episode]);
  const key=randomUUID(),result=await f.keyed('batchRecycleEpisodes',command,key);
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({items:[{episodeId:first.episode,status:'failed',reason:expect.any(String)},{episodeId:second.episode,status:'success'}],cleanup:{items:[],usedBytes:90_000_000,limitBytes:100_000_000}});
  for(const item of[old,first,second])await access(item.path);
  await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[pending]);
  expect(await f.keyed('batchRecycleEpisodes',command,key)).toEqual(result);
  const retryPlan=await f.keyed('previewBatchRecycle',{episodeIds:[first.episode],retainEpisodeIds:[second.episode]},randomUUID());
  expect(retryPlan.body.candidates.map(({episodeId}:any)=>episodeId)).toEqual([old.episode]);
  const retry=await f.keyed('batchRecycleEpisodes',{episodeIds:[first.episode],cleanup:retryPlan.body.candidates.map(({episodeId,revision}:any)=>({episodeId,revision})),previewKey:retryPlan.body.previewKey},randomUUID());
  expect(retry.status,JSON.stringify(retry.body)).toBe(200);
  expect(retry.body).toMatchObject({items:[{episodeId:first.episode,status:'success'}],cleanup:{items:[{episodeId:old.episode,status:'success'}],usedBytes:120_000_000,limitBytes:100_000_000}});
  await expect(access(old.path)).rejects.toMatchObject({code:'ENOENT'});await access(first.path);await access(second.path);
  expect((await f.get()).body.items.map((item:any)=>item.episodeId)).toEqual([second.episode,first.episode]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('batch restore preserves original catalog membership and supports retrying changed files only',async()=>{
 const f=await recycleFixture();try{
  const completed=await registeredEpisode(f,150_000),draft=await registeredEpisode(f,150_000);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[completed.episode])).rows[0].account_id;
  const series=randomUUID(),version=randomUUID();
  await f.c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'恢复验收系列')",[series,account]);
  await f.c.query("INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,'{}',$4)",[version,account,series,f.owner]);
  await f.c.query("UPDATE public.episodes SET archived_at='2026-01-01T00:00:00Z',stage='production_completed',series_version_id=$2 WHERE id=$1",[completed.episode,version]);
  await f.c.query("UPDATE public.episodes SET series_version_id=$2 WHERE id=$1",[draft.episode,version]);
  const entries=[];
  for(const item of[completed,draft]){
   const result=await f.recycle('recycleEpisode',{episodeId:item.episode});
   expect(result.status,JSON.stringify(result.body)).toBe(200);
   entries.push({episodeId:item.episode,revision:result.body.revision});
  }
  const original=await readFile(draft.path);
  await writeFile(draft.path,Buffer.concat([original,Buffer.from('changed')]));
  const key=randomUUID(),payload={items:entries};
  const result=await f.keyed('batchRestoreRecycledEpisodes',payload,key);
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.items).toMatchObject([{episodeId:completed.episode,status:'success'},{episodeId:draft.episode,status:'failed',reason:expect.any(String)}]);
  const catalog=(await f.get('catalog?view=episodes&visibility=archived&accountId='+account+'&seriesId='+series)).body;
  expect(catalog.episodes).toContainEqual(expect.objectContaining({id:completed.episode,account_id:account,series_version_id:version,stage:'production_completed',archived_at:expect.any(String)}));
  expect((await f.get()).body.items.map((entry:any)=>entry.episodeId)).toEqual([draft.episode]);
  const foreign=await f.keyed('batchRestoreRecycledEpisodes',{items:[entries[1]]},randomUUID(),f.otherToken);
  expect(foreign.body.items).toEqual([{episodeId:draft.episode,status:'skipped',reason:'生产单不存在或无管理权限。'}]);
  await writeFile(draft.path,original);
  expect(await f.keyed('batchRestoreRecycledEpisodes',payload,key)).toEqual(result);
  const retried=await f.keyed('batchRestoreRecycledEpisodes',{items:[entries[1]]},randomUUID());
  expect(retried.body.items).toEqual([{episodeId:draft.episode,status:'success'}]);
  const active=(await f.get('catalog?view=episodes&visibility=active&accountId='+account+'&seriesId='+series)).body;
  expect(active.episodes).toContainEqual(expect.objectContaining({id:draft.episode,account_id:account,series_version_id:version,stage:'storyboard_approved',archived_at:null}));
  expect(await readFile(draft.path)).toEqual(original);
  expect((await f.get()).body.items).toEqual([]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('batch purge requires Owner confirmation and preserves shared and unregistered files',async()=>{
 const f=await recycleFixture();try{
  const safe=await registeredEpisode(f,1024),protectedItem=await registeredEpisode(f,1024);
  const unknown=join(safe.directory,'notes.txt'),shared=join(f.root,'other-copy.bin');
  await writeFile(unknown,'local notes');await link(protectedItem.path,shared);
  const items=[];
  for(const item of [safe,protectedItem]){
   const recycled=await f.recycle('recycleEpisode',{episodeId:item.episode});
   expect(recycled.status,JSON.stringify(recycled.body)).toBe(200);
   items.push({episodeId:item.episode,revision:recycled.body.revision});
  }
  const preview=await f.keyed('previewBatchRecyclePurge',{items},randomUUID());
  expect(preview.status,JSON.stringify(preview.body)).toBe(200);
  expect(preview.body.items).toMatchObject([
   {episodeId:safe.episode,status:'ready',scope:{files:[{path:safe.path}],preserved:[{path:unknown}]}},
   {episodeId:protectedItem.episode,status:'ready',scope:{files:[],preserved:[{path:protectedItem.path}]}},
  ]);
  const foreign=await f.keyed('previewBatchRecyclePurge',{items},randomUUID(),f.otherToken);
  expect(foreign.body.items).toEqual(items.map(({episodeId})=>({episodeId,status:'skipped',reason:'回收站记录不存在或无管理权限。'})));
  const reviewed={items:preview.body.items.map((item:any)=>item.confirmation)};
  expect((await f.keyed('batchPurgeRecycledEpisodes',reviewed,randomUUID())).status).toBe(400);
  expect((await f.keyed('batchPurgeRecycledEpisodes',{...reviewed,confirmed:true},randomUUID(),f.otherToken)).status).toBe(409);
  await access(safe.path);expect((await f.get()).body.items).toHaveLength(2);
  const key=randomUUID(),payload={...reviewed,confirmed:true};
  const [result,...duplicates]=await Promise.all(Array.from({length:4},()=>f.keyed('batchPurgeRecycledEpisodes',payload,key)));
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.items).toEqual(items.map(({episodeId})=>({episodeId,status:'success'})));
  for(const duplicate of duplicates)expect(duplicate).toEqual(result);
  await expect(access(safe.path)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(unknown,'utf8')).toBe('local notes');
  expect(await readFile(protectedItem.path)).toEqual(await readFile(shared));
  expect((await f.get()).body.items).toEqual([]);
  expect(await f.keyed('batchPurgeRecycledEpisodes',payload,key)).toEqual(result);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('batch purge reports blockers, rejects stale scope and identity per row, and confirms only reviewed retries',async()=>{
 const f=await recycleFixture();try{
  const safe=await registeredEpisode(f,1024),lateShared=await registeredEpisode(f,1024),replaced=await registeredEpisode(f,1024),reentered=await registeredEpisode(f,1024),blocked=await registeredEpisode(f,1024);
  const items=[];
  for(const item of [safe,lateShared,replaced,reentered,blocked]){
   const recycled=await f.recycle('recycleEpisode',{episodeId:item.episode});
   expect(recycled.status,JSON.stringify(recycled.body)).toBe(200);
   items.push({episodeId:item.episode,revision:recycled.body.revision});
  }
  const pending=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','running','{}')",[pending,blocked.episode]);
  const preview=await f.keyed('previewBatchRecyclePurge',{items},randomUUID());
  expect(preview.status,JSON.stringify(preview.body)).toBe(200);
  expect(preview.body.items).toMatchObject([
   {episodeId:safe.episode,status:'ready'},
   {episodeId:lateShared.episode,status:'ready',scope:{files:[{path:lateShared.path}],preserved:[]}},
   {episodeId:replaced.episode,status:'ready'},
   {episodeId:reentered.episode,status:'ready'},
   {episodeId:blocked.episode,status:'failed',reason:expect.stringContaining('运行任务'),scope:{files:[{path:blocked.path}]}}
  ]);
  expect(preview.body.items[4]).not.toHaveProperty('confirmation');
  const alias=join(f.root,'late-shared.bin'),original=join(f.root,'original-inode.bin');
  await link(lateShared.path,alias);
  await rename(replaced.path,original);
  await writeFile(replaced.path,await readFile(original));
  expect((await f.recycle('restoreRecycledEpisode',items[3])).status).toBe(200);
  const newMembership=await f.recycle('recycleEpisode',{episodeId:reentered.episode});
  expect(newMembership.status).toBe(200);
  expect(newMembership.body.revision).not.toBe(items[3].revision);
  const reviewed=preview.body.items.slice(0,4).map((item:any)=>item.confirmation);
  const tampered=reviewed.map((item:any)=>({...item,expectedRevision:'f'.repeat(64)}));
  expect((await f.keyed('batchPurgeRecycledEpisodes',{items:tampered,confirmed:true},randomUUID())).status).toBe(409);
  await access(safe.path);
  const result=await f.keyed('batchPurgeRecycledEpisodes',{items:reviewed,confirmed:true},randomUUID());
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.items).toMatchObject([
   {episodeId:safe.episode,status:'success'},
   {episodeId:lateShared.episode,status:'failed',reason:expect.stringContaining('重新查看')},
   {episodeId:replaced.episode,status:'failed',reason:expect.stringContaining('已变化')},
   {episodeId:reentered.episode,status:'failed',reason:expect.stringContaining('回收站记录已变化')},
  ]);
  await expect(access(safe.path)).rejects.toMatchObject({code:'ENOENT'});
  await access(lateShared.path);await access(replaced.path);await access(reentered.path);await access(blocked.path);
  expect((await f.get()).body.items.map((item:any)=>item.episodeId)).toEqual([lateShared.episode,replaced.episode,blocked.episode,reentered.episode]);
  await rename(original,replaced.path);
  await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[pending]);
  const retries=items.slice(1).map(item=>item.episodeId===reentered.episode?{...item,revision:newMembership.body.revision}:item);
  const retry=await f.keyed('previewBatchRecyclePurge',{items:retries},randomUUID());
  expect(retry.body.items).toMatchObject([
   {episodeId:lateShared.episode,status:'ready',scope:{files:[],preserved:[{path:lateShared.path}]}},
   {episodeId:replaced.episode,status:'ready'},
   {episodeId:reentered.episode,status:'ready'},
   {episodeId:blocked.episode,status:'ready'},
  ]);
  await access(replaced.path);await access(reentered.path);await access(blocked.path);
  const confirmed=await f.keyed('batchPurgeRecycledEpisodes',{items:retry.body.items.map((item:any)=>item.confirmation),confirmed:true},randomUUID());
  expect(confirmed.body.items).toEqual(items.slice(1).map(({episodeId})=>({episodeId,status:'success'})));
  expect(await readFile(lateShared.path)).toEqual(await readFile(alias));
  await expect(access(replaced.path)).rejects.toMatchObject({code:'ENOENT'});
  await expect(access(reentered.path)).rejects.toMatchObject({code:'ENOENT'});
  await expect(access(blocked.path)).rejects.toMatchObject({code:'ENOENT'});
  expect((await f.get()).body.items).toEqual([]);
 }finally{await f.close();}
},120000);
