import {officialVideoDownloadUrl} from '../worker/officialVideoProvider.js';
import {videoProviders, type VideoProvider} from '../worker/videoProviderCatalog.js';
// Endpoint boundary for signed, deployment-owned network policies.
export function officialVideoOperation(provider: VideoProvider, phase: 'verify'|'execute', url: URL, init: RequestInit): string {
 const method=(init.method??'GET').toUpperCase(),origin=videoProviders[provider].endpoint;
 const base=new URL(origin),path=url.pathname.slice(base.pathname==='/'?0:base.pathname.length);
 if(url.origin===base.origin){
  const create=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/video_generation':'/v1/videos/image2video';
  const list=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/query/video_generation':create;
  const pagination=provider==='kling'?['pageNum','pageSize']:['page_num','page_size'];
  if(phase==='verify'&&method==='GET'&&path===list&&[...url.searchParams.keys()].every(k=>pagination.includes(k))&&url.searchParams.get(pagination[0])==='1'&&url.searchParams.get(pagination[1])==='1')return'verify';
  if(phase==='execute'&&method==='GET'&&!url.search){
   const query=provider==='minimax'?'/v2/query/video_generation/':create+'/';
   if(path.startsWith(query)&&/^[a-zA-Z0-9_-]{1,128}$/.test(path.slice(query.length)))return'poll';
  }
  if(phase==='execute'&&method==='POST'&&path===create&&!url.search){
   if(typeof init.body!=='string'||Buffer.byteLength(init.body)>15*1024*1024)throw Error('Invalid video body');
   const body=JSON.parse(init.body),duration=Number(body.duration),p=videoProviders[provider];
   if(!Number.isInteger(duration)||duration<p.minDuration||duration>p.maxDuration)throw Error('Invalid video duration');
   if(provider==='kling'){
    if(body.model_name!=='kling-v3'||body.mode!=='std'||body.sound!=='off'||typeof body.image!=='string'||!body.image||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>1500||Object.keys(body).some(k=>!['model_name','image','prompt','mode','duration','sound'].includes(k)))throw Error('Invalid Kling video body');
   }else{
    if(!(p.models as readonly string[]).includes(body.model)||body.ratio!=='adaptive'||body.resolution!==(provider==='minimax'?'768P':'720p')||!Array.isArray(body.content)||body.content.length!==2||body.content[0]?.type!=='text'||typeof body.content[0].text!=='string'||!body.content[0].text.trim()||body.content[0].text.length>1500||body.content[1]?.type!=='image_url'||body.content[1]?.role!=='first_frame'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.content[1]?.image_url?.url??'')||Object.keys(body).some(k=>!['model','content','duration','ratio','resolution',...(provider==='volcengine'?['generate_audio','watermark']:[])].includes(k))||provider==='volcengine'&&(body.generate_audio!==false||body.watermark!==false))throw Error('Invalid video body');
   }
   return'generate';
  }
 }
 if(phase==='execute'&&method==='GET'&&!new Headers(init.headers).has('Authorization')){officialVideoDownloadUrl(provider,url.href);return'download';}
 throw Error('Unregistered official video request');
}
