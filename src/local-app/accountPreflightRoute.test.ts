// @vitest-environment node
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {it,expect,vi} from 'vitest';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {LocalConnections} from './connections';
import {csrfFor,sessionCookie} from './sessions';

const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',ownerId='10000000-0000-4000-8000-000000000003',revision='a'.repeat(32),token='b'.repeat(64);
const filesystem=vi.hoisted(()=>({mountPath:''}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return{...actual,stat:async(...args:Parameters<typeof actual.stat>)=>{const result=await actual.stat(...args);if(String(args[0])===filesystem.mountPath)Object.assign(result,{dev:Number(result.dev)+1});return result;}};
});

// Database transport and mount-device metadata are boundary substitutes. All
// files, HTTP, session/CSRF, account command and preflight logic are real.
// Deployment acceptance separately verifies real PostgreSQL and media mounts.
async function check(policy:Record<string,unknown>,networkAvailable:boolean,qualified=true,secretAvailable=true){
 const mediaRoot=await realpath(await mkdtemp(join(tmpdir(),'account-preflight-')));filesystem.mountPath=mediaRoot;
 await mkdir(join(mediaRoot,'account'));policy={...policy,asset_root:join(mediaRoot,'account')};
 const query=async(sql:string,values?:unknown[])=>{
  if(sql.includes('JOIN local_identity.owners'))return{rows:[{id:ownerId,email:'owner@example.test'}],rowCount:1};
  if(sql.includes('media_deployment()'))return{rows:[{state:'ready',config:{targetRoot:mediaRoot,sourceRoots:[]}}],rowCount:1};
  if(sql.includes('token_hash FROM local_identity.sessions'))return{rows:[{token_hash:'fixture-session'}],rowCount:1};
  if(sql.includes('lock_owned_account_row'))return{rows:[{owned:true}],rowCount:1};
  if(sql.includes('a.current_blueprint_version_id'))return{rows:[{id:accountId,current_blueprint_version_id:blueprintId,policy,revision}],rowCount:1};
  if(sql.includes('FROM public.prompt_versions'))return{rows:[{id:'fixture-harness'}],rowCount:1};
  if(sql.includes('local_identity.connection_version('))return{rows:[{id:values?.[0],connection_id:'10000000-0000-4000-8000-000000000004',provider:'pexels',adapter:'pexels_video',endpoint:'https://api.pexels.com/v1',revoked_at:null,is_current:true,store_mode:'keychain',secret_ref:'synthetic-secret-reference'}],rowCount:1};
  if(sql.includes('public.connection_version_is_verified('))return{rows:[{allowed:qualified}],rowCount:1};
  if(sql.includes('local_identity.lock_owned_connection('))return{rows:[{owned:true}],rowCount:1};
  if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('set_config'))return{rows:[],rowCount:0};
  throw Error('Unexpected database transport operation');
 };
 const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 const connections=new LocalConnections(pool,{mode:'keychain',async get(){if(!networkAvailable)throw Error('Locked preflight cannot read secrets');if(!secretAvailable)throw Error('Synthetic secret missing');return'synthetic-secret';},async putImmutable(){throw Error('Preflight cannot write secrets');}},{mode:'live',networkAvailable,async verify(){throw Error('Preflight cannot issue Provider requests');}});
 const runtime={ready:async()=>{},mediaReady:async()=>{},wake(){throw Error('Preflight cannot dispatch tasks');},mountPath:mediaRoot,minimumFreeBytes:0,checkReferences:connections.assertBlueprintReferences.bind(connections)};
 const episodes=new LocalEpisodeCommands(pool,mediaRoot,runtime);
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((request,response)=>handler(request,response));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,mediaRoot,episodes,origin});
 try{
  const response=await fetch(origin+'/api/local/account-commands',{method:'POST',headers:{Origin:origin,Cookie:`${sessionCookie}=${token}`,'X-CSRF-Token':csrfFor(token),'Content-Type':'application/json'},body:JSON.stringify({command:'checkBlueprint',idempotencyKey:randomUUID(),data:{accountId,blueprintVersionId:blueprintId,expectedRevision:revision}})});
  return{status:response.status,body:await response.json()};
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await episodes.close();filesystem.mountPath='';await rm(mediaRoot,{recursive:true,force:true});}
}

it('reports locked Provider networking independently from connection qualification through Owner HTTP',async()=>{
 const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:randomUUID()}},b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:randomUUID()}};
 const result=await check(policy,false);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([expect.objectContaining({check:'provider_network_policy',status:'unavailable',scope:'worker',action:'contact_environment_admin'})]);
 expect(result.body.checks[0].reason).toContain('网络');
});
it('reports both locked networking and missing qualification without calling a Provider or reading secrets',async()=>{
 const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:randomUUID()}},b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:randomUUID()}};
 const result=await check(policy,false,false);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([
  expect.objectContaining({check:'provider_network_policy',status:'unavailable',scope:'worker',action:'contact_environment_admin'}),
  expect.objectContaining({check:'credential_presence',status:'blocked',scope:'connection',action:'manage_connection'}),
 ]);
 expect(result.body.checks[1].reason).toContain('验证');
});
it('keeps missing connection qualification actionable when networking is available',async()=>{
 const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:randomUUID()}},b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:randomUUID()}};
 const result=await check(policy,true,false);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([expect.objectContaining({check:'credential_presence',status:'blocked',scope:'connection',action:'manage_connection'})]);
 expect(result.body.checks[0].reason).toBe('连接版本需要真实验证。');
});
it('rejects an unavailable exact secret even when networking and recorded qualification are available',async()=>{
 const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:randomUUID()}},b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:randomUUID()}};
 const result=await check(policy,true,true,false);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([expect.objectContaining({check:'credential_presence',status:'blocked',scope:'connection',action:'manage_connection'})]);
 expect(result.body.checks[0].reason).not.toContain('Synthetic secret');
});
it('identifies a missing planning model without claiming that Provider and Prompt are also missing',async()=>{
 const result=await check({executors:{storyboard_planning:{provider:'codex',adapter:'codex',prompt_version:'storyboard-v1',harness_id:randomUUID()}}},true);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([expect.objectContaining({check:'blueprint_configuration',status:'blocked',scope:'blueprint',action:'edit_blueprint',reason:'能力 storyboard_planning 配置缺失：模型。'})]);
});
it('reports incomplete planning configuration separately from runtime readiness',async()=>{
 const result=await check({},true);
 expect(result.status).toBe(200);
 expect(result.body.checks).toEqual([expect.objectContaining({check:'blueprint_configuration',status:'blocked',scope:'blueprint',action:'edit_blueprint',reason:'能力 storyboard_planning 配置缺失：模型、Prompt 版本。'})]);
});
it('reports readiness after the current configuration, qualification and runtime checks pass',async()=>{
 const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:randomUUID()}},b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:randomUUID()}};
 const result=await check(policy,true);
 expect(result.status).toBe(200);
 expect(result.body.checks).toHaveLength(3);
 expect(result.body.checks.every((item:{status:string})=>item.status==='passed')).toBe(true);
 expect(result.body.checks.map((item:{capability:string})=>item.capability)).toEqual(['worker_runtime','storyboard_planning','b_roll_generation']);
});
