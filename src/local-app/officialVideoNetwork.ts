import {isPublicMediaUrl,videoOutputRatios} from '../videoVisualInputs.js';
import {isDeepStrictEqual} from 'node:util';
import {registeredAdapters} from '../worker/registeredAdapters.js';
import {VideoGenerationError} from '../worker/videoGenerationError.js';
import {officialVideoBody,officialVideoDownloadUrl} from '../worker/officialVideoProvider.js';
import {klingOmniModel,klingOmniPath,videoProviders,minimaxEndpoints, type VideoProvider} from '../worker/videoProviderCatalog.js';
// Endpoint boundary for signed, deployment-owned network policies.
export function officialVideoOperation(provider: VideoProvider, phase: 'verify'|'execute', url: URL, init: RequestInit): string {
 const method=(init.method??'GET').toUpperCase(),origin=videoProviders[provider].endpoint;
 const base=new URL(origin),path=url.pathname.slice(base.pathname==='/'?0:base.pathname.length);
 if(url.origin===base.origin||provider==='minimax'&&url.origin===minimaxEndpoints.cn){
  const create=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/video_generation':'/v1/videos/image2video';
  const list=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/query/video_generation':create;
  const pagination=provider==='kling'?['pageNum','pageSize']:['page_num','page_size'];
  if(phase==='verify'&&method==='GET'&&path===list&&[...url.searchParams.keys()].every(k=>pagination.includes(k))&&url.searchParams.get(pagination[0])==='1'&&url.searchParams.get(pagination[1])==='1')return'verify';
  if(phase==='execute'&&method==='GET'&&!url.search){
   const query=provider==='minimax'?'/v2/query/video_generation/':create+'/';
   const pollPaths=provider==='kling'?[query,klingOmniPath+'/']:[query];
   if(pollPaths.some(prefix=>path.startsWith(prefix)&&/^[a-zA-Z0-9_-]{1,128}$/.test(path.slice(prefix.length))))return'poll';
  }
  if(phase==='execute'&&method==='POST'&&provider==='kling'&&path===klingOmniPath&&!url.search){
   if(typeof init.body!=='string'||Buffer.byteLength(init.body)>55*1024*1024)throw Error('Invalid Kling Omni body');
   const body=JSON.parse(init.body),duration=Number(body.duration),images=body.image_list??[],videos=body.video_list??[];
   if(body.model_name!==klingOmniModel||body.mode!=='pro'||body.sound!=='off'||!videoOutputRatios.includes(body.aspect_ratio)||
    typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>1500||typeof body.duration!=='string'||
    !Number.isInteger(duration)||duration<3||duration>15||
    !Array.isArray(images)||!Array.isArray(videos)||images.length+videos.length===0||images.length>(videos.length?4:7)||videos.length>1||
    images.some(image=>!image||Object.keys(image).length!==1||typeof image.image_url!=='string'||image.image_url.length>Math.ceil(10*1024*1024/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.image_url))||
    videos.some(video=>!video||Object.keys(video).length!==3||!isPublicMediaUrl(video.video_url)||video.refer_type!=='feature'||video.keep_original_sound!=='no')||
    Object.keys(body).some(k=>!['model_name','prompt','duration','aspect_ratio','mode','sound','image_list','video_list'].includes(k)))throw Error('Invalid Kling Omni body');
   return'generate';
  }
  if(phase==='execute'&&method==='POST'&&path===create&&!url.search){
   if(typeof init.body!=='string'||Buffer.byteLength(init.body)>55*1024*1024)throw Error('Invalid video body');
   const body=JSON.parse(init.body),duration=Number(body.duration),p=videoProviders[provider];
   if(!Number.isInteger(duration)||duration<p.minDuration||duration>p.maxDuration)throw Error('Invalid video duration');
   if(provider==='kling'){
    const decode=(value:unknown)=>typeof value==='string'&&value.length<=Math.ceil(10*1024*1024/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(value)?Buffer.from(value,'base64'):undefined;
    const image=decode(body.image),tail=body.image_tail===undefined?undefined:decode(body.image_tail);
    if(!image||body.image_tail!==undefined&&!tail)throw new VideoGenerationError('可灵首尾帧格式或大小无效，未向供应商发送。','not_sent');
    const expected=officialVideoBody({provider,model:body.model_name,prompt:body.prompt,durationSeconds:duration,...(tail?{visualMode:'keyframes',visualInputs:[{role:'firstFrame',materialRevisionId:'first',image,mimeType:'image/png'},{role:'lastFrame',materialRevisionId:'last',image:tail,mimeType:'image/png'}]}:{image,imageMime:'image/png'})});
    if(!isDeepStrictEqual(body,expected))throw new VideoGenerationError('可灵请求参数与已登记模式不一致，未向供应商发送。','not_sent');
   }else{
    if(!matchesRegisteredVisualBody(provider,body))throw new VideoGenerationError(`${p.label} 请求的模型、画面输入或参数与已登记模式不一致，未向供应商发送。`,'not_sent');
   }
   return'generate';
  }
 }
 if(phase==='execute'&&method==='GET'&&!new Headers(init.headers).has('Authorization')){officialVideoDownloadUrl(provider,url.href);return'download';}
 throw Error('Unregistered official video request');
}

/** Reuse the exact registered serializer so reference modes cannot drift from first-frame validation. */
function matchesRegisteredVisualBody(provider:'minimax'|'volcengine',body:Record<string,any>){
 if(!Array.isArray(body.content)||body.content[0]?.type!=='text'||typeof body.content[0].text!=='string')return false;
 const roles={first_frame:'firstFrame',last_frame:'lastFrame',reference_image:'referenceImages',reference_video:'referenceVideos'} as const;
 const inputs:import('../worker/officialVideoProvider.js').OfficialVideoVisualInput[]=[];
 for(const [index,entry] of body.content.slice(1).entries()){
  const role=roles[entry?.role as keyof typeof roles];if(!role)return false;
  const url=entry.type==='image_url'?entry.image_url?.url:entry.type==='video_url'?entry.video_url?.url:undefined;
  if(typeof url!=='string')return false;
  const data=/^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if(data)inputs.push({role,materialRevisionId:String(index),mimeType:data[1],...(entry.type==='video_url'?{video:Buffer.from(data[2],'base64')}:{image:Buffer.from(data[2],'base64')})});
  else if(entry.type==='video_url'&&role==='referenceVideos')inputs.push({role,materialRevisionId:String(index),source:url,mimeType:'video/mp4'});
  else return false;
 }
 const modes=registeredAdapters.productionChoices().find(c=>c.provider===provider&&c.adapter===videoProviders[provider].adapter)?.videoGenerationModes?.[body.model]??[];
 for(const mode of modes)try{
  const base={provider,model:body.model,prompt:body.content[0].text,durationSeconds:body.duration,...(provider==='minimax'?{resolution:body.resolution,referenceRatio:body.ratio==='adaptive'?undefined:body.ratio}:{})};
  if(mode.id==='first-frame'&&(inputs.length!==1||inputs[0].role!=='firstFrame'))continue;
  const expected=mode.id==='first-frame'?officialVideoBody({...base,image:inputs[0].image,imageMime:inputs[0].mimeType}):officialVideoBody({...base,visualInputs:inputs,visualMode:mode.id});
  if(isDeepStrictEqual(body,expected))return true;
 }catch{/* Another registered mode may match; no network or reservation occurs here. */}
 return false;
}
