import {parseProductionScript,productionSettingFields,segmentSettings} from './reviews/productionScript.js';
import {recognizedScriptText,type RecognitionSetting} from './scriptFormat.js';
export const scriptStudioContractVersion='script-studio/v1';
export const scriptStudioMaxCharacters=20000;
export const scriptStudioSettingFields={global:productionSettingFields('global').filter(name=>name!=='镜头时长（秒）'),shot:productionSettingFields('shot').filter(name=>name!=='镜头时长（秒）')};
export type ScriptStudioMode='optimize'|'adapt';
export interface ScriptStudioShot {title:string;durationSeconds:number;narration:string;subtitle:string|null;visual:string;videoPrompt:string;camera:string;visualSource:'image'|'video'|'material'|'unassigned';settings:RecognitionSetting[]}
export interface ScriptStudioPlan {title:string;durationSeconds:number;summary:string;sourceUse:string;narrationEnabled:boolean;captionsEnabled:boolean;settings:RecognitionSetting[];shots:ScriptStudioShot[];changes:string[];warnings:string[];canProceed:boolean}
export interface ScriptStudioDiagnostic {responseId:string;usage:{inputTokens:number|null;outputTokens:number|null};modelOutput:unknown}
export interface ScriptStudioResult {requestId:string;status:'pending'|'completed'|'failed'|'unknown';plan?:ScriptStudioPlan;modifiedShotIndexes?:number[];message?:string;responseId?:string;usage?:{inputTokens:number|null;outputTokens:number|null};diagnostic?:ScriptStudioDiagnostic}
export type ScriptStudioChatMode='optimize'|'discuss';
export interface ScriptStudioMessage {role:'user'|'assistant';content:string}
export interface ScriptStudioTurn {requestId:string;mode:ScriptStudioMode|'discuss'|'edit';model?:string;provider?:string;instruction:string;answer:string;status:ScriptStudioResult['status']}
export interface ScriptStudioConversation {turns:ScriptStudioTurn[];result:ScriptStudioResult|null;latest?:ScriptStudioResult;latestRequestId?:string;mode:ScriptStudioMode}
export interface ScriptStudioOptions {targetDuration:number|null;mode:ScriptStudioMode;instruction?:string}
const normal=(s:string)=>s.replace(/\s+/g,' ').trim().replace(/([\p{Script=Han}，。！？；：、]) +(?=[\p{Script=Han}，。！？；：、])/gu,'$1');
export function validateStudioDuration(value:unknown):asserts value is number|null{if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<.1||value>3600||Math.abs(value*100-Math.round(value*100))>1e-6))throw Error('总时长须为 0.1–3600 秒，最多两位小数。');}
export function explicitScriptDuration(source:string){let parsed;try{parsed=parseProductionScript(source);}catch{}if(parsed&&parsed.segments.every(s=>segmentSettings(parsed,s).duration!==undefined))return Math.round(parsed.segments.reduce((n,s)=>n+segmentSettings(parsed,s).duration!,0)*100)/100;const value=source.match(/^\s*(?:[-*]\s*)?(?:总时长|视频时长|时长)[：:]\s*(\d+(?:\.\d{1,2})?)\s*(?:秒|s)\s*$/m)?.[1];return value?Number(value):null;}
export function hasExplicitStudioShotTiming(source:string){try{const parsed=parseProductionScript(source);return parsed?.version===3&&parsed.segments.some(shot=>segmentSettings(parsed,shot).duration!==undefined);}catch{return false;}}
export function estimateScriptDuration(source:string){const explicit=explicitScriptDuration(source);if(explicit!==null)return explicit;let parsed;try{parsed=parseProductionScript(source);}catch{}if(parsed)return Math.round(parsed.segments.reduce((n,s)=>n+(segmentSettings(parsed,s).duration??Math.max(3,Array.from(s.narration).length/4)),0)*100)/100;return Math.min(3600,Math.max(6,Math.ceil(Array.from(source.trim()).length/4)));}
export function studioShotNarrationEnabled(plan:ScriptStudioPlan,shot:ScriptStudioShot){const value=[...plan.settings,...shot.settings].filter(s=>['口播启用','旁白启用'].includes(s.field)&&s.value!=='默认').at(-1)?.value;return value===undefined?plan.narrationEnabled:value==='开启';}
export function studioShotCaptionsEnabled(plan:ScriptStudioPlan,shot:ScriptStudioShot){const value=[...plan.settings,...shot.settings].filter(s=>s.field==='字幕'&&s.value!=='默认').at(-1)?.value;return value===undefined?plan.captionsEnabled:value==='开启';}
export function studioShotCaptionText(plan:ScriptStudioPlan,shot:ScriptStudioShot){return studioShotCaptionsEnabled(plan,shot)?shot.subtitle??shot.narration:'';}
function settings(source:string){return[...source.split(/^##\s+/m)[0].matchAll(/^-\s+([^：:\n]+)[：:]\s*(.*)$/gm)].map(m=>({field:m[1],value:m[2]})).filter(s=>!['模板版本','口播','画面来源','画面提示','视频提示词','字幕正文','镜头时长（秒）','生成时长（秒）'].includes(s.field));}
function durationShots(total:number,weights:number[]){let used=0;return weights.map((w,i)=>{const n=i===weights.length-1?Math.round(total*100)-used:Math.round(total*100*w/weights.reduce((a,b)=>a+b,0));used+=n;return n/100;});}
function sourceShotTimes(total:number,explicit:(number|undefined)[]){
 const missing=explicit.flatMap((value,index)=>value===undefined?[index]:[]);
 if(!missing.length||missing.length===explicit.length)return durationShots(total,explicit.map(value=>value??5));
 const available=Math.round((total-explicit.reduce<number>((sum,value)=>sum+(value??0),0))*100)/100;
 if(available<missing.length*.1-1e-6)throw Error('总时长不足以保留明确镜头时长及未填写镜头，请调整目标时长。');
 const assigned=durationShots(available,missing.map(()=>1));let index=0;
 return explicit.map(value=>value??assigned[index++]);
}
export function localScriptStudioPlan(source:string,targetDuration:number|null):ScriptStudioPlan{
 validateStudioDuration(targetDuration);if(!source.trim()||Array.from(source).length>scriptStudioMaxCharacters)throw Error('请提供原文，最多支持 20000 字符。');
 let parsed;try{parsed=parseProductionScript(source);}catch{}
 const duration=targetDuration??estimateScriptDuration(source);
 if(parsed?.version===3){const sections=source.split(/^###\s+段落\s+\d+\s*$/m),times=sourceShotTimes(duration,parsed.segments.map(s=>segmentSettings(parsed,s).duration));
  return{title:parsed.title,durationSeconds:duration,summary:'沿用原稿明确的镜头与制作设置。',sourceUse:'结构化脚本',narrationEnabled:parsed.segments.some(s=>segmentSettings(parsed,s).narrationEnabled!==false),captionsEnabled:parsed.segments.some(s=>segmentSettings(parsed,s).captionsEnabled!==false),settings:settings(source.split(/^##\s+制作设置\s*$/m)[1]?.split(/^##\s+/m)[0]??''),shots:parsed.segments.map((s,i)=>({title:'镜头 '+(i+1),durationSeconds:times[i],narration:s.narration,subtitle:s.subtitle??null,visual:s.visual,videoPrompt:s.videoPrompt,camera:'沿用原稿拍法',visualSource:s.visualSource??'unassigned',settings:settings(sections[i+1]??'')})),changes:[],warnings:[],canProceed:true};
 }
 const spoken=[...source.matchAll(/^\s*(?:[-*•]\s*)?(?:口播|旁白|口播正文|旁白正文)[：:]\s*(.+)$/gm)].map(m=>m[1].trim()).filter(t=>!['开启','关闭','默认'].includes(t)),subtitles=[...source.matchAll(/^\s*(?:[-*•]\s*)?(?:字幕|字幕正文)[：:]\s*(.+)$/gm)].map(m=>m[1].trim()).filter(t=>!['开启','关闭','默认'].includes(t)),voice=(spoken.length>0||/^\s*(?:[-*]\s*)?(?:口播|旁白)[：:]\s*开启\s*$/m.test(source))&&!/^\s*(?:[-*]\s*)?(?:口播|旁白)[：:]\s*关闭\s*$/m.test(source),caption=(voice||subtitles.length>0||/^\s*(?:[-*]\s*)?字幕[：:]\s*开启\s*$/m.test(source))&&!/^\s*(?:[-*]\s*)?字幕[：:]\s*关闭\s*$/m.test(source);
 return{title:source.match(/^#\s+(.+)$/m)?.[1]?.slice(0,200)??'主脚本',durationSeconds:duration,summary:'原文作为一个完整片段继续，未调用 AI。',sourceUse:spoken.length?'原文明确指定口播':subtitles.length?'原文明确指定字幕':'原文用途待后续制作方案确认',narrationEnabled:voice,captionsEnabled:caption,settings:[],shots:[{title:'完整片段',durationSeconds:duration,narration:spoken.join(' '),subtitle:subtitles.length?subtitles.join(' '):null,visual:source,videoPrompt:'',camera:'拍法待后续制作安排',visualSource:'unassigned',settings:subtitles.length?[{field:'字幕正文模式',value:'independent'}]:[]}],changes:[],warnings:spoken.length||subtitles.length?[]:['口播与字幕用途尚未确认，暂不启用；后续制作方案需先说明安排。'],canProceed:true};
}
/** Canonical production input is separate from the source retained in the confirmation. */
function videoPrompt(shot:ScriptStudioShot){const camera=/^(?:沿用原稿|拍法待后续)/.test(shot.camera)?'':shot.camera,combined=[shot.videoPrompt,camera&&shot.videoPrompt.includes(camera)?'':camera].filter(Boolean).join('；');if(combined.length>1500)throw Error('运镜与视频提示词合计不能超过 1500 字符，请缩短拍法。');return combined;}
export function scriptStudioText(plan:ScriptStudioPlan){
 const caption=plan.settings.filter(s=>s.field==='字幕'&&s.value!=='默认').at(-1)?.value,voice=plan.settings.filter(s=>['口播启用','旁白启用'].includes(s.field)&&s.value!=='默认').at(-1)?.value;
 return recognizedScriptText({title:plan.title,settings:[...plan.settings.filter(s=>!['字幕','口播启用','旁白启用'].includes(s.field)),{field:'字幕',value:caption??(plan.captionsEnabled?'开启':'关闭')},{field:'口播启用',value:voice??(plan.narrationEnabled?'开启':'关闭')}],shots:plan.shots.map(s=>({narration:s.narration||s.visual||s.title,subtitle:s.subtitle,visual:s.visual,videoPrompt:videoPrompt(s),visualSource:s.visualSource,settings:[...s.settings.filter(x=>!['镜头时长（秒）','生成时长（秒）'].includes(x.field)),{field:'镜头时长（秒）',value:String(s.durationSeconds)}]})),warnings:plan.warnings,canRecognize:true});
}
/** The model proposes filming; locally enforced content and duration boundaries still apply. */
export function validateScriptStudioPlan(value:unknown,source:string,options:ScriptStudioOptions):ScriptStudioPlan{
 validateStudioDuration(options.targetDuration);
 const object=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
 const text=(v:unknown,max=4000)=>typeof v==='string'&&v.length<=max;
 const entries=(v:unknown)=>Array.isArray(v)&&v.length<=40&&v.every(s=>object(s,['field','value'])&&text(s.field,100)&&text(s.value,500)&&!/[\r\n：:]/.test(s.field)&&s.field!=='模板版本');
 if(!object(value,['title','durationSeconds','summary','sourceUse','narrationEnabled','captionsEnabled','settings','shots','changes','warnings','canProceed']))throw Error('拍法方案结构无效。');
 const p=structuredClone(value) as ScriptStudioPlan;
 if(!text(p.title,200)||!p.title.trim()||!text(p.summary,2000)||!text(p.sourceUse,1000)||typeof p.narrationEnabled!=='boolean'||typeof p.captionsEnabled!=='boolean'||typeof p.canProceed!=='boolean'||!entries(p.settings)||!Array.isArray(p.shots)||p.shots.length>100||!Array.isArray(p.changes)||p.changes.length>30||p.changes.some(t=>!text(t,1000))||!Array.isArray(p.warnings)||p.warnings.length>30||p.warnings.some(t=>!text(t,1000))||p.shots.some(s=>!object(s,['title','durationSeconds','narration','subtitle','visual','videoPrompt','camera','visualSource','settings'])||!text(s.title,200)||!text(s.narration,20000)||s.subtitle!==null&&!text(s.subtitle,20000)||!text(s.visual,20000)||!text(s.videoPrompt,1500)||!text(s.camera,1000)||!['image','video','material','unassigned'].includes(s.visualSource)||!entries(s.settings)))throw Error('拍法方案字段无效或超过上限。');
 for(const [scope,values] of [['global',p.settings],...p.shots.map(shot=>['shot',shot.settings] as const)] as const){
  const invalid=values.find(setting=>!scriptStudioSettingFields[scope].includes(setting.field));
  if(invalid)throw Error('拍法包含不支持的'+(scope==='global'?'全局':'镜头')+'制作设置：'+invalid.field);
 }
 validateStudioDuration(p.durationSeconds);if(p.durationSeconds===null)throw Error('拍法缺少总时长。');
 if(!p.canProceed)return p;
 if(!p.shots.length)throw Error('拍法至少需要一个完整片段。');
 for(const shot of p.shots){validateStudioDuration(shot.durationSeconds);if(shot.durationSeconds===null)throw Error('镜头缺少时长。');}
 const fixedDuration=options.targetDuration??estimateScriptDuration(source);
 if(Math.abs(p.shots.reduce((n,s)=>n+s.durationSeconds,0)-p.durationSeconds)>.011||fixedDuration!==null&&Math.abs(fixedDuration-p.durationSeconds)>.001)throw Error('拍法改变了指定总时长，或镜头时长之和不一致。');
 const local=localScriptStudioPlan(source,options.targetDuration);
 if(options.mode==='optimize'){
  if(p.changes.length)throw Error('默认优化不能改编原文内容，请保留原文事件和台词。');
  if(hasExplicitStudioShotTiming(source)&&(p.shots.length!==local.shots.length||p.shots.some((shot,index)=>normal(shot.narration)!==normal(local.shots[index].narration)||Math.abs(shot.durationSeconds-local.shots[index].durationSeconds)>.001)))throw Error('原稿已明确逐镜时长，默认优化须保留镜头边界和时长。');
  const voiceOverride=/口播|旁白/.test(options.instruction??''),captionOverride=/字幕/.test(options.instruction??'');
  if(!voiceOverride&&(local.sourceUse==='结构化脚本'||local.shots.some(s=>s.narration)||/^\s*(?:[-*]\s*)?(?:口播|旁白)[：:]\s*关闭\s*$/m.test(source))&&p.narrationEnabled!==local.narrationEnabled)throw Error('默认优化不能改变原有口播开关。');
  const creative=new Set(['动画','动画幅度（%）','缩放','转场','转场时长（秒）','转场方向']);
  const protectedField=(s:RecognitionSetting)=>s.value!=='默认'&&!creative.has(s.field)&&!(voiceOverride&&['口播启用','旁白启用'].includes(s.field))&&!(captionOverride&&['字幕','字幕正文模式','字幕位置','字幕安全区','字幕最大行数','每行最大字数','字幕样式'].includes(s.field));
  for(const setting of local.settings.filter(protectedField)){const got=p.settings.find(s=>s.field===setting.field);if(got&&got.value!==setting.value)throw Error('拍法改变了原有制作设置：'+setting.field);if(!got)p.settings.push({...setting});}
  const timeline=normal(local.shots.map(s=>s.narration).join(' '));let cursor=0;const oldRanges=local.shots.map(s=>{const spoken=normal(s.narration),start=timeline.indexOf(spoken,cursor),end=start+spoken.length;cursor=end;return{shot:s,start,end};});cursor=0;
  for(const shot of p.shots){
   const spoken=normal(shot.narration),start=timeline.indexOf(spoken,cursor),end=start+spoken.length;cursor=end;const origins=spoken?oldRanges.filter(s=>s.end>start&&s.start<end):[];
   for(const origin of origins)for(const setting of origin.shot.settings.filter(protectedField)){const got=shot.settings.find(s=>s.field===setting.field);if(got&&got.value!==setting.value)throw Error('拍法改变了镜头原有制作设置：'+setting.field);if(!got)shot.settings.push({...setting});}
   if(local.sourceUse==='结构化脚本')for(const origin of origins){
    if(!voiceOverride&&studioShotNarrationEnabled(p,shot)!==studioShotNarrationEnabled(local,origin.shot))throw Error('拍法改变了原稿镜头的口播开关。');
    if(!captionOverride&&studioShotCaptionsEnabled(p,shot)!==studioShotCaptionsEnabled(local,origin.shot))throw Error('拍法改变了原稿镜头的字幕开关。');
   }
  }
  if(!captionOverride&&/^\s*(?:[-*]\s*)?字幕[：:]\s*关闭\s*$/m.test(source)&&!local.captionsEnabled&&p.captionsEnabled)throw Error('默认优化不能开启原文已关闭的字幕。');

  const expected=normal(local.shots.map(s=>s.narration).join(' ')),actual=normal(p.shots.map(s=>s.narration).join(' '));
  if(expected&&actual!==expected)throw Error('拍法遗漏、改写或重排了原有口播。');
  // An explicit voice request may select unchanged prose; existing speech/subtitles stay complete.
  const proseExcerpt=voiceOverride&&local.sourceUse==='原文用途待后续制作方案确认'&&normal(source).includes(actual);
  if(!expected&&actual&&actual!==normal(local.shots.map(s=>s.subtitle??'').join(' ')||source)&&!proseExcerpt)throw Error('新增口播须逐字使用原文；只读部分原文时，请在修改要求中明确口播安排。');
  const originalSubtitles=normal(local.shots.map(s=>s.subtitle??'').join(' ')),subtitles=normal(p.shots.map(s=>s.subtitle??'').join(' '));
  if(originalSubtitles&&subtitles!==originalSubtitles||!originalSubtitles&&p.shots.some(s=>s.subtitle!==null&&s.subtitle.trim()&&!normal(source).includes(normal(s.subtitle))))throw Error('拍法改写或遗漏了原有字幕。');
  if(source.match(/^#\s+(.+)$/m)?.[1]&&p.title!==local.title)throw Error('拍法改变了原文标题。');
 }
 if(options.mode==='adapt'&&!p.changes.length)throw Error('改编方案需要明确列出内容变化。');
 if(p.narrationEnabled!==p.shots.some(s=>studioShotNarrationEnabled(p,s)))throw Error('口播摘要与逐镜开关不一致。');
 if(p.captionsEnabled!==p.shots.some(s=>studioShotCaptionsEnabled(p,s)))throw Error('字幕摘要与逐镜开关不一致。');
 if(p.shots.some(s=>studioShotNarrationEnabled(p,s)&&!s.narration.trim()))throw Error('每个启用口播的镜头都需要明确口播正文。');
 if(p.shots.some(s=>studioShotCaptionsEnabled(p,s)&&!studioShotCaptionText(p,s).trim()))throw Error('每个启用字幕的镜头都需要明确字幕或跟随的口播正文。');
 if(p.shots.some(s=>studioShotNarrationEnabled(p,s)&&Array.from(s.narration.replace(/\s/g,'')).length/7>s.durationSeconds))throw Error('原文口播无法在镜头时长内完整读完，请调整时长或拍法。');
 const canonical=scriptStudioText(p);if(canonical.length>200000)throw Error('拍法超过制作上限。');parseProductionScript(canonical);
 return p;
}
