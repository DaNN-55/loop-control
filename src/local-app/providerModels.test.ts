// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createProviderModelsReader} from './providerModels';
it('reads MiniMax domestic and international and OpenAI directories without guessing capability or following redirects',async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:[{id:'MiniMax-H3'},{id:'text-only'}]})),read=createProviderModelsReader(fetcher);
 expect(await read({provider:'minimax',secret:JSON.stringify({apiKey:'synthetic',region:'cn'})})).toEqual([{id:'MiniMax-H3',capability:'未分类'},{id:'text-only',capability:'未分类'}]);
 await read({provider:'minimax',secret:'synthetic'});await read({provider:'openai',secret:'synthetic'});
 expect(fetcher.mock.calls.map(c=>String(c[0]))).toEqual(['https://api.minimax.cn/v1/models','https://api.minimax.io/v1/models','https://api.openai.com/v1/models']);
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'manual',headers:{Authorization:'Bearer synthetic'}});
});
it('reads every Bailian page and sanitizes only IDs and capabilities',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const page=new URL(String(url)).searchParams.get('page_no');return Response.json({output:{total:101,models:page==='1'?Array.from({length:100},(_,i)=>({model:'model-'+i,capabilities:['VG'],description:'not returned'})):[{model:'wan2.6-i2v-flash',capabilities:['VG','IG']}]}});});
 const result=await createProviderModelsReader(fetcher)({provider:'bailian',secret:JSON.stringify({apiKey:'synthetic',workspaceId:'ws-12345678'})});
 expect(result).toHaveLength(101);expect(result.at(-1)).toEqual({id:'wan2.6-i2v-flash',capability:'视频、图片'});
 expect(fetcher.mock.calls.map(c=>String(c[0]))).toEqual([1,2].map(page=>'https://ws-12345678.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no='+page+'&page_size=100'));
});
it('rejects partial, oversized, unsafe and redirected responses, preserving callers previous settings',async()=>{
 for(const [provider,response]of [['bailian',()=>Response.json({output:{total:201,models:[{model:'one'}]}})],['openai',()=>Response.json({data:[{id:'<script>'}]})],['openai',()=>new Response('{}',{status:302,headers:{location:'https://untrusted.invalid'}})],['openai',()=>new Response(' '.repeat(2*1024*1024+1))]]as const){
  await expect(createProviderModelsReader(async()=>response())({provider,secret:JSON.stringify({apiKey:'synthetic',workspaceId:'ws-12345678'})})).rejects.toThrow();
 }
 const fetcher=vi.fn();await expect(createProviderModelsReader(fetcher)({provider:'bailian',secret:'synthetic'})).rejects.toThrow('业务空间');expect(fetcher).not.toHaveBeenCalled();
});
