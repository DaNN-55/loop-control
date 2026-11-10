import {VideoGenerationError} from './videoGenerationError.js';
import {ProviderOutcomeUnknownError,isDefiniteProviderRejection} from './providerOutcome.js';
import {registeredAdapters} from './registeredAdapters.js';
import {videoOutputRatios,videoVisualInputProblem,type VideoOutputRatio,type VideoVisualInputSelection} from '../videoVisualInputs.js';
import {createHmac} from 'node:crypto';
import {executeVideoTask,type VideoTaskPorts} from './videoTaskExecution.js';
import {klingOmniModel,klingOmniPath,videoProviders,minimaxEndpoints,minimaxVideoResolution,type MiniMaxRegion, type VideoProvider} from './videoProviderCatalog.js';

// Like Bailian workspace credentials, region is frozen in the immutable secret binding.
// Plain legacy keys retain their original international endpoint.
export function minimaxCredential(secret:string):{apiKey:string;region:MiniMaxRegion;origin:string}{
 let apiKey=secret.trim(),region:MiniMaxRegion='international';
 if(apiKey.startsWith('{')){
  let value;try{value=JSON.parse(apiKey);}catch{throw Error('MiniMax 认证材料格式无效。');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['apiKey','region'].includes(key))||!Object.hasOwn(minimaxEndpoints,value.region)||typeof value.apiKey!=='string')throw Error('MiniMax API Key 或所属站点无效。');
  apiKey=value.apiKey.trim();region=value.region;
 }
 if(!apiKey||/[\r\n]/.test(apiKey))throw Error('MiniMax API Key 无效。');
 return{apiKey,region,origin:minimaxEndpoints[region]};
}
export function videoEndpoint(provider:VideoProvider,secret:string){return provider==='minimax'?minimaxCredential(secret).origin:videoProviders[provider].endpoint;}

export function videoAuthorization(provider: VideoProvider, secret: string): string {
  const value = provider==='minimax'?minimaxCredential(secret).apiKey:secret.trim();
  if (!value || /[\r\n]/.test(value)) throw Error('视频 API Key 无效。');
  if (provider !== 'kling' || !value.includes(':')) return 'Bearer '+value;
  const [accessKey, secretKey, extra] = value.split(':');
  if (!accessKey || !secretKey || extra) throw Error('可灵旧版凭据应为 Access Key:Secret Key。');
  const now = Math.floor(Date.now()/1000);
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:accessKey,exp:now+1800,nbf:now-5});
  return 'Bearer '+body+'.'+createHmac('sha256',secretKey).update(body).digest('base64url');
}
export function officialVideoDownloadUrl(provider: VideoProvider, value: string): URL {
  const url = new URL(value), host = url.hostname;
  // Domestic H3 task responses use this exact OSS bucket; do not allow other OSS tenants.
  const allowed = provider === 'volcengine' ? /(^|\.)(volces\.com|volccdn\.com|byteimg\.com)$/.test(host)
    : provider === 'minimax' ? host === 'algeng-video-infer.oss-cn-shanghai.aliyuncs.com' || /(^|\.)(minimax\.io|minimax\.chat|hailuoai\.com)$/.test(host)
    : /(^|\.)(klingai\.com|klingai\.cn|kling\.ai)$/.test(host);
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('视频下载地址不属于对应供应商。');
  return url;
}
export type OfficialVideoVisualInput=VideoVisualInputSelection&{image?:Uint8Array;video?:Uint8Array;mimeType:string};
export interface OfficialVideoInput extends VideoTaskPorts {
  provider: VideoProvider; model: string; credentials: string;
  image?: Uint8Array; imageMime?: string; visualInputs?: OfficialVideoVisualInput[]; visualMode?: string; referenceRatio?:VideoOutputRatio; prompt: string; durationSeconds: number; resolution?:string;
}
export function officialVideoBody(input: Pick<OfficialVideoInput,'provider'|'model'|'image'|'imageMime'|'prompt'|'durationSeconds'|'visualInputs'|'visualMode'|'referenceRatio'|'resolution'>) {
  const p = videoProviders[input.provider];
  if (!(p.models as readonly string[]).includes(input.model) || !Number.isInteger(input.durationSeconds) || input.durationSeconds < p.minDuration || input.durationSeconds > p.maxDuration || !input.prompt.trim() || input.prompt.length > 1500) throw Error('视频模型、提示词或时长无效。');
  const resolution=input.provider==='minimax'?minimaxVideoResolution(input.model,input.resolution??'768P'):'720p';
  if(input.visualInputs){
    const choice=registeredAdapters.productionChoices().find(entry=>entry.provider===input.provider&&entry.adapter===p.adapter);
    const mode=choice?.videoGenerationModes?.[input.model]?.find(entry=>entry.id===input.visualMode);
    if(!mode||mode.id==='first-frame')throw Error('所选视频生成模式无效。');
    const problem=videoVisualInputProblem(mode,input.visualInputs);
    if(problem)throw Error(problem);
    const roles={firstFrame:'first_frame',lastFrame:'last_frame',referenceImages:'reference_image',referenceVideos:'reference_video'} as const;
    let bytes=0;
    const visualContent=input.visualInputs.map(entry=>{
      const isVideo=entry.role==='referenceVideos';
      if(isVideo&&entry.source)return{type:'video_url',video_url:{url:entry.source},role:roles[entry.role]};
      const limit=mode.inputs[entry.role]!,media=isVideo?entry.video:entry.image;
      if(!media?.byteLength||media.byteLength>(limit.maxBytes??0)||!limit.mimeTypes?.includes(entry.mimeType)||
        isVideo&&(!mode.allowInlineMp4||entry.mimeType!=='video/mp4'))throw Error('画面输入格式或大小无效。');
      bytes+=media.byteLength;
      if(bytes>40*1024*1024)throw Error('直接提交的素材总大小不能超过 40 MB。');
      const url=`data:${entry.mimeType};base64,${Buffer.from(media).toString('base64')}`;
      return isVideo?{type:'video_url',video_url:{url},role:roles[entry.role]}:{type:'image_url',image_url:{url},role:roles[entry.role]};
    });
    if(input.provider==='kling'){
      if(input.model===klingOmniModel){
        const aspect_ratio=input.referenceRatio;
        if(!aspect_ratio||!videoOutputRatios.includes(aspect_ratio))throw Error('可灵 Omni 输出比例无效。');
        const image_list=visualContent.flatMap(entry=>entry.image_url?[{image_url:entry.image_url.url.split(',')[1]}]:[]);
        const video_list=visualContent.flatMap(entry=>entry.video_url?[{video_url:entry.video_url.url,refer_type:'feature',keep_original_sound:'no'}]:[]);
        return {model_name:input.model,prompt:input.prompt.trim(),duration:String(input.durationSeconds),aspect_ratio,mode:'pro',sound:'off',
         ...(image_list.length?{image_list}:{}),...(video_list.length?{video_list}:{})};
      }
      const frame=(role:'firstFrame'|'lastFrame')=>Buffer.from(input.visualInputs!.find(entry=>entry.role===role)!.image!).toString('base64');
      return {model_name:input.model,image:frame('firstFrame'),image_tail:frame('lastFrame'),prompt:input.prompt.trim(),mode:'std',duration:String(input.durationSeconds),sound:'off'};
    }
    return {model:input.model,content:[{type:'text',text:input.prompt.trim()},...visualContent],duration:input.durationSeconds,ratio:input.provider==='minimax'&&input.model==='MiniMax-H3-Lite'&&input.visualMode==='references'?requiredReferenceRatio(input.referenceRatio):'adaptive',resolution,
      ...(input.provider==='volcengine'?{generate_audio:false,watermark:false}:{})};
  }
  if(input.model===klingOmniModel)throw Error('可灵 Omni 需要参考素材。');
  if(!input.imageMime||!['image/png','image/jpeg'].includes(input.imageMime)||!input.image?.byteLength||input.image.byteLength>10*1024*1024)throw Error('首帧须为 10 MB 以内 PNG 或 JPEG。');
  const base64 = Buffer.from(input.image).toString('base64');
  if (input.provider === 'kling') return {model_name:input.model, image:base64, prompt:input.prompt.trim(), mode:'std', duration:String(input.durationSeconds), sound:'off'};
  const content = [{type:'text',text:input.prompt.trim()}, {type:'image_url',image_url:{url:`data:${input.imageMime};base64,${base64}`},role:'first_frame'}];
  return {model:input.model,content,duration:input.durationSeconds,ratio:'adaptive',resolution,...(input.provider === 'volcengine' ? {generate_audio:false,watermark:false} : {})};
}
function requiredReferenceRatio(value:VideoOutputRatio|undefined){if(!value||!videoOutputRatios.includes(value))throw Error('MiniMax-H3-Lite 参考素材生成需要明确的输出比例。');return value;}
export async function generateOfficialVideo(input: OfficialVideoInput): Promise<Uint8Array> {
  let body:ReturnType<typeof officialVideoBody>,endpoint:string;
  try{body=officialVideoBody(input);endpoint=videoEndpoint(input.provider,input.credentials);videoAuthorization(input.provider,input.credentials);}
  catch(error){throw new VideoGenerationError(error instanceof Error?error.message:'视频输入无效。','not_sent');}
  const label=input.provider==='minimax'?'MiniMax':videoProviders[input.provider].label;
  const headers = () => ({Authorization:videoAuthorization(input.provider,input.credentials),'Content-Type':'application/json'});
  const createPath = input.provider === 'volcengine' ? '/contents/generations/tasks' : input.provider === 'minimax' ? '/v2/video_generation' : input.model===klingOmniModel?klingOmniPath:'/v1/videos/image2video';
  const redact=(value:unknown)=>{
   let text=typeof value==='string'?value:'';
   for(const secret of [input.credentials,videoAuthorization(input.provider,input.credentials),input.provider==='minimax'?minimaxCredential(input.credentials).apiKey:''].filter(Boolean))text=text.split(secret).join('<REDACTED>');
   return text.replace(/Bearer\s+[^\s,;"']+/gi,'Bearer <REDACTED>').replace(/data:[^\s"']+/gi,'<MEDIA>').replace(/https?:\/\/[^\s"']+/gi,'<URL>').replace(/[\u0000-\u001f]/g,' ').slice(0,500);
  };
  const json = async (response:Response,phase:'提交'|'查询') => {
    let value;try{value=await response.json();}catch{/* Raw HTML/response bodies are never exposed. */}
    const legacyCode=value?.base_resp?.status_code,detail=redact(value?.error?.message??value?.base_resp?.status_msg??value?.message),request=value?.request_id;
    const failed=!response.ok||value?.type==='error'||input.provider==='minimax'&&legacyCode!==undefined&&legacyCode!==0||input.provider==='kling'&&value?.code!==0;
    if(failed){
     const code=legacyCode??value?.error?.type??(input.provider==='kling'?value?.code:undefined);
     const definite=isDefiniteProviderRejection(response.status)||response.ok&&([1002,1004,1008,1026,2013].includes(legacyCode)||isDefiniteProviderRejection(Number(value?.error?.http_code)));
     throw new VideoGenerationError(`${label} ${phase}失败（HTTP ${response.status}${code!==undefined?`，${redact(String(code))}`:''}）${detail?`：${detail}`:'。'}${typeof request==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(request)?` 请求编号 ${request}`:''}`,phase==='查询'?'accepted':definite?'rejected':'unknown');
    }
    if(!value||typeof value!=='object')throw new VideoGenerationError(`${label} ${phase}返回的内容无法解析。`,phase==='查询'?'accepted':'unknown');
    return value;
  };
  const query = input.provider === 'minimax' ? '/v2/query/video_generation/' : createPath+'/';
  let phase:'reservation'|'submission'|'registration'|'poll'|'download'='reservation';
  try{return await executeVideoTask({...input,recordSubmission:async id=>{phase='registration';await input.recordSubmission(id);}},{
    submit:async()=>{
      phase='submission';const value=await json(await input.fetcher(endpoint+createPath,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)}),'提交');
      return input.provider==='volcengine'?value.id:input.provider==='minimax'?value.task_id:value.data?.task_id;
    },
    query:async id=>{
      phase='poll';const value=await json(await input.fetcher(endpoint+query+encodeURIComponent(id),{headers:headers(),signal:AbortSignal.timeout(30_000)}),'查询');
      const task=input.provider==='volcengine'?value:input.provider==='minimax'?value.task:value.data;
      const status=input.provider==='kling'?task?.task_status:task?.status;
      if(status==='succeeded'||status==='succeed'){
        const url=input.provider==='volcengine'?task.content?.video_url:input.provider==='minimax'?task.content?.url:task.task_result?.videos?.[0]?.url;
        if(typeof url!=='string')throw Error('视频任务已完成但缺少下载地址。');
        phase='download';return{url};
      }
      if(!['queued','pending','running','submitted','processing'].includes(status))throw new VideoGenerationError(`${label} 视频任务${status==='failed'?'生成失败':'状态无法识别'}${redact(task?.error?.message??task?.error?.detail)?`：${redact(task?.error?.message??task?.error?.detail)}`:'，请沿用原任务核对。'}`,'accepted');
      return{phase:['queued','pending','submitted'].includes(status)?'queued':'processing'};
    },
    pollDelayMs:()=>10_000,
    download:{validateUrl:value=>officialVideoDownloadUrl(input.provider,value),invalidResponse:'视频下载不是有效 MP4。',tooLarge:'视频超过 100MB 限制。',empty:'下载视频为空。',redirectLimit:'视频下载重定向过多。'},
    errors:{unknownSubmission:'上次视频提交结果未知，请核对供应商记录。',invalidSubmittedId:'视频提交缺少有效任务 ID；禁止自动重提。',invalidSavedId:'供应商任务 ID 无效。',pollLimit:'视频仍在生成，请恢复原任务查询。'},
  });}catch(error){
    if(error instanceof VideoGenerationError||error instanceof ProviderOutcomeUnknownError)throw error;
    if(error instanceof Error&&error.message==='上次视频提交结果未知，请核对供应商记录。')throw new VideoGenerationError(`${label} ${error.message}`,'unknown');
    const stage=String(phase),known=error instanceof Error&&['视频提交缺少有效任务 ID；禁止自动重提。','供应商任务 ID 无效。','视频任务已完成但缺少下载地址。','视频下载不是有效 MP4。','视频超过 100MB 限制。','下载视频为空。','视频下载重定向过多。','视频下载地址不属于对应供应商。','视频仍在生成，请恢复原任务查询。'].includes(error.message)?error.message:null;
    const failure=new VideoGenerationError(`${label} ${stage==='reservation'?'本机费用预留失败':stage==='registration'?'任务编号保存失败':stage==='submission'?'提交未完成':stage==='download'?'视频下载失败':'任务查询失败'}：${known??(stage==='registration'?'供应商可能已受理，请核对原请求，不要重复生成。':stage==='reservation'?'请检查本机额度和任务状态。':redact(error instanceof Error?error.message:'连接中断或响应未完成，请核对原任务。'))}`,stage==='reservation'?'not_sent':stage==='submission'||stage==='registration'?'unknown':'accepted',{cause:error});
    if(error instanceof Error&&error.name==='TimeoutError')failure.name='TimeoutError';throw failure;
  }
}
