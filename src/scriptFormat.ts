import {parseProductionScript} from './reviews/productionScript.js';
export const scriptFormatContractVersion='script-recognition/v1';
export const scriptFormatModel='gpt-5.6-luna';
export const deepSeekFormatModels=['deepseek-flash','deepseek-v4-pro'] as const;
export const scriptFormatMaxCharacters=20000;
export interface RecognitionSetting {field:string;value:string}
export interface RecognizedShot {narration:string;subtitle:string|null;visual:string;videoPrompt:string;visualSource:'image'|'video'|'material'|'unassigned';settings:RecognitionSetting[]}
export interface ScriptRecognition {title:string;settings:RecognitionSetting[];shots:RecognizedShot[];warnings:string[];canRecognize:boolean}
export interface ScriptFormatResult {requestId:string;status:'pending'|'completed'|'failed'|'unknown';recognition?:ScriptRecognition;message?:string;responseId?:string;usage?:{inputTokens:number|null;outputTokens:number|null}}
const norm=(text:string)=>text.replace(/\s+/g,' ').trim().replace(/([\p{Script=Han}，。！？；：、]) +(?=[\p{Script=Han}，。！？；：、])/gu,'$1');
const line=(text:string)=>text.replace(/\s*[\r\n]+\s*/g,' ').trim();
const visualNames={image:'图片',video:'视频',material:'已有素材',unassigned:'暂未选择'};
/** Internal serialization bridges confirmed shot data to the existing production pipeline. */
export function recognizedScriptText(value:ScriptRecognition):string{
 return ['# '+line(value.title),'','## 制作设置','- 模板版本：3',...value.settings.map(s=>'- '+s.field+'：'+line(s.value)),'','## 正文',...value.shots.flatMap((shot,index)=>['### 段落 '+String(index+1).padStart(2,'0'),'- 口播：'+line(shot.narration),'- 画面来源：'+visualNames[shot.visualSource],...(shot.subtitle===null?[]:['- 字幕正文：'+line(shot.subtitle)]),...(shot.visual?['- 画面提示：'+line(shot.visual)]:[]),...(shot.videoPrompt?['- 视频提示词：'+line(shot.videoPrompt)]:[]),...shot.settings.map(s=>'- '+s.field+'：'+line(s.value)),''])].join('\n');
}
/** Untrusted model output is bounded and locally parsed; it cannot rewrite spoken content. */
export function validateScriptRecognition(value:unknown,source:string):ScriptRecognition{
 const object=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
 const text=(v:unknown,max=20000)=>typeof v==='string'&&v.length<=max;
 const settings=(v:unknown)=>Array.isArray(v)&&v.length<=40&&v.every(s=>object(s,['field','value'])&&text(s.field,100)&&text(s.value,500)&&!/[\r\n：:]/.test(s.field)&&s.field!=='模板版本');
 if(!object(value,['title','settings','shots','warnings','canRecognize']))throw Error('分镜识别结果结构无效。');
 const v=value as ScriptRecognition;
 if(!text(v.title,200)||!v.title.trim()||!settings(v.settings)||!Array.isArray(v.shots)||v.shots.length>100||typeof v.canRecognize!=='boolean'||!Array.isArray(v.warnings)||v.warnings.length>30||v.warnings.some(w=>!text(w,500))||v.shots.some(s=>!object(s,['narration','subtitle','visual','videoPrompt','visualSource','settings'])||!text(s.narration)||s.subtitle!==null&&!text(s.subtitle)||!text(s.visual,4000)||!text(s.videoPrompt,1500)||!Object.hasOwn(visualNames,s.visualSource)||!settings(s.settings)))throw Error('分镜识别结果不完整或超过上限。');
 if(!v.canRecognize)return v;
 if(!v.shots.length)throw Error('未识别出可确认的镜头。');
 const sourceText=norm(source),spoken=[...source.matchAll(/^\s*(?:[-*•]\s*)?(?:口播|旁白|口播正文|旁白正文)[：:]\s*(.+)$/gm)].map(m=>m[1].trim()),spokenText=norm(spoken.join(' '));
 const contents=v.shots.flatMap(s=>[s.narration,...(s.subtitle===null?[]:[s.subtitle]),s.visual,s.videoPrompt,...s.settings.map(x=>x.value)]).concat(v.settings.map(s=>s.value));
 if(contents.some(t=>t.trim()&&!sourceText.includes(norm(t))&&!spokenText.includes(norm(t))))throw Error('识别结果改写或补写了原文，请重新核对。');
 const recognizedNarration=norm(v.shots.map(s=>s.narration).join(' '));let cursor=0;
 for(const text of spoken){const found=recognizedNarration.indexOf(norm(text),cursor);if(found<0)throw Error('识别结果遗漏或改变了口播顺序。');cursor=found+norm(text).length;}
 // Plain body sections must not silently lose a paragraph while grouping a continuous scene.
 const body=source.split(/^##\s+(?:正文|旁白脚本|口播正文)\s*$/m)[1]?.split(/^##\s+/m)[0];
 if(body&&!/^\s*(?:[-*•]\s*)?[^：:\n]+[：:]/m.test(body)){let position=0;for(const text of body.split(/\r?\n/).map(t=>t.trim()).filter(t=>t&&!/^#/.test(t))){const index=recognizedNarration.indexOf(norm(text),position);if(index<0)throw Error('识别结果遗漏了原文内容或改变了顺序。');position=index+norm(text).length;}}
 const title=source.match(/^#(?!#)\s*(.+)$/m)?.[1].trim();if(title&&v.title!==title)throw Error('识别结果改变了原文标题。');
 const canonical=recognizedScriptText(v);if(canonical.length>100000)throw Error('识别结果超过读取上限。');
 parseProductionScript(canonical);
 return v;
}
