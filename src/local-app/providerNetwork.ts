import {isRetiredProvider} from '../worker/providerLifecycle.js';
import {isVideoProvider} from "../worker/videoProviderCatalog.js";
import {officialVideoOperation} from "./officialVideoNetwork.js";
import{openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,realpathSync,fsyncSync}from'node:fs';
import{join,isAbsolute}from'node:path';import{createHash,randomUUID}from'node:crypto';
import type{MediaFetcher}from'../worker/mediaProviders.js';
import{ProviderOutcomeUnknownError}from'../worker/providerOutcome.js';
export type OnlineProvider='openai'|'cloudflare'|'pexels'|'freesound'|'google_tts'|'volcengine_tts'|'bailian'|'volcengine'|'minimax'|'kling';
export interface ProviderNetworkConfiguration{directory:string;policySha256:string}
interface TtsLimit{maxCharacters:number;voices:string[];languageCodes?:string[];resourceIds?:string[]}
interface Limit{maxRequests:number;maxBytes:number;timeoutMs:number;costMicrounits:number;tts?:TtsLimit}
interface Policy{purpose?:'connection-verification';issuedAt?:string;version:number;runId:string;enabled:boolean;expiresAt:string;maxRequests:number;currency:string;maxCostMicrounits:number;priceEvidenceSha256?:string;approvalSha256?:string;providers:OnlineProvider[];operations:Record<string,Limit>}
interface Event{operation:string;outcome:'reserved'|'completed'|'failed'|'unknown';status?:number;bytes?:number}
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
  if(!(/^(openai|cloudflare|pexels|freesound|google_tts|volcengine_tts)\.(verify|generate|search|download)$/.test(k)||/^(bailian|volcengine|minimax|kling)\.(verify|generate|poll|download)$/.test(k))||!integer(v.maxRequests,requestCeiling)||!integer(v.maxBytes,(['bailian','volcengine','minimax','kling'].includes(k.split('.')[0])?100:20)*1024*1024)||!v.maxBytes||!integer(v.timeoutMs,60000)||!v.timeoutMs||!integer(v.costMicrounits,1e12))throw denied();
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
export function providerNetworkAvailable(c:ProviderNetworkConfiguration){try{const{policy:p,state:s}=read(c);return p.enabled&&Date.parse(p.expiresAt)>Date.now()&&!s.halted&&s.events.at(-1)?.outcome!=='reserved'&&s.used<p.maxRequests;}catch{return false;}}
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
  if(phase==='verify'&&method==='GET'&&api('api.openai.com','/v1/models/gpt-image-1'))op='verify';
  if(phase==='execute'&&method==='POST'&&api('api.openai.com','/v1/images/generations'))op='generate';
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
  if(phase==='execute'&&method==='GET'&&(u.hostname==='dashscope-a717.oss-accelerate.aliyuncs.com'||/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname))&&!new Headers(init.headers).has('Authorization'))op='download';
 }else if(provider==='volcengine_tts'&&method==='POST'&&api('openspeech.bytedance.com','/api/v3/tts/unidirectional/sse'))op=phase==='verify'?'verify':'generate';
 if(!op)throw denied();
 if(method==='POST'){
  if(typeof init.body!=='string'||Buffer.byteLength(init.body)>(provider==='bailian'?28*1024*1024:16384))throw denied();const b=JSON.parse(init.body);
  if(provider==='bailian'&&(b.model!=='wan2.6-i2v-flash'||typeof b.input?.prompt!=='string'||!b.input.prompt.trim()||b.input.prompt.length>1500||typeof b.input?.img_url!=='string'||!/^data:image\/(png|jpeg|webp|bmp);base64,/.test(b.input.img_url)||!Number.isInteger(b.parameters?.duration)||b.parameters.duration<2||b.parameters.duration>15||b.parameters.resolution!=='720P'||b.parameters.audio!==false||b.parameters.prompt_extend!==false||b.parameters.watermark!==false))throw denied();
  if(provider==='openai'&&(b.model!=='gpt-image-1'||b.size!=='1024x1536'||b.output_format!=='png'||b.n!==undefined&&b.n!==1||typeof b.prompt!=='string'||b.prompt.length>1200))throw denied();
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
// The private lock is held until the outcome is durable. A crashed owner leaves it in place;
// there is no stale-lock takeover or automatic refund of a possibly sent request.
export function createProviderFetcher(c:ProviderNetworkConfiguration,provider:OnlineProvider,phase:'verify'|'execute',transport:MediaFetcher=fetch,acceptResponse?:(response:Response)=>Promise<boolean>):MediaFetcher{
 return async(input,init={})=>{
  const operation=requestOperation(provider,phase,input,init);if(init.signal?.aborted)throw denied();const prior=read(c).state.events.at(-1)?.outcome;if(prior==='reserved'||prior==='unknown')throw new ProviderOutcomeUnknownError();const lock=join(c.directory,'request.lock');let fd:number|undefined;const end=Date.now()+2000;
  while(fd===undefined){if(init.signal?.aborted)throw denied();try{fd=openSync(lock,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>=end)throw denied();await new Promise(r=>setTimeout(r,10));}}
  let reserved=false,dispatched=false;let state:State|undefined;
  try{
   const{policy:p,state:s}=read(c);state=s;const limit=p.operations[operation];if(s.events.at(-1)?.outcome==='reserved'||s.events.at(-1)?.outcome==='unknown')throw new ProviderOutcomeUnknownError();
   if(!p.enabled||Date.parse(p.expiresAt)<=Date.now()||!p.providers.includes(provider)||s.halted||!limit||s.used>=p.maxRequests||(s.byOperation[operation]??0)>=limit.maxRequests||s.costMicrounits+limit.costMicrounits>p.maxCostMicrounits)throw denied();
   assertTtsRequest(provider,init,limit);
   s.used++;s.costMicrounits+=limit.costMicrounits;s.byOperation[operation]=(s.byOperation[operation]??0)+1;s.events.push({operation,outcome:'reserved'});persist(c,s);reserved=true;
   const controller=new AbortController(),signal=init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal;let timer:ReturnType<typeof setTimeout>|undefined;let onAbort:()=>void=()=>{};
   try{
    const response=await Promise.race([ (async()=>{
     if(signal.aborted)throw denied();dispatched=true;const r=await transport(input,{...init,redirect:'manual',signal});if(r.status>=300&&r.status<400)throw denied();
     const declared=r.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit.maxBytes))throw denied();
     const chunks:Uint8Array[]=[];let bytes=0;const reader=r.body?.getReader();
     if(reader)while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit.maxBytes){await reader.cancel();throw denied();}chunks.push(next.value);}
     const body=Buffer.concat(chunks);return{response:new Response([204,205,304].includes(r.status)?null:body,{status:r.status,headers:{'content-type':r.headers.get('content-type')??'application/octet-stream'}}),bytes};
    })(),new Promise<never>((_,reject)=>{onAbort=()=>reject(denied());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();timer=setTimeout(()=>controller.abort(),limit.timeoutMs);})]);
    const valid=acceptResponse?await acceptResponse(response.response.clone()):true,accepted=response.response.ok&&valid;s.events.push({operation,outcome:accepted?'completed':'failed',status:response.response.status,bytes:response.bytes});if(!accepted)s.halted=true;persist(c,s);return response.response;
   }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);controller.abort();}
  }catch(error){if(reserved&&state){state.halted=true;if(state.events.at(-1)?.outcome==='reserved')state.events.push({operation,outcome:dispatched?'unknown':'failed'});persist(c,state);}throw error instanceof ProviderOutcomeUnknownError||reserved&&dispatched?new ProviderOutcomeUnknownError():denied();}
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
