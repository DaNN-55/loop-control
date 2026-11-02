import {useEffect,useRef,useState} from 'react';
import {Container,Controls,FullscreenButton,Gesture,Hotkey,I18nProvider,MuteButton,PlayButton,StatusAnnouncer,Time,TimeSlider,VolumeSlider} from '@videojs/react';
import {Video,VideoPlayer} from '@videojs/react/video';
import '@videojs/react/i18n/locales/zh-CN/register';
import {Maximize,Minimize,Pause,Play,Volume2,VolumeX} from 'lucide-react';

export function WorkbenchVideoPlayer({source,poster,title,onError,segment}:{source:string;poster?:string;title:string;onError:()=>void;segment?:{start:number;end:number;frameDuration?:number}}){
 const media=useRef<HTMLVideoElement>(null);
 const [touchControls,setTouchControls]=useState(false);
 const lastFrame=segment?Math.max(segment.start,segment.end-(segment.frameDuration??1/30)):0;
 useEffect(()=>{const element=media.current;return()=>{element?.pause();};},[source]);
 useEffect(()=>{const element=media.current;if(!segment||!element?.requestVideoFrameCallback)return;let callback=0;
  const check=()=>{if(!element.paused&&element.currentTime>=lastFrame){element.pause();element.currentTime=lastFrame;}callback=element.requestVideoFrameCallback(check);};
  callback=element.requestVideoFrameCallback(check);return()=>element.cancelVideoFrameCallback(callback);
 },[source,segment?.start,segment?.end,lastFrame]);
 return <I18nProvider locale="zh-CN"><VideoPlayer><Container className="work-video-player" tabIndex={0} aria-label={`${title}播放器`} data-touch-controls={touchControls||undefined} onPointerUp={event=>{
  if(event.pointerType==='touch'&&!(event.target as Element).closest('button,[role="slider"]'))setTouchControls(current=>!current);
 }}>
  <Video ref={media} src={source} poster={poster} aria-label={`${title}视频预览`} preload="metadata" playsInline onError={onError}
   onLoadedMetadata={event=>{if(segment)event.currentTarget.currentTime=segment.start;}}
   onPlay={event=>{const player=event.currentTarget;if(segment&&(player.currentTime<segment.start||player.currentTime>=lastFrame))player.currentTime=segment.start;}}
   onSeeking={event=>{const player=event.currentTarget;if(segment&&(player.currentTime<segment.start||player.currentTime>lastFrame))player.currentTime=Math.max(segment.start,Math.min(lastFrame,player.currentTime));}}
   onTimeUpdate={event=>{const player=event.currentTarget;if(segment&&player.currentTime>=lastFrame&&!player.paused){player.pause();player.currentTime=lastFrame;}}}/>
  {/* Visibility follows hover/focus rather than playback, including while paused. */}
  <Controls.Root visibility="always"><Controls.Content className="work-video-controls">
   <TimeSlider.Root className="work-video-timeline"><TimeSlider.Track className="work-video-track"><TimeSlider.Buffer className="work-video-buffer"/><TimeSlider.Fill className="work-video-fill"/></TimeSlider.Track><TimeSlider.Thumb className="work-video-thumb" aria-label="视频进度"/></TimeSlider.Root>
   <Controls.Group className="work-video-toolbar" aria-label="视频播放控制">
    <PlayButton render={(props,state)=><button {...props} aria-label={state.paused?'播放视频':'暂停视频'}>{state.paused?<Play size={16}/>:<Pause size={16}/>}</button>}/>
    <span className="work-video-time"><Time.Value type="current"/> / <Time.Value type="duration"/></span>
    <MuteButton render={(props,state)=><button {...props} aria-label={state.muted?'取消静音':'静音'}>{state.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>}/>
    <VolumeSlider.Root className="work-video-volume"><VolumeSlider.Track className="work-video-track"><VolumeSlider.Fill className="work-video-fill"/></VolumeSlider.Track><VolumeSlider.Thumb className="work-video-thumb" aria-label="音量"/></VolumeSlider.Root>
    <FullscreenButton render={(props,state)=><button {...props} aria-label={state.fullscreen?'退出全屏':'全屏播放'}>{state.fullscreen?<Minimize size={16}/>:<Maximize size={16}/>}</button>}/>
   </Controls.Group>
  </Controls.Content></Controls.Root>
  <Gesture type="tap" pointer="mouse" action="togglePaused"/>
  <Hotkey keys="Space" action="togglePaused"/><Hotkey keys="m" action="toggleMuted"/><Hotkey keys="f" action="toggleFullscreen"/>
  <StatusAnnouncer/>
 </Container></VideoPlayer></I18nProvider>;
}
