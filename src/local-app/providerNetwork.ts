import {VideoGenerationError} from '../worker/videoGenerationError.js';
import {isWanVideoRequest} from '../wanVideoModels.js';
import {imageSizes,openAiImageModels,openAiImageQualities} from '../imageGeneration.js';
import {isRetiredProvider} from '../worker/providerLifecycle.js';
import {isVideoProvider,type VideoProvider} from "../worker/videoProviderCatalog.js";
import {officialVideoOperation} from "./officialVideoNetwork.js";
import{openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,realpathSync,fsyncSync}from'node:fs';
import{join,isAbsolute}from'node:path';import{createHash,randomUUID}from'node:crypto';
import{request as httpsRequest}from'node:https';
import{Readable}from'node:stream';
import type{MediaFetcher}from'../worker/mediaProviders.js';
import{isDefiniteProviderRejection,ProviderOutcomeUnknownError}from'../worker/providerOutcome.js';
export type OnlineProvider='openai'|'cloudflare'|'pexels'|'freesound'|'google_tts'|'volcengine_tts'|'bailian'|'volcengine'|'minimax'|'kling';
type WorkspaceGenerationProvider='openai'|'bailian'|VideoProvider;
export function isWorkspaceGenerationProvider(provider:string):provider is WorkspaceGenerationProvider{
 return provider==='openai'||provider==='bailian'||isVideoProvider(provider);
}
export interface ProviderNetworkConfiguration{directory:string;policySha256:string}
interface TtsLimit{maxCharacters:number;voices:string[];languageCodes?:string[];resourceIds?:string[]}
interface Limit{maxRequests:number;maxBytes:number;timeoutMs:number;costMicrounits:number;tts?:TtsLimit}
interface Policy{purpose?:'connection-verification';issuedAt?:string;version:number;runId:string;enabled:boolean;expiresAt:string;maxRequests:number;currency:string;maxCostMicrounits:number;priceEvidenceSha256?:string;approvalSha256?:string;providers:OnlineProvider[];operations:Record<string,Limit>}
interface Event{operation:string;outcome:'reserved'|'completed'|'failed'|'unknown';status?:number;bytes?:number;timeoutMs?:number}
interface State{version:number;policySha256:string;used:number;costMicrounits:number;byOperation:Record<string,number>;halted:boolean;events:Event[]}
const providers=['openai','cloudflare','pexels','freesound','google_tts','volcengine_tts','bailian','volcengine','minimax','kling'];
const denied=()=>new Error('Provider request denied by private authorization or budget');
function integer(n:unknown,max:number){return Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;}
function stringChoices(value:unknown):value is string[]{return Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=200);}
function privateFile(path:string){const s=lstatSync(path);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||realpathSync(path)!==path)throw denied();}
function read(c:ProviderNetworkConfiguration){
 if(!isAbsolute(c.directory)||!c.policySha256?.match(/^[a-f0-9]{64}$/))throw denied();const d=lstatSync(c.directory);if(!d.isDirectory()||d.uid!==process.getuid?.()||(d.mode&0o077)!==0||realpathSync(c.directory)!==c.directory)throw denied();
 const path=join(c.directory,'policy.json');privateFile(path);const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==c.policySha256)throw denied();
 const p=JSON.parse(bytes.toString()) as Policy;
 const requestCeiling=Array.isArray(p.providers)&&p.providers.some(v=>v==='bailian'||isVideoProvider(v))?1000:20;
 if(p.version!==1||typeof p.runId!=='string'||!p.runId||typeof p.enabled!=='boolean'||!Number.isFinite(Date.parse(p.expiresAt))||!integer(p.maxRequests,requestCeiling)||!integer(p.maxCostMicrounits,1e12)||!Array.isArray(p.providers)||p.providers.some(x=>!providers.includes(x))||!p.operations||typeof p.operations!=='object')throw denied();
 for(const[k,v]of Object.entries(p.operations)){
  if(!(/^(openai|cloudflare|pexels|freesound|google_tts|volcengine_tts)\.(verify|generate|search|download)$/.test(k)||/^(bailian|volcengine|minimax|kling)\.(verify|generate|poll|download)$/.test(k))||!integer(v.maxRequests,requestCeiling)||!integer(v.maxBytes,(['bailian','volcengine','minimax','kling'].includes(k.split('.')[0])?100:20)*1024*1024)||!v.maxBytes||!integer(v.timeoutMs,60000)||(v.timeoutMs===0&&k!=='openai.generate')||!integer(v.costMicrounits,1e12))throw denied();
  if(v.tts!==undefined){
   const t=v.tts;
   if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(key=>!['maxCharacters','voices','languageCodes','resourceIds'].includes(key))||!integer(t.maxCharacters,5000)||!t.maxCharacters||!stringChoices(t.voices))throw denied();
   if(k==='google_tts.generate'){if(!stringChoices(t.languageCodes)||t.resourceIds!==undefined)throw denied();}
   else if(k==='volcengine_tts.generate'){if(!stringChoices(t.resourceIds)||t.languageCodes!==undefined)throw denied();}
   else throw denied();
  }
 }
 if(p.purpose==='connection-verification'){
  const issued=Date.parse(p.issuedAt??''),expires=Date.parse(p.expiresAt);
  if(!Number.isFinite(issued)||issued>Date.now()+5000||expires-issued>30*60*1000||expires<=issued||p.maxRequests>4||p.maxCostMicrounits!==0||p.currency!=='CNY'||p.providers.some(v=>!['bailian','freesound','volcengine','minimax','kling','pexels','openai'].includes(v))||Object.entries(p.operations).some(([k,v])=>!['bailian.verify','freesound.verify','volcengine.verify','minimax.verify','kling.verify','pexels.verify','openai.verify'].includes(k)||v.costMicrounits!==0||v.maxRequests>2)||!p.approvalSha256?.match(/^[a-f0-9]{64}$/))throw denied();
 }else if(p.purpose!==undefined)throw denied();
 if(p.purpose!=='connection-verification'&&p.enabled&&(!['USD','CNY'].includes(p.currency)||!p.maxCostMicrounits||!p.priceEvidenceSha256?.match(/^[a-f0-9]{64}$/)||!p.approvalSha256?.match(/^[a-f0-9]{64}$/)||Object.entries(p.operations).some(([k,v])=>(k.endsWith('.generate')||k==='volcengine_tts.verify')&&!v.costMicrounits)))throw denied();
 const statePath=join(c.directory,'state.json');privateFile(statePath);const s=JSON.parse(readFileSync(statePath,'utf8')) as State;
 if(s.version!==1||s.policySha256!==c.policySha256||!integer(s.used,p.maxRequests)||!integer(s.costMicrounits,p.maxCostMicrounits)||typeof s.halted!=='boolean'||!s.byOperation||!Array.isArray(s.events)||s.events.length>2*p.maxRequests)throw denied();
 for(const[k,n]of Object.entries(s.byOperation))if(!p.operations[k]||!integer(n,p.operations[k].maxRequests))throw denied();
 return{policy:p,state:s};
}
export function providerNetworkStatus(c:ProviderNetworkConfiguration,provider?:string){
 try{const {policy:p,state:s}=read(c);const reject=(code:string,detail:string)=>({available:false,code,detail:'测试未开始：'+detail+' 未发出 Provider 请求。'});
  if(!p.enabled)return reject('network_disabled','在线验证授权未启用。');
  if(Date.parse(p.expiresAt)<=Date.now())return reject('network_expired','在线验证授权已过期。');
  if(provider&&!p.providers.includes(provider as OnlineProvider))return reject('provider_not_authorized','此 Provider 不在当前验证授权范围内。');
  if(s.halted||s.events.at(-1)?.outcome==='unknown'||s.events.at(-1)?.outcome==='reserved')return reject('network_halted','上一请求异常或结果未确认，验证授权已暂停。');
  if(s.used>=p.maxRequests||provider&&(s.byOperation[provider+'.verify']??0)>=(p.operations[provider+'.verify']?.maxRequests??0))return reject('network_exhausted','在线验证额度已用完。');
  return {available:true,code:'available',detail:'可进行当前授权范围内的连接验证。'};
 }catch{return{available:false,code:'network_unavailable',detail:'测试未开始：本机验证授权不可用，未发出 Provider 请求。'};}
}
function persist(c:ProviderNetworkConfiguration,s:State){
 const temp=join(c.directory,randomUUID()+'.tmp'),fd=openSync(temp,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(s)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temp,join(c.directory,'state.json'));const dir=openSync(c.directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
function mayContinueAfterImageUnknown(policy:Policy,state:State){
 const last=state.events.at(-1);
 return last?.operation==='openai.generate'&&last.outcome==='unknown'&&policy.operations[last.operation]?.timeoutMs===0;
}
export function providerNetworkAvailable(c:ProviderNetworkConfiguration,provider?:string){
 try{
  const {policy,state}=read(c);
  if(!policy.enabled||Date.parse(policy.expiresAt)<=Date.now()||state.used>=policy.maxRequests)return false;
  if(state.halted||['reserved','unknown'].includes(state.events.at(-1)?.outcome??'')){
   if((provider&&provider!=='openai')||!mayContinueAfterImageUnknown(policy,state))return false;
   const limit=policy.operations['openai.generate'];
   return policy.providers.includes('openai')&&(state.byOperation['openai.generate']??0)<limit.maxRequests&&state.costMicrounits+limit.costMicrounits<=policy.maxCostMicrounits;
  }
  if(!provider)return true;
  if(!policy.providers.includes(provider as OnlineProvider))return false;
  return Object.entries(policy.operations).some(([operation,limit])=>
   operation.startsWith(provider+'.')&&!operation.endsWith('.verify')&&
   (state.byOperation[operation]??0)<limit.maxRequests&&state.costMicrounits+limit.costMicrounits<=policy.maxCostMicrounits);
 }catch{return false;}
}
export function openAiImageAuthorizationIssue(c:ProviderNetworkConfiguration){
 try{
  const {policy,state}=read(c),limit=policy.operations['openai.generate'];
  if(!policy.enabled||!policy.providers.includes('openai')||!limit)return '图片生成授权未启用，请更新本机授权后重试。';
  const last=state.events.at(-1)?.outcome;
  if(last==='reserved'&&!state.halted)return '已有图片请求正在处理，请稍后刷新。';
  if((state.halted||last==='unknown')&&!mayContinueAfterImageUnknown(policy,state))return '图片生成授权已暂停。请先核对上一笔请求，再更新本机授权并刷新。';
  if(Date.parse(policy.expiresAt)<=Date.now())return '图片生成授权已过期。请续期后刷新，再次确认生成。';
  if(state.used>=policy.maxRequests||(state.byOperation['openai.generate']??0)>=limit.maxRequests||state.costMicrounits+limit.costMicrounits>policy.maxCostMicrounits)return '图片生成授权次数已用完。请补充本机授权后刷新，再次确认生成。';
  return null;
 }catch{return '无法读取本机图片生成授权，请检查授权后刷新重试。';}
}
function requestOperation(provider:OnlineProvider,phase:'verify'|'execute',input:string|URL,init:RequestInit){
 if(isRetiredProvider(provider))throw denied();
 const u=new URL(input),method=(init.method??'GET').toUpperCase();if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)throw denied();
 if(isVideoProvider(provider))return provider+'.'+officialVideoOperation(provider,phase,u,init);
 let op='';const api=(host:string,path:string)=>u.hostname===host&&u.pathname===path;
 if(provider==='pexels'&&method==='GET'){
  if(phase==='verify'&&api('api.pexels.com','/v1/videos/search'))op='verify';
  if(phase==='execute'&&api('api.pexels.com','/v1/videos/search'))op='search';
  if(phase==='execute'&&['videos.pexels.com','images.pexels.com'].includes(u.hostname)&&!u.search)op='download';
 }else if(provider==='freesound'&&method==='GET'){
  if(api('freesound.org','/apiv2/search/'))op=phase==='verify'?'verify':'search';
  if(phase==='execute'&&u.hostname==='cdn.freesound.org'&&u.pathname.startsWith('/previews/')&&!u.search)op='download';
 }else if(provider==='openai'){
  if(phase==='verify'&&method==='GET'&&api('api.openai.com','/v1/models/gpt-image-2'))op='verify';
  if(phase==='execute'&&method==='POST'&&(api('api.openai.com','/v1/images/generations')||api('api.openai.com','/v1/images/edits')))op='generate';
 }else if(provider==='cloudflare'){
  if(u.hostname==='api.cloudflare.com'&&/^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\//.test(u.pathname)){
   if(phase==='verify'&&method==='GET'&&u.pathname.endsWith('/ai/models/search')&&u.searchParams.get('search')==='@cf/black-forest-labs/flux-1-schnell')op='verify';
   if(phase==='execute'&&method==='POST'&&u.pathname.endsWith('/ai/run/@cf/black-forest-labs/flux-1-schnell'))op='generate';
  }
 }else if(provider==='google_tts'){
  if(phase==='verify'&&method==='GET'&&api('texttospeech.googleapis.com','/v1/voices'))op='verify';
  if(phase==='execute'&&method==='POST'&&api('texttospeech.googleapis.com','/v1/text:synthesize'))op='generate';
 }else if(provider==='bailian'){
  const apiHost=u.hostname==='dashscope.aliyuncs.com'||/^ws-[a-z0-9]{8,64}\.cn-beijing\.maas\.aliyuncs\.com$/.test(u.hostname);
  if(apiHost&&method==='GET'&&phase==='verify'&&u.pathname==='/api/v1/models'&&u.searchParams.get('model')==='wan2.6-i2v-flash'&&[...u.searchParams.keys()].every(k=>['model','page_no','page_size'].includes(k)))op='verify';
  if(apiHost&&phase==='execute'&&method==='POST'&&u.pathname==='/api/v1/services/aigc/video-generation/video-synthesis'&&!u.search)op='generate';
  if(apiHost&&phase==='execute'&&method==='GET'&&/^\/api\/v1\/tasks\/[a-zA-Z0-9_-]{1,128}$/.test(u.pathname)&&!u.search)op='poll';
  if(phase==='execute'&&method==='GET'&&(['dashscope-a717.oss-accelerate.aliyuncs.com','dashscope-f4de.oss-accelerate.aliyuncs.com','dashscope-7c2c.oss-cn-shanghai.aliyuncs.com'].includes(u.hostname)||/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname))&&!new Headers(init.headers).has('Authorization'))op='download';
 }else if(provider==='volcengine_tts'&&method==='POST'&&api('openspeech.bytedance.com','/api/v3/tts/unidirectional/sse'))op=phase==='verify'?'verify':'generate';
 if(!op)throw denied();
 if(method==='POST'){
  if(typeof init.body!=='string'||Buffer.byteLength(init.body)>(provider==='bailian'?28*1024*1024:provider==='openai'?64*1024*1024:16384))throw denied();const b=JSON.parse(init.body);
  if(provider==='bailian'&&!isWanVideoRequest(b))throw denied();
  if(provider==='openai'&&(!openAiImageModels.includes(b.model)||!imageSizes.includes(b.size)||b.output_format!=='png'||b.n!==undefined&&![1,2,4].includes(b.n)||typeof b.prompt!=='string'||b.prompt.length>1200||b.quality!==undefined&&!openAiImageQualities(b.model).includes(b.quality)||b.images!==undefined&&(!Array.isArray(b.images)||!b.images.length||b.images.length>16||b.images.some((r:{image_url?:unknown})=>typeof r.image_url!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(r.image_url)))))throw denied();
  if(provider==='cloudflare'&&(b.steps!==4||typeof b.prompt!=='string'||b.prompt.length>1200))throw denied();
  if(provider==='google_tts'&&(typeof b.input?.text!=='string'||!b.input.text.trim()||b.audioConfig?.audioEncoding!=='MP3'))throw denied();
  if(provider==='volcengine_tts'&&(typeof b.req_params?.text!=='string'||!b.req_params.text.trim()))throw denied();
 }
 return provider+'.'+op;
}
function assertTtsRequest(provider:OnlineProvider,init:RequestInit,limit:Limit){
 if(provider!=='google_tts'&&provider!=='volcengine_tts'||(init.method??'GET').toUpperCase()!=='POST')return;
 const b=JSON.parse(String(init.body)),google=provider==='google_tts',text=google?b.input.text:b.req_params.text,voice=google?b.voice?.name:b.req_params.speaker;
 // Existing signed acceptance policies keep their original envelope. Ordinary
 // production can opt into explicit limits without rewriting old ledgers.
 const rules=limit.tts??(google?{maxCharacters:10,voices:['cmn-CN-Standard-A'],languageCodes:['zh-CN']}:{maxCharacters:10,voices:['zh_female_vv_uranus_bigtts'],resourceIds:['seed-tts-2.0']});
 if(Array.from(text).length>rules.maxCharacters||!rules.voices.includes(voice)||(google?!rules.languageCodes?.includes(b.voice?.languageCode):!rules.resourceIds?.includes(new Headers(init.headers).get('X-Api-Resource-Id')??'')))throw denied();
}
// Native fetch has HTTP header/body timeouts even without an AbortSignal deadline.
const waitForImageResponse:MediaFetcher=(url,init)=>new Promise((resolve,reject)=>{
 const headers=new Headers(init?.headers);
 headers.set('accept-encoding','identity');
 const request=httpsRequest(url,{method:init?.method,headers:Object.fromEntries(headers),signal:init?.signal??undefined,agent:false,timeout:0},incoming=>{
  try{
   const status=incoming.statusCode!;
   const noBody=status===204||status===205||status===304;
   if(noBody)incoming.resume();
   resolve(new Response(noBody?null:Readable.toWeb(incoming) as ReadableStream<Uint8Array>,{status,headers:incoming.headers as HeadersInit}));
  }catch(error){incoming.destroy();reject(error);}
 });
 request.once('error',reject);
 request.end(init?.body as string);
});
async function readProviderResponse(r:Response,maxBytes:number){
 if(r.status>=300&&r.status<400)throw denied();
 const declared=r.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw denied();
 const chunks:Uint8Array[]=[];let bytes=0;const reader=r.body?.getReader();
 if(reader)while(true){
  const next=await reader.read();if(next.done)break;
  bytes+=next.value.byteLength;
  if(bytes>maxBytes){await reader.cancel();throw denied();}
  chunks.push(next.value);
 }
 const body=Buffer.concat(chunks);
 return {response:new Response([204,205,304].includes(r.status)?null:body,{status:r.status,headers:{'content-type':r.headers.get('content-type')??'application/octet-stream'}}),bytes};
}

// The Owner's confirmed request is reserved in PostgreSQL before any paid
// dispatch. Video status and result reads are bound to the recorded task ID.
export function createWorkspaceGenerationFetcher(provider:WorkspaceGenerationProvider|'volcengine_tts',authorization:{reserve:()=>Promise<void>;videoTaskId?:()=>string|undefined;speech?:{text:string;voice:string;model:string}},transport:MediaFetcher=provider==='openai'?waitForImageResponse:fetch):MediaFetcher{
 let started=false;
 return async(input,init={})=>{
  let operation:string;try{operation=requestOperation(provider,'execute',input,init);}catch(error){if(isVideoProvider(provider)&&init.method==='POST')throw error instanceof VideoGenerationError?error:new VideoGenerationError('本机视频请求校验未通过，未向供应商发送。','not_sent');throw error;}
  const generate=operation===provider+'.generate',download=operation===provider+'.download';
  if(init.signal?.aborted)throw denied();
  if(generate){
   if(started)throw denied();
   if(provider==='volcengine_tts'){
    const speech=authorization.speech,request=JSON.parse(String(init.body)).req_params;
    if(!speech||request.text!==speech.text.trim()||request.speaker!==speech.voice||new Headers(init.headers).get('X-Api-Resource-Id')!==speech.model)throw denied();
   }
   started=true;
   await authorization.reserve();
  }else{
   const id=authorization.videoTaskId?.();
   const poll=operation===provider+'.poll'&&new URL(input).pathname.endsWith('/'+id);
   if(provider==='openai'||provider==='volcengine_tts'||!id||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!poll&&!download)throw denied();
  }
  const controller=new AbortController(),signal=init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal;
  try{
   const response=await transport(input,{...init,redirect:'manual',signal});
   const maxBytes=(provider==='openai'?64:provider==='volcengine_tts'?20:download?100:1)*1024*1024;
   return (await readProviderResponse(response,maxBytes)).response;
  }catch(error){
   if(generate){
    const failure=error as {name?:string;code?:string;cause?:{code?:string}},code=failure?.cause?.code??failure?.code;
    const reason=signal.aborted||failure?.name==='TimeoutError'?'供应商响应超时':code&&['ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(code)?`网络连接异常：${code}`:'网络连接中断或响应未完整收到';
    throw new ProviderOutcomeUnknownError(undefined,reason);
   }
   throw error;
  }finally{controller.abort();}
 };
}

// A queued workspace lookup may read each registered endpoint at most once.
export function createWorkspaceSearchFetcher(provider:'pexels'|'freesound',operations:readonly ('search'|'download')[],transport:MediaFetcher=fetch):MediaFetcher{
 const remaining=new Set(operations.map(operation=>provider+'.'+operation));
 return async(input,init={})=>{
  const operation=requestOperation(provider,'execute',input,init);
  if(init.signal?.aborted||!remaining.delete(operation))throw denied();
  const deadline=AbortSignal.timeout(30000);
  const signal=init.signal?AbortSignal.any([init.signal,deadline]):deadline;
  const response=await transport(input,{...init,redirect:'manual',signal});
  return (await readProviderResponse(response,(operation.endsWith('.search')?2:provider==='pexels'?100:20)*1024*1024)).response;
 };
}

// A fenced Worker continues an already accepted video. Only configured
// zero-cost status/result reads can outlive the new-submission allowance.
export function createVideoContinuationFetcher(c:ProviderNetworkConfiguration,provider:OnlineProvider,providerTaskId:string,transport:MediaFetcher=fetch):MediaFetcher{
 return async(input,init={})=>{
  if(provider!=='bailian'&&!isVideoProvider(provider))throw denied();
  const operation=requestOperation(provider,'execute',input,init),{policy}=read(c),limit=policy.operations[operation];
  const polling=operation===provider+'.poll'&&new URL(input).pathname.endsWith('/'+providerTaskId);
  const downloading=operation===provider+'.download';
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(providerTaskId)||(!polling&&!downloading)||!policy.enabled||!policy.providers.includes(provider)||limit?.costMicrounits!==0||!limit.maxRequests)throw denied();
  const deadline=AbortSignal.timeout(limit.timeoutMs);
  const signal=init.signal?AbortSignal.any([deadline,init.signal]):deadline;
  return (await readProviderResponse(await transport(input,{...init,redirect:'manual',signal}),limit.maxBytes)).response;
 };
}
// The private lock is held until the outcome is durable. A crashed owner leaves it in place;
// there is no stale-lock takeover or automatic refund of a possibly sent request.
export function createProviderFetcher(c:ProviderNetworkConfiguration,provider:OnlineProvider,phase:'verify'|'execute',transport?:MediaFetcher,acceptResponse?:(response:Response)=>Promise<boolean>,beforeDispatch?:()=>Promise<void>):MediaFetcher{
 return async(input,init={})=>{
  const operation=requestOperation(provider,phase,input,init);
  const confirmedImage=operation==='openai.generate'&&!!beforeDispatch;
  if(init.signal?.aborted)throw denied();
  const prior=read(c),priorOutcome=prior.state.events.at(-1)?.outcome;
  if(priorOutcome==='reserved'||priorOutcome==='unknown'&&!(confirmedImage&&mayContinueAfterImageUnknown(prior.policy,prior.state)))throw new ProviderOutcomeUnknownError();
  const lock=join(c.directory,'request.lock');let fd:number|undefined;const end=Date.now()+2000;
  while(fd===undefined){if(init.signal?.aborted)throw denied();try{fd=openSync(lock,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>=end)throw denied();await new Promise(r=>setTimeout(r,10));}}
  let reserved=false,dispatched=false;let state:State|undefined,timeoutMs:number|undefined;
  try{
   const{policy:p,state:s}=read(c);state=s;const limit=p.operations[operation];
   const continuing=confirmedImage&&mayContinueAfterImageUnknown(p,s),last=s.events.at(-1)?.outcome;
   if(last==='reserved'||last==='unknown'&&!continuing)throw new ProviderOutcomeUnknownError();
   if(!p.enabled||Date.parse(p.expiresAt)<=Date.now()||!p.providers.includes(provider)||s.halted&&!continuing||!limit||s.used>=p.maxRequests||(s.byOperation[operation]??0)>=limit.maxRequests||s.costMicrounits+limit.costMicrounits>p.maxCostMicrounits)throw denied();
   assertTtsRequest(provider,init,limit);
   await beforeDispatch?.();
   if(continuing)s.halted=false;
   s.used++;s.costMicrounits+=limit.costMicrounits;s.byOperation[operation]=(s.byOperation[operation]??0)+1;s.events.push({operation,outcome:'reserved'});persist(c,s);reserved=true;
   const controller=new AbortController(),signal=init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal;let timer:ReturnType<typeof setTimeout>|undefined;let onAbort:()=>void=()=>{};
   try{
    const response=await Promise.race([ (async()=>{
     const send=transport??(limit.timeoutMs===0?waitForImageResponse:fetch);
     if(signal.aborted)throw denied();dispatched=true;
     return readProviderResponse(await send(input,{...init,redirect:'manual',signal}),limit.maxBytes);
    })(),new Promise<never>((_,reject)=>{onAbort=()=>reject(denied());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();if(limit.timeoutMs>0)timer=setTimeout(()=>{timeoutMs=limit.timeoutMs;controller.abort();},limit.timeoutMs);})]);
    const valid=acceptResponse?await acceptResponse(response.response.clone()):true,accepted=response.response.ok&&valid;
    const rejected=operation==='openai.generate'&&isDefiniteProviderRejection(response.response.status);
    s.events.push({operation,outcome:accepted?'completed':confirmedImage&&!rejected?'unknown':'failed',status:response.response.status,bytes:response.bytes});
    if(!accepted&&!rejected)s.halted=true;
    persist(c,s);return response.response;
   }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);controller.abort();}
  }catch(error){
   if(reserved&&state){
    state.halted=true;
    if(state.events.at(-1)?.outcome==='reserved')state.events.push({
     operation,outcome:dispatched?'unknown':'failed',...(timeoutMs===undefined?{}:{timeoutMs})
    });
    persist(c,state);
   }
   if(error instanceof ProviderOutcomeUnknownError)throw error;
   if(reserved&&dispatched)throw new ProviderOutcomeUnknownError(timeoutMs);
   throw denied();
  }
  finally{closeSync(fd);unlinkSync(lock);}
 };
}

// Owner-triggered connection tests have no expiring production budget. This port
// permits one registered verification request, never a content-generation route.
export function createManualVerificationFetcher(provider:OnlineProvider,transport:MediaFetcher=fetch):MediaFetcher{
 let sent=false;
 return async(input,init={})=>{
  if(sent||requestOperation(provider,'verify',input,init)!==provider+'.verify'||init.signal?.aborted)throw denied();
  if(provider==='volcengine_tts'){
   assertTtsRequest(provider,init,{maxRequests:1,maxBytes:1024*1024,timeoutMs:15000,costMicrounits:0});
   if(JSON.parse(String(init.body)).req_params.text!=='这是一条测试。')throw denied();
  }
  sent=true;
  const controller=new AbortController(),signal=init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal;
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
  try{
   return await Promise.race([(async()=>{
    if(signal.aborted)throw denied();
    const response=await transport(input,{...init,redirect:'manual',signal});
    if(response.status>=300&&response.status<400)throw denied();
    const declared=response.headers.get('content-length'),maxBytes=1024*1024;
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw denied();
    const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body?.getReader();
    if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw denied();}chunks.push(part.value);}
    return new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/octet-stream'}});
   })(),new Promise<never>((_,reject)=>{onAbort=()=>reject(denied());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();timer=setTimeout(()=>controller.abort(),15000);})]);
  }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);controller.abort();}
 };
}
