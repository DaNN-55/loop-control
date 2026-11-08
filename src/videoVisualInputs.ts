export type VideoVisualInputRole = 'firstFrame' | 'lastFrame' | 'referenceImages' | 'referenceVideos';
export const videoVisualInputRoles = ['firstFrame','lastFrame','referenceImages','referenceVideos'] as const;
export const videoVisualInputLabels: Record<VideoVisualInputRole,string> = {
 firstFrame:'首帧',lastFrame:'尾帧',referenceImages:'参考图',referenceVideos:'参考视频',
};
export interface VideoVisualInputLimit {
 max: number;
 min?: number;
 maxBytes?: number;
 mimeTypes?: readonly string[];
}
export interface VideoGenerationMode {
 id: string;
 label: string;
 allowAssetVideoSource?: boolean;
 allowInlineMp4?: boolean;
 referenceImageSource?: 'https';
 characterOrder?: boolean;
 maxReferences?: number;
 maxImagesWithVideo?: number;
 videoSeconds?: {min:number;max:number};
 inputs: Partial<Record<VideoVisualInputRole, VideoVisualInputLimit>>;
}
export interface VideoVisualInputSelection {
 role: VideoVisualInputRole;
 materialRevisionId: string;
 source?: string;
}
export interface FrozenVideoVisualInput extends VideoVisualInputSelection {
 artifactType: string;
 relativePath: string;
 sha256: string;
 fileSize: number;
 mimeType: string;
 name: string;
}

export const videoOutputRatios=['16:9','9:16','1:1'] as const;
export type VideoOutputRatio=typeof videoOutputRatios[number];

export function isPublicMediaUrl(value:unknown):value is string {
 if(typeof value!=='string'||value.length>2048||value!==value.trim())return false;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&
   /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname)&&
   !/\.(local|localhost|internal|test|invalid|example)$/i.test(url.hostname);
 }catch{return false;}
}

export function isVideoReferenceSource(value:unknown):value is string {
 return isPublicMediaUrl(value)||typeof value==='string'&&value.length<=2048&&/^asset:\/\/[a-zA-Z0-9_-]+$/.test(value);
}

export function videoVisualInputProblem(mode:VideoGenerationMode,entries:readonly VideoVisualInputSelection[]){
 if(mode.maxReferences&&entries.length>mode.maxReferences)return `最多可提交 ${mode.maxReferences} 项参考素材。`;
 if(mode.maxImagesWithVideo&&entries.some(entry=>entry.role==='referenceVideos')&&entries.filter(entry=>entry.role==='referenceImages').length>mode.maxImagesWithVideo)
  return `有参考视频时最多可提交 ${mode.maxImagesWithVideo} 张参考图。`;
 for(const role of videoVisualInputRoles){
  const selected=entries.filter(entry=>entry.role===role),limit=mode.inputs[role];
  if(selected.length>(limit?.max??0)||selected.length<(limit?.min??0))return `${videoVisualInputLabels[role]}数量与当前生成模式不匹配。`;
  if(new Set(selected.map(entry=>entry.materialRevisionId)).size!==selected.length)return `${videoVisualInputLabels[role]}不能重复。`;
  if(role!=='referenceVideos'){
   if(role==='referenceImages'&&mode.referenceImageSource==='https'){
    if(selected.some(entry=>!isPublicMediaUrl(entry.source)))return '参考图需要可公开访问的 HTTPS 地址。';
   }else if(selected.some(entry=>entry.source!==undefined))return '图片输入仅支持本期素材。';
   continue;
  }
  const invalidSource=selected.some(({source})=>{
   if(source===undefined&&mode.allowInlineMp4)return false;
   return !isVideoReferenceSource(source)||(!mode.allowAssetVideoSource&&source.startsWith('asset:'));
  });
  if(invalidSource)return mode.allowAssetVideoSource?'参考视频需要有效的 HTTPS 地址或方舟素材 ID。':'参考视频需要可公开访问的 HTTPS 地址。';
 }
 if(!entries.length)return '请至少选择一项画面输入。';
 return null;
}
