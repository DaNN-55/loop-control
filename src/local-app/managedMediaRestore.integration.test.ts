// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createServer} from 'node:http';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';
import {mediaRootDatabaseTransport} from './mediaRootRuntime.fixture';
import {createLocalHandler} from './localRoute';
import {hashPassword} from './password';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a genuine new workspace backup restores its original media through Owner HTTP without manufacturing import evidence',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');
 await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await embeddedStudioFixture({importRecord:false,databaseName:source,testRootParent:join(storage,'state'),migrations:['db/local/120-native-workspace-storage-locations.sql']});
 let pool:Pool|undefined,server:ReturnType<typeof createServer>|undefined,transport:Awaited<ReturnType<typeof mediaRootDatabaseTransport>>|undefined;
 try{
  expect(context.sql('SELECT count(*) FROM local_identity.import_record')).toBe('0');
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href);
  const jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:f.root};
  const backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);
  expect(backup.passed).toBe(true);
  const mediaRoot=join(storage,'state','t24-restored','media'),receipt=await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  expect(receipt.passed).toBe(true);expect(receipt.mediaReferences).toBe(2);
  expect(context.sql('SELECT count(*) FROM local_identity.import_record',target)).toBe('0');
  transport=await mediaRootDatabaseTransport({database:target});pool=new Pool({...transport.database,user:'loop_app'});
  const password='restored-'+randomUUID(),digest=await hashPassword(password);context.sql(`INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES('${f.owner}','${JSON.stringify(digest)}'::jsonb)`,target);
  let handler:ReturnType<typeof createLocalHandler>;server=createServer((q,r)=>handler(q,r));await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,origin,mediaRoot});
  const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});expect(login.status,await login.clone().text()).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const file=f.files[0],response=await fetch(origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:cookie}});expect(response.status,await response.clone().text()).toBe(200);
  expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(file.sha256);
  expect(await readFile(join(mediaRoot,'account',file.relativePath))).toEqual(await readFile(join(f.assetRoot,file.relativePath)));
  const next=await createNativeBackup({database:target,mediaRoot,projectRoot:process.cwd(),backupRoot:join(storage,'backups',target),jobId:randomUUID()},undefined,{...runtime,database:target,mediaRoot});expect(next.passed).toBe(true);
 }finally{
  if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}await pool?.end();await transport?.close();
  if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');
  await f.close();await rm(storage,{recursive:true,force:true});
 }
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('restored registered episode and empty series containers use target identities and completed creation replays with the source offline',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state'),episodeRelativePath:id=>`系列 空格_100%#?/生产单_${id}`,migrations:['db/local/120-native-workspace-storage-locations.sql']});
 let pool:Pool|undefined,server:ReturnType<typeof createServer>|undefined,transport:Awaited<ReturnType<typeof mediaRootDatabaseTransport>>|undefined,offline=false;
 const {rename}=await import('node:fs/promises'),{csrfFor}=await import('./sessions');
 try{
  const configuration=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key})});expect(response.status,await response.clone().text()).toBe(200);return response.json();};
  const key=randomUUID(),data={name:'恢复账号 % #?',slug:'restore-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'不改历史'}};
  const seriesKey=randomUUID(),seriesData={accountId:'',name:'空系列 % #?',rules:{tone:'保留'}},account=await configuration('createAccount',data,key);seriesData.accountId=account.id;const series=await configuration('createSeries',seriesData,seriesKey);await configuration('createSeries',{accountId:account.id,name:'第二空系列',rules:{extension:{keep:true}}});
  const unassignedKey=randomUUID(),makeUnassigned=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createUnassignedDirectory',data:{accountId:account.id},idempotencyKey:unassignedKey})});expect(makeUnassigned.status,await makeUnassigned.clone().text()).toBe(200);const unassignedResult=await makeUnassigned.json();
  const histories=context.sql("SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(i ORDER BY idempotency_key) FROM local_identity.account_creation_intents i),'containers',(SELECT jsonb_agg(i ORDER BY idempotency_key) FROM local_identity.container_creation_intents i),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t))");
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href);
  const jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:f.root};
  const backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);
  const mediaRoot=join(storage,'state','t24-restored','media');await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  await rename(f.root,f.root+'.offline');offline=true;
  transport=await mediaRootDatabaseTransport({database:target});pool=new Pool({...transport.database,user:'loop_app'});const password='restored-'+randomUUID(),digest=await hashPassword(password);context.sql(`INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES('${f.owner}','${JSON.stringify(digest)}'::jsonb)`,target);
  let handler:ReturnType<typeof createLocalHandler>;server=createServer((q,r)=>handler(q,r));await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,origin,mediaRoot});
  const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json()).csrfToken;
  const file=f.files[0],response=await fetch(origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:cookie}});expect(response.status,await response.clone().text()).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(file.sha256);
  const post=async(path:string,command:string,body:Record<string,unknown>,idempotencyKey=randomUUID())=>{const r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({command,data:body,idempotencyKey})});expect(r.status,await r.clone().text()).toBe(200);return r.json();};
  expect(await post('/api/local/configuration','createAccount',data,key)).toEqual(account);
  expect(await post('/api/local/configuration','createSeries',seriesData,seriesKey)).toEqual(series);expect(await post('/api/local/account-commands','createUnassignedDirectory',{accountId:account.id},unassignedKey)).toEqual(unassignedResult);
  expect(await post('/api/local/account-commands','readSeriesDirectory',{seriesId:series.series_id})).toMatchObject({status:'ready'});
  expect(await post('/api/local/account-commands','readUnassignedDirectory',{accountId:account.id})).toMatchObject({status:'ready'});
  expect(context.sql("SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(i ORDER BY idempotency_key) FROM local_identity.account_creation_intents i),'containers',(SELECT jsonb_agg(i ORDER BY idempotency_key) FROM local_identity.container_creation_intents i),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t))",target)).toBe(histories);
 }finally{
  if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}await pool?.end();await transport?.close();if(offline)await rename(f.root+'.offline',f.root);
  if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});
 }
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('an unfinished physical creation reserves its source and refuses a complete backup',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  await f.c.query('INSERT INTO local_identity.account_creation_intents(owner_id,idempotency_key,payload_hash,account_id,path,root_binding,marker) SELECT $1,$2,$3,$4,$5,local_identity.media_root_binding(),$6',[f.owner,randomUUID(),'a'.repeat(64),randomUUID(),join(f.root,'pending-account'),randomUUID()]);
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href);
  await expect(createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot:join(storage,'backups',source),jobId:randomUUID()},undefined,{...context,mediaRoot:f.root})).rejects.toThrow(/occupied|unfinished/i);
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a changed source retains explicit incomplete evidence and cannot publish a successful archive',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const {writeFile,access}=await import('node:fs/promises'),{createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source);
  await expect(createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},()=>writeFile(join(f.assetRoot,f.videoPath),'changed after database snapshot'),{...context,mediaRoot:f.root})).rejects.toThrow();
  const receipt=JSON.parse(await readFile(join(backupRoot,jobId+'.pending','incomplete.json'),'utf8'));expect(receipt).toMatchObject({passed:false,state:'incomplete',database:source,jobId,recoverable:true});
  await expect(access(join(backupRoot,jobId))).rejects.toThrow();expect(await readFile(join(f.assetRoot,f.videoPath),'utf8')).toBe('changed after database snapshot');
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a large production file is backed up and restored with bounded resident-memory growth',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const {open,stat}=await import('node:fs/promises'),file=await open(join(f.assetRoot,f.episodeRelativePath,'large-video.bin'),'wx');await file.truncate(256*1024*1024);await file.close();
  const baseline=Math.max(process.resourceUsage().maxRSS*1024,process.memoryUsage().rss),{createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:f.root};
  const backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime),mediaRoot=join(storage,'state','t24-large','media');
  const result=await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  expect(result.passed).toBe(true);expect((await stat(join(mediaRoot,'account',f.episodeRelativePath,'large-video.bin'))).size).toBe(256*1024*1024);
  const growth=process.resourceUsage().maxRSS*1024-baseline;console.info('T11 large-file memory evidence',JSON.stringify({bytes:256*1024*1024,baseline,maxRSS:process.resourceUsage().maxRSS*1024,growth}));expect(growth).toBeLessThan(96*1024*1024);
 }finally{if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['legacy','registered'] as const)('a restored native deployment restarts at the new root and saves, closes, reopens and exports the actual SDK project with the source offline (%s)',async(layout)=>{
 const {workspaceAudioVolume}=await import('./workspaceAudioVolume.fixture'),{productionWorkspaceFixture}=await import('./productionWorkspace.fixture'),{editStudioDocument}=await import('./studioDocument.fixture'),{spawn}=await import('node:child_process'),{writeFile,rename}=await import('node:fs/promises');
 const volume=await workspaceAudioVolume(),storage=join(volume.mountPath,'t11-storage');await mkdir(join(storage,'state'),{recursive:true});
 const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex'),{runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await productionWorkspaceFixture({databaseName:source,testRootParent:join(storage,'state'),episodeRelativePath:layout==='registered'?id=>`系列 原生_100%#?/生产单_${id}`:undefined,migrations:['db/local/120-native-workspace-storage-locations.sql'],runtime:{mountPath:volume.mountPath}});
 let transport:Awaited<ReturnType<typeof mediaRootDatabaseTransport>>|undefined,child:ReturnType<typeof spawn>|undefined,offline=false;
 const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await done;}child=undefined;};
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(name:string,extra={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  const opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T11 恢复前实际 SQLite 编辑';});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});await send('closeWorkspaceStudio');
  const {csrfFor}=await import('./sessions'),sourceAccount=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const seriesResponse=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createSeries',data:{accountId:sourceAccount,name:'原生恢复空系列',rules:{}},idempotencyKey:randomUUID()})});expect(seriesResponse.status).toBe(200);const sourceSeries=await seriesResponse.json();
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtimeRoot=join(storage,'runtime'),cacheDirectory=join(storage,'models'),mediaRoot=join(storage,'state','t24-native','media');
  for(const p of [runtimeRoot,cacheDirectory,join(runtimeRoot,'state')])await mkdir(p,{mode:0o700,recursive:true});await writeFile(join(cacheDirectory,'retained.txt'),'platform model cache remains independent');
  transport=await mediaRootDatabaseTransport({database:target});
  const settings={storageOwnerId:f.owner,runtimeRoot,projectRoot:process.cwd(),home:process.env.HOME,stateDirectory:join(runtimeRoot,'state'),mediaRoot:f.root,backupRoot,automaticBackups:false,controlledNotifications:true,database:{...transport.database,user:'loop_app'},workerDatabase:transport.database,openChatCut:{root:process.env.LOOP_TEST_OPENCHATCUT_ROOT,node:process.execPath,port:0},worker:{studio:true,delivery:true,media:{mode:'local'},mountPath:volume.mountPath,minimumFreeBytes:0,visualCommand:['/usr/bin/true'],alignment:{python:'/usr/bin/true',cacheDirectory,runnerSha256:createHash('sha256').update(await readFile(join(process.cwd(),'scripts/whisperx-align.py'))).digest('hex')},concurrency:1,actualCostCents:0}},deploymentFile=join(runtimeRoot,'deployment.json');await writeFile(deploymentFile,JSON.stringify(settings),{mode:0o600});
  const runtime={...context,mediaRoot:f.root,deployment:settings},backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);
  await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256,deployment:{...settings,deploymentFile}},runtime);
  await rename(f.root,f.root+'.offline');offline=true;
  const password='restored-'+randomUUID(),digest=await hashPassword(password);context.sql(`INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES('${f.owner}','${JSON.stringify(digest)}'::jsonb)`,target);
  const script=`import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {createNativeApplication} from ${JSON.stringify(join(process.cwd(),'scripts/runtime/application.mjs'))};const d=JSON.parse(await readFile(process.argv[1],'utf8'));d.deploymentFile=process.argv[1];let app;const server=createServer((q,r)=>app.handler(q,r));await new Promise(r=>server.listen(0,'127.0.0.1',r));d.port=server.address().port;app=await createNativeApplication(d);console.log(JSON.stringify({origin:'http://127.0.0.1:'+d.port}));process.on('SIGTERM',async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.close();process.exit(0);});`;
  const launch=async()=>{child=spawn(process.execPath,['--input-type=module','-e',script,deploymentFile],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});return new Promise<string>((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('Restored application timeout: '+errors)),30000);child!.stdout!.on('data',b=>{output+=String(b);const line=output.split('\n').find(s=>s.startsWith('{"origin"'));if(line){clearTimeout(timer);resolve(JSON.parse(line).origin);}});child!.stderr!.on('data',b=>errors+=String(b));child!.once('exit',code=>{clearTimeout(timer);reject(Error('Restored application '+code+': '+errors));});});};
  let origin=await launch();
  const readSettings=JSON.parse(await readFile(deploymentFile,'utf8'));expect(readSettings).toMatchObject({mediaRoot,automaticBackups:false,database:{database:target},workerDatabase:{database:target},worker:{mountPath:volume.mountPath,alignment:{cacheDirectory,cacheBinding:{path:cacheDirectory}}}});
  const login=async()=>{const r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});expect(r.status,await r.clone().text()).toBe(200);return{cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};};let auth=await login();
  const restoredSend=async(name:string,extra={})=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:auth.cookie,'X-CSRF-Token':auth.csrf},body:JSON.stringify({command:name,idempotencyKey:randomUUID(),data:{episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,...extra}})});expect(r.status,await r.clone().text()).toBe(200);const body=await r.json();w=body.productionWorkspace??body;return body;};
  const reopened=await restoredSend('openWorkspaceStudio');await editStudioDocument(reopened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T11 恢复前实际 SQLite 编辑');doc.timelines[0].name='T11 异地恢复后继续原生编辑';});await restoredSend('saveWorkspaceStudio',{workspaceRelativePath:reopened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:reopened.workspace.sha256});await restoredSend('closeWorkspaceStudio');await stop();origin=await launch();auth=await login();
  const again=await restoredSend('openWorkspaceStudio');await editStudioDocument(again.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T11 异地恢复后继续原生编辑');});if(process.env.LOOP_T11_BROWSER_OUTPUT){const {observeRestoredNativeBrowser}=await import('./nativeRestoreBrowser.fixture');await observeRestoredNativeBrowser({origin,email:f.email,password,episode:f.episode,output:join(process.env.LOOP_T11_BROWSER_OUTPUT,layout),cacheDirectory:join(runtimeRoot,'browser-vite-cache')});}await restoredSend('closeWorkspaceStudio');
  await restoredSend('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');const artifact=w.exports[0].artifact,response=await fetch(origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:auth.cookie}});expect(response.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(artifact.sha256);
  if(process.env.LOOP_T11_OPEN_FOLDERS_OUTPUT){const {verifyRestoredFolderOpen}=await import('./restoredFolderOpen.fixture');await verifyRestoredFolderOpen({origin,cookie:auth.cookie,csrf:auth.csrf,accountId:sourceAccount,seriesId:sourceSeries.series_id,episodeId:f.episode,ownedRoot:volume.mountPath,output:join(process.env.LOOP_T11_OPEN_FOLDERS_OUTPUT,layout)});}
  expect(context.sql("SELECT count(*) FROM local_identity.automation_jobs WHERE kind='backup'",target)).toBe('0');expect(await readFile(join(cacheDirectory,'retained.txt'),'utf8')).toBe('platform model cache remains independent');
 }finally{await stop();await transport?.close();if(offline)await rename(f.root+'.offline',f.root);if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await volume.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a missing immutable workspace document prevents a complete backup even when ordinary artifact rows are intact',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),{productionWorkspaceFixture}=await import('./productionWorkspace.fixture'),context=nativeStorageContext(runtimeContext(),storage,source,target),f=await productionWorkspaceFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);await rm(join(f.assetRoot,prepared.body.project.relativePath));
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href);
  await expect(createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot:join(storage,'backups',source),jobId:randomUUID()},undefined,{...context,mediaRoot:f.root})).rejects.toThrow(/reference|missing/i);
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a rejected deployment publication retains the restored database pending and an explicit failed receipt',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const {writeFile}=await import('node:fs/promises'),{createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:f.root};
  const backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime),mediaRoot=join(storage,'state','t24-failed','media'),runtimeRoot=join(storage,'runtime');await mkdir(runtimeRoot,{mode:0o700});
  const deployment={deploymentFile:join(runtimeRoot,'deployment.json'),runtimeRoot,mediaRoot:f.root,storageOwnerId:f.owner,database:{database:target},workerDatabase:{database:source},automaticBackups:false};await writeFile(deployment.deploymentFile,JSON.stringify(deployment),{mode:0o600});
  await expect(restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256,deployment},runtime)).rejects.toThrow(/deployment/i);
  expect(context.sql("SELECT current_setting('loop.restore_state')",target)).toBe('pending');expect(JSON.parse(await readFile(join(mediaRoot,'..','restore-incomplete.json'),'utf8'))).toMatchObject({passed:false,state:'incomplete',recoverable:true});
  expect(JSON.parse(await readFile(join(mediaRoot,'..','restore-receipt.json'),'utf8')).passed).toBe(false);
 }finally{if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('registered platform cache and independent history inside a legacy media parent retain their own responsibilities',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const {writeFile,access}=await import('node:fs/promises'),cacheDirectory=join(f.root,'existing-model-cache'),historyRoot=join(f.root,'independent-history');for(const path of [cacheDirectory,historyRoot]){await mkdir(path);await writeFile(join(path,'retained.txt'),'separate platform data');}
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:f.root,deployment:{automaticBackups:false,worker:{alignment:{cacheDirectory}},historyRoot}};
  const backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime),manifest=JSON.parse(await readFile(join(backupRoot,jobId,'manifest.json'),'utf8'));expect(manifest.excludedPlatformRoots.sort()).toEqual([cacheDirectory,historyRoot].sort());expect(manifest.media.some((f:{path:string})=>f.path.includes('retained.txt'))).toBe(false);expect(manifest.storageConfiguration.automaticBackups).toBe(false);
  const mediaRoot=join(storage,'state','t24-platform','media');await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  await expect(access(join(mediaRoot,'existing-model-cache'))).rejects.toThrow();await expect(access(join(mediaRoot,'independent-history'))).rejects.toThrow();for(const path of [cacheDirectory,historyRoot])expect(await readFile(join(path,'retained.txt'),'utf8')).toBe('separate platform data');
 }finally{if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('the pinned legacy schema can be backed up before storage migrations and restored forward without touching its source',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t11-storage-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex'),media=join(storage,'state','legacy','media'),account=randomUUID(),episode=randomUUID(),owner=randomUUID(),task=randomUUID();await mkdir(join(media,'account','episodes',episode),{recursive:true});
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),base=runtimeContext(),context=nativeStorageContext(base,storage,source,target),{copyFixtureSchema}=await import('./fixtureSchema'),{lstat,writeFile}=await import('node:fs/promises');context.sql('CREATE DATABASE '+source+' TEMPLATE template0','postgres');
 try{
  await copyFixtureSchema(base,source,[]);const identity=await lstat(join(media,'account'),{bigint:true}),path=`episodes/${episode}/legacy.txt`,bytes=Buffer.from('pre-110 original production bytes'),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(join(media,'account',path),bytes);
  context.sql(`INSERT INTO local_identity.owners(id,email) VALUES('${owner}','legacy@example.invalid');INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','legacy-${account}','Legacy','Asia/Shanghai');INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES('${account}','${join(media,'account')}','${identity.dev}','${identity.ino}');INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);UPDATE public.accounts SET current_blueprint_version_id='${account}' WHERE id='${account}';INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Legacy','waiting_input');INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES('${task}','${episode}','generate_review_render','completed','{}');INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES('${episode}','${task}','script','${path}','${sha}',${bytes.length});`);
  expect(context.sql("SELECT to_regclass('local_identity.media_root_binding') IS NULL")).toBe('t');const ledger=context.sql('SELECT count(*) FROM local_identity.schema_migrations');
  const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),jobId=randomUUID(),backupRoot=join(storage,'backups',source),runtime={...context,mediaRoot:media};
  const backup=await createNativeBackup({database:source,mediaRoot:media,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime),mediaRoot=join(storage,'state','t24-legacy-forward','media'),receipt=await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  expect(receipt.passed).toBe(true);expect(receipt.mediaReferences).toBe(1);expect(context.sql('SELECT count(*) FROM local_identity.schema_migrations')).toBe(ledger);expect(context.sql("SELECT to_regclass('local_identity.media_root_binding') IS NULL")).toBe('t');expect(context.sql('SELECT local_identity.media_root_binding()',target)).toContain(mediaRoot);expect(await readFile(join(mediaRoot,'account',path))).toEqual(bytes);
 }finally{if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');context.sql('DROP DATABASE '+source+' WITH (FORCE)','postgres');await rm(storage,{recursive:true,force:true});}
},300000);
