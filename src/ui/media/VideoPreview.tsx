import {useCallback,useEffect,useRef,useState} from 'react';
import {Container,Controls,Gesture,Hotkey,I18nProvider,MuteButton,PlayButton,StatusAnnouncer,VolumeSlider} from '@videojs/react';
import {Video,VideoPlayer} from '@videojs/react/video';
import '@videojs/react/i18n/locales/zh-CN/register';
import {Download,Maximize,X,Pause,Play,Volume2,VolumeX} from 'lucide-react';
import {useDialogFocus} from '../useDialogFocus';
import {useMediaLifecycle} from './useMediaLifecycle';
import './media.css';

export interface VideoPreviewProps {
 src:string;title:string;poster?:string;className?:string;'aria-label'?:string;preload?:'none'|'metadata'|'auto';onError?:()=>void;
 downloadHref?:string;
 mediaRef?: {current:HTMLVideoElement|null}; onTimeChange?: (time:number)=>void; onDuration?: (duration:number)=>void;segment?:{start:number;end:number;frameDuration?:number};playbackRate?:number;sourceLabel?:string;
}
/** Host previews share controls; the native editor continues to own its timeline player. */
export function VideoPreview(props:VideoPreviewProps){
 return <VideoPreviewSource key={props.src} {...props}/>;
}
function VideoPreviewSource({src,title,poster,className,'aria-label':label,preload='metadata',onError,downloadHref,mediaRef,onTimeChange,onDuration,segment,playbackRate=1,sourceLabel='源视频'}:VideoPreviewProps){
 const media=useRef<HTMLVideoElement>(null),[attempt,retry]=useState(0),[whole,setWhole]=useState(false),[loading,setLoading]=useState(preload!=='none'),[failed,setFailed]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0);
 const attachMedia=useCallback((element:HTMLVideoElement|null)=>{media.current=element;if(mediaRef)mediaRef.current=element;},[mediaRef]);
 const [expanded,setExpanded]=useState(false);
 const [inlineSize,setInlineSize]=useState({width:0,height:0});
 const dialog=useDialogFocus(expanded,()=>setExpanded(false));
 useEffect(()=>{
  const player=dialog.current;
  if(expanded&&player?.showPopover&&!player.matches(':popover-open')){
   player.showPopover();
   player.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
  }
 },[expanded,dialog]);
 function openFocus(){
  if(!dialog.current)return;
  const {width,height}=dialog.current.getBoundingClientRect();
  setInlineSize({width,height});
  setExpanded(true);
 }
 const hasTrim=!!segment&&(segment.start>0||(duration>0&&duration-segment.end>0.001));
 const clipped=!!segment&&!whole&&(hasTrim||playbackRate!==1),start=clipped?segment.start:0,end=clipped?segment.end:duration,lastFrame=clipped?Math.max(start,end-(segment.frameDuration??0)):end;
 useEffect(()=>{if(!hasTrim)setWhole(false);},[hasTrim]);
 useMediaLifecycle(media,src+':'+attempt,src);
 useEffect(()=>{const element=media.current;if(!clipped||!element?.requestVideoFrameCallback)return;let callback=0;
  const check=()=>{if(!element.paused&&element.currentTime>=lastFrame){element.pause();element.currentTime=lastFrame;setTime(lastFrame);}callback=element.requestVideoFrameCallback(check);};
  callback=element.requestVideoFrameCallback(check);return()=>element.cancelVideoFrameCallback(callback);
 },[src,attempt,clipped,start,lastFrame]);
 const clipTime=Math.max(0,time-start)/playbackRate,clipDuration=(end-start)/playbackRate;
 const displayTime=clipped?`${hasTrim?'片段 ':''}${clipTime.toFixed(2)} / ${clipDuration.toFixed(2)}`:`${hasTrim?sourceLabel+' ':''}${time.toFixed(2)} / ${duration.toFixed(2)}`;
 const update=()=>{if(media.current){setTime(media.current.currentTime);onTimeChange?.(media.current.currentTime);}};
 const mode=()=>{const element=media.current;setWhole(!whole);if(element){element.pause();element.playbackRate=whole?playbackRate:1;if(whole&&segment)element.currentTime=segment.start;setTime(element.currentTime);}};
 return <>{expanded&&<div aria-hidden="true" className={className} style={inlineSize}/>}<I18nProvider locale="zh-CN"><VideoPlayer key={attempt}><Container ref={dialog} popover={expanded?"manual":undefined} data-expanded={expanded||undefined} role={expanded?"dialog":undefined} aria-modal={expanded||undefined} onKeyDown={event=>{if(expanded&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);}}} className={`app-video-player ${className??''}`} tabIndex={0} aria-label={`${title}播放器`}>
  {expanded&&<button className="media-focus-close" type="button" aria-label="关闭放大预览" data-dialog-initial-focus onClick={()=>setExpanded(false)}><X size={22}/></button>}
  {downloadHref&&<a className="app-video-download" href={downloadHref} download aria-label="下载视频" title="下载视频"><Download size={16} aria-hidden="true"/></a>}
  <Video ref={attachMedia} src={src} poster={poster} aria-label={label??`${title}视频预览`} preload={preload} playsInline
   onLoadStart={()=>{if(preload!=='none')setLoading(true);}} onWaiting={()=>setLoading(true)} onCanPlay={()=>setLoading(false)} onPlaying={()=>setLoading(false)}
   onError={()=>{setFailed(true);setLoading(false);onError?.();}}
   onLoadedMetadata={event=>{const player=event.currentTarget;setDuration(Number.isFinite(player.duration)?player.duration:0);if(Number.isFinite(player.duration))onDuration?.(player.duration);player.playbackRate=clipped?playbackRate:1;if(clipped)player.currentTime=start;setTime(player.currentTime);setLoading(false);}}
   onPlay={event=>{const player=event.currentTarget;player.playbackRate=clipped?playbackRate:1;if(clipped&&(player.currentTime<start||player.currentTime>=lastFrame))player.currentTime=start;update();}}
   onSeeking={event=>{const player=event.currentTarget;if(clipped&&(player.currentTime<start||player.currentTime>lastFrame))player.currentTime=Math.max(start,Math.min(lastFrame,player.currentTime));update();}}
   onTimeUpdate={event=>{const player=event.currentTarget;if(clipped&&player.currentTime>=lastFrame&&!player.paused){player.pause();player.currentTime=lastFrame;}update();}}/>
  {loading&&!failed&&<p className="app-media-feedback" role="status">正在加载视频…</p>}
  {failed&&<div className="app-media-feedback"><p role="alert">视频未能加载，请重试。</p><button type="button" onClick={()=>{setFailed(false);setLoading(true);retry(value=>value+1);}}>重试加载视频</button></div>}
  <Controls.Root visibility="always"><Controls.Content className="app-video-controls">
   <input className="app-video-progress" type="range" aria-label={hasTrim&&clipped?'片段进度':'视频进度'} aria-valuetext={`${displayTime} 秒`} min={start} max={Math.max(start,lastFrame)} step={segment?.frameDuration??0.01} value={Math.max(start,Math.min(lastFrame,time))} disabled={failed||end<=start} onChange={event=>{if(media.current){media.current.currentTime=Number(event.target.value);update();}}}/>
   <Controls.Group className="app-video-toolbar" aria-label="视频播放控制">
    <PlayButton render={(button,state)=><button {...button} aria-label={state.paused?'播放视频':'暂停视频'}>{state.paused?<Play size={16}/>:<Pause size={16}/>}</button>}/>
    <span className="app-video-time">{displayTime} s</span>
    {hasTrim&&<span className="app-video-range-context">{clipped?`${sourceLabel} ${time.toFixed(2)} / ${duration.toFixed(2)} s`:`当前片段 ${segment.start.toFixed(2)}–${segment.end.toFixed(2)} s`}</span>}
    {hasTrim&&<button className="app-video-range-toggle" type="button" onClick={mode}>{whole?'仅播放当前片段':`查看整段${sourceLabel}`}</button>}
    <MuteButton render={(button,state)=><button {...button} aria-label={state.muted?'取消静音':'静音'}>{state.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>}/>
    <VolumeSlider.Root className="app-video-volume"><VolumeSlider.Track className="app-video-volume-track"><VolumeSlider.Fill className="app-video-volume-fill"/></VolumeSlider.Track><VolumeSlider.Thumb className="app-video-volume-thumb" aria-label="音量"/></VolumeSlider.Root>
    <button type="button" aria-label="放大视频预览" hidden={expanded} onClick={openFocus}><Maximize size={16}/></button>
   </Controls.Group>
  </Controls.Content></Controls.Root>
  <Gesture type="tap" pointer="mouse" action="togglePaused"/>
  <Hotkey keys="Space" action="togglePaused"/><Hotkey keys="m" action="toggleMuted"/><Hotkey keys="ArrowLeft" action="seekStep" value={-5}/><Hotkey keys="ArrowRight" action="seekStep" value={5}/>
  <StatusAnnouncer className="sr-only"/>
 </Container></VideoPlayer></I18nProvider></>;
}
