// Isolated native HTTP/DB/real Studio fixture. No production rows or Provider calls.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createLocalHandler } from './localRoute';
import { LocalEpisodeCommands,type InputRuntime } from './episodeCommands';
import { hashPassword } from './password';
import { csrfFor, tokenHash } from './sessions';
import { reviewRenderFromSnapshot } from '../worker/codexRunner';
import { verifyOpenChatCutProject } from '../worker/openchatcutProjectReader';
import { buildOpenChatCutProject } from '../worker/openchatcutProject';
import { confirmedTtsRender } from '../worker/openchatcutProject.fixture';
import { copyFixtureSchema } from './fixtureSchema';
const exec=promisify(execFile);
export async function embeddedStudioFixture(options:{testRootParent?:string;origin?:string;landscape?:boolean;testContextModule?:string;openChatCutRoot?:string;migrations?:string[];runtime?:Partial<InputRuntime>}={}){
  const mod=options.testContextModule??process.env.LOOP_TEST_CONTEXT_MODULE??join(process.cwd(),'scripts/runtime/environment.mjs');const {runtimeContext}=await import(mod);const context=runtimeContext();context.assertDatabase();
  const database='loop_studio_153_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
  try{
  await copyFixtureSchema(context,database,[...new Set([...(options.migrations??[]),'db/local/105-account-asset-directories.sql','db/local/106-account-directory-migrations.sql','db/local/110-episode-storage-locations.sql','db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql','db/local/113-automatic-account-directories.sql','db/local/114-series-storage-containers.sql','db/local/115-exact-episode-deletion-intents.sql','db/local/117-input-storage-locations.sql','db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql'])].sort());
  }catch(error){context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');throw error;}
  const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
  const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
  const admin=new Pool({database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
  const c=await admin.connect();const owner=randomUUID(),other=randomUUID(),account=randomUUID(),episode=randomUUID(),task=randomUUID(),board=randomUUID(),qc=randomUUID(),boardArtifact=randomUUID(),videoArtifact=randomUUID();
  const token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex'),password='fixture-'+randomUUID(),email=owner+'@example.invalid';
  const root=await realpath(await mkdtemp(join(options.testRootParent??'/private/tmp','loop-153-')));const assetRoot=join(root,'account');await mkdir(join(assetRoot,'episodes',episode),{recursive:true});
  const clients=new Set<ReturnType<typeof spawn>>();
  const pool=new Pool({database,user:'loop_app',max:4,connectionTimeoutMillis:5000,stream:()=>{
    const child=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
    clients.add(child);child.once('exit',()=>clients.delete(child));
    const socket=Duplex.from({readable:child.stdout!,writable:child.stdin!});
    return Object.assign(socket,{ref(){return socket;},unref(){return socket;},connect(){queueMicrotask(()=>socket.emit('connect'));return socket;},setNoDelay(){return socket;},setKeepAlive(){return socket;}});
  }} as ConstructorParameters<typeof Pool>[0]);
  const workerPool=()=>new Pool({...pool.options,user:'loop_worker'} as ConstructorParameters<typeof Pool>[0]);
  const runtime={root:options.openChatCutRoot??process.env.LOOP_TEST_OPENCHATCUT_ROOT??join(process.cwd(),'.loop-control/local/OpenChatCut'),nodePath:process.execPath};
  const createCommands=()=>new LocalEpisodeCommands(pool,root,{ready:async()=>{},wake(){throw Error('No generation permitted');},mountPath:root,minimumFreeBytes:0,studioRuntime:async()=>runtime,checkReferences:async()=>{throw Error('No Provider permitted');},...options.runtime});
  let commands=createCommands();
  let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));let started=false;
  async function close(){await commands.close();if(started){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}try{await pool.end();}finally{c.release();await admin.end();bridge.kill();for(const client of clients)client.kill();context.sql('DROP DATABASE '+database+' WITH (FORCE)','postgres');await rm(root,{recursive:true,force:true});}}
  try{
    const render=confirmedTtsRender(false);render.preRenderReviewPackageId=board;render.adjustments.width=options.landscape?640:360;render.adjustments.height=options.landscape?360:640;render.adjustments.aspectRatio=options.landscape?'16:9':'9:16';
    const videoPath=`episodes/${episode}/shot.mp4`,voicePath=`episodes/${episode}/voice.mp3`,boardPath=`episodes/${episode}/board.json`;
    await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`testsrc2=size=${render.adjustments.width}x${render.adjustments.height}:rate=30`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',join(assetRoot,videoPath)]);
    await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:a','libmp3lame',join(assetRoot,voicePath)]);
    render.projectRelativePath=boardPath;render.members[0].relativePath=videoPath;render.members[1].relativePath=voicePath;
    const files=[];
    for(const member of render.members){const bytes=await readFile(join(assetRoot,member.relativePath));member.sha256=createHash('sha256').update(bytes).digest('hex');files.push({relativePath:member.relativePath,sha256:member.sha256,fileSize:bytes.length,artifactType:member.memberKind});}
    await writeFile(join(assetRoot,boardPath),JSON.stringify(render.storyboard));const boardBytes=await readFile(join(assetRoot,boardPath)),boardSha=createHash('sha256').update(boardBytes).digest('hex');
    const snake=(v:unknown):unknown=>Array.isArray(v)?v.map(snake):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()),k==='composition'?value:snake(value)])):v;
    const frozen=snake(render) as Record<string,unknown>;frozen.storyboard=render.storyboard;const parsed=reviewRenderFromSnapshot({capability:'review_rendering',review_render:frozen})!;await verifyOpenChatCutProject(parsed,buildOpenChatCutProject(parsed),runtime);
    await c.query('BEGIN');
    await c.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,email,other,other+'@example.invalid']);
    await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2),($3,$2)',[owner,await hashPassword(password),other]);
    await c.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[tokenHash(token),owner,tokenHash(otherToken),other]);
    await c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Studio153 fixture','Asia/Shanghai')",[account,'studio153-'+account]);
    await c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,owner]);
    const directoryStat=await lstat(assetRoot,{bigint:true});await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4)',[account,assetRoot,String(directoryStat.dev),String(directoryStat.ino)]);
    await c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[account,{asset_root:assetRoot}]);
    await c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
    await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$2,'隔离 Studio153 验收','qc_review')",[episode,account]);
    await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,storyboard_enabled) VALUES($1,$2,true)',[episode,owner]);
    await c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed',$3)",[task,episode,{capability:'review_rendering',review_render:frozen,input_artifacts:files}]);
    await c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'storyboard',$4,$5,$6),($7,$2,$3,'render',$8,$9,$10)",[boardArtifact,episode,task,boardPath,boardSha,boardBytes.length,videoArtifact,videoPath,files[0].sha256,files[0].fileSize]);
    await c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,task_id,context_snapshot) VALUES($1,$2,'storyboard_review',1,$3,$4,$5),($6,$2,'qc_review',1,$7,$4,$8)",[board,episode,boardArtifact,task,{worker_result:{storyboard:render.storyboard}},qc,videoArtifact,{project_relative_path:boardPath}]);
    await c.query("INSERT INTO local_identity.import_record(imported_at,source_created_at,archive_sha256,source_media_root) VALUES(now(),now(),$1,$2)",['f'.repeat(64),root]);
    const rootStat=await lstat(root,{bigint:true});
    await c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[root,String(rootStat.dev),String(rootStat.ino),options.testRootParent??'/',owner]);
    await c.query('COMMIT');
    server.listen(0,'127.0.0.1');await once(server,'listening');started=true;const origin=options.origin??`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    handler=createLocalHandler({pool,origin,mediaRoot:root,episodes:commands});
    const directory=await fetch(origin+'/api/local/account-commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command:'setAssetDirectory',idempotencyKey:randomUUID(),data:{accountId:account,path:assetRoot}})});if(directory.status!==200)throw Error('Fixture account directory: '+JSON.stringify(await directory.json()));
    const request=async(command:string,data:Record<string,unknown>={},options:{token?:string;csrf?:boolean;origin?:string}={})=>{const session=options.token??token;const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:options.origin??origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+session,...(options.csrf===false?{}:{'X-CSRF-Token':csrfFor(session)})},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{episodeId:episode,...data}})});return{status:response.status,body:await response.json()};};
    return{workerPool,root,assetRoot,database,episode,owner,email,password,token,otherToken,pool,c,origin,boardPath,board,task,videoPath,files,runtime,request,handler,restart:async()=>{await commands.close();commands=createCommands();handler=createLocalHandler({pool,origin,mediaRoot:root,episodes:commands});},closeStudio:()=>commands.closeStudio(episode),close};
  }catch(error){await close();throw error;}
}
