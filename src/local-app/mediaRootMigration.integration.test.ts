// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,readdir,writeFile,mkdir,lstat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('an unreadable production file returns a recoverable storage reason and leaves its original bytes untouched',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-permissions-')),path=join(f.assetRoot,f.videoPath),before=await readFile(path);
 try{
  await chmod(path,0);const response=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),body=await response.json();expect(response.status,JSON.stringify(body)).toBe(409);expect(body.error).toContain('权限');expect(await readdir(target)).toEqual([]);
 }finally{await chmod(path,0o600);expect(await readFile(path)).toEqual(before);await f.close();await rm(target,{recursive:true});}
},60000);
it.skipIf(!enabled)('Owner persists a whole-workspace plan outside the old parent without changing active storage or source bytes',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-target-'));
 try{
  const binding=(await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
  const original=await readFile(join(f.assetRoot,f.videoPath)),key=randomUUID();
  const plan=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:key})});
  const result=await plan.json();expect(plan.status,JSON.stringify(result)).toBe(200);
  expect(result.status).toBe('planned');expect(result.manifest.sourceBinding).toEqual(binding);expect(result.manifest.targetBinding.path).toBe(target);
  expect(result.manifest.episodes.map((e:{id:string})=>e.id)).toEqual([f.episode]);expect(result.manifest.files).toHaveLength(3);expect(result.manifest.conflicts).toEqual([]);
  expect(result.manifest.totalBytes).toBe((await Promise.all([f.videoPath,`episodes/${f.episode}/voice.mp3`,f.boardPath].map(p=>readFile(join(f.assetRoot,p))))).reduce((n,b)=>n+b.length,0));
  await f.restart();const state=await fetch(f.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+f.token}});const read=await state.json();
  expect(read.path).toBe(f.root);expect(read.migration.id).toBe(result.id);expect(read.migration.manifestSha256).toBe(result.manifestSha256);expect(read.migration.manifest).toEqual(result.manifest);
  expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding).toEqual(binding);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);expect(await readdir(target)).toEqual([]);
 }finally{await f.close();await rm(target,{recursive:true});}
},60000);

it.skipIf(!enabled)('bounded scanning rejects excessive directory depth without touching either tree',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-bounds-'));
 try{
  await mkdir(join(f.assetRoot,f.episodeRelativePath,...Array(130).fill('nested')),{recursive:true});
  const response=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})});expect(response.status).toBe(409);expect((await response.json()).error).toContain('128');expect(await readdir(target)).toEqual([]);
 }finally{await f.close();await rm(target,{recursive:true});}
},60000);

it.skipIf(!enabled)('durable creation, deletion and partial-copy records are inventoried as blockers while completed history stays inactive',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-pending-'));
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,binding=(await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding,root=await lstat(f.assetRoot,{bigint:true}),container=randomUUID(),episode=randomUUID(),migration=randomUUID();
  // Controlled durable-state injection at the real DB boundary; no operation is
  // declared executed. Completion transitions below only test history filtering.
  await f.c.query('INSERT INTO local_identity.account_creation_intents(owner_id,idempotency_key,payload_hash,account_id,path,root_binding,marker) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.owner,randomUUID(),'a'.repeat(64),randomUUID(),join(f.root,'reserved-account'),binding,randomUUID()]);
  await f.c.query("INSERT INTO local_identity.container_creation_intents(owner_id,idempotency_key,payload_hash,container_id,account_id,kind,directory_relative_path,account_root,account_device_id,account_inode_id,root_binding,marker) VALUES($1,$2,$3,$4,$5,'series','pending-container',$6,$7,$8,$9,$10)",[f.owner,randomUUID(),'a'.repeat(64),container,account,f.assetRoot,String(root.dev),String(root.ino),binding,randomUUID()]);
  await f.c.query("INSERT INTO local_identity.episode_creation_intents(owner_id,idempotency_key,payload_hash,payload,episode_id,account_id,blueprint_version_id,container_id,directory_relative_path,account_root,account_device_id,account_inode_id,container_relative_path,container_device_id,container_inode_id,root_binding,marker) VALUES($1,$2,$3,'{}',$4,$5,$5,$6,'pending-container/pending-episode',$7,$8,$9,'pending-container',$8,$9,$10,$11)",[f.owner,randomUUID(),'a'.repeat(64),episode,account,container,f.assetRoot,String(root.dev),String(root.ino),binding,randomUUID()]);
  await f.c.query("INSERT INTO local_identity.episode_deletion_intents(owner_id,idempotency_key,payload_hash,episode_id,manifest,state) VALUES($1,$2,$3,$4,$5,'prepared')",[f.owner,randomUUID(),'b'.repeat(64),f.episode,{accountId:account}]);
  const partialRoot=join(f.root,'pending-copy');await mkdir(partialRoot);const partial=join(partialRoot,'copy.migration-'+migration);await writeFile(partial,'12345');const stat=await lstat(partial,{bigint:true});
  await f.c.query("INSERT INTO local_identity.account_directory_migrations(id,account_id,status,manifest) VALUES($1,$2,'copying',$3)",[migration,account,{kind:'adoption',targetRoot:partialRoot,temporaryFiles:[{path:partial,device:String(stat.dev),inode:String(stat.ino)}]}]);
  const plan=async()=>{const r=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);return body;};
  const blocked=await plan();expect(blocked.manifest.blockers.map((r:{kind:string})=>r.kind)).toEqual(expect.arrayContaining(['account_creation','container_creation','episode_creation','episode_deletion','account_migration']));expect(blocked.manifest.incompleteCopies).toEqual([{migrationId:migration,path:partial,bytes:5,verified:true}]);expect(blocked.manifest.canExecute).toBe(false);expect(await readFile(partial,'utf8')).toBe('12345');
  for(const table of ['account_creation_intents','container_creation_intents','episode_creation_intents'])await f.c.query(`UPDATE local_identity.${table} SET result='{}' WHERE result IS NULL`);await f.c.query("UPDATE local_identity.episode_deletion_intents SET state='completed'");await f.c.query("UPDATE local_identity.account_directory_migrations SET status='completed' WHERE id=$1",[migration]);
  expect((await plan()).manifest.blockers).toEqual([]);expect(await readFile(partial,'utf8')).toBe('12345');
 }finally{await f.close();await rm(target,{recursive:true});}
},60000);

it.skipIf(!enabled)('a historical frozen native identity without a complete bridge is a plan conflict and its original snapshot stays unchanged',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-proof-'));
 try{
  const task=randomUUID(),snapshot={native_output_namespace:task,native_episode_relative_path:f.episodeRelativePath,native_episode_directory_identity:{deviceId:'1',inodeId:'1'}};
  // Historical completed rows are preserved by namespace_native_task_output;
  // this models a retained old coordinate whose whole-root receipt has no child bridge.
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed',$3)",[task,f.episode,snapshot]);
  const frozen=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[task])).rows[0].input_snapshot;expect(frozen).toMatchObject(snapshot);
  const r=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),plan=await r.json();expect(r.status,JSON.stringify(plan)).toBe(200);expect(plan.manifest.conflicts.join()).toContain('冻结生产单目录缺少完整身份迁移证明');expect(plan.manifest.canExecute).toBe(false);expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[task])).rows[0].input_snapshot).toEqual(frozen);
 }finally{await f.close();await rm(target,{recursive:true});}
},60000);

it.skipIf(!enabled)('concurrent Owner retries preserve one plan and report target contents plus actual task blockers',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-target-'));
 try{
  await writeFile(join(target,'keep.txt'),'Keep these 16B!!');
  await f.c.query("UPDATE public.tasks SET status='ready' WHERE id=$1",[f.task]);
  const key=randomUUID(),call=async(path:string,token=f.token)=>{const response=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command:'planMigration',path,idempotencyKey:key})});return{status:response.status,body:await response.json()};};
  const results=await Promise.all([call(target),call(target)]);expect(results.map(r=>r.status)).toEqual([200,200]);expect(results[0].body).toEqual(results[1].body);
  const plan=results[0].body;expect(plan.manifest.target.existingFileCount).toBe(1);expect(plan.manifest.target.existingBytes).toBe(16);expect(plan.manifest.conflicts.join()).toContain('已有内容');expect(plan.manifest.blockers.map((r:{reason:string})=>r.reason).join()).toContain('待执行');expect(plan.manifest.canExecute).toBe(false);
  expect((await call(f.root)).status).toBe(409);expect((await call(target,f.otherToken)).status).toBe(403);expect(await readFile(join(target,'keep.txt'),'utf8')).toBe('Keep these 16B!!');
 }finally{await f.close();await rm(target,{recursive:true});}
},60000);
