import {recoverPendingNativeAttemptOutput} from './nativeAttemptOutput';
// Real isolated Owner/HTTP/PostgreSQL/files. Business scenarios own their own records and media.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands,type InputRuntime} from './episodeCommands';
import {hashPassword} from './password';
import {csrfFor,tokenHash} from './sessions';
import {copyFixtureSchema} from './fixtureSchema';
import {fixtureResources} from './fixtureResources';

export interface FixtureSetupPoint {
 stage:'volume'|'database'|'directory'|'server'|'account'|'episode'|'script';
 database?:string;root?:string;origin?:string;mountPath?:string;
}
export interface NativeWorkspaceFixtureOptions {
 storageContract?:'current'|'pre-lineage';databaseName?:string;testRootParent?:string;origin?:string;
 testContextModule?:string;openChatCutRoot?:string;migrations?:string[];runtime?:Partial<InputRuntime>;
 connections?:(pool:Pool)=>NonNullable<Parameters<typeof createLocalHandler>[0]['connections']>;
 onSetup?:(point:FixtureSetupPoint)=>void|Promise<void>;
}

export async function nativeWorkspaceFixture(options:NativeWorkspaceFixtureOptions={}){
 const resources=fixtureResources();
 try{
  const mod=options.testContextModule??process.env.LOOP_TEST_CONTEXT_MODULE??join(process.cwd(),'scripts/runtime/environment.mjs');
  const {runtimeContext}=await import(mod);const context=runtimeContext();context.assertDatabase();
  const database=options.databaseName??'loop_studio_153_'+randomBytes(6).toString('hex');
  if(!/^loop_[a-z0-9_]+_[a-f0-9]{12}$/.test(database))throw Error('Fixture database must have a random owned name');
  context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
  resources.defer(()=>{context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');});
  await options.onSetup?.({stage:'database',database});
  await copyFixtureSchema(context,database,[...new Set([...(options.migrations??[]),'db/local/105-account-asset-directories.sql','db/local/106-account-directory-migrations.sql','db/local/110-episode-storage-locations.sql','db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql','db/local/113-automatic-account-directories.sql','db/local/114-series-storage-containers.sql','db/local/115-exact-episode-deletion-intents.sql','db/local/117-input-storage-locations.sql','db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql','db/local/120-native-workspace-storage-locations.sql','db/local/121-restored-media-deployment.sql','db/local/122-automatic-episode-directories.sql','db/local/133-native-output-publication-fences.sql',...(options.storageContract==='pre-lineage'?[]:['db/local/123-legacy-storage-adoption.sql','db/local/124-episode-collection-moves.sql'])])].sort());

  const bridgeScript="my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}";
  const clients=new Set<ReturnType<typeof spawn>>();
  const stream=()=>{
   const child=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',bridgeScript],{env:context.env,stdio:['pipe','pipe','pipe']});
   clients.add(child);child.once('exit',()=>clients.delete(child));
   const socket=Duplex.from({readable:child.stdout!,writable:child.stdin!});
   return Object.assign(socket,{ref(){return socket;},unref(){return socket;},connect(){queueMicrotask(()=>socket.emit('connect'));return socket;},setNoDelay(){return socket;},setKeepAlive(){return socket;}});
  };
  resources.defer(()=>{for(const child of clients)child.kill();});
  const admin=new Pool({database,user:'postgres',max:1,connectionTimeoutMillis:5000,stream} as ConstructorParameters<typeof Pool>[0]);
  resources.defer(async()=>{if(!admin.ended)await admin.end();});
  const c=await admin.connect();resources.defer(()=>c.release());
  const temporary=await mkdtemp(join(options.testRootParent??'/private/tmp','loop-153-'));
  resources.defer(()=>rm(temporary,{recursive:true,force:true}));
  const root=await realpath(temporary);await options.onSetup?.({stage:'directory',database,root});
  const pool=new Pool({database,user:'loop_app',max:4,connectionTimeoutMillis:5000,stream} as ConstructorParameters<typeof Pool>[0]);
  resources.defer(async()=>{if(!pool.ended)await pool.end();});
  const workerPool=()=>{const worker=new Pool({...pool.options,user:'loop_worker'} as ConstructorParameters<typeof Pool>[0]);resources.defer(async()=>{if(!worker.ended)await worker.end();});return worker;};
  const recoveryPool=workerPool();
  const recoverOutput=(taskId:string,attempt:number)=>recoverPendingNativeAttemptOutput(recoveryPool,root,taskId,attempt);
  const connections=options.connections?.(pool);

  const owner=randomUUID(),other=randomUUID(),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex'),password='fixture-'+randomUUID(),email=owner+'@example.invalid';
  await c.query('BEGIN');
  await c.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,email,other,other+'@example.invalid']);
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2),($3,$2)',[owner,await hashPassword(password),other]);
  await c.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[tokenHash(token),owner,tokenHash(otherToken),other]);
  await c.query('COMMIT');
  const runtime={root:options.openChatCutRoot??process.env.LOOP_TEST_OPENCHATCUT_ROOT??join(process.cwd(),'.loop-control/local/OpenChatCut'),nodePath:process.execPath};
  const createCommands=()=>new LocalEpisodeCommands(pool,root,{ready:async()=>{},wake(){throw Error('No generation permitted');},mountPath:root,minimumFreeBytes:0,studioRuntime:async()=>runtime,checkReferences:async()=>{throw Error('No Provider permitted');},...options.runtime});
  let handler:ReturnType<typeof createLocalHandler>,commands:LocalEpisodeCommands|undefined,origin='';
  const server=createServer((q,r)=>handler(q,r));
  resources.defer(async()=>{if(server.listening){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
  resources.defer(async()=>{await commands?.close();});
  const start=async()=>{
   commands=createCommands();
   server.listen(0,'127.0.0.1');await once(server,'listening');
   origin=options.origin??`http://127.0.0.1:${(server.address() as {port:number}).port}`;
   handler=createLocalHandler({pool,origin,mediaRoot:root,episodes:commands,connections,recoverOutput});
   await options.onSetup?.({stage:'server',database,root,origin});return origin;
  };
  return{database,root,pool,c,owner,other,token,otherToken,password,email,runtime,workerPool,start,
   get origin(){return origin;},get handler(){return handler;},
   async restart(){await commands!.close();commands=createCommands();handler=createLocalHandler({pool,origin,mediaRoot:root,episodes:commands,connections,recoverOutput});},
   closeStudio:(episodeId:string)=>commands!.closeStudio(episodeId),close:resources.close,
   async post(endpoint:string,command:string,data:Record<string,unknown>,requestOptions:{token?:string;csrf?:boolean;origin?:string}={}){
    const session=requestOptions.token??token;
    const response=await fetch(origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:requestOptions.origin??origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+session,...(requestOptions.csrf===false?{}:{'X-CSRF-Token':csrfFor(session)})},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});
    return{status:response.status,body:await response.json()};
   },
  };
 }catch(error){return resources.fail(error);}
}
