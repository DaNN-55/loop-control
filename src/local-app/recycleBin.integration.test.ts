// @vitest-environment node
// Dedicated random PostgreSQL fixture + real Owner HTTP/files. Never uses daily data.
import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir,lstat,rename,access,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {csrfFor} from './sessions';
const enabled=process.env.LOOP_RECYCLE_ACCEPTANCE==='1';
const migration='160-episode-recycle-bin.sql';

export async function recycleFixture(){
 const f=await productionWorkspaceFixture({migrations:['db/local/'+migration]});
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
  expect((await f.c.query("SELECT local_identity.input_task_allowed($1,'draft_storyboard_revision') allowed",[f.episode])).rows[0].allowed).toBe(false);const worker=f.workerPool();expect((await worker.query('SELECT * FROM local_identity.plan_input_tasks($1)',[f.episode])).rows).toEqual([]);await worker.end();
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
 const f=await recycleFixture();try{
  const rows=(await f.c.query('SELECT version,sha256 FROM local_identity.schema_migrations ORDER BY version')).rows;
  const after=Object.fromEntries(rows.map(row=>[row.version,row.sha256]));
  for(const [version,sha] of Object.entries(before))expect(after[version]).toBe(sha);
  expect(after[migration]).toBe(createHash('sha256').update(await readFile('db/local/'+migration)).digest('hex'));
  expect((await f.c.query("SELECT count(*)::int count FROM local_identity.episode_recycle_bin")).rows[0].count).toBe(0);
  expect((await f.c.query("SELECT local_identity.is_recycled_episode($1) recycled",[f.episode])).rows[0].recycled).toBe(false);
  const policies=(await f.c.query("SELECT policyname FROM pg_policies WHERE schemaname='local_identity' AND tablename IN ('episode_recycle_bin','recycle_bin_settings')")).rows;
  expect(policies).toHaveLength(2);
 }finally{await f.close();}
},120000);
