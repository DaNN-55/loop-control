// @vitest-environment node
// Real PostgreSQL roles, HTTP and session/CSRF; all records roll back.
// The fake Keychain contains only ephemeral synthetic values and never uses macOS.
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {Duplex} from 'node:stream';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {createLocalHandler} from './localRoute';
import {SecretAdministration} from './secretAdministration';
import {hashPassword} from './password';
import {csrfFor,tokenHash} from './sessions';

it.skipIf(process.env.LOOP_SECRET_ACCEPTANCE!=='1')('admin secret boundaries, metadata, password, audit and immutable references through HTTP/PG',async()=>{
 const modulePath=join(process.cwd(),'scripts/runtime/environment.mjs'),{runtimeContext}=await import(modulePath),context=runtimeContext();context.assertDatabase();
 const testDatabase='loop_secret_test_'+randomBytes(8).toString('hex');context.sql('CREATE DATABASE '+testDatabase+' TEMPLATE template0','postgres');
 try{const schema=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',context.database,'--schema-only']);context.sql(schema,testDatabase);}catch{context.sql('DROP DATABASE '+testDatabase+' WITH (FORCE)','postgres');throw Error('Isolated schema setup failed');}
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:testDatabase,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),id=()=>randomUUID(),owner=id(),other=id(),reference=id(),unnamed=id(),control=id(),alias=id(),oldAlias=id(),connection=id(),version=id();
 const password='synthetic-only-'+id(),value='fixture-only-'+id(),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex'),expired=randomBytes(32).toString('hex');
 const fixture=mkdtempSync('/private/tmp/loop-secret-test-'),runtime=join(fixture,'.loop-control/local');mkdirSync(join(runtime,'history/content'),{recursive:true,mode:0o700});
 writeFileSync(join(runtime,'secret-index.json'),JSON.stringify({version:1,entries:{'test-named':{reference},'control-alias':{reference:alias}},referenceAliases:{[alias]:control,[oldAlias]:reference}}),{mode:0o600});
 let calls=0,unavailable=false;
 const store={async get(ref:string){calls++;if(unavailable)throw Error('private helper failure: '+value);if(ref!==reference&&ref!==unnamed)throw Error('Unknown fixture');return value;}};
 const scoped={async query(sql:string,values?:unknown[]){if(sql.startsWith('BEGIN'))return c.query('SAVEPOINT secret_request');if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT secret_request');if(sql==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT secret_request');return c.query('RELEASE SAVEPOINT secret_request');}return c.query(sql,values);},release(){}} as unknown as PoolClient;
 const pool={query:(sql:string,values?:unknown[])=>c.query(sql,values),connect:async()=>scoped} as unknown as Pool;
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));
 try{
  await c.query('BEGIN');
  if(!(await c.query("SELECT to_regclass('local_identity.secret_access_audit') present")).rows[0].present)await c.query(readFileSync('db/local/064-secret-administration.sql','utf8'));
  await c.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,`secret-${owner}@example.invalid`,other,`secret-${other}@example.invalid`]);
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2),($3,$2)',[owner,await hashPassword(password),other]);
  await c.query("INSERT INTO local_identity.sessions(token_hash,owner_id,created_at,expires_at) VALUES($1,$2,now()-interval '2 hours',now()+interval '1 hour'),($3,$4,now()-interval '2 hours',now()+interval '1 hour'),($5,$2,now()-interval '2 hours',now()-interval '1 second')",[tokenHash(token),owner,tokenHash(otherToken),other,tokenHash(expired)]);
  await c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'pexels','pexels_video','Unindexed fixture',$2,$3,'https://api.pexels.com/videos/search')",[connection,other,version]);
  await c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'pexels','pexels_video','https://api.pexels.com/videos/search',$3)",[version,connection,unnamed]);
  await c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,other,unnamed]);
  const source=createHash('sha256').update(id()).digest('hex'),content=Buffer.from('restorable keychain:'+oldAlias),sha=createHash('sha256').update(content).digest('hex');
  writeFileSync(join(runtime,'history/content',sha),content,{mode:0o600});
  await c.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label) VALUES($1,$2,'test','Fixture')",[source,other]);
  await c.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES('test',$1,$2,$3,$4)",[{id:source},source,other,{credential:{$keychainRef:reference}}]);
  await c.query("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind) VALUES($1,'fixture.txt',$2,$3,'text')",[source,sha,content.length]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const service=new SecretAdministration(pool,{adminOwnerId:owner,runtimeRoot:runtime,controlReferences:[{reference:control,purpose:'Fixture control'}]},store);
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool,origin,mediaRoot:fixture,secrets:service});
  const request=async(path:string,body?:unknown,session=token,csrf=true)=>{const r=await fetch(origin+'/api/local/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Cookie:'loop_owner_session='+session}:{}),...(csrf&&session?{'X-CSRF-Token':csrfFor(session)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,headers:r.headers,body:await r.json()};};
  const payload=(ref:string=reference,pw=password,action='view')=>({reference:ref,password:pw,action});
  for(const path of ['secrets','secrets/detail?reference='+reference,'secrets/reveal']){
   expect((await request(path,path.endsWith('reveal')?payload():undefined,'')).status).toBe(401);
   expect((await request(path,path.endsWith('reveal')?payload():undefined,otherToken)).status).toBe(403);
  }
  expect(calls).toBe(0);
  expect((await request('session',undefined,otherToken)).body.secretAdministration).toBe(false);
  expect((await request('session')).body.secretAdministration).toBe(true);
  const listing=await request('secrets');expect(listing.status).toBe(200);expect(JSON.stringify(listing.body).includes(value)).toBe(false);
  expect(listing.body.items.some((x:{reference:string})=>x.reference===unnamed)).toBe(true);
  expect(listing.body.items.find((x:{reference:string})=>x.reference===control).revealAllowed).toBe(false);
  const detail=await request('secrets/detail?reference='+reference);expect(detail.status).toBe(200);expect(detail.body.item.history.metadataOccurrences).toBe(1);expect(detail.body.item.history.fileOccurrences).toBe(1);expect(JSON.stringify(detail.body).includes(value)).toBe(false);
  expect((await request('secrets?q=test-named&category=history')).body.total).toBe(1);
  expect((await request('secrets/reveal',payload(),token,false)).status).toBe(403);expect(calls).toBe(0);
  expect((await request('secrets/reveal',payload(),expired)).status).toBe(401);
  const reset=async()=>{await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('DELETE FROM local_identity.secret_access_windows WHERE owner_id=$1',[owner]);await c.query('SET SESSION AUTHORIZATION loop_app');};
  expect((await request('secrets/reveal',payload(id()))).status).toBe(404);
  expect((await request('secrets/reveal',payload('../../login.keychain-db'))).status).toBe(400);
  expect((await request('secrets/reveal',{...payload(),service:'arbitrary'})).status).toBe(400);
  expect((await request('secrets/reveal',payload(control))).status).toBe(403);
  expect((await request('secrets/reveal',payload(alias))).status).toBe(404);expect(calls).toBe(0);
  expect((await request('secrets/reveal',payload())).status).toBe(429);expect(calls).toBe(0);await reset();
  expect((await request('secrets/reveal',payload(reference,'incorrect'))).status).toBe(403);expect(calls).toBe(0);
  for(const action of ['view','copy']){const r=await request('secrets/reveal',payload(reference,password,action));expect(r.status).toBe(200);expect(r.body.value===value).toBe(true);expect(r.headers.get('cache-control')).toContain('no-store');}
  unavailable=true;const failure=await request('secrets/reveal',payload());expect(failure.status).toBe(503);expect(JSON.stringify(failure.body).includes(value)).toBe(false);unavailable=false;
  await reset();
  // The password digest is read live, even for an already-established session.
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  const updatedPassword='new-synthetic-only-'+id();await c.query('UPDATE local_identity.credentials SET password_digest=$1 WHERE owner_id=$2',[await hashPassword(updatedPassword),owner]);await c.query('SET SESSION AUTHORIZATION loop_app');
  expect((await request('secrets/reveal',payload())).status).toBe(403);
  expect((await request('secrets/reveal',payload(reference,updatedPassword))).status).toBe(200);
  await reset();
  const cross=await fetch(origin+'/api/local/secrets/reveal',{method:'POST',headers:{Origin:'http://example.invalid','Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify(payload())});expect(cross.status).toBe(403);
  await c.query('INSERT INTO local_identity.secret_access_windows(owner_id,scope,started_at,requests) VALUES($1,\'metadata\',clock_timestamp(),120) ON CONFLICT(owner_id,scope) DO UPDATE SET requests=120,started_at=clock_timestamp()',[owner]);
  expect((await request('secrets')).status).toBe(429);await reset();
  await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('UPDATE local_identity.credentials SET failed_attempts=4 WHERE owner_id=$1',[owner]);await c.query('SET SESSION AUTHORIZATION loop_app');
  expect((await request('secrets/reveal',payload(reference,'incorrect'))).status).toBe(403);
  expect((await request('secrets/reveal',payload(reference,updatedPassword))).status).toBe(429);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('UPDATE local_identity.credentials SET failed_attempts=0,locked_until=NULL WHERE owner_id=$1',[owner]);await c.query('SET SESSION AUTHORIZATION loop_app');await reset();
  // Recheck session expiry after the Keychain boundary, before any plaintext response.
  const lateService=new SecretAdministration(pool,{adminOwnerId:owner,runtimeRoot:runtime,controlReferences:[]},{async get(){await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query("UPDATE local_identity.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[tokenHash(token)]);await c.query('SET SESSION AUTHORIZATION loop_app');return value;}});
  handler=createLocalHandler({pool,origin,mediaRoot:fixture,secrets:lateService});const late=await request('secrets/reveal',payload(reference,updatedPassword));expect(late.status).toBe(401);expect(JSON.stringify(late.body).includes(value)).toBe(false);
  // loop_app can append audit only; Owner/Worker cannot query global inventory.
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  const audit=(await c.query('SELECT actor_id,reference,operation,outcome,reason FROM local_identity.secret_access_audit')).rows;
  expect(audit.some(x=>x.actor_id===null&&x.reason==='unauthenticated')).toBe(true);
  expect(audit.some(x=>x.operation==='copy'&&x.outcome==='success')).toBe(true);expect(audit.some(x=>x.reason==='wrong_password')).toBe(true);expect(JSON.stringify(audit).includes(value)||JSON.stringify(audit).includes(password)).toBe(false);
  for(const role of ['loop_owner','loop_worker']){await c.query('SAVEPOINT role_boundary');await c.query('SET SESSION AUTHORIZATION '+role);let denied=false;try{await c.query('SELECT local_identity.secret_reference_inventory($1)',[tokenHash(otherToken)]);}catch{denied=true;}expect(denied).toBe(true);await c.query('ROLLBACK TO SAVEPOINT role_boundary');await c.query('SET SESSION AUTHORIZATION DEFAULT');}
  for(const op of ['SELECT * FROM','UPDATE','DELETE FROM']){await c.query('SAVEPOINT audit_boundary');await c.query('SET SESSION AUTHORIZATION loop_app');let denied=false;try{await c.query(op+' local_identity.secret_access_audit'+(op==='UPDATE'?" SET reason='changed'":''));}catch{denied=true;}expect(denied).toBe(true);await c.query('ROLLBACK TO SAVEPOINT audit_boundary');await c.query('SET SESSION AUTHORIZATION DEFAULT');}
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await c.query('ROLLBACK').catch(()=>{});c.release();await admin.end();bridge.kill();rmSync(fixture,{recursive:true,force:true});context.sql('DROP DATABASE '+testDatabase+' WITH (FORCE)','postgres');}
},60000);
