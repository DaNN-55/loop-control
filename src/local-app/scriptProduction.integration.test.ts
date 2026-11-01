// @vitest-environment node
// Explicit schema-only, isolated database. All fixture rows roll back; no Worker,
// image/audio/video generation or Provider network is started by this test.
import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {LocalEpisodeCommands} from './episodeCommands';
import {ScriptProductionStore} from './scriptProductionStore';
import {productionScriptTemplate,parseProductionScript} from '../reviews/productionScript';
import {storyboardFromScript} from '../worker/scriptPlanning';
import {tokenHash} from './sessions';
import {hashPassword} from './password';
import {readContinuationSnapshot,productionActionId,type ProductionScope} from './scriptProductionRunner';
import {nextScriptProductionAction} from './scriptProductionContinuation';
import * as mediaTools from '../worker/mediaTools';

it.skipIf(!process.env.LOOP_SCRIPT_V2_TEST_FIXTURE)('real PostgreSQL: v2 import, immutable binding, scoped authorization, configuration and review guards',async()=>{
 const fixture=JSON.parse(readFileSync(process.env.LOOP_SCRIPT_V2_TEST_FIXTURE!,'utf8'));
 expect(fixture.testOnly).toBe(true);expect(fixture.database).toMatch(/^loop_script_v2_20261028_\d+$/);
 expect(fixture.context).toBe('colima-loop-control');expect(fixture.container).toBe('loop-control-local-postgres');
 const bridge=spawn('docker',['--context',fixture.context,'exec','-i',fixture.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:fixture.database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),owner=randomUUID(),other=randomUUID(),account=randomUUID(),episode=randomUUID(),review=randomUUID(),artifact=randomUUID(),token='a'.repeat(64);
 const connection=randomUUID(),version=randomUUID(),secret=randomUUID(),series=randomUUID(),seriesVersion=randomUUID(),reuseEpisode=randomUUID();
 const mediaRoot=await realpath(await mkdtemp(join(tmpdir(),'loop-v2-test-'))),root=join(mediaRoot,'account');await mkdir(root);
 const scoped={async query(sql:string,values?:unknown[]){if(sql.startsWith('BEGIN'))return c.query('SAVEPOINT script_command');if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT script_command');if(sql==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT script_command');return c.query('RELEASE SAVEPOINT script_command');}return c.query(sql,values);},release(){}} as PoolClient;
 const pool={query:(sql:string,values?:unknown[])=>c.query(sql,values),connect:async()=>scoped} as unknown as Pool;
 let wakes=0,queueOnly=false;
 const commands=new LocalEpisodeCommands(pool,mediaRoot,{ready:async()=>{},wake(){wakes++;},mountPath:mediaRoot,minimumFreeBytes:0,mediaReady:async()=>{expect(queueOnly).toBe(true);},checkReferences:async()=>{if(!queueOnly)throw Error('No Provider reference may be used before the queue-only test');}});
 const session={id:owner,email:'fixture@example.invalid',token};
 const run=(command:string,data:Record<string,unknown>,key=randomUUID())=>commands.execute(session,{command,data:{episodeId:episode,...data},idempotencyKey:key});
 const text=productionScriptTemplate.replace('填写已上传图片的素材名称','客厅首帧').replace('- 旁白音色：默认','- 旁白音色：zh_male_m191_uranus_bigtts').replace('- 转场：cut','- 转场：fade').replace('- 背景音乐素材：默认','- 背景音乐素材：背景音乐\n- 音乐音量（dB）：-18\n- 音效音量（dB）：-24').replace('- 音效素材：无','- 音效素材：流水\n- 音效起点（秒）：0.3\n- 音效时长（秒）：1');
 const audioProbe=vi.spyOn(mediaTools,'probeMp3Artifact').mockResolvedValue(60);
 try{
  await c.query('BEGIN');
  await c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await c.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2),($3,$4)',[owner,session.email,other,'other@example.invalid']);
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword('synthetic-script-test-'+randomUUID())]);
  await c.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[tokenHash(token),owner]);
  await c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Script fixture','Asia/Shanghai')",[account,'script-'+account]);
  await c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,owner]);
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  await c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'bailian','wan_video','Queue-only fixture',$2,$3,'https://dashscope.aliyuncs.com')",[connection,owner,version]);
  await c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'bailian','wan_video','https://dashscope.aliyuncs.com',$3)",[version,connection,secret]);
  await c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,owner,secret]);
  await c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,owner]);
  await c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,owner]);
  await c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[account,{asset_root:root}]);
  await c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  await c.query('SELECT public.update_current_blueprint($1,$2)',[account,{asset_root:root,b_roll:{execution_path:'external',credential_ref:version,executor:{provider:'bailian',adapter:'wan_video',model:'wan2.6-i2v-flash'}}}]);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  await c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'Fixture series')",[series,account]);
  await c.query("INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,'{}',$4)",[seriesVersion,account,series,owner]);
  await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,series_version_id,title,stage) VALUES($1,$2,$2,$3,'v2 fixture','waiting_input')",[episode,account,seriesVersion]);
  await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,series_version_id,title,stage) VALUES($1,$2,$2,$3,'Reuse fixture','waiting_input')",[reuseEpisode,account,seriesVersion]);
  await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,script_template_version) VALUES($1,$2,2)',[episode,owner]);
  await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[reuseEpisode,owner]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const upload=async(name:string,content:string,isMainScript=false)=>run('importMaterial',{sourceKind:'file',sourcePath:name,logicalName:isMainScript?'script.md':'actor.png',materialType:isMainScript?'script':'image',materialPurpose:isMainScript?'main_script':'visual_reference',mimeType:isMainScript?'text/markdown':'image/png',contentBase64:Buffer.from(content).toString('base64'),isMainScript});
  const main=await upload('script.md',text,true);
  const store=new ScriptProductionStore(mediaRoot);
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  const missing=await store.read(c,episode);expect(missing.plan?.issues.join('')).toContain('待上传');
  await expect(run('configureScriptProduction',{enabled:true,choices:{}})).rejects.toThrow('待上传');
  const first=await upload('客厅首帧.png','immutable test fixture bytes');
  for(const [name,purpose]of [['背景音乐','background_music'],['流水','sound_effect']])await run('importMaterial',{sourceKind:'file',sourcePath:name+'.mp3',materialType:'audio',materialPurpose:purpose,mimeType:'audio/mpeg',isMainScript:false,contentBase64:Buffer.from('inert '+name+' test bytes').toString('base64')});
  const saved=await run('configureScriptProduction',{enabled:true,choices:{}});expect(saved.enabled).toBe(true);
  const scope:ProductionScope={episode_id:episode,owner_id:owner,authorization_hash:saved.authorizationHash};
  const automatic=(commands as unknown as {executeAutomatic:(scope:ProductionScope,body:Record<string,unknown>)=>Promise<unknown>}).executeAutomatic.bind(commands);
  await expect(automatic(scope,{command:'approveQc',data:{episodeId:episode},idempotencyKey:randomUUID()})).rejects.toThrow('不能执行');
  const replayKey=randomUUID();const firstSave=await run('configureScriptProduction',{enabled:true,choices:{}},replayKey);expect(await run('configureScriptProduction',{enabled:true,choices:{}},replayKey)).toEqual(firstSave);
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  const read=await store.read(c,episode);expect(read.plan?.segments[0].firstFrame.material?.id).toBe(first.id);expect(read.enabled).toBe(true);
  expect((await c.query('SELECT * FROM local_identity.script_production_scopes()')).rows).toContainEqual(scope);
  const initial=await readContinuationSnapshot(c,scope);expect(initial&&nextScriptProductionAction(initial)).toEqual({wait:'等待确认主脚本并开始制作'});
  await c.query('SAVEPOINT foreign_owner');await c.query("SELECT set_config('loop.owner_id',$1,true)",[other]);
  expect((await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1',[episode])).rowCount).toBe(0);
  expect((await c.query('SELECT local_identity.script_material_is_approved($1) approved',[first.id])).rows[0].approved).toBe(false);
  await c.query('ROLLBACK TO SAVEPOINT foreign_owner');
  await run('importMaterial',{episodeId:reuseEpisode,sourceKind:'file',sourcePath:'script.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',contentBase64:Buffer.from(text).toString('base64'),isMainScript:true});
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  expect((await store.read(c,reuseEpisode)).inspection?.segments[0].firstFrame.material?.episodeId).toBe(episode);
  const reused=await run('configureScriptProduction',{episodeId:reuseEpisode,enabled:false,choices:{}});
  expect(reused.plan.segments[0].firstFrame.material).toMatchObject({episodeId:reuseEpisode,sha256:first.sha256});expect(reused.plan.segments[0].firstFrame.material.id).not.toBe(first.id);
  const inputs=[{artifactType:'main_script',relativePath:main.storage_path,sha256:main.sha256,fileSize:Number(main.file_size)},{artifactType:'visual_reference',relativePath:first.storage_path,sha256:first.sha256,fileSize:Number(first.file_size)}];
  const board=storyboardFromScript(parseProductionScript(text)!,inputs),path=`episodes/${episode}/storyboard.json`;
  await writeFile(join(root,path),JSON.stringify(board));
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  await c.query("INSERT INTO public.artifacts(id,episode_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'storyboard',$3,$4,$5)",[artifact,episode,path,createHash('sha256').update(JSON.stringify(board)).digest('hex'),Buffer.byteLength(JSON.stringify(board))]);
  await c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES($1,$2,'storyboard_review',1,$3,$4)",[review,episode,artifact,{worker_result:{storyboard:board}}]);
  await c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Synthetic test approval',$3)",[episode,review,owner]);
  await c.query("UPDATE public.episodes SET stage='storyboard_approved' WHERE id=$1",[episode]);await c.query('UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=$1',[episode]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const apply={command:'applyScriptSettings',data:{episodeId:episode,reviewPackageId:review},identity:{episodeId:episode,reviewPackageId:review}};
  const applyBody={command:apply.command,data:apply.data,idempotencyKey:productionActionId(scope,apply)};
  // Durable delegation survives a browser session expiring, while the scope and
  // immutable script are checked on every action. No generation is invoked.
  await c.query("UPDATE local_identity.sessions SET revoked_at=clock_timestamp() WHERE owner_id=$1",[owner]);
  expect(await automatic(scope,applyBody)).toEqual({applied:true});
  expect(await automatic(scope,applyBody)).toEqual({applied:true});
  await c.query("UPDATE local_identity.sessions SET revoked_at=NULL WHERE owner_id=$1",[owner]);
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  const draft=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1',[episode])).rows[0];
  expect(draft.tts_text).toBe(parseProductionScript(text)!.segments[0].narration);expect(draft.transition_mode).toBe('fade');expect(draft.caption_contract.spatial.max_characters_per_line).toBe(14);expect(draft.preparation_contract.audio_mix.main_voice.gain_db).toBe(0);
  expect(draft.preparation_contract.audio_mix.bgm.gain_db).toBe(-18);expect(draft.preparation_contract.audio_mix.sfx.gain_db).toBe(-24);
  await run('saveTtsDraft',{reviewPackageId:review,shotId:'shot-01',audioMode:'tts',subtitleText:'本期人工修改',subtitlesEnabled:true,ttsText:'本期人工修改',ttsVoice:'zh_male_m191_uranus_bigtts',ttsSpeakingRate:1,transitionMode:'cut'});
  await run('applyScriptSettings',{reviewPackageId:review});
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  expect((await c.query('SELECT tts_text,transition_mode FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0]).toMatchObject({tts_text:'本期人工修改',transition_mode:'cut'});
  await expect(run('confirmSyncPreview',{reviewPackageId:review,shotId:'shot-01'})).rejects.toThrow();
  // Queue the real paid command behind the existing budget guard, but never
  // start a Worker or use network/credentials. Every row is rolled back.
  queueOnly=true;
  await run('saveTtsDraft',{reviewPackageId:review,shotId:'shot-01',audioMode:'none',subtitleText:'',subtitlesEnabled:false,ttsText:null});
  const paidData={episodeId:episode,reviewPackageId:review,shotId:'shot-01',firstFrameId:first.id,prompt:read.plan!.segments[0].videoPrompt,durationSeconds:5};
  const paidBody={command:'generateWan',data:paidData,idempotencyKey:productionActionId(scope,{command:'generateWan',data:paidData,identity:paidData})};
  await expect(automatic(scope,{...paidBody,data:{...paidData,prompt:'Stale proposal'}})).rejects.toThrow('输入或审核状态已变化');
  await expect(automatic(scope,paidBody)).rejects.toThrow();

  const paid=await automatic(scope,paidBody) as {id:string};
  expect((await automatic(scope,paidBody) as {id:string}).id).toBe(paid.id);
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  expect((await c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND provider='bailian'",[episode])).rows[0].n).toBe(1);
  await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('SET SESSION AUTHORIZATION loop_worker');
  const claim=(await c.query('SELECT * FROM local_identity.claim_input_task($1,1)',[paid.id])).rows[0];expect(claim.task_id).toBe(paid.id);
  const reserve=async()=>(await c.query('SELECT local_identity.reserve_wan_generation($1,$2,$3) result',[paid.id,claim.attempt,claim.lease_token])).rows[0].result;
  expect(await reserve()).toMatchObject({reserved_cents:75,new:true});expect(await reserve()).toMatchObject({reserved_cents:75,new:false});
  await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('SET SESSION AUTHORIZATION loop_app');await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  // Only the codec probe is substituted here; immutable import, Owner checks,
  // JSON transport and the real workbench SQL are exercised without media.
  const video=await run('importMaterial',{sourceKind:'file',sourcePath:'fixture.mp4',materialType:'video',materialPurpose:'b_roll',mimeType:'video/mp4',isMainScript:false,contentBase64:Buffer.from('inert test bytes, not a playable production asset').toString('base64')});
  const probe=vi.spyOn(mediaTools,'inspectMp4Artifact').mockResolvedValue({durationSeconds:5,width:720,height:1280,hasAudio:false,blackFrameCount:0});
  try{await run('bindScriptVideo',{reviewPackageId:review,shotId:'shot-01',materialRevisionId:video.id});}finally{probe.mockRestore();}
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  expect((await c.query('SELECT selected_material_revision_id,clip_segments FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0]).toMatchObject({selected_material_revision_id:video.id,clip_segments:[{start_seconds:0,end_seconds:5}]});
  await run('pauseScriptProduction',{});await c.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);expect((await c.query('SELECT enabled FROM local_identity.script_productions WHERE episode_id=$1',[episode])).rows[0].enabled).toBe(false);
  await expect(automatic(scope,applyBody)).rejects.toThrow('授权已变化');
  await expect(automatic({...scope,owner_id:other},applyBody)).rejects.toThrow('授权已变化');
  expect(wakes).toBeGreaterThan(0);
 }finally{audioProbe.mockRestore();await commands.close();await c.query('SET SESSION AUTHORIZATION DEFAULT').catch(()=>{});await c.query('ROLLBACK').catch(()=>{});c.release();await admin.end();bridge.kill();await rm(mediaRoot,{recursive:true,force:true});}
},30000);
