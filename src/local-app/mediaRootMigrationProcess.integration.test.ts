// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,access,mkdir,readdir,mkdtemp,realpath,rm,open,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
it.skipIf(!enabled)('retained platform state inside a mounted media root never rebuilds its host tree after detach',async()=>{
 const evidence=process.env.LOOP_T15_EVIDENCE;if(!evidence)throw Error('Explicit LOOP_T15_EVIDENCE is required');
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']});
 const exec=promisify(execFile);await mkdir(evidence,{recursive:true});
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));config.mountTraceArmed=join(evidence,'mounted-state-armed');config.mountTraceOutput=join(evidence,'mounted-state-mkdir.jsonl');await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});
  const runtime=await fixture.launch('mount-write-trace'),before=await lstat(fixture.source,{bigint:true}),media=await readFile(join(fixture.f.assetRoot,fixture.f.videoPath));
  const status=async()=>{const r=await fetch(runtime.origin+'/api/local/system-status',{headers:{Cookie:'loop_owner_session='+fixture.f.token}});return{status:r.status,body:await r.json()};};const statusBefore=await status();expect(statusBefore.status).toBe(200);const bindingBefore=(await fixture.f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
  await writeFile(join(evidence,'mount-before.plist'),(await exec('hdiutil',['info','-plist'])).stdout);await writeFile(config.mountTraceArmed,'armed');
  await fixture.volume.unmount();await delay(4500);await writeFile(join(evidence,'mount-detached.plist'),(await exec('hdiutil',['info','-plist'])).stdout);
  let after:{exists:boolean;deviceId?:string;inodeId?:string;children?:string[]}={exists:false};try{const stat=await lstat(fixture.source,{bigint:true});after={exists:true,deviceId:String(stat.dev),inodeId:String(stat.ino),children:await readdir(fixture.source)};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const statusAfter=await status();expect(statusAfter.status).toBe(409);process.kill(runtime.pid,0);const proof={pid:runtime.pid,mountPath:fixture.volume.mountPath,source:fixture.source,before:{deviceId:String(before.dev),inodeId:String(before.ino)},after,statusBefore,statusAfter};await writeFile(join(evidence,'mounted-state-result.json'),JSON.stringify(proof,null,2));
  await fixture.volume.remount();expect(await readFile(join(fixture.f.assetRoot,fixture.f.videoPath))).toEqual(media);const remounted=await lstat(fixture.source,{bigint:true}),bindingAfter=(await fixture.f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding,read=await fetch(runtime.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+fixture.f.token}}),state=await read.json();
  await writeFile(join(evidence,'mounted-state-result.json'),JSON.stringify({...proof,bindingBefore,remounted:{deviceId:String(remounted.dev),inodeId:String(remounted.ino),binding:bindingAfter,state,mediaBytesUnchanged:true}},null,2));expect(bindingAfter).toEqual(bindingBefore);expect(String(remounted.dev)).toBe(String(before.dev));expect(String(remounted.ino)).toBe(String(before.ino));expect(state).toMatchObject({path:fixture.source,status:'ready'});expect(after.exists,JSON.stringify(proof)).toBe(false);
 }finally{await fixture.volume.remount();await fixture.close();}
},90000);
it.skipIf(!enabled)('a real detached source volume rejects planning without recreating the missing media tree',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']}),holder=await realpath(await mkdtemp('/private/tmp/loop-root-detached-')),target=join(holder,'chosen-root');
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));config.runtimeRoot=join(holder,'runtime');config.stateDirectory=join(config.runtimeRoot,'state');config.backupRoot=join(config.runtimeRoot,'backups');await mkdir(config.stateDirectory,{recursive:true,mode:0o700});await mkdir(target);await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});
  const runtime=await fixture.launch(),before=await readFile(join(fixture.f.assetRoot,fixture.f.videoPath)),binding=(await fixture.f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
  await fixture.volume.unmount();await expect(access(fixture.source)).rejects.toMatchObject({code:'ENOENT'});
  const response=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})});expect(response.status,JSON.stringify(await response.json())).toBe(409);await expect(access(fixture.source)).rejects.toMatchObject({code:'ENOENT'});expect(await readdir(target)).toEqual([]);expect((await fixture.f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding).toEqual(binding);
  await fixture.volume.remount();expect(await readFile(join(fixture.f.assetRoot,fixture.f.videoPath))).toEqual(before);
 }finally{await fixture.volume.remount();await fixture.close();await rm(holder,{recursive:true});}
},90000);
it.skipIf(!enabled)('a special filesystem entry fails promptly instead of blocking inventory or acquiring its ownership',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']});
 try{
  const fifo=join(fixture.f.assetRoot,fixture.f.episodeRelativePath,'keep.pipe');await promisify(execFile)('/usr/bin/mkfifo',[fifo]);const runtime=await fixture.launch();
  const request=fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:fixture.target,idempotencyKey:randomUUID()})}).then(async r=>({status:r.status,body:await r.json()})).catch(()=>({status:0,body:{}}));
  const result=await Promise.race([request,delay(1500).then(()=>null)]);if(!result){await fixture.crash();await request;}
  expect(result,'inventory blocked on a FIFO; the owned child was killed for cleanup').not.toBeNull();expect(result!.status,JSON.stringify(result!.body)).toBe(409);expect((await lstat(fifo)).isFIFO()).toBe(true);
 }finally{await fixture.close();}
},60000);
it.skipIf(!enabled).each(['insert','rewrite'])('owned source %s at the final binding boundary invalidates a plan without any database change',async mode=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']});
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));config.planFaultTarget=fixture.target;config.planFaultFile=join(fixture.f.assetRoot,mode==='insert'?fixture.f.episodeRelativePath+'/late-source.txt':fixture.f.videoPath);await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});
  const runtime=await fixture.launch('plan-source-change');const frozen=(await fixture.f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows;
  const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:fixture.target,idempotencyKey:randomUUID()})}),plan=await r.json();
  expect(r.status,JSON.stringify(plan)).toBe(200);expect(await readFile(config.planFaultFile,'utf8')).toBe('Changed source bytes');expect(plan.manifest.conflicts.join()).toContain('盘点期间生产文件或目录改变');expect(plan.manifest.canExecute).toBe(false);expect((await fixture.f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows).toEqual(frozen);
 }finally{await fixture.close();}
},60000);
it.skipIf(!enabled)('a real first-account reservation before mkdir blocks empty initialization and resumes the original request',async()=>{
 const fixture=await nativeMediaRootFixture({newInstall:true,migrations:['db/local/125-global-media-root-plans.sql']}),{f,source,target,configFile,runtimeRoot}=fixture;
 let create:Promise<{status:number;body:any}>|undefined;
 try{
  const runtime=await fixture.launch('account-before-mkdir'),before=await readFile(configFile,'utf8');
  const headers={Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  create=fetch(runtime.origin+'/api/local/configuration',{method:'POST',headers,body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'pending-first',slug:'pending-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}}})}).then(async r=>({status:r.status,body:await r.json()}));
  for(let i=0;i<300;i++){try{await access(join(runtimeRoot,'account-reserved.json'));break;}catch{}await delay(20);}
  const paused=JSON.parse(await readFile(join(runtimeRoot,'account-reserved.json'),'utf8'));expect(paused.pid).toBe(runtime.pid);
  expect((await f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.account_creation_intents WHERE result IS NULL')).rows[0].n).toBe(1);
  const initialize=fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers,body:JSON.stringify({command:'initialize',path:target,idempotencyKey:randomUUID()})}).then(async r=>({status:r.status,body:await r.json()}));
  const refused=await Promise.race([initialize,delay(1500).then(()=>null)]);
  const binding=(await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
  await writeFile(join(runtimeRoot,'account-resume'),'resume');await initialize;
  expect(refused,JSON.stringify(binding)).not.toBeNull();expect(refused!.status).toBe(409);expect(binding.path).toBe(source);expect(await readFile(configFile,'utf8')).toBe(before);
  const created=await create;expect(created.status,JSON.stringify(created.body)).toBe(200);
 }finally{await writeFile(join(runtimeRoot,'account-resume'),'resume').catch(()=>{});await create?.catch(()=>{});await fixture.close();}
},60000);

it.skipIf(!enabled)('a target file inserted after the initial inventory is preserved and invalidates the saved plan',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']});
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));config.planFaultTarget=fixture.target;await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});const runtime=await fixture.launch('plan-target-change');
  const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:fixture.target,idempotencyKey:randomUUID()})}),plan=await r.json();
  expect(r.status,JSON.stringify(plan)).toBe(200);expect(await readFile(join(fixture.target,'late-target.txt'),'utf8')).toBe('Unknown target bytes');expect(plan.manifest.conflicts.join()).toContain('目标内容在盘点期间变化');expect(plan.manifest.canExecute).toBe(false);
 }finally{await fixture.close();}
},60000);

it.skipIf(!enabled)('large media hashing uses streams while an actual capacity boundary produces a readable reserve-space conflict',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']});
 try{
  const large=await open(join(fixture.f.assetRoot,fixture.f.episodeRelativePath,'large.mp4'),'wx');await large.truncate(32*1024*1024);await large.close();
  let runtime=await fixture.launch('plan-stream-only');
  const plan=async()=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:fixture.target,idempotencyKey:randomUUID()})}),body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);return body;};
  const streamed=await plan();expect(streamed.manifest.files.find((f:{relativePath:string})=>f.relativePath==='large.mp4')).toMatchObject({fileSize:33554432,sha256:'83ee47245398adee79bd9c0a8bc57b821e92aba10f5f9ade8a5d1fae4d8c4302'});expect(streamed.manifest.conflicts).toEqual([]);
  await fixture.stop();runtime=await fixture.launch('adoption-space');const blocked=await plan();expect(blocked.manifest.space.freeBytes).toBe(0);expect(blocked.manifest.conflicts.join()).toContain('空间不足');expect(blocked.manifest.canExecute).toBe(false);
 }finally{await fixture.close();}
},90000);

it.skipIf(!enabled)('native settings persist mixed accounts, empty series, unassigned and legacy scope with retained platform resources across a new process',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']}),{f,target,configFile}=fixture;
 try{
  let runtime=await fixture.launch();
  const post=async(route:string,command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:r.status,body:await r.json()};};
  const created=await post('configuration','createAccount',{name:'全局范围账号',slug:'global-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});expect(created.status,JSON.stringify(created.body)).toBe(200);
  const account=created.body.id,series=await post('configuration','createSeries',{accountId:account,name:'空系列',rules:{positioning:'独立创作规则'}});expect(series.status,JSON.stringify(series.body)).toBe(200);
  const unassigned=await post('episode-commands','create',{accountId:account,title:'未分系列生产单'});expect(unassigned.status,JSON.stringify(unassigned.body)).toBe(200);
  const imported=await post('episode-commands','importMaterial',{episodeId:unassigned.body.id,sourceKind:'file',sourcePath:'root.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('abc').toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  await writeFile(join(f.root,'manual-keep.txt'),'Keep manual root file');
  const before=await readFile(configFile,'utf8'),binding=(await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding,frozen=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows;
  const planResponse=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),plan=await planResponse.json();expect(planResponse.status,JSON.stringify(plan)).toBe(200);
  expect(plan.manifest.accounts).toHaveLength(2);expect(plan.manifest.episodes).toHaveLength(2);expect(plan.manifest.directories.some((d:{kind:string})=>d.kind==='series')).toBe(true);expect(plan.manifest.directories.some((d:{kind:string})=>d.kind==='unassigned')).toBe(true);expect(plan.manifest.files).toHaveLength(4);expect(plan.manifest.conflicts).toEqual([]);expect(plan.manifest.blockers).toEqual([]);
  expect(plan.manifest.retained.some((r:{path:string})=>r.path===join(f.root,'manual-keep.txt'))).toBe(true);expect(plan.manifest.resources.map((r:{kind:string})=>r.kind)).toEqual(expect.arrayContaining(['program','model-cache','history','backup','state','runtime','secrets']));expect(plan.manifest.files.every((r:{sourceRoot:string})=>!r.sourceRoot.includes('whisperx-models'))).toBe(true);
  const firstPid=runtime.pid;await fixture.stop();runtime=await fixture.launch();expect(runtime.pid).not.toBe(firstPid);
  const read=await fetch(runtime.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+f.token}}),state=await read.json();expect(state.path).toBe(f.root);expect(state.migration).toEqual(plan);expect(await readFile(configFile,'utf8')).toBe(before);expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding).toEqual(binding);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows).toEqual(frozen);expect(await readdir(target)).toEqual([]);
  const afterPlan=await post('configuration','createAccount',{name:'计划后的正常账号',slug:'after-plan-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});expect(afterPlan.status,JSON.stringify(afterPlan.body)).toBe(200);expect((await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[afterPlan.body.id])).rows[0].actual_root.startsWith(f.root+'/')).toBe(true);
  if(process.env.LOOP_T15_EVIDENCE){await mkdir(process.env.LOOP_T15_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_T15_EVIDENCE,'mixed-native-plan.json'),JSON.stringify({firstPid,restartedPid:runtime.pid,plan,state,configUnchanged:true,frozenUnchanged:true,targetEmpty:true},null,2));}
 }finally{await fixture.close();}
},120000);

it.skipIf(!enabled)('existing authorized media remains a production carve-out inside an ancestor runtime resource',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-carveout-'));
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));config.runtimeRoot=fixture.volume.mountPath;await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});
  await writeFile(join(fixture.f.root,'manual-retained.txt'),'Keep source manual bytes');
  const runtime=await fixture.launch(),r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+fixture.f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),plan=await r.json();
  expect(r.status,JSON.stringify(plan)).toBe(200);expect(plan.manifest.files).toHaveLength(3);expect(plan.manifest.conflicts).toEqual([]);expect(plan.manifest.retained.some((v:{path:string})=>v.path===join(fixture.f.root,'manual-retained.txt'))).toBe(true);
 }finally{await fixture.close();await rm(target,{recursive:true});}
},60000);
