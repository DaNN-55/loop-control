import {useEffect,useState} from 'react';
import {localRequest} from '../local-app/client';
import {artifactPreviewKind,localArtifactUrl} from '../reviews/localArtifactPreview';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';

type Preview=Pick<EpisodeProductionSnapshot,'artifacts'|'materialRevisions'|'shotPreparationDrafts'|'reviewPackages'>;
export function useWorkbenchPreview(episodeId:string,revision:string,enabled:boolean){
 const [result,setResult]=useState<{id:string;data:Partial<Preview>|null;error:boolean}>({id:'',data:null,error:false});
 useEffect(()=>{
  if(!enabled||!episodeId)return;
  const controller=new AbortController();
  void localRequest(`episodes/${encodeURIComponent(episodeId)}?known=${encodeURIComponent('{}')}`,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setResult({id:episodeId,data:value.sections??null,error:false});})
   .catch(()=>{if(!controller.signal.aborted)setResult({id:episodeId,data:null,error:true});});
  return()=>controller.abort();
 },[episodeId,revision,enabled]);
 return result.id===episodeId?result:{id:episodeId,data:null,error:false};
}

export function WorkbenchArtwork({episodeId,title,artifacts=[],error=false}:{episodeId:string;title:string;artifacts?:Preview['artifacts'];error?:boolean}){
 const [failed,setFailed]=useState('');
 // Prefer the actual publication cover, then a frame from the most recent render.
 const newest=[...artifacts].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const artifact=newest.find(a=>a.artifact_type==='cover'&&artifactPreviewKind(a.relative_path)==='image')
  ??newest.find(a=>['final_render','render','review_render','review_render_video'].includes(a.artifact_type)&&artifactPreviewKind(a.relative_path)==='video');
 const source=artifact?localArtifactUrl(episodeId,artifact.relative_path,artifact.sha256):null;
 return <div className={`work-artwork ${source&&failed!==source?'has-media':''}`}>
  {source&&failed!==source?(artifactPreviewKind(artifact!.relative_path)==='video'?<video src={source+'#t=0.1'} aria-label={`${title}作品预览`} preload="metadata" muted playsInline onError={()=>setFailed(source)}/>:<img src={source} alt={`${title}作品预览`} onError={()=>setFailed(source)}/>):<><strong>{title}</strong><span>{error||failed===source?'预览暂不可用':'尚未生成封面'}</span></>}
 </div>;
}
