import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {WorkbenchVideoPlayer} from './WorkbenchVideoPlayer';
import {localRequest} from '../local-app/client';
import {artifactPreviewKind,localArtifactUrl,localArtifactThumbnailUrl} from '../reviews/localArtifactPreview';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
import type {WorkspaceExport,WorkspaceExportArtifact} from '../workspaceExport';

type Preview=Pick<EpisodeProductionSnapshot,'artifacts'|'materialRevisions'|'shotPreparationDrafts'|'reviewPackages'>&{exportedVideo?:WorkspaceExportArtifact|null};
export function useWorkbenchPreview(episodeId:string,revision:string,enabled:boolean){
 const [result,setResult]=useState<{id:string;data:Partial<Preview>|null;error:boolean}>({id:'',data:null,error:false});
 useEffect(()=>{
  if(!enabled||!episodeId)return;
  const controller=new AbortController();
  void localRequest(`episodes/${encodeURIComponent(episodeId)}?known=${encodeURIComponent('{}')}`,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setResult(current=>({id:episodeId,data:{...(current.id===episodeId?current.data:null),...value.sections},error:false}));})
   .catch(()=>{if(!controller.signal.aborted)setResult(current=>({id:episodeId,data:current.id===episodeId?current.data:null,error:true}));});
  void localRequest(`episodes/${encodeURIComponent(episodeId)}/workspace`,{signal:controller.signal})
   .then(value=>{
    if(controller.signal.aborted)return;
    const exportedVideo=(value.workspace?.exports as WorkspaceExport[]|undefined)?.find(item=>item.status==='ready'&&item.artifact&&item.checks.every(check=>check.passed)&&artifactPreviewKind(item.artifact.relativePath)==='video')?.artifact??null;
    setResult(current=>({id:episodeId,data:{...(current.id===episodeId?current.data:null),exportedVideo},error:current.id===episodeId&&current.error}));
   }).catch(()=>{});
  return()=>controller.abort();
 },[episodeId,revision,enabled]);
 return result.id===episodeId?result:{id:episodeId,data:null,error:false};
}

export function WorkbenchArtwork({episodeId,title,artifacts=[],exportedVideo,error=false}:{episodeId:string;title:string;artifacts?:Preview['artifacts'];exportedVideo?:WorkspaceExportArtifact|null;error?:boolean}){
 const [failed,setFailed]=useState<string[]>([]);
 const [selection,setSelection]=useState({episodeId,video:false});
 const newest=[...artifacts].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const cover=newest.find(a=>a.artifact_type==='cover'&&artifactPreviewKind(a.relative_path)==='image');
 const video=newest.find(a=>a.artifact_type==='final_render'&&artifactPreviewKind(a.relative_path)==='video')
  ??newest.find(a=>['render','review_render','review_render_video'].includes(a.artifact_type)&&artifactPreviewKind(a.relative_path)==='video');
 const videoArtifact=exportedVideo??(video?{relativePath:video.relative_path,sha256:video.sha256}:null);
 const videoSource=videoArtifact?localArtifactUrl(episodeId,videoArtifact.relativePath,videoArtifact.sha256):null;
 const coverSource=cover?localArtifactUrl(episodeId,cover.relative_path,cover.sha256)
  :videoArtifact?localArtifactThumbnailUrl(episodeId,videoArtifact.relativePath,videoArtifact.sha256):null;
 const showingVideo=Boolean(videoSource&&selection.episodeId===episodeId&&selection.video);
 const source=showingVideo?videoSource:coverSource;
 const mediaFailed=Boolean(source&&failed.includes(source));
 return <div className={`work-artwork ${source&&!mediaFailed?'has-media':''}`}>
  {source&&!mediaFailed?(showingVideo?<WorkbenchVideoPlayer key={source} source={source} poster={coverSource??undefined} title={title}/>:<img src={source} alt={`${title}作品预览`} onError={()=>setFailed(current=>[...current,source])}/>):<><strong>{title}</strong><span>{error||mediaFailed?'预览暂不可用':'尚未生成封面'}</span></>}
  {videoSource&&<div className="work-artwork-navigation" role="group" aria-label="作品预览切换">
   <button type="button" aria-label="查看封面" disabled={!showingVideo} onClick={()=>setSelection({episodeId,video:false})}><ChevronLeft size={18} aria-hidden="true"/></button>
   <span className="sr-only" role="status">{showingVideo?'视频预览':'封面预览'}</span>
   <button type="button" aria-label="查看视频" disabled={showingVideo} onClick={()=>setSelection({episodeId,video:true})}><ChevronRight size={18} aria-hidden="true"/></button>
  </div>}
 </div>;
}
