// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,rename,writeFile,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {prepareCollectionTargets,collectionOwnerPost} from './episodeCollection.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('an old registered layout2 without a real container uses frozen-series compatibility until explicit adoption, while registered NULL means unassigned',async()=>{
 const f=await embeddedStudioFixture({episodeRelativePath:()=> '历史位置/独占生产单'});try{
  const post=collectionOwnerPost(f),account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const a=await post('configuration','createSeries',{accountId:account,name:'旧创作系列',rules:{}});expect(a.status).toBe(200);
  // Genuine pre-container SQL110 shape, fixed before taking the historical baseline.
  await f.c.query('UPDATE public.episodes SET series_version_id=$2 WHERE id=$1',[f.episode,a.body.id]);
  const read=await post('account-commands','readEpisodeCollection',{episodeId:f.episode});expect(read.body.collection).toMatchObject({status:'legacy',seriesId:a.body.series_id});expect((await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:null})).status).toBe(409);
  const adopted=await post('account-commands','planLegacyStorageAdoption',{accountId:account});expect(adopted.status).toBe(200);expect(adopted.body.conflicts).toEqual([]);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:adopted.body.id})).status).toBe(200);
  const moved=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:null});expect(moved.status).toBe(200);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:moved.body.id})).status).toBe(200);
  const current=await post('account-commands','readEpisodeCollection',{episodeId:f.episode});expect(current.body.collection).toMatchObject({status:'registered',seriesId:null,name:'未分系列'});expect(current.body.creative.seriesVersionId).toBe(a.body.id);
  const listed=await fetch(f.origin+'/api/local/catalog?view=episodes&seriesId=unassigned',{headers:{Cookie:'loop_owner_session='+f.token}});expect((await listed.json()).episodes.map((e:{id:string})=>e.id)).toContain(f.episode);
  const old=await fetch(f.origin+'/api/local/catalog?view=episodes&seriesId='+a.body.series_id,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await old.json()).episodes).toEqual([]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('collection commands are idempotent, reject cross-account and client paths, and maintain archived/completed orders without unlocking content',async()=>{
 const f=await embeddedStudioFixture();try{
  const {post,account,a,b}=await prepareCollectionTargets(f),before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1',[f.episode])).rows,key=randomUUID();
  const other=await post('configuration','createAccount',{name:'另一账号',slug:'other-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});expect(other.status).toBe(200);const foreign=await post('configuration','createSeries',{accountId:other.body.id,name:'外部系列',rules:{}});expect(foreign.status).toBe(200);
  expect((await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:foreign.body.series_id})).status).toBe(404);
  expect((await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id,path:'/tmp/arbitrary'})).status).toBe(400);
  const requests=await Promise.all([post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id},key),post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id},key)]);expect(requests.map(r=>r.status)).toEqual([200,200]);expect(requests[1].body.id).toBe(requests[0].body.id);expect((await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:b.series_id},key)).status).toBe(409);
  expect((await post('account-commands','rollbackAssetDirectoryMigration',{accountId:account,migrationId:requests[0].body.id})).status).toBe(200);
  await f.c.query("UPDATE public.episodes SET stage='production_completed',archived_at=now() WHERE id=$1",[f.episode]);
  const frozen=(await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.episode])).rows;
  const plan=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(plan.status).toBe(200);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id})).status).toBe(200);
  expect((await f.request('importMaterial',{sourceKind:'file',sourcePath:'new.txt',materialType:'script',materialPurpose:'main_script',mimeType:'text/plain',isMainScript:true,contentBase64:Buffer.from('blocked').toString('base64')})).status).toBe(409);
  expect((await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.episode])).rows).toEqual(frozen);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1',[f.episode])).rows).toEqual(before);
  expect((await post('account-commands','readEpisodeCollection',{episodeId:f.episode})).body.collection).toMatchObject({status:'registered',seriesId:a.series_id});
  const denied=collectionOwnerPost({...f,token:f.otherToken});expect((await denied('account-commands','readEpisodeCollection',{episodeId:f.episode})).status).toBe(404);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each(['episode','source-container','target-container','bytes'] as const)('a real %s change across final SQL aborts the move without changing current authority or overwriting unknown data',async phase=>{
 const f=await embeddedStudioFixture();let pending:Promise<any>|undefined;
 try{
  const {post,account,a}=await prepareCollectionTargets(f),old=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0],oldPath=join(old.asset_root,old.directory_relative_path),original=await deletionFixtureFingerprint(oldPath);
  const planned=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(planned.status).toBe(200);const plan=planned.body;
  await f.c.query("CREATE FUNCTION public.pause_t14_cutover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(17819214);RETURN NEW;END $$;CREATE TRIGGER pause_t14_cutover BEFORE UPDATE OF directory_relative_path ON local_identity.episode_asset_locations FOR EACH ROW EXECUTE FUNCTION public.pause_t14_cutover()");await f.c.query('SELECT pg_advisory_lock(17819214)');
  pending=post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.id});let blocked=false;for(let i=0;i<150;i++){blocked=Number((await f.c.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND objid=17819214 AND NOT granted")).rows[0].n)>0;if(blocked)break;await pause(20);}expect(blocked).toBe(true);
  const targetPath=join(plan.targetRoot,plan.episodes[0].targetPrefix),changed=phase==='source-container'?join(plan.targetRoot,plan.containers[0].prefix):phase==='target-container'?join(plan.targetRoot,plan.containers[1].prefix):targetPath;
  if(phase==='bytes')await writeFile(join(changed,'shot.mp4'),'preserve injected bytes');else{await rename(changed,changed+'.retained');await mkdir(changed);await writeFile(join(changed,'unknown.txt'),'preserve changed identity');}const identity=await lstat(changed);
  await f.c.query('SELECT pg_advisory_unlock(17819214)');const result=await pending;pending=undefined;expect(result.status,JSON.stringify(result.body)).toBe(409);
  expect((await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0]).toEqual(old);expect(Number((await f.c.query('SELECT count(*) n FROM local_identity.storage_location_operations WHERE migration_id=$1',[plan.id])).rows[0].n)).toBe(0);expect((await lstat(changed)).ino).toBe(identity.ino);expect(await readFile(join(changed,phase==='bytes'?'shot.mp4':'unknown.txt'),'utf8')).toBe(phase==='bytes'?'preserve injected bytes':'preserve changed identity');
  expect(await deletionFixtureFingerprint(phase==='source-container'?join(changed+'.retained',old.directory_relative_path.split('/')[1]):oldPath)).toEqual(original);
 }finally{await f.c.query('SELECT pg_advisory_unlock(17819214)').catch(()=>{});await pending?.catch(()=>{});await f.close();}
},120000);
