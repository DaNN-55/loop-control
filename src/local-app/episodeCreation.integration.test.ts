// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {lstat,readdir,rename,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const ownerPost=(f:Awaited<ReturnType<typeof embeddedStudioFixture>>)=>(route:string,command:string,data:Record<string,unknown>,key=randomUUID())=>fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key})}).then(async r=>({status:r.status,body:await r.json()}));
it.skipIf(!enabled)('formal Owner creation places each production order directly in its registered series or unassigned container',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath}});const post=ownerPost(f);
 try{
  const account=(await f.c.query('SELECT id FROM public.accounts')).rows[0].id;
  const series=await post('configuration','createSeries',{accountId:account,name:'系列 [100% #?]✨',rules:{extension:{original:true}}});expect(series.status,JSON.stringify(series.body)).toBe(200);
  for(const isTest of [{unexpected:true},'bad',null]){
   const key=randomUUID(),before=await readdir(f.assetRoot),data={accountId:account,title:'invalid boolean',seriesVersionId:series.body.id,isTest};
   expect((await post('episode-commands','create',data,key)).status).toBe(400);expect((await f.c.query('SELECT 1 FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rowCount).toBe(0);expect((await f.c.query('SELECT 1 FROM local_identity.command_receipts WHERE idempotency_key=$1',[key])).rowCount).toBe(0);expect(await readdir(f.assetRoot)).toEqual(before);
   expect((await post('episode-commands','create',{...data,isTest:false},key)).status).toBe(200);
  }
  for(const seriesVersionId of [series.body.id,null]){
   const key=randomUUID(),data={accountId:account,title:'CON:/同名✨',seriesVersionId};
   const created=await post('episode-commands','create',data,key);expect(created.status,JSON.stringify(created.body)).toBe(200);
   const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[created.body.id])).rows[0];
   expect(location.layout_version).toBe(2);expect(location.storage_series_id).toBe(seriesVersionId?series.body.series_id:null);
   const container=await post('account-commands',seriesVersionId?'readSeriesDirectory':'readUnassignedDirectory',seriesVersionId?{seriesId:series.body.series_id}:{accountId:account});
   const path=join(location.asset_root,location.directory_relative_path);expect(dirname(path)).toBe(container.body.directoryPath);expect(basename(path)).toContain(created.body.id);expect(basename(path)).not.toMatch(/[/:?]/);expect(await readdir(path)).toEqual([]);expect((await lstat(path)).ino.toString()).toBe(location.directory_inode_id);
   expect((await post('episode-commands','create',data,key)).body).toEqual(created.body);expect((await post('episode-commands','create',{...data,title:'changed'},key)).status).toBe(409);
   await rename(path,path+'-retained');expect((await post('episode-commands','create',data,key)).status).toBe(409);await expect(lstat(path)).rejects.toMatchObject({code:'ENOENT'});await rename(path+'-retained',path);
  }
  expect((await f.c.query('SELECT count(*)::int n FROM public.series')).rows[0].n).toBe(1);expect((await f.c.query('SELECT count(*)::int n FROM public.series_versions')).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0]).toMatchObject({layout_version:1,directory_relative_path:`episodes/${f.episode}`});
 }finally{await f.close();await volume.close();}
},120000);

it.skipIf(!enabled)('pending production-order creation reserves its account against deletion and backup until the same command completes',async()=>{
 const volume=await workspaceAudioVolume(),storage=await mkdtemp(join(volume.mountPath,'t12-storage-'));await mkdir(join(storage,'state'));const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex'),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state'),runtime:{mountPath:volume.mountPath}}),post=ownerPost(f);
 try{
  const account=(await post('configuration','createAccount',{name:'Pending production',slug:'pending-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}})).body;
  const series=(await post('configuration','createSeries',{accountId:account.id,name:'reserved',rules:{}})).body,key=randomUUID(),data={accountId:account.id,title:'pending',seriesVersionId:series.id};
  await f.c.query("CREATE FUNCTION public.test_episode_creation_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'controlled final creation failure';END $$;CREATE TRIGGER test_episode_creation_fail BEFORE INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.test_episode_creation_fail()");
  expect((await post('episode-commands','create',data,key)).status).toBe(409);
  expect((await post('configuration','deleteAccount',{accountId:account.id,confirmation:'Pending production'})).status).toBe(409);
  const {assertStorageUnoccupied}=await import(new URL('../../scripts/storage/occupied.mjs',import.meta.url).href),{runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target);
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),backup=()=>createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot:join(storage,'backups',source),jobId:randomUUID()},undefined,{...context,mediaRoot:f.root});
  await expect(backup()).rejects.toThrow('episode_creation_intents');
  await expect(assertStorageUnoccupied(f.database,f.root,[],context)).rejects.toThrow('episode_creation_intents');
  await f.c.query('DROP TRIGGER test_episode_creation_fail ON public.episodes;DROP FUNCTION public.test_episode_creation_fail()');
  expect((await post('episode-commands','create',data,key)).status).toBe(200);await expect(assertStorageUnoccupied(f.database,f.root,[],context)).resolves.toBeUndefined();expect((await backup()).passed).toBe(true);
 }finally{await f.close();await rm(storage,{recursive:true,force:true});await volume.close();}
},120000);
