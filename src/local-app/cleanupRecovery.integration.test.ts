// @vitest-environment node
import {it,expect} from 'vitest';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,access,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {cleanupRecoveryProcess} from './cleanupRecoveryProcess.fixture';
it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1').each(['link-before-unlink','before-finalize','after-first-finalize'] as const)('the recovery entry resumes %s after process death using only the durable scope',async crash=>{
 const f=await embeddedStudioFixture(),processes:Awaited<ReturnType<typeof cleanupRecoveryProcess>>[]=[];
 try{
  const manual=join(f.assetRoot,f.episodeRelativePath,'手放保留.txt');await writeFile(manual,'untouched across recovery');const before=await lstat(manual);
  const first=await cleanupRecoveryProcess(f,crash);processes.push(first);expect((await first.post('archiveEpisode',{episodeId:f.episode,archived:true})).status).toBe(200);
  const plan=await first.post('planDeletion',{episodeId:f.episode});expect(plan.status).toBe(200);const key=randomUUID(),dead=once(first.child,'exit',{signal:AbortSignal.timeout(10000)});
  await first.post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision},key).catch(()=>null);await dead;
  const prepared=crash==='link-before-unlink';expect((await f.c.query('SELECT state FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0].state).toBe(prepared?'prepared':'committed');
  const second=await cleanupRecoveryProcess(f);processes.push(second);expect(second.pid).not.toBe(first.pid);
  const readPending=async()=>{const r=await fetch(second.origin+'/api/local/deletion-cleanups',{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return r.json();};
  expect(await readPending()).toEqual(expect.arrayContaining([expect.objectContaining({cleanupKey:key,...(prepared?{phase:'prepared'}:{})})]));
  const result=await second.post('retryDeletionCleanup',{deletionKey:key});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.cleanupPending).toBe(false);if(prepared)expect(result.body.recovered).toBe(true);
  for(const file of plan.body.files){if(prepared)await access(file.path);else await expect(access(file.path)).rejects.toMatchObject({code:'ENOENT'});}
  expect((await f.c.query('SELECT count(*)::integer n FROM public.episodes WHERE id=$1',[f.episode])).rows[0].n).toBe(prepared?1:0);
  expect(await readFile(manual,'utf8')).toBe('untouched across recovery');expect((await lstat(manual)).ino).toBe(before.ino);expect(await readPending()).toEqual([]);
  const again=await second.post('retryDeletionCleanup',{deletionKey:key});expect(again.status).toBe(200);expect(again.body.cleanupPending).toBe(false);expect(await readFile(manual,'utf8')).toBe('untouched across recovery');
 }finally{for(const child of processes)await child.close();await f.close();}
},120000);
it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('keeps the concrete cleanup failure after restart and exposes it only to its Owner',async()=>{
 const f=await embeddedStudioFixture(),processes:Awaited<ReturnType<typeof cleanupRecoveryProcess>>[]=[];
 try{
  const first=await cleanupRecoveryProcess(f,'fail-finalize');processes.push(first);await first.post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await first.post('planDeletion',{episodeId:f.episode}),key=randomUUID();
  const result=await first.post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision},key);expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body).toMatchObject({cleanupPending:true,message:expect.stringContaining('文件暂时被占用')});await first.close();
  const second=await cleanupRecoveryProcess(f);processes.push(second);const read=async(token:string)=>{const r=await fetch(second.origin+'/api/local/deletion-cleanups',{headers:{Cookie:'loop_owner_session='+token}});expect(r.status).toBe(200);return r.json();};
  expect(await read(f.token)).toEqual(expect.arrayContaining([expect.objectContaining({cleanupKey:key,message:result.body.message})]));expect(await read(f.otherToken)).toEqual([]);
  expect((await f.c.query("SELECT has_function_privilege('loop_worker','local_identity.record_owned_deletion_cleanup_error(uuid,text)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
  const retried=await second.post('retryDeletionCleanup',{deletionKey:key});expect(retried.status).toBe(200);expect(retried.body.cleanupPending).toBe(false);expect(retried.body.message).toBeUndefined();expect(await read(f.token)).toEqual([]);
 }finally{for(const child of processes)await child.close();await f.close();}
},120000);
it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('keeps a restore conflict across restart without changing the frozen manifest or overwriting the blocker',async()=>{
 const f=await embeddedStudioFixture(),processes:Awaited<ReturnType<typeof cleanupRecoveryProcess>>[]=[];
 try{
  const first=await cleanupRecoveryProcess(f,'link-before-unlink');processes.push(first);await first.post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await first.post('planDeletion',{episodeId:f.episode}),key=randomUUID(),dead=once(first.child,'exit',{signal:AbortSignal.timeout(10000)});
  await first.post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision},key).catch(()=>null);await dead;
  const intent=(await f.c.query('SELECT manifest,payload_hash FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0];
  const file=intent.manifest.targets.flatMap((t:any)=>t.files).find((file:any)=>existsSync(file.stagingPath));
  expect(file).toBeTruthy();const expected=await readFile(file.stagingPath);await unlink(file.path);await writeFile(file.path,'unconfirmed occupied file',{flag:'wx'});const blocker=await lstat(file.path);
  const second=await cleanupRecoveryProcess(f);processes.push(second);const failed=await second.post('retryDeletionCleanup',{deletionKey:key});expect(failed.status).toBe(200);expect(failed.body).toMatchObject({cleanupPending:true,message:expect.stringContaining('文件恢复尚未完成')});await second.close();
  expect(await readFile(file.path,'utf8')).toBe('unconfirmed occupied file');expect((await lstat(file.path)).ino).toBe(blocker.ino);
  const after=(await f.c.query('SELECT manifest,payload_hash FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0];expect(after).toEqual(intent);
  const third=await cleanupRecoveryProcess(f);processes.push(third);const pending=await fetch(third.origin+'/api/local/deletion-cleanups',{headers:{Cookie:'loop_owner_session='+f.token}});expect(await pending.json()).toEqual(expect.arrayContaining([expect.objectContaining({cleanupKey:key,message:failed.body.message})]));
  await unlink(file.path);const recovered=await third.post('retryDeletionCleanup',{deletionKey:key});expect(recovered.status).toBe(200);expect(recovered.body).toMatchObject({cleanupPending:false,recovered:true});expect(await readFile(file.path)).toEqual(expected);
 }finally{for(const child of processes)await child.close();await f.close();}
},120000);
