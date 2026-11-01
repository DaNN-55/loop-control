import {minimaxCredential} from '../worker/officialVideoProvider.js';
import {bailianCredential} from '../worker/wanVideoProvider.js';
import type {MediaFetcher} from '../worker/mediaProviders.js';
export type ProviderModelsReader=(input:{provider:string;secret:string})=>Promise<{id:string;capability:string}[]>;
/** Explicit read-only directory lookup. No caller-supplied URLs, redirects, raw responses or generation. */
export function createProviderModelsReader(transport:MediaFetcher=fetch):ProviderModelsReader{
 return async({provider,secret})=>{
  let origin='',apiKey=secret.trim();
  if(provider==='openai')origin='https://api.openai.com';
  else if(provider==='minimax')({origin,apiKey}=minimaxCredential(secret));
  else if(provider==='bailian'){
   ({origin,apiKey}=bailianCredential(secret));
   if(origin==='https://dashscope.aliyuncs.com')throw Error('读取百炼目录需要北京业务空间 ID；请在更新凭据时填写。现有模型仍可保留。');
  }else throw Error('当前服务没有可用的模型目录。');
  if(!apiKey||/[\r\n]/.test(apiKey))throw Error('认证材料无效。');
  const signal=AbortSignal.timeout(15000),models=new Map<string,{id:string;capability:string}>();
  const categories:Record<string,string>={TG:'文本',IG:'图片',VG:'视频',TTS:'语音'};
  let total:number|undefined;
  for(let page=1;page<=20;page++){
   const url=new URL(provider==='bailian'?'/api/v1/models':'/v1/models',origin);
   if(provider==='bailian'){url.searchParams.set('page_no',String(page));url.searchParams.set('page_size','100');}
   const response=await transport(url,{method:'GET',headers:{Authorization:'Bearer '+apiKey},redirect:'manual',signal});
   if(!response.ok){await response.body?.cancel();throw Error(`目录读取失败（HTTP ${response.status}），请检查凭据、地域和目录权限。`);}
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0,value;
   try{if(!reader)throw Error();while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2*1024*1024)throw Error();chunks.push(r.value);}value=JSON.parse(Buffer.concat(chunks).toString());}
   catch{throw Error('供应商模型目录格式无效或响应过大。');}
   finally{await reader?.cancel().catch(()=>{});}
   const rows=provider==='bailian'?value?.output?.models:value?.data;
   if(!Array.isArray(rows)||rows.length>2000)throw Error('供应商没有返回有效模型目录。');
   const before=models.size;
   for(const row of rows){
    const id=provider==='bailian'?row?.model:row?.id;
    if(typeof id!=='string'||!id.length||id.length>200||!/^[-a-zA-Z0-9_.:/]+$/.test(id))throw Error('供应商模型标识格式无效。');
    const capability=provider==='bailian'&&Array.isArray(row.capabilities)?[...new Set(row.capabilities.map((c:unknown)=>typeof c==='string'?categories[c]:undefined).filter(Boolean))].join('、'):'';
    models.set(id,{id,capability:capability||'未分类'});
   }
   if(models.size>2000)throw Error('模型目录超过读取上限，未应用部分结果。');
   if(provider!=='bailian')return [...models.values()];
   const count=value.output.total;
   if(typeof count!=='number'||!Number.isInteger(count)||count<0||count>2000||total!==undefined&&count!==total)throw Error('供应商目录总数无效或读取期间发生变化，请重试。');
   total=count;
   if(models.size===total)return [...models.values()];
   if(models.size>total||models.size===before)throw Error('供应商目录分页不完整，请重试。');
  }
  throw Error('模型目录分页超过读取上限，未应用部分结果。');
 };
}
