import {createHash,createHmac,randomUUID} from 'node:crypto';
import type {BillingProvider} from '../connections/connectionBilling.js';
import type {ConnectionUsageMetric,ConnectionUsageSummary} from '../connections/connectionUsage.js';
import type {MediaFetcher} from '../worker/mediaProviders.js';
export type BillingCredential={apiKey:string}|{accessKeyId:string;accessKeySecret:string};
export type BillingReader=(provider:BillingProvider,credential:BillingCredential)=>Promise<ConnectionUsageSummary>;
class BillingError extends Error{}
const invalid=()=>new BillingError('供应商账务数据格式不完整，未计算金额。');
export function parseBillingCredential(provider:BillingProvider,raw:string):BillingCredential{
 try{
  if(Buffer.byteLength(raw)>4096)throw Error();const v=JSON.parse(raw),keys=provider==='openai'?['apiKey']:['accessKeyId','accessKeySecret'];
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))throw Error();
  for(const k of keys)if(typeof v[k]!=='string'||v[k].length<(k==='accessKeyId'?6:12)||v[k].length>2048||/\s|[\x00-\x1f\x7f]/.test(v[k]))throw Error();
  return provider==='openai'?{apiKey:v.apiKey}:{accessKeyId:v.accessKeyId,accessKeySecret:v.accessKeySecret};
 }catch{throw new BillingError('账务凭据格式无效，请检查输入。');}
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const hmac=(key:string|Buffer,value:string)=>createHmac('sha256',key).update(value).digest();
const enc=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function aliyunBillingRequest(action:string,parameters:Record<string,string>,credential:Extract<BillingCredential,{accessKeyId:string}>,now:Date,nonce:string){
 const params={...parameters,Action:action,Version:'2017-12-14',Format:'JSON',AccessKeyId:credential.accessKeyId,SignatureMethod:'HMAC-SHA1',SignatureVersion:'1.0',SignatureNonce:nonce,Timestamp:now.toISOString().replace(/\.\d{3}Z$/,'Z')};
 const canonical=Object.entries(params).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>enc(k)+'='+enc(v)).join('&');
 const signature=createHmac('sha1',credential.accessKeySecret+'&').update('POST&%2F&'+enc(canonical)).digest('base64');
 return {url:'https://business.aliyuncs.com/',init:{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:canonical+'&Signature='+enc(signature)} as RequestInit};
}
/** Volcengine V4, matching the official SDK's host/x-date/body-hash canonical headers. */
export function volcBillingRequest(action:string,parameters:Record<string,unknown>,credential:Extract<BillingCredential,{accessKeyId:string}>,now:Date){
 const query='Action='+enc(action)+'&Version=2022-01-01',body=JSON.stringify(parameters),host='billing.volcengineapi.com',date=now.toISOString().replace(/[-:]|\.\d{3}/g,''),day=date.slice(0,8),bodyHash=sha(body),scope=day+'/cn-north-1/billing/request';
 const headers='host:'+host+'\nx-content-sha256:'+bodyHash+'\nx-date:'+date+'\n',signed='host;x-content-sha256;x-date';
 const canonical=['POST','/',query,headers,signed,bodyHash].join('\n'),stringToSign=['HMAC-SHA256',date,scope,sha(canonical)].join('\n');
 const key=hmac(hmac(hmac(hmac(credential.accessKeySecret,day),'cn-north-1'),'billing'),'request');
 return {url:'https://'+host+'/?'+query,init:{method:'POST',headers:{'Content-Type':'application/json','Host':host,'X-Date':date,'X-Content-Sha256':bodyHash,Authorization:'HMAC-SHA256 Credential='+credential.accessKeyId+'/'+scope+', SignedHeaders='+signed+', Signature='+hmac(key,stringToSign).toString('hex')},body} as RequestInit};
}
function amount(value:unknown):bigint{
 let s:unknown=typeof value==='number'&&Number.isFinite(value)?String(value):value;
 if(typeof value==='number'&&typeof s==='string'&&s.includes('e')){const fixed=value.toFixed(8);if(Number(fixed)!==value)throw invalid();s=fixed;}
 if(typeof s!=='string'||! /^-?\d{1,12}(?:\.\d{1,8})?$/.test(s))throw invalid();
 const negative=s.startsWith('-'),[whole,fraction='']=s.replace(/^-/,'').split('.');
 const n=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));return negative?-n:n;
}
function money(value:bigint,currency='CNY'){const negative=value<0n,absolute=negative?-value:value,whole=(absolute/100000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),fraction=(absolute%100000000n).toString().padStart(8,'0').replace(/0+$/,'').padEnd(2,'0');return (currency==='CNY'?'¥':currency==='USD'?'US$':currency+' ')+(negative?'-':'')+whole+'.'+fraction;}
function total(rows:unknown[],field:string,currency:string){let value=0n;for(const row of rows){if(!row||typeof row!=='object'||(row as Record<string,unknown>).Currency!==currency)throw invalid();value+=amount((row as Record<string,unknown>)[field]);}return value;}
const metric=(label:string,text:string,detail:string,status:ConnectionUsageMetric['status']='ready'):ConnectionUsageMetric=>({label,text,detail,status});
const fail=(label:string,error:unknown)=>metric(label,'读取失败',error instanceof BillingError?error.message:'账务查询失败，请检查凭据、权限或稍后重试。','unavailable');
export const billingReadSucceeded=(summary:ConnectionUsageSummary)=>[summary.remaining,summary.recent].some(v=>v.status==='ready');
export function createBillingReader(transport:MediaFetcher=fetch,clock:()=>Date=()=>new Date(),minimumIntervalMs=220):BillingReader{
 let cloudQueue:Promise<unknown>=Promise.resolve(),lastCloudRequest=0;
 return async(provider,credential)=>{
  const now=clock(),signal=AbortSignal.timeout(30000);let requests=0;
  const today=new Date(now.valueOf()+8*3600000).toISOString().slice(0,10),dates=Array.from({length:7},(_,i)=>new Date(Date.parse(today+'T00:00:00Z')-(6-i)*86400000).toISOString().slice(0,10));
  const window='北京时间 '+dates[0]+' 至 '+dates[6]+'（含今天）；供应商账号全部服务，不是仅此生成Key。';
  async function json(url:string,init:RequestInit={}){
   if(++requests>24)throw new BillingError('账单超过本次查询上限，未展示不完整合计。');
   const r=await transport(url,{...init,signal,redirect:'manual'});
   if(!r.ok){await r.body?.cancel();throw new BillingError([401,403].includes(r.status)?'账务认证或权限不足，请检查独立账务凭据。':`账务接口返回 HTTP ${r.status}，请稍后重试。`);}
   const reader=r.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{if(!reader)throw invalid();while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2*1024*1024)throw invalid();chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString());}finally{await reader?.cancel().catch(()=>{});}
  }
  async function cloud(action:string,params:Record<string,unknown>={}){
   if(!('accessKeyId' in credential))throw invalid();
   // Connections can share a supplier account; their combined reads share its quota.
   const response=cloudQueue.then(async()=>{
    const wait=minimumIntervalMs-(Date.now()-lastCloudRequest);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));signal.throwIfAborted();lastCloudRequest=Date.now();
    const r=provider==='aliyun'?aliyunBillingRequest(action,params as Record<string,string>,credential,clock(),randomUUID()):volcBillingRequest(action,params,credential,clock());return json(r.url,r.init);
   });
   cloudQueue=response.then(()=>undefined,()=>undefined);const v=await response;
   if(provider==='aliyun'){if(v?.Success!==true||!v.Data)throw new BillingError('阿里云拒绝账务查询，请检查RAM账务权限和中国站凭据。');return v.Data;}
   if(v?.ResponseMetadata?.Error?.Code==='AccountFlowLimitExceeded')throw new BillingError('供应商账务查询过于频繁，请稍后刷新。');
   if(v?.ResponseMetadata?.Error||!v?.Result)throw new BillingError('火山引擎拒绝账务查询，请检查IAM账务权限。');return v.Result;
  }
  let remaining:ConnectionUsageMetric,recent:ConnectionUsageMetric;
  if(provider==='openai'){
   remaining=metric('余额','控制台查看','OpenAI未接入公开预付余额API；Costs是组织账务费用，不是充值余额。','unsupported');
   try{
    if(!('apiKey' in credential))throw invalid();let page='',sum=0n,currency='',done=false;const seen=new Set<string>();
    for(let i=0;i<10;i++){
     const query=new URLSearchParams({start_time:String(Math.floor(Date.parse(dates[0]+'T00:00:00+08:00')/1000)),end_time:String(Math.floor(now.valueOf()/1000)),bucket_width:'1d',limit:'31'});if(page)query.set('page',page);
     const v=await json('https://api.openai.com/v1/organization/costs?'+query,{headers:{Authorization:'Bearer '+credential.apiKey}});
     if(!Array.isArray(v?.data)||typeof v.has_more!=='boolean')throw invalid();
     for(const bucket of v.data){if(!Array.isArray(bucket?.results))throw invalid();for(const row of bucket.results){const a=row?.amount;if(!a||typeof a.currency!=='string'||!['usd','cny'].includes(a.currency))throw invalid();if(currency&&currency!==a.currency)throw invalid();currency=a.currency;sum+=amount(a.value);}}
     if(!v.has_more){done=true;break;}if(typeof v.next_page!=='string'||!v.next_page||seen.has(v.next_page))throw invalid();page=v.next_page;seen.add(page);
    }
    if(!done)throw new BillingError('账单超过分页上限，未展示不完整合计。');
    recent=metric('组织7天',money(sum,(currency||'usd').toUpperCase()),'北京时间 '+dates[0]+' 00:00 至本次读取时刻；来自Costs API的整个组织账务金额，可能包含其他项目／Key，不等于现金充值余额。');
   }catch(error){recent=fail('组织7天',error);}
  }else{
   try{const v=await cloud(provider==='aliyun'?'QueryAccountBalance':'QueryBalanceAcct');const raw=provider==='aliyun'?v.AvailableAmount:v.AvailableBalance;if(provider==='aliyun'&&v.Currency&&v.Currency!=='CNY')throw invalid();remaining=metric('可用额',money(amount(raw)),'供应商中国站资金账户的可用额度，可能包含信用额度；不是独立API Key的钱包。');}catch(error){remaining=fail('可用额',error);}
   const recentLabel=provider==='aliyun'?'账单7天':'账号7天';
   try{
    let sum=0n;
    for(const date of dates){let read=0,complete=false;
     for(let page=1;page<=3;page++){
      const v=await cloud(provider==='aliyun'?'QueryAccountBill':'ListBillDetail',provider==='aliyun'?{BillingCycle:date.slice(0,7),Granularity:'DAILY',BillingDate:date,PageNum:String(page),PageSize:'300'}:{BillPeriod:date.slice(0,7),ExpenseDate:date,GroupPeriod:1,GroupTerm:3,Offset:(page-1)*300,Limit:300,NeedRecordNum:1,IgnoreZero:0});
      const rows=provider==='aliyun'?v.Items?.Item:(v.List??v.BillList),count=provider==='aliyun'?v.TotalCount:v.Total;
      if(!Array.isArray(rows)||rows.length>300||!Number.isSafeInteger(count)||count<0)throw invalid();
      sum+=total(rows,provider==='aliyun'?'PretaxAmount':'PaidAmount','CNY');read+=rows.length;
      if(read>=count){if(read!==count)throw invalid();complete=true;break;}if(!rows.length)throw invalid();
      if(signal.aborted)throw invalid();
     }
     if(!complete)throw new BillingError('账单超过分页上限，未展示不完整合计。');
    }
    recent=metric(recentLabel,money(sum),window+(provider==='aliyun'?'按阿里账单应付金额汇总，不是实际现金扣款。账务通常延迟约24小时，当月账单可能调整。':'费用中心已入账现金支付，含退款及信用额度抵扣，以已入账记录为准。'));
   }catch(error){recent=fail(recentLabel,error);}
  }
  return {remaining,recent,updatedAt:now.toISOString()};
 };
}
