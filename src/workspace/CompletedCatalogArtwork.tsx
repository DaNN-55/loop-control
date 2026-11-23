import {useEffect,useRef,useState} from 'react';
import {Image as ImageIcon} from 'lucide-react';
import {localRequest} from '../local-app/client';
import {localArtifactUrl} from '../reviews/localArtifactPreview';
import type {WorkspacePublication} from '../workspacePublication';
import {uiText} from '../i18n/ui';
import type {CatalogVideoMetadata} from './productionCatalogPreview';

type MediaFile={relativePath:string;sha256:string};
interface Props {
 episodeId:string;
 video?:MediaFile|null;
 legacyCover?:MediaFile|null;
 loading?:boolean;
 onVideoMetadata?:(value:CatalogVideoMetadata)=>void;
}

export function CompletedCatalogArtwork({episodeId,video,legacyCover,loading=false,onVideoMetadata}:Props){
 const [publication,setPublication]=useState<WorkspacePublication['cover']|undefined>();
 const [coverFailed,setCoverFailed]=useState<string|null>(null);
 const [videoState,setVideoState]=useState<{source:string;ready:boolean}|null>(null);
 const track=useRef<HTMLDivElement>(null),player=useRef<HTMLVideoElement>(null);
 const settle=useRef<ReturnType<typeof setTimeout>>(undefined);
 const [active,setActive]=useState<0|1>(0);
 const [announcement,setAnnouncement]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void localRequest(`episodes/${encodeURIComponent(episodeId)}/publication`,{signal:controller.signal})
   .then((value:WorkspacePublication)=>setPublication(value.cover??null))
   .catch(()=>{if(!controller.signal.aborted)setPublication(null);});
  return()=>controller.abort();
 },[episodeId]);
 useEffect(()=>()=>clearTimeout(settle.current),[]);

 const coverFile=publication?.file??legacyCover;
 const cover=coverFile&&localArtifactUrl(episodeId,coverFile.relativePath,coverFile.sha256);
 const source=video&&localArtifactUrl(episodeId,video.relativePath,video.sha256);
 const showCover=!!cover&&cover!==coverFailed;
 const showFrame=!showCover&&publication!==undefined&&!!source&&videoState?.source===source&&videoState.ready;
 const waiting=publication===undefined||loading||!!source&&videoState?.source!==source;
 const coverLabel=uiText(showCover?'交付封面':'成片首帧'),videoLabel=uiText('成片');
 function settleSlide(){
  clearTimeout(settle.current);
  settle.current=setTimeout(()=>{
   const element=track.current;
   if(!element?.clientWidth)return;
   const index=Math.abs(element.scrollLeft)>element.clientWidth/2?1:0;
   setActive(index);setAnnouncement(index?videoLabel:coverLabel);
   if(!index)player.current?.pause();
  },120);
 }
 function showSlide(index:0|1){
  const element=track.current;
  if(!element)return;
  const rtl=getComputedStyle(element).direction==='rtl';
  element.scrollTo({left:element.clientWidth*index*(rtl?-1:1)});
 }
 return <section className="production-completed-artwork" aria-label={uiText('封面与成片')}>
  <div className="production-completed-track" ref={track} onScroll={settleSlide}>
  <div className="production-completed-stage" role="group" aria-label={coverLabel}>
   {source&&<video key={source} src={source} muted playsInline hidden={!showFrame}
    aria-label={uiText('成片首帧')} preload={showCover||publication===undefined?'metadata':'auto'}
    onLoadedMetadata={({currentTarget:media})=>onVideoMetadata?.({width:media.videoWidth,height:media.videoHeight,duration:media.duration})}
    onLoadedData={()=>setVideoState({source,ready:true})} onError={()=>setVideoState({source,ready:false})}/>}
   {showCover&&<img src={cover} alt={uiText('交付封面')} onError={()=>setCoverFailed(cover)}/>}
   {!showCover&&!showFrame&&<div className="production-completed-empty"><ImageIcon size={20} aria-hidden="true"/><span>{uiText(waiting?'正在读取预览…':'预览暂不可用')}</span></div>}
  </div>
  {source&&<div className="production-completed-stage production-completed-playback" role="group" aria-label={videoLabel}>
   <video ref={player} src={source} controls playsInline preload="none" aria-label={videoLabel}
    onLoadedMetadata={({currentTarget:media})=>onVideoMetadata?.({width:media.videoWidth,height:media.videoHeight,duration:media.duration})}/>
  </div>}
  </div>
  {source?<div className="production-completed-media-switch" role="group" aria-label={uiText('封面与成片')}>
   <button type="button" aria-pressed={active===0} onClick={()=>showSlide(0)}>{coverLabel}</button>
   <button type="button" aria-pressed={active===1} onClick={()=>showSlide(1)}>{videoLabel}</button>
   <span className="sr-only" role="status">{announcement}</span>
  </div>:showCover&&<p className="production-preview-source">{coverLabel}</p>}
 </section>;
}
