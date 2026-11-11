// @vitest-environment node
// Real HTTP/Owner role in a disposable database. No production rows or media writes.
import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {copyFixtureSchema} from './fixtureSchema';
import {hashPassword} from './password';
import {csrfFor,tokenHash,sessionCookie} from './sessions';

it.skipIf(process.env.LOOP_EPISODE_ARCHIVE_ACCEPTANCE!=='1')('restores an owned legacy order without enabling native production; retains ownership, history and CSRF fences',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated test context required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();
 const database='loop_archive_test_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 const bridges:ChildProcess[]=[];
 function connection(){
  const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
  bridges.push(bridge);const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;},ref(){return stream;},unref(){return stream;}});
 }
 const pool=new Pool({database,user:'postgres',max:1,stream:connection} as ConstructorParameters<typeof Pool>[0]);
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((req,res)=>handler(req,res));
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),foreign=randomUUID(),legacy=randomUUID(),managed=randomUUID(),historical=randomUUID(),outsider=randomUUID(),token=randomBytes(32).toString('hex');
 const admin=async(sql:string,values?:unknown[])=>{await pool.query('RESET SESSION AUTHORIZATION');try{return await pool.query(sql,values);}finally{await pool.query('SET SESSION AUTHORIZATION loop_app');}};
 try{
  await copyFixtureSchema(context,database,['db/local/110-episode-storage-locations.sql','db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql','db/local/113-automatic-account-directories.sql','db/local/114-series-storage-containers.sql','db/local/115-exact-episode-deletion-intents.sql','db/local/117-input-storage-locations.sql','db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql','db/local/160-episode-recycle-bin.sql']);
  await pool.query(readFileSync('db/local/083-legacy-episode-archive.sql','utf8'));
  await pool.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,owner+'@example.invalid',other,other+'@example.invalid']);
  await pool.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword('fixture-only-'+randomUUID())]);
  await pool.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),owner]);
  for(const [id,user] of [[account,owner],[foreign,other]]){
   await pool.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Archive fixture','UTC')",[id,'archive-'+id]);
   await pool.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[id,user]);
   await pool.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[id,{asset_root:'/unmounted-fixture-only'}]);
  }
  for(const [id,a] of [[legacy,account],[managed,account],[historical,account],[outsider,foreign]])await pool.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,archived_at) VALUES($1,$2,$2,'Archived fixture',now())",[id,a]);
  await pool.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[managed,owner]);
  await pool.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[historical]);
  await pool.query("INSERT INTO public.tasks(episode_id,task_type,status) VALUES($1,'draft_brief','ready')",[legacy]);
  const fingerprint=async()=>(await admin("SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) sha FROM public.tasks t")).rows[0].sha;
  const before=await fingerprint();
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool,origin,mediaRoot:'/no-fixture-media'});
  const post=async(id:string,archived:boolean,key=randomUUID(),csrf=true)=>{const r=await fetch(origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessionCookie+'='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command:'archiveEpisode',idempotencyKey:key,data:{episodeId:id,archived}})});return{status:r.status,body:await r.json()};};
  expect((await post(legacy,false,randomUUID(),false)).status).toBe(403);
  expect((await post(outsider,false)).status).toBe(404);expect((await post(historical,false)).status).toBe(404);
  const key=randomUUID(),restored=await post(legacy,false,key);
  expect(restored,JSON.stringify(restored)).toMatchObject({status:200,body:{id:legacy,archived_at:null}});
  expect(await post(legacy,false,key)).toEqual(restored);
  expect((await post(legacy,true)).status).toBe(200);expect((await post(managed,false)).status).toBe(200);
  expect((await admin('SELECT count(*)::int n FROM local_identity.input_episodes WHERE episode_id=$1',[legacy])).rows[0].n).toBe(0);
  expect(await fingerprint()).toBe(before);
  expect((await admin("SELECT count(*)::int n FROM public.audit_events WHERE episode_id=$1 AND event_type='episode_restored'",[legacy])).rows[0].n).toBe(1);
 }finally{
  server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();bridges.forEach(b=>b.kill());context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');
 }
},30000);
