import {connectionUsagePlaceholder,type ConnectionUsageMetric,type ConnectionUsageSummary} from '../connections/connectionUsage.js';
import {minimaxCredential,videoAuthorization} from '../worker/officialVideoProvider.js';
import type {MediaFetcher} from '../worker/mediaProviders.js';
export type ProviderUsageReader=(input:{provider:string;secret:string})=>Promise<ConnectionUsageSummary>;
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const metric=(label:string,text:string,detail:string,status:ConnectionUsageMetric['status']='ready'):ConnectionUsageMetric=>({label,text,detail,status});
export function failedConnectionUsage(provider:string,detail='供应商数据暂不可用，请稍后重新打开连接页。'):ConnectionUsageSummary{
 const empty=connectionUsagePlaceholder(provider);
 return{...empty,remaining:{...empty.remaining,text:'读取失败',detail,status:'unavailable'},recent:{...empty.recent,text:'读取失败',detail,status:'unavailable'}};
}
/** Separate, bounded read-only accounting API. It never shares the generation budget or returns raw provider data. */
export function createProviderUsageReader(transport:MediaFetcher=fetch):ProviderUsageReader{
 let klingQueue:Promise<unknown>=Promise.resolve(),lastKlingRequest=0;
 async function json(url:string|URL,init:RequestInit={}){
  const signal=AbortSignal.timeout(10000),response=await transport(url,{...init,redirect:'manual',signal});
  if(!response.ok){await response.body?.cancel();throw Error(`供应商用量查询失败（HTTP ${response.status}）。`);}
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{if(!reader)throw Error();while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2*1024*1024)throw Error();chunks.push(next.value);}return {value:JSON.parse(Buffer.concat(chunks).toString()),headers:response.headers};}
  finally{await reader?.cancel().catch(()=>{});}
 }
 async function klingRequest(path:string,secret:string,body?:Record<string,unknown>){
  const result=klingQueue.then(async()=>{
   const wait=1100-(Date.now()-lastKlingRequest);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastKlingRequest=Date.now();
   const {value}=await json('https://api-singapore.klingai.com'+path,{headers:{Authorization:videoAuthorization('kling',secret),'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
   if(value?.code!==0||!value.data||typeof value.data!=='object')throw Error('可灵未返回有效用量数据。');return value.data;
  });klingQueue=result.catch(()=>{});return result;
 }
 return async({provider,secret})=>{
  if(provider==='minimax'){
   const recent=connectionUsagePlaceholder(provider).recent;
   try{
    const credential=minimaxCredential(secret);
    if(!credential.apiKey.startsWith('sk-api-'))return{remaining:metric('可用额','需按量Key','余额查询需要 MiniMax 按量 API Key；套餐额度不是账号余额。','unsupported'),recent,updatedAt:null};
    const {value}=await json(credential.origin+'/account/query_balance',{headers:{Authorization:'Bearer '+credential.apiKey}});
    if(value?.base_resp?.status_code!==0)throw Error();
    const fields=['available_amount','cash_balance','voucher_balance','credit_balance','owed_amount'] as const;
    if(fields.some(field=>typeof value[field]!=='string'||! /^-?\d{1,12}(?:\.\d{1,8})?$/.test(value[field])))throw Error();
    const money=(raw:string)=>{
     const [whole,fraction='']=raw.split('.');
     return (credential.region==='cn'?'¥':'US$')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.replace(/0+$/,'').padEnd(2,'0');
    };
    return{remaining:metric('可用额',money(value.available_amount),'MiniMax '+(credential.region==='cn'?'国内站':'国际站')+'账号可用额，包含现金、代金券及信用额度，不是独立 Key 的现金余额。现金 '+money(value.cash_balance)+'；代金券 '+money(value.voucher_balance)+'；信用额度 '+money(value.credit_balance)+'；欠款 '+money(value.owed_amount)+'。'),recent,updatedAt:new Date().toISOString()};
   }catch{return{...failedConnectionUsage(provider,'MiniMax 余额读取失败，请检查按量 API Key、所属站点或稍后重试。'),recent};}
  }
  if(provider==='pexels'){
   const recent=connectionUsagePlaceholder(provider).recent;
   try{
    const {headers}=await json('https://api.pexels.com/v1/videos/search?query=nature&per_page=1',{headers:{Authorization:secret}});
    const remaining=headers.get('x-ratelimit-remaining'),limit=headers.get('x-ratelimit-limit'),reset=headers.get('x-ratelimit-reset');
    if(!remaining||!/^\d+$/.test(remaining)||!Number.isSafeInteger(Number(remaining)))throw Error();
    const resetDate=reset&&/^\d+$/.test(reset)?new Date(Number(reset)*1000):null;
    return{remaining:metric('请求余量',Number(remaining).toLocaleString('zh-CN')+' 次','供应商响应头的剩余请求数，不是资金余额。'+(limit&&/^\d+$/.test(limit)?'当前周期限额 '+Number(limit).toLocaleString('zh-CN')+' 次。':'')+(resetDate&&Number.isFinite(resetDate.valueOf())?'重置于 '+resetDate.toLocaleString('zh-CN')+'。':'')),recent,updatedAt:new Date().toISOString()};
   }catch{return{...failedConnectionUsage(provider),recent};}
  }
  if(provider==='freesound'){
   try{
    const url=new URL('https://freesound.org/apiv2/usage/');url.searchParams.set('num_days','7');url.searchParams.set('token',secret);
    const {value}=await json(url),sustained=value?.current?.sustained,used=sustained?.num_requests??sustained?.num;
    const limit=typeof sustained?.limit==='string'&&/^\d+\/day$/.test(sustained.limit)?Number(sustained.limit.split('/')[0]):sustained?.limit;
    if(!number(used)||!number(limit)||!Array.isArray(value.historic)||value.historic.length>7||value.historic.some((r:unknown)=>!Array.isArray(r)||r.length!==2||typeof r[0]!=='string'||!number(r[1])))throw Error();
    return{remaining:metric('日余量',`${Math.max(0,limit-used).toLocaleString('zh-CN')} 次`,'供应商最近24小时请求限额；同一用户的多个客户端共享限流。不是资金余额。'),recent:metric('近7天',`${value.historic.reduce((sum:number,row:[string,number])=>sum+row[1],0).toLocaleString('zh-CN')} 次`,'供应商返回的当前 API client 最近7天请求次数，不是费用。'),updatedAt:new Date().toISOString()};
   }catch{return failedConnectionUsage(provider);}
  }
  if(provider!=='kling')return connectionUsagePlaceholder(provider);
  const now=Date.now();let remaining:ConnectionUsageMetric,recent:ConnectionUsageMetric;
  try{
   const data=await klingRequest('/account/costs?start_time=0&end_time='+now,secret),packs=data.resource_pack_subscribe_infos;
   if(data.code!==0||!Array.isArray(packs))remaining=metric('资源包','未返回','供应商没有返回资源包列表；无法据此判断现金余额。','unavailable');
   else{
    const active=packs.filter((p:{status?:string})=>p.status==='online');
    if(active.some((p:{remaining_quantity?:unknown;resource_pack_name?:unknown})=>!number(p.remaining_quantity)||typeof p.resource_pack_name!=='string'))throw Error();
    remaining=metric('包余量',active.length===1?active[0].remaining_quantity.toLocaleString('zh-CN'):active.length?`${active.length} 个有效包`:'无有效包',active.length?active.map((p:{resource_pack_name:string;remaining_quantity:number})=>`${p.resource_pack_name}：剩余 ${p.remaining_quantity}`).join('；')+'。账号级资源包，约12小时延迟，不是现金余额。':'供应商未列出有效资源包；不代表现金余额为0。');
   }
  }catch{remaining=failedConnectionUsage(provider).remaining;}
  try{
   const totals:Record<string,number>={},trial:Record<string,number>={};let cursor='',count=0,complete=false;const seen=new Set<string>();
   for(let page=0;page<3;page++){
    const data=await klingRequest('/account/billing/balance',secret,cursor?{cursor}:{start_time:now-7*86400000,end_time:now,limit:500});
    if(!Array.isArray(data.result?.detail)||typeof data.has_more!=='boolean')throw Error();
    for(const row of data.result.detail){
     if(!['CNY','USD'].includes(row.currency)||!number(row.deduction_amount)||!['balance','test_balance'].includes(row.cash_type))throw Error();
     const target=row.cash_type==='balance'?totals:trial;const total=(target[row.currency]??0)+Math.round(row.deduction_amount*1000000);if(!Number.isSafeInteger(total))throw Error();target[row.currency]=total;count++;
    }
    if(!data.has_more){complete=true;break;}
    if(typeof data.next_cursor!=='string'||!data.next_cursor||seen.has(data.next_cursor))throw Error();cursor=data.next_cursor;seen.add(cursor);
   }
   if(!complete)throw Error();
   const money=(values:Record<string,number>)=>Object.entries(values).map(([currency,microunits])=>(currency==='CNY'?'¥':'US$')+(microunits/1000000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6})).join(' / ');
   recent=metric('7天任务',money(totals)||(count?'无现金扣费':'无扣费记录'),'账号内近7天创建任务的实际现金扣费，可能包含其他 Key 调用；不是按扣费发生日查询。'+(Object.keys(trial).length?'另有试用额度消耗 '+money(trial)+'。':''));
  }catch{recent=failedConnectionUsage(provider).recent;}
  return{remaining,recent,updatedAt:new Date().toISOString()};
 };
}
