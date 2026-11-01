// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createProviderUsageReader} from './providerUsage';
it.each([{num:2,limit:'2000/day'},{num_requests:2,limit:2000}])('reads documented and live Freesound usage shapes without treating requests as money',async sustained=>{
 const transport=vi.fn(async(url:string|URL)=>{const u=new URL(url);expect(u.origin+u.pathname).toBe('https://freesound.org/apiv2/usage/');expect(u.searchParams.get('num_days')).toBe('7');expect(u.searchParams.get('token')).toBe('synthetic-key');return Response.json({current:{sustained},historic:[['2026-10-31',5],['2026-11-01',3]]});});
 const summary=await createProviderUsageReader(transport)({provider:'freesound',secret:'synthetic-key'});
 expect(summary.remaining).toMatchObject({label:'日余量',text:'1,998 次',status:'ready'});expect(summary.recent.text).toBe('8 次');expect(JSON.stringify(summary)).not.toContain('synthetic-key');
});
it('keeps missing Kling resource data unknown and sums cash separately from trial credits across pages',async()=>{
 const bills=[{result:{detail:[{currency:'USD',deduction_amount:0.004,cash_type:'balance'},{currency:'CNY',deduction_amount:2,cash_type:'test_balance'}]},next_cursor:'next-page',has_more:true},{result:{detail:[{currency:'USD',deduction_amount:0.2,cash_type:'balance'}]},has_more:false}];
 const transport=vi.fn(async(url:string|URL,init?:RequestInit)=>{
  expect(new URL(url).origin).toBe('https://api-singapore.klingai.com');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-key');
  if(String(url).includes('/account/costs'))return Response.json({code:0,data:{code:0}});
  expect(String(url)).toBe('https://api-singapore.klingai.com/account/billing/balance');expect(init?.method).toBe('POST');
  const body=JSON.parse(String(init?.body));if(bills.length===1)expect(body).toEqual({cursor:'next-page'});else{expect(body.end_time-body.start_time).toBe(7*86400000);expect(body.limit).toBe(500);}
  return Response.json({code:0,data:bills.shift()});
 });
 const summary=await createProviderUsageReader(transport)({provider:'kling',secret:'synthetic-key'});
 expect(summary.remaining.status).toBe('unavailable');expect(summary.remaining.text).toBe('未返回');expect(summary.recent.text).toBe('US$0.204');expect(summary.recent.detail).toContain('¥2.00');expect(summary.recent.detail).toContain('创建任务');expect(transport).toHaveBeenCalledTimes(3);
});
it('rejects provider errors and redirects without returning provider text or keys',async()=>{
 for(const status of [302,401,500]){
  const read=createProviderUsageReader(async()=>new Response('synthetic-key private provider response',{status}));
  const summary=await read({provider:'freesound',secret:'synthetic-key'});expect(summary.recent.status).toBe('unavailable');expect(JSON.stringify(summary)).not.toMatch(/synthetic-key|private provider/);
 }
 const transport=vi.fn();expect((await createProviderUsageReader(transport)({provider:'minimax',secret:'synthetic-key'})).remaining.status).toBe('unsupported');expect(transport).not.toHaveBeenCalled();
});
it('does not present incomplete Kling pages as a zero or complete total',async()=>{
 const read=createProviderUsageReader(async url=>Response.json({code:0,data:String(url).includes('/account/costs')?{code:0,resource_pack_subscribe_infos:[]}:{result:{detail:[]},next_cursor:'repeated-cursor',has_more:true}}));
 const summary=await read({provider:'kling',secret:'synthetic-key'});expect(summary.remaining.text).toBe('无有效包');expect(summary.recent.status).toBe('unavailable');expect(summary.recent.text).toBe('读取失败');
});
it('reads Pexels request quota headers while keeping unavailable seven-day history explicit',async()=>{
 const transport=vi.fn(async(url:string|URL,init?:RequestInit)=>{
  expect(String(url)).toBe('https://api.pexels.com/v1/videos/search?query=nature&per_page=1');expect(new Headers(init?.headers).get('Authorization')).toBe('synthetic-pexels-key');
  return Response.json({page:1,videos:[]},{headers:{'X-Ratelimit-Limit':'25000','X-Ratelimit-Remaining':'24964','X-Ratelimit-Reset':'1795265561'}});
 });
 const value=await createProviderUsageReader(transport)({provider:'pexels',secret:'synthetic-pexels-key'});
 expect(value.remaining).toMatchObject({label:'请求余量',text:'24,964 次',status:'ready'});expect(value.recent).toMatchObject({text:'未提供历史',status:'unsupported'});expect(JSON.stringify(value)).not.toContain('synthetic-pexels-key');
 const missing=await createProviderUsageReader(async()=>Response.json({page:1,videos:[]}))({provider:'pexels',secret:'synthetic-pexels-key'});expect(missing.remaining.status).toBe('unavailable');expect(missing.recent.text).toBe('未提供历史');
});
