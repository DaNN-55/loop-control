import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import type {WorkspaceClip} from '../productionWorkspace.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {lockProductionWorkspace,updateWorkspaceProject} from './productionWorkspaceCommands.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Initial preparation only. Later edits must use the live native document. */
export async function saveWorkspaceVideoRanges(c:PoolClient,root:string,episodeId:string,data:Record<string,unknown>){
 const {row,project}=await lockProductionWorkspace(c,root,episodeId,data.workspaceId,data.expectedRevision);
 if(isOpenChatCutStudio(episodeId)||Number(row.native_edit_revision)>0)throw new ConfigurationError(409,'工程已进入剪辑，请在当前工作台调整视频引用。');
 if(typeof data.shotId!=='string'||!Array.isArray(data.ranges)||data.ranges.length<1||data.ranges.length>50)throw new ConfigurationError(400,'请选择镜头和 1–50 个视频区间。');
 const previous=row.bindings.filter(b=>b.shotId===data.shotId);if(!previous.length)throw new ConfigurationError(404,'当前镜头不存在。');
 if(previous.some(b=>b.image||b.source&&b.source.kind!=='video'))throw new ConfigurationError(409,'当前镜头已匹配图片，请在剪辑中调整。');
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===previous[0].itemId));
 const old=timeline?.items.filter(i=>previous.some(b=>b.itemId===i.id));
 if(!timeline||!old||old.length!==previous.length||old.some(i=>i.kind!=='video'&&i.kind!=='text'))throw new ConfigurationError(409,'当前镜头结构已变化，请在剪辑中调整。');
 const start=Math.min(...old.map(i=>Number(i.startFrame))),end=Math.max(...old.map(i=>Number(i.startFrame)+Number(i.durationInFrames))),ids=new Set<string>();
 const items:Array<Record<string,unknown>>=[],bindings:WorkspaceClip[]=[];
 let frame=start;
 for(const [index,value] of data.ranges.entries()){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['clipId','materialRevisionId','sourceInFrame','durationInFrames','durationLocked'].includes(k)))throw new ConfigurationError(400,'视频区间字段无效。');
  const r=value as Record<string,unknown>;
  if(typeof r.materialRevisionId!=='string'||!uuid.test(r.materialRevisionId)||!Number.isSafeInteger(r.sourceInFrame)||Number(r.sourceInFrame)<0||!Number.isSafeInteger(r.durationInFrames)||Number(r.durationInFrames)<1||typeof r.durationLocked!=='boolean'||r.clipId!==undefined&&(typeof r.clipId!=='string'||!uuid.test(r.clipId)))throw new ConfigurationError(400,'视频区间必须使用非负整数起点和正整数帧长。');
  const existing=r.clipId?previous.find(b=>b.id===r.clipId):index===0&&!previous[0].source?previous[0]:undefined;
  if(r.clipId&&!existing)throw new ConfigurationError(409,'引用不属于当前镜头。');
  const id=existing?.id??randomUUID();if(ids.has(id))throw new ConfigurationError(400,'同一引用不能重复提交。');ids.add(id);
  const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='video' AND mime_type='video/mp4'",[r.materialRevisionId,episodeId])).rows[0];
  if(!m)throw new ConfigurationError(404,'本期视频材料不存在。');
  let observed:Awaited<ReturnType<typeof inspectMp4Artifact>>;
  try{await verifyNativeFile(root,m.storage_path,m.sha256,Number(m.file_size));observed=await inspectMp4Artifact(join(root,m.storage_path));}catch{throw new ConfigurationError(409,'视频材料缺失、指纹已变化或无法读取。');}
  const sourceFrames=Math.floor(observed.durationSeconds*timeline.fps+0.001);
  if(Number(r.sourceInFrame)+Number(r.durationInFrames)>sourceFrames)throw new ConfigurationError(400,'视频区间超出原片，请调整起止帧。');
  const assetId=`material-${m.id}`;if(!project.assets.some(a=>a.id===assetId))project.assets.push(Object.assign({id:assetId,name:m.source_path.split('/').pop(),kind:'video' as const,src:m.storage_path,durationInFrames:sourceFrames},{sourceRevision:m.id,sourceContentHash:m.sha256,sourceFilename:m.source_path.split('/').pop(),width:observed.width,height:observed.height}));
  const itemId=existing?.itemId??`shot-${data.shotId}-${id}`,base=old.find(i=>i.id===itemId)??{};
  const item={...base,id:itemId,track:old[0].track,kind:'video',name:data.shotId,src:m.storage_path,sourceAssetId:assetId,sourceRevision:m.id,sourceContentHash:m.sha256,sourceFilename:m.source_path.split('/').pop(),startFrame:frame,durationInFrames:Number(r.durationInFrames),srcInFrame:Number(r.sourceInFrame),volume:base.volume??0,loopControlVideo:{durationLocked:r.durationLocked}};delete (item as Record<string,unknown>).props;
  items.push(item);bindings.push({id,itemId,shotId:data.shotId,text:previous[0].text,source:{materialRevisionId:m.id,relativePath:m.storage_path,sha256:m.sha256,fileSize:Number(m.file_size),kind:'video'}});frame+=Number(r.durationInFrames);
 }
 const delta=frame-end;for(const item of timeline.items)if(!old.includes(item)&&Number(item.startFrame)>=end)item.startFrame=Number(item.startFrame)+delta;
 const retained=new Set(items.map(i=>i.id)),removed=new Set(old.filter(i=>!retained.has(i.id)).map(i=>i.id));
 if(removed.has(timeline.selectedId))timeline.selectedId=null;
 const selected=(timeline as unknown as {selectedIds?:string[]});if(selected.selectedIds)selected.selectedIds=selected.selectedIds.filter(id=>!removed.has(id));
 const insertion=timeline.items.findIndex(i=>old.includes(i));timeline.items=timeline.items.filter(i=>!old.includes(i));timeline.items.splice(insertion,0,...items);
 const at=row.bindings.findIndex(b=>b.shotId===data.shotId),next=row.bindings.filter(b=>b.shotId!==data.shotId);next.splice(at,0,...bindings);
 return updateWorkspaceProject(c,root,row,project,next,'准备视频区间');
}
