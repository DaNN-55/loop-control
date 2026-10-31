// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {lstat,readdir,writeFile,readFile} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('fresh native process resumes one reserved episode with the original blueprint and series after SIGKILL and rule edits',async()=>{
 const fixture=await nativeMediaRootFixture({newInstall:true}),{f}=fixture;
 try{
 let runtime=await fixture.launch();const initialPid=runtime.pid;
 const post=async(route:string,command:string,data:Record<string,unknown>,key=randomUUID())=>{const r=await fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key,...(command==='updateBlueprint'?{expectedRevision:(await f.c.query('SELECT md5(b.policy::text) revision FROM public.accounts a JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1',[data.accountId])).rows[0].revision}:{})})});return{status:r.status,body:await r.json()};};
 const account=(await post('configuration','createAccount',{name:'自动账号✨',slug:'episode-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'原账号规则'}})).body;
 const series=(await post('configuration','createSeries',{accountId:account.id,name:'系列 原名%#?',rules:{positioning:'原系列规则',extension:{keep:true}}})).body;
 const original=(await f.c.query('SELECT b.id,b.policy FROM public.account_blueprint_versions b JOIN public.accounts a ON a.current_blueprint_version_id=b.id WHERE a.id=$1',[account.id])).rows[0];
 await f.c.query("CREATE FUNCTION public.test_episode_crash() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.title='crash creation' THEN PERFORM pg_advisory_xact_lock(178190);END IF;RETURN NEW;END $$;CREATE TRIGGER test_episode_crash BEFORE INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.test_episode_crash()");await f.c.query('SELECT pg_advisory_lock(178190)');
 const key=randomUUID(),data={accountId:account.id,title:'crash creation',seriesVersionId:series.id},pending=post('episode-commands','create',data,key).catch(()=>null);let intent:any;
 for(let i=0;i<150;i++){intent=(await f.c.query('SELECT * FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rows[0];if(intent?.device_id&&(await f.c.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=178190 AND NOT granted")).rowCount)break;await new Promise(r=>setTimeout(r,20));}expect(intent?.device_id).toBeTruthy();
 const path=join(intent.account_root,intent.directory_relative_path);await writeFile(join(path,'manual.txt'),'unknown bytes survive SIGKILL');await fixture.crash();await pending;await f.c.query('SELECT pg_advisory_unlock(178190)');await f.c.query('DROP TRIGGER test_episode_crash ON public.episodes;DROP FUNCTION public.test_episode_crash()');
 expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE account_id=$1',[account.id])).rows[0].n).toBe(0);
 runtime=await fixture.launch();expect(runtime.pid).not.toBe(initialPid);
 const changed=await post('configuration','updateBlueprint',{accountId:account.id,policy:{positioning:'中断后的新规则'}});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.id).not.toBe(original.id);
 expect((await post('configuration','createSeriesVersion',{seriesId:series.series_id,rules:{positioning:'新系列规则'}})).status).toBe(200);
 expect((await post('configuration','renameSeries',{seriesId:series.series_id,name:'系列已改名'})).status).toBe(200);
 expect((await post('configuration','renameAccount',{accountId:account.id,name:'账号已改名'})).status).toBe(200);
 const retried=await post('episode-commands','create',data,key);expect(retried.status,JSON.stringify(retried.body)).toBe(200);expect(retried.body).toMatchObject({id:intent.episode_id,blueprint_version_id:original.id,series_version_id:series.id});
 expect((await f.c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=$1',[original.id])).rows[0].policy).toEqual(original.policy);expect((await f.c.query('SELECT rules FROM public.series_versions WHERE id=$1',[series.id])).rows[0].rules).toEqual(series.rules);expect((await lstat(path)).ino.toString()).toBe(intent.inode_id);expect(await readFile(join(path,'manual.txt'),'utf8')).toBe('unknown bytes survive SIGKILL');expect(await readdir(path)).toEqual(['manual.txt']);
 const originalPath=path,originalInode=(await lstat(path)).ino;expect((await post('episode-lifecycle','renameEpisode',{episodeId:intent.episode_id,title:'本期标题改名'})).status).toBe(200);expect((await lstat(originalPath)).ino).toBe(originalInode);
 const names=['','CON.txt','A/B\\C:*?<>|','é','e\u0301','长名字'.repeat(66),'同名','同名'];const same=randomUUID();const requests=await Promise.all(names.map(title=>post('episode-commands','create',{accountId:account.id,title},title==='é'?same:randomUUID())));
 for(const r of requests){expect(r.status,JSON.stringify(r.body)).toBe(200);const l=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[r.body.id])).rows[0];expect(l.layout_version).toBe(2);expect(l.storage_series_id).toBeNull();expect(basename(l.directory_relative_path)).toContain(r.body.id);expect(Buffer.byteLength(basename(l.directory_relative_path))).toBeLessThanOrEqual(138);}
 const concurrentKey=randomUUID(),input={accountId:account.id,title:'same key'};const concurrent=await Promise.all([post('episode-commands','create',input,concurrentKey),post('episode-commands','create',input,concurrentKey)]);expect(concurrent[0].status).toBe(200);expect(concurrent[1]).toEqual(concurrent[0]);
 if(process.env.LOOP_ACCEPTANCE_OUTPUT)await writeFile(join(process.env.LOOP_ACCEPTANCE_OUTPUT,'native-create.json'),JSON.stringify({initialPid,restartedPid:runtime.pid,intent,created:retried.body,path,originalBlueprint:original,originalSeries:series,specialNames:names.length,concurrent:concurrent[0]},null,2));
 }finally{await f.c.query('SELECT pg_advisory_unlock_all()');await fixture.close();}
},240000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('native crashes after mkdir and after COMMIT plus actual unmount/remount preserve one intent and physical directory',async()=>{
 const fixture=await nativeMediaRootFixture({newInstall:true}),{f}=fixture,exec=promisify(execFile);let detached=false;
 const image=join(dirname(fixture.volume.mountPath),'media.sparseimage');
 try{
 let runtime=await fixture.launch();const post=async(route:string,command:string,data:Record<string,unknown>,key:string=randomUUID())=>{const r=await fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 const account=(await post('configuration','createAccount',{name:'Crash phases',slug:'phases-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}})).body,series=(await post('configuration','createSeries',{accountId:account.id,name:'phases',rules:{}})).body;
 for(const phase of ['episode-after-mkdir','episode-after-commit'] as const){
  await fixture.stop();runtime=await fixture.launch(phase);const pid=runtime.pid,key=randomUUID(),data={accountId:account.id,title:phase==='episode-after-mkdir'?'crash-after-mkdir':'crash-after-commit',seriesVersionId:series.id};await expect(post('episode-commands','create',data,key)).rejects.toThrow();
  const intent=(await f.c.query('SELECT * FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rows[0],path=join(intent.account_root,intent.directory_relative_path);expect(intent?.episode_id).toBeTruthy();expect((await lstat(path)).isDirectory()).toBe(true);expect(Boolean(intent.result)).toBe(phase==='episode-after-commit');
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(pid);const resumed=await post('episode-commands','create',data,key);expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);expect(resumed.body.id).toBe(intent.episode_id);expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[intent.episode_id])).rows[0].n).toBe(1);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rows[0].n).toBe(1);
 }
 await f.c.query("CREATE FUNCTION public.test_mount_creation_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.title='mount recovery' THEN RAISE EXCEPTION 'controlled precommit mount reserve';END IF;RETURN NEW;END $$;CREATE TRIGGER test_mount_creation_fail BEFORE INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.test_mount_creation_fail()");const key=randomUUID(),data={accountId:account.id,title:'mount recovery',seriesVersionId:series.id};expect((await post('episode-commands','create',data,key)).status).toBe(409);const intent=(await f.c.query('SELECT * FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rows[0];await f.c.query('DROP TRIGGER test_mount_creation_fail ON public.episodes;DROP FUNCTION public.test_mount_creation_fail()');
 await exec('hdiutil',['detach',fixture.volume.mountPath],{timeout:30000});detached=true;expect((await post('episode-commands','create',data,key)).status).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[intent.episode_id])).rows[0].n).toBe(0);
 await exec('hdiutil',['attach','-nobrowse','-noautoopen','-mountpoint',fixture.volume.mountPath,image],{timeout:60000});detached=false;const restored=await post('episode-commands','create',data,key);expect(restored.status,JSON.stringify(restored.body)).toBe(200);expect(restored.body.id).toBe(intent.episode_id);
 if(process.env.LOOP_ACCEPTANCE_OUTPUT)await writeFile(join(process.env.LOOP_ACCEPTANCE_OUTPUT,'native-crash-mount.json'),JSON.stringify({actualUnmountRemount:true,episodeId:intent.episode_id,path:join(intent.account_root,intent.directory_relative_path),phases:['after-mkdir','after-commit']},null,2));
 }finally{if(detached)await exec('hdiutil',['attach','-nobrowse','-noautoopen','-mountpoint',fixture.volume.mountPath,image],{timeout:60000});await fixture.close();}
},240000);
