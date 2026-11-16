// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,readFile,lstat,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {CompletedStudioCopies,completedProjectSources} from './completedStudioCopies';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
import {closeOpenChatCutStudio} from '../worker/openchatcutStudio';
import {editStudioDocument} from './studioDocument.fixture';
const sdk=process.env.OPENCHATCUT_ROOT;
it.skipIf(!sdk)('isolates real SDK autosaves/media deletion, starts from the frozen source on reopen, and keeps an independent playable project',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-copy-acceptance-')),owner=randomUUID(),episode=randomUUID();
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=','base64'),sourcePath=join(root,'original.png');await writeFile(sourcePath,bytes);
 const project=buildOpenChatCutProject(confirmedTtsRender(false),'original');
 project.assets=[{id:'image',name:'原图',kind:'image',src:'picture.png',durationInFrames:60}];
 project.timelines[0].items=[{...project.timelines[0].items.find(i=>i.kind==='video'),id:'image',kind:'image',sourceAssetId:'image',src:'picture.png',originalFilePath:sourcePath}];
 const source=JSON.stringify(project),originalFileIdentity=await lstat(sourcePath),sha=createHash('sha256').update(bytes).digest('hex');
 const copies=new CompletedStudioCopies(root,async()=>({root:sdk,nodePath:process.execPath}),async(actor,id)=>{if(actor!==owner||id!==episode)throw Error('不可见');return{project:structuredClone(project),sha256:'frozen-sha',title:'已交付',sources:[{reference:'picture.png',path:sourcePath,sha256:sha,fileSize:bytes.length}]};});
 const read=async(url:string,id:string)=>{const response=await fetch(new URL('/api/project-store/entry?key='+encodeURIComponent('project:'+id),url),{headers:{'Sec-Fetch-Site':'none'}});expect(response.status).toBe(200);return(await response.json()).value;};
 try{
  const copy=await copies.open(owner,episode,randomUUID());expect(await copies.open(owner,episode,copy.copyId)).toEqual(copy);
  for(const action of ['keep','heartbeat','discard'] as const){await expect(copies[action](randomUUID(),episode,copy.copyId)).rejects.toThrow('不可见');await expect(copies[action](owner,randomUUID(),copy.copyId)).rejects.toThrow('不可见');}
  const first=await read(copy.studioUrl,copy.workspace.projectId);
  expect(JSON.stringify(first)).not.toContain(sourcePath);expect(first.timelines[0].items[0].originalFilePath).toBeUndefined();
  const file=completedProjectSources(first)[0];expect(file).toMatch(/^\/media\/uploads\//);
  const fetched=await fetch(new URL(file,copy.studioUrl));expect(Buffer.from(await fetched.arrayBuffer())).toEqual(bytes);
  await editStudioDocument(copy.studioUrl,copy.workspace.projectId,doc=>{doc.timelines[0].width=720;});
  await closeOpenChatCutStudio(copy.workspace.projectId.replace('loop-control-',''));
  const saved=await copies.keep(owner,episode,copy.copyId);expect(await copies.keep(owner,episode,copy.copyId)).toEqual(saved);
  await copies.discard(owner,episode,copy.copyId);
  const stored=await read(saved.studioUrl,saved.projectId);expect(stored.timelines[0].width).toBe(720);
  const retained=await fetch(new URL(completedProjectSources(stored)[0],saved.studioUrl));expect(retained.status).toBe(200);expect(Buffer.from(await retained.arrayBuffer())).toEqual(bytes);
  const second=await copies.open(owner,episode,randomUUID());expect(second.workspace.projectId).not.toBe(copy.workspace.projectId);
  const reopened=await read(second.studioUrl,second.workspace.projectId);expect(reopened.timelines[0].width).toBe(project.timelines[0].width);
  // Exercise the SDK's actual permanent file/project deletion routes in a disposable fixture.
  const suffix=completedProjectSources(reopened)[0].split('/').pop()!;
  const dirs=(await readdir(tmpdir())).filter(name=>name.startsWith('loop-completed-studio-'));
  let privatePath='';for(const directory of dirs){const path=join(tmpdir(),directory,dirname(second.workspace.relativePath),'runtime/media/uploads',suffix);try{const stat=await lstat(path);expect(stat.isFile()).toBe(true);expect(stat.nlink).toBe(1);expect([stat.dev,stat.ino]).not.toEqual([originalFileIdentity.dev,originalFileIdentity.ino]);privatePath=path;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  expect(privatePath).not.toBe('');
  await writeFile(privatePath,'modified copy bytes');expect(await readFile(sourcePath)).toEqual(bytes);
  const nativeOrigin=new URL(second.studioUrl).origin,headers={Origin:nativeOrigin,'Sec-Fetch-Site':'same-origin'};
  const escaped=await fetch(nativeOrigin+'/upload?name='+encodeURIComponent(sourcePath),{method:'DELETE',headers});expect(escaped.status).toBe(400);
  const removed=await fetch(nativeOrigin+'/upload?name='+encodeURIComponent(suffix),{method:'DELETE',headers});expect(removed.status).toBe(200);expect(await removed.json()).toMatchObject({ok:true,removed:1,r2Removed:false});
  await expect(lstat(privatePath)).rejects.toMatchObject({code:'ENOENT'});
  const purged=await fetch(nativeOrigin+'/api/project-store/entry?key='+encodeURIComponent('project:'+second.workspace.projectId),{method:'DELETE',headers});expect(purged.status).toBe(200);
  const missing=await fetch(nativeOrigin+'/api/project-store/entry?key='+encodeURIComponent('project:'+second.workspace.projectId),{headers:{'Sec-Fetch-Site':'none'}});expect(await missing.json()).toMatchObject({found:false});
  expect(await readFile(sourcePath)).toEqual(bytes);expect(JSON.stringify(project)).toBe(source);
  expect((await read(saved.studioUrl,saved.projectId)).timelines[0].width).toBe(720);
  const savedMedia=await fetch(new URL(completedProjectSources(stored)[0],saved.studioUrl));expect(Buffer.from(await savedMedia.arrayBuffer())).toEqual(bytes);
  await copies.discard(owner,episode,second.copyId);
  const third=await copies.open(owner,episode,randomUUID());expect((await read(third.studioUrl,third.workspace.projectId)).timelines[0].width).toBe(project.timelines[0].width);await copies.discard(owner,episode,third.copyId);
  const savedOrigin=new URL(saved.studioUrl).origin,savedHeaders={Origin:savedOrigin,'Sec-Fetch-Site':'same-origin'};
  const removedSavedMedia=await fetch(savedOrigin+'/upload?name='+encodeURIComponent(completedProjectSources(stored)[0].split('/').pop()!),{method:'DELETE',headers:savedHeaders});expect(removedSavedMedia.status).toBe(200);expect(await removedSavedMedia.json()).toMatchObject({removed:1,r2Removed:false});
  const removedSavedProject=await fetch(savedOrigin+'/api/project-store/entry?key='+encodeURIComponent('project:'+saved.projectId),{method:'DELETE',headers:savedHeaders});expect(removedSavedProject.status).toBe(200);
  expect(await readFile(sourcePath)).toEqual(bytes);expect(JSON.stringify(project)).toBe(source);

 }finally{await copies.close();await rm(root,{recursive:true,force:true});}
},180000);
