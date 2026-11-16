import {segmentSettings,type ProductionScript,type ProductionSettings} from './reviews/productionScript.js';

export interface TemplateMaterial {id:string;name:string;alias?:string;type:string;purpose:string|null;sha256:string;relativePath:string;fileSize:number}
export interface TemplateMaterialReference {reference:string;status:'bound'|'missing'|'ambiguous'|'none';material?:TemplateMaterial;candidates:TemplateMaterial[]}
export interface TemplateSpeech {voice?:string;speakingRate?:number;languageCode?:string}
export interface WorkspaceTemplateInputs {
 version:'workspace-template-inputs/v1';narration:TemplateSpeech;bgm?:TemplateMaterialReference;cover?:TemplateMaterialReference;
 shots:Array<{shotId:string;imagePrompt:string;videoPrompt:string;narration:TemplateSpeech;visualSource?:string;visual?:TemplateMaterialReference;sfx?:TemplateMaterialReference;videoReservationCents?:number}>;
}
const normalizedName=(name:string)=>name.split(/[\\/]/).at(-1)!.normalize('NFC').replace(/\.(png|jpg|jpeg|webp|bmp|gif|tiff?|avif|mp3|wav|m4a|aac|flac|ogg|mp4|m4v|mov|webm|mkv|avi)$/i,'');
/** Only caller-scoped, current material revisions may become suggestions. Adoption remains explicit. */
export function resolveTemplateMaterial(reference:string|undefined,kind:'visual'|'bgm'|'sfx'|'cover',materials:TemplateMaterial[]):TemplateMaterialReference|undefined{
 if(reference===undefined)return;
 if(reference==='none')return{reference,status:'none',candidates:[]};
 const eligible=materials.filter(m=>kind==='visual'?['image','video'].includes(m.type):kind==='cover'?m.type==='image':m.type==='audio'&&['general_reference',kind==='bgm'?'background_music':'sound_effect'].includes(m.purpose??''));
 const matches=eligible.filter(m=>[m.name,m.alias].some(name=>name!==undefined&&normalizedName(name)===normalizedName(reference)));
 const candidates=matches.filter((m,index)=>matches.findIndex(other=>other.sha256===m.sha256)===index),material=candidates.length===1?candidates[0]:undefined;
 return{reference,status:material?'bound':candidates.length?'ambiguous':'missing',...(material?{material}:{}),candidates};
}
function speech(settings:ProductionSettings):TemplateSpeech{
 return{...(settings.voice===undefined?{}:{voice:settings.voice}),...(settings.speakingRate===undefined?{}:{speakingRate:settings.speakingRate}),...(settings.language===undefined?{}:{languageCode:settings.language})};
}
export function productionTemplateInputs(script:ProductionScript,materials:TemplateMaterial[]):WorkspaceTemplateInputs|undefined{
 if(script.version!==3)return;
 return{version:'workspace-template-inputs/v1',narration:speech(script.settings),bgm:resolveTemplateMaterial(script.settings.bgm,'bgm',materials),cover:resolveTemplateMaterial(script.settings.cover,'cover',materials),shots:script.segments.map(segment=>{
  const settings=segmentSettings(script,segment);
  return{shotId:segment.id,imagePrompt:segment.visual,videoPrompt:segment.videoPrompt||segment.visual,narration:speech(settings),visualSource:segment.visualSource,visual:resolveTemplateMaterial(settings.materialReference,'visual',materials),sfx:resolveTemplateMaterial(settings.sfx,'sfx',materials),...(settings.videoReservationCents===undefined?{}:{videoReservationCents:settings.videoReservationCents})};
 })};
}
export function templateReferenceProblem(value:TemplateMaterialReference|undefined){
 return value?.status==='missing'?`未找到素材“${value.reference}”，请上传或重新选择。`:value?.status==='ambiguous'?`素材“${value.reference}”有多个匹配，请明确选择。`:null;
}
