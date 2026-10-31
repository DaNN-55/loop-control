// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,lstat,writeFile,unlink,rename,readdir,mkdir} from 'node:fs/promises';
import {join,relative,dirname} from 'node:path';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
const migrations=['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql'];
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['resume','rollback'] as const)('global copy SIGKILL retains same-plan recovery identities and permits %s from a fresh process',async action=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,source,target}=fixture;
 try{
  let runtime=await fixture.launch();const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const old=await readFile(join(f.assetRoot,f.videoPath)),plan=await call('planMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  await fixture.stop();runtime=await fixture.launch('adoption-copy-write');const killed=runtime.pid;await expect(call('executeMigration',{migrationId:plan.body.id})).rejects.toThrow();
  const state=(await f.c.query('SELECT status,progress,manifest,manifest_sha256 FROM local_identity.media_root_migrations WHERE id=$1',[plan.body.id])).rows[0];expect(state.status).toBe('copying');expect(state.manifest).toEqual(plan.body.manifest);expect(state.manifest_sha256).toBe(plan.body.manifestSha256);expect(state.progress.temporaryFiles).toHaveLength(1);const temp=state.progress.temporaryFiles[0];expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(killed);const result=await call(action==='resume'?'executeMigration':'rollbackMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe(action==='resume'?'completed':'rolled_back');expect((await call()).body.path).toBe(action==='resume'?target:source);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(old);if(action==='rollback')expect((await lstat(temp.path)).ino.toString()).toBe(temp.inode);
 }finally{await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a source replaced by FIFO at the actual copy open is refused promptly and preserves the original bytes',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,target,configFile,runtimeRoot}=fixture;
 let request:Promise<any>|undefined;
 try{
  const config=JSON.parse(await readFile(configFile,'utf8')),path=join(f.assetRoot,f.videoPath),saved=join(runtimeRoot,'before-fifo.mp4'),marker=join(runtimeRoot,'fifo-injected.json'),before=await readFile(path);await writeFile(configFile,JSON.stringify({...config,copyFaultFile:path,copyFaultSaved:saved,copyFaultMarker:marker,copyFaultTargetDirectory:join(target,relative(fixture.source,dirname(path)))}),{mode:0o600});
  const runtime=await fixture.launch('root-copy-fifo');const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})});return{status:r.status,body:await r.json()};};
  const plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);request=call('executeMigration',{migrationId:plan.body.id});let injected=false;for(let i=0;i<100;i++){try{await readFile(marker);injected=true;break;}catch{}await new Promise(r=>setTimeout(r,20));}expect(injected).toBe(true);
  const result=await Promise.race([request,new Promise<null>(r=>setTimeout(()=>r(null),1500))]);expect(result,'FIFO copy open must not block the native process').not.toBeNull();expect(result.status).toBe(409);expect((await lstat(path)).isFIFO()).toBe(true);expect(await readFile(saved)).toEqual(before);
 }finally{await fixture.crash();await request?.catch(()=>{});const config=JSON.parse(await readFile(configFile,'utf8'));if(config.copyFaultFile&&await lstat(config.copyFaultFile).then(s=>s.isFIFO()).catch(()=>false)){await unlink(config.copyFaultFile);await rename(config.copyFaultSaved,config.copyFaultFile);}await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('disconnected Owner sees durable in-file byte progress and conflicting writes stay blocked until the same plan completes',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,target,runtimeRoot}=fixture;
 let pending:Promise<any>|undefined;
 try{
  await writeFile(join(f.assetRoot,f.episodeRelativePath,'large.bin'),Buffer.alloc(4*1024*1024,17));const runtime=await fixture.launch('root-progress-pause');
  const headers={Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  const call=async(command?:string,data:Record<string,unknown>={},signal?:AbortSignal)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers,...(signal?{signal}:{}),...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);const controller=new AbortController();pending=call('executeMigration',{migrationId:plan.body.id},controller.signal).catch(e=>({disconnected:true,error:e.message}));
  let marker:any;for(let i=0;i<200;i++){try{marker=JSON.parse(await readFile(join(runtimeRoot,'progress-paused.json'),'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,20));}expect(marker?.pid).toBe(runtime.pid);controller.abort();await pending;pending=undefined;
  const state=(await call()).body;expect(state.path).toBe(fixture.source);expect(state.migration.status).toBe('copying');for(const command of ['executeMigration','rollbackMigration']){const concurrent=await call(command,{migrationId:plan.body.id});expect(concurrent.status,JSON.stringify(concurrent.body)).toBe(409);expect(concurrent.body.error).toContain('进度');}expect(state.executing).toBe(true);expect(state.migration.progress.activeFileBytes).toBeGreaterThan(0);expect(state.migration.progress.activeFileBytes).toBeLessThanOrEqual(marker.actualBytes);
  const post=async(route:string,command:string,data:Record<string,unknown>)=>fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers,body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  for(const [route,command,data] of [['configuration','createAccount',{name:'Blocked',slug:'blocked-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}}],['configuration','createSeries',{accountId:account,name:'Blocked series',rules:{}}],['episode-commands','create',{accountId:account,title:'Blocked'}],['episode-commands','importMaterial',{episodeId:f.episode}],['episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:true}],['account-commands','planLegacyStorageAdoption',{accountId:account}]] as const)expect((await post(route,command,data)).status).toBe(409);
  await expect(f.c.query("UPDATE public.tasks SET status='ready' WHERE id=$1",[f.task])).rejects.toThrow('媒体根迁移');
  await writeFile(join(runtimeRoot,'progress-resume'),'resume');let final:any;for(let i=0;i<300;i++){final=(await call()).body;if(final.migration.status==='completed')break;await new Promise(r=>setTimeout(r,20));}expect(final.migration.status).toBe('completed');expect(final.path).toBe(target);expect(final.migration.progress.copiedBytes).toBe(plan.body.manifest.totalBytes);
 }finally{await writeFile(join(runtimeRoot,'progress-resume'),'resume').catch(()=>{});await pending?.catch(()=>{});await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a previously admitted filesystem writer drains before the migration fence and its changed account scope prevents cutover',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,target,runtimeRoot}=fixture;let creation:Promise<any>|undefined,execution:Promise<any>|undefined;
 try{
  const runtime=await fixture.launch('account-before-mkdir'),headers={Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers,body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})});return{status:r.status,body:await r.json()};};
  const plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);
  creation=fetch(runtime.origin+'/api/local/configuration',{method:'POST',headers,body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'pending-first',slug:'admitted-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}}})}).then(async r=>({status:r.status,body:await r.json()}));
  let marker:any;for(let i=0;i<200;i++){try{marker=JSON.parse(await readFile(join(runtimeRoot,'account-reserved.json'),'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,20));}expect(marker?.pid).toBe(runtime.pid);
  let responded=false;execution=call('executeMigration',{migrationId:plan.body.id}).then(result=>{responded=true;return result;});await new Promise(r=>setTimeout(r,150));expect(responded).toBe(false);expect((await f.c.query('SELECT status FROM local_identity.media_root_migrations WHERE id=$1',[plan.body.id])).rows[0].status).toBe('planned');
  const second=await fetch(runtime.origin+'/api/local/episode-lifecycle',{method:'POST',headers,body:JSON.stringify({command:'archiveEpisode',idempotencyKey:randomUUID(),data:{episodeId:f.episode,archived:true}})});expect(second.status).toBe(409);
  await writeFile(join(runtimeRoot,'account-resume'),'resume');const created=await creation;creation=undefined;expect(created.status,JSON.stringify(created.body)).toBe(200);const refused=await execution;execution=undefined;expect(refused.status,JSON.stringify(refused.body)).toBe(409);expect(refused.body.error).toContain('范围已变化');expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding.path).toBe(fixture.source);expect((await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[created.body.id])).rows[0].actual_root.startsWith(fixture.source+'/')).toBe(true);expect(await readdir(target)).toEqual([]);
 }finally{await writeFile(join(runtimeRoot,'account-resume'),'resume').catch(()=>{});await creation?.catch(()=>{});await execution?.catch(()=>{});await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('an older executing plan stays visible over newer planned history and a failed fence prevents competing plans after restart',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,target,runtimeRoot}=fixture;let execution:Promise<any>|undefined;
 try{
  const second=join(fixture.volume.mountPath,'second-planned'),third=join(fixture.volume.mountPath,'third-proposed');await mkdir(second);await mkdir(third);let runtime=await fixture.launch('adoption-pause-copy-write');
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const first=await call('planMigration',{path:target}),newer=await call('planMigration',{path:second});expect(first.status).toBe(200);expect(newer.status).toBe(200);expect(newer.body.id).not.toBe(first.body.id);
  await f.c.query("CREATE FUNCTION public.fail_t16_priority() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' THEN RAISE EXCEPTION '切换登记未完成。';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_t16_priority BEFORE UPDATE OF status ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION public.fail_t16_priority()");
  execution=call('executeMigration',{migrationId:first.body.id});let marker:any;for(let i=0;i<200;i++){try{marker=JSON.parse(await readFile(join(runtimeRoot,'adoption-copy-paused.json'),'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,20));}expect(marker?.pid).toBe(runtime.pid);
  expect((await call()).body.migration).toMatchObject({id:first.body.id,status:'copying'});
  await writeFile(join(runtimeRoot,'adoption-copy-resume'),'resume');const failed=await execution;execution=undefined;expect(failed.status).toBe(409);await fixture.stop();runtime=await fixture.launch();expect((await call()).body.migration).toMatchObject({id:first.body.id,status:'failed'});
  const competitor=await call('planMigration',{path:third});expect(competitor.status,JSON.stringify(competitor.body)).toBe(409);expect((await call()).body.migration.id).toBe(first.body.id);
  const rolled=await call('rollbackMigration',{migrationId:first.body.id});expect(rolled.status).toBe(200);const next=await call('planMigration',{path:third});expect(next.status,JSON.stringify(next.body)).toBe(200);
 }finally{await writeFile(join(runtimeRoot,'adoption-copy-resume'),'resume').catch(()=>{});await execution?.catch(()=>{});await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a failed empty-workspace global plan prevents ordinary initialization from bypassing its durable fence',async()=>{
 const fixture=await nativeMediaRootFixture({newInstall:true,migrations}),{f,source,target,configFile}=fixture;
 try{
  const third=join(fixture.volume.mountPath,'third-empty-root');await mkdir(third);const runtime=await fixture.launch(),before=await readFile(configFile,'utf8'),binding=(await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  expect((await f.c.query('SELECT count(*) FROM public.accounts')).rows[0].count).toBe('0');const planned=await call('planMigration',{path:target});expect(planned.status).toBe(200);expect(planned.body.manifest.canExecute).toBe(true);
  await f.c.query("CREATE FUNCTION public.fail_t16_empty() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' THEN RAISE EXCEPTION '切换登记未完成。';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_t16_empty BEFORE UPDATE OF status ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION public.fail_t16_empty()");
  const failed=await call('executeMigration',{migrationId:planned.body.id});expect(failed.status).toBe(409);expect((await call()).body.migration.status).toBe('failed');
  const refused=await call('initialize',{path:third});expect(refused.status,JSON.stringify(refused.body)).toBe(409);expect((await call()).body.canInitialize).toBe(false);expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding).toEqual(binding);expect(await readFile(configFile,'utf8')).toBe(before);expect((await call()).body.path).toBe(source);
  expect((await call('rollbackMigration',{migrationId:planned.body.id})).status).toBe(200);expect((await call()).body.canInitialize).toBe(true);const initialized=await call('initialize',{path:third});expect(initialized.status,JSON.stringify(initialized.body)).toBe(200);expect(initialized.body.path).toBe(third);
 }finally{await fixture.close();}
},180000);
