import {PlayButton,MuteButton,VolumeSlider} from '@videojs/react';
import {Play,Pause,Volume2,VolumeX} from 'lucide-react';
import type {ReactNode,RefObject} from 'react';
import {uiText} from '../../i18n/ui';

/** Shared transport inside either VideoPlayer or AudioPlayer; all times are source seconds. */
export function MediaTransport({media,time,start=0,end,step=.01,timeLabel,playLabel,pauseLabel,progressLabel,disabled=false,onSeek,onPlaybackError,onPlaybackAttempt,children}:{media:RefObject<HTMLMediaElement|null>;time:number;start?:number;end:number;step?:number;timeLabel:string;playLabel:string;pauseLabel:string;progressLabel:string;disabled?:boolean;onSeek:(seconds:number)=>void;onPlaybackError?:(message:string)=>void;onPlaybackAttempt?:()=>void;children?:ReactNode}){
 async function toggle(){const element=media.current;if(!element)return;onPlaybackAttempt?.();try{if(element.paused)await element.play();else element.pause();}catch{onPlaybackError?.('音频暂时无法播放，请再次试听。');}}
 return <div className="app-media-transport">
  <PlayButton render={(button,state)=><button {...button} type="button" disabled={disabled} aria-label={state.paused?playLabel:pauseLabel} onClick={()=>void toggle()}>{state.paused?<Play size={16}/>:<Pause size={16}/>}</button>}/>
  <input className="app-media-progress" type="range" aria-label={progressLabel} aria-valuetext={`${Math.max(0,time-start).toFixed(2)} / ${Math.max(0,end-start).toFixed(2)} ${uiText('秒')}`} min={start} max={Math.max(start,end)} step={step} value={Math.max(start,Math.min(end,time))} disabled={disabled||end<=start} onChange={event=>onSeek(Number(event.target.value))}/>
  <span className="app-media-time">{timeLabel}</span>
  <MuteButton render={(button,state)=><button {...button} type="button" aria-label={uiText(state.muted?'取消静音':'静音')}>{state.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>}/>
  <VolumeSlider.Root className="app-media-volume"><VolumeSlider.Track className="app-media-volume-track"><VolumeSlider.Fill className="app-media-volume-fill"/></VolumeSlider.Track><VolumeSlider.Thumb className="app-media-volume-thumb" aria-label={uiText('音量')}/></VolumeSlider.Root>
  {children}
 </div>;
}
