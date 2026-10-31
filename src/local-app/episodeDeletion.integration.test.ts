// @vitest-environment node
// Schema only: all writes and filesystem deletions use a disposable database and media root.
import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,chmodSync,renameSync,symlinkSync,unlinkSync,readdirSync,lstatSync} from 'node:fs';
import {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
import {copyFixtureSchema} from './fixtureSchema';
import {hashPassword} from './password';
import {csrfFor,tokenHash,sessionCookie} from './sessions';

const cleanupPermissionFault=vi.hoisted(()=>({directory:'',triggered:false}));
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return{...actual,unlink:async(path:Parameters<typeof actual.unlink>[0])=>{if(cleanupPermissionFault.directory&&String(path).startsWith(cleanupPermissionFault.directory+'/')&&String(path).endsWith('.loop-control-deletion')&&!cleanupPermissionFault.triggered){cleanupPermissionFault.triggered=true;await actual.chmod(cleanupPermissionFault.directory,0o500);}return actual.unlink(path);}};});

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1').each([true,false])('managed=%s: deletes an archived ordinary order and then its empty account through Owner HTTP, retaining deletion fences',async(managed)=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated test context required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();
 const database='loop_episode_delete_'+randomBytes(6).toString('hex');
 context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'loop-episode-delete-'))),media=join(temporary,'media'),root=join(media,'account');
 mkdirSync(root,{recursive:true});
 const bridges:ChildProcess[]=[];
 function connection(){
  const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
  bridges.push(bridge);const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
  return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;},ref(){return stream;},unref(){return stream;}});
 }
 const pool=new Pool({database,user:'postgres',max:1,stream:connection} as ConstructorParameters<typeof Pool>[0]);
 const locker=new Pool({database,user:'postgres',max:1,stream:connection} as ConstructorParameters<typeof Pool>[0]);
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((request,response)=>handler(request,response));
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),foreign=randomUUID(),episode=randomUUID(),foreignEpisode=randomUUID(),task=randomUUID(),token=randomBytes(32).toString('hex');
 const oldMedia=join(temporary,'old-media'),copyRoot=join(oldMedia,'account'),directory=join(root,'episodes',episode),copyDirectory=join(copyRoot,'episodes',episode),neighbor=join(root,'keep.txt');
 const asAdmin=async(sql:string,values?:unknown[])=>{await pool.query('RESET SESSION AUTHORIZATION');try{return await pool.query(sql,values);}finally{await pool.query('SET SESSION AUTHORIZATION loop_app');}};
 try{
  await copyFixtureSchema(context,database,['db/local/110-episode-storage-locations.sql','db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql','db/local/113-automatic-account-directories.sql','db/local/114-series-storage-containers.sql','db/local/115-exact-episode-deletion-intents.sql','db/local/117-input-storage-locations.sql','db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql']);
  await pool.query(readFileSync('db/local/068-archived-episode-deletion.sql','utf8'));
  await pool.query(readFileSync('db/local/069-legacy-episode-cleanup.sql','utf8'));
  await pool.query(readFileSync('db/local/073-empty-account-directory-cleanup.sql','utf8'));
  await pool.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,`delete-${owner}@example.invalid`,other,`delete-${other}@example.invalid`]);
  await pool.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword('fixture-only-'+randomUUID())]);
  await pool.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),owner]);
  // Seed genuine pre108 imported blueprint evidence before reenabling the current write projector.
  await pool.query('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER a_blueprint_creative_write');
  for(const [id,user]of [[account,owner],[foreign,other]]){
   await pool.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Delete fixture','UTC')",[id,'delete-'+id]);
   await pool.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[id,user]);
   await pool.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[id,{asset_root:root}]);
   await pool.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[id]);
  }
  await pool.query('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER a_blueprint_creative_write');
  for(const [id,a,user]of [[episode,account,owner],[foreignEpisode,foreign,other]]){
   await pool.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,is_test) VALUES($1,$2,$2,'Ordinary order',false)",[id,a]);
   if(managed||id!==episode)await pool.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[id,user]);
  }
  await pool.query("INSERT INTO public.tasks(id,episode_id,task_type) VALUES($1,$2,'draft_brief')",[task,episode]);
  await pool.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) VALUES($1,'reference',$2,$3,24,$4)",[episode,'episodes/'+episode+'/output.txt',createHash('sha256').update('synthetic episode output').digest('hex'),task]);
  await pool.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) VALUES($1,'reference',$2,$3,6,$4)",[episode,'episodes/'+episode+'/z-protected/second.txt',createHash('sha256').update('second').digest('hex'),task]);
  await pool.query("INSERT INTO public.audit_events(account_id,episode_id,event_type) VALUES($1,$2,'deletion_fixture')",[account,episode]);
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'output.txt'),'synthetic episode output');writeFileSync(neighbor,'unrelated account file');
  mkdirSync(join(directory,'z-protected'));writeFileSync(join(directory,'z-protected','second.txt'),'second');
  await pool.query("INSERT INTO local_identity.import_record(singleton,imported_at,source_created_at,archive_sha256,source_media_root) VALUES(true,now(),now(),$1,$2)",['b'.repeat(64),oldMedia]);
  mkdirSync(copyDirectory,{recursive:true});writeFileSync(join(copyDirectory,'output.txt'),'synthetic episode output');
  for(const accountRoot of [root,copyRoot]){mkdirSync(join(accountRoot,'materials'));writeFileSync(join(accountRoot,'materials','raw.txt'),'original media');mkdirSync(join(accountRoot,'episodes',foreignEpisode));writeFileSync(join(accountRoot,'episodes',foreignEpisode,'keep.txt'),'other production order');}
  const titleLink=(accountRoot:string)=>join(accountRoot,'episodes','按标题浏览','待删除标题');
  for(const accountRoot of [root,copyRoot]){
   const navigation=join(accountRoot,'episodes','按标题浏览');mkdirSync(navigation);
   symlinkSync('../'+episode,titleLink(accountRoot),'dir');
   symlinkSync('../'+foreignEpisode,join(navigation,'其他生产单'),'dir');
   symlinkSync('../unrelated-missing',join(navigation,'其他失效标题'),'dir');
  }
  const retainedSourceBefore=await deletionFixtureFingerprint(copyRoot);
  const historicalFile=join(temporary,'history','content','keep.txt');mkdirSync(join(temporary,'history','content'),{recursive:true});writeFileSync(historicalFile,'historical data');
  await pool.query('SET SESSION AUTHORIZATION loop_app');
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool,origin,mediaRoot:media});
  const post=async(command:string,data:unknown,key=randomUUID(),csrf=true,endpoint='episode-lifecycle')=>{
   const r=await fetch(origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessionCookie+'='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command,idempotencyKey:key,data})});
   return{status:r.status,body:await r.json()};
  };
  const plan=async()=>{const result=await post('planDeletion',{episodeId:episode});expect(result.status).toBe(200);return{episodeId:episode,confirmation:result.body.confirmation,expectedPath:result.body.path,expectedPaths:result.body.paths,expectedRevision:result.body.revision};};
  const removeAccount=()=>post('deleteAccount',{accountId:account,confirmation:'Delete fixture'},randomUUID(),true,'configuration');
  expect((await post('archiveEpisode',{episodeId:episode,archived:true},randomUUID(),false)).status).toBe(403);
  expect((await post('planDeletion',{episodeId:foreignEpisode})).status).toBe(404);
  expect((await post('deleteEpisode',await plan())).status).toBe(409);
  if(managed)expect((await post('archiveEpisode',{episodeId:episode,archived:true})).status).toBe(200);
  else await asAdmin('UPDATE public.episodes SET archived_at=now() WHERE id=$1',[episode]);
  expect((await removeAccount()).status).toBe(409);
  await asAdmin('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[episode]);
  expect((await post('planDeletion',{episodeId:episode})).status).toBe(404);
  await asAdmin('DELETE FROM local_identity.historical_episodes WHERE episode_id=$1',[episode]);
  expect((await asAdmin('SELECT count(*)::integer n FROM local_identity.input_episodes WHERE episode_id=$1',[episode])).rows[0].n).toBe(managed?1:0);
  let args=await plan();
  expect(args.expectedPaths).toEqual([directory]);
  for(const changed of [{confirmation:'wrong'},{expectedPath:root},{expectedPaths:[copyDirectory]},{expectedRevision:'stale'}])expect((await post('deleteEpisode',{...args,...changed})).status).toBe(409);
  await asAdmin("UPDATE public.tasks SET status='running',claimed_at=now(),lease_token=$2,attempt=1 WHERE id=$1",[task,randomUUID()]);
  expect((await post('deleteEpisode',await plan())).status).toBe(409);
  await asAdmin("UPDATE public.tasks SET status='ready',claimed_at=NULL,lease_token=NULL WHERE id=$1",[task]);
  await asAdmin("INSERT INTO public.asset_locks(resource_key,episode_id,expires_at) VALUES('fixture-lock',$1,now()+interval '1 hour')",[episode]);
  expect((await post('deleteEpisode',await plan())).status).toBe(409);
  await asAdmin("DELETE FROM public.asset_locks WHERE resource_key='fixture-lock'");
  args=await plan();
  const lock=await locker.connect();
  try{await lock.query('BEGIN');await lock.query('SELECT id FROM public.tasks WHERE id=$1 FOR UPDATE',[task]);expect((await post('deleteEpisode',args)).status).toBe(409);}finally{await lock.query('ROLLBACK');lock.release();}
  expect(readFileSync(join(directory,'output.txt'),'utf8')).toBe('synthetic episode output');
  // A missing or replaced current directory invalidates the confirmed identity.
  renameSync(directory,directory+'-preserved');
  expect((await post('deleteEpisode',args)).status).toBe(409);
  symlinkSync(join(root,'materials'),directory,'dir');
  expect((await post('deleteEpisode',args)).status).toBe(409);
  unlinkSync(directory);renameSync(directory+'-preserved',directory);
  // The second current file cannot stage: the first current file must be restored.
  chmodSync(join(directory,'z-protected'),0o500);
  try{expect((await post('deleteEpisode',await plan())).status).toBe(409);}finally{chmodSync(join(directory,'z-protected'),0o700);}
  expect(readFileSync(join(directory,'output.txt'),'utf8')).toBe('synthetic episode output');
  expect(readFileSync(join(copyDirectory,'output.txt'),'utf8')).toBe('synthetic episode output');
  await asAdmin("CREATE FUNCTION public.reject_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic database deletion failure'; END $$; CREATE TRIGGER reject_fixture_delete BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_delete()");
  expect((await post('deleteEpisode',await plan())).status).toBe(503);
  expect(readFileSync(join(directory,'output.txt'),'utf8')).toBe('synthetic episode output');
  expect(readFileSync(join(copyDirectory,'output.txt'),'utf8')).toBe('synthetic episode output');
  for(const accountRoot of [root,copyRoot])expect(lstatSync(titleLink(accountRoot)).isSymbolicLink()).toBe(true);
  await asAdmin('DROP TRIGGER reject_fixture_delete ON public.episodes; DROP FUNCTION public.reject_fixture_delete()');
  args=await plan();const key=randomUUID();
  // New manual content invalidates the old confirmation and stays outside exact cleanup.
  writeFileSync(join(directory,'new-manual.txt'),'new manual');
  expect((await post('deleteEpisode',args)).status).toBe(409);unlinkSync(join(directory,'new-manual.txt'));args=await plan();
  // Publish succeeds; a real permission change at final unlink leaves a retry receipt.
  cleanupPermissionFault.directory=directory;cleanupPermissionFault.triggered=false;
  const deleted=await post('deleteEpisode',args,key);
  expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body).toMatchObject({episodeId:episode,cleanupPending:true,paths:[directory]});
  expect(existsSync(directory)).toBe(true);
  const stagedCopy=join(directory,'output.txt.loop-control-deletion');expect(existsSync(stagedCopy)).toBe(true);
  expect(await deletionFixtureFingerprint(copyRoot)).toEqual(retainedSourceBefore);
  expect(lstatSync(titleLink(root)).isSymbolicLink()).toBe(true);expect(lstatSync(titleLink(copyRoot)).isSymbolicLink()).toBe(true);
  const pendingResponse=await fetch(origin+'/api/local/deletion-cleanups',{headers:{Cookie:sessionCookie+'='+token}});expect((await pendingResponse.json())[0].stagingPaths).toHaveLength(2);
  chmodSync(directory,0o700);cleanupPermissionFault.directory='';
  const retried=await post('retryDeletionCleanup',{deletionKey:key});expect(retried.status).toBe(200);expect(retried.body.cleanupPending).toBe(false);expect(existsSync(stagedCopy)).toBe(false);
  for(const accountRoot of [root,copyRoot]){
   if(accountRoot===root)expect(()=>lstatSync(titleLink(accountRoot))).toThrow();else expect(lstatSync(titleLink(accountRoot)).isSymbolicLink()).toBe(true);
   expect(existsSync(join(accountRoot,'episodes','.deletion-staging'))).toBe(false);
   expect(lstatSync(join(accountRoot,'episodes','按标题浏览','其他生产单')).isSymbolicLink()).toBe(true);
   expect(lstatSync(join(accountRoot,'episodes','按标题浏览','其他失效标题')).isSymbolicLink()).toBe(true);
  }
  expect(readFileSync(historicalFile,'utf8')).toBe('historical data');
  expect(deleted.body.summary.counts.tasks).toBe(1);expect(deleted.body.summary.counts.artifacts).toBe(2);
  expect((await post('deleteEpisode',args,key)).body.cleanupPending).toBe(false);
  expect(existsSync(directory)).toBe(false);expect(existsSync(join(root,'episodes','.deletion-staging',episode))).toBe(false);
  expect(readFileSync(neighbor,'utf8')).toBe('unrelated account file');
  for(const accountRoot of [root,copyRoot]){expect(readFileSync(join(accountRoot,'materials','raw.txt'),'utf8')).toBe('original media');expect(readFileSync(join(accountRoot,'episodes',foreignEpisode,'keep.txt'),'utf8')).toBe('other production order');}
  for(const table of ['episodes','tasks','artifacts','audit_events'])expect((await asAdmin(`SELECT count(*)::integer n FROM public.${table} WHERE ${table==='episodes'?'id':'episode_id'}=$1`,[episode])).rows[0].n).toBe(0);
  // Real COMMIT boundary: deleting a separate empty account also removes its empty
  // current root only, retaining old-blueprint and deployment-source directories.
  const emptyAccount=randomUUID(),emptyRoot=join(media,'empty-account'),emptyCopy=join(oldMedia,'empty-account'),oldBlueprintRoot=join(media,'empty-account-previous');
  for(const path of [emptyRoot,emptyCopy,oldBlueprintRoot])mkdirSync(path,{recursive:true});
  await asAdmin("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Empty account','UTC')",[emptyAccount,'empty-'+emptyAccount]);
  await asAdmin("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[emptyAccount,owner]);
  await asAdmin('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER a_blueprint_creative_write');
  await asAdmin('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[emptyAccount,{asset_root:emptyRoot}]);
  await asAdmin('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$2,2,$3,false)',[randomUUID(),emptyAccount,{asset_root:oldBlueprintRoot}]);
  await asAdmin('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER a_blueprint_creative_write');
  await asAdmin('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[emptyAccount]);
  const emptyDeleted=await post('deleteAccount',{accountId:emptyAccount,confirmation:'Empty account'},randomUUID(),true,'configuration');
  expect(emptyDeleted,JSON.stringify(emptyDeleted.body)).toEqual({status:200,body:true});
  expect(existsSync(emptyRoot)).toBe(false);for(const path of [emptyCopy,oldBlueprintRoot])expect(existsSync(path)).toBe(true);
  expect(readFileSync(historicalFile,'utf8')).toBe('historical data');
  expect((await removeAccount()).status).toBe(200);
  // This account still has material and other-order directories, so both roots stay.
  expect(existsSync(root)).toBe(true);expect(existsSync(copyRoot)).toBe(true);
  expect((await asAdmin('SELECT count(*)::integer n FROM public.accounts WHERE id=$1',[account])).rows[0].n).toBe(0);
  expect((await asAdmin('SELECT count(*)::integer n FROM public.episodes WHERE id=$1',[foreignEpisode])).rows[0].n).toBe(1);
  // Old cleanup receipts must not silently acquire newly supported external targets.
  const legacyId=randomUUID(),legacyKey=randomUUID(),legacyStage=join(root,'episodes','.deletion-staging',legacyId),unconfirmedCopy=join(copyRoot,'episodes',legacyId);
  mkdirSync(legacyStage,{recursive:true});writeFileSync(join(legacyStage,'output.txt'),'previously confirmed output');
  mkdirSync(unconfirmedCopy,{recursive:true});writeFileSync(join(unconfirmedCopy,'keep.txt'),'not in old confirmation');
  for(const accountRoot of [root,copyRoot])symlinkSync('../'+legacyId,join(accountRoot,'episodes','按标题浏览','旧回执标题'),'dir');
  await asAdmin('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[owner,legacyKey,'c'.repeat(64),{episodeId:legacyId,title:'Legacy cleanup',path:join(root,'episodes',legacyId),stagingPath:legacyStage,cleanupKey:legacyKey,cleanupPending:true,summary:{},cleanupRoot:root}]);
  const legacy=await post('retryDeletionCleanup',{deletionKey:legacyKey});expect(legacy.status).toBe(200);expect(legacy.body.cleanupPending).toBe(true);expect(legacy.body.message).toContain('精确文件清单');expect(readFileSync(join(legacyStage,'output.txt'),'utf8')).toBe('previously confirmed output');
  expect(readFileSync(join(unconfirmedCopy,'keep.txt'),'utf8')).toBe('not in old confirmation');
  expect(lstatSync(join(root,'episodes','按标题浏览','旧回执标题')).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(copyRoot,'episodes','按标题浏览','旧回执标题')).isSymbolicLink()).toBe(true);

 }finally{
  cleanupPermissionFault.directory='';
  server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await pool.end();await locker.end();for(const bridge of bridges)bridge.kill();
  context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');
  const writable=(path:string)=>{const stat=lstatSync(path);if(stat.isDirectory()&&!stat.isSymbolicLink()){chmodSync(path,0o700);for(const name of readdirSync(path))writable(join(path,name));}};
  writable(temporary);rmSync(temporary,{recursive:true,force:true});
 }
},30000);
