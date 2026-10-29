// @vitest-environment node
// Opt-in: copy only the current schema into an empty, disposable database.
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,existsSync,rmSync,chmodSync,lstatSync} from 'node:fs';
import {Pool,type PoolClient} from 'pg';
import {createLocalHandler} from './localRoute';
import {hashPassword} from './password';
import {csrfFor,tokenHash,sessionCookie} from './sessions';

it.skipIf(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE!=='1').each(['empty','nonempty','shared'])('%s: deletes an account through Owner HTTP, cleaning only empty exclusive roots and preserving history and deletion guards',async(mode)=>{
 const {runtimeContext}=await import(join(process.cwd(),'scripts/runtime/environment.mjs')),context=runtimeContext();
 const database='loop_account_delete_test_'+randomBytes(8).toString('hex');
 context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 try{
  context.sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',context.database,'--schema-only']),database);
 }catch(error){context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');throw error;}
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
 const client=await admin.connect(),owner=randomUUID(),other=randomUUID(),account=randomUUID(),occupied=randomUUID(),foreign=randomUUID(),event=randomUUID(),otherEvent=randomUUID();
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'account-delete-'))),media=join(temporary,'media'),root=join(media,'deleted-account'),oldMedia=join(temporary,'old-media'),copy=join(oldMedia,'deleted-account'),foreignRoot=join(media,'other-account'),historyFile=join(temporary,'history','keep.txt');
 for(const path of [root,copy,foreignRoot,join(temporary,'history')])mkdirSync(path,{recursive:true});
 writeFileSync(join(foreignRoot,'keep.txt'),'other account material');writeFileSync(historyFile,'historical material');
 if(mode==='nonempty')writeFileSync(join(root,'.hidden-original'),'original material');
 const token=randomBytes(32).toString('hex'),password='fixture-only-'+randomUUID(),source=createHash('sha256').update(randomUUID()).digest('hex');
 const scoped={async query(sql:string,values?:unknown[]){
  if(sql.startsWith('BEGIN'))return client.query('SAVEPOINT http_request');
  if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT http_request');
  if(sql==='ROLLBACK'){await client.query('ROLLBACK TO SAVEPOINT http_request');return client.query('RELEASE SAVEPOINT http_request');}
  return client.query(sql,values);
 },release(){}} as unknown as PoolClient;
 const pool={query:(sql:string,values?:unknown[])=>client.query(sql,values),connect:async()=>scoped} as unknown as Pool;
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((request,response)=>handler(request,response));
 try{
  await client.query('BEGIN');
  await client.query(readFileSync('db/local/065-account-audit-deletion.sql','utf8'));
  await client.query(readFileSync('db/local/073-empty-account-directory-cleanup.sql','utf8'));
  await client.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,`delete-${owner}@example.invalid`,other,`delete-${other}@example.invalid`]);
  await client.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword(password)]);
  await client.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),owner]);
  for(const [id,user]of [[account,owner],[occupied,owner],[foreign,other]]){
   await client.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Delete fixture','UTC')",[id,'delete-'+id]);
   await client.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[id,user]);
   await client.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[id]);
   await client.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[id]);
  }
  await client.query('UPDATE public.account_blueprint_versions SET policy=$2 WHERE account_id=$1',[account,{asset_root:root}]);
  if(mode==='shared')await client.query('UPDATE public.account_blueprint_versions SET policy=$2 WHERE account_id=$1',[foreign,{asset_root:copy}]);
  await client.query("INSERT INTO local_identity.import_record(singleton,imported_at,source_created_at,archive_sha256,source_media_root) VALUES(true,now(),now(),$1,$2)",['b'.repeat(64),oldMedia]);
  await client.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title) VALUES($1,$1,$1,'Must retain production order')",[occupied]);
  await client.query("INSERT INTO public.audit_events(id,account_id,event_type) VALUES($1,$2,'account_created'),($3,$4,'account_created')",[event,account,otherEvent,foreign]);
  await client.query('INSERT INTO local_identity.historical_audit_events(event_id) VALUES($1),($2)',[event,otherEvent]);
  await client.query("INSERT INTO public.notification_delivery_events(event_id,outcome) VALUES($1,'historical')",[event]);
  await client.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label) VALUES($1,$2,'test','Immutable fixture history')",[source,owner]);
  await client.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES('public.audit_events',$1,$2,$3,$4)",[{id:event},source,owner,{id:event,account_id:account,event_type:'account_created'}]);
  await client.query("INSERT INTO local_identity.history_source_rows(source_id,table_name,row_key,payload_sha256) VALUES($1,'public.audit_events',$2,$1)",[source,{id:event}]);
  await client.query("INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status) VALUES('public.audit_events',$1,$2,'inserted')",[{id:event},source]);
  const history=async()=>{
   const result=[];
   for(const table of ['history_sources','history_versions','history_source_rows','history_projection_results','history_files'])result.push((await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') rows FROM local_identity.${table} t`)).rows[0].rows);
   return result;
  };
  const beforeHistory=await history();
  await client.query('SET SESSION AUTHORIZATION loop_app');
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool,origin,mediaRoot:media});
  const remove=async(id=account,confirmation='Delete fixture',key=randomUUID(),csrf=true)=>{
   const r=await fetch(origin+'/api/local/configuration',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessionCookie+'='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command:'deleteAccount',idempotencyKey:key,data:{accountId:id,confirmation}})});
   return{status:r.status,body:await r.json()};
  };
  expect((await remove(account,'Delete fixture',randomUUID(),false)).status).toBe(403);
  expect((await remove(foreign)).status).toBe(404);
  expect((await remove(account,'wrong confirmation')).status).toBe(400);
  expect((await remove(occupied)).status).toBe(409);
  // Reject the receipt insert after DELETE, proving rolled-back transactions do not touch directories.
  await client.query('RESET SESSION AUTHORIZATION');
  await client.query("CREATE FUNCTION public.reject_account_delete_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result ? 'deletedAccountId' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_account_delete_receipt BEFORE INSERT ON local_identity.command_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_account_delete_receipt()");
  await client.query('SET SESSION AUTHORIZATION loop_app');
  const rootInode=lstatSync(root).ino;
  expect((await remove()).status).toBe(503);expect(lstatSync(root).ino).toBe(rootInode);expect(existsSync(copy)).toBe(true);
  await client.query('RESET SESSION AUTHORIZATION');await client.query('DROP TRIGGER reject_account_delete_receipt ON local_identity.command_receipts; DROP FUNCTION public.reject_account_delete_receipt()');await client.query('SET SESSION AUTHORIZATION loop_app');
  if(mode==='empty')chmodSync(media,0o500);
  const key=randomUUID(),deleted=await remove(account,'Delete fixture',key);
  expect(deleted).toEqual({status:200,body:true});
  if(mode==='empty'){expect(existsSync(root)).toBe(true);chmodSync(media,0o700);}
  expect(await remove(account,'Delete fixture',key)).toEqual(deleted);
  expect(existsSync(root)).toBe(mode!=='empty');expect(existsSync(copy)).toBe(mode==='shared');
  if(mode==='nonempty')expect(readFileSync(join(root,'.hidden-original'),'utf8')).toBe('original material');
  expect(readFileSync(join(foreignRoot,'keep.txt'),'utf8')).toBe('other account material');expect(readFileSync(historyFile,'utf8')).toBe('historical material');
  expect((await remove(account,'changed',key)).status).toBe(409);
  await client.query('RESET SESSION AUTHORIZATION');
  expect(await history()).toEqual(beforeHistory);
  for(const [table,column,value]of [['public.accounts','id',account],['public.audit_events','id',event],['local_identity.historical_audit_events','event_id',event],['public.notification_delivery_events','event_id',event],['public.account_memberships','account_id',account],['public.account_blueprint_versions','account_id',account]]){
   expect((await client.query(`SELECT count(*)::integer n FROM ${table} WHERE ${column}=$1`,[value])).rows[0].n).toBe(0);
  }
  expect((await client.query('SELECT count(*)::integer n FROM public.episodes WHERE account_id=$1',[occupied])).rows[0].n).toBe(1);
  expect((await client.query('SELECT count(*)::integer n FROM local_identity.historical_audit_events WHERE event_id=$1',[otherEvent])).rows[0].n).toBe(1);
  expect((await client.query('SELECT count(*)::integer n FROM local_identity.historical_audit_events h LEFT JOIN public.audit_events a ON a.id=h.event_id WHERE a.id IS NULL')).rows[0].n).toBe(0);
 }finally{
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  await client.query('ROLLBACK').catch(()=>{});client.release();await admin.end();bridge.kill();
  context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');
  chmodSync(media,0o700);rmSync(temporary,{recursive:true,force:true});
 }
},30000);
