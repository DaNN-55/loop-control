import {useEffect,useImperativeHandle,useRef,useState,type AudioHTMLAttributes,type Ref} from 'react';
import {I18nProvider} from '@videojs/react';
import {Audio,AudioPlayer,AudioSkin} from '@videojs/react/audio';
import '@videojs/react/i18n/locales/zh-CN/register';
import '@videojs/react/audio/skin.css';
import {useMediaLifecycle} from './useMediaLifecycle';
import './media.css';

type AudioPreviewProps=Omit<AudioHTMLAttributes<HTMLAudioElement>,'controls'> & {ref?:Ref<HTMLAudioElement>;onPlaybackError?:(message:string)=>void};

/** Shared AudioSkin for local artifacts, uploaded drafts and generated voice samples. */
export function AudioPreview({ref,src,autoPlay=false,onPlaybackError,preload='metadata',onError,onLoadStart,onLoadedMetadata,onWaiting,onCanPlay,onPlaying,...props}:AudioPreviewProps){
 const media=useRef<HTMLAudioElement>(null),[attempt,retry]=useState(0),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 useMediaLifecycle(media,String(src)+':'+attempt,String(src??''));
 useEffect(()=>{setFailed(false);setLoading(false);},[src]);
 useImperativeHandle(ref,()=>media.current!,[src,attempt]);
 useEffect(()=>{
  const element=media.current;let active=true;
  if(autoPlay&&element)void element.play().catch(error=>{if(active)onPlaybackError?.(error instanceof Error?error.message:'无法播放音频。');});
  return()=>{active=false;if(element&&!element.paused)element.pause();};
 },[src,autoPlay,onPlaybackError,attempt]);
 return <I18nProvider locale="zh-CN"><AudioPlayer key={String(src)+attempt}><AudioSkin className="app-audio-player"><Audio ref={media} {...props} src={src} preload={preload}
  onLoadStart={event=>{if(preload!=='none')setLoading(true);onLoadStart?.(event);}}
  onLoadedMetadata={event=>{setLoading(false);onLoadedMetadata?.(event);}}
  onWaiting={event=>{setLoading(true);onWaiting?.(event);}}
  onCanPlay={event=>{setLoading(false);onCanPlay?.(event);}}
  onPlaying={event=>{setLoading(false);onPlaying?.(event);}}
  onError={event=>{setFailed(true);setLoading(false);onError?.(event);onPlaybackError?.('音频未能加载，请重试。');}}/></AudioSkin>{loading&&!failed&&<p className="app-media-feedback" role="status">正在加载音频…</p>}{failed&&<div className="app-media-feedback"><p role="alert">音频未能加载，请重试。</p><button type="button" onClick={()=>{setFailed(false);setLoading(true);retry(value=>value+1);}}>重试加载音频</button></div>}</AudioPlayer></I18nProvider>;
}
