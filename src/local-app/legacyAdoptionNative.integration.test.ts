// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['legacy','recorded-prefix'] as const)('native SQLite, immutable versions and original sources survive explicit adoption, source offline and fresh SDK save/reopen/export (%s)',async layout=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='recorded-prefix'?()=> '旧收纳_% #?/原始稳定生产单':undefined,runtime:{wake(){}},migrations:['db/local/120-native-workspace-storage-locations.sql','db/local/121-restored-media-deployment.sql','db/local/123-legacy-storage-adoption.sql']});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;if(r.body.productionWorkspace)w=r.body.productionWorkspace;return r.body;};
  let opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T13 original SQLite edit';});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');
  const original=(await f.c.query('SELECT to_jsonb(t) data FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});const body=await r.json();expect(r.status,command+': '+JSON.stringify(body)).toBe(200);return body;};
  const plan=await post('planLegacyStorageAdoption',{});expect(plan.conflicts).toEqual([]);await post('executeAssetDirectoryMigration',{migrationId:plan.id});
  await rename(join(f.assetRoot,f.episodeRelativePath.split('/')[0]),join(f.assetRoot,'retained-offline'));
  await f.restart();opened=await send('openWorkspaceStudio');
  expect(opened.workspace.relativePath).toBe(plan.episodes[0].targetPrefix+'/openchatcut-work/current/project.json');
  await send('registerWorkspaceVisualCandidate',{targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video'});const candidate=w.visualCandidates.find((v:any)=>v.materialRevisionId===f.material&&v.status==='available');expect(candidate).toBeTruthy();await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',sourceInSeconds:0,sourceOutSeconds:2});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T13 original SQLite edit');doc.timelines[0].name='T13 after adoption edit';});
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');await f.restart();opened=await send('openWorkspaceStudio');
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T13 after adoption edit');});await send('closeWorkspaceStudio');
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  const artifact=w.exports[0].artifact,response=await fetch(f.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(artifact.relativePath)+'&sha256='+artifact.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(artifact.sha256);
  expect((await f.c.query('SELECT to_jsonb(t) data FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(original);
  expect(await readFile(join(f.assetRoot,'retained-offline',...f.episodeRelativePath.split('/').slice(1),'shot.mp4'))).toEqual(await readFile(join(f.assetRoot,plan.episodes[0].targetPrefix,'shot.mp4')));
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('adopted lineage is backed up and restored into a new database and root before a fresh application edits SQLite and exports with the source offline',async()=>{
 const {mkdtemp,mkdir,rm,writeFile}=await import('node:fs/promises'),{randomBytes}=await import('node:crypto'),{nativeStorageContext}=await import('./nativeStorage.fixture'),{restoreCreatedEpisode}=await import('./episodeCreationRestore.fixture');
 const storage=await mkdtemp('/private/tmp/loop-t13-restore-');await mkdir(join(storage,'state'));
 const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await productionWorkspaceFixture({databaseName:source,testRootParent:join(storage,'state'),runtime:{wake(){}},migrations:['db/local/120-native-workspace-storage-locations.sql','db/local/121-restored-media-deployment.sql','db/local/123-legacy-storage-adoption.sql']});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});const body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);return body;};
  const plan=await post('planLegacyStorageAdoption',{});expect(plan.conflicts).toEqual([]);await post('executeAssetDirectoryMigration',{migrationId:plan.id});
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T13 before backup';});const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;expect((await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  const evidence=process.env.LOOP_T13_EVIDENCE??'/private/tmp/loop-control-178-20261031/T13/restore-native-1';await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'adoption.json'),JSON.stringify(plan,null,2));
  await restoreCreatedEpisode({f,context,storage,source,target,episode:f.episode,accountId:account,prefix:plan.episodes[0].targetPrefix,w,evidence,volumeMount:'/',phase:'adopted',expectedTransformX:0});
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
