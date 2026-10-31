// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdir,copyFile,lstat,writeFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
const filesystemFault=vi.hoisted(()=>({destination:'',inode:'',triggered:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 const inject=async(destination:unknown)=>{if(filesystemFault.destination===String(destination)&&!filesystemFault.triggered){filesystemFault.triggered=true;await actual.writeFile(String(destination),'unconfirmed racing file',{flag:'wx'});filesystemFault.inode=String((await actual.lstat(String(destination),{bigint:true})).ino);}};
 return{...actual,rename:async(...args:Parameters<typeof actual.rename>)=>{await inject(args[1]);return actual.rename(...args);},link:async(...args:Parameters<typeof actual.link>)=>{await inject(args[1]);return actual.link(...args);}};
});

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('Owner confirms actual collection files while unknown manual files remain byte-identical',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{
  const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:response.status,body:await response.json()};
 };
 try{
  const relative='系列 中文 %_[] #?/本期 stable',directory=join(f.assetRoot,relative);await mkdir(directory,{recursive:true});const identity=await lstat(directory,{bigint:true});
  await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,relative,String(identity.dev),String(identity.ino)]);
  const source=f.files[0],owned=join(directory,'owned.mp4'),manual=join(directory,'手动保留.txt');await copyFile(join(f.assetRoot,source.relativePath),owned);await writeFile(manual,'manual independent original');
  await f.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'render',$3,$4,$5)",[f.episode,f.task,relative+'/owned.mp4',source.sha256,source.fileSize]);
  expect((await post('archiveEpisode',{episodeId:f.episode,archived:true})).status).toBe(200);
  const plan=await post('planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.path).toBe(directory);
  expect(plan.body.files).toEqual(expect.arrayContaining([expect.objectContaining({path:owned})]));expect(plan.body.preserved).toEqual(expect.arrayContaining([expect.objectContaining({path:manual,reason:expect.any(String)})]));
  const result=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});
  expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.cleanupPending).toBe(false);await expect(access(owned)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(manual,'utf8')).toBe('manual independent original');
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('unknown paid submission blocks confirmed deletion without changing any registered file',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  await post('archiveEpisode',{episodeId:f.episode,archived:true});await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[f.task]);await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state) VALUES($1,$2,'video',1,'submitting')",[f.task,(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id]);const before=await readFile(join(f.assetRoot,f.videoPath));
  const plan=await post('planDeletion',{episodeId:f.episode}),deleted=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(409);expect(deleted.body.error).toContain('提交');expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(before);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('a safely rolled back confirmation releases its reservation for a newly reviewed inventory',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 const confirm=(p:Record<string,unknown>)=>({episodeId:f.episode,confirmation:p.confirmation,expectedPath:p.path,expectedPaths:p.paths,expectedRevision:p.revision});
 try{
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const first=await post('planDeletion',{episodeId:f.episode});
  await f.c.query("CREATE FUNCTION public.fixture_reject_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Controlled rollback';END $$;CREATE TRIGGER fixture_reject_once BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_once()");
  expect((await post('deleteEpisode',confirm(first.body))).status).toBe(503);await f.c.query('DROP TRIGGER fixture_reject_once ON public.episodes;DROP FUNCTION public.fixture_reject_once()');
  const manual=join(f.assetRoot,'episodes',f.episode,'new-manual.txt');await writeFile(manual,'newly reviewed preserved bytes');const revised=await post('planDeletion',{episodeId:f.episode});expect(revised.body.revision).not.toBe(first.body.revision);
  const second=await post('deleteEpisode',confirm(revised.body));expect(second.status,JSON.stringify(second.body)).toBe(200);expect(second.body.cleanupPending).toBe(false);expect(await readFile(manual,'utf8')).toBe('newly reviewed preserved bytes');
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1').each(['link-before-unlink','before-finalize','after-first-finalize'] as const)('a new PID resumes %s interruption using only the original durable scope',async crash=>{
 const f=await embeddedStudioFixture(),children:ChildProcess[]=[];
 const start=async(fault?:typeof crash)=>{
  const child=spawn(join(process.cwd(),'node_modules/.bin/vite-node'),['--config','src/local-app/episodeDeletionProcess.config.mjs','src/local-app/episodeDeletionProcess.fixture.ts'],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});children.push(child);let errors='';child.stderr!.on('data',bytes=>errors+=bytes);const lines=createInterface({input:child.stdout!});child.stdin!.end(JSON.stringify({database:f.database,root:f.root,crash:fault})+'\n');
  const ready=await Promise.race([once(lines,'line').then(([line])=>JSON.parse(String(line))),once(child,'exit').then(()=>{throw Error(errors);})]);lines.close();return{child,...ready as {origin:string;pid:number}};
 };
 const post=async(origin:string,command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:response.status,body:await response.json()};};
 try{
  const manual=join(f.assetRoot,'episodes',f.episode,'manual.txt');await writeFile(manual,'preserved across process death');const before=await lstat(manual,{bigint:true});
  const first=await start(crash);await post(first.origin,'archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post(first.origin,'planDeletion',{episodeId:f.episode}),key=randomUUID(),args={episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  const dead=once(first.child,'exit',{signal:AbortSignal.timeout(10000)});await post(first.origin,'deleteEpisode',args,key).catch(()=>null);await dead;
  const intent=(await f.c.query('SELECT state FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0];expect(intent.state).toBe(crash==='link-before-unlink'?'prepared':'committed');
  const second=await start();expect(second.pid).not.toBe(first.pid);const recovered=await post(second.origin,'deleteEpisode',args,key);expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(recovered.body.cleanupPending).toBe(false);expect(await readFile(manual,'utf8')).toBe('preserved across process death');expect((await lstat(manual,{bigint:true})).ino).toBe(before.ino);
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('an old cleanup receipt without exact file authority remains pending and explains its preserved staging files',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const episode=randomUUID(),key=randomUUID(),stage=join(f.assetRoot,'episodes','.deletion-staging',episode),manual=join(stage,'manual.txt');await mkdir(stage,{recursive:true});await writeFile(manual,'old unconfirmed manual bytes');const identity=await lstat(manual,{bigint:true});
  await f.c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[f.owner,key,'c'.repeat(64),{episodeId:episode,title:'Old cleanup',path:join(f.assetRoot,'episodes',episode),stagingPath:stage,cleanupRoot:f.assetRoot,cleanupKey:key,cleanupPending:true,summary:{}}]);
  const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'retryDeletionCleanup',idempotencyKey:randomUUID(),data:{deletionKey:key}})}),result=await response.json();
  expect(response.status).toBe(200);expect(result.cleanupPending).toBe(true);expect(result.message).toContain('精确文件清单');expect(await readFile(manual,'utf8')).toBe('old unconfirmed manual bytes');expect((await lstat(manual,{bigint:true})).ino).toBe(identity.ino);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('rollback preserves an unknown file inserted at the actual restore publication boundary',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('planDeletion',{episodeId:f.episode});filesystemFault.destination=join(f.assetRoot,f.videoPath);filesystemFault.triggered=false;
  await f.c.query("CREATE FUNCTION public.fixture_reject_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Controlled business rollback';END $$; CREATE TRIGGER fixture_reject_deletion BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_deletion()");
  await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});
  expect(filesystemFault.triggered).toBe(true);expect(await readFile(filesystemFault.destination,'utf8')).toBe('unconfirmed racing file');expect(String((await lstat(filesystemFault.destination,{bigint:true})).ino)).toBe(filesystemFault.inode);
  expect((await lstat(filesystemFault.destination+'.loop-control-deletion')).size).toBe(f.files[0].fileSize);
 }finally{filesystemFault.destination='';await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('staging never overwrites an unknown file inserted at the actual filesystem publication boundary',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('planDeletion',{episodeId:f.episode});filesystemFault.destination=join(f.assetRoot,f.videoPath)+'.loop-control-deletion';filesystemFault.triggered=false;
  const result=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});
  expect(filesystemFault.triggered).toBe(true);expect(result.status).toBe(409);expect(await readFile(filesystemFault.destination,'utf8')).toBe('unconfirmed racing file');expect(String((await lstat(filesystemFault.destination,{bigint:true})).ino)).toBe(filesystemFault.inode);
 }finally{filesystemFault.destination='';await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('a new Owner HTTP PID restores the exact staged files after SIGKILL and resumes the original confirmation',async()=>{
 const f=await embeddedStudioFixture(),children:ChildProcess[]=[];
 const start=async()=>{
  const child=spawn(join(process.cwd(),'node_modules/.bin/vite-node'),['--config','src/local-app/episodeDeletionProcess.config.mjs','src/local-app/episodeDeletionProcess.fixture.ts'],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});children.push(child);let errors='';child.stderr!.on('data',bytes=>{errors+=bytes;process.stderr.write(bytes);});
  const lines=createInterface({input:child.stdout!});child.stdin!.end(JSON.stringify({database:f.database,root:f.root})+'\n');
  const result=await Promise.race([once(lines,'line').then(([line])=>JSON.parse(String(line))),once(child,'exit').then(()=>{throw Error(errors);})]);lines.close();return{child,...result as {origin:string;pid:number}};
 };
 const post=async(origin:string,command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:response.status,body:await response.json()};};
 try{
  const first=await start();await post(first.origin,'archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post(first.origin,'planDeletion',{episodeId:f.episode}),key=randomUUID(),args={episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  await f.c.query("CREATE FUNCTION public.fixture_pause_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(30);RETURN OLD;END $$; CREATE TRIGGER fixture_pause_deletion BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.fixture_pause_deletion()");
  const interrupted=post(first.origin,'deleteEpisode',args,key).catch(()=>null);let staged=false;
  for(let attempt=0;attempt<100;attempt++){staged=await access(join(f.assetRoot,f.videoPath)+'.loop-control-deletion').then(()=>true,()=>false);if(staged)break;await new Promise(resolve=>setTimeout(resolve,50));}
  expect(staged).toBe(true);
  const durable=(await f.c.query('SELECT state,manifest FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0];expect(durable.state).toBe('prepared');expect(durable.manifest.targets[0].files.some((file:{path:string})=>file.path===join(f.assetRoot,f.videoPath))).toBe(true);
  first.child.kill('SIGKILL');await once(first.child,'exit');await interrupted;
  await f.c.query('DROP TRIGGER fixture_pause_deletion ON public.episodes;DROP FUNCTION public.fixture_pause_deletion()');
  const second=await start();expect(second.pid).not.toBe(first.pid);const recovered=await post(second.origin,'deleteEpisode',args,key);expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(recovered.body.cleanupPending).toBe(false);
  await expect(access(join(f.assetRoot,f.videoPath))).rejects.toMatchObject({code:'ENOENT'});await expect(access(join(f.assetRoot,f.videoPath)+'.loop-control-deletion')).rejects.toMatchObject({code:'ENOENT'});
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}await f.close();}
},300000);

it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1')('a durable exact confirmation is committed before filesystem staging and survives business rollback',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:response.status,body:await response.json()};};
 try{
  await post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await post('planDeletion',{episodeId:f.episode}),key=randomUUID();
  await f.c.query("CREATE FUNCTION public.fixture_durable_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=OLD.id AND state='prepared') THEN RAISE EXCEPTION 'Missing durable exact intent';END IF; RETURN OLD; END $$; CREATE TRIGGER fixture_durable_deletion BEFORE DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.fixture_durable_deletion()");
  const result=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision},key);
  expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.cleanupPending).toBe(false);
  const intent=(await f.c.query('SELECT state,manifest FROM local_identity.episode_deletion_intents WHERE idempotency_key=$1',[key])).rows[0];expect(intent.state).toBe('completed');expect(intent.manifest.targets[0].files.length).toBeGreaterThan(0);
 }finally{await f.close();}
},300000);
