// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,readFile,mkdir,lstat,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {csrfFor} from './sessions';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1').each(['legacy','registered'] as const)('real native working files have exact deletion authority while unknown native neighbors remain (%s)',async layout=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> '系列 中文 %_[] #?/本期 stable':undefined,runtime:{wake(){}}});
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items[0].name='T10 原生真实保存';});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  const closed=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(closed.status,JSON.stringify(closed.body)).toBe(200);
  const working=join(f.assetRoot,f.episodeRelativePath,'openchatcut-work/current'),unknown=join(working,'runtime/media/uploads/manual.png');await writeFile(unknown,'unknown upload original');const before=await lstat(unknown,{bigint:true});
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const beforePlan=await deletionFixtureFingerprint(working),plan=await post('planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(await deletionFixtureFingerprint(working)).toEqual(beforePlan);
  if(process.env.LOOP_T10_EVIDENCE){const directory=process.env.LOOP_T10_EVIDENCE;await mkdir(directory,{recursive:true});await writeFile(join(directory,'native-'+layout+'.json'),JSON.stringify({plan:plan.body,workingFingerprint:beforePlan,workspace:w,metadata:JSON.parse(await readFile(join(working,'workspace.json'),'utf8')),hostSha256:createHash('sha256').update(await readFile(join(working,'project.json'))).digest('hex'),planReadOnly:true},null,2));}
  for(const suffix of ['workspace.json','generated-project.json','project.json','runtime/project-store-v1.sqlite3'])expect(plan.body.files.map((file:{path:string})=>file.path)).toContain(join(working,suffix));
  expect(plan.body.files.some((file:{path:string})=>file.path.includes('/runtime/media/uploads/')&&file.path!==unknown)).toBe(true);expect(plan.body.preserved).toEqual(expect.arrayContaining([expect.objectContaining({path:unknown})]));
  const deleted=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);
  await expect(access(join(working,'runtime/project-store-v1.sqlite3'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(unknown,'utf8')).toBe('unknown upload original');expect((await lstat(unknown,{bigint:true})).ino).toBe(before.ino);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('delete awaits actual native shutdown and requires a fresh confirmation after that inventory changes',async()=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:()=> '关闭原生进程 %_[]/本单',runtime:{wake(){}}});
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 const confirm=(plan:Record<string,unknown>)=>({episodeId:f.episode,confirmation:plan.confirmation,expectedPath:plan.path,expectedPaths:plan.paths,expectedRevision:plan.revision});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);
  const receiptPath=join(f.assetRoot,f.episodeRelativePath,'openchatcut-work/current/runtime/.loop-control-studio-process.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));expect((await fetch(new URL('/api/project-store/entry?key='+encodeURIComponent('project:loop-control-'+f.episode),opened.body.studioUrl),{headers:{'Sec-Fetch-Site':'none'}})).status).toBe(200);
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('planDeletion',{episodeId:f.episode});expect(plan.status).toBe(200);const deleted=await post('deleteEpisode',confirm(plan.body));expect(deleted.status,JSON.stringify(deleted.body)).toBe(409);
  expect(()=>process.kill(receipt.pid,0)).toThrow();await expect(access(receiptPath)).rejects.toMatchObject({code:'ENOENT'});await expect(access(receipt.cache.path)).rejects.toMatchObject({code:'ENOENT'});
  const next=await post('planDeletion',{episodeId:f.episode});expect(next.status,JSON.stringify(next.body)).toBe(200);expect(next.body.revision).not.toBe(plan.body.revision);const retried=await post('deleteEpisode',confirm(next.body));expect(retried.status,JSON.stringify(retried.body)).toBe(200);expect(retried.body.cleanupPending).toBe(false);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('an extra native project keeps the entire unproven native store and its mapped source bytes',async()=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:()=> '未知 SQLite %_[]/本单',runtime:{wake(){}}});
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;expect((await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  const working=join(f.assetRoot,f.episodeRelativePath,'openchatcut-work/current'),sqlite=join(working,'runtime/project-store-v1.sqlite3'),source=join(f.assetRoot,f.videoPath),bytes=await readFile(source);
  const {DatabaseSync}=await import('node:sqlite'),database=new DatabaseSync(sqlite);try{database.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('project:foreign-project',JSON.stringify({id:'foreign-project',reference:'/media/uploads/unknown.png'}));}finally{database.close();}
  const before=await deletionFixtureFingerprint(working);await post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.files.map((file:{path:string})=>file.path)).not.toContain(sqlite);expect(plan.body.files.map((file:{path:string})=>file.path)).not.toContain(source);expect(await deletionFixtureFingerprint(working)).toEqual(before);
  const deleted=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);expect(await deletionFixtureFingerprint(working)).toEqual(before);expect(await readFile(source)).toEqual(bytes);
 }finally{await f.close();}
},300000);
