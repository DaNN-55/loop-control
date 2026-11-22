import {uiText} from '../../i18n/ui';
import {useEffect,useImperativeHandle,useRef,useState,type AudioHTMLAttributes,type Ref} from 'react';
import {Container,I18nProvider} from '@videojs/react';
import {Audio,AudioPlayer} from '@videojs/react/audio';
import '@videojs/react/i18n/locales/zh-CN/register';
import {useMediaLifecycle} from './useMediaLifecycle';
import {MediaTransport} from './MediaTransport';
import './media.css';

type AudioPreviewProps=Omit<AudioHTMLAttributes<HTMLAudioElement>,'controls'> & {ref?:Ref<HTMLAudioElement>;onPlaybackError?:(message:string)=>void;durationSeconds?:number;playLabel?:string;pauseLabel?:string;progressLabel?:string;segment?:{start:number;end:number};playbackRate?:number};

/** Shared transport for local artifacts, uploaded drafts and generated voice samples. */
export function AudioPreview({ref,src,autoPlay=false,onPlaybackError,preload='metadata',durationSeconds=0,playLabel='播放',pauseLabel='暂停',progressLabel='音频进度',segment,playbackRate=1,onError,onLoadStart,onLoadedMetadata,onWaiting,onCanPlay,onPlaying,onTimeUpdate,onPlay,onPause,onEnded,...props}:AudioPreviewProps){
 const media=useRef<HTMLAudioElement>(null),[attempt,retry]=useState(0),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[playError,setPlayError]=useState('');
 const pendingSeek=useRef<number|null>(null),end=segment?.end??(duration||durationSeconds),start=segment?.start??0;
 const format=(value:number)=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
 const bound=()=>{const element=media.current;if(!element)return;if(segment&&element.currentTime>=segment.end){element.pause();element.currentTime=segment.end;}else if(segment&&element.currentTime<segment.start)element.currentTime=segment.start;setTime(element.currentTime);};
 useEffect(()=>{if(!playing||!segment)return;const timer=setInterval(bound,30);return()=>clearInterval(timer);},[playing,segment?.start,segment?.end]);
 function seek(seconds:number){setTime(seconds);if(!media.current)return;if(media.current.readyState===0){pendingSeek.current=seconds;media.current.load();}else media.current.currentTime=seconds;}
 useMediaLifecycle(media,String(src)+':'+attempt,String(src??''));
 useEffect(()=>{setFailed(false);setLoading(false);setTime(0);setDuration(0);setPlaying(false);setPlayError('');pendingSeek.current=null;},[src]);
 useImperativeHandle(ref,()=>media.current!,[src,attempt]);
 useEffect(()=>{
  const element=media.current;let active=true;
  if(autoPlay&&element)void element.play().catch(error=>{if(active)onPlaybackError?.(error instanceof Error?error.message:'无法播放音频。');});
  return()=>{active=false;if(element&&!element.paused)element.pause();};
 },[src,autoPlay,onPlaybackError,attempt]);
 return <I18nProvider locale="zh-CN"><AudioPlayer key={String(src)+attempt}><Container className="app-audio-player" data-media-visibility><Audio ref={media} {...props} src={src} preload={preload}
  onLoadStart={event=>{if(preload!=='none')setLoading(true);onLoadStart?.(event);}}
  onLoadedMetadata={event=>{setLoading(false);const element=event.currentTarget;if(Number.isFinite(element.duration))setDuration(element.duration);element.playbackRate=playbackRate;if(pendingSeek.current!==null||segment){element.currentTime=pendingSeek.current??start;pendingSeek.current=null;}setTime(element.currentTime);onLoadedMetadata?.(event);}}
  onWaiting={event=>{setLoading(true);onWaiting?.(event);}}
  onCanPlay={event=>{setLoading(false);onCanPlay?.(event);}}
  onPlaying={event=>{setLoading(false);onPlaying?.(event);}}
  onTimeUpdate={event=>{bound();onTimeUpdate?.(event);}}
  onPlay={event=>{setPlaying(true);setPlayError('');event.currentTarget.playbackRate=playbackRate;if(segment&&(event.currentTarget.currentTime<start||event.currentTarget.currentTime>=end))event.currentTarget.currentTime=start;onPlay?.(event);}}
  onPause={event=>{setPlaying(false);onPause?.(event);}} onEnded={event=>{setPlaying(false);onEnded?.(event);}}
  onError={event=>{setFailed(true);setLoading(false);onError?.(event);onPlaybackError?.('音频未能加载，请重试。');}}/>
  <MediaTransport media={media} time={time} start={start} end={end} timeLabel={`${format(Math.max(0,time-start)/playbackRate)} / ${format(Math.max(0,end-start)/playbackRate)}`} playLabel={playLabel} pauseLabel={pauseLabel} progressLabel={progressLabel} disabled={failed} onSeek={seek} onPlaybackAttempt={()=>setPlayError('')} onPlaybackError={message=>{setPlayError(message);onPlaybackError?.(message);}}/>
  {playError&&<p className="app-media-feedback" role="alert">{uiText(playError)}</p>}
  </Container>{loading&&!failed&&<p className="app-media-feedback" role="status">{uiText("正在加载音频…")}</p>}{failed&&<div className="app-media-feedback"><p role="alert">{uiText("音频未能加载，请重试。")}</p><button type="button" onClick={()=>{setFailed(false);setLoading(true);retry(value=>value+1);}}>{uiText("重试加载音频")}</button></div>}</AudioPlayer></I18nProvider>;
}
