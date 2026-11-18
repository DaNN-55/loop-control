import {estimateScriptDuration,hasExplicitStudioShotTiming,localScriptStudioPlan,scriptStudioSettingFields,validateScriptStudioPlan,validateStudioDuration,type ScriptStudioOptions,type ScriptStudioPlan,type ScriptStudioShot} from './scriptStudio.js';
export const scriptStudioDirectionContract='script-studio-direction/v2';
/** Model output describes rhythm, not duplicate summaries or an independently editable total. */
export interface ScriptStudioDirection extends Omit<ScriptStudioPlan,'durationSeconds'|'narrationEnabled'|'captionsEnabled'|'shots'|'canProceed'> {
 shots:(Omit<ScriptStudioShot,'durationSeconds'>&{timingWeight:number;narrationEnabled:boolean;captionsEnabled:boolean})[];
}
const switches=['口播启用','旁白启用','字幕'];
export const directionSettingChoices:Record<string,readonly string[]|null>={'动画':['无','慢推','拉远'],'动画幅度（%）':null,'缩放':null,'转场':['硬切','叠化','淡出到黑','柔和擦除','推进转场'],'转场时长（秒）':null,'转场方向':['左','右','上','下']};
export const directionSettingFields={global:scriptStudioSettingFields.global.filter(field=>Object.hasOwn(directionSettingChoices,field)),shot:scriptStudioSettingFields.shot.filter(field=>Object.hasOwn(directionSettingChoices,field))};
const object=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
export function compileScriptStudioDirection(value:unknown,source:string,options:ScriptStudioOptions):ScriptStudioPlan {
 if(!object(value,['title','summary','sourceUse','settings','shots','changes','warnings']))throw Error('拍法设计结构无效。');
 const draft=structuredClone(value) as ScriptStudioDirection;
 if(!Array.isArray(draft.shots)||draft.shots.length>100||draft.shots.some(shot=>!object(shot,['title','timingWeight','narrationEnabled','captionsEnabled','narration','subtitle','visual','videoPrompt','camera','visualSource','settings'])||!Number.isSafeInteger(shot.timingWeight)||shot.timingWeight<1||shot.timingWeight>1000||typeof shot.narrationEnabled!=='boolean'||typeof shot.captionsEnabled!=='boolean'||typeof shot.narration!=='string'))throw Error('逐镜开关或相对节奏无效。');
 for(const [scope,settings] of [['global',draft.settings],...draft.shots.map(shot=>['shot',shot.settings] as const)] as const){
  if(!Array.isArray(settings)||settings.some(setting=>!object(setting,['field','value'])||typeof setting.field!=='string'||typeof setting.value!=='string'))throw Error('拍法制作设置无效。');
  const invalid=settings.find(setting=>!directionSettingFields[scope].includes(setting.field));
  if(invalid)throw Error('拍法包含不支持的'+(scope==='global'?'全局':'镜头')+'制作设置：'+invalid.field);
 }
 validateStudioDuration(options.targetDuration);
 const durationSeconds=options.targetDuration??estimateScriptDuration(source);validateStudioDuration(durationSeconds);
 const sourcePlan=localScriptStudioPlan(source,options.targetDuration),fixed=options.mode==='optimize'&&hasExplicitStudioShotTiming(source)?sourcePlan.shots:null;
 if(fixed&&fixed.length!==draft.shots.length)throw Error('原稿已明确逐镜时长，默认优化须保留镜头边界和时长。');
 const total=Math.round(durationSeconds*100),minimum=draft.shots.map(shot=>Math.max(10,shot.narrationEnabled?Math.ceil(Array.from(shot.narration.replace(/\s/g,'')).length*100/7):10));
 const spare=total-minimum.reduce((sum,n)=>sum+n,0),weight=draft.shots.reduce((sum,shot)=>sum+shot.timingWeight,0);
 if(spare<0)throw Error('原文口播或镜头数量无法容纳在固定总时长内，请调整时长或拍法。');
 const shares=draft.shots.map(shot=>Math.floor(spare*shot.timingWeight/weight));
 const order=draft.shots.map((shot,index)=>({index,remainder:spare*shot.timingWeight%weight})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
 for(let i=0,left=spare-shares.reduce((sum,n)=>sum+n,0);i<left&&i<order.length;i++)shares[order[i].index]++;
 const plan:ScriptStudioPlan={...draft,canProceed:true,durationSeconds,settings:[...sourcePlan.settings.filter(s=>!switches.includes(s.field)&&!draft.settings.some(setting=>setting.field===s.field)),...draft.settings],narrationEnabled:draft.shots.some(shot=>shot.narrationEnabled),captionsEnabled:draft.shots.some(shot=>shot.captionsEnabled),shots:draft.shots.map(({timingWeight:_,narrationEnabled,captionsEnabled,...shot},index)=>({...shot,durationSeconds:fixed?fixed[index].durationSeconds:(minimum[index]+shares[index])/100,settings:[...shot.settings,{field:'口播启用',value:narrationEnabled?'开启':'关闭'},{field:'字幕',value:captionsEnabled?'开启':'关闭'}]}))};
 return validateScriptStudioPlan(plan,source,options);
}
