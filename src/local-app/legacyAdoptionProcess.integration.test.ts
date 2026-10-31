// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,rename,readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a paused native copy reserves an unregistered shared legacy source against archive and exact deletion',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/123-legacy-storage-adoption.sql']}),{f}=fixture;let pending:Promise<any>|undefined;
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  await mkdir(join(f.root,'episodes'));await rename(join(f.assetRoot,'episodes',f.episode),join(f.root,'episodes',f.episode));await f.c.query('DELETE FROM local_identity.account_asset_directories WHERE account_id=$1',[account]);await f.c.query('UPDATE local_identity.episode_asset_locations SET asset_root=$2 WHERE episode_id=$1',[f.episode,f.root]);
  const runtime=await fixture.launch('adoption-pause-copy-write');
  const post=async(route:string,command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:r.status,body:await r.json()};};
  expect((await post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:true})).status).toBe(200);
  const deletion=await post('episode-lifecycle','planDeletion',{episodeId:f.episode});expect(deletion.status,JSON.stringify(deletion.body)).toBe(200);
  const plan=await post('account-commands','planLegacyStorageAdoption',{accountId:account});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.conflicts).toEqual([]);
  const source=await deletionFixtureFingerprint(join(f.root,'episodes'));
  pending=post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id});
  let marker:any;for(let i=0;i<200;i++){try{marker=JSON.parse(await readFile(join(fixture.runtimeRoot,'adoption-copy-paused.json'),'utf8'));break;}catch{}await pause(20);}expect(marker?.pid).toBe(runtime.pid);
  expect((await f.c.query('SELECT status FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows[0].status).toBe('copying');
  const deleted=await post('episode-lifecycle','deleteEpisode',{episodeId:f.episode,confirmation:deletion.body.confirmation,expectedPath:deletion.body.path,expectedPaths:deletion.body.paths,expectedRevision:deletion.body.revision}),archive=await post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:false});
  expect.soft(archive.status,JSON.stringify(archive.body)).toBe(409);expect.soft(deleted.status,JSON.stringify(deleted.body)).toBe(409);
  expect.soft(await deletionFixtureFingerprint(join(f.root,'episodes'))).toEqual(source);
  expect.soft(Number((await f.c.query('SELECT count(*) n FROM local_identity.episode_deletion_intents WHERE episode_id=$1',[f.episode])).rows[0].n)).toBe(0);
  await writeFile(join(fixture.runtimeRoot,'adoption-copy-resume'),'resume');const result=await pending;pending=undefined;expect(result.status,JSON.stringify(result.body)).toBe(200);
 }finally{await writeFile(join(fixture.runtimeRoot,'adoption-copy-resume'),'resume').catch(()=>{});await pending?.catch(()=>{});await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['resume','rollback'] as const)('SIGKILL after a durable temp identity permits %s of the same plan in a fresh process without a second active directory',async action=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/123-legacy-storage-adoption.sql']}),{f}=fixture;
 try{
  let runtime=await fixture.launch();const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});return{status:r.status,body:await r.json()};};
  const plan=await post('planLegacyStorageAdoption',{});expect(plan.status,JSON.stringify(plan.body)).toBe(200);await fixture.stop();runtime=await fixture.launch('adoption-copy-write');const originalPid=runtime.pid;
  await expect(post('executeAssetDirectoryMigration',{migrationId:plan.body.id})).rejects.toThrow();
  const saved=(await f.c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows[0];expect(saved.status).toBe('copying');expect(saved.manifest.temporaryFiles).toHaveLength(1);const temp=saved.manifest.temporaryFiles[0];expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);
  const source=await deletionFixtureFingerprint(join(f.assetRoot,'episodes'));
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(originalPid);if(action==='rollback'){const result=await post('rollbackAssetDirectoryMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe('rolled_back');expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);expect(await deletionFixtureFingerprint(join(f.assetRoot,'episodes'))).toEqual(source);expect((await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path).toBe(f.episodeRelativePath);expect((await post('executeAssetDirectoryMigration',{migrationId:plan.body.id})).status).toBe(409);return;}const result=await post('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.episodes[0].targetPrefix).toBe(plan.body.episodes[0].targetPrefix);
  expect(await deletionFixtureFingerprint(join(f.assetRoot,'episodes'))).toEqual(source);expect((await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path).toBe(plan.body.episodes[0].targetPrefix);
  expect((await post('executeAssetDirectoryMigration',{migrationId:plan.body.id})).status).toBe(200);
 }finally{await fixture.close();}
},180000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a real application preserves its old readable location and unknown target data when controlled capacity is exhausted',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/123-legacy-storage-adoption.sql']}),{f}=fixture;
 try{let runtime=await fixture.launch();const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});return{status:r.status,body:await r.json()};};
  const source=await deletionFixtureFingerprint(join(f.assetRoot,'episodes')),plan=await post('planLegacyStorageAdoption');expect(plan.status).toBe(200);await fixture.stop();runtime=await fixture.launch('adoption-space');const result=await post('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(409);expect((await f.c.query('SELECT error FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows[0].error).toContain('空间不足');
  const target=join(plan.body.targetRoot,plan.body.episodes[0].targetPrefix);await writeFile(join(target,'manual-preserved.txt'),'Unknown partial target must remain.');const manual=await lstat(join(target,'manual-preserved.txt'));await fixture.stop();runtime=await fixture.launch();const retry=await post('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(retry.status,JSON.stringify(retry.body)).toBe(409);expect((await lstat(join(target,'manual-preserved.txt'))).ino).toBe(manual.ino);expect((await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path).toBe(f.episodeRelativePath);expect(await deletionFixtureFingerprint(join(f.assetRoot,'episodes'))).toEqual(source);const file=f.files[0],read=await fetch(runtime.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(file.relativePath)+'&sha256='+file.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);expect((await post('rollbackAssetDirectoryMigration',{migrationId:plan.body.id})).status).toBe(200);expect(await readFile(join(target,'manual-preserved.txt'),'utf8')).toBe('Unknown partial target must remain.');
 }finally{await fixture.close();}
},180000);
