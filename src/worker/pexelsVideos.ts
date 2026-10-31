import type {MediaFetcher} from './mediaProviders.js';
export class PexelsVideoError extends Error {}
export interface PexelsVideoParameters {orientation:'portrait'|'landscape'|'square';size:'large'|'medium'|'small';page:number}
export interface PexelsVideoSource {id:number;fileId:number;durationSeconds:number;width:number;height:number;creator:string;creatorUrl:string;sourceUrl:string;downloadUrl:string}
export interface PexelsVideoRequest {operation:'search'|'preview';parameters:PexelsVideoParameters;source?:PexelsVideoSource}
export function pexelsUrl(value:unknown,kind:'media'|'source'){
 if(typeof value!=='string'||value.length>2048)throw new PexelsVideoError('Pexels 返回的网址无效。');
 const u=new URL(value),hosts=kind==='media'?['videos.pexels.com','images.pexels.com']:['www.pexels.com','pexels.com'];
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname)||u.hash)throw new PexelsVideoError('Pexels 返回了不受支持的来源或下载网址。');return u.toString();
}
async function boundedResponse(fetcher:MediaFetcher,url:string,init:RequestInit,limit:number,mime:string){
 const controller=new AbortController();let timedOut:()=>void=()=>{};const deadline=new Promise<never>((_,reject)=>{timedOut=()=>reject(new PexelsVideoError('Pexels 请求超时。'));}),timer=setTimeout(()=>{controller.abort();timedOut();},30000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await Promise.race([fetcher(url,{...init,signal:controller.signal,redirect:'error'}),deadline]);
  if(!response.ok)throw new PexelsVideoError(`Pexels 请求失败：HTTP ${response.status}。`);
  if(response.url&&response.url!==url)throw new PexelsVideoError('Pexels 响应跳转未获允许。');
  if(!(response.headers.get('content-type')??'').toLowerCase().startsWith(mime)||Number(response.headers.get('content-length')??0)>limit||!response.body)throw new PexelsVideoError('Pexels 响应格式或大小无效。');
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.length;if(size>limit)throw new PexelsVideoError('Pexels 文件超过大小限制。');chunks.push(part.value);}
  if(!size)throw new PexelsVideoError('Pexels 响应为空。');return Buffer.concat(chunks,size);
 }catch(error){if(error instanceof PexelsVideoError)throw error;throw new PexelsVideoError('Pexels 网络请求失败，请检查连接后重试。');}finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
}
export function validatePexelsSource(value:unknown):PexelsVideoSource{
 const s=value as PexelsVideoSource;if(!s||!Number.isSafeInteger(s.id)||s.id<=0||!Number.isSafeInteger(s.fileId)||s.fileId<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0||s.durationSeconds>7200||![s.width,s.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||typeof s.creator!=='string'||!s.creator.trim()||s.creator.length>200)throw new PexelsVideoError('Pexels 素材信息无效。');
 return {id:s.id,fileId:s.fileId,durationSeconds:s.durationSeconds,width:s.width,height:s.height,creator:s.creator,creatorUrl:pexelsUrl(s.creatorUrl,'source'),sourceUrl:pexelsUrl(s.sourceUrl,'source'),downloadUrl:pexelsUrl(s.downloadUrl,'media')};
}
export async function queryPexelsVideos(input:{apiKey:string;fetcher:MediaFetcher;query:string;parameters:PexelsVideoParameters}):Promise<PexelsVideoSource[]>{
 const {parameters:p}=input;if(!input.apiKey.trim()||!input.query.trim()||input.query.length>100||!['portrait','landscape','square'].includes(p.orientation)||!['large','medium','small'].includes(p.size)||!Number.isInteger(p.page)||p.page<1||p.page>100)throw new PexelsVideoError('Pexels 检索参数无效。');
 const endpoint=new URL('https://api.pexels.com/v1/videos/search');for(const [k,v] of Object.entries({query:input.query,orientation:p.orientation,size:p.size,page:String(p.page),per_page:'15'}))endpoint.searchParams.set(k,v);
 const bytes=await boundedResponse(input.fetcher,endpoint.toString(),{headers:{Authorization:input.apiKey,Accept:'application/json'}},512*1024,'application/json');let payload:Record<string,any>;try{payload=JSON.parse(bytes.toString('utf8'));}catch{throw new PexelsVideoError('Pexels 检索响应不是有效 JSON。');}
 if(!payload||!Array.isArray(payload.videos)||payload.videos.length>80)throw new PexelsVideoError('Pexels 检索响应无效。');
 return payload.videos.slice(0,15).map((v:Record<string,any>)=>{
  if(!v||!Array.isArray(v.video_files)||!v.user)throw new PexelsVideoError('Pexels 素材信息不完整。');
  const files=v.video_files.filter((f:Record<string,any>)=>f.file_type==='video/mp4'&&f.width>0&&f.height>0&&f.width<=4096&&f.height<=4096).sort((a:Record<string,any>,b:Record<string,any>)=>Math.abs(Math.max(a.width,a.height)-1280)-Math.abs(Math.max(b.width,b.height)-1280));
  const f=files[0];if(!f)throw new PexelsVideoError('Pexels 结果缺少可预览的 MP4。');
  return validatePexelsSource({id:v.id,fileId:f.id,durationSeconds:v.duration,width:f.width,height:f.height,creator:v.user.name,creatorUrl:v.user.url,sourceUrl:v.url,downloadUrl:f.link});
 });
}
export async function downloadPexelsVideo(fetcher:MediaFetcher,source:PexelsVideoSource){
 const s=validatePexelsSource(source);const bytes=await boundedResponse(fetcher,s.downloadUrl,{},100*1024*1024,'video/mp4');
 if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw new PexelsVideoError('Pexels 下载文件不是有效 MP4。');return bytes;
}
