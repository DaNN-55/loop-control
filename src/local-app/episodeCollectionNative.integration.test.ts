// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,mkdtemp,rm,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {prepareCollectionTargets,moveCollection} from './episodeCollection.fixture';
import {restoreCreatedEpisode} from './episodeCreationRestore.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('all historical native coordinates remain usable after A→B→unassigned→A→B and a real database/media restore with original sources offline',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t14-restore-');await mkdir(join(storage,'state'));
 const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex'),{runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await productionWorkspaceFixture({databaseName:source,testRootParent:join(storage,'state'),runtime:{wake(){}},migrations:['db/local/120-native-workspace-storage-locations.sql','db/local/121-restored-media-deployment.sql']});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  let opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='T14 original SQLite edit';});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');
  const frozen=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const {post,account,a,b,adoption}=await prepareCollectionTargets(f);await rename(join(f.assetRoot,f.episodeRelativePath),join(f.assetRoot,f.episodeRelativePath+'.offline'));
  opened=await send('openWorkspaceStudio');const blocked=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(blocked.status).toBe(200);expect(blocked.body.conflicts.some((v:string)=>v.includes('Studio'))).toBe(true);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:blocked.body.id})).status).toBe(409);await post('account-commands','rollbackAssetDirectoryMigration',{accountId:account,migrationId:blocked.body.id});await send('closeWorkspaceStudio');
  let prefix=adoption.episodes[0].targetPrefix;const moves=[];
  for(const seriesId of [a.series_id,b.series_id,null,a.series_id,b.series_id]){
   const moved=await moveCollection(f,account,seriesId);moves.push(moved);await rename(join(f.assetRoot,prefix),join(f.assetRoot,prefix+'.offline'));prefix=moved.episodes[0].targetPrefix;await f.restart();
   for(const file of f.files.filter(file=>file.relativePath===f.videoPath)){const read=await fetch(f.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(file.relativePath)+'&sha256='+file.sha256,{headers:{Cookie:'loop_owner_session='+f.token,Range:'bytes=0-31'}});expect(read.status).toBe(206);}
  }
  opened=await send('openWorkspaceStudio');expect(opened.workspace.relativePath).toBe(prefix+'/openchatcut-work/current/project.json');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T14 original SQLite edit');doc.timelines[0].name='T14 current after five moves';});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');await f.restart();opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('T14 current after five moves');});await send('closeWorkspaceStudio');await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  const artifact=w.exports[0].artifact,response=await fetch(f.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(artifact.relativePath)+'&sha256='+artifact.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(artifact.sha256);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(frozen);
  const evidence=process.env.LOOP_T14_EVIDENCE??'/private/tmp/loop-control-178-20261031/T14/native-restore';await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'moves.json'),JSON.stringify({moves,adoption,frozen,currentPrefix:prefix,sourceOffline:true},null,2));
  await restoreCreatedEpisode({f,context,storage,source,target,episode:f.episode,accountId:account,prefix,w,evidence,volumeMount:'/',phase:'collection',expectedTransformX:0});
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
