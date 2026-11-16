import {useEffect,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {workspaceShotSource} from './WorkspaceShotPreview';
import {completedArtifactUrl} from './completedWorkspaceView';

/** Decode only visible rows; thumbnails never mount editor or playback controls. */
export function CompletedShotThumbnail({workspace:w,project,itemId}:{workspace:ProductionWorkspace;project:OpenChatCutProject|null;itemId:string}){
 const container=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false);
 const clip=w.clips.find(c=>c.itemId===itemId),source=clip?workspaceShotSource(clip,project):null;
 const timeline=project?.timelines.find(t=>t.items.some(i=>i.id===itemId)),item=timeline?.items.find(i=>i.id===itemId);
 const url=source?completedArtifactUrl(w,source):null;
 useEffect(()=>{setFailed(false);},[url]);
 useEffect(()=>{
  if(!container.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'80px'});observer.observe(container.current);return()=>observer.disconnect();
 },[]);
 return <span ref={container} className="completed-shot-thumbnail" aria-hidden="true">{visible&&url&&!failed&&(source?.kind==='image'?<img loading="lazy" src={url} alt="" onError={()=>setFailed(true)}/>:<video key={url} src={url} muted playsInline preload="metadata" onError={()=>setFailed(true)} onLoadedMetadata={e=>{e.currentTarget.currentTime=Number(item?.srcInFrame??0)/(timeline?.fps??30);}}/>)}</span>;
}
