// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,symlink,open,lstat,link,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {insertHistoricalBlueprint} from './historicalBlueprint.fixture';
import {execFileSync} from 'node:child_process';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner inventories and verifies actual account files before an atomic move; original evidence remains readable after restart',async()=>{
 const f=await embeddedStudioFixture();
 try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 const target=join(f.root,'moved-account');await mkdir(target);
 const call=async(command:string,data:Record<string,unknown>,token=f.token,csrf=true)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const plan=await call('planAssetDirectoryMigration',{accountId:account,path:target});
 expect(plan.status,JSON.stringify(plan.body)).toBe(200);
 expect(plan.body).toMatchObject({status:'planned',targetRoot:target,conflicts:[],episodes:[{id:f.episode}]});
 expect(plan.body.files.map((file:any)=>file.relativePath)).toContain(f.videoPath);
 expect((await call('executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id},f.otherToken)).status).toBe(404);
 expect((await call('executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id},f.token,false)).status).toBe(403);
 const before=await readFile(join(f.assetRoot,f.videoPath));
 const frozenBefore=(await f.c.query('SELECT policy,input_snapshot FROM public.account_blueprint_versions b JOIN public.episodes e ON e.blueprint_version_id=b.id JOIN public.tasks t ON t.episode_id=e.id WHERE e.id=$1',[f.episode])).rows[0];
 const moved=await call('executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);expect(moved.body).toMatchObject({status:'completed',originalsRetained:true});
 expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(before);expect(await readFile(join(target,f.videoPath))).toEqual(before);
 expect((await call('readAssetDirectory',{accountId:account})).body).toMatchObject({assetRoot:target,status:'ready'});
 const frozen=(await f.c.query('SELECT policy,input_snapshot FROM public.account_blueprint_versions b JOIN public.episodes e ON e.blueprint_version_id=b.id JOIN public.tasks t ON t.episode_id=e.id WHERE e.id=$1',[f.episode])).rows[0];expect(frozen).toEqual(frozenBefore);expect(frozen.input_snapshot.review_render.members[0].relative_path).toBe(f.videoPath);
 // Put the original root offline: actual HTTP reads and subsequent writes must use the copy.
 await rename(f.assetRoot,f.assetRoot+'-original-retained');await f.restart();
 const openedDirectory=await f.request('openDirectory');expect(openedDirectory.status,JSON.stringify(openedDirectory.body)).toBe(200);expect(openedDirectory.body.path).toBe(join(target,'episodes',f.episode));
 const file=f.files[0],download=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(before);
 const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'after-move.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('迁移后正式写入').toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);expect(await readFile(join(target,imported.body.storage_path),'utf8')).toBe('迁移后正式写入');
 expect((await call('readAssetDirectoryMigrations',{accountId:account})).body[0]).toMatchObject({id:plan.body.id,status:'completed'});
 const lifecycle=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{episodeId:f.episode,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);const deletion=await lifecycle('planDeletion');expect(deletion.status).toBe(200);const episodePath=join(target,'episodes',f.episode),inputPath=join(episodePath,'input'),inputIdentity=await lstat(inputPath,{bigint:true});expect(deletion.body.paths).toEqual([episodePath]);
 expect(deletion.body.preserved).toEqual([{path:inputPath,reason:'未登记的空目录，保留。'}]);
 const removed=await lifecycle('deleteEpisode',{confirmation:deletion.body.confirmation,expectedPath:deletion.body.path,expectedPaths:deletion.body.paths,expectedRevision:deletion.body.revision});expect(removed.status,JSON.stringify(removed.body)).toBe(200);expect(removed.body.cleanupPending).toBe(false);
 for(const file of deletion.body.files)await expect(lstat(file.path)).rejects.toMatchObject({code:'ENOENT'});
 expect(await readdir(episodePath)).toEqual(['input']);expect(await readdir(inputPath)).toEqual([]);const retainedIdentity=await lstat(inputPath,{bigint:true});expect([retainedIdentity.dev,retainedIdentity.ino]).toEqual([inputIdentity.dev,inputIdentity.ino]);expect(await readFile(join(f.assetRoot+'-original-retained',f.videoPath))).toEqual(before);


 }finally{execFileSync('/usr/bin/osascript',['-e','on run argv\ntell application "Finder"\nrepeat with w in (get windows)\ntry\nif (POSIX path of (target of w as alias)) starts with ((item 1 of argv) & "/") then close w\nend try\nend repeat\nend tell\nend run','--',f.root]);await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('migration mount failure preserves the old root and resumes from its durable receipt after restart; collisions and changed references never cut over',async()=>{
 const f=await embeddedStudioFixture();
 try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,target=join(f.root,'recover-target');await mkdir(target);
 const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId:account,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const nested=join(f.assetRoot,'bad-nested');await mkdir(nested);expect((await call('planAssetDirectoryMigration',{path:nested})).status).toBe(409);
 const tricky=join(f.assetRoot,'..nested-target');await mkdir(tricky);expect((await call('planAssetDirectoryMigration',{path:tricky})).status).toBe(409);
 const alias=join(f.root,'bad-alias');await symlink(target,alias);expect((await call('planAssetDirectoryMigration',{path:alias})).status).toBe(400);
 const plan=await call('planAssetDirectoryMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
 await rename(target,target+'-offline');
 const failed=await call('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(failed.status).not.toBe(200);
 expect((await call('readAssetDirectory',{})).body).toMatchObject({assetRoot:f.assetRoot,status:'ready'});
 expect((await call('readAssetDirectoryMigrations',{})).body[0]).toMatchObject({status:'failed'});
 await f.restart();await rename(target+'-offline',target);
 // A partial file left by a killed copy is receipt-scoped and can be recovered.
 await mkdir(join(target,'episodes',f.episode),{recursive:true});await writeFile(join(target,f.videoPath+'.migration-'+plan.body.id),'interrupted-copy');
 const resumed=await call('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);expect(resumed.body.status).toBe('completed');
 expect(await readFile(join(target,f.videoPath))).toEqual(await readFile(join(f.assetRoot,f.videoPath)));
 const next=join(f.root,'collision-target');await mkdir(next);const p2=await call('planAssetDirectoryMigration',{path:next});expect(p2.status).toBe(200);
 await mkdir(join(next,'episodes',f.episode),{recursive:true});await writeFile(join(next,f.videoPath),'foreign-content');
 expect((await call('executeAssetDirectoryMigration',{migrationId:p2.body.id})).status).toBe(409);expect(await readFile(join(next,f.videoPath),'utf8')).toBe('foreign-content');expect((await call('readAssetDirectory',{})).body.assetRoot).toBe(target);
 expect((await call('rollbackAssetDirectoryMigration',{migrationId:p2.body.id})).body.status).toBe('rolled_back');
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('an actual interrupted streaming copy keeps originals and recovers the durable migration after restart',async()=>{
 const f=await embeddedStudioFixture();
 try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,target=join(f.root,'copy-interruption');await mkdir(target);
 const large=await open(join(f.assetRoot,'00-large-media.bin'),'wx');await large.truncate(32*1024*1024);await large.close();
 const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId:account,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const plan=await call('planAssetDirectoryMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
 const migrating=call('executeAssetDirectoryMigration',{migrationId:plan.body.id});
 const temporary=join(target,'00-large-media.bin.migration-'+plan.body.id);let interrupted=false;
 for(let i=0;i<10000;i++){try{if((await lstat(temporary)).size>0){await expect(f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status) VALUES($1,$2,'generate_review_render','ready')",[randomUUID(),f.episode])).rejects.toThrow('账号目录正在迁移');await rename(target,target+'-disconnected');interrupted=true;break;}}catch{}await new Promise<void>(done=>setTimeout(done,1));}
 expect(interrupted).toBe(true);const failure=await migrating;expect(failure.status).not.toBe(200);expect((await call('readAssetDirectory',{})).body.assetRoot).toBe(f.assetRoot);
 expect((await lstat(join(f.assetRoot,'00-large-media.bin'))).size).toBe(32*1024*1024);
 await f.restart();await rename(target+'-disconnected',target);
 // A process can stop between exclusive publication and removing its own temp link.
 await link(temporary,join(target,'00-large-media.bin'));
 const recovered=await call('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(recovered.body.status).toBe('completed');
 expect((await lstat(join(target,'00-large-media.bin'))).size).toBe(32*1024*1024);
 }finally{await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('migrated native SQLite edits reopen, export, and deliver through the real Worker with originals offline',async()=>{
 const {productionWorkspaceFixture}=await import('./productionWorkspace.fixture');
 const {defaultShotCaptionContract}=await import('../shotCaptions');
 const {nativeWorkerPort}=await import('./workerDatabase');
 const {runWorkspaceDeliveryProcess}=await import('./workspaceDelivery.fixture');
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();let actualRoot=f.assetRoot;
 try{
 // Fixture mutation removes the legacy source to prove that actual I/O uses
 // the independent episode location; no existing production rows are changed.
 await f.c.query("UPDATE public.account_blueprint_versions SET policy=policy-'asset_root'");
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
 for(const clip of w.clips)w=await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:f.material});
 for(const clip of w.clips)w=await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
 const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,target=join(f.root,'native-migration');await mkdir(target);
 const migrate=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId:account,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const busy=await migrate('planAssetDirectoryMigration',{path:target});expect(busy.status,JSON.stringify(busy.body)).toBe(200);expect(busy.body.conflicts.join(' ')).toContain('Studio');expect((await migrate('executeAssetDirectoryMigration',{migrationId:busy.body.id})).status).toBe(409);await migrate('rollbackAssetDirectoryMigration',{migrationId:busy.body.id});

 const sqlite=await readFile(join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.sqlite3`));expect(sqlite.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
 const {editStudioDocument}=await import('./studioDocument.fixture');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T07 SQLite 原生编辑';});
 const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});w=saved.productionWorkspace;
 w=await send('closeWorkspaceStudio');
 const planned=await migrate('planAssetDirectoryMigration',{path:target});expect(planned.status,JSON.stringify(planned.body)).toBe(200);expect(planned.body.conflicts).toEqual([]);
 const moved=await migrate('executeAssetDirectoryMigration',{migrationId:planned.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);actualRoot=target;
 await rename(f.assetRoot,f.assetRoot+'-original-retained');await f.restart();
 const reopened=await send('openWorkspaceStudio');w=reopened.productionWorkspace;const resaved=await send('saveWorkspaceStudio',{workspaceRelativePath:reopened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:reopened.workspace.sha256});w=resaved.productionWorkspace;w=await send('closeWorkspaceStudio');

 const resumed=await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(resumed.workspace.project.sha256).toBe(w.project.sha256);
 const exactProject=JSON.parse(await readFile(join(actualRoot,resumed.workspace.project.relativePath),'utf8'));expect(exactProject.timelines[0].name).toBe('T07 SQLite 原生编辑');
 w=await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
 const exported=w.exports[0];expect((await readFile(join(actualRoot,exported.artifact.relativePath))).length).toBeGreaterThan(100);
 w=await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
 w=await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'独立账号目录交付',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as any;expect(task.allowed_asset_root).toBe(actualRoot);
 const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status,JSON.stringify(result)).toBe('completed');
 for(const artifact of result.artifacts){expect((await readFile(join(actualRoot,artifact.relativePath))).length).toBe(Number(artifact.fileSize));const file=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(file.status,artifact.relativePath).toBe(200);}
 }finally{await worker.end();await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('historical deployment roots and immutable references merge into the actual account folder; task and reference conflicts block cutover',async()=>{
 const f=await embeddedStudioFixture();
 try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,legacy=join(f.root,'legacy-account'),target=join(f.root,'all-history'),blueprint=randomUUID(),episode=randomUUID(),task=randomUUID(),artifact=randomUUID();await mkdir(join(legacy,'episodes',episode),{recursive:true});await mkdir(target);
 const path=`episodes/${episode}/historical.txt`,bytes=Buffer.from('部署前的历史正文与交付证据'),sha=createHash('sha256').update(bytes).digest('hex'),logical='/legacy-source/media/legacy-account';await writeFile(join(legacy,path),bytes);
 await f.c.query("UPDATE local_identity.import_record SET media_source_roots=ARRAY['/legacy-source/media']");
 await insertHistoricalBlueprint(f.c,blueprint,account,2,{asset_root:logical});
 await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$3,'历史生产单','production_completed')",[episode,account,blueprint]);await f.c.query('UPDATE local_identity.episode_asset_locations SET asset_root=$2 WHERE episode_id=$1',[episode,logical]);
 await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed',$3)",[task,episode,{frozen_location:logical}]);await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'render',$4,$5,$6)",[artifact,episode,task,path,sha,bytes.length]);
 const call=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId:account,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const platform=join(f.root,'openchatcut'),platformBlueprint=randomUUID();await mkdir(platform);await writeFile(join(platform,'global-runtime.txt'),'公共运行文件不得迁入账号');await insertHistoricalBlueprint(f.c,platformBlueprint,account,3,{asset_root:platform});
 const platformPlan=await call('planAssetDirectoryMigration',{path:target});expect(platformPlan.status,JSON.stringify(platformPlan.body)).toBe(409);expect(await readFile(join(platform,'global-runtime.txt'),'utf8')).toBe('公共运行文件不得迁入账号');await f.c.query('DELETE FROM public.account_blueprint_versions WHERE id=$1',[platformBlueprint]);
 const blockingTask=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status) VALUES($1,$2,'generate_review_render','ready')",[blockingTask,f.episode]);
 const busy=await call('planAssetDirectoryMigration',{path:target});expect(busy.status,JSON.stringify(busy.body)).toBe(200);expect(busy.body.conflicts.join(' ')).toContain('任务');expect((await call('executeAssetDirectoryMigration',{migrationId:busy.body.id})).status).toBe(409);await call('rollbackAssetDirectoryMigration',{migrationId:busy.body.id});
 await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[blockingTask]);await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES($1,$2,'video',1)",[blockingTask,account]);
 const unknown=await call('planAssetDirectoryMigration',{path:target});expect(unknown.body.conflicts.join(' ')).toContain('供应商');await call('rollbackAssetDirectoryMigration',{migrationId:unknown.body.id});
 await f.c.query("UPDATE public.paid_generation_reservations SET request_state='succeeded' WHERE task_id=$1",[blockingTask]);
 await f.c.query('UPDATE public.artifacts SET sha256=$2 WHERE id=$1',[artifact,'0'.repeat(64)]);
 const invalid=await call('planAssetDirectoryMigration',{path:target});expect(invalid.body.conflicts.join(' ')).toContain('引用校验失败');await call('rollbackAssetDirectoryMigration',{migrationId:invalid.body.id});await f.c.query('UPDATE public.artifacts SET sha256=$2 WHERE id=$1',[artifact,sha]);
 await f.c.query("UPDATE public.tasks SET status='ready',invalidated_at=now(),invalidated_reason='Superseded inactive attempt' WHERE id=$1",[blockingTask]);
 const plan=await call('planAssetDirectoryMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.sources.map((s:any)=>s.path).sort()).toEqual([f.assetRoot,legacy].sort());expect(plan.body.episodes).toHaveLength(2);expect(plan.body.conflicts).toEqual([]);
 const moved=await call('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);expect(await readFile(join(target,path))).toEqual(bytes);expect(await readFile(join(legacy,path))).toEqual(bytes);await expect(lstat(join(target,'global-runtime.txt'))).rejects.toMatchObject({code:'ENOENT'});
 await rename(legacy,legacy+'-original-retained');await f.restart();const download=await fetch(f.origin+`/_local-artifact?episode=${episode}&path=${encodeURIComponent(path)}&sha256=${sha}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
 expect((await f.c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=$1',[blueprint])).rows[0].policy.asset_root).toBe(logical);expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[task])).rows[0].input_snapshot.frozen_location).toBe(logical);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a changed account directory invalidates an earlier empty-account inventory before cutover',async()=>{
 const f=await embeddedStudioFixture();
 try{
 const source=join(f.root,'empty-source'),target=join(f.root,'empty-target'),changed=join(f.root,'changed-source');for(const path of [source,target,changed])await mkdir(path);await writeFile(join(changed,'keep.txt'),'改根后新增的账号原件');
 const call=async(endpoint:string,command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const made=await call('configuration','createAccount',{name:'盘点版本检查',slug:'scope-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});expect(made.status).toBe(200);const accountId=made.body.id;expect((await call('account-commands','setAssetDirectory',{accountId,path:source})).status).toBe(200);
 const planned=await call('account-commands','planAssetDirectoryMigration',{accountId,path:target});expect(planned.status).toBe(200);
 const replaced=await call('account-commands','setAssetDirectory',{accountId,path:changed});expect(replaced.status,JSON.stringify(replaced.body)).toBe(200);
 const stale=await call('account-commands','executeAssetDirectoryMigration',{accountId,migrationId:planned.body.id});expect(stale.status,JSON.stringify(stale.body)).toBe(409);expect((await call('account-commands','readAssetDirectory',{accountId})).body.assetRoot).toBe(changed);expect(await readFile(join(changed,'keep.txt'),'utf8')).toBe('改根后新增的账号原件');
 await call('account-commands','rollbackAssetDirectoryMigration',{accountId,migrationId:planned.body.id});const fresh=await call('account-commands','planAssetDirectoryMigration',{accountId,path:target});expect(fresh.status).toBe(200);expect((await call('account-commands','executeAssetDirectoryMigration',{accountId,migrationId:fresh.body.id})).status).toBe(200);expect(await readFile(join(target,'keep.txt'),'utf8')).toBe('改根后新增的账号原件');expect(await readFile(join(changed,'keep.txt'),'utf8')).toBe('改根后新增的账号原件');
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Pexels managed adoption migrates with native edits, delivers with originals offline, and deletion rolls back then removes only owned copies',async()=>{
 const {workspacePexelsFixture}=await import('./workspacePexels.fixture'),{defaultShotCaptionContract}=await import('../shotCaptions'),{editStudioDocument}=await import('./studioDocument.fixture'),{nativeWorkerPort}=await import('./workerDatabase'),{runWorkspaceDeliveryProcess}=await import('./workspaceDelivery.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture');
 const {readdir,stat}=await import('node:fs/promises');const {workspaceAudioVolume}=await import('./workspaceAudioVolume.fixture');const volume=await workspaceAudioVolume(),f=await workspacePexelsFixture({testRootParent:volume.mountPath,mountPath:volume.mountPath}),worker=f.workerPool();let actualRoot=f.assetRoot;
 try{
 let w=await f.read();const initial=w.project.sha256,account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,sourceMedia=await readFile(workspaceTestMedia('landscape-red-blue.mp4'));
 const post=async(route:string,command:string,data:Record<string,unknown>,token=f.token,csrf=true,key=randomUUID())=>{const r=await fetch(f.origin+route,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,`${command}: ${JSON.stringify(r.body)}`).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
 const read=async()=>w=await f.read(),download=async(ref:any)=>{const r=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(ref.relativePath)}&sha256=${ref.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status,ref.relativePath).toBe(200);const bytes=Buffer.from(await r.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256);return bytes;};
 const selection={capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:f.version},query={targetItemId:w.clips[0].itemId,selection,query:'ocean',orientation:'landscape',size:'medium',page:1},base={workspaceId:w.id,expectedRevision:w.revision};
 expect((await f.request('searchWorkspacePexelsVideos',{...base,...query},{token:f.otherToken})).status).toBe(404);expect((await f.request('searchWorkspacePexelsVideos',{...base,...query},{csrf:false})).status).toBe(403);
 const idempotency=randomUUID(),queued=await post('/api/local/episode-commands','searchWorkspacePexelsVideos',{episodeId:f.episode,...base,...query},f.token,true,idempotency);expect(queued.status,JSON.stringify(queued.body)).toBe(200);expect((await post('/api/local/episode-commands','searchWorkspacePexelsVideos',{episodeId:f.episode,...base,...query},f.token,true,idempotency)).body).toEqual(queued.body);expect((await post('/api/local/episode-commands','searchWorkspacePexelsVideos',{episodeId:f.episode,...base,...query,query:'changed'},f.token,true,idempotency)).status).toBe(409);w=queued.body;
 expect((await f.execute(w.pexels.requests[0].taskId))?.status).toBe('completed');await read();const search=w.pexels.requests[0];expect(w.project.sha256).toBe(initial);expect(w.visualCandidates).toHaveLength(0);
 await send('previewWorkspacePexelsVideo',{searchId:search.id,resultId:22});expect((await f.execute(w.pexels.requests[0].taskId))?.status).toBe('completed');await read();const preview=w.pexels.requests[0];expect(await download(preview.preview)).toEqual(sourceMedia);
 await send('importWorkspacePexelsVideo',{previewId:preview.id});const candidate=w.visualCandidates[0];expect(candidate).toMatchObject({status:'available',source:{id:22,query:'ocean',selection:{connectionVersionId:f.version}}});expect(w.project.sha256).toBe(initial);
 const adoption=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:adoption.adoptionId});expect(w.visualCandidates.find((c:any)=>c.id===candidate.id).status).toBe('adopted');expect(w.project.sha256).not.toBe(initial);w=await f.fillVisuals(w);
 for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
 const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='Pexels 迁移前的原生编辑';});const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});w=saved.productionWorkspace;await send('closeWorkspaceStudio');
 // This whole-account compatibility case contains pre-layout2 history only.
 const otherId=randomUUID();await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) SELECT $1,id,current_blueprint_version_id,'迁移后必须保留的另一生产单','waiting_input' FROM public.accounts WHERE id=$2",[otherId,account]);await mkdir(join(f.assetRoot,'episodes',otherId),{recursive:true});const otherMaterial=await f.request('importMaterial',{episodeId:otherId,sourceKind:'file',sourcePath:'retain.md',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/markdown',isMainScript:false,contentBase64:Buffer.from('另一生产单的原件').toString('base64')});expect(otherMaterial.status,JSON.stringify(otherMaterial.body)).toBe(200);
 const frozen=async()=>({blueprint:(await f.c.query('SELECT b.* FROM public.account_blueprint_versions b JOIN public.episodes e ON e.blueprint_version_id=b.id WHERE e.id=$1',[f.episode])).rows,tasks:(await f.c.query('SELECT id,input_snapshot FROM public.tasks WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,candidates:(await f.c.query('SELECT * FROM local_identity.workspace_visual_candidates WHERE workspace_id=$1 ORDER BY id',[w.id])).rows,approvals:(await f.c.query('SELECT * FROM public.approvals WHERE episode_id=$1 ORDER BY id',[f.episode])).rows});
 const beforeMigration=await frozen(),target=join(f.root,'pexels-migrated-account');await mkdir(target);const accountCommand=(command:string,data:Record<string,unknown>={},token=f.token,csrf=true)=>post('/api/local/account-commands',command,{accountId:account,...data},token,csrf);
 const plan=await accountCommand('planAssetDirectoryMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.conflicts).toEqual([]);const paths=plan.body.files.map((v:any)=>v.relativePath);expect(paths).toContain(preview.preview.relativePath);expect(paths.some((p:string)=>p.endsWith('project-store-v1.sqlite3'))).toBe(true);expect(paths.some((p:string)=>p.includes('pexels-22.mp4'))).toBe(true);expect(paths.some((p:string)=>p.includes('native-tasks/')&&p.endsWith('.json'))).toBe(true);
 expect((await accountCommand('executeAssetDirectoryMigration',{migrationId:plan.body.id},f.otherToken)).status).toBe(404);expect((await accountCommand('executeAssetDirectoryMigration',{migrationId:plan.body.id},f.token,false)).status).toBe(403);
 const moved=await accountCommand('executeAssetDirectoryMigration',{migrationId:plan.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);expect(moved.body).toMatchObject({status:'completed',originalsRetained:true});for(const file of plan.body.files)expect(await readFile(join(target,file.relativePath))).toEqual(await readFile(join(f.assetRoot,file.relativePath)));expect(await frozen()).toEqual(beforeMigration);
 const originals=f.assetRoot+'-original-retained';await rename(f.assetRoot,originals);actualRoot=target;await f.restart();await read();expect(w.pexels.requests.find((r:any)=>r.id===search.id).results).toHaveLength(2);expect(w.visualCandidates.find((v:any)=>v.id===candidate.id)).toMatchObject({status:'adopted',source:{id:22}});expect(await download(preview.preview)).toEqual(sourceMedia);
 const reopened=await send('openWorkspaceStudio');w=reopened.productionWorkspace;await editStudioDocument(reopened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('Pexels 迁移前的原生编辑');doc.timelines[0].name='原目录离线后继续原生编辑';});const resaved=await send('saveWorkspaceStudio',{workspaceRelativePath:reopened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:reopened.workspace.sha256});w=resaved.productionWorkspace;await send('closeWorkspaceStudio');
 await send('exportWorkspace');const exported=w.exports[0];expect(exported.status,JSON.stringify(exported)).toBe('ready');expect(await download(exported.artifact)).toEqual(await readFile(join(target,exported.artifact.relativePath)));
 await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'Pexels 迁移后交付',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:1}) as any[])[0];expect(task.allowed_asset_root).toBe(target);const result=await runWorkspaceDeliveryProcess(f,task,{mountPath:volume.mountPath,visualCommand:[process.execPath,'--version']});expect(result.status,JSON.stringify(result)).toBe('completed');await read();expect(w.deliveries[0].verified).toBe(true);
 const pack=w.deliveries[0].artifacts.find((a:any)=>a.artifactType==='publish_package'),manifest=JSON.parse((await download(pack)).toString('utf8'));expect(manifest.identity.video.sha256).toBe(exported.artifact.sha256);for(const artifact of manifest.artifacts)expect((await download(artifact)).length).toBe(Number(artifact.fileSize));
 const lifecycle=(command:string,data:Record<string,unknown>={},token=f.token,csrf=true)=>post('/api/local/episode-lifecycle',command,{episodeId:f.episode,...data},token,csrf);
 const snapshot=async()=>{const value:Record<string,unknown>={};for(const table of ['production_workspaces','workspace_pexels_requests','workspace_deliveries','workspace_visual_candidates','workspace_exports'])value[table]=(await f.c.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) value FROM local_identity.${table} t WHERE ${table==='production_workspaces'?'id':'workspace_id'}=$1`,[w.id])).rows[0].value;return value;};
 const tree=async(root:string)=>{const value:Record<string,string>={};async function walk(path:string){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())value[file.slice(root.length)]=createHash('sha256').update(await readFile(file)).digest('hex');}}await walk(root);return value;};
 const readOnly=await snapshot(),readOnlyTree=await tree(join(target,'episodes',f.episode));expect((await f.request('searchWorkspacePexelsVideos',{workspaceId:w.id,expectedRevision:w.revision,...query})).status).toBe(409);expect(await snapshot()).toEqual(readOnly);expect(await tree(join(target,'episodes',f.episode))).toEqual(readOnlyTree);
 expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);const deletion=await lifecycle('planDeletion');expect(deletion.status).toBe(200);expect(deletion.body.paths).toEqual([join(target,'episodes',f.episode)]);const deletionData={confirmation:deletion.body.confirmation,expectedPath:deletion.body.path,expectedPaths:deletion.body.paths,expectedRevision:deletion.body.revision};expect((await lifecycle('deleteEpisode',deletionData,f.otherToken)).status).toBe(404);expect((await lifecycle('deleteEpisode',deletionData,f.token,false)).status).toBe(403);
 const beforeDelete=await snapshot(),beforeTree=await tree(target),originalTree=await tree(originals);expect(beforeDelete.workspace_pexels_requests).toBeTruthy();expect(beforeDelete.workspace_deliveries).toBeTruthy();await f.c.query(`CREATE FUNCTION public.reject_t11_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Controlled deletion rollback'; END $$; CREATE TRIGGER reject_t11_delete AFTER DELETE ON local_identity.production_workspaces FOR EACH ROW EXECUTE FUNCTION public.reject_t11_delete()`);
 expect((await lifecycle('deleteEpisode',deletionData)).status).toBe(503);expect(await snapshot()).toEqual(beforeDelete);expect(await tree(target)).toEqual(beforeTree);expect(await tree(originals)).toEqual(originalTree);for(const path of deletion.body.stagingPaths)await expect(stat(path)).rejects.toMatchObject({code:'ENOENT'});await f.c.query('DROP TRIGGER reject_t11_delete ON local_identity.production_workspaces; DROP FUNCTION public.reject_t11_delete()');
 const finalPlan=await lifecycle('planDeletion');const retainedBefore:{path:string;device:string;inode:string;sha256:string}[]=await Promise.all(finalPlan.body.preserved.map(async(file:{path:string})=>{const s=await lstat(file.path,{bigint:true});return{path:file.path,device:String(s.dev),inode:String(s.ino),sha256:createHash('sha256').update(await readFile(file.path)).digest('hex')};}));
 expect(retainedBefore.some(file=>file.path.endsWith('/runtime/project-store-v1.json'))).toBe(true);expect(retainedBefore.some(file=>file.path.endsWith('/runtime/settings.env'))).toBe(true);expect(retainedBefore.some(file=>file.path.endsWith('/representative.jpg'))).toBe(true);
 const deleted=await lifecycle('deleteEpisode',{confirmation:finalPlan.body.confirmation,expectedPath:finalPlan.body.path,expectedPaths:finalPlan.body.paths,expectedRevision:finalPlan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);
 for(const file of finalPlan.body.files)await expect(lstat(file.path)).rejects.toMatchObject({code:'ENOENT'});
 for(const file of retainedBefore){const actual=await lstat(file.path,{bigint:true});expect([String(actual.dev),String(actual.ino)]).toEqual([file.device,file.inode]);expect(createHash('sha256').update(await readFile(file.path)).digest('hex')).toBe(file.sha256);}
 const remaining=await tree(join(target,'episodes',f.episode));expect(remaining).toEqual(Object.fromEntries(retainedBefore.map(file=>[file.path.slice(join(target,'episodes',f.episode).length),file.sha256])));
 if(process.env.LOOP_T17_EVIDENCE){const {deletionFixtureFingerprint}=await import('./deletionFingerprint.fixture');await mkdir(process.env.LOOP_T17_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_T17_EVIDENCE,'pexels-retained.json'),JSON.stringify({plan:finalPlan.body,result:deleted.body,retainedBefore,tree:await deletionFixtureFingerprint(join(target,'episodes',f.episode)),intent:(await f.c.query('SELECT * FROM local_identity.episode_deletion_intents')).rows},null,2));}
 for(const table of ['workspace_pexels_requests','workspace_deliveries'])expect((await f.c.query(`SELECT count(*)::int n FROM local_identity.${table} WHERE workspace_id=$1`,[w.id])).rows[0].n).toBe(0);expect(await tree(originals)).toEqual(originalTree);expect(await readFile(join(target,otherMaterial.body.storage_path),'utf8')).toBe('另一生产单的原件');expect(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toEqual(sourceMedia);expect((await f.c.query('SELECT title FROM public.episodes WHERE id=$1',[otherId])).rows[0].title).toBe('迁移后必须保留的另一生产单');
 if(process.env.LOOP_T11_EVIDENCE_DIR){const dir=process.env.LOOP_T11_EVIDENCE_DIR;await mkdir(dir,{recursive:true});await writeFile(join(dir,'pexels-migration-delivery-delete.json'),JSON.stringify({account,episode:f.episode,otherId,sourceRoot:f.assetRoot,targetRoot:actualRoot,search,preview,candidate,beforeMigration,plan:plan.body,migration:moved.body,exported,manifest,result,beforeDelete,originalTree,deletion:deleted.body},null,2));}
 }finally{await worker.end();await f.close();await volume.close();}
},300000);
