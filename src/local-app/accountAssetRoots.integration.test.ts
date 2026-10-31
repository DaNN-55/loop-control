// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,symlink,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner owns actual account directories independently of blueprint versions, and files remain isolated after restart',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/105-account-asset-directories.sql']});
 try{
 const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const configure=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('DELETE FROM local_identity.account_asset_directories');
 expect((await call('readAssetDirectory',{accountId:account})).body.status).toBe('unset');
 const createWithoutRoot=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'create',idempotencyKey:randomUUID(),data:{accountId:account,title:'必须先设置目录'}})});expect(createWithoutRoot.status).toBe(409);expect((await createWithoutRoot.json()).error).toContain('设置');
 const before=f.files[0],historic=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(before.relativePath)}&sha256=${before.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(historic.status).toBe(200);
 const legacyRoot=join(f.root,'other-legacy-root'),legacyBlueprint=randomUUID();await mkdir(legacyRoot);await writeFile(join(legacyRoot,'keep-original'),'旧目录原件');
 await f.c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$2,2,$3,false)',[legacyBlueprint,account,{asset_root:legacyRoot}]);
 expect((await call('readAssetDirectory',{accountId:account})).body.status).toBe('conflict');expect((await call('setAssetDirectory',{accountId:account,path:f.assetRoot})).status).toBe(409);expect(await readFile(join(legacyRoot,'keep-original'),'utf8')).toBe('旧目录原件');
 await f.c.query('DELETE FROM public.account_blueprint_versions WHERE id=$1',[legacyBlueprint]);
 const saved=await call('setAssetDirectory',{accountId:account,path:f.assetRoot});
 expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 expect(saved.body.assetRoot).toBe(f.assetRoot);
 const state=await call('readAssetDirectory',{accountId:account});expect(state.body).toMatchObject({assetRoot:f.assetRoot,status:'ready'});
 const next=join(f.root,'other-location');await mkdir(next);
 const changed=await call('setAssetDirectory',{accountId:account,path:next});expect(changed.status).toBe(409);expect(changed.body.error).toContain('迁移');
 const newRoot=join(f.root,'new-account');await mkdir(newRoot);
 const created=await configure('createAccount',{name:'账号乙',slug:'account-'+randomUUID(),timezone:'Asia/Shanghai',policy:{},assetRoot:newRoot});expect(created.status,JSON.stringify(created.body)).toBe(200);
 expect((await call('readAssetDirectory',{accountId:created.body.id})).body).toMatchObject({assetRoot:newRoot,status:'ready'});
 expect((await call('setAssetDirectory',{accountId:created.body.id,path:f.assetRoot})).status).toBe(409);
 const deleted=await configure('deleteAccount',{accountId:created.body.id,confirmation:'账号乙'});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);await expect(lstat(newRoot)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(f.assetRoot,f.files[0].relativePath))).toBeTruthy();
 await f.restart();expect((await call('readAssetDirectory',{accountId:account})).body.assetRoot).toBe(f.assetRoot);
 const artifact=f.files[0],r=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);expect(Buffer.from(await r.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,artifact.relativePath)));
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner creates same-title productions and managed imports in two actual roots; rename, restart and invalid roots preserve isolation',async()=>{
 const volume=await workspaceAudioVolume();const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{wake(){},mountPath:volume.mountPath}});
 try{
 const call=async(endpoint:string,command:string,data:Record<string,unknown>,extra={})=>{const r=await fetch(f.origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID(),...extra})});return{status:r.status,body:await r.json()};};
 const roots=[join(f.root,'..alpha'),join(f.root,'beta')];for(const root of roots)await mkdir(root);
 const accounts=[];
 for(const [i,root]of roots.entries()){
  const made=await call('configuration','createAccount',{name:'目录账号'+i,slug:'roots-'+randomUUID(),timezone:'Asia/Shanghai',policy:{},assetRoot:root});expect(made.status,JSON.stringify(made.body)).toBe(200);accounts.push(made.body.id);
  const harness=await call('configuration','createPromptVersion',{accountId:made.body.id,capability:'storyboard_planning',name:'受控分镜',summary:'测试',instructions:'Preserve the script.'});expect(harness.status,JSON.stringify(harness.body)).toBe(200);
  const catalog=await(await fetch(f.origin+'/api/local/catalog?view=accounts',{headers:{Cookie:'loop_owner_session='+f.token}})).json();
  const policy={positioning:'目录测试',allowed_tools:['read','write'],executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',prompt_version:'storyboard-planning-v2',harness_id:harness.body.id}},budgets:{storyboard_planning_cents:0}};
  const saved=await call('configuration','updateBlueprint',{accountId:made.body.id,policy},{expectedRevision:catalog.blueprintRevisions[made.body.current_blueprint_version_id]});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 }
 const episodes=[];
 for(const [i,accountId]of [accounts[0],accounts[1],accounts[0]].entries()){
  const made=await call('episode-commands','create',{accountId,title:'同名生产单'});expect(made.status,JSON.stringify(made.body)).toBe(200);episodes.push(made.body.id);
  const text='独立正文 '+i+'，账号目录保存受管副本。',original=join(f.root,'original-'+i+'.txt');await writeFile(original,text);
  const imported=await call('episode-commands','importMaterial',{episodeId:made.body.id,sourceKind:'file',sourcePath:'reference.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:(await readFile(original)).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect(await readFile(original,'utf8')).toBe(text);
  const root=i===1?roots[1]:roots[0];expect(await readFile(join(root,imported.body.storage_path),'utf8')).toBe(text);
  const state=await(await fetch(f.origin+'/api/local/episodes/'+made.body.id,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(state.sections.localAssetRoot).toBe(root);
  const file=await fetch(f.origin+`/_local-artifact?episode=${made.body.id}&path=${encodeURIComponent(imported.body.storage_path)}&sha256=${imported.body.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(file.status).toBe(200);expect(await file.text()).toBe(text);
  const foreign=await fetch(f.origin+`/_local-artifact?episode=${made.body.id}&path=${encodeURIComponent(imported.body.storage_path)}&sha256=${imported.body.sha256}`,{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(foreign.status).toBe(404);
 }
 expect(new Set(episodes).size).toBe(3);
 expect((await call('episode-lifecycle','renameEpisode',{episodeId:episodes[0],title:'已改名生产单'})).status).toBe(200);
 expect((await call('configuration','renameAccount',{accountId:accounts[0],name:'已重命名'})).status).toBe(200);
 const deletionScope=await call('episode-lifecycle','planDeletion',{episodeId:episodes[0]});expect(deletionScope.status,JSON.stringify(deletionScope.body)).toBe(200);expect(deletionScope.body.path).toBe(join(roots[0],'episodes',episodes[0]));
 const overlap=join(roots[0],'nested');await mkdir(overlap);
 expect((await call('account-commands','setAssetDirectory',{accountId:accounts[1],path:overlap})).status).toBe(409);
 const trickyOverlap=join(roots[0],'..owned-child');await mkdir(trickyOverlap);const emptyRoot=join(f.root,'..empty-account');await mkdir(emptyRoot);const emptyAccount=await call('configuration','createAccount',{name:'空账号隔离检查',slug:'empty-'+randomUUID(),timezone:'Asia/Shanghai',policy:{},assetRoot:emptyRoot});expect(emptyAccount.status).toBe(200);const refusedOverlap=await call('account-commands','setAssetDirectory',{accountId:emptyAccount.body.id,path:trickyOverlap});expect(refusedOverlap.status).toBe(409);expect(refusedOverlap.body.error).toContain('重叠');expect((await call('configuration','deleteAccount',{accountId:emptyAccount.body.id,confirmation:'空账号隔离检查'})).status).toBe(200);await expect(lstat(emptyRoot)).rejects.toMatchObject({code:'ENOENT'});
 const linked=join(f.root,'alias');await symlink(roots[0],linked);expect((await call('account-commands','setAssetDirectory',{accountId:accounts[1],path:linked})).status).toBe(400);
 expect((await call('account-commands','setAssetDirectory',{accountId:accounts[1],path:f.root})).status).toBe(400);
 await f.restart();
 for(const [i,episodeId]of episodes.entries()){const state=await(await fetch(f.origin+'/api/local/episodes/'+episodeId,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(state.sections.localAssetRoot).toBe(i===1?roots[1]:roots[0]);}
 await rename(roots[1],roots[1]+'-offline');
 const fault=await call('episode-commands','importMaterial',{episodeId:episodes[1],sourceKind:'file',sourcePath:'broken.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('不能写入回退目录').toString('base64')});expect(fault.status).not.toBe(200);expect((await call('account-commands','readAssetDirectory',{accountId:accounts[1]})).body.status).toBe('unavailable');
 await mkdir(roots[1]);expect((await call('account-commands','setAssetDirectory',{accountId:accounts[1],path:roots[1]})).status).toBe(409);await rename(roots[1],roots[1]+'-replacement');
 await rename(roots[1]+'-offline',roots[1]);expect((await call('account-commands','readAssetDirectory',{accountId:accounts[1]})).body.status).toBe('ready');
 }finally{await f.close();await volume.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('native SQLite project, actual exports and delivery Worker stay inside the owned root after blueprint root is absent',async()=>{
 const {productionWorkspaceFixture}=await import('./productionWorkspace.fixture');
 const {defaultShotCaptionContract}=await import('../shotCaptions');
 const {nativeWorkerPort}=await import('./workerDatabase');
 const {runWorkspaceDeliveryProcess}=await import('./workspaceDelivery.fixture');
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
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
 const sqlite=await readFile(join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.sqlite3`));expect(sqlite.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
 const {editStudioDocument}=await import('./studioDocument.fixture');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T07 SQLite 原生编辑';});
 const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});w=saved.productionWorkspace;
 w=await send('closeWorkspaceStudio');await f.restart();
 const resumed=await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(resumed.workspace.project.sha256).toBe(w.project.sha256);
 const exactProject=JSON.parse(await readFile(join(f.assetRoot,resumed.workspace.project.relativePath),'utf8'));expect(exactProject.timelines[0].name).toBe('T07 SQLite 原生编辑');
 w=await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
 const exported=w.exports[0];expect((await readFile(join(f.assetRoot,exported.artifact.relativePath))).length).toBeGreaterThan(100);
 w=await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
 w=await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'独立账号目录交付',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as any;expect(task.allowed_asset_root).toBe(f.assetRoot);
 const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status,JSON.stringify(result)).toBe('completed');
 for(const artifact of result.artifacts){expect((await readFile(join(f.assetRoot,artifact.relativePath))).length).toBe(Number(artifact.fileSize));const file=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(file.status,artifact.relativePath).toBe(200);}
 }finally{await worker.end();await f.close();}
},300000);
