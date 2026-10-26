import type{ConnectionProbe}from'./connectionPorts.js';
import{createProviderFetcher,providerNetworkAvailable,type ProviderNetworkConfiguration,type OnlineProvider}from'./providerNetwork.js';
import{synthesizeVolcengineTts,parseVolcengineTtsAudio,type MediaFetcher}from'../worker/mediaProviders.js';
const adapters:Record<OnlineProvider,[string,string]>={openai:['openai_images','https://api.openai.com/v1'],cloudflare:['workers_ai_images','https://api.cloudflare.com/client/v4'],pexels:['pexels_video','https://api.pexels.com'],freesound:['freesound_preview','https://freesound.org/apiv2'],google_tts:['google_tts','https://texttospeech.googleapis.com/v1'],volcengine_tts:['volcengine_tts','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse']};
// Endpoint/credential qualification only. A successful model task remains a separate gate.
export function createProviderProbe(config:ProviderNetworkConfiguration,transport?:MediaFetcher):ConnectionProbe{
 return{mode:'live',get networkAvailable(){return providerNetworkAvailable(config);},async verify(input){
  const provider=input.provider as OnlineProvider,expected=adapters[provider];
  if(!expected||input.adapter!==expected[0]||input.endpoint!==expected[1]||!input.secret.trim()||!providerNetworkAvailable(config))return'retryable';
  let outcome:'verified'|'invalid'|'retryable'='retryable';
  const fetcher=createProviderFetcher(config,provider,'verify',transport,async r=>{outcome=await classify(provider,r);return outcome==='verified';});
  try{
   if(provider==='volcengine_tts'){await synthesizeVolcengineTts({apiKey:input.secret,fetcher,model:'seed-tts-2.0',text:'这是一条测试。',voice:{languageCode:'zh-CN',name:'zh_female_vv_uranus_bigtts',speakingRate:1}});return outcome;}
   let url:string,headers:Record<string,string>={};
   if(provider==='openai'){url='https://api.openai.com/v1/models/gpt-image-1';headers.Authorization='Bearer '+input.secret;}
   else if(provider==='cloudflare'){const[id,token]=input.secret.split(':',2);if(!/^[a-f0-9]{32}$/.test(id?.trim()??'')||!token?.trim())return'retryable';url=`https://api.cloudflare.com/client/v4/accounts/${id.trim()}/ai/models/search?search=${encodeURIComponent('@cf/black-forest-labs/flux-1-schnell')}`;headers.Authorization='Bearer '+token.trim();}
   else if(provider==='google_tts'){url='https://texttospeech.googleapis.com/v1/voices?languageCode=zh-CN';headers['X-goog-api-key']=input.secret;}
   else if(provider==='pexels'){url='https://api.pexels.com/videos/search?query=nature&per_page=1';headers.Authorization=input.secret;}
   else{const u=new URL('https://freesound.org/apiv2/search/');u.searchParams.set('token',input.secret);u.searchParams.set('query','rain');u.searchParams.set('fields','id');u.searchParams.set('page_size','1');url=u.toString();}
   await fetcher(url,{headers});return outcome;
  }catch{return outcome;}
 }};
}
async function classify(provider:OnlineProvider,r:Response):Promise<'verified'|'invalid'|'retryable'>{
 if(r.status===401||r.status===403)return'invalid';if(!r.ok)return'retryable';
 try{
  if(provider==='volcengine_tts'){const bytes=parseVolcengineTtsAudio(await r.text());return bytes.length>=3&&(Buffer.from(bytes.subarray(0,3)).toString()==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)?'verified':'retryable';}
  const body=await r.json();
  if(provider==='openai')return body.id==='gpt-image-1'?'verified':'retryable';
  if(provider==='cloudflare')return body.success===true&&Array.isArray(body.result)&&body.result.some((m:{name?:string;id?:string})=>m.name==='@cf/black-forest-labs/flux-1-schnell'||m.id==='@cf/black-forest-labs/flux-1-schnell')?'verified':'retryable';
  if(provider==='google_tts')return Array.isArray(body.voices)&&body.voices.some((v:{name?:string;languageCodes?:string[]})=>v.name==='cmn-CN-Standard-A'&&v.languageCodes?.includes('cmn-CN'))?'verified':'retryable';
  if(provider==='pexels')return body.page===1&&body.per_page===1&&Array.isArray(body.videos)&&body.videos.length===1&&Number.isSafeInteger(body.videos[0]?.id)&&Array.isArray(body.videos[0]?.video_files)&&body.videos[0].video_files.some((v:{file_type?:string})=>v.file_type==='video/mp4')?'verified':'retryable';
  return Array.isArray(body.results)&&body.results.some((v:{id?:number})=>Number.isSafeInteger(v.id)&&Number(v.id)>0)?'verified':'retryable';
 }catch{return'retryable';}
}
