import {useEffect,useRef,useState,type CSSProperties,type SyntheticEvent} from 'react';
import {ChevronLeft,ChevronRight,Image as ImageIcon} from 'lucide-react';
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
 const [coverAspect,setCoverAspect]=useState<{source:string;ratio:number}|null>(null);
 const [videoAspect,setVideoAspect]=useState<{source:string;ratio:number}|null>(null);
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
 const mediaAspect=source&&videoAspect?.source===source?videoAspect.ratio
  :showCover&&coverAspect?.source===cover?coverAspect.ratio:undefined;
 function readVideoMetadata({currentTarget:media}:SyntheticEvent<HTMLVideoElement>){
  const {videoWidth:width,videoHeight:height,duration}=media;
  if(source&&width>0&&height>0)setVideoAspect(previous=>previous?.source===source&&previous.ratio===width/height?previous:{source,ratio:width/height});
  onVideoMetadata?.({width,height,duration});
 }
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
  if(!element||index===active)return;
  const rtl=getComputedStyle(element).direction==='rtl';
  element.scrollTo({left:element.clientWidth*index*(rtl?-1:1)});
 }
 return <section className="production-completed-artwork"
  style={mediaAspect?{'--completed-media-ratio':mediaAspect} as CSSProperties:undefined} aria-label={uiText('封面与成片')}>
  <div className="production-completed-viewport">
  {source&&<div className="production-completed-arrows" role="group" aria-label={uiText('封面与成片')}>
   <button type="button" aria-label={uiText('查看封面')} aria-disabled={active===0} onClick={()=>showSlide(0)}><ChevronLeft aria-hidden="true"/></button>
   <button type="button" aria-label={uiText('查看视频')} aria-disabled={active===1} onClick={()=>showSlide(1)}><ChevronRight aria-hidden="true"/></button>
  </div>}
  <div className="production-completed-track" ref={track} onScroll={settleSlide}>
  <div className="production-completed-stage" role="group" aria-label={coverLabel}>
   {source&&<video key={source} src={source} muted playsInline hidden={!showFrame}
    aria-label={uiText('成片首帧')} preload={showCover||publication===undefined?'metadata':'auto'}
    onLoadedMetadata={readVideoMetadata}
    onLoadedData={()=>setVideoState({source,ready:true})} onError={()=>setVideoState({source,ready:false})}/>}
   {showCover&&<img src={cover} alt={uiText('交付封面')} onError={()=>setCoverFailed(cover)}
    onLoad={({currentTarget:{naturalWidth,naturalHeight}})=>{if(naturalWidth>0&&naturalHeight>0)setCoverAspect({source:cover,ratio:naturalWidth/naturalHeight});}}/>}
   {!showCover&&!showFrame&&<div className="production-completed-empty"><ImageIcon size={20} aria-hidden="true"/><span>{uiText(waiting?'正在读取预览…':'预览暂不可用')}</span></div>}
  </div>
  {source&&<div className="production-completed-stage production-completed-playback" role="group" aria-label={videoLabel}>
   <video ref={player} src={source} controls playsInline preload="none" aria-label={videoLabel}
    onLoadedMetadata={readVideoMetadata}/>
  </div>}
  </div>
  </div>
  {source?<span className="sr-only" role="status">{announcement}</span>:showCover&&<p className="production-preview-source">{coverLabel}</p>}
 </section>;
}
