// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {prepareCollectionTargets,collectionOwnerPost} from './episodeCollection.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled).each([['resume','adoption-copy-write'],['rollback','adoption-copy-write'],['resume','adoption-copy-published'],['rollback','adoption-copy-published']] as const)('a real SIGKILL permits %s after %s using the same move target from a new application PID',async(action,crashAt)=>{
 const fixture=await nativeMediaRootFixture({existingData:true}),{f}=fixture;
 try{
  const {account,a}=await prepareCollectionTargets(f),old=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0],oldPath=join(old.asset_root,old.directory_relative_path),source=await deletionFixtureFingerprint(oldPath);
  let runtime=await fixture.launch(),post=collectionOwnerPost({...f,origin:runtime.origin});const plan=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(plan.status).toBe(200);
  await fixture.stop();runtime=await fixture.launch(crashAt);post=collectionOwnerPost({...f,origin:runtime.origin});const firstPid=runtime.pid;await expect(post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id})).rejects.toThrow();
  const durable=(await f.c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows[0];expect(durable.status).toBe('copying');expect(durable.manifest.temporaryFiles).toHaveLength(1);const temp=durable.manifest.temporaryFiles[0];expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);if(crashAt==='adoption-copy-published'){const temporary=await lstat(temp.path,{bigint:true}),published=await lstat(temp.path.slice(0,-('.migration-'+plan.body.id).length),{bigint:true});expect(temporary.nlink).toBe(2n);expect(published.dev).toBe(temporary.dev);expect(published.ino).toBe(temporary.ino);}
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(firstPid);post=collectionOwnerPost({...f,origin:runtime.origin});const result=await post('account-commands',action==='resume'?'executeAssetDirectoryMigration':'rollbackAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe(action==='resume'?'completed':'rolled_back');expect(await deletionFixtureFingerprint(oldPath)).toEqual(source);
  const current=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0];expect(current.directory_relative_path).toBe(action==='resume'?plan.body.episodes[0].targetPrefix:old.directory_relative_path);
  expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id})).status).toBe(action==='resume'?200:409);if(action==='rollback')expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);else await expect(lstat(temp.path)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await fixture.close();}
},180000);

it.skipIf(!enabled)('a copying move blocks archive, deletion and new production until its durable receipt finishes',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true}),{f}=fixture;let pending:Promise<any>|undefined;
 try{
  const {account,a}=await prepareCollectionTargets(f),runtime=await fixture.launch('adoption-pause-copy-write'),post=collectionOwnerPost({...f,origin:runtime.origin});
  expect((await post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:true})).status).toBe(200);const deletion=await post('episode-lifecycle','planDeletion',{episodeId:f.episode});expect(deletion.status).toBe(200);
  const plan=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(plan.status).toBe(200);pending=post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id});
  let marker:any;for(let i=0;i<200;i++){try{marker=JSON.parse(await readFile(join(fixture.runtimeRoot,'adoption-copy-paused.json'),'utf8'));break;}catch{}await pause(20);}expect(marker?.pid).toBe(runtime.pid);
  expect((await post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:false})).status).toBe(409);expect((await post('episode-lifecycle','deleteEpisode',{episodeId:f.episode,confirmation:deletion.body.confirmation,expectedPath:deletion.body.path,expectedPaths:deletion.body.paths,expectedRevision:deletion.body.revision})).status).toBe(409);expect((await post('episode-commands','create',{accountId:account,title:'Blocked',seriesVersionId:a.id})).status).toBe(409);expect((await f.c.query('SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=$1',[f.episode])).rowCount).toBe(0);
  await writeFile(join(fixture.runtimeRoot,'adoption-copy-resume'),'resume');const result=await pending;pending=undefined;expect(result.status,JSON.stringify(result.body)).toBe(200);
 }finally{await writeFile(join(fixture.runtimeRoot,'adoption-copy-resume'),'resume').catch(()=>{});await pending?.catch(()=>{});await fixture.close();}
},180000);
