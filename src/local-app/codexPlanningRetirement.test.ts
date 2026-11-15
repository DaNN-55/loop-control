// @vitest-environment node
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {csrfFor} from './sessions';
import {productionWorkspaceFields} from '../productionWorkspace';

it('retires legacy execution behind Owner and CSRF boundaries without reading receipts or writing legacy records',async()=>{
 const owner=randomUUID(),episode=randomUUID(),otherEpisode=randomUUID(),token='a'.repeat(64),queries:string[]=[];
 const query=async(sql:string,args?:unknown[])=>{
  queries.push(sql);
  if(sql.includes('SELECT o.id,o.email'))return {rows:[{id:owner,email:'owner@example.invalid'}],rowCount:1};
  if(sql.startsWith('SELECT local_identity.media_deployment() config,'))return {rows:[{state:'ready',config:{targetRoot:null,sourceRoots:[],writeBlocked:false}}],rowCount:1};
  if(sql.includes('SELECT token_hash FROM local_identity.sessions'))return {rows:[{token_hash:'synthetic'}],rowCount:1};
  if(sql==='SELECT 1 FROM local_identity.episode_recycle_bin WHERE episode_id=$1')return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT 1 FROM public.episodes e JOIN public.account_memberships'))return {rows:args?.[0]===episode&&args?.[1]===owner?[{}]:[],rowCount:args?.[0]===episode&&args?.[1]===owner?1:0};
  if(['BEGIN','BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith("SELECT set_config('loop.owner_id'"))return {rows:[],rowCount:0};
  throw Error('Unexpected operation: '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 const wake=vi.fn(),episodes=new LocalEpisodeCommands(pool,'/tmp/unused',{ready:async()=>{},wake,mountPath:'/tmp',minimumFreeBytes:0,checkReferences:async()=>{}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((request,response)=>handler(request,response));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 handler=createLocalHandler({pool,origin,mediaRoot:'/tmp/unused',episodes});
 const request=(path:string,body?:unknown,authenticated=true,csrf=true)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authenticated?{Cookie:'loop_owner_session='+token}:{}),...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  expect((await request('/api/local/storyboard-planning',undefined,false)).status).toBe(401);
  expect((await request('/api/local/storyboard-planning',{command:'saveGlobalPlanningDefaults'},true,false)).status).toBe(403);
  expect((await request('/api/local/storyboard-planning')).status).toBe(410);
  expect((await request('/api/local/storyboard-planning',{command:'saveGlobalPlanningDefaults'})).status).toBe(410);
  const prompt={command:'createPromptVersion',idempotencyKey:randomUUID(),data:{accountId:randomUUID(),capability:'storyboard_planning',name:'历史规划',summary:'历史',instructions:'不可重新登记'}};
  expect((await request('/api/local/configuration',prompt,false)).status).toBe(401);
  expect((await request('/api/local/configuration',prompt,true,false)).status).toBe(403);
  expect((await request('/api/local/configuration',prompt)).status).toBe(410);
  const key=randomUUID();
  for(const command of ['review','annotateStoryboard','planStoryboard','requestStructureRevision','requestStudioStoryboardRevision','saveWorkspacePlanningSelection','retryWorkspacePlanning','replanWorkspace','repairConfiguration','repairConnection']){
   const body={command,idempotencyKey:key,data:{episodeId:episode,...(command==='replanWorkspace'?{planningTaskId:randomUUID()}:{} ),...(command==='configureScriptProduction'?{enabled:true}:{})}};
   expect((await request('/api/local/episode-commands',body,false)).status).toBe(401);
   expect((await request('/api/local/episode-commands',body,true,false)).status).toBe(403);
   const result=await request('/api/local/episode-commands',body);expect(result.status,command+"\n"+queries.join("\n")).toBe(410);expect((await result.json()).error).toContain('已退役');
   expect((await request('/api/local/episode-commands',{...body,data:{...body.data,episodeId:otherEpisode}})).status).toBe(404);
  }
  for(const command of ['configureScriptProduction','pauseScriptProduction','applyScriptSettings','bindScriptVideo','renderScriptReview','prepareScriptPublish']){
   const body={command,idempotencyKey:key,data:{episodeId:episode}};
   expect((await request('/api/local/episode-commands',body,false)).status).toBe(401);
   expect((await request('/api/local/episode-commands',body,true,false)).status).toBe(403);
   expect((await request('/api/local/episode-commands',body)).status).toBe(400);
  }
  expect(wake).not.toHaveBeenCalled();
  expect(queries.some(sql=>/command_receipts|INSERT|UPDATE|DELETE|queue_workspace_planning/.test(sql))).toBe(false);
  expect(productionWorkspaceFields.prepareWorkspace).toContain('expectedScriptRevisionId');
  expect(productionWorkspaceFields.replanWorkspace).not.toContain('planningTaskId');
  expect(productionWorkspaceFields).not.toHaveProperty('saveWorkspacePlanningSelection');
  expect(productionWorkspaceFields).not.toHaveProperty('retryWorkspacePlanning');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await episodes.close();}
});
