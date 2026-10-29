import {isRetiredProvider,retiredProviderMessage} from '../worker/providerLifecycle.js';
import {isVideoProvider,videoProviders} from "../worker/videoProviderCatalog.js";
import {videoAuthorization} from "../worker/officialVideoProvider.js";
import{bailianCredential}from'../worker/wanVideoProvider.js';
import type{ConnectionProbe,ProbeResult}from'./connectionPorts.js';
import{createManualVerificationFetcher,createProviderFetcher,providerNetworkAvailable,providerNetworkStatus,type ProviderNetworkConfiguration,type OnlineProvider}from'./providerNetwork.js';
import{synthesizeVolcengineTts,parseVolcengineTtsAudio,type MediaFetcher}from'../worker/mediaProviders.js';
const adapters:Partial<Record<OnlineProvider,[string,string]>>={volcengine:['seedance_video',videoProviders.volcengine.endpoint],minimax:['minimax_video',videoProviders.minimax.endpoint],kling:['kling_video',videoProviders.kling.endpoint],bailian:['wan_video','https://dashscope.aliyuncs.com'],openai:['openai_images','https://api.openai.com/v1'],pexels:['pexels_video','https://api.pexels.com'],freesound:['freesound_preview','https://freesound.org/apiv2'],volcengine_tts:['volcengine_tts','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse']};
// Endpoint/credential qualification only. A successful model task remains a separate gate.
export function createProviderProbe(config:ProviderNetworkConfiguration,transport?:MediaFetcher,readOnly?:Partial<Record<OnlineProvider,ProviderNetworkConfiguration>>,options:{manualVerification?:boolean}={}):ConnectionProbe{
 const policyFor=(provider:string)=>readOnly?.[provider as OnlineProvider]??config;
 const statusFor=(provider:string)=>isRetiredProvider(provider)?{available:false,code:'provider_retired',detail:retiredProviderMessage}:!adapters[provider as OnlineProvider]?{available:false,code:'provider_not_registered',detail:'未登记的连接服务。'}:options.manualVerification?{available:true,code:'available',detail:'可手动测试连接。'}:providerNetworkStatus(policyFor(provider),provider);
 async function test(input:Parameters<ConnectionProbe['verify']>[0]):Promise<ProbeResult>{
  const status=statusFor(input.provider);if(!status.available)return{outcome:'retryable',attempted:false,code:status.code,detail:status.detail};
  let httpStatus:number|undefined,attempted=false;const observing:MediaFetcher=async(url,init)=>{attempted=true;const response=await (transport??fetch)(url,init);httpStatus=response.status;return response;};
  const outcome=await verify(input,observing);
  const detail=outcome==='verified'?input.provider==='volcengine_tts'?'语音接口验证通过（固定短句）。':'连接验证通过；尚未执行内容生成。':outcome==='invalid'?`服务拒绝认证或权限（HTTP ${httpStatus}），请检查 API Key、地域与服务权限。`:httpStatus?`服务返回 HTTP ${httpStatus}，未能完成验证。${input.provider==='bailian'&&httpStatus===404?'请核对北京业务空间 ID / Base URL。':''}`:'验证未完成：连接超时、网络异常或认证材料格式不匹配，请重试。';
  return{outcome,attempted,code:outcome==='verified'?'verified':outcome==='invalid'?'authentication_rejected':httpStatus?'provider_response':'transport_or_format',detail,...(httpStatus?{httpStatus}:{})};
 }
 async function verify(input:Parameters<ConnectionProbe['verify']>[0],sender=transport):Promise<ProbeResult['outcome']>{

  const provider=input.provider as OnlineProvider,expected=adapters[provider];
  if(!expected||input.adapter!==expected[0]||input.endpoint!==expected[1]||!input.secret.trim()||!statusFor(input.provider).available)return'retryable';
  let outcome:'verified'|'invalid'|'retryable'='retryable';
  const classifyResponse=async(r:Response)=>{outcome=await classify(provider,r);return outcome==='verified';};
  const manual=options.manualVerification?createManualVerificationFetcher(provider,sender):undefined;
  const fetcher:MediaFetcher=manual?async(url,init)=>{const response=await manual(url,init);await classifyResponse(response.clone());return response;}:createProviderFetcher(policyFor(provider),provider,'verify',sender,classifyResponse);
  try{
   if(provider==='volcengine_tts'){await synthesizeVolcengineTts({apiKey:input.secret,fetcher,model:'seed-tts-2.0',text:'这是一条测试。',voice:{languageCode:'zh-CN',name:'zh_female_vv_uranus_bigtts',speakingRate:1}});return outcome;}
   let url:string,headers:Record<string,string>={};
   if(isVideoProvider(provider)){url=videoProviders[provider].endpoint+(provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/query/video_generation':'/v1/videos/image2video')+(provider==='kling'?'?pageNum=1&pageSize=1':'?page_num=1&page_size=1');headers.Authorization=videoAuthorization(provider,input.secret);}
   else if(provider==='bailian'){const credential=bailianCredential(input.secret);url=credential.origin+'/api/v1/models?model=wan2.6-i2v-flash&page_no=1&page_size=20';headers.Authorization='Bearer '+credential.apiKey;}
   else if(provider==='openai'){url='https://api.openai.com/v1/models/gpt-image-1';headers.Authorization='Bearer '+input.secret;}
   else if(provider==='pexels'){url='https://api.pexels.com/v1/videos/search?query=nature&per_page=1';headers.Authorization=input.secret;}
   else{const u=new URL('https://freesound.org/apiv2/search/');u.searchParams.set('token',input.secret);u.searchParams.set('query','rain');u.searchParams.set('fields','id');u.searchParams.set('page_size','1');url=u.toString();}
   await fetcher(url,{headers});return outcome;
  }catch{return outcome;}
 }
 return{mode:'live',get networkAvailable(){return providerNetworkAvailable(config);},verificationStatus:statusFor,test,verify:input=>verify(input)};
}
async function classify(provider:OnlineProvider,r:Response):Promise<'verified'|'invalid'|'retryable'>{
 if(r.status===401||r.status===403)return'invalid';if(!r.ok)return'retryable';
 try{
  if(provider==='volcengine_tts'){const bytes=parseVolcengineTtsAudio(await r.text());return bytes.length>=3&&(Buffer.from(bytes.subarray(0,3)).toString()==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)?'verified':'retryable';}
  const body=await r.json();
  if(provider==='volcengine'||provider==='minimax')return Array.isArray(body.items)?'verified':'retryable';
  if(provider==='kling')return body.code===0&&Array.isArray(body.data)?'verified':body.code===1002||body.code===1003?'invalid':'retryable';
  if(provider==='bailian')return Array.isArray(body.output?.models)&&body.output.models.some((m:{model?:string})=>m.model==='wan2.6-i2v-flash')?'verified':'retryable';
  if(provider==='openai')return body.id==='gpt-image-1'?'verified':'retryable';
  if(provider==='pexels')return body.page===1&&body.per_page===1&&Array.isArray(body.videos)&&body.videos.length===1&&Number.isSafeInteger(body.videos[0]?.id)&&Array.isArray(body.videos[0]?.video_files)&&body.videos[0].video_files.some((v:{file_type?:string})=>v.file_type==='video/mp4')?'verified':'retryable';
  return Array.isArray(body.results)&&body.results.some((v:{id?:number})=>Number.isSafeInteger(v.id)&&Number(v.id)>0)?'verified':'retryable';
 }catch{return'retryable';}
}
