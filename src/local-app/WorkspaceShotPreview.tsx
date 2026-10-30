import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';

/** The saved native document owns the current visual; bindings retain original provenance. */
export function workspaceShotSource(clip:WorkspaceClip,project:OpenChatCutProject|null){
 const item=project?.timelines.flatMap(t=>t.items).find(i=>i.id===clip.itemId);
 if(!item)return clip.source;
 if(!['video','image'].includes(String(item.kind))||typeof item.src!=='string')return null;
 const asset=project?.assets?.find(a=>a.id===item.sourceAssetId) as {sourceContentHash?:string}|undefined;
 const sha256=item.sourceContentHash??asset?.sourceContentHash??(clip.source?.relativePath===item.src?clip.source.sha256:null);
 return typeof sha256==='string'?{kind:item.kind as 'video'|'image',relativePath:item.src,sha256}:null;
}

export function WorkspaceShotPreview({workspace,clips,selectedItemId,onSelect,project,materials=[]}:{workspace:ProductionWorkspace;clips:WorkspaceClip[];selectedItemId?:string;onSelect:(itemId:string)=>void;project:OpenChatCutProject|null;materials?:Array<{storage_path:string;source_path:string}>}){
 const clip=clips.find(c=>c.itemId===selectedItemId)??clips[0];
 if(!clip)return null;
 const timeline=project?.timelines.find(t=>t.items.some(i=>i.id===clip.itemId)),item=timeline?.items.find(i=>i.id===clip.itemId),fps=timeline?.fps??30;
 const start=Number(item?.srcInFrame??0)/fps,duration=Number(item?.durationInFrames??0)/fps,rate=Number(item?.playbackRate??1),end=start+duration*rate,source=workspaceShotSource(clip,project);
 const name=materials.find(m=>m.storage_path===source?.relativePath)?.source_path.split('/').pop()??source?.relativePath.split('/').pop();
 const url=source?`/_local-artifact?${new URLSearchParams({episode:workspace.episodeId,path:source.relativePath,sha256:source.sha256})}`:null;
 return <section className="workspace-shot-preview" aria-label={`${clip.shotId} 当前画面`}>
  <header><h3>当前画面</h3>{clips.length>1&&<NativeSelect size="sm" aria-label="预览画面片段" value={clip.itemId} onChange={e=>onSelect(e.target.value)}>{clips.map((c,index)=><option key={c.itemId} value={c.itemId}>片段 {index+1} / {clips.length}</option>)}</NativeSelect>}</header>
  <div className="workspace-shot-preview-media">{!url?<p>{clip.image?.taskId?'视频准备中，完成后可在下方填入结果。':'尚未匹配画面，可上传素材或生成视频。'}</p>:source?.kind==='image'?<img src={url} alt={`${clip.shotId} 当前图片`}/>:<video key={url+':'+start+':'+end} src={url} aria-label={`${clip.shotId} 当前视频`} controls preload="metadata" onLoadedMetadata={e=>{e.currentTarget.playbackRate=rate;if(start>0)e.currentTarget.currentTime=Math.min(start,e.currentTarget.duration);}} onPlay={e=>{e.currentTarget.playbackRate=rate;if(duration>0&&(e.currentTarget.currentTime<start||e.currentTarget.currentTime>=end))e.currentTarget.currentTime=start;}} onTimeUpdate={e=>{if(duration>0&&e.currentTarget.currentTime>=end&&!e.currentTarget.paused){e.currentTarget.pause();e.currentTarget.currentTime=end;}}}/>}</div>
  {source&&<footer><span title={source.relativePath}>{name}</span>{duration>0&&<span>使用 {start.toFixed(2)}–{end.toFixed(2)} s</span>}</footer>}
 </section>;
}
