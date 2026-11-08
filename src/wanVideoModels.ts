import {isPublicMediaUrl,videoOutputRatios,type VideoGenerationMode,type VideoOutputRatio} from './videoVisualInputs.js';
import {defaultWanSettings,isWanGenerationSettings,type WanGenerationSettings} from './videoGenerationSettings.js';
export const wanReferenceModel='wan2.6-r2v';
export const wanReferenceMode:VideoGenerationMode={
 id:'references',label:'参考素材生成',referenceImageSource:'https',characterOrder:true,maxReferences:5,videoSeconds:{min:1,max:30},
 inputs:{
  referenceImages:{max:5,maxBytes:20*1024*1024,mimeTypes:['image/png','image/jpeg','image/webp','image/bmp']},
  referenceVideos:{max:3,maxBytes:100*1024*1024,mimeTypes:['video/mp4','video/quicktime']},
 },
};
export const defaultWanModel='wan2.6-i2v-flash';
export interface WanVideoModel {
 durations:readonly number[];resolutions:readonly WanGenerationSettings['resolution'][];
 audio:'optional'|'always'|'silent';multiShot:boolean;fixedDuration:boolean;maxBytes:number;
}
/** Verified video request contracts. Directory names never grant a new execution protocol. ADR-0021. */
export const wanVideoModels:Readonly<Record<string,WanVideoModel>>={
 'wan2.6-i2v-flash':{durations:Array.from({length:14},(_,i)=>i+2),resolutions:['720P','1080P'],audio:'optional',multiShot:true,fixedDuration:false,maxBytes:20*1024*1024},
 'wan2.6-i2v':{durations:Array.from({length:14},(_,i)=>i+2),resolutions:['720P','1080P'],audio:'always',multiShot:true,fixedDuration:false,maxBytes:20*1024*1024},
 [wanReferenceModel]:{durations:Array.from({length:9},(_,i)=>i+2),resolutions:['720P','1080P'],audio:'always',multiShot:true,fixedDuration:false,maxBytes:20*1024*1024},
 'wan2.5-i2v-preview':{durations:[5,10],resolutions:['720P','1080P'],audio:'always',multiShot:false,fixedDuration:false,maxBytes:20*1024*1024},
 'wan2.2-i2v-flash':{durations:[5],resolutions:['720P','1080P'],audio:'silent',multiShot:false,fixedDuration:true,maxBytes:10*1024*1024},
 'wan2.2-i2v-plus':{durations:[5],resolutions:['1080P'],audio:'silent',multiShot:false,fixedDuration:true,maxBytes:10*1024*1024},
 'wanx2.1-i2v-plus':{durations:[5],resolutions:['720P'],audio:'silent',multiShot:false,fixedDuration:true,maxBytes:10*1024*1024},
 'wanx2.1-i2v-turbo':{durations:[3,4,5],resolutions:['720P'],audio:'silent',multiShot:false,fixedDuration:false,maxBytes:10*1024*1024},
};
export function wanVideoModel(model:string):WanVideoModel|undefined{return Object.hasOwn(wanVideoModels,model)?wanVideoModels[model]:undefined;}
export function defaultWanModelSettings(model:string):WanGenerationSettings{
 const p=wanVideoModel(model);return {...defaultWanSettings,resolution:p?.resolutions[0]??'720P',audio:p?.audio==='always'};
}
export function wanVideoSettingsError(model:string,value:unknown):string|null{
 const p=wanVideoModel(model);if(!p)return '此模型尚未接入视频生成。';
 if(!isWanGenerationSettings(value))return '视频生成设置无效。';
 if(!p.resolutions.includes(value.resolution))return `${model} 支持分辨率 ${p.resolutions.join(' / ')}。`;
 if(p.audio==='always'&&!value.audio)return `${model} 固定生成声音，请启用视频声音。`;
 if(p.audio==='silent'&&value.audio)return `${model} 不支持生成声音，请关闭视频声音。`;
 if(!p.multiShot&&value.shotType!=='single')return `${model} 不支持多镜头结构，请改用单镜头。`;
 if(model===wanReferenceModel&&value.promptExtend)return '参考素材生成不支持智能扩写提示词。';
 if(model!==wanReferenceModel&&value.shotType==='multi'&&!value.promptExtend)return '视频生成设置无效。';
 return null;
}
export function wanProviderDuration(model:string,targetSeconds:number,voiceDriven:boolean){
 const p=wanVideoModel(model);return p&&Number.isFinite(targetSeconds)?(voiceDriven?p.durations.find(n=>n>=targetSeconds):p.durations.includes(targetSeconds)?targetSeconds:undefined):undefined;
}
const wanReferenceSizes={'720P':{'16:9':'1280*720','9:16':'720*1280','1:1':'960*960'},'1080P':{'16:9':'1920*1080','9:16':'1080*1920','1:1':'1440*1440'}} as const;
export function wanVideoParameters(model:string,duration:number,settings:WanGenerationSettings,ratio:VideoOutputRatio='16:9'){
 const profile=wanVideoModel(model),error=wanVideoSettingsError(model,settings);
 if(!profile||error)throw Error(error??'视频模型无效。');
 if(!profile.durations.includes(duration))throw Error(`${model} 支持时长 ${profile.durations.join('、')} 秒。`);
 if(model===wanReferenceModel){
  if(!videoOutputRatios.includes(ratio))throw Error('参考视频输出比例无效。');
  return {size:wanReferenceSizes[settings.resolution][ratio],duration,watermark:settings.watermark,shot_type:settings.shotType,...(settings.seed!==undefined?{seed:settings.seed}:{})};
 }
 return {resolution:settings.resolution,...(!profile.fixedDuration?{duration}:{}),...(profile.audio==='optional'?{audio:settings.audio}:{}),prompt_extend:settings.promptExtend,watermark:settings.watermark,...(profile.multiShot&&settings.promptExtend?{shot_type:settings.shotType}:{}),...(settings.seed!==undefined?{seed:settings.seed}:{})};
}
/** Independent network admission rejects unsupported fields as well as invalid values. */
export function isWanVideoRequest(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;const b=value as {model?:unknown;input?:Record<string,unknown>;parameters?:Record<string,unknown>};
 if(typeof b.model!=='string'||!b.input||!b.parameters)return false;
 const p=wanVideoModel(b.model),i=b.input,s=b.parameters;if(!p)return false;
 if(Object.keys(b).some(k=>!['model','input','parameters'].includes(k)))return false;
 if(b.model===wanReferenceModel)return Object.keys(i).every(k=>['prompt','reference_urls','negative_prompt'].includes(k))&&
  Object.keys(s).every(k=>['size','duration','watermark','shot_type','seed'].includes(k))&&
  typeof i.prompt==='string'&&!!i.prompt.trim()&&i.prompt.length<=1500&&
  (i.negative_prompt===undefined||typeof i.negative_prompt==='string'&&i.negative_prompt.length<=500)&&
  Array.isArray(i.reference_urls)&&i.reference_urls.length>=1&&i.reference_urls.length<=(wanReferenceMode.maxReferences??0)&&i.reference_urls.every(isPublicMediaUrl)&&
  Object.values(wanReferenceSizes).some(sizes=>Object.values(sizes).some(size=>size===s.size))&&p.durations.includes(Number(s.duration))&&typeof s.duration==='number'&&
  typeof s.watermark==='boolean'&&['single','multi'].includes(String(s.shot_type))&&
  (s.seed===undefined||typeof s.seed==='number'&&Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=2147483647);
 if(Object.keys(i).some(k=>!['prompt','img_url','negative_prompt'].includes(k))||Object.keys(s).some(k=>!['resolution','duration','audio','prompt_extend','watermark','shot_type','seed'].includes(k)))return false;
 if(typeof i.prompt!=='string'||!i.prompt.trim()||i.prompt.length>1500||typeof i.img_url!=='string'||!/^data:image\/(png|jpeg|webp|bmp);base64,/.test(i.img_url))return false;
 if((p.audio!=='optional'&&s.audio!==undefined)||(!p.multiShot&&s.shot_type!==undefined)||(p.fixedDuration&&s.duration!==undefined))return false;
 const settings={resolution:s.resolution,audio:p.audio==='optional'?s.audio:p.audio==='always',promptExtend:s.prompt_extend,watermark:s.watermark,shotType:s.shot_type??'single',negativePrompt:i.negative_prompt??'',...(s.seed!==undefined?{seed:s.seed}:{})};
 return !wanVideoSettingsError(b.model,settings)&&p.durations.includes((s.duration??(p.fixedDuration?5:NaN)) as number);
}
export function wanUnsupportedReason(model:string,capability:string){
 if(/^wan(?:x)?[\d.]+-t2v/.test(model))return '需要文生视频输入，当前流程使用首帧图片。';
 if(/^wan(?:x)?[\d.]+-(r2v|kf2v)/.test(model))return '需要参考视频或首尾帧输入。';
 if(/^wan2\.7-|^wan3\./.test(model))return '需要新版 media 调用协议，当前首帧流程尚未接入。';
 return capability.includes('视频')?'此视频模型的调用协议尚未接入。':'当前连接仅接入首帧视频生成。';
}
