import type {ProductionSettings} from './reviews/productionScript.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import {bgmDuckingLevels,type BgmDuckingLevel} from './shotAudioMix.js';

/** Initial presentation intent only; no connection, generation or spending authority. */
export interface WorkspaceRenderPreferences {
 version:'workspace-render-preferences/v1';
 voiceGainDb?:number;bgmGainDb?:number;sfxGainDb?:number;bgmDucking?:BgmDuckingLevel;
 captionStyle?:'minimal'|'cinematic';transition?:'cut'|'fade'|'studio';
}
export function productionRenderPreferences(settings:ProductionSettings):WorkspaceRenderPreferences|undefined{
 const {narrationGainDb,bgmGainDb,sfxGainDb,bgmDucking,captionStyle,transition}=settings;
 if([narrationGainDb,bgmGainDb,sfxGainDb,bgmDucking,captionStyle,transition].every(v=>v===undefined))return;
 return{version:'workspace-render-preferences/v1',...(narrationGainDb===undefined?{}:{voiceGainDb:narrationGainDb}),...(bgmGainDb===undefined?{}:{bgmGainDb}),...(sfxGainDb===undefined?{}:{sfxGainDb}),...(bgmDucking===undefined?{}:{bgmDucking}),...(captionStyle===undefined?{}:{captionStyle}),...(transition===undefined?{}:{transition})};
}
/** Native imports/saves are the external boundary for the owned extension. */
export function validateWorkspaceRenderPreferences(value:unknown):asserts value is WorkspaceRenderPreferences{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('渲染预填格式无效。');
 const v=value as Record<string,unknown>;
 if(v.version!=='workspace-render-preferences/v1'||Object.keys(v).some(k=>!['version','voiceGainDb','bgmGainDb','sfxGainDb','bgmDucking','captionStyle','transition'].includes(k))||['voiceGainDb','bgmGainDb','sfxGainDb'].some(k=>v[k]!==undefined&&(typeof v[k]!=='number'||!Number.isFinite(v[k])||Number(v[k]) < -60||Number(v[k])>12))||v.bgmDucking!==undefined&&!bgmDuckingLevels.includes(v.bgmDucking as BgmDuckingLevel)||v.captionStyle!==undefined&&(typeof v.captionStyle!=='string'||!['minimal','cinematic'].includes(v.captionStyle))||v.transition!==undefined&&(typeof v.transition!=='string'||!['cut','fade','studio'].includes(v.transition)))throw Error('渲染预填字段或版本无效。');
}
export function workspaceRenderPreferences(project:OpenChatCutProject,shotId:string):WorkspaceRenderPreferences|undefined{
 const value=project.timelines.flatMap(t=>t.items).map(i=>i.loopControlShot as {shotId?:string;renderPreferences?:unknown}|undefined).find(m=>m?.shotId===shotId)?.renderPreferences;
 if(value===undefined)return;validateWorkspaceRenderPreferences(value);return value;
}
