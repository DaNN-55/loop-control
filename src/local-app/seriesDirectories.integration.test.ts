// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('creates a series and retrieves its exclusive physical container through Owner HTTP',async()=>{
 const f=await embeddedStudioFixture();
 const headers={Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)};
 const post=async(route:string,command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:key})});return{status:response.status,body:await response.json()};};
 try{
  const {rows:[account]}=await f.c.query('SELECT id FROM public.accounts');const key=randomUUID();
  const created=await post('configuration','createSeries',{accountId:account.id,name:'CON:/系列✨',rules:{extension:{keep:['unchanged']}}},key);expect(created.status,JSON.stringify(created.body)).toBe(200);
  const read=await post('account-commands','readSeriesDirectory',{seriesId:created.body.series_id});expect(read.status,JSON.stringify(read.body)).toBe(200);expect(read.body).toMatchObject({accountId:account.id,seriesId:created.body.series_id,kind:'series',status:'ready'});
  expect(dirname(read.body.directoryPath)).toBe(f.assetRoot);expect((await lstat(read.body.directoryPath)).isDirectory()).toBe(true);expect(await readdir(read.body.directoryPath)).toEqual([]);
  expect((await post('configuration','createSeries',{accountId:account.id,name:'CON:/系列✨',rules:{extension:{keep:['unchanged']}}},key)).body).toEqual(created.body);
  expect((await post('configuration','createSeries',{accountId:account.id,name:'other',rules:{}},key)).status).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM public.series')).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('rejects client positions and exposes legacy/unassigned collection without read-time creation',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(route:string,command:string,data:Record<string,unknown>,token=f.token,csrf=true)=>{const r=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 try{
 const {rows:[a]}=await f.c.query('SELECT id FROM public.accounts');
 expect((await post('configuration','createSeries',{accountId:a.id,name:'client-path',rules:{},path:'/tmp'})).status).toBe(400);
 const legacy=randomUUID();await f.c.query('INSERT INTO public.series(id,account_id,name) VALUES($1,$2,$3)',[legacy,a.id,'legacy']);const before=await readdir(f.assetRoot);
 expect((await post('account-commands','readSeriesDirectory',{seriesId:legacy})).body).toMatchObject({status:'legacy-unmanaged',directoryPath:null});
 expect((await post('account-commands','openSeriesDirectory',{seriesId:legacy})).status).toBe(409);
 expect((await post('account-commands','readUnassignedDirectory',{accountId:a.id})).body).toMatchObject({status:'unset',seriesId:null});expect(await readdir(f.assetRoot)).toEqual(before);
 const [one,two]=await Promise.all([post('account-commands','createUnassignedDirectory',{accountId:a.id}),post('account-commands','createUnassignedDirectory',{accountId:a.id})]);expect(one.status,JSON.stringify(one)).toBe(200);expect(two.body).toEqual(one.body);
 const read=await post('account-commands','readUnassignedDirectory',{accountId:a.id});expect(read.body).toMatchObject({status:'ready',seriesId:null,containerId:one.body.containerId});expect((await f.c.query('SELECT count(*)::int n FROM public.series')).rows[0].n).toBe(1);expect((await f.c.query('SELECT count(*)::int n FROM public.series_versions')).rows[0].n).toBe(0);
 expect((await post('account-commands','readSeriesDirectory',{seriesId:legacy},f.otherToken)).status).toBe(404);expect((await post('account-commands','openUnassignedDirectory',{accountId:a.id,path:'/tmp'})).status).toBe(400);expect((await post('account-commands','createUnassignedDirectory',{accountId:a.id},f.token,false)).status).toBe(403);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('preserves replaced markers and rejects a directory swap during the final container INSERT',async()=>{
 const fs=await import('node:fs/promises'),{join}=await import('node:path'),f=await embeddedStudioFixture();
 try{
 const {rows:[a]}=await f.c.query('SELECT id FROM public.accounts');
 const call=async(name:string,key:string)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token),'Content-Type':'application/json'},body:JSON.stringify({command:'createSeries',idempotencyKey:key,data:{accountId:a.id,name,rules:{extension:{keep:true}}}})});return{status:r.status,body:await r.json()};};
 const pausedIntent=async(key:string)=>{for(let i=0;i<150;i++){const row=(await f.c.query('SELECT * FROM local_identity.container_creation_intents WHERE idempotency_key=$1',[key])).rows[0];if(row?.device_id&&(await f.c.query('SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND objid=178185 AND NOT granted')).rowCount)return row;await new Promise(r=>setTimeout(r,10));}throw Error('Final INSERT did not pause');};
 await f.c.query("CREATE FUNCTION public.test_container_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(178185); IF current_setting('test.fail',true)='yes' THEN RAISE EXCEPTION 'controlled container failure';END IF; RETURN NEW; END $$; CREATE TRIGGER test_container_pause BEFORE INSERT ON local_identity.account_storage_containers FOR EACH ROW EXECUTE FUNCTION public.test_container_pause()");
 // First: a same-byte replacement of our private marker grants no cleanup authority.
 await f.c.query('SELECT pg_advisory_lock(178185)');const markerKey=randomUUID(),markerCall=call('marker replacement',markerKey),intent=await pausedIntent(markerKey),path=join(intent.account_root,intent.directory_relative_path),marker=join(path,'.loop-control-creation.json'),bytes=await fs.readFile(marker);await fs.rename(marker,join(f.root,'original-marker'));await fs.writeFile(marker,bytes);const replacement=await fs.lstat(marker);expect(replacement.ino).not.toBe(Number(intent.marker_inode_id));await f.c.query('SELECT pg_advisory_unlock(178185)');expect((await markerCall).status).toBe(409);expect((await fs.lstat(marker)).ino).toBe(replacement.ino);expect(await fs.readFile(marker)).toEqual(bytes);
 // Second: final INSERT is already executing when the entire directory changes.
 await f.c.query('SELECT pg_advisory_lock(178185)');const key=randomUUID(),pending=call('directory replacement',key),swap=await pausedIntent(key),target=join(swap.account_root,swap.directory_relative_path);await fs.rename(target,target+'-retained');await fs.mkdir(target);await fs.writeFile(join(target,'.loop-control-creation.json'),await fs.readFile(join(target+'-retained','.loop-control-creation.json')));await fs.writeFile(join(target,'manual.txt'),'unknown owner bytes');await f.c.query('SELECT pg_advisory_unlock(178185)');expect((await pending).status).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM public.series')).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.account_storage_containers')).rows[0].n).toBe(0);expect(await fs.readFile(join(target,'manual.txt'),'utf8')).toBe('unknown owner bytes');await f.restart();expect((await call('directory replacement',key)).status).toBe(409);expect(await fs.readFile(join(target,'manual.txt'),'utf8')).toBe('unknown owner bytes');
 }finally{await f.c.query('SELECT pg_advisory_unlock_all()');await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('read/open never recreate missing or replaced series directories and metadata rename leaves frozen versions intact',async()=>{
 const fs=await import('node:fs/promises'),{join}=await import('node:path'),f=await embeddedStudioFixture();
 const call=async(route:string,command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 try{
 const {rows:[a]}=await f.c.query('SELECT id FROM public.accounts'),create=await call('configuration','createSeries',{accountId:a.id,name:'same',rules:{extension:{v:1}}});const id=create.body.series_id;const location=(await call('account-commands','readSeriesDirectory',{seriesId:id})).body;await fs.writeFile(join(location.directoryPath,'manual.txt'),'manual bytes');
 const same=await Promise.all([call('configuration','createSeries',{accountId:a.id,name:'same',rules:{}}),call('configuration','createSeries',{accountId:a.id,name:'same',rules:{}})]);for(const row of same)expect(row.status,JSON.stringify(row)).toBe(200);expect(new Set([id,...same.map(r=>r.body.series_id)]).size).toBe(3);
 const version=await call('configuration','createSeriesVersion',{seriesId:id,rules:{extension:{v:2}}});expect(version.status).toBe(200);const versions=(await f.c.query('SELECT * FROM public.series_versions WHERE series_id=$1 ORDER BY version',[id])).rows;await f.c.query('UPDATE public.episodes SET series_version_id=$1 WHERE id=$2',[create.body.id,f.episode]);const snapshots=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE episode_id=$1',[f.episode])).rows;
 expect((await call('configuration','renameSeries',{seriesId:id,name:'same renamed'})).status).toBe(200);expect((await f.c.query('SELECT * FROM public.series_versions WHERE series_id=$1 ORDER BY version',[id])).rows).toEqual(versions);expect((await f.c.query('SELECT series_version_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].series_version_id).toBe(create.body.id);expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE episode_id=$1',[f.episode])).rows).toEqual(snapshots);
 await fs.rename(location.directoryPath,location.directoryPath+'-retained');expect((await call('account-commands','readSeriesDirectory',{seriesId:id})).body).toMatchObject({directoryPath:location.directoryPath,status:'unavailable'});expect((await call('account-commands','openSeriesDirectory',{seriesId:id})).status).toBe(409);await expect(lstat(location.directoryPath)).rejects.toMatchObject({code:'ENOENT'});
 await fs.mkdir(location.directoryPath);await fs.writeFile(join(location.directoryPath,'foreign.txt'),'unknown replacement');expect((await call('account-commands','openSeriesDirectory',{seriesId:id})).status).toBe(409);expect(await fs.readFile(join(location.directoryPath,'foreign.txt'),'utf8')).toBe('unknown replacement');await fs.rm(location.directoryPath,{recursive:true});await fs.symlink(location.directoryPath+'-retained',location.directoryPath);expect((await call('account-commands','openSeriesDirectory',{seriesId:id})).status).toBe(409);await fs.unlink(location.directoryPath);await fs.rename(location.directoryPath+'-retained',location.directoryPath);
 await fs.chmod(location.directoryPath,0);try{expect((await call('account-commands','readSeriesDirectory',{seriesId:id})).body.status).toBe('unavailable');expect((await call('account-commands','openSeriesDirectory',{seriesId:id})).status).toBe(403);}finally{await fs.chmod(location.directoryPath,0o700);}expect(await fs.readFile(join(location.directoryPath,'manual.txt'),'utf8')).toBe('manual bytes');await f.restart();expect((await call('account-commands','readSeriesDirectory',{seriesId:id})).body).toMatchObject({status:'ready',directoryPath:location.directoryPath});
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('refuses final commit when the account root changes even if the original child and marker are moved intact',async()=>{
 const fs=await import('node:fs/promises'),{join}=await import('node:path'),f=await embeddedStudioFixture();
 try{
 const {rows:[a]}=await f.c.query('SELECT id FROM public.accounts'),key=randomUUID();await f.c.query("CREATE FUNCTION public.test_container_parent_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(178187);RETURN NEW;END $$;CREATE TRIGGER test_container_parent_pause BEFORE INSERT ON local_identity.account_storage_containers FOR EACH ROW EXECUTE FUNCTION public.test_container_parent_pause()");await f.c.query('SELECT pg_advisory_lock(178187)');
 const pending=fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createSeries',idempotencyKey:key,data:{accountId:a.id,name:'parent identity',rules:{}}})});let intent:any;
 for(let i=0;i<150;i++){intent=(await f.c.query('SELECT * FROM local_identity.container_creation_intents WHERE idempotency_key=$1',[key])).rows[0];if(intent?.device_id&&(await f.c.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=178187 AND NOT granted")).rowCount)break;await new Promise(r=>setTimeout(r,10));}expect(intent.device_id).toBeTruthy();
 const child=join(f.assetRoot,intent.directory_relative_path);await fs.rename(f.assetRoot,f.assetRoot+'-retained');await fs.mkdir(f.assetRoot);await fs.rename(join(f.assetRoot+'-retained',intent.directory_relative_path),child);expect((await fs.lstat(child)).ino.toString()).toBe(intent.inode_id);await fs.writeFile(join(f.assetRoot,'manual.txt'),'unknown replacement account root');await f.c.query('SELECT pg_advisory_unlock(178187)');expect((await pending).status).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM public.series')).rows[0].n).toBe(0);expect(await fs.readFile(join(f.assetRoot,'manual.txt'),'utf8')).toBe('unknown replacement account root');expect((await fs.lstat(child)).ino.toString()).toBe(intent.inode_id);expect(await fs.readdir(child)).toEqual(['.loop-control-creation.json']);
 }finally{await f.c.query('SELECT pg_advisory_unlock_all()');await f.close();}
},120000);
