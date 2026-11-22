import {useEffect,useId,useRef,useState,type ReactNode,type RefObject} from 'react';
import {Slider,SliderTrack,SliderThumb} from 'react-aria-components';
import {Clock3,RotateCcw,Scissors,Play} from 'lucide-react';
import {uiText} from '../../i18n/ui';
import {useVideoFilmstrip} from './useVideoFilmstrip';
import './media-range.css';

export function MediaRangeEditor({label,duration,value,step=.01,disabled=false,onChange,media,videoSrc,preciseOpen,onPreciseOpenChange,children,actions,isOpen,onOpenChange,showTrigger=true,id:providedId}:{label:string;duration:number;value:[number,number];step?:number;disabled?:boolean;onChange:(value:[number,number])=>void;media?:RefObject<HTMLMediaElement|null>;videoSrc?:string;preciseOpen?:boolean;onPreciseOpenChange?:(open:boolean)=>void;children?:ReactNode;actions?:ReactNode;isOpen?:boolean;onOpenChange?:(open:boolean)=>void;showTrigger?:boolean;id?:string}){
 const [localOpen,setLocalOpen]=useState(preciseOpen===true);
 const expanded=isOpen??localOpen,setExpanded=onOpenChange??setLocalOpen;
 const [localPrecise,setLocalPrecise]=useState(false),[error,setError]=useState(''),generatedId=useId(),seekFrame=useRef(0);
 const id=providedId??generatedId;
 const precise=preciseOpen??localPrecise,setPrecise=onPreciseOpenChange??setLocalPrecise;
 useEffect(()=>{if(preciseOpen)setExpanded(true);},[preciseOpen,setExpanded]);
 useEffect(()=>()=>cancelAnimationFrame(seekFrame.current),[]);
 const strip=useVideoFilmstrip(expanded?videoSrc:undefined,duration),valid=Number.isFinite(duration)&&duration>0&&value.every(Number.isFinite)&&value[0]>=0&&value[1]>value[0]&&value[1]<=duration+.001;
 function change(next:[number,number]){
  if(next.every((time,index)=>Math.abs(time-value[index])<.000001))return;
  if(disabled||next[0]<0||next[1]>duration+.001||next[1]-next[0]<step-.00001)return;
  const target=next[0]!==value[0]?next[0]:next[1];onChange(next);setError('');
  cancelAnimationFrame(seekFrame.current);seekFrame.current=requestAnimationFrame(()=>{const element=media?.current;if(!element)return;element.pause();element.currentTime=Math.min(target,Math.max(0,duration-step));});
 }
 async function preview(){const element=media?.current;if(!element)return;try{element.pause();element.currentTime=value[0];await element.play();}catch{setError('无法播放选区，请重试。');}}
 return <section hidden={!showTrigger&&!expanded} className="app-media-range" aria-label={uiText('{value0}使用范围',{value0:label})}>
  {showTrigger&&<header className="app-range-toggle"><button className="app-range-action" type="button" disabled={disabled} aria-expanded={expanded} aria-controls={id+'-crop'} onClick={()=>{setExpanded(!expanded);if(expanded)setPrecise(false);}}><Scissors size={13} aria-hidden="true"/>{uiText('裁剪')}</button></header>}
  <div id={id+'-crop'} hidden={!expanded} className="app-range-content">
  <header><span>{uiText('使用范围')}</span><div><button className="app-range-action" type="button" aria-expanded={precise} aria-controls={id} onClick={()=>setPrecise(!precise)}><Clock3 size={13} aria-hidden="true"/>{uiText('精确时间')}</button><button className="app-range-action" type="button" disabled={disabled||!duration} onClick={()=>change([0,duration])}><RotateCcw size={13} aria-hidden="true"/>{uiText('重置')}</button></div></header>
  <Slider aria-label={uiText('{value0}使用范围',{value0:label})} minValue={0} maxValue={duration||1} step={step} value={valid?value:[0,duration||1]} isDisabled={disabled||!valid} onChange={next=>change(next as [number,number])}>
   <SliderTrack className="app-range-track" style={strip?{backgroundImage:`url(${strip})`}:undefined}>
    <div className="app-range-shade" style={{insetInlineEnd:`${100-value[0]/(duration||1)*100}%`}}/><div className="app-range-shade" style={{insetInlineStart:`${value[1]/(duration||1)*100}%`}}/>
    <div className="app-range-selection" style={{left:`${value[0]/(duration||1)*100}%`,width:`${(value[1]-value[0])/(duration||1)*100}%`}}/>
    <SliderThumb index={0} aria-label={uiText('{value0}选区起点',{value0:label})} className="app-range-thumb"/><SliderThumb index={1} aria-label={uiText('{value0}选区终点',{value0:label})} className="app-range-thumb"/>
   </SliderTrack>
  </Slider>
  <footer><span>{value[0].toFixed(2)} — {value[1].toFixed(2)} s · {uiText('使用 {value0} 秒',{value0:Math.max(0,value[1]-value[0]).toFixed(2)})}</span>{media&&<button className="app-range-action" type="button" disabled={!valid} onClick={()=>void preview()}><Play size={12} aria-hidden="true"/>{uiText('播放选区')}</button>}</footer>
  <div id={id} hidden={!precise} className="app-range-precise">{([0,1] as const).map(index=><label key={index}>{uiText(index?'使用终点（秒）':'使用起点（秒）')}<input type="number" aria-label={uiText('{value0}使用{value1}（秒）',{value0:label,value1:index?'终点':'起点'})} min={index?value[0]+step:0} max={index?duration:value[1]-step} step={step} value={Number(value[index].toFixed(6))} disabled={disabled} onChange={event=>{if(event.target.value.trim()==='')return;const next:[number,number]=[...value];next[index]=Number(event.target.value);change(next);}}/></label>)}<div className="app-range-extra">{children}</div></div>
  {actions}
  {error&&<p role="alert">{uiText(error)}</p>}
  </div>
 </section>;
}
