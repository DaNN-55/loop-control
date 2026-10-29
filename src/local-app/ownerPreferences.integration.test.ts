// @vitest-environment node
// Real PostgreSQL and HTTP boundary, all fixtures and migration changes rolled back.
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Pool,type PoolClient} from 'pg';
import {hashPassword} from './password';
import {tokenHash,csrfFor} from './sessions';
import {createLocalHandler} from './localRoute';
import {LocalConnections} from './connections';
import {defaultOwnerPreferences} from '../preferences/preferences';
it.skipIf(process.env.LOOP_PREFERENCES_ACCEPTANCE!=='1')('persists Owner preferences through authenticated HTTP, isolates Owners and gates both desktop categories and the recent feed',async()=>{
 const {runtimeContext}=await import(join(process.cwd(),'scripts/runtime/environment.mjs')),context=runtimeContext();context.assertDatabase();
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket';my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:context.database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})}as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),owner=randomUUID(),other=randomUUID(),account=randomUUID(),otherAccount=randomUUID(),token=randomBytes(32).toString('hex');
 const scoped={async query(text:string,values?:unknown[]){if(text.startsWith('BEGIN'))return c.query('SAVEPOINT preferences_command');if(text==='COMMIT')return c.query('RELEASE SAVEPOINT preferences_command');if(text==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT preferences_command');return c.query(text,values);},release(){}}as unknown as PoolClient;
 const pool={connect:async()=>scoped,query:(text:string,values?:unknown[])=>c.query(text,values)}as unknown as Pool;
 const server=createServer();
 try{
  await c.query('BEGIN');
  if(!(await c.query("SELECT to_regclass('local_identity.owner_preferences') present")).rows[0].present)await c.query(readFileSync('db/local/079-owner-preferences.sql','utf8'));
  if(!(await c.query("SELECT to_regprocedure('local_identity.audit_production_task_failure()') present")).rows[0].present)await c.query(readFileSync('db/local/080-owner-task-failure-notifications.sql','utf8'));
  await c.query("INSERT INTO local_identity.owners(id,email)VALUES($1,'preferences-a@example.invalid'),($2,'preferences-b@example.invalid')",[owner,other]);
  for(const [id,user]of [[account,owner],[otherAccount,other]]){
   await c.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,'Preferences rollback fixture','UTC')",[id,'fixture-'+id]);
   await c.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[id,user]);
  }
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest)VALUES($1,$2)',[owner,await hashPassword('synthetic-preferences-password')]);
  await c.query("INSERT INTO local_identity.sessions(owner_id,token_hash,expires_at)VALUES($1,$2,now()+interval '1 hour')",[owner,tokenHash(token)]);
  const delivery=randomUUID(),review=randomUUID(),foreignDelivery=randomUUID();
  for(const [id,scope,type]of [[delivery,account,'publish_package_verified'],[review,account,'stage_transition'],[foreignDelivery,otherAccount,'publish_package_verified']])await c.query("INSERT INTO public.audit_events(id,account_id,event_type,payload)VALUES($1,$2,$3,$4)",[id,scope,type,JSON.stringify(type==='stage_transition'?{to_stage:'script_review'}:{})]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  server.on('request',createLocalHandler({pool,origin,mediaRoot:'/fixture'}));
  const get=(path='preferences',cookie=true)=>fetch(origin+'/api/local/'+path,{headers:cookie?{Cookie:'loop_owner_session='+token}:{}});
  const post=(data:unknown,csrf=csrfFor(token),source=origin)=>fetch(origin+'/api/local/preferences',{method:'POST',headers:{Cookie:'loop_owner_session='+token,Origin:source,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command:'update',data})});
  expect((await get('preferences',false)).status).toBe(401);
  expect((await get()).status).toBe(200);expect(await(await get()).json()).toEqual(defaultOwnerPreferences);
  expect((await post(defaultOwnerPreferences,'bad')).status).toBe(403);
  expect((await post(defaultOwnerPreferences,csrfFor(token),'http://wrong.test')).status).toBe(403);
  expect((await post({...defaultOwnerPreferences,notifications:{review:false}})).status).toBe(400);
  const saved={...defaultOwnerPreferences,displayName:'Dan fixture',appearance:'system',compactRows:false,notifications:{review:false,failure:false,delivery:true}};
  expect((await post(saved)).status).toBe(200);expect(await(await get()).json()).toEqual(saved);
  const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5f8AAAAASUVORK5CYII=';
  expect((await post({...saved,avatar})).status).toBe(200);expect((await(await get()).json()).avatar).toBe(avatar);
  expect((await post({...saved,avatar:'data:image/svg+xml;base64,PHN2Zz4='})).status).toBe(400);expect((await(await get()).json()).avatar).toBe(avatar);
  expect((await post({...saved,avatar:null})).status).toBe(200);expect((await(await get()).json()).avatar).toBeNull();
  expect((await c.query('SELECT owner_id FROM local_identity.owner_preferences')).rows).toEqual([{owner_id:owner}]);
  expect((await c.query('UPDATE local_identity.owner_preferences SET preferences=$1 WHERE owner_id=$2',[JSON.stringify(defaultOwnerPreferences),other])).rowCount).toBe(0);
  const enabled=async(id:string,kind:string)=>(await c.query('SELECT local_identity.native_notification_enabled($1,$2) enabled',[id,kind])).rows[0].enabled;
  expect(await enabled(review,'review')).toBe(false);expect(await enabled(delivery,'delivery')).toBe(true);
  // Same real connection command path; provider/Keychain ports are controlled and never call out.
  const session={id:owner,email:'preferences-a@example.invalid',token};let outcome:'invalid'|'retryable'='invalid';
  const service=new LocalConnections(pool,{mode:'keychain',async putImmutable(){},async get(){return 'synthetic';}},{mode:'live',networkAvailable:true,async verify(){return outcome;}});
  const created=await service.command(session,{command:'create',idempotencyKey:randomUUID(),data:{name:'Fixture connection',provider:'pexels',adapter:'pexels_video',secret:'synthetic'}})as{connection:{id:string;current_version_id:string}};
  await service.command(session,{command:'verify',idempotencyKey:randomUUID(),data:{connectionId:created.connection.id}});
  const feed=await(await get('notification-events')).json();expect(feed).toHaveLength(2);expect(feed.some((event:{id:string})=>event.id===foreignDelivery)).toBe(false);
  const failure=feed.find((event:{event_type:string})=>event.event_type==='connection_verification_failed');expect(failure.payload.name).toBe('Fixture connection');expect(await enabled(failure.id,'failure')).toBe(false);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  expect((await c.query('SELECT count(*)::int n FROM public.notification_delivery_events WHERE event_id=ANY($1)',[[delivery,review,failure.id]])).rows[0].n).toBe(3);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  // Simulated probes and rebinds must not become failed live-connection notifications.
  await c.query("SELECT local_identity.record_connection_probe($1,'simulated','retryable')",[created.connection.current_version_id]);
  expect(await(await get('notification-events')).json()).toHaveLength(2);
  expect((await post({...saved,notifications:{review:true,failure:true,delivery:false}})).status).toBe(200);
  expect(await enabled(review,'review')).toBe(true);expect(await enabled(failure.id,'failure')).toBe(true);expect(await enabled(delivery,'delivery')).toBe(false);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  const task=randomUUID(),episode=randomUUID();
  await c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy)VALUES($1,$1,1,'{}')",[account]);
  await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title)VALUES($1,$2,$2,'Failure rollback fixture')",[episode,account]);
  await c.query("INSERT INTO public.tasks(id,episode_id,task_type,status)VALUES($1,$2,'draft_brief','running')",[task,episode]);
  await c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[task]);
  await c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[task]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const failedFeed=await(await get('notification-events')).json();expect(failedFeed.filter((event:{event_type:string})=>event.event_type==='production_task_failed')).toHaveLength(1);
  const taskEvent=failedFeed.find((event:{event_type:string})=>event.event_type==='production_task_failed');expect(taskEvent.episode_id).toBe(episode);expect(await enabled(taskEvent.id,'failure')).toBe(true);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('UPDATE local_identity.sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(token)]);await c.query('SET SESSION AUTHORIZATION loop_app');
  expect((await post(saved)).status).toBe(401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await c.query('ROLLBACK').catch(()=>{});c.release();await admin.end();bridge.kill();}
},60000);
