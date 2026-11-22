import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Container,I18nProvider,PlayButton,MuteButton,VolumeSlider} from '@videojs/react';
import {Video,VideoPlayer} from '@videojs/react/video';
import {Audio,AudioPlayer} from '@videojs/react/audio';
import {Slider,SliderTrack,SliderThumb} from 'react-aria-components';
import {Play,Pause,Volume2,VolumeX,Maximize,Scissors,RotateCcw,Image as ImageIcon,Music2,Film} from 'lucide-react';
import 'media-chrome/dist/lang/zh-CN.js';
import {setLanguage} from 'media-chrome/dist/utils/i18n.js';
import {MediaController,MediaControlBar,MediaPlayButton,MediaTimeRange,MediaTimeDisplay,MediaMuteButton,MediaVolumeRange,MediaFullscreenButton} from 'media-chrome/react';
import {VideoPreview} from '../../../src/ui/media/VideoPreview';
import {ImagePreview} from '../../../src/ui/media/ImagePreview';
import {AudioPreview} from '../../../src/ui/media/AudioPreview';
import {WorkspaceAudioAudition} from '../../../src/local-app/WorkspaceAudioAudition';
import '../../../src/ui/dan-ui/styles/scoped.css';
import './demo.css';
import assets from './assets.json';

setLanguage('zh-CN');
const duration=8,format=(n:number)=>`0:${n.toFixed(2).padStart(5,'0')}`;
type MediaRef={current:HTMLMediaElement|null};
function Transport({media,time,total,kind}:{media:MediaRef;time:number;total:number;kind:'video'|'audio'}){
 return <div className="matched-controls">
  <PlayButton render={(props,state)=><button {...props} aria-label={state.paused?'播放':'暂停'}>{state.paused?<Play size={17}/>:<Pause size={17}/>}</button>}/>
  <input aria-label="播放进度" type="range" min={0} max={total||duration} step={.01} value={Math.min(time,total||duration)} onChange={e=>{if(media.current)media.current.currentTime=Number(e.target.value);}}/>
  <output className="time">{format(time)} / {format(total||duration)}</output>
  <MuteButton render={(props,state)=><button {...props} aria-label={state.muted?'取消静音':'静音'}>{state.muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>}/>
  <VolumeSlider.Root className="matched-volume"><VolumeSlider.Track className="matched-volume-track"><VolumeSlider.Fill className="matched-volume-fill"/></VolumeSlider.Track><VolumeSlider.Thumb aria-label="音量" className="matched-volume-thumb"/></VolumeSlider.Root>
  {kind==='video'&&<button aria-label="全屏视频" onClick={()=>void media.current?.parentElement?.requestFullscreen()}><Maximize size={17}/></button>}
 </div>;
}
function SuitePlayer({kind,suite,media,onTime,onDuration,onPause}:{kind:'video'|'audio';suite:'a'|'b';media:MediaRef;onTime:(n:number)=>void;onDuration:(n:number)=>void;onPause:()=>void}){
 const [time,setTime]=useState(0),[total,setTotal]=useState(duration),[error,setError]=useState('');
 const events={onPause,onTimeUpdate:(e:React.SyntheticEvent<HTMLMediaElement>)=>{setTime(e.currentTarget.currentTime);onTime(e.currentTarget.currentTime);},onLoadedMetadata:(e:React.SyntheticEvent<HTMLMediaElement>)=>{setTotal(e.currentTarget.duration);onDuration(e.currentTarget.duration);},onError:()=>setError('演示素材未能加载，请刷新重试。')};
 useEffect(()=>()=>media.current?.pause(),[suite,kind]);
 const src=kind==='video'?assets.video:assets.audio;
 if(suite==='b')return <><MediaController ref={controller=>{controller?.setAttribute('aria-label',kind==='audio'?'音频播放器':'视频播放器');}} aria-label={kind==='audio'?'音频播放器':'视频播放器'} audio={kind==='audio'} className={`chrome-player ${kind==='audio'?'chrome-audio':''}`} autohide={-1}>
  {kind==='video'?<video ref={e=>{media.current=e;}} {...events} slot="media" src={src} poster={assets.image} width={640} height={360} preload="metadata" playsInline/>:<audio ref={e=>{media.current=e;}} {...events} slot="media" src={src} preload="none"/>}
  <MediaControlBar><MediaPlayButton/><MediaTimeRange/><MediaTimeDisplay showDuration/><MediaMuteButton/><MediaVolumeRange/>{kind==='video'&&<MediaFullscreenButton/>}</MediaControlBar>
 </MediaController>{error&&<p role="alert">{error}</p>}</>;
 const Player=kind==='video'?VideoPlayer:AudioPlayer;
 return <I18nProvider locale="zh-CN"><Player><Container className={`matched-player ${kind==='audio'?'matched-audio':''}`}>
  {kind==='video'?<Video ref={e=>{media.current=e;}} {...events} src={src} poster={assets.image} width={640} height={360} preload="metadata" playsInline/>:<Audio ref={e=>{media.current=e;}} {...events} src={src} preload="none"/>}
  <Transport kind={kind} media={media} time={time} total={total}/>
 </Container>{error&&<p role="alert">{error}</p>}</Player></I18nProvider>;
}
function SelectedMedia({kind,suite}:{kind:'video'|'audio';suite:'a'|'b'}){
 const media=useRef<HTMLMediaElement|null>(null),[range,setRange]=useState([1,6]),[time,setTime]=useState(0),[total,setTotal]=useState(duration),[preview,setPreview]=useState(false),[error,setError]=useState('');
 const active=useRef(false),currentRange=useRef(range);currentRange.current=range;
 useEffect(()=>{const element=media.current;if(!element)return;const check=()=>{if(active.current&&element.currentTime>=currentRange.current[1]){element.pause();element.currentTime=currentRange.current[1];active.current=false;setPreview(false);}};const timer=setInterval(check,40);return()=>{clearInterval(timer);element.pause();};},[suite]);
 function change(next:number[]){if(next[1]-next[0]<.1)return;active.current=false;setPreview(false);media.current?.pause();const index=next[0]!==range[0]?0:1;setRange(next);if(media.current)media.current.currentTime=Math.min(next[index],total-.01);}
 async function playSelection(){const element=media.current;if(!element)return;setError('');try{element.currentTime=range[0];active.current=true;await element.play();setPreview(true);}catch{active.current=false;setError('播放未能开始，请再试一次。');}}
 return <><SuitePlayer kind={kind} suite={suite} media={media} onDuration={setTotal} onTime={setTime} onPause={()=>{active.current=false;setPreview(false);}}/>
  <div className="trim-editor"><div className="trim-heading"><span><Scissors size={14}/>拖动两端，选取使用片段</span><button className="subtle" onClick={()=>change([0,total])}><RotateCcw size={13}/>重置</button></div>
   <Slider aria-label={kind==='video'?'视频使用范围':'音频使用范围'} minValue={0} maxValue={total} step={.05} value={range} onChange={v=>change(v as number[])}>
    <SliderTrack className={`trim-track ${kind==='audio'?'wave-track':''}`} style={{backgroundImage:`url(${kind==='audio'?assets.wave:assets.filmstrip})`}}>
     <div className="trim-before" style={{width:`${range[0]/total*100}%`}}/><div className="trim-after" style={{width:`${(total-range[1])/total*100}%`}}/>
     <div className="trim-selection" style={{left:`${range[0]/total*100}%`,width:`${(range[1]-range[0])/total*100}%`}}/>
     <div className="playhead" style={{left:`${Math.min(time,total)/total*100}%`}}/>
     <SliderThumb index={0} aria-label={kind==='video'?'视频起点':'音频起点'} className="trim-thumb"/><SliderThumb index={1} aria-label={kind==='video'?'视频终点':'音频终点'} className="trim-thumb"/>
    </SliderTrack>
   </Slider>
   <div className="trim-footer"><span>使用 {format(range[0])} — {format(range[1])}<b>共 {(range[1]-range[0]).toFixed(2)} 秒</b></span><button className="primary" onClick={()=>preview?(media.current?.pause(),active.current=false,setPreview(false)):void playSelection()}>{preview?<Pause size={13}/>:<Play size={13}/>}{preview?(kind==='video'?'停止预览':'停止试听'):'播放选区'}</button></div>
   <details className="fine-tune"><summary>精确时间</summary><div>{['起点','终点'].map((label,i)=><label key={label}>{label}（秒）<input type="number" min={i?range[0]+.1:0} max={i?total:range[1]-.1} step=".05" value={range[i]} onChange={e=>{const n=Number(e.target.value);if(n<0||n>total||i===0&&n>=range[1]||i===1&&n<=range[0])return;change(i?[range[0],n]:[n,range[1]]);}}/></label>)}</div></details>
   {error&&<p role="alert">{error}</p>}
  </div></>;
}
function App(){
 const [suite,setSuite]=useState<'a'|'b'>('a');
 useEffect(()=>{const pauseOthers=(event:Event)=>{document.querySelectorAll<HTMLMediaElement>('audio,video').forEach(el=>{if(el!==event.target&&!el.paused)el.pause();});};document.addEventListener('play',pauseOthers,true);return()=>document.removeEventListener('play',pauseOthers,true);},[]);
 return <main className="comparison dan-ui product-ui"><header className="page-heading"><div className="eyebrow">LOOP CONTROL / 组件试用</div><h1>把播放和片段选择放在一起</h1><p>左侧为项目当前组件，右侧为替换方向。使用相同模拟素材，可以播放、拖动进度、框选和放大。</p></header>
  <nav className="suite-tabs" aria-label="对比套组">{(['a','b'] as const).map(s=><button key={s} aria-pressed={suite===s} onClick={()=>setSuite(s)}>{s==='a'?'A · Video.js 统一控制':'B · Media Chrome'}{s==='a'&&<span>推荐</span>}</button>)}</nav>
  <div className="comparison-head"><div><span className="number">01</span><h2>当前项目</h2><p>现有 Video.js 视频／音频、图片放大与轻量试听条。</p></div><div><span className="number accent">02</span><h2>{suite==='a'?'统一、紧凑、常驻控制':'成套播放器，深色控制'}</h2><p>{suite==='a'?'沿用项目已有 Video.js 10.2.0；音视频使用同一套控制，片段选择紧接下方。':'Media Chrome 4.19.5；音视频使用相同 Web Components，片段选择紧接下方。'}</p></div></div>
  <section className="media-pair" aria-labelledby="video-heading"><div className="media-cell current"><h3 id="video-heading"><Film size={16}/>视频<span>当前 VideoPreview</span></h3><div className="video-stage"><VideoPreview src={assets.video} poster={assets.image} title="当前模拟视频"/></div><p className="hint">悬停显示控制；当前裁剪入口使用时间数字。</p><details className="current-trim"><summary>当前的裁剪字段示意</summary><div><label>使用起点（秒）<input type="number" defaultValue="1"/></label><label>使用终点（秒）<input type="number" defaultValue="6"/></label></div></details></div><div className="media-cell proposed" key={suite+'video'}><h3><Film size={16}/>视频 + 片段选择<span>候选 {suite.toUpperCase()}</span></h3><SelectedMedia kind="video" suite={suite}/></div></section>
  <section className="media-pair" aria-labelledby="audio-heading"><div className="media-cell current"><h3 id="audio-heading"><Music2 size={16}/>音频<span>三种现有呈现</span></h3><div className="audio-examples"><div><span>通用音频预览 · AudioPreview</span><AudioPreview aria-label="当前通用音频" src={assets.audio} preload="none"/></div><div className="candidate-line"><div><strong>Blue_Swing_demo.mp3</strong><small>跟随镜头 · +0.00 秒 · 使用 8.00 秒 · −6 dB</small></div><WorkspaceAudioAudition label="当前候选音效" showControls={false} src={assets.audio} preload="none"/></div><div><span>口播候选 · 轻量进度条</span><WorkspaceAudioAudition label="当前口播" layout="bar" showControls={false} src={assets.audio} durationSeconds={8} preload="none"/></div></div></div><div className="media-cell proposed" key={suite+'audio'}><h3><Music2 size={16}/>音频 + 同款控制<span>候选 {suite.toUpperCase()}</span></h3><div className="audio-filename"><strong>Blue_Swing_demo.mp3</strong><span>跟随镜头 · +0.00 秒 · −6 dB</span></div><SelectedMedia kind="audio" suite={suite}/></div></section>
  <section className="media-pair" aria-labelledby="image-heading"><div className="media-cell current"><h3 id="image-heading"><ImageIcon size={16}/>图片<span>当前 ImagePreview</span></h3><div className="image-stage"><ImagePreview src={assets.image} alt="当前模拟图片"/></div></div><div className="media-cell proposed"><h3><ImageIcon size={16}/>图片<span>两套均保留现有放大组件</span></h3><div className="image-stage candidate-image"><ImagePreview src={assets.image} alt="候选模拟图片"/></div><p className="hint">完整呈现、点击放大、Esc 关闭。播放器库本身不提供图片编辑器。</p></div></section>
  <footer className="page-footer"><p>建议选 A：保留现有播放内核，统一控制样式，再接入可拖动的使用范围。选区只改变本演示中的试听，不会剪切源文件或写入工程。</p><div><a href="https://videojs.org/docs/framework/react/reference/api/preset-audio" target="_blank" rel="noreferrer">Video.js 官方文档 ↗</a><a href="https://www.media-chrome.org/docs/en/get-started" target="_blank" rel="noreferrer">Media Chrome 官方文档 ↗</a><span>模拟画面与合成和弦 · 无业务数据</span></div></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
