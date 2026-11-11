import {uiText} from '../i18n/ui';
import {useEffect,useImperativeHandle,useRef,useState,type ComponentProps} from 'react';
import {Pause,Play,SlidersHorizontal} from 'lucide-react';
import {AudioPreview} from '../ui/media/AudioPreview';
import {useMediaLifecycle} from '../ui/media/useMediaLifecycle';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import './workspace-audio-audition.css';

/** One-click audition with the existing full player available on demand. */
export function WorkspaceAudioAudition({label,showControls=true,layout='compact',durationSeconds,...props}:ComponentProps<typeof AudioPreview>&{label:string;showControls?:boolean;layout?:'compact'|'bar';durationSeconds?:number}){
 const audio=useRef<HTMLAudioElement>(null),[playing,setPlaying]=useState(false),[error,setError]=useState('');
 const [time,setTime]=useState(0),[mediaDuration,setMediaDuration]=useState(0),seekAfterLoad=useRef<number|null>(null);
 const duration=mediaDuration||durationSeconds||0;
 useEffect(()=>{setTime(0);setMediaDuration(0);setPlaying(false);setError('');seekAfterLoad.current=null;},[props.src]);
 const format=(value:number)=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
 async function toggle(){if(!audio.current)return;if(playing){audio.current.pause();return;}setError('');try{if(audio.current.error)audio.current.load();await audio.current.play();}catch{setError(showControls?'音频暂时无法播放，可展开播放控制重试。':'音频暂时无法播放，请再次试听。');}}
 return <div className="workspace-audio-audition" data-layout={layout} data-media-visibility>
  <Button size="xs" color="secondary" iconLeading={playing?Pause:Play} aria-label={uiText("{value0} {value1}",{value0:String(playing?'暂停':'试听'),value1:String(label)})} title={playing?uiText("暂停"):uiText("播放")} onPress={()=>void toggle()}>{layout==='bar'?undefined:playing?uiText("暂停"):uiText("试听")}</Button>
  {layout==='bar'&&<><input className="workspace-audio-progress" type="range" min="0" max={duration||1} step="0.01" value={Math.min(time,duration||1)} disabled={!duration} aria-label={uiText("{value0} 播放进度",{value0:String(label)})} aria-valuetext={uiText("{value0} 秒，共 {value1} 秒",{value0:String(time.toFixed(2)),value1:String(duration.toFixed(2))})} onChange={event=>{const target=Number(event.target.value);setTime(target);if(!audio.current)return;if(audio.current.readyState===0){seekAfterLoad.current=target;audio.current.load();}else audio.current.currentTime=target;}}/><span className="workspace-audio-time" title={uiText("实际时长 {value0} 秒",{value0:String(duration.toFixed(2))})}>{format(time)} / {format(duration)}</span></>}
  {showControls?<details className="workspace-audio-player-details"><summary aria-label={uiText("展开 {value0} 播放控制",{value0:String(label)})} title={uiText("播放控制")}><SlidersHorizontal size={14}/></summary><div><AudioPreview {...props} ref={audio} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/></div></details>
   :<AuditionAudio {...props} ref={audio} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onTimeUpdate={event=>{setTime(event.currentTarget.currentTime);props.onTimeUpdate?.(event);}} onLoadedMetadata={event=>{const element=event.currentTarget;if(Number.isFinite(element.duration))setMediaDuration(element.duration);if(seekAfterLoad.current!==null){element.currentTime=Math.min(seekAfterLoad.current,element.duration);setTime(element.currentTime);seekAfterLoad.current=null;}props.onLoadedMetadata?.(event);}} onError={()=>{setPlaying(false);setError('音频暂时无法播放，请再次试听。');}}/>}
  {error&&<small role="alert">{uiText(error||'')}</small>}
 </div>;
}

/** Compact candidates use native media without mounting an expandable player. */
function AuditionAudio({ref,src,...props}:ComponentProps<'audio'>){
 const media=useRef<HTMLAudioElement>(null);
 useMediaLifecycle(media,String(src??''),String(src??''));
 useImperativeHandle(ref,()=>media.current!,[src]);
 return <audio {...props} ref={media} src={src}/>;
}
