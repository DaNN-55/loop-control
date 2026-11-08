import type {PoolClient} from 'pg';
import {relative} from 'node:path';
import {firstFrameVideoMode} from '../worker/registeredAdapters.js';
import {videoVisualInputRoles,videoVisualInputProblem,videoVisualInputLabels,type FrozenVideoVisualInput,type VideoVisualInputSelection} from '../videoVisualInputs.js';
import {ConfigurationError} from './configurationCommands.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import type {resolveProductionSelection} from './productionSelection.js';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function resolveWorkspaceVideoInputs(c:PoolClient,root:string,episodeId:string,payload:Record<string,unknown>,resolved:Awaited<ReturnType<typeof resolveProductionSelection>>){
 const modes=resolved.choice.videoGenerationModes?.[resolved.selection.model!]??[firstFrameVideoMode(resolved.choice.constraints.firstFrame)];
 const mode=modes.find(entry=>entry.id===(payload.videoMode??'first-frame'));
 if(!mode)throw new ConfigurationError(400,'当前模型不支持所选生成模式。');
 const advanced=mode.id!=='first-frame';
 if(advanced&&(payload.firstFrameMaterialRevisionId!==undefined||payload.materialRevisionId!==undefined)||
    !advanced&&payload.visualInputs!==undefined)throw new ConfigurationError(400,'画面输入与生成模式不匹配。');
 const raw:unknown=advanced?payload.visualInputs:[{role:'firstFrame',materialRevisionId:payload.firstFrameMaterialRevisionId??payload.materialRevisionId}];
 if(!Array.isArray(raw)||raw.length>40||raw.some(entry=>!entry||typeof entry!=='object'||
  Object.keys(entry).some(key=>!['role','materialRevisionId','source'].includes(key))||
  !videoVisualInputRoles.includes(entry.role)||typeof entry.materialRevisionId!=='string'||!uuid.test(entry.materialRevisionId))){
  throw new ConfigurationError(400,'画面素材标识无效。');
 }
 const entries=raw as VideoVisualInputSelection[];
 const problem=videoVisualInputProblem(mode,entries);
 if(problem)throw new ConfigurationError(400,problem);
 const frozen:FrozenVideoVisualInput[]=[],referenceVideoDurations:number[]=[];
 const version25=resolved.selection.model==='doubao-seedance-2-5-260628';
 let referenceVideoSeconds=0,inlineBytes=0;
 for(const entry of entries){
  const isVideo=entry.role==='referenceVideos',kind=isVideo?'video':'image',limit=mode.inputs[entry.role]!;
  const m=(await c.query('SELECT id,source_path,storage_path,mime_type,sha256,file_size FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type=$3',[entry.materialRevisionId,episodeId,kind])).rows[0];
  if(!m)throw new ConfigurationError(409,`${videoVisualInputLabels[entry.role]}已变化，请重新选择本期素材。`);
  const size=Number(m.file_size);
  if(!Number.isSafeInteger(size)||size<1||limit.maxBytes&&size>limit.maxBytes||limit.mimeTypes&&!limit.mimeTypes.includes(m.mime_type))throw new ConfigurationError(400,`${videoVisualInputLabels[entry.role]}的格式或大小不适用于当前模型。`);
  await verifyEpisodeFile(c,root,episodeId,m.storage_path,m.sha256,size);
  if(!entry.source){
   if(isVideo&&m.mime_type!=='video/mp4')throw new ConfigurationError(400,'本地参考视频须为 MP4，其他格式需要 HTTPS 地址。');
   inlineBytes+=size;
   if(inlineBytes>40*1024*1024)throw new ConfigurationError(400,'直接提交的素材总大小不能超过 40 MB。');
  }
  if(isVideo){
   const path=await (await episodeFileIO(c,root,episodeId)).resolveReference(m.storage_path);
   const {durationSeconds}=await inspectWorkspaceVisualFile(root,relative(root,path),'video');
   referenceVideoSeconds+=durationSeconds!;referenceVideoDurations.push(durationSeconds!);
   if(mode.videoSeconds){
    const {min,max}=mode.videoSeconds;
    if(durationSeconds!<min||durationSeconds!>max+0.001)throw new ConfigurationError(400,`每段参考视频须为 ${min}～${max} 秒。`);
   }else{
    const maximum=version25?30:15;
    if(durationSeconds!<2||referenceVideoSeconds>maximum+0.001)throw new ConfigurationError(400,`参考视频至少 2 秒，总时长不得超过 ${maximum} 秒。`);
   }
  }
  frozen.push({...entry,artifactType:entry.role==='firstFrame'?'wan_first_frame':'video_visual_input',relativePath:m.storage_path,sha256:m.sha256,fileSize:size,mimeType:m.mime_type,name:m.source_path.split('/').pop()??m.source_path});
 }
 return {mode,frozen,advanced,referenceVideoSeconds,referenceVideoDurations};
}
