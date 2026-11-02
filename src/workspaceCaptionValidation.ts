import type {ShotCaptionContract} from './shotCaptions.js';

/** Field diagnostics shared by the editing form and the Owner input boundary. */
export function workspaceCaptionFieldErrors(value:unknown,durationMs?:number):Record<string,string>{
 const errors:Record<string,string>={};
 if(!value||typeof value!=='object')return errors;
 const contract=value as Partial<ShotCaptionContract>;
 const numeric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
 const empty=(v:unknown)=>v===null||v===undefined||v===''||typeof v==='number'&&Number.isNaN(v);
 if(contract.enabled&&typeof contract.text==='string'&&!contract.text.trim())errors.text='字幕正文不能为空。';
 if(contract.spatial?.safeArea==='custom')for(const [side,label] of [['top','上'],['right','右'],['bottom','下'],['left','左']] as const){
  const v=contract.spatial.insets?.[side];
  if(empty(v))errors[`margin-${side}`]=`${label}边距不能为空。`;
  else if(!numeric(v)||v!<0||v!>.4)errors[`margin-${side}`]=`${label}边距须为 0–40%。`;
 }
 for(const [key,label,max] of [['maxLines','行数',2],['maxCharactersPerLine','每行字数',24]] as const){
  const v=contract.spatial?.[key];
  if(empty(v))errors[key]=`${label}不能为空。`;
  else if(!Number.isInteger(v)||v!<1||v!>max)errors[key]=`${label}须为 1–${max} 的整数。`;
 }
 if(Array.isArray(contract.cues))contract.cues.forEach((cue,index)=>{
  if(!cue||typeof cue!=='object')return;
  const prefix=`第 ${index+1} 条`;
  if(typeof cue.text==='string'&&!cue.text.trim())errors[`cue-${index}-text`]=`${prefix}正文不能为空。`;
  for(const [field,label] of [['startMs','开始'],['endMs','结束']] as const){
   const v=cue[field],key=`cue-${index}-${field}`;
   if(empty(v))errors[key]=`${prefix}${label}时间不能为空。`;
   else if(!numeric(v)||v<0)errors[key]=`${prefix}${label}时间须为不小于 0 的秒数。`;
   else if(durationMs!==undefined&&v>durationMs+1)errors[key]=`${prefix}${label}时间超出当前镜头窗口（${Number((durationMs/1000).toFixed(3))} 秒），请重新校时。`;
  }
  if(numeric(cue.startMs)&&numeric(cue.endMs)&&cue.endMs<=cue.startMs)errors[`cue-${index}-endMs`]=`${prefix}结束时间须晚于开始时间。`;
 });
 return errors;
}
