// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir,lstat,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['empty-directory','unknown-content'] as const)('a crash before the directory receipt commits preserves %s and permits guarded manual continuation',async scenario=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']}),{f,target,source,configFile}=fixture;let pending:Promise<unknown>|undefined;
 try{
  const config=JSON.parse(await readFile(configFile,'utf8'));config.projectRoot=process.env.LOOP_TEST_RUNTIME_ROOT??process.cwd();await writeFile(configFile,JSON.stringify(config),{mode:0o600});
  let runtime=await fixture.launch();
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const original=await readFile(join(f.assetRoot,f.videoPath)),plan=await call('planMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.manifest.canExecute).toBe(true);
  // Stop the real progress transaction before its first directory receipt is durable.
  // mkdir has completed; killing the native process rolls this transaction back.
  await f.c.query("CREATE FUNCTION public.pause_directory_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF jsonb_array_length(coalesce(NEW.progress->'createdDirectories','[]'::jsonb))>jsonb_array_length(coalesce(OLD.progress->'createdDirectories','[]'::jsonb)) THEN PERFORM pg_advisory_xact_lock(17819435);END IF;RETURN NEW;END $$;CREATE TRIGGER pause_directory_receipt BEFORE UPDATE ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION public.pause_directory_receipt()");await f.c.query('SELECT pg_advisory_lock(17819435)');
  pending=call('executeMigration',{migrationId:plan.body.id}).catch(error=>({disconnected:true,message:error.message}));
  await vi.waitFor(async()=>expect(Number((await f.c.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND objid=17819435 AND NOT granted")).rows[0].n)).toBe(1),{timeout:15000,interval:25});
  const children=await readdir(target);expect(children).toHaveLength(1);const orphan=join(target,children[0]),identity=await lstat(orphan,{bigint:true});expect(identity.isDirectory()).toBe(true);expect(await readdir(orphan)).toEqual([]);
  const beforeCrash=(await call()).body;expect(beforeCrash).toMatchObject({path:source,migration:{id:plan.body.id,status:'copying',progress:{createdDirectories:[],copiedFiles:0,copiedBytes:0}}});
  const firstPid=runtime.pid;await fixture.crash();await pending;pending=undefined;await f.c.query('SELECT pg_advisory_unlock(17819435)');await f.c.query('DROP TRIGGER pause_directory_receipt ON local_identity.media_root_migrations;DROP FUNCTION public.pause_directory_receipt()');
  const sentinel=join(orphan,'manual.txt');if(scenario==='unknown-content')await writeFile(sentinel,'Unknown content must remain untouched');
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(firstPid);const restarted=(await call()).body;expect(restarted).toMatchObject({path:source,executing:false,migration:{id:plan.body.id,status:'copying',progress:{createdDirectories:[]}}});
  const refused=await call('executeMigration',{migrationId:plan.body.id});expect(refused.status,JSON.stringify(refused.body)).toBe(409);expect(refused.body.error).toContain('未登记目标目录');
  const failed=(await call()).body;expect(failed).toMatchObject({path:source,migration:{status:'failed',progress:{createdDirectories:[]}}});expect((await lstat(orphan,{bigint:true})).ino).toBe(identity.ino);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  const rolled=await call('rollbackMigration',{migrationId:plan.body.id});expect(rolled.status,JSON.stringify(rolled.body)).toBe(200);expect(rolled.body.status).toBe('rolled_back');expect((await lstat(orphan,{bigint:true})).ino).toBe(identity.ino);
  if(scenario==='unknown-content')expect(await readFile(sentinel,'utf8')).toBe('Unknown content must remain untouched');else expect(await readdir(orphan)).toEqual([]);
  // Owner can retain the uncertain target and explicitly select a clean target.
  const clean=join(fixture.volume.mountPath,'clean-target');await mkdir(clean);const replanned=await call('planMigration',{path:clean});expect(replanned.status,JSON.stringify(replanned.body)).toBe(200);expect(replanned.body.id).not.toBe(plan.body.id);expect(replanned.body.manifest.canExecute).toBe(true);
  const completed=await call('executeMigration',{migrationId:replanned.body.id});expect(completed.status,JSON.stringify(completed.body)).toBe(200);expect(completed.body.status).toBe('completed');expect((await call()).body.path).toBe(clean);expect((await lstat(orphan,{bigint:true})).ino).toBe(identity.ino);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  const artifact=await fetch(runtime.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(f.videoPath)+'&sha256='+f.files[0].sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(artifact.status).toBe(200);expect(Buffer.from(await artifact.arrayBuffer())).toEqual(original);
  if(scenario==='unknown-content')expect(await readFile(sentinel,'utf8')).toBe('Unknown content must remain untouched');else expect(await readdir(orphan)).toEqual([]);
  if(process.env.LOOP_DIRECTORY_RECEIPT_EVIDENCE)await writeFile(join(process.env.LOOP_DIRECTORY_RECEIPT_EVIDENCE,'directory-receipt-'+scenario+'.json'),JSON.stringify({scenario,firstPid,restartedPid:runtime.pid,planId:plan.body.id,orphan,identity:{device:String(identity.dev),inode:String(identity.ino)},beforeCrash,restarted,refused,failed,rollbackStatus:rolled.body.status,nextPlanId:replanned.body.id,completedStatus:completed.body.status,orphanUnchanged:true,originalBytesUnchanged:true,ownerReadsMigratedArtifact:true},null,2));
 }finally{await fixture.crash();await pending?.catch(()=>{});await f.c.query('SELECT pg_advisory_unlock(17819435)').catch(()=>{});await fixture.close();}
},180000);
