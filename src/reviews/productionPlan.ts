import {parseProductionScript,segmentSettings,type ProductionScript,type ProductionSettings} from './productionScript.js';
export interface ProductionMaterial {
 id:string;episodeId:string;seriesId:string|null;name:string;alias?:string;
 provenance?:{source:Record<string,unknown>;approvals:Record<string,unknown>[]};
 type:string;purpose:string;mime:string;path:string;sha256:string;size:number;root?:string;
}
export interface MaterialResolution {reference:string;kind:'image'|'bgm'|'sfx'|'cover';status:'bound'|'missing'|'ambiguous'|'none';material?:ProductionMaterial;candidates:ProductionMaterial[]}
export interface ResolvedProductionSegment {
 id:string;narration:string;subtitle:string;visual:string;videoPrompt:string;shotType:'a_roll'|'b_roll';
 settings:ProductionSettings;firstFrame:MaterialResolution;sfx:MaterialResolution;
}
export interface ResolvedProductionPlan {
 version:2;script:ProductionScript;settings:ProductionSettings;segments:ResolvedProductionSegment[];
 bgm:MaterialResolution;cover:MaterialResolution;issues:string[];executionFingerprint?:string;
}
function materialName(name:string){return name.normalize('NFC').replace(/\.(png|jpg|jpeg|webp|mp3|wav|m4a|aac|flac|ogg)$/i,'');}
export function resolveProductionMaterial(reference:string|undefined,kind:MaterialResolution['kind'],materials:ProductionMaterial[],episodeId:string,seriesId:string|null,choice?:string):MaterialResolution {
 if(reference==='none')return{reference:'none',kind,status:'none',candidates:[]};
 const eligible=materials.filter(m=>kind==='image'||kind==='cover'?m.type==='image'&&['image/png','image/jpeg'].includes(m.mime)&&m.size<=10*1024*1024:m.type==='audio'&&m.purpose===(kind==='bgm'?'background_music':'sound_effect'));
 const matches=reference?eligible.filter(m=>[m.alias,m.name].some(n=>n===reference||n&&materialName(n)===materialName(reference))):[];
 const local=matches.filter(m=>m.episodeId===episodeId),scoped=local.length?local:matches.filter(m=>seriesId!==null&&m.seriesId===seriesId);
 const candidates=[...new Map(scoped.map(m=>[m.sha256,m])).values()];
 const material=choice?candidates.find(m=>m.id===choice):candidates.length===1?candidates[0]:undefined;
 return{reference:reference??'默认',kind,status:material?'bound':candidates.length?'ambiguous':'missing',...(material?{material}:{}),candidates};
}
export function resolveProductionPlan(text:string,defaults:ProductionSettings,materials:ProductionMaterial[],episodeId:string,seriesId:string|null,choices:Record<string,string>={}):ResolvedProductionPlan {
 const script=parseProductionScript(text);if(!script)throw Error('自动制作需要 v2 主脚本。');
 const settings={...defaults,...script.settings};
 const resolve=(ref:string|undefined,kind:MaterialResolution['kind'])=>resolveProductionMaterial(ref,kind,materials,episodeId,seriesId,ref?choices[kind+':'+ref]:undefined);
 const segments=script.segments.map(s=>{const combined={...defaults,...segmentSettings(script,s)};return{id:s.id,narration:s.narration,subtitle:s.subtitle??s.narration,visual:s.visual,videoPrompt:s.videoPrompt,shotType:s.shotType,settings:combined,firstFrame:resolve(combined.firstFrame,'image'),sfx:resolve(combined.sfx??'none','sfx')};});
 const bgm=resolve(settings.bgm??'none','bgm'),cover=resolve((settings as ProductionSettings&{cover?:string}).cover??'none','cover');
 const issues=[bgm,...segments.flatMap(s=>[s.firstFrame,s.sfx])].filter(r=>['missing','ambiguous'].includes(r.status)).map(r=>`${r.reference}：${r.status==='missing'?'待上传':'存在多个匹配，请选择'}`);
 for(const [i,segment]of segments.entries())if(segment.settings.captionMode==='independent'&&!script.segments[i].subtitle)issues.push(segment.id+'：独立字幕需要填写字幕正文');
 return{version:2,script,settings,segments,bgm,cover,issues:[...new Set(issues)]};
}
export function productionCompositionSettings(settings:ProductionSettings):Record<string,unknown>{
 const result:Record<string,unknown>={};
 const fields:Partial<Record<keyof ProductionSettings,string>>={aspectRatio:'aspect_ratio',captionsEnabled:'captions_enabled',captionStyle:'caption_style',narrationGainDb:'narration_gain_db',bgmGainDb:'bgm_gain_db',sfxGainDb:'sfx_gain_db'};
 for(const [key,target]of Object.entries(fields)){const value=settings[key as keyof ProductionSettings];if(value!==undefined)result[target]=value;}
 if(settings.aspectRatio){const [width,height]=settings.aspectRatio==='16:9'?[1920,1080]:settings.aspectRatio==='1:1'?[1080,1080]:[1080,1920];result.width=width;result.height=height;}
 if(settings.transition&&settings.transition!=='studio')result.transition=settings.transition;
 return result;
}
