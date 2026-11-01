import {createHmac} from 'node:crypto';
import type {MediaFetcher} from './mediaProviders.js';
import type {WanReservation} from './wanVideoProvider.js';
import {videoProviders,minimaxEndpoints,type MiniMaxRegion, type VideoProvider} from './videoProviderCatalog.js';

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
export interface OfficialVideoInput {
  provider: VideoProvider; model: string; credentials: string; fetcher: MediaFetcher;
  image: Uint8Array; imageMime: string; prompt: string; durationSeconds: number;
  reserve: () => Promise<WanReservation>; recordSubmission: (taskId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>; maxPolls?: number;
}
export function officialVideoBody(input: Pick<OfficialVideoInput,'provider'|'model'|'image'|'imageMime'|'prompt'|'durationSeconds'>) {
  const p = videoProviders[input.provider];
  if (!(p.models as readonly string[]).includes(input.model) || !Number.isInteger(input.durationSeconds) || input.durationSeconds < p.minDuration || input.durationSeconds > p.maxDuration || !input.prompt.trim() || input.prompt.length > 1500 || !['image/png','image/jpeg'].includes(input.imageMime) || !input.image.byteLength || input.image.byteLength > 10*1024*1024) throw Error('视频模型、首帧、提示词或时长无效；首帧须为 10MB 以内 PNG/JPEG。');
  const base64 = Buffer.from(input.image).toString('base64');
  if (input.provider === 'kling') return {model_name:input.model, image:base64, prompt:input.prompt.trim(), mode:'std', duration:String(input.durationSeconds), sound:'off'};
  const content = [{type:'text',text:input.prompt.trim()}, {type:'image_url',image_url:{url:`data:${input.imageMime};base64,${base64}`},role:'first_frame'}];
  return {model:input.model,content,duration:input.durationSeconds,ratio:'adaptive',resolution:input.provider === 'minimax' ? '768P' : '720p',...(input.provider === 'volcengine' ? {generate_audio:false,watermark:false} : {})};
}
const taskIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
export async function generateOfficialVideo(input: OfficialVideoInput): Promise<Uint8Array> {
  const body = officialVideoBody(input), endpoint=videoEndpoint(input.provider,input.credentials);
  const headers = () => ({Authorization:videoAuthorization(input.provider,input.credentials),'Content-Type':'application/json'});
  // Validate credentials before reserving. Unknown submissions never create a second task.
  headers();
  const reservation = await input.reserve();
  let id = reservation.provider_task_id ?? '';
  if (!reservation.new && !id) throw Error('上次视频提交结果未知，请核对供应商记录。');
  const createPath = input.provider === 'volcengine' ? '/contents/generations/tasks' : input.provider === 'minimax' ? '/v2/video_generation' : '/v1/videos/image2video';
  const json = async (response: Response) => {
    if (!response.ok) throw Error(`视频接口请求失败：HTTP ${response.status}。`);
    const value = await response.json();
    if (!value || typeof value !== 'object' || input.provider === 'kling' && value.code !== 0) throw Error('视频接口响应无效。');
    return value;
  };
  if (!id) {
    const value = await json(await input.fetcher(endpoint+createPath,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}));
    id = input.provider === 'volcengine' ? value.id : input.provider === 'minimax' ? value.task_id : value.data?.task_id;
    if (typeof id !== 'string' || !taskIdPattern.test(id)) throw Error('视频提交缺少有效任务 ID；禁止自动重提。');
    await input.recordSubmission(id);
  }
  if (!taskIdPattern.test(id)) throw Error('供应商任务 ID 无效。');
  const query = input.provider === 'minimax' ? '/v2/query/video_generation/' : createPath+'/';
  for (let attempt=0; attempt<(input.maxPolls ?? 90); attempt++) {
    const value = await json(await input.fetcher(endpoint+query+encodeURIComponent(id),{headers:headers(),signal:AbortSignal.timeout(30000)}));
    const task = input.provider === 'volcengine' ? value : input.provider === 'minimax' ? value.task : value.data;
    const status = input.provider === 'kling' ? task?.task_status : task?.status;
    if (status === 'succeeded' || status === 'succeed') {
      const url = input.provider === 'volcengine' ? task.content?.video_url : input.provider === 'minimax' ? task.content?.url : task.task_result?.videos?.[0]?.url;
      if (typeof url !== 'string') throw Error('视频任务已完成但缺少下载地址。');
      return download(input.provider,input.fetcher,url);
    }
    if (!['queued','pending','running','submitted','processing'].includes(status)) throw Error('视频任务失败或状态未知；请沿用原任务核对。');
    await (input.sleep ?? (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(10000);
  }
  throw Error('视频仍在生成，请恢复原任务查询。');
}
async function download(provider: VideoProvider, fetcher: MediaFetcher, value: string): Promise<Uint8Array> {
  let url = officialVideoDownloadUrl(provider,value);
  for (let redirects=0; redirects<4; redirects++) {
    const response = await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
    if ([301,302,303,307,308].includes(response.status)) {url=officialVideoDownloadUrl(provider,new URL(response.headers.get('location')??'',url).href);continue;}
    const limit=100*1024*1024;
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('video/mp4') || Number(response.headers.get('content-length'))>limit || !response.body) throw Error('视频下载不是有效 MP4。');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw Error('视频超过 100MB 限制。');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    if(!size)throw Error('下载视频为空。');return Uint8Array.from(Buffer.concat(chunks));
  }
  throw Error('视频下载重定向过多。');
}
