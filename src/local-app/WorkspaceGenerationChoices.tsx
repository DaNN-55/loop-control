import {uiText} from '../i18n/ui';
import {Check,Images,PanelsTopLeft,Image as ImageIcon} from 'lucide-react';
import type {VideoGenerationMode} from '../videoVisualInputs';
import type {CSSProperties} from 'react';

export function WorkspaceResolutionChoices({values,value,disabled,onChange}:{values:readonly string[];value:string;disabled?:boolean;onChange:(value:string)=>void}){
 if(!values.length)return <p>{uiText("选择模型后可设置分辨率。")}</p>;
 return <div className="workspace-composer-choice-field"><span>{uiText("分辨率")}</span><div className="workspace-composer-choices workspace-composer-segments" role="group" aria-label={uiText("视频分辨率")}>{values.map(resolution=><button key={resolution} type="button" disabled={disabled} aria-pressed={value===resolution} onClick={()=>onChange(resolution)}>{resolution}</button>)}</div></div>;
}
export function WorkspaceVideoModeChoices({modes,value,disabled,onChange}:{modes:readonly VideoGenerationMode[];value:string;disabled?:boolean;onChange:(id:string)=>void}){
 return <div className="workspace-composer-mode-list" role="group" aria-label={uiText("生成模式")}>{modes.map(mode=>{
  const Icon=mode.id==='references'?Images:mode.inputs.lastFrame?PanelsTopLeft:ImageIcon;
  return <button type="button" key={mode.id} disabled={disabled} aria-pressed={value===mode.id} onClick={()=>onChange(mode.id)}><Icon size={16}/><span>{uiText(mode.label)}</span>{value===mode.id&&<Check size={15}/>}</button>;
 })}</div>;
}
export function WorkspaceFrameFitChoices({value,disabled,onChange}:{value:'contain'|'cover';disabled?:boolean;onChange:(value:'contain'|'cover')=>void}){
 return <div className="workspace-composer-choice-field"><span>{uiText("首帧构图")}</span><div className="workspace-composer-frame-fit" role="group" aria-label={uiText("首帧构图")}>{([
  ['contain','完整保留','必要时留边'],['cover','居中裁切','填满画面'],
 ] as const).map(([fit,label,description])=><button key={fit} type="button" aria-pressed={value===fit} disabled={disabled} onClick={()=>onChange(fit)}>
  <span className="workspace-composer-frame-preview" data-fit={fit} aria-hidden="true"><span><ImageIcon/></span></span>
  <span className="workspace-composer-frame-copy"><strong>{uiText(label)}</strong><small>{uiText(description)}</small></span>{value===fit&&<Check size={13} aria-hidden="true"/>}
 </button>)}</div></div>;
}
export function WorkspaceDurationControl({value,min,max,durations,locked,disabled,describedBy,onChange}:{value:string|number;min:number;max:number;durations?:readonly number[];locked?:boolean;disabled?:boolean;describedBy?:string;onChange:(value:string)=>void}){
 const discrete=durations&&durations.length<max-min+1?durations:undefined;
 const number=Number(value),valid=Number.isFinite(number)&&value!=='';
 const marks=discrete??[...new Set([min,Math.round((min+max)/2),max])];
 const sliderMin=discrete?0:min,sliderMax=discrete?discrete.length-1:max,sliderValue=discrete?Math.max(0,discrete.indexOf(number)):valid?Math.max(min,Math.min(max,number)):min;
 const position=(value:number)=>sliderMax===sliderMin?0:(value-sliderMin)/(sliderMax-sliderMin)*100;
 return <div className="workspace-composer-duration">
  <div className="workspace-composer-duration-heading"><span>{uiText("画面时长")}</span>{locked&&<small>{uiText("跟随主声")}</small>}</div>
  <div className="workspace-composer-duration-row"><div className="workspace-composer-duration-track"><input type="range" aria-label={uiText("调整生成时长")} aria-valuetext={uiText("{value0} 秒",{value0:String(discrete?discrete[sliderValue]:sliderValue)})} min={sliderMin} max={sliderMax} step={1} value={sliderValue} style={{'--duration-progress':`${position(sliderValue)}%`} as CSSProperties} disabled={disabled||locked} onChange={e=>onChange(String(discrete?discrete[Number(e.target.value)]:e.target.value))}/><div className="workspace-composer-duration-marks" aria-hidden="true">{marks.map(mark=><span key={mark} style={{left:`${position(discrete?discrete.indexOf(mark):mark)}%`}}>{mark}</span>)}</div></div>
   <label className="workspace-composer-duration-value"><input aria-label={uiText("生成时长（秒）")} aria-describedby={describedBy} type="number" min={min} max={max} step={1} value={value} readOnly={locked} disabled={disabled} onChange={e=>onChange(e.target.value)}/><span>{uiText("秒")}</span></label>
  </div>
 </div>;
}
