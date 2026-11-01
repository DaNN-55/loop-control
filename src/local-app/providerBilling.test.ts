// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {aliyunBillingRequest,volcBillingRequest,createBillingReader,parseBillingCredential} from './providerBilling';
const credential={accessKeyId:'synthetic-ak-01',accessKeySecret:'synthetic-secret-0123456789'},clock=()=>new Date('2026-11-01T12:00:00Z');
it('matches fixed signing vectors and never transmits the cloud secret',()=>{
 const a=aliyunBillingRequest('QueryAccountBalance',{},credential,clock(),'fixed-nonce');
 expect(new URLSearchParams(String(a.init.body)).get('Signature')).toBe('LQHEXgbCs+8A8qyg0Y6le57O1tw=');
 const v=volcBillingRequest('QueryBalanceAcct',{},credential,clock());
 expect(new Headers(v.init.headers).get('Authorization')).toContain('Signature=08e980bdeba856c100144de321778eceda86bae763503e0cd2701a1887f93999');
 expect(JSON.stringify([a,v])).not.toContain(credential.accessKeySecret);
});
it('reads Aliyun payable bills when actual supplier rows omit cash-payment fields',async()=>{
 const result=await createBillingReader(async(_url,init)=>{const p=new URLSearchParams(String(init?.body));const bill=p.get('BillingDate')==='2026-11-01';return Response.json({Success:true,Data:p.get('Action')==='QueryAccountBalance'?{AvailableAmount:'0',Currency:'CNY'}:{TotalCount:bill?1:0,Items:{Item:bill?[{Currency:'CNY',PretaxAmount:0.23,PretaxGrossAmount:0.5,InvoiceDiscount:0.27}]:[]}}});},clock,0)('aliyun',credential);
 expect(result.recent.status).toBe('ready');expect(result.recent.text).toBe('¥0.23');expect(result.recent.label).toBe('账单7天');expect(result.recent.detail).toContain('应付');expect(result.recent.detail).toContain('现金');
});
it('reads all seven China billing dates across a month boundary, exact payable amounts, refunds and pages',async()=>{
 const dates:string[]=[];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const p=new URLSearchParams(String(init?.body));if(p.get('Action')==='QueryAccountBalance')return Response.json({Success:true,Data:{AvailableAmount:'100.01',Currency:'CNY'}});
 const date=p.get('BillingDate')!;dates.push(date);return Response.json({Success:true,Data:{TotalCount:date==='2026-10-26'?301:1,Items:{Item:p.get('PageNum')==='2'?[{Currency:'CNY',PretaxAmount:'-0.01'}]:date==='2026-10-26'?Array.from({length:300},()=>({Currency:'CNY',PretaxAmount:0.00000001})):[{Currency:'CNY',PretaxAmount:'0.01'}]}}});});
 const result=await createBillingReader(fetcher,clock,0)('aliyun',credential);
 expect(result.remaining.text).toBe('¥100.01');expect(result.recent.text).toBe('¥0.050003');
 expect([...new Set(dates)]).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 expect(fetcher.mock.calls.every(c=>c[1]?.redirect==='manual'&&Boolean(c[1]?.signal))).toBe(true);
});
it('does not report a partial page sum, missing payable field, or mixed currency as a real 7-day amount',async()=>{
 for(const item of [{Currency:'CNY',PaymentAmount:'8',PretaxGrossAmount:'9'},{Currency:'USD',PretaxAmount:'8'}]){
 const result=await createBillingReader(async(_url,init)=>{const p=new URLSearchParams(String(init?.body));return Response.json({Success:true,Data:p.get('Action')==='QueryAccountBalance'?{AvailableAmount:'9'}:{TotalCount:1,Items:{Item:[item]}}});},clock,0)('aliyun',credential);
 expect(result.remaining.status).toBe('ready');expect(result.recent.status).toBe('unavailable');expect(result.recent.text).toBe('读取失败');
 }
 const incomplete=await createBillingReader(async(_url,init)=>{const p=new URLSearchParams(String(init?.body));return Response.json({Success:true,Data:p.get('Action')==='QueryAccountBalance'?{AvailableAmount:'9'}:{TotalCount:1000,Items:{Item:Array.from({length:300},()=>({Currency:'CNY',PretaxAmount:'1'}))}}});},clock,0)('aliyun',credential);
 expect(incomplete.recent.status).toBe('unavailable');expect(incomplete.recent.detail).toContain('不完整合计');
});
it('reads Volcengine account balance and paid amounts, preserving zero instead of inventing usage estimates',async()=>{
 const actions:string[]=[];
 const result=await createBillingReader(async(url,init)=>{const action=new URL(url).searchParams.get('Action')!;actions.push(action);const params=JSON.parse(String(init?.body));if(action==='ListBillDetail')expect(params.ExpenseDate).toMatch(/^2026-/);return Response.json({Result:action==='QueryBalanceAcct'?{AvailableBalance:'8.45'}:{Total:1,List:[{Currency:'CNY',PaidAmount:'0.01'}]}});},clock,0)('volcengine',credential);
 expect(result.remaining.text).toBe('¥8.45');expect(result.recent.text).toBe('¥0.07');expect(actions).toHaveLength(8);
});
it('paces concurrent connection reads together and identifies supplier account throttling',async()=>{
 let active=0,maximumActive=0;
 const reader=createBillingReader(async(url)=>{active++;maximumActive=Math.max(active,maximumActive);const crowded=active>1;await new Promise(resolve=>setTimeout(resolve,1));active--;return Response.json(crowded?{ResponseMetadata:{Error:{Code:'AccountFlowLimitExceeded'}}}:{Result:new URL(url).searchParams.get('Action')==='QueryBalanceAcct'?{AvailableBalance:'8'}:{Total:0,List:[]}});},clock,0);
 const results=await Promise.all([reader('volcengine',credential),reader('volcengine',credential)]);
 expect(maximumActive).toBe(1);expect(results.every(v=>v.remaining.status==='ready'&&v.recent.status==='ready')).toBe(true);
 const throttled=await createBillingReader(async()=>Response.json({ResponseMetadata:{Error:{Code:'AccountFlowLimitExceeded'}}}),clock,0)('volcengine',credential);
 expect(throttled.recent.detail).toContain('过于频繁');expect(throttled.recent.detail).not.toContain('权限');
});
it('paginates OpenAI organization costs with an Admin credential, and leaves prepaid balance unsupported',async()=>{
 let calls=0;const result=await createBillingReader(async(url,init)=>{expect(String(url)).toContain('https://api.openai.com/v1/organization/costs?');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-admin-key');calls++;return Response.json({data:[{results:[{amount:{currency:'usd',value:calls===1?'0.25':'-0.05'}}]}],has_more:calls===1,next_page:calls===1?'next':null});},clock,0)('openai',{apiKey:'synthetic-admin-key'});
 expect(calls).toBe(2);expect(result.remaining.status).toBe('unsupported');expect(result.recent.text).toBe('US$0.20');
});
it('sanitizes provider and transport errors and rejects credentials carrying endpoints or controls',async()=>{
 const denied=await createBillingReader(async()=>new Response('synthetic-secret-leak',{status:403}),clock,0)('openai',{apiKey:'synthetic-admin-key'});
 expect(denied.recent.status).toBe('unavailable');expect(JSON.stringify(denied)).not.toContain('synthetic-secret-leak');
 const failure=await createBillingReader(async()=>{throw Error('Bearer synthetic-secret-leak');},clock,0)('openai',{apiKey:'synthetic-admin-key'});
 expect(JSON.stringify(failure)).not.toContain('synthetic-secret-leak');
 expect(()=>parseBillingCredential('aliyun',JSON.stringify({...credential,endpoint:'https://example.invalid'}))).toThrow();
 expect(()=>parseBillingCredential('openai',JSON.stringify({apiKey:'contains\nnewline'}))).toThrow();
});

it('does not follow redirects with credentials or accept an oversized supplier body',async()=>{
 const redirect=await createBillingReader(async()=>new Response('',{status:302,headers:{Location:'https://example.invalid'}}),clock,0)('openai',{apiKey:'synthetic-admin-key'});
 expect(redirect.recent.status).toBe('unavailable');expect(redirect.recent.detail).toContain('302');
 const oversized=await createBillingReader(async()=>new Response('x'.repeat(2*1024*1024+1)),clock,0)('openai',{apiKey:'synthetic-admin-key'});
 expect(oversized.recent.status).toBe('unavailable');expect(oversized.recent.text).toBe('读取失败');
});
