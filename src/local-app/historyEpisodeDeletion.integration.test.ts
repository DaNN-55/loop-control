// @vitest-environment node
// Schema only: all writes and filesystem deletions use a disposable database and media root.
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync,chmodSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {copyFixtureSchema} from './fixtureSchema';
import {hashPassword} from './password';
import {csrfFor,tokenHash,sessionCookie} from './sessions';

it.skipIf(process.env.LOOP_HISTORY_DELETE_ACCEPTANCE!=='1')('deletes only the confirmed history, live order and exclusive files through real Owner HTTP',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated test context required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();
 const database='loop_history_delete_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'loop-history-delete-'))),media=join(temporary,'media'),root=join(media,'account'),historyRoot=join(temporary,'history');mkdirSync(root,{recursive:true});mkdirSync(historyRoot);
 const bridges:ChildProcess[]=[];
 function connection(){
  const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
  bridges.push(bridge);const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
  return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;},ref(){return stream;},unref(){return stream;}});
 }

 const pool=new Pool({database,user:'postgres',max:1,stream:connection} as ConstructorParameters<typeof Pool>[0]);
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),episode=randomUUID(),neighbor=randomUUID(),foreign=randomUUID(),task=randomUUID(),token=randomBytes(32).toString('hex'),source=randomBytes(32).toString('hex'),foreignSource=randomBytes(32).toString('hex');
 const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
 const contents=['exclusive history bytes','protected history bytes','shared history bytes','indirect leaf'];contents.push('depends on '+sha(contents[3]));
 const hashes=contents.map(sha);for(let i=0;i<contents.length;i++)writeFileSync(join(historyRoot,hashes[i]),contents[i]);writeFileSync(join(historyRoot,'preserved.json'),JSON.stringify({reference:hashes[4]}));
 const directory=join(root,'episodes',episode);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'output.bin'),contents[0]);writeFileSync(join(root,'keep.txt'),'unrelated original');
 const asAdmin=async(sql:string,values?:unknown[])=>{await pool.query('RESET SESSION AUTHORIZATION');try{return await pool.query(sql,values);}finally{await pool.query('SET SESSION AUTHORIZATION loop_app');}};
 try{
  await copyFixtureSchema(context,database,['db/local/110-episode-storage-locations.sql','db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql','db/local/113-automatic-account-directories.sql','db/local/114-series-storage-containers.sql','db/local/115-exact-episode-deletion-intents.sql','db/local/117-input-storage-locations.sql','db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql']);
  if(!(await pool.query("SELECT to_regclass('local_identity.history_episode_deletions') present")).rows[0].present)await pool.query(readFileSync('db/local/077-history-episode-deletion.sql','utf8'));
  await pool.query(readFileSync('db/local/078-history-deletion-child-ownership.sql','utf8'));
  await pool.query('INSERT INTO local_identity.owners(id,email)VALUES($1,$2),($3,$4)',[owner,'fixture-'+owner+'@example.invalid',other,'fixture-'+other+'@example.invalid']);
  await pool.query('INSERT INTO local_identity.credentials(owner_id,password_digest)VALUES($1,$2)',[owner,await hashPassword('synthetic-only-'+randomUUID())]);
  await pool.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at)VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),owner]);
  await pool.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,'Fixture account','UTC')",[account,'fixture-'+account]);
  await pool.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[account,owner]);
  // Controlled pre108 history import fixture: retain the original frozen root evidence.
  await pool.query('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER a_blueprint_creative_write');
  await pool.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active)VALUES($1,$1,1,$2,true)',[account,{asset_root:root}]);await pool.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
  await pool.query('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER a_blueprint_creative_write');
  await pool.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title)VALUES($1,$2,$2,'Delete fixture')",[episode,account]);
  await pool.query('INSERT INTO local_identity.historical_episodes(episode_id)VALUES($1)',[episode]);
  await pool.query("INSERT INTO public.tasks(id,episode_id,task_type)VALUES($1,$2,'draft_brief')",[task,episode]);await pool.query('INSERT INTO local_identity.historical_tasks(task_id)VALUES($1)',[task]);
  await pool.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id)VALUES($1,'reference',$2,$3,$4,$5)",[episode,'episodes/'+episode+'/output.bin',hashes[0],contents[0].length,task]);
  // Internal material approvals are owned children, not surviving cross-order dependencies.
  const material=randomUUID();await pool.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,created_by)VALUES($1,$2,1,'script','file','fixture','fixture','text/plain',$3,$4,$5)",[material,episode,hashes[0],contents[0].length,owner]);await pool.query('INSERT INTO public.material_revision_approvals(material_revision_id,approved_by)VALUES($1,$2)',[material,owner]);
  await pool.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label)VALUES($1,$2,'fixture','Owner fixture'),($3,$4,'fixture','Foreign fixture')",[source,owner,foreignSource,other]);
  for(const [id,who]of [[episode,owner],[neighbor,owner],[foreign,other]]){const payload=JSON.stringify({id,account_id:account,title:id===episode?'Delete fixture':'Kept fixture'});await pool.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('public.episodes',$1,$2,$3,$4)",[{id},sha(payload),who,payload]);}
  for(let i=0;i<hashes.length;i++)await pool.query('INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind)VALUES($1,$2,$3,$4,$5)',[source,`episodes/${episode}/file-${i}.bin`,hashes[i],contents[i].length,i===1?'ordinary-history-literals':'media']);
  await pool.query("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind)VALUES($1,$2,$3,$4,'media'),($5,$6,$3,$4,'media')",[source,`episodes/${neighbor}/shared.bin`,hashes[2],contents[2].length,foreignSource,`episodes/${foreign}/shared.bin`]);
  // Historical path aliases can be absent; confirmed real copies still belong to the exact plan.
  const oldMedia=join(temporary,'old-media'),oldRoot=join(oldMedia,'account'),oldDirectory=join(oldRoot,'episodes',episode);mkdirSync(oldDirectory,{recursive:true});writeFileSync(join(oldDirectory,'output.bin'),contents[0]);
  await pool.query("INSERT INTO local_identity.import_record(singleton,imported_at,source_created_at,archive_sha256,source_media_root,media_source_roots)VALUES(true,now(),now(),$1,$2,$3)",['b'.repeat(64),join(temporary,'absent-path-alias'),[oldMedia]]);
  await pool.query('SET SESSION AUTHORIZATION loop_app');server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address()as{port:number}).port}`;handler=createLocalHandler({pool,origin,mediaRoot:media,historyRoot});
  const post=async(command:string,data:unknown,key=randomUUID(),csrf=true,session=token)=>{const response=await fetch(origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Cookie:sessionCookie+'='+session}:{}),...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:response.status,body:await response.json()};};
  const plan=async(id=episode)=>{const r=await post('planHistoryDeletion',{episodeId:id});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const args=(p:Awaited<ReturnType<typeof plan>>)=>({episodeId:p.episodeId,confirmation:p.confirmation,expectedPath:p.path,expectedPaths:p.paths,expectedRevision:p.revision});
  expect((await post('planHistoryDeletion',{episodeId:episode},randomUUID(),false)).status).toBe(403);
  expect((await post('planHistoryDeletion',{episodeId:episode},randomUUID(),true,'')).status).toBe(401);
  expect((await post('planHistoryDeletion',{episodeId:foreign})).status).toBe(404);
  let p=await plan();expect(p.liveEpisode).toBe(true);expect(p.paths).toEqual([directory]);expect(p.historyFiles).toBe(1);expect(p.preservedFiles).toBe(4);
  expect((await post('deleteHistoryEpisode',{...args(p),confirmation:'wrong'})).status).toBe(409);expect(existsSync(directory)).toBe(true);
  writeFileSync(join(directory,'new-unreviewed.txt'),'new local content');expect((await post('deleteHistoryEpisode',args(p))).status).toBe(409);expect(existsSync(join(directory,'new-unreviewed.txt'))).toBe(true);unlinkSync(join(directory,'new-unreviewed.txt'));p=await plan();
  await asAdmin("UPDATE public.tasks SET status='failed' WHERE id=$1",[task]);expect((await post('deleteHistoryEpisode',args(p))).status).toBe(409);p=await plan();
  await asAdmin("UPDATE public.tasks SET status='running',claimed_at=now(),lease_token=$2,attempt=1 WHERE id=$1",[task,randomUUID()]);expect((await post('planHistoryDeletion',{episodeId:episode})).status).toBe(409);await asAdmin("UPDATE public.tasks SET status='failed',claimed_at=NULL,lease_token=NULL WHERE id=$1",[task]);
  // Cross-order references to a selected object block deletion even without a shared path.
  const crossOrder=randomUUID(),dependencyId=randomUUID();await asAdmin("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title)VALUES($1,$2,$2,'Kept current order')",[crossOrder,account]);await asAdmin("INSERT INTO public.production_dependencies(id,episode_id,upstream_kind,upstream_id,downstream_kind,downstream_id)VALUES($1,$2,'review_package',$3,'task',$4)",[dependencyId,crossOrder,randomUUID(),task]);expect((await post('planHistoryDeletion',{episodeId:episode})).status).toBe(409);await asAdmin('DELETE FROM public.production_dependencies WHERE id=$1',[dependencyId]);
  // A preserved filesystem document referencing a runtime path must block directory deletion.
  writeFileSync(join(root,'dependency.json'),JSON.stringify({file:join(directory,'output.bin')}));expect((await post('planHistoryDeletion',{episodeId:episode})).status).toBe(409);unlinkSync(join(root,'dependency.json'));
  await asAdmin("CREATE FUNCTION public.reject_history_fixture_delete()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture rollback';END$$;CREATE TRIGGER reject_history_fixture BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.reject_history_fixture_delete()");
  p=await plan();expect((await post('deleteHistoryEpisode',args(p))).status).not.toBe(200);expect(readFileSync(join(directory,'output.bin'),'utf8')).toBe(contents[0]);expect(readFileSync(join(oldDirectory,'output.bin'),'utf8')).toBe(contents[0]);expect((await asAdmin('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[episode])).rows[0].n).toBe(1);
  await asAdmin('DROP TRIGGER reject_history_fixture ON public.episodes;DROP FUNCTION public.reject_history_fixture_delete()');
  p=await plan();const key=randomUUID(),deleted=await post('deleteHistoryEpisode',args(p),key);expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);expect((await post('deleteHistoryEpisode',args(p),key)).body.cleanupPending).toBe(false);
  expect(existsSync(directory)).toBe(false);expect(readFileSync(join(oldDirectory,'output.bin'),'utf8')).toBe(contents[0]);expect(existsSync(join(historyRoot,hashes[0]))).toBe(false);for(const hash of hashes.slice(1))expect(existsSync(join(historyRoot,hash))).toBe(true);expect(readFileSync(join(root,'keep.txt'),'utf8')).toBe('unrelated original');
  expect((await asAdmin('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[episode])).rows[0].n).toBe(0);expect((await asAdmin("SELECT count(*)::int n FROM local_identity.history_versions WHERE owner_id=$1 AND payload->>'id'=$2",[owner,episode])).rows[0].n).toBe(0);
  const list=await fetch(origin+'/api/local/history-episodes?contentOnly=false',{headers:{Cookie:sessionCookie+'='+token}});expect(list.status).toBe(200);expect((await list.json()).items.map((x:{episode_id:string})=>x.episode_id)).not.toContain(episode);
  // History-only rows use the same confirmation and retain other Owners' shared media.
  const historyOnly=await plan(neighbor);expect(historyOnly.liveEpisode).toBe(false);expect(historyOnly.historyFiles).toBe(0);expect((await post('deleteHistoryEpisode',args(historyOnly))).body.cleanupPending).toBe(false);expect(existsSync(join(historyRoot,hashes[2]))).toBe(true);
  const unnamed=randomUUID(),unnamedPayload=JSON.stringify({id:unnamed,title:''});await asAdmin("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('public.episodes',$1,$2,$3,$4)",[{id:unnamed},sha(unnamedPayload),owner,unnamedPayload]);const unnamedPlan=await plan(unnamed);expect(unnamedPlan.title).toBe('未命名生产单 · '+unnamed.slice(0,8));expect(unnamedPlan.confirmation).toBe(unnamedPlan.title);expect((await post('deleteHistoryEpisode',args(unnamedPlan))).body.cleanupPending).toBe(false);
  // Post-commit filesystem failures retain a retry receipt; only temporary files are affected.
  const retryEpisode=randomUUID(),retryContent='retry fixture media',retrySha=sha(retryContent),retryPayload=JSON.stringify({id:retryEpisode,title:'Retry fixture'});
  await asAdmin("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('public.episodes',$1,$2,$3,$4)",[{id:retryEpisode},sha(retryPayload),owner,retryPayload]);await asAdmin("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind)VALUES($1,$2,$3,$4,'media')",[source,`episodes/${retryEpisode}/retry.bin`,retrySha,retryContent.length]);writeFileSync(join(historyRoot,retrySha),retryContent);
  const retryPlan=await plan(retryEpisode),retryKey=randomUUID();chmodSync(historyRoot,0o500);let pending;
  try{pending=await post('deleteHistoryEpisode',args(retryPlan),retryKey);}finally{chmodSync(historyRoot,0o700);}
  expect(pending.status).toBe(200);expect(pending.body.cleanupPending).toBe(true);expect(existsSync(join(historyRoot,retrySha))).toBe(true);
  expect((await post('retryDeletionCleanup',{deletionKey:retryKey})).body.cleanupPending).toBe(false);expect(existsSync(join(historyRoot,retrySha))).toBe(false);
  // A reference inserted while the database deletion commits wins over physical removal.
  const lateEpisode=randomUUID(),lateContent='late reference fixture',lateSha=sha(lateContent),latePayload=JSON.stringify({id:lateEpisode,title:'Late fixture'});
  await asAdmin("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('public.episodes',$1,$2,$3,$4)",[{id:lateEpisode},sha(latePayload),owner,latePayload]);await asAdmin("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind)VALUES($1,$2,$3,$4,'media')",[source,`episodes/${lateEpisode}/late.bin`,lateSha,lateContent.length]);writeFileSync(join(historyRoot,lateSha),lateContent);
  await asAdmin(`CREATE FUNCTION public.retain_late_history_fixture()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF OLD.sha256='${lateSha}' THEN INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason)VALUES('${owner}','late-reference/'||OLD.sha256,OLD.sha256,OLD.bytes,'media','{}','business-dependency');END IF;RETURN OLD;END$$;CREATE TRIGGER retain_late_history BEFORE DELETE ON local_identity.history_files FOR EACH ROW EXECUTE FUNCTION public.retain_late_history_fixture()`);
  const latePlan=await plan(lateEpisode);expect(latePlan.historyFiles).toBe(1);expect((await post('deleteHistoryEpisode',args(latePlan))).body.cleanupPending).toBe(false);expect(existsSync(join(historyRoot,lateSha))).toBe(true);expect((await asAdmin("SELECT count(*)::int n FROM local_identity.history_retained_files WHERE sha256=$1 AND logical_path LIKE 'retained-after-deletion/%'",[lateSha])).rows[0].n).toBe(1);

 }finally{await new Promise<void>(resolve=>{if(server.listening)server.close(()=>resolve());else resolve();});await pool.end();for(const bridge of bridges)bridge.kill();context.sql('DROP DATABASE '+database+' WITH(FORCE)','postgres');rmSync(temporary,{recursive:true,force:true});}
},120000);
