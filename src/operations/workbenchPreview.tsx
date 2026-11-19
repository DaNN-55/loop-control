import {uiText} from '../i18n/ui';
import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {ImagePreview} from '../ui/media/ImagePreview';
import {WorkbenchVideoPlayer} from './WorkbenchVideoPlayer';
import {localRequest} from '../local-app/client';
import {artifactPreviewKind,localArtifactUrl,localArtifactThumbnailUrl} from '../reviews/localArtifactPreview';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import type {WorkspaceExport,WorkspaceExportArtifact} from '../workspaceExport';

type Preview=Pick<EpisodeProductionSnapshot,'artifacts'|'materialRevisions'|'shotPreparationDrafts'|'reviewPackages'>&{exportedVideo?:WorkspaceExportArtifact|null;sourceText?:string;hasScript?:boolean};
export function useWorkbenchPreview(episodeId:string,revision:string,enabled:boolean){
 const [result,setResult]=useState<{id:string;data:Partial<Preview>|null;error:boolean}>({id:'',data:null,error:false});
 useEffect(()=>{
  if(!enabled||!episodeId)return;
  const controller=new AbortController();
  const requestedScripts=new Set<string>();
  function readScript(revisionId:string){
   if(!revisionId||requestedScripts.has(revisionId))return;
   requestedScripts.add(revisionId);
   void localRequest('script-studio?episodeId='+encodeURIComponent(episodeId)+'&scriptRevisionId='+encodeURIComponent(revisionId),{signal:controller.signal}).then(value=>{
    if(!controller.signal.aborted&&typeof value.sourceText==='string')setResult(current=>({id:episodeId,data:{...(current.id===episodeId?current.data:null),sourceText:value.sourceText,hasScript:true},error:current.id===episodeId&&current.error}));
   }).catch(()=>{});
  }
  void localRequest(`episodes/${encodeURIComponent(episodeId)}?known=${encodeURIComponent('{}')}`,{signal:controller.signal})
   .then(value=>{
    if(controller.signal.aborted)return;
    const script=(value.sections?.materialRevisions as Preview['materialRevisions'])?.filter(item=>item.is_main_script).sort((a,b)=>b.revision_number-a.revision_number)[0];
    setResult(current=>({id:episodeId,data:{...(current.id===episodeId?current.data:null),...value.sections,hasScript:!!script||current.id===episodeId&&!!current.data?.hasScript},error:false}));
    if(script)readScript(script.id);
   })
   .catch(()=>{if(!controller.signal.aborted)setResult(current=>({id:episodeId,data:current.id===episodeId?current.data:null,error:true}));});
  void localRequest(`episodes/${encodeURIComponent(episodeId)}/workspace`,{signal:controller.signal})
   .then(value=>{
    if(controller.signal.aborted)return;
    if(value.workspace?.scriptRevisionId)readScript(value.workspace.scriptRevisionId);
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
  {source&&!mediaFailed?(showingVideo?<WorkbenchVideoPlayer key={source} source={source} poster={coverSource??undefined} title={title}/>:<ImagePreview src={source} alt={uiText("{value0}作品预览",{value0:String(title)})} onError={()=>setFailed(current=>[...current,source])}/>):<><strong>{title}</strong><span>{error||mediaFailed?uiText("预览暂不可用"):uiText("尚未生成封面")}</span></>}
  {videoSource&&<div className="work-artwork-navigation" role="group" aria-label={uiText("作品预览切换")}>
   <button type="button" aria-label={uiText("查看封面")} disabled={!showingVideo} onClick={()=>setSelection({episodeId,video:false})}><ChevronLeft size={18} aria-hidden="true"/></button>
   <span className="sr-only" role="status">{showingVideo?uiText("视频预览"):uiText("封面预览")}</span>
   <button type="button" aria-label={uiText("查看视频")} disabled={showingVideo} onClick={()=>setSelection({episodeId,video:true})}><ChevronRight size={18} aria-hidden="true"/></button>
  </div>}
 </div>;
}
