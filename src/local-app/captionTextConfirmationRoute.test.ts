// @vitest-environment node
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {csrfFor,sessionCookie} from './sessions';
const episodeId='10000000-0000-4000-8000-000000000001',reviewId='10000000-0000-4000-8000-000000000002',trackId='10000000-0000-4000-8000-000000000003',ownerId='10000000-0000-4000-8000-000000000004',token='a'.repeat(64);
// Only the database transport is substituted. The real HTTP handler must run
// session, CSRF and ownership checks, then reject before legacy state or files.
async function fixture(){
 const mediaRoot=await realpath(await mkdtemp(join(tmpdir(),'caption-text-')));
 let writes=0,wakes=0;const queries:string[]=[];
 const query=async(sql:string,args:unknown[]=[])=>{
  queries.push(sql);
  if(sql.includes('JOIN local_identity.owners'))return{rows:[{id:ownerId,email:'owner@example.test'}],rowCount:1};
  if(sql.includes('token_hash FROM local_identity.sessions'))return{rows:[{token_hash:'fixture'}],rowCount:1};
  if(sql.includes('FROM local_identity.episode_recycle_bin'))return{rows:[],rowCount:0};
  if(sql.includes('SELECT 1 FROM public.episodes e JOIN public.account_memberships'))return{rows:args[0]===episodeId?[{owned:true}]:[],rowCount:args[0]===episodeId?1:0};
  if(sql==="SELECT (local_identity.media_deployment()->>'writeBlocked')::boolean blocked")return{rows:[{blocked:false}],rowCount:1};
  if(sql.includes('media_deployment()'))return{rows:[{state:'ready',config:{targetRoot:mediaRoot,sourceRoots:[]}}],rowCount:1};
  if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('set_config'))return{rows:[],rowCount:0};
  if(/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)||sql.includes('local_identity.confirm_caption_text('))writes++;
  throw Error('Retired caption execution must not access its database implementation');
 };
 const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 const episodes=new LocalEpisodeCommands(pool,mediaRoot,{ready:async()=>{},mountPath:mediaRoot,minimumFreeBytes:0,wake(){wakes++;},checkReferences:async()=>{}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,mediaRoot,episodes,origin});
 const headers={Origin:origin,Cookie:`${sessionCookie}=${token}`,'X-CSRF-Token':csrfFor(token),'Content-Type':'application/json'};
 return{headers,data:{episodeId,reviewPackageId:reviewId,shotId:'shot-1',audioTrackId:trackId,audioSha256:'b'.repeat(64),textFingerprint:'c'.repeat(64),alignmentInputVersion:'d'.repeat(64)},
  assertNoExecution(){expect(writes).toBe(0);expect(wakes).toBe(0);expect(queries.some(sql=>/confirm_caption_text|caption_text_is_confirmed|shot_preparation_drafts|audio_tracks|generate_shot_sync_preview|confirm_shot_sync_preview|command_receipts/.test(sql))).toBe(false);},
  async post(data:Record<string,unknown>,override:Record<string,string>=headers,command='confirmCaptionText'){const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:override,body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};},
  async close(){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await episodes.close();await rm(mediaRoot,{recursive:true,force:true});}};
}
it('retires legacy text confirmation with syntactically valid audio, text and alignment identities',async()=>{
 const f=await fixture();try{const r=await f.post(f.data);expect(r.status,JSON.stringify(r.body)).toBe(410);expect(r.body.error).toContain('旧制作执行入口已退役');f.assertNoExecution();}finally{await f.close();}
});

it.each(['audioTrackId','audioSha256','textFingerprint','alignmentInputVersion'] as const)('keeps late legacy text confirmation retired after %s changes without writing state',async field=>{
 const f=await fixture();try{const r=await f.post({...f.data,[field]:field==='audioTrackId'?randomUUID():'f'.repeat(64)});expect(r.status).toBe(410);f.assertNoExecution();}finally{await f.close();}
});

it.each(['generateSyncPreview','confirmSyncPreview'])('retires %s before checking legacy content review or dispatching',async command=>{
 const f=await fixture();try{const {episodeId,reviewPackageId,shotId}=f.data;const r=await f.post({episodeId,reviewPackageId,shotId},undefined,command);expect(r.status).toBe(410);expect(r.body.error).toContain('旧制作执行入口已退役');f.assertNoExecution();}finally{await f.close();}
});

it.each(['anonymous','no-csrf','cross-origin'])('keeps the Owner permission boundary for %s retired text review',async mode=>{
 const f=await fixture();try{const headers:Record<string,string>={...f.headers};if(mode==='anonymous')delete headers.Cookie;else if(mode==='no-csrf')delete headers['X-CSRF-Token'];else headers.Origin='https://invalid.example';const r=await f.post(f.data,headers);expect(r.status).toBe(mode==='anonymous'?401:403);f.assertNoExecution();}finally{await f.close();}
});
it('does not disclose retirement for another Owner episode',async()=>{
 const f=await fixture();try{const r=await f.post({...f.data,episodeId:randomUUID()});expect(r.status).toBe(404);f.assertNoExecution();}finally{await f.close();}
});
it('keeps malformed legacy confirmation identities retired without reaching their former validator',async()=>{
 const f=await fixture();try{const r=await f.post({...f.data,audioSha256:'not-a-sha'});expect(r.status).toBe(410);f.assertNoExecution();}finally{await f.close();}
});
it('rejects a malformed episode identity before any ownership lookup or execution',async()=>{
 const f=await fixture();try{const r=await f.post({...f.data,episodeId:'not-an-episode'});expect(r.status).toBe(400);f.assertNoExecution();}finally{await f.close();}
});
