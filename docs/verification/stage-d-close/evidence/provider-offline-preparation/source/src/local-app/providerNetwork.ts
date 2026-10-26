import{openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,realpathSync,fsyncSync}from'node:fs';
import{join,isAbsolute}from'node:path';import{createHash,randomUUID}from'node:crypto';
import type{MediaFetcher}from'../worker/mediaProviders.js';
export type OnlineProvider='openai'|'cloudflare'|'pexels'|'freesound'|'google_tts'|'volcengine_tts';
export interface ProviderNetworkConfiguration{directory:string;policySha256:string}
interface Limit{maxRequests:number;maxBytes:number;timeoutMs:number;costMicrounits:number}
interface Policy{version:number;runId:string;enabled:boolean;expiresAt:string;maxRequests:number;currency:string;maxCostMicrounits:number;priceEvidenceSha256?:string;approvalSha256?:string;providers:OnlineProvider[];operations:Record<string,Limit>}
interface Event{operation:string;outcome:'reserved'|'completed'|'failed';status?:number;bytes?:number}
interface State{version:number;policySha256:string;used:number;costMicrounits:number;byOperation:Record<string,number>;halted:boolean;events:Event[]}
const providers=['openai','cloudflare','pexels','freesound','google_tts','volcengine_tts'];
const denied=()=>new Error('Provider request denied by private authorization or budget');
function integer(n:unknown,max:number){return Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;}
function privateFile(path:string){const s=lstatSync(path);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||realpathSync(path)!==path)throw denied();}
function read(c:ProviderNetworkConfiguration){
 if(!isAbsolute(c.directory)||!c.policySha256?.match(/^[a-f0-9]{64}$/))throw denied();const d=lstatSync(c.directory);if(!d.isDirectory()||d.uid!==process.getuid?.()||(d.mode&0o077)!==0||realpathSync(c.directory)!==c.directory)throw denied();
 const path=join(c.directory,'policy.json');privateFile(path);const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==c.policySha256)throw denied();
 const p=JSON.parse(bytes.toString()) as Policy;
 if(p.version!==1||typeof p.runId!=='string'||!p.runId||typeof p.enabled!=='boolean'||!Number.isFinite(Date.parse(p.expiresAt))||!integer(p.maxRequests,20)||!integer(p.maxCostMicrounits,1e12)||!Array.isArray(p.providers)||p.providers.some(x=>!providers.includes(x))||!p.operations||typeof p.operations!=='object')throw denied();
 for(const[k,v]of Object.entries(p.operations))if(!/^(openai|cloudflare|pexels|freesound|google_tts|volcengine_tts)\.(verify|generate|search|download)$/.test(k)||!integer(v.maxRequests,20)||!integer(v.maxBytes,20*1024*1024)||!v.maxBytes||!integer(v.timeoutMs,60000)||!v.timeoutMs||!integer(v.costMicrounits,1e12))throw denied();
 if(p.enabled&&(!['USD','CNY'].includes(p.currency)||!p.maxCostMicrounits||!p.priceEvidenceSha256?.match(/^[a-f0-9]{64}$/)||!p.approvalSha256?.match(/^[a-f0-9]{64}$/)||Object.entries(p.operations).some(([k,v])=>(k.endsWith('.generate')||k==='volcengine_tts.verify')&&!v.costMicrounits)))throw denied();
 const statePath=join(c.directory,'state.json');privateFile(statePath);const s=JSON.parse(readFileSync(statePath,'utf8')) as State;
 if(s.version!==1||s.policySha256!==c.policySha256||!integer(s.used,p.maxRequests)||!integer(s.costMicrounits,p.maxCostMicrounits)||typeof s.halted!=='boolean'||!s.byOperation||!Array.isArray(s.events)||s.events.length>40)throw denied();
 for(const[k,n]of Object.entries(s.byOperation))if(!p.operations[k]||!integer(n,p.operations[k].maxRequests))throw denied();
 return{policy:p,state:s};
}
function persist(c:ProviderNetworkConfiguration,s:State){
 const temp=join(c.directory,randomUUID()+'.tmp'),fd=openSync(temp,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(s)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temp,join(c.directory,'state.json'));const dir=openSync(c.directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export function providerNetworkAvailable(c:ProviderNetworkConfiguration){try{const{policy:p,state:s}=read(c);return p.enabled&&Date.parse(p.expiresAt)>Date.now()&&!s.halted&&s.events.at(-1)?.outcome!=='reserved'&&s.used<p.maxRequests;}catch{return false;}}
function requestOperation(provider:OnlineProvider,phase:'verify'|'execute',input:string|URL,init:RequestInit){
 const u=new URL(input),method=(init.method??'GET').toUpperCase();if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)throw denied();
 let op='';const api=(host:string,path:string)=>u.hostname===host&&u.pathname===path;
 if(provider==='pexels'&&method==='GET'){
  if(phase==='verify'&&api('api.pexels.com','/videos/search'))op='verify';
  if(phase==='execute'&&api('api.pexels.com','/videos/search'))op='search';
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
 }else if(provider==='volcengine_tts'&&method==='POST'&&api('openspeech.bytedance.com','/api/v3/tts/unidirectional/sse'))op=phase==='verify'?'verify':'generate';
 if(!op)throw denied();
 if(method==='POST'){
  if(typeof init.body!=='string'||Buffer.byteLength(init.body)>16384)throw denied();const b=JSON.parse(init.body);
  if(provider==='openai'&&(b.model!=='gpt-image-1'||b.size!=='1024x1536'||b.output_format!=='png'||b.n!==undefined&&b.n!==1||typeof b.prompt!=='string'||b.prompt.length>1200))throw denied();
  if(provider==='cloudflare'&&(b.steps!==4||typeof b.prompt!=='string'||b.prompt.length>1200))throw denied();
  if(provider==='google_tts'&&(typeof b.input?.text!=='string'||Array.from(b.input.text).length>10||b.voice?.languageCode!=='zh-CN'||b.voice?.name!=='cmn-CN-Standard-A'||b.audioConfig?.audioEncoding!=='MP3'))throw denied();
  if(provider==='volcengine_tts'&&(typeof b.req_params?.text!=='string'||Array.from(b.req_params.text).length>10||b.req_params.speaker!=='zh_female_vv_uranus_bigtts'||new Headers(init.headers).get('X-Api-Resource-Id')!=='seed-tts-2.0'))throw denied();
 }
 return provider+'.'+op;
}
// The private lock is held until the outcome is durable. A crashed owner leaves it in place;
// there is no stale-lock takeover or automatic refund of a possibly sent request.
export function createProviderFetcher(c:ProviderNetworkConfiguration,provider:OnlineProvider,phase:'verify'|'execute',transport:MediaFetcher=fetch,acceptResponse?:(response:Response)=>Promise<boolean>):MediaFetcher{
 return async(input,init={})=>{
  const operation=requestOperation(provider,phase,input,init);read(c);const lock=join(c.directory,'request.lock');let fd:number|undefined;const end=Date.now()+2000;
  while(fd===undefined){try{fd=openSync(lock,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>=end)throw denied();await new Promise(r=>setTimeout(r,10));}}
  let reserved=false;let state:State|undefined;
  try{
   const{policy:p,state:s}=read(c);state=s;const limit=p.operations[operation];
   if(!p.enabled||Date.parse(p.expiresAt)<=Date.now()||!p.providers.includes(provider)||s.halted||s.events.at(-1)?.outcome==='reserved'||!limit||s.used>=p.maxRequests||(s.byOperation[operation]??0)>=limit.maxRequests||s.costMicrounits+limit.costMicrounits>p.maxCostMicrounits)throw denied();
   s.used++;s.costMicrounits+=limit.costMicrounits;s.byOperation[operation]=(s.byOperation[operation]??0)+1;s.events.push({operation,outcome:'reserved'});persist(c,s);reserved=true;
   const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const response=await Promise.race([ (async()=>{
     const r=await transport(input,{...init,redirect:'manual',signal:controller.signal});if(r.status>=300&&r.status<400)throw denied();
     const declared=r.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit.maxBytes))throw denied();
     const chunks:Uint8Array[]=[];let bytes=0;const reader=r.body?.getReader();
     if(reader)while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit.maxBytes){await reader.cancel();throw denied();}chunks.push(next.value);}
     const body=Buffer.concat(chunks);return{response:new Response([204,205,304].includes(r.status)?null:body,{status:r.status,headers:{'content-type':r.headers.get('content-type')??'application/octet-stream'}}),bytes};
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(denied());},limit.timeoutMs);})]);
    const valid=acceptResponse?await acceptResponse(response.response.clone()):true,accepted=response.response.ok&&valid;s.events.push({operation,outcome:accepted?'completed':'failed',status:response.response.status,bytes:response.bytes});if(!accepted)s.halted=true;persist(c,s);return response.response;
   }finally{if(timer)clearTimeout(timer);controller.abort();}
  }catch{if(reserved&&state){state.halted=true;if(state.events.at(-1)?.outcome==='reserved')state.events.push({operation,outcome:'failed'});persist(c,state);}throw denied();}
  finally{closeSync(fd);unlinkSync(lock);}
 };
}
