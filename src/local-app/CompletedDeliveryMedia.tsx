import {useRef,useState,type CSSProperties,type ReactNode,type RefObject} from 'react';
import {Play} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {ImagePreview} from '../ui/media/ImagePreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';

interface Props {
 coverUrl:string|null;
 video:ReactNode;
 player:RefObject<HTMLVideoElement|null>;
 canPlay:boolean;
 mediaStyle:CSSProperties;
}

export function CompletedDeliveryMedia({coverUrl,video,player,canPlay,mediaStyle}:Props){
 const [view,setView]=useState<'cover'|'video'>('cover');
 const [failedCover,setFailedCover]=useState<string|null>(null);
 const videoControl=useRef<HTMLButtonElement>(null);
 const hasCover=!!coverUrl&&coverUrl!==failedCover;
 const showingCover=hasCover&&view==='cover';

 function showCover(){
  player.current?.pause();
  setView('cover');
 }
 function play(){
  setView('video');
  videoControl.current?.focus();
  void player.current?.play().catch(()=>{/* The player remains available for manual playback. */});
 }

 return <>
  {hasCover&&<div className="completed-delivery-switch" role="group" aria-label={uiText('封面与成片')}>
   <button type="button" aria-pressed={showingCover} onClick={showCover}>{uiText('封面')}</button>
   <button ref={videoControl} type="button" aria-pressed={!showingCover} onClick={()=>setView('video')}>{uiText('成片')}</button>
  </div>}
  {showingCover&&<div className="workspace-final-media completed-delivery-cover" style={mediaStyle}>
   <ImagePreview src={coverUrl} alt={uiText('交付封面')} onError={()=>setFailedCover(coverUrl)}/>
   <div className="completed-delivery-cover-actions">
    {canPlay&&<Button type="button" size="sm" color="secondary" iconLeading={Play} onPress={play}>{uiText('播放成片')}</Button>}
    <a className="workspace-cover-download" href={coverUrl+'&download=1'} download>{uiText('下载封面')}</a>
   </div>
  </div>}
  <div className="completed-delivery-video" hidden={showingCover}>{video}</div>
 </>;
}
