import type {PoolClient} from 'pg';
import {relative} from 'node:path';
import {recoverLegacyBindings} from './workspacePreparation.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {episodeFileIO} from './episodeFiles.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {adaptLegacyWorkspaceMetadata} from './legacyWorkspaceMetadata.js';
import {ConfigurationError} from './configurationCommands.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspaceClip} from '../productionWorkspace.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';

/** One frozen-source and actual-window validator serves native, HTML and workbench imports. */
export async function recoverImportedWorkspaceProject(c:PoolClient,root:string,episodeId:string,workspaceId:string,project:OpenChatCutProject,original:WorkspaceClip[],render?:NonNullable<WorkerTaskPackage['reviewRender']>,preserveNativeEdits=false){
 const clips=await recoverLegacyBindings(c,root,episodeId,workspaceId,project,original);
   if(render){
    for(const member of render.members){const source=await resolveWorkspaceSource(c,root,episodeId,member.relativePath);if(source.sha256!==member.sha256)throw new ConfigurationError(409,'当前素材登记与旧工程冻结版本不一致。');}
    // Source asset duration is the full file, not the selected legacy interval.
    for(const asset of project.assets){
     const path=await (await episodeFileIO(c,root,episodeId)).resolveReference(asset.src);
     // A still has no finite source duration; keep its native presentation window.
     if(asset.kind==='image'){await inspectWorkspaceVisualFile(root,relative(root,path),'image');continue;}
     const observed=asset.kind==='video'?await inspectWorkspaceVisualFile(root,relative(root,path),'video'):null;
     asset.durationInFrames=Math.ceil((observed?.durationSeconds??await probeMp3Artifact(path))*project.timelines[0].fps);if(observed)Object.assign(asset,{width:observed.width,height:observed.height});
    }
    for(const item of project.timelines[0].items){
     const asset=project.assets.find(a=>a.id===item.sourceAssetId||a.src===item.src);if(!asset)continue;
     const start=Number(item.srcInFrame??0),duration=Number(item.durationInFrames),rate=Number(item.playbackRate??1);
     if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(duration)||duration<1||!Number.isFinite(rate)||rate<=0||asset.kind!=='image'&&start+duration*rate>asset.durationInFrames+1)throw new ConfigurationError(409,'旧工程的实际使用区间超出原文件，未接入不完整素材。');
    }
    try{adaptLegacyWorkspaceMetadata(project,clips,render,preserveNativeEdits);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原工程声音或字幕身份无法核验。');}
   }
 return clips;
}
