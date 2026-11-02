import {useEffect,useImperativeHandle,useRef,type AudioHTMLAttributes,type Ref} from 'react';
import {I18nProvider} from '@videojs/react';
import {Audio,AudioPlayer,AudioSkin} from '@videojs/react/audio';
import '@videojs/react/i18n/locales/zh-CN/register';
import '@videojs/react/audio/skin.css';
import './media.css';

type AudioPreviewProps=Omit<AudioHTMLAttributes<HTMLAudioElement>,'controls'> & {ref?:Ref<HTMLAudioElement>;onPlaybackError?:(message:string)=>void};

/** Shared AudioSkin for local artifacts, uploaded drafts and generated voice samples. */
export function AudioPreview({ref,src,autoPlay=false,onPlaybackError,preload='metadata',...props}:AudioPreviewProps){
 const media=useRef<HTMLAudioElement>(null);
 useImperativeHandle(ref,()=>media.current!,[src]);
 useEffect(()=>{
  const element=media.current;let active=true;
  if(autoPlay&&element)void element.play().catch(error=>{if(active)onPlaybackError?.(error instanceof Error?error.message:'无法播放音频。');});
  return()=>{active=false;if(element&&!element.paused)element.pause();};
 },[src,autoPlay,onPlaybackError]);
 return <I18nProvider locale="zh-CN"><AudioPlayer key={src}><AudioSkin className="app-audio-player"><Audio ref={media} {...props} src={src} preload={preload}/></AudioSkin></AudioPlayer></I18nProvider>;
}
