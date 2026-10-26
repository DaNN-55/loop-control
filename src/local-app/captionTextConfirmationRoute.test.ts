// @vitest-environment node
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {csrfFor,sessionCookie} from './sessions';
const episodeId='10000000-0000-4000-8000-000000000001',reviewId='10000000-0000-4000-8000-000000000002',trackId='10000000-0000-4000-8000-000000000003',ownerId='10000000-0000-4000-8000-000000000004',token='a'.repeat(64);
// The database is the transport substitute. The Owner route, session/CSRF,
// command validation and immutable file verification are the real implementation.
async function fixture(){
 const mediaRoot=await realpath(await mkdtemp(join(tmpdir(),'caption-text-'))),root=join(mediaRoot,'account'),dir=`episodes/${episodeId}`;
 await mkdir(join(root,dir),{recursive:true});
 const files=[{id:'review-file',relative_path:dir+'/storyboard.json',bytes:Buffer.from('{}')},{id:'audio-file',relative_path:dir+'/audio.mp3',bytes:Buffer.from('synthetic-audio-file')}];
 for(const file of files)await writeFile(join(root,file.relative_path),file.bytes);
 const audioSha256=createHash('sha256').update(files[1].bytes).digest('hex'),text='当前正文',textFingerprint=createHash('sha256').update(text).digest('hex');
 const draft={id:'10000000-0000-4000-8000-000000000005',episode_id:episodeId,review_package_id:reviewId,shot_id:'shot-1',subtitle_text:text,subtitles_enabled:true,audio_mode:'tts',audio_status:'ready',current_audio_track_id:trackId,acoustic_alignment:{inputVersion:'c'.repeat(64),textFingerprint,audioSha256,status:'completed'},caption_text_confirmation:null};
 let writes=0;
 const query=async(sql:string)=>{
  if(sql.includes('JOIN local_identity.owners'))return{rows:[{id:ownerId,email:'owner@example.test'}],rowCount:1};
  if(sql.includes('token_hash FROM local_identity.sessions'))return{rows:[{token_hash:'fixture'}],rowCount:1};
  if(sql.includes('lock_owned_input_episode'))return{rows:[{owned:true}],rowCount:1};
  if(sql.includes('SELECT e.*,b.policy'))return{rows:[{id:episodeId,account_id:'account',policy:{asset_root:root},stage:'storyboard_approved',storyboard_enabled:true}],rowCount:1};
  if(sql.includes('media_deployment()'))return{rows:[{state:'ready',config:{targetRoot:mediaRoot,sourceRoots:[]}}],rowCount:1};
  if(sql.includes('FROM public.review_packages'))return{rows:[{id:reviewId,artifact_id:'review-file'}],rowCount:1};
  if(sql.includes('FROM public.artifacts')){const f=files[0];return{rows:[{...f,sha256:createHash('sha256').update(f.bytes).digest('hex'),file_size:f.bytes.length}],rowCount:1};}
  if(sql.includes('FROM public.audio_tracks'))return{rows:[{id:trackId,relative_path:files[1].relative_path,sha256:audioSha256,file_size:files[1].bytes.length}],rowCount:1};
  if(sql.includes('FROM public.shot_preparation_drafts'))return{rows:[draft],rowCount:1};
  if(sql.includes('local_identity.caption_text_is_confirmed('))return{rows:[{confirmed:false}],rowCount:1};
  if(sql.includes('FROM public.tasks'))return{rows:[],rowCount:0};
  if(sql.includes('local_identity.confirm_caption_text(')){writes++;return{rows:[{result:{saved:true}}],rowCount:1};}
  if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('set_config')||sql.includes('pg_advisory_xact_lock')||sql.includes('local_identity.command_receipts'))return{rows:[],rowCount:0};
  throw Error('Unexpected database boundary operation');
 };
 const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 const episodes=new LocalEpisodeCommands(pool,mediaRoot,{ready:async()=>{},mountPath:root,minimumFreeBytes:0,wake(){throw Error('Review must not dispatch');},checkReferences:async()=>{}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,mediaRoot,episodes,origin});
 const headers={Origin:origin,Cookie:`${sessionCookie}=${token}`,'X-CSRF-Token':csrfFor(token),'Content-Type':'application/json'};
 return{headers,data:{episodeId,reviewPackageId:reviewId,shotId:'shot-1',audioTrackId:trackId,audioSha256,textFingerprint,alignmentInputVersion:'c'.repeat(64)},writes:()=>writes,
  async post(data:Record<string,unknown>,override:Record<string,string>=headers,command='confirmCaptionText'){const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:override,body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};},
  async close(){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await episodes.close();await rm(mediaRoot,{recursive:true,force:true});}};
}
it('accepts Owner text review only for the exact current audio, text and alignment identity',async()=>{
 const f=await fixture();try{const r=await f.post(f.data);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body).toEqual({saved:true});expect(f.writes()).toBe(1);}finally{await f.close();}
});

it.each(['audioTrackId','audioSha256','textFingerprint','alignmentInputVersion'] as const)('rejects a late Owner review after %s changes without writing a confirmation',async field=>{
 const f=await fixture();try{const r=await f.post({...f.data,[field]:field==='audioTrackId'?randomUUID():'f'.repeat(64)});expect(r.status).toBe(409);expect(r.body.error).toContain('已变化');expect(f.writes()).toBe(0);}finally{await f.close();}
});

it.each(['generateSyncPreview','confirmSyncPreview'])('rejects %s at Owner HTTP until current content review is saved',async command=>{
 const f=await fixture();try{const {episodeId,reviewPackageId,shotId}=f.data;const r=await f.post({episodeId,reviewPackageId,shotId},undefined,command);expect(r.status).toBe(409);expect(r.body.error).toContain('核对当前音频正文');expect(f.writes()).toBe(0);}finally{await f.close();}
});

it.each(['anonymous','no-csrf','cross-origin'])('keeps the Owner permission boundary for %s text review',async mode=>{
 const f=await fixture();try{const headers:Record<string,string>={...f.headers};if(mode==='anonymous')delete headers.Cookie;else if(mode==='no-csrf')delete headers['X-CSRF-Token'];else headers.Origin='https://invalid.example';const r=await f.post(f.data,headers);expect(r.status).toBe(mode==='anonymous'?401:403);expect(f.writes()).toBe(0);}finally{await f.close();}
});
it('rejects malformed confirmation identities before writing state',async()=>{
 const f=await fixture();try{const r=await f.post({...f.data,audioSha256:'not-a-sha'});expect(r.status).toBe(400);expect(f.writes()).toBe(0);}finally{await f.close();}
});
