import type {ProductionSettings,ProductionTransition} from './reviews/productionScript.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import {bgmDuckingLevels,type BgmDuckingLevel} from './shotAudioMix.js';

/** Initial presentation intent only; no connection, generation or spending authority. */
export interface WorkspaceRenderPreferences {
 version:'workspace-render-preferences/v1'|'workspace-render-preferences/v2';
 voiceGainDb?:number;bgmGainDb?:number;sfxGainDb?:number;bgmDucking?:BgmDuckingLevel;
 captionStyle?:'minimal'|'cinematic';transition?:ProductionTransition;
 sfxStart?:number;sfxDuration?:number;
 scale?:number;animation?:ProductionSettings['animation'];animationAmount?:number;
 transitionDuration?:number;transitionDirection?:ProductionSettings['transitionDirection'];
}
export function productionRenderPreferences(settings:ProductionSettings):WorkspaceRenderPreferences|undefined{
 const result:WorkspaceRenderPreferences={version:'workspace-render-preferences/v1'};
 const fields={narrationGainDb:'voiceGainDb',bgmGainDb:'bgmGainDb',sfxGainDb:'sfxGainDb',bgmDucking:'bgmDucking',captionStyle:'captionStyle',transition:'transition',sfxStart:'sfxStart',sfxDuration:'sfxDuration',scale:'scale',animation:'animation',animationAmount:'animationAmount',transitionDuration:'transitionDuration',transitionDirection:'transitionDirection'} as const;
 for(const [key,target]of Object.entries(fields))if(settings[key as keyof typeof fields]!==undefined)Object.assign(result,{[target]:settings[key as keyof typeof fields]});
 if(Object.keys(result).length===1)return;
 if(['sfxStart','sfxDuration','scale','animation','animationAmount','transitionDuration','transitionDirection'].some(key=>Object.hasOwn(result,key))||transitionIsNative(result.transition))result.version='workspace-render-preferences/v2';
 return result;
}
const nativeTransitions=['cross-dissolve','dip-to-black','soft-wipe','anticipation-zoom'];
function transitionIsNative(value:unknown){return typeof value==='string'&&nativeTransitions.includes(value);}
/** Native imports/saves are the external boundary for the owned extension. */
export function validateWorkspaceRenderPreferences(value:unknown):asserts value is WorkspaceRenderPreferences{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('渲染预填格式无效。');
 const v=value as Record<string,unknown>;
 const v2=v.version==='workspace-render-preferences/v2';
 const ranges:Record<string,[number,number]>={voiceGainDb:[-60,12],bgmGainDb:[-60,12],sfxGainDb:[-60,12],sfxStart:[0,3600],sfxDuration:[.01,3600],scale:[.05,16],animationAmount:[0,100],transitionDuration:[0,5]};
 if(!['workspace-render-preferences/v1','workspace-render-preferences/v2'].includes(String(v.version))||Object.keys(v).some(k=>!['version','voiceGainDb','bgmGainDb','sfxGainDb','bgmDucking','captionStyle','transition',...(v2?['sfxStart','sfxDuration','scale','animation','animationAmount','transitionDuration','transitionDirection']:[])].includes(k))||Object.entries(ranges).some(([key,[min,max]])=>v[key]!==undefined&&(typeof v[key]!=='number'||!Number.isFinite(v[key])||Number(v[key])<min||Number(v[key])>max))||v.bgmDucking!==undefined&&!bgmDuckingLevels.includes(v.bgmDucking as BgmDuckingLevel)||v.captionStyle!==undefined&&(typeof v.captionStyle!=='string'||!['minimal','cinematic'].includes(v.captionStyle))||v.transition!==undefined&&(typeof v.transition!=='string'||!['cut','fade','studio',...(v2?nativeTransitions:[])].includes(v.transition))||v.animation!==undefined&&(typeof v.animation!=='string'||!['none','slow-push','zoom-out'].includes(v.animation))||v.transitionDirection!==undefined&&(typeof v.transitionDirection!=='string'||!['left','right','up','down'].includes(v.transitionDirection)))throw Error('渲染预填字段或版本无效。');
}
export function workspaceRenderPreferences(project:OpenChatCutProject,shotId:string):WorkspaceRenderPreferences|undefined{
 const value=project.timelines.flatMap(t=>t.items).map(i=>i.loopControlShot as {shotId?:string;renderPreferences?:unknown}|undefined).find(m=>m?.shotId===shotId)?.renderPreferences;
 if(value===undefined)return;validateWorkspaceRenderPreferences(value);return value;
}
