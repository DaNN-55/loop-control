// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {checkpointOpenChatCutDraftVersion,openOpenChatCutDraftStudio,closeOpenChatCutStudio,snapshotOpenChatCutStudio} from '../worker/openchatcutStudio';
import {editStudioDocument} from './studioDocument.fixture';

const sdk=process.env.OPENCHATCUT_ROOT;
it.skipIf(!sdk).each([false,true])('keeps whole-shot checkpoints readable and restorable through the native SDK (previously opened=%s)',async previouslyOpened=>{
 const root=await mkdtemp('/private/tmp/loop-checkpoint-sdk-'),episodeId=randomUUID(),projectId='loop-control-'+episodeId,runtime={root:sdk,nodePath:process.execPath};
 const oldPath=`episodes/${episodeId}/materials/before.png`,newPath=`episodes/${episodeId}/materials/after.png`;
 const bytes=await readFile('src/local-app/fixtures/workspace-media/still-striped.png'),hash=createHash('sha256').update(bytes).digest('hex');
 await mkdir(dirname(join(root,oldPath)),{recursive:true});await writeFile(join(root,oldPath),bytes);await writeFile(join(root,newPath),bytes);
 let before={version:3,activeTimelineId:'main',mediaFolders:[],assets:[{id:'old-image',name:'before',kind:'image',src:oldPath,durationInFrames:300}],timelines:[{id:'main',name:'main',order:0,fps:30,width:360,height:640,fit:'cover',captionsHidden:false,selectedId:null,items:[{id:'shot-S1-a',name:'第一段',kind:'image',sourceAssetId:'old-image',sourceContentHash:hash,src:oldPath,track:'V1',startFrame:0,durationInFrames:60,width:360,height:640,fit:'cover'},{id:'shot-S1-b',name:'第二段',kind:'image',sourceAssetId:'old-image',sourceContentHash:hash,src:oldPath,track:'V1',startFrame:90,durationInFrames:60,width:360,height:640,fit:'cover'}],tracks:{V1:{kind:'video',name:'画面'}},trackOrder:['V1'],transitions:[]}]} as OpenChatCutProject;
 try{
  if(previouslyOpened){const opened=await openOpenChatCutDraftStudio(root,episodeId,before,[oldPath],'checkpoint-workspace',runtime);before=JSON.parse(await readFile(join(root,opened.workspace.relativePath),'utf8'));await closeOpenChatCutStudio(episodeId);}
  await checkpointOpenChatCutDraftVersion(root,episodeId,before,runtime);
  const after=structuredClone(before);after.assets=[{...after.assets[0],id:'new-image',name:'after',src:newPath}];after.timelines[0].items=[{...after.timelines[0].items[0],name:'整条替换后',sourceAssetId:'new-image',src:newPath,durationInFrames:150}];
  const opened=await openOpenChatCutDraftStudio(root,episodeId,after,[newPath],'checkpoint-workspace',runtime);
  const origin=new URL(opened.studioUrl!).origin;
  const response=await fetch(origin+'/api/project-store/entry?key='+encodeURIComponent('versions:'+projectId),{headers:{'Sec-Fetch-Site':'none'}});expect(response.status).toBe(200);
  const versions=(await response.json()).value as Array<{name:string;doc:OpenChatCutProject}>;
  const checkpoint=versions.find(v=>v.name==='替换整条分镜前');expect(checkpoint).toBeTruthy();
  expect(checkpoint!.doc.timelines[0].items.map(i=>[i.id,i.startFrame,i.durationInFrames])).toEqual([['shot-S1-a',0,60],['shot-S1-b',90,60]]);
  const media=await fetch(origin+checkpoint!.doc.assets[0].src);expect(media.status).toBe(200);expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes);
  await editStudioDocument(opened.studioUrl!,projectId,()=>checkpoint!.doc);
  const saved=await snapshotOpenChatCutStudio(root,episodeId,opened.workspace.relativePath,opened.workspace.sha256);
  const restored=JSON.parse(await readFile(join(root,saved.relativePath),'utf8')) as OpenChatCutProject;
  expect(restored.timelines[0].items.map(i=>[i.id,i.startFrame,i.durationInFrames])).toEqual([['shot-S1-a',0,60],['shot-S1-b',90,60]]);
  expect(restored.assets[0].src).toBe(oldPath);expect(restored.timelines[0].items.every(i=>i.src===oldPath)).toBe(true);
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},180000);
