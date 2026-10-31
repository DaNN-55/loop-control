// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,rename,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['exact','trailing-slash'] as const)('legacy global-root production stays readable and does not prevent a new isolated account (%s)',async variant=>{
 const f=await embeddedStudioFixture({migrations:['db/local/123-legacy-storage-adoption.sql']});
 try{
  const file=f.files[0],url=f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,headers={Cookie:'loop_owner_session='+f.token};
  expect((await fetch(url,{headers})).status).toBe(200);
  const original=await readFile(join(f.assetRoot,file.relativePath));
  // Controlled legacy source state: a genuine persisted Episode location points
  // to the shared global root, with its own UUID directory and no account root.
  await mkdir(join(f.root,'episodes'));
  await rename(join(f.assetRoot,'episodes',f.episode),join(f.root,'episodes',f.episode));
  await f.c.query('DELETE FROM local_identity.account_asset_directories WHERE account_id=(SELECT account_id FROM public.episodes WHERE id=$1)',[f.episode]);
  await f.c.query('UPDATE local_identity.episode_asset_locations SET asset_root=$2 WHERE episode_id=$1',[f.episode,f.root+(variant==='trailing-slash'?'/':'')]);
  await f.restart();
  const legacy=await fetch(url,{headers});const legacyBody=legacy.status===200?{bytesMatch:Buffer.from(await legacy.arrayBuffer()).equals(original)}:await legacy.json();
  const create=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{...headers,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'新独占账号',slug:'new-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}}})});
  const created=await create.json();
  await writeFile('/private/tmp/loop-control-178-20261031/T13/legacy-global-observation.json',JSON.stringify({legacyStatus:legacy.status,legacyBody,createStatus:create.status,createBody:created,legacyBytesUnchanged:Buffer.from(await readFile(join(f.root,file.relativePath))).equals(original)},null,2)+'\n');
  expect.soft(legacy.status,JSON.stringify(legacyBody)).toBe(200);
  expect.soft(create.status,JSON.stringify(created)).toBe(200);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner explicitly adopts only owned legacy episode scopes and preserves frozen references when the old source is offline',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/123-legacy-storage-adoption.sql']});
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const headers={Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  const command=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers,body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});return{status:response.status,body:await response.json()};};
  await mkdir(join(f.root,'episodes'));
  await rename(join(f.assetRoot,'episodes',f.episode),join(f.root,'episodes',f.episode));
  await writeFile(join(f.root,'unknown-owner.txt'),'preserve unknown');
  await f.c.query('DELETE FROM local_identity.account_asset_directories WHERE account_id=$1',[account]);
  await f.c.query('UPDATE local_identity.episode_asset_locations SET asset_root=$2 WHERE episode_id=$1',[f.episode,f.root]);
  const frozen=(await f.c.query('SELECT to_jsonb(t) data FROM public.tasks t WHERE episode_id=$1',[f.episode])).rows;
  const plan=await command('planLegacyStorageAdoption',{});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  expect(plan.body.episodes).toHaveLength(1);expect(plan.body.conflicts).toEqual([]);
  expect(plan.body.files.some((file:{relativePath:string})=>file.relativePath==='unknown-owner.txt')).toBe(false);
  const result=await command('executeAssetDirectoryMigration',{migrationId:plan.body.id});if(result.status!==200)console.error((await f.c.query('SELECT error FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows);expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.status).toBe('completed');
  await rename(join(f.root,'episodes'),join(f.root,'retained-offline'));
  const file=f.files[0],response=await fetch(f.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(file.relativePath)+'&sha256='+file.sha256,{headers:{Cookie:headers.Cookie,Range:'bytes=0-31'}});
  expect(response.status).toBe(206);expect((await response.arrayBuffer()).byteLength).toBe(32);
  expect((await f.c.query('SELECT to_jsonb(t) data FROM public.tasks t WHERE episode_id=$1',[f.episode])).rows).toEqual(frozen);
  expect(await readFile(join(f.root,'unknown-owner.txt'),'utf8')).toBe('preserve unknown');
  const replay=await command('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(replay.status,JSON.stringify(replay.body)).toBe(200);
  const replanned=await command('planLegacyStorageAdoption',{});expect(replanned.status,JSON.stringify(replanned.body)).toBe(200);expect(replanned.body.episodes[0].managed).toBe(true);expect(replanned.body.conflicts).toEqual([]);
  const repeated=await command('executeAssetDirectoryMigration',{migrationId:replanned.body.id});expect(repeated.status,JSON.stringify(repeated.body)).toBe(200);
  await writeFile(join(plan.body.targetRoot,plan.body.episodes[0].targetPrefix,'shot.mp4'),'changed current bytes');const damaged=await command('planLegacyStorageAdoption',{});expect(damaged.status,JSON.stringify(damaged.body)).toBe(200);expect(damaged.body.conflicts.some((message:string)=>message.includes('文件引用指纹不一致'))).toBe(true);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['episode','container','account','file'] as const)('a %s replacement while final SQL is paused rolls back the entire current switch and retains both generations',async phase=>{
 const f=await embeddedStudioFixture({migrations:['db/local/123-legacy-storage-adoption.sql']});let pending:Promise<{status:number;body:any}>|undefined;
 try{
  const {lstat}=await import('node:fs/promises'),{setTimeout:pause}=await import('node:timers/promises');
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const command=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});return{status:r.status,body:await r.json()};};
  await mkdir(join(f.root,'episodes'));await rename(join(f.assetRoot,'episodes',f.episode),join(f.root,'episodes',f.episode));await f.c.query('DELETE FROM local_identity.account_asset_directories WHERE account_id=$1',[account]);await f.c.query('UPDATE local_identity.episode_asset_locations SET asset_root=$2 WHERE episode_id=$1',[f.episode,f.root]);
  const plan=await command('planLegacyStorageAdoption');expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.conflicts).toEqual([]);
  await f.c.query("CREATE FUNCTION public.pause_t13_cutover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(17819113);RETURN NEW;END $$; CREATE TRIGGER pause_t13_cutover BEFORE UPDATE OF directory_relative_path ON local_identity.episode_asset_locations FOR EACH ROW EXECUTE FUNCTION public.pause_t13_cutover()");
  await f.c.query('SELECT pg_advisory_lock(17819113)');
  pending=command('executeAssetDirectoryMigration',{migrationId:plan.body.id});
  let blocked=false;for(let i=0;i<100;i++){blocked=Number((await f.c.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND objid=17819113 AND NOT granted")).rows[0].n)>0;if(blocked)break;await pause(20);}expect(blocked).toBe(true);
  const episodeTarget=join(plan.body.targetRoot,plan.body.episodes[0].targetPrefix),target=phase==='account'?plan.body.targetRoot:phase==='container'?join(plan.body.targetRoot,plan.body.episodes[0].targetPrefix.split('/')[0]):episodeTarget;
  if(phase==='file')await writeFile(join(target,'shot.mp4'),'preserve changed bytes');else{await rename(target,target+'.retained');await mkdir(target);await writeFile(join(target,'unknown.txt'),'preserve replacement');}const replaced=await lstat(target);
  await f.c.query('SELECT pg_advisory_unlock(17819113)');
  const result=await pending;pending=undefined;expect(result.status,JSON.stringify(result.body)).toBe(409);
  expect((await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path).toBe('episodes/'+f.episode);
  expect(Number((await f.c.query("SELECT count(*) n FROM local_identity.storage_location_operations WHERE migration_id=$1",[plan.body.id])).rows[0].n)).toBe(0);
  expect((await lstat(target)).ino).toBe(replaced.ino);expect(await readFile(join(target,phase==='file'?'shot.mp4':'unknown.txt'),'utf8')).toBe(phase==='file'?'preserve changed bytes':'preserve replacement');
  const file=f.files[0],response=await fetch(f.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(file.relativePath)+'&sha256='+file.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);
 }finally{await f.c.query('SELECT pg_advisory_unlock(17819113)').catch(()=>{});await pending?.catch(()=>{});await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('adoption history and retained sources survive current-only episode cleanup and deletion of the empty account',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/123-legacy-storage-adoption.sql']});
 try{
  const {deletionFixtureFingerprint}=await import('./deletionFingerprint.fixture');
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(route:string,command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:r.status,body:await r.json()};};
  await writeFile(join(f.assetRoot,'episodes',f.episode,'manual.txt'),'retained unknown source');
  const source=await deletionFixtureFingerprint(join(f.assetRoot,'episodes'));
  const planned=await post('account-commands','planLegacyStorageAdoption',{accountId:account});expect(planned.status).toBe(200);const adoption=await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:planned.body.id});expect(adoption.status,JSON.stringify(adoption.body)).toBe(200);
  const history=(await f.c.query('SELECT to_jsonb(m) value FROM local_identity.account_directory_migrations m WHERE id=$1',[planned.body.id])).rows;
  await post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('episode-lifecycle','planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  expect(plan.body.files.map((file:{path:string})=>file.path)).toContain(join(planned.body.targetRoot,planned.body.episodes[0].targetPrefix,'shot.mp4'));
  const deleted=await post('episode-lifecycle','deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);
  const empty=await post('configuration','deleteAccount',{accountId:account,confirmation:'Studio153 fixture'});expect(empty.status,JSON.stringify(empty.body)).toBe(200);
  expect((await f.c.query('SELECT to_jsonb(m) value FROM local_identity.account_directory_migrations m WHERE id=$1',[planned.body.id])).rows).toEqual(history);
  expect(await deletionFixtureFingerprint(join(f.assetRoot,'episodes'))).toEqual(source);
  expect(await readFile(join(planned.body.targetRoot,planned.body.episodes[0].targetPrefix,'manual.txt'),'utf8')).toBe('retained unknown source');
 }finally{await f.close();}
},120000);
