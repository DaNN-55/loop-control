// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {narrationPorts} from './narrationWorker';
afterEach(()=>vi.unstubAllGlobals());
it('routes domestic MiniMax polling and its exact OSS bucket through the real network budget',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'loop-minimax-network-')));
 try{
  const limit={maxRequests:1,maxBytes:1024,timeoutMs:1000,costMicrounits:0};
  const policy=JSON.stringify({version:1,runId:'synthetic-minimax',enabled:true,expiresAt:new Date(Date.now()+60000).toISOString(),maxRequests:2,currency:'CNY',maxCostMicrounits:1,priceEvidenceSha256:'a'.repeat(64),approvalSha256:'b'.repeat(64),providers:['minimax'],operations:{'minimax.poll':limit,'minimax.download':limit}});
  const policySha256=createHash('sha256').update(policy).digest('hex');
  writeFileSync(join(directory,'policy.json'),policy,{mode:0o600});writeFileSync(join(directory,'state.json'),JSON.stringify({version:1,policySha256,used:0,costMicrounits:0,byOperation:{},halted:false,events:[]}),{mode:0o600});
  const transport=vi.fn(async()=>new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4'}}));vi.stubGlobal('fetch',transport);
  const ports=await narrationPorts({mode:'live',keychain:{approved:false,runtimeRoot:directory,helperSha256:'c'.repeat(64)},network:{directory,policySha256}});
  expect((await ports.fetcher('https://api.minimax.cn/v2/query/video_generation/existing-task',{headers:{Authorization:'Bearer synthetic'}})).status).toBe(200);
  expect((await ports.fetcher('https://algeng-video-infer.oss-cn-shanghai.aliyuncs.com/video/result.mp4?Signature=synthetic')).status).toBe(200);
  expect(JSON.parse(readFileSync(join(directory,'state.json'),'utf8')).byOperation).toEqual({'minimax.poll':1,'minimax.download':1});
  await expect(async()=>ports.fetcher('https://other-bucket.oss-cn-shanghai.aliyuncs.com/result.mp4')).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
