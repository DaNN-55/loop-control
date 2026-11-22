import {useEffect,useState} from 'react';
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
 useEffect(()=>{
  const controller=new AbortController();
  void localRequest(`episodes/${encodeURIComponent(episodeId)}/publication`,{signal:controller.signal})
   .then((value:WorkspacePublication)=>setPublication(value.cover??null))
   .catch(()=>{if(!controller.signal.aborted)setPublication(null);});
  return()=>controller.abort();
 },[episodeId]);

 const coverFile=publication?.file??legacyCover;
 const cover=coverFile&&localArtifactUrl(episodeId,coverFile.relativePath,coverFile.sha256);
 const source=video&&localArtifactUrl(episodeId,video.relativePath,video.sha256);
 const showCover=!!cover&&cover!==coverFailed;
 const showFrame=!showCover&&publication!==undefined&&!!source&&videoState?.source===source&&videoState.ready;
 const waiting=publication===undefined||loading||!!source&&videoState?.source!==source;
 return <figure className="production-completed-artwork">
  <div className="production-completed-stage">
   {source&&<video key={source} src={source} muted playsInline hidden={!showFrame}
    aria-label={uiText('成片首帧')} preload={showCover||publication===undefined?'metadata':'auto'}
    onLoadedMetadata={({currentTarget:media})=>onVideoMetadata?.({width:media.videoWidth,height:media.videoHeight,duration:media.duration})}
    onLoadedData={()=>setVideoState({source,ready:true})} onError={()=>setVideoState({source,ready:false})}/>}
   {showCover&&<img src={cover} alt={uiText('交付封面')} onError={()=>setCoverFailed(cover)}/>}
   {!showCover&&!showFrame&&<div className="production-completed-empty"><ImageIcon size={20} aria-hidden="true"/><span>{uiText(waiting?'正在读取预览…':'预览暂不可用')}</span></div>}
  </div>
  {(showCover||showFrame)&&<figcaption>{uiText(showCover?'交付封面':'成片首帧')}</figcaption>}
 </figure>;
}
