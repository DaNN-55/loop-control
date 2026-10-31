// @vitest-environment node
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createLocalHandler} from './localRoute';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner sees the adopted existing media root after native restart and cannot relocate its files through ordinary initialization',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');const fixture=await nativeMediaRootFixture({existingData:true}),{f,configFile,source}=fixture;
 try{
 const originalConfig=await readFile(configFile,'utf8');let runtime=await fixture.launch();
 const headers=()=>({Origin:runtime.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)});
 const read=await fetch(runtime.origin+'/api/local/media-root',{headers:headers()});expect(read.status).toBe(200);expect(await read.json()).toMatchObject({path:source,canInitialize:false,status:'ready'});
 const change=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:headers(),body:JSON.stringify({command:'initialize',path:fixture.target,idempotencyKey:randomUUID()})});expect(change.status).toBe(409);expect((await change.json()).error).toContain('迁移');
 expect((await fetch(runtime.origin+'/api/local/media-root')).status).toBe(401);
 const foreign=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{...headers(),Cookie:'loop_owner_session='+f.otherToken,'X-CSRF-Token':csrfFor(f.otherToken)},body:JSON.stringify({command:'initialize',path:fixture.target,idempotencyKey:randomUUID()})});expect(foreign.status).toBe(403);
 await fixture.stop();runtime=await fixture.launch();const state=await fetch(runtime.origin+'/api/local/media-root',{headers:headers()});expect(await state.json()).toMatchObject({path:source,status:'ready',canInitialize:false});
 const file=f.files[0],artifact=await fetch(runtime.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:headers()});expect(artifact.status).toBe(200);expect(Buffer.from(await artifact.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,file.relativePath)));expect(await readFile(configFile,'utf8')).toBe(originalConfig);
 }finally{await fixture.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('empty workspace initialization persists authorization, reloads the actual service and Worker, and survives a fresh native process',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');
 const {mkdir,writeFile,rm,readFile,rename,symlink}=await import('node:fs/promises');const {join}=await import('node:path');
 const fixture=await nativeMediaRootFixture(),{f,volume,source,target,configFile,launch,stop}=fixture;
 try{
  let runtime=await launch();const firstPid=runtime.pid;
  const call=async(command?:string,path?:string,csrf=true)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Origin:runtime.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(f.token)}:{})},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...(path?{path}:{})})}:{})});return{status:r.status,body:await r.json()};};
  expect((await call()).body).toMatchObject({path:source,canInitialize:true,status:'ready'});
  expect((await call('initialize',target,false)).status).toBe(403);
  expect((await call('initialize',join(source,'nested'))).status).toBe(409);
  const foreign=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Origin:runtime.origin,Cookie:'loop_owner_session='+f.otherToken,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.otherToken)},body:JSON.stringify({command:'initialize',path:target,idempotencyKey:randomUUID()})});expect(foreign.status).toBe(403);
  const sourceAliasSibling=join(f.root,'sibling-target');await mkdir(sourceAliasSibling);expect((await call('initialize',sourceAliasSibling)).status).toBe(400);await rm(sourceAliasSibling,{recursive:true});
  const alias=join(volume.mountPath,'alias');await symlink(target,alias);expect((await call('initialize',alias)).status).toBe(400);
  const result=await call('initialize',target);expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.path).toBe(target);
  const stored=JSON.parse(await readFile(configFile,'utf8'));expect(stored.mediaRoot).toBe(target);expect(stored.worker.mountPath).toBe(volume.mountPath);expect(stored.automaticBackups).toBe(false);expect(stored.worker.alignment.cacheDirectory).toBe(join(source,'whisperx-models'));expect(stored.worker.alignment.cacheBinding.path).toBe(join(source,'whisperx-models'));expect(await readFile(join(source,'whisperx-models/retained.txt'),'utf8')).toBe('Retained platform cache fixture');
  const {assertAlignmentConfigured}=await import('./alignmentWorker');await expect(assertAlignmentConfigured(process.cwd(),target,stored.worker.alignment)).resolves.toBe(join(process.cwd(),'scripts/whisperx-align.py'));
  const cache=stored.worker.alignment.cacheDirectory;await rename(cache,cache+'-original');await mkdir(cache,{mode:0o700});await expect(assertAlignmentConfigured(process.cwd(),target,stored.worker.alignment)).rejects.toThrow('身份');await rm(cache,{recursive:true});await rename(cache+'-original',cache);
  expect((await call('open')).body).toMatchObject({opened:true,path:target});
  await stop();runtime=await launch();expect(runtime.pid).not.toBe(firstPid);expect((await call()).body).toMatchObject({path:target,status:'ready'});
  // Native production writes and reads use the committed root after process restart.
  const headers={Origin:runtime.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  const accountRoot=join(target,'account');await mkdir(accountRoot);
  // Existing account creation requires an Owner membership; bootstrap this isolated fixture only.
  const seed=randomUUID();await f.c.query('INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,$3,$4)',[seed,'seed-'+seed,'隔离种子','Asia/Shanghai']);await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[seed,f.owner]);
  const created=await fetch(runtime.origin+'/api/local/configuration',{method:'POST',headers,body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'重启根验证',slug:'root-'+randomUUID(),timezone:'Asia/Shanghai',policy:{},assetRoot:accountRoot}})});const account=await created.json();expect(created.status,JSON.stringify(account)).toBe(200);
  expect((await call()).body.canInitialize).toBe(false);
  const episodeId=randomUUID();await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$3,'根初始化后的实际文件','waiting_input')",[episodeId,account.id,account.current_blueprint_version_id]);await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[episodeId,f.owner]);await mkdir(join(accountRoot,'episodes',episodeId),{recursive:true});
  const imported=await fetch(runtime.origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command:'importMaterial',idempotencyKey:randomUUID(),data:{episodeId,sourceKind:'file',sourcePath:'reference.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('进程重启后的真实媒体文件').toString('base64')}})});const file=await imported.json();expect(imported.status,JSON.stringify(file)).toBe(200);expect(await readFile(join(accountRoot,file.storage_path),'utf8')).toBe('进程重启后的真实媒体文件');
  const fetched=await fetch(runtime.origin+`/_local-artifact?episode=${episodeId}&path=${encodeURIComponent(file.storage_path)}&sha256=${file.sha256}`,{headers});expect(fetched.status).toBe(200);expect(await fetched.text()).toBe('进程重启后的真实媒体文件');

  const status=await fetch(runtime.origin+'/api/local/system-status',{headers});expect(status.status).toBe(200);const statusBody=await status.json();expect(statusBody.runtime.worker.state,JSON.stringify(statusBody.runtime.worker)).toBe('healthy');expect(statusBody.runtime.resources.media.state).toBe('healthy');
  if(process.env.LOOP_ACCEPTANCE_OUTPUT)await writeFile(join(process.env.LOOP_ACCEPTANCE_OUTPUT,'native-result.json'),JSON.stringify({firstPid,restartedPid:runtime.pid,root:target,binding:stored.mediaRootBinding,worker:statusBody.runtime.worker,media:statusBody.runtime.resources.media,filePath:join(accountRoot,file.storage_path),bytesVerified:true,nativeFolderOpened:true,foreignOwnerStatus:foreign.status},null,2));
  await rename(target,target+'-offline');const missing=await call();expect(missing.body.status).toBe('unavailable');await mkdir(target);expect((await call()).body.status).toBe('unavailable');expect((await call('open')).status).toBe(409);await rm(target,{recursive:true});await rename(target+'-offline',target);expect((await call()).body.status).toBe('ready');
 }finally{await fixture.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('interrupted initialization reconciles private config with committed database metadata on the next real process start',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');const {inspectMediaRoot}=await import('./mediaRootSettings');
 const {readFile,access}=await import('node:fs/promises');const {join}=await import('node:path');const runtimeModule=join(process.cwd(),'scripts/runtime/media-root.mjs');const {persistMediaRootDeployment}=await import(runtimeModule);
 const fixture=await nativeMediaRootFixture(),{f,source,target,configFile,launch,stop}=fixture;
 try{
  let runtime=await launch();await stop();
  const previous=JSON.parse(await readFile(configFile,'utf8')),binding=await inspectMediaRoot(target);
  // Controlled crash point: private files saved, DB transaction has not committed.
  await persistMediaRootDeployment({...previous,deploymentFile:configFile},binding);
  runtime=await launch();expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(source);
  const headers={Origin:runtime.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  const recovered=await fetch(runtime.origin+'/api/local/media-root',{headers});expect(await recovered.json()).toMatchObject({path:source,status:'ready'});await stop();
  // Controlled crash point: DB and private files committed, activation receipt not finalized.
  await persistMediaRootDeployment({...previous,deploymentFile:configFile},binding);
  await f.c.query('BEGIN');
  // Admin fixture writes only the exact isolated deployment table, representing a committed app transaction.
  await f.c.query('UPDATE local_identity.media_root_binding SET path=$1,device_id=$2,inode_id=$3,mount_path=$4',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath]);await f.c.query('COMMIT');
  runtime=await launch();const r=await fetch(runtime.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+f.token}});expect(await r.json()).toMatchObject({path:target,status:'ready'});
  await expect(access(join(fixture.runtimeRoot,'media-root-pending.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await fixture.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner initialization refuses overlapping, nonempty and low-space targets and recovers a controlled runtime reload failure',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');const {LocalMediaRootSettings}=await import('./mediaRootSettings');const {join}=await import('node:path');const {readFile,writeFile,unlink}=await import('node:fs/promises');const modulePath=join(process.cwd(),'scripts/runtime/media-root.mjs'),{persistMediaRootDeployment}=await import(modulePath);
 const fixture=await nativeMediaRootFixture(),{f,source,target,configFile}=fixture;let server:ReturnType<typeof createServer>|undefined;
 try{
  await fixture.launch();await fixture.stop();const settings=JSON.parse(await readFile(configFile,'utf8'));let minimumFreeBytes=0;
  const runtime={protectedRoots:[fixture.runtimeRoot],retainedRoots:[settings.worker.alignment.cacheDirectory],get minimumFreeBytes(){return minimumFreeBytes;},persist:(binding:import('./mediaRootSettings').MediaRootBinding)=>persistMediaRootDeployment({...settings,deploymentFile:configFile},binding),activate:async()=>{throw Error('Controlled runtime activation failure');}};
  const service=new LocalMediaRootSettings(f.pool,source,runtime);let handler:ReturnType<typeof createLocalHandler>;server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool:f.pool,origin,mediaRoot:source,mediaRootSettings:service});
  const call=async(path:string)=>{const r=await fetch(origin+'/api/local/media-root',{method:'POST',headers:{Origin:origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'initialize',path,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
  expect((await call(fixture.runtimeRoot)).status).toBe(400);
  const unknown=join(target,'keep-unknown.txt');await writeFile(unknown,'Unknown user file');expect((await call(target)).status).toBe(409);expect(await readFile(unknown,'utf8')).toBe('Unknown user file');await unlink(unknown);
  const sourceUnknown=join(source,'unknown-source.txt');await writeFile(sourceUnknown,'Keep unknown source');expect((await call(target)).status).toBe(409);expect(await readFile(sourceUnknown,'utf8')).toBe('Keep unknown source');await unlink(sourceUnknown);
  minimumFreeBytes=Number.MAX_SAFE_INTEGER;const space=await call(target);expect(space.status).toBe(409);expect(space.body.error).toContain('空间');minimumFreeBytes=0;
  const failed=await call(target);expect(failed.status,JSON.stringify(failed.body)).toBe(503);expect(failed.body.error).toContain('恢复原配置');expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(source);
  const restarted=await fixture.launch();const read=await fetch(restarted.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+f.token}});expect(await read.json()).toMatchObject({path:source,status:'ready'});
 }finally{server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));await fixture.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('an empty separately mounted volume can itself be the media root without adding a folder name',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');const {workspaceAudioVolume}=await import('./workspaceAudioVolume.fixture');const fixture=await nativeMediaRootFixture(),target=await workspaceAudioVolume();
 try{const runtime=await fixture.launch(),headers={Origin:runtime.origin,Cookie:'loop_owner_session='+fixture.f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(fixture.f.token)};
 const initialized=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers,body:JSON.stringify({command:'initialize',path:target.mountPath,idempotencyKey:randomUUID()})});expect(initialized.status,JSON.stringify(await initialized.clone().json())).toBe(200);expect((await initialized.json()).path).toBe(target.mountPath);
 const status=await fetch(runtime.origin+'/api/local/system-status',{headers});expect(status.status).toBe(200);expect((await status.json()).runtime.resources.media.state).toBe('healthy');
 }finally{await fixture.close();await target.close();}
},300000);
