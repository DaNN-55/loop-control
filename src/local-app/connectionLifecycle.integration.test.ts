// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomUUID,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {Pool,type PoolClient} from 'pg';
import {LocalConnections} from './connections';
import {tokenHash} from './sessions';
import {hashPassword} from './password';

it.skipIf(process.env.LOOP_CONNECTION_ACCEPTANCE!=='1')('creates, rotates and verifies every current provider through real database commands without live provider calls',async()=>{
 const {runtimeContext}=await import(join(process.cwd(),'scripts/runtime/environment.mjs')),context=runtimeContext();context.assertDatabase();
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket';my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:context.database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})}as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),owner=randomUUID(),account=randomUUID(),token=randomBytes(32).toString('hex');
 const scoped={async query(text:string,values?:unknown[]){if(text.startsWith('BEGIN'))return c.query('SAVEPOINT connection_command');if(text==='COMMIT')return c.query('RELEASE SAVEPOINT connection_command');if(text==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT connection_command');return c.query(text,values);},release(){}}as unknown as PoolClient;
 const pool={connect:async()=>scoped}as unknown as Pool;
 const values=new Map<string,string>();
 const providers={volcengine:'seedance_video',minimax:'minimax_video',kling:'kling_video',bailian:'wan_video',pexels:'pexels_video',freesound:'freesound_preview',openai:'openai_images',volcengine_tts:'volcengine_tts'};
 const service=new LocalConnections(pool,{mode:'keychain',async putImmutable(id,value){values.set(id,value);},async get(id){return values.get(id)!;}},{mode:'live',networkAvailable:true,verificationStatus:()=>({available:true,code:'available',detail:'Controlled probe'}),async verify(){return 'verified';}});
 const session={id:owner,email:owner+'@example.invalid',token};
 try{
  await c.query('BEGIN');
  await c.query('INSERT INTO local_identity.owners(id,email)VALUES($1,$2)',[owner,session.email]);
  await c.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,'Connection rollback fixture','UTC')",[account,'fixture-'+account]);
  await c.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[account,owner]);
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest)VALUES($1,$2)',[owner,await hashPassword('synthetic-connection-password')]);
  await c.query("INSERT INTO local_identity.sessions(owner_id,token_hash,expires_at)VALUES($1,$2,now()+interval '1 hour')",[owner,tokenHash(token)]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const empty=await service.read(owner);expect(empty.connections).toHaveLength(0);expect(empty.capabilities.verificationAvailable).toBe(true);
  for(const[provider,adapter]of Object.entries(providers)){
   const created=await service.command(session,{command:'create',idempotencyKey:randomUUID(),data:{name:'Fixture '+provider,provider,adapter,secret:'synthetic-initial'}})as{connection:{id:string;current_version_id:string}};
   expect(created.connection.id).toBeTruthy();
   const updated=await service.command(session,{command:'rotate',idempotencyKey:randomUUID(),data:{connectionId:created.connection.id,provider,adapter,secret:'synthetic-rotated'}})as typeof created;
   expect(updated.connection.current_version_id).not.toBe(created.connection.current_version_id);
   const result=await service.command(session,{command:'verify',idempotencyKey:randomUUID(),data:{connectionId:created.connection.id}})as{ready:boolean};expect(result.ready).toBe(true);
  }
  const read=await service.read(owner);expect(read.connections).toHaveLength(8);expect(read.versions).toHaveLength(16);expect(read.pending).toHaveLength(0);expect(read.connections.every(row=>row.status==='verified')).toBe(true);
  expect(JSON.stringify(read)).not.toContain('synthetic-rotated');expect(values.size).toBe(16);
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release();await admin.end();bridge.kill();}
},30000);
