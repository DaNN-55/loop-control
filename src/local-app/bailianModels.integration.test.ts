// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {csrfFor} from './sessions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultWanModelSettings} from '../wanVideoModels';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('persists only compatible Bailian directory IDs for enabling, reopens them and preserves enabled choices on rotation',async()=>{
 const f=await connectionCatalogFixture({modelsReader:async()=>[{id:'wan2.6-i2v-flash',capability:'视频'},{id:'wan2.2-i2v-plus',capability:'视频'},{id:'wan2.7-i2v',capability:'视频'},{id:'wan2.6-t2v',capability:'视频'}]});
 try{
  const connection=(await f.command('create',{name:'Ba directory',provider:'bailian',adapter:'wan_video',secret:'synthetic-bailian-key'})).body.connection;
  const read=async()=>{const r=await fetch(f.origin+'/api/local/connection-models?connectionId='+connection.id,{headers:{Cookie:'loop_owner_session='+f.token}});return r.json();};
  const post=async(command:string,data:unknown)=>{const r=await fetch(f.origin+'/api/local/connection-models',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
  expect((await read()).models.map((m:any)=>m.id)).toEqual(['wan2.6-i2v-flash']);
  expect((await post('save',{connectionId:connection.id,versionId:connection.current_version_id,revision:'default',enabledModels:['wan2.2-i2v-plus']})).status).toBe(400);
  const result=await post('sync',{connectionId:connection.id,versionId:connection.current_version_id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.models.find((m:any)=>m.id==='wan2.2-i2v-plus')).toMatchObject({adapted:true,listed:true});expect(result.body.models.find((m:any)=>m.id==='wan2.7-i2v')).toMatchObject({adapted:false,reason:expect.stringContaining('media')});
  const reopened=await read();expect(reopened.models.map((m:any)=>m.id)).toEqual(['wan2.6-i2v-flash','wan2.2-i2v-plus']);expect(reopened.enabledModels).toEqual(['wan2.6-i2v-flash']);
  const saved=await post('save',{connectionId:connection.id,versionId:connection.current_version_id,revision:reopened.revision,enabledModels:['wan2.2-i2v-plus']});expect(saved.status).toBe(200);
  expect((await f.request()).body.serviceCatalog.groups.flatMap((g:any)=>g.services).find((s:any)=>s.connectionId===connection.id).models).toEqual(['wan2.2-i2v-plus']);
  await f.command('rotate',{connectionId:connection.id,provider:'bailian',adapter:'wan_video',secret:'synthetic-bailian-key'});expect((await read()).enabledModels).toEqual(['wan2.2-i2v-plus']);expect((await read()).models.find((m:any)=>m.id==='wan2.2-i2v-plus').listed).toBe(false);
  expect(JSON.stringify(result.body)).not.toContain('synthetic-bailian-key');
 }finally{await f.close();}
},60000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('queues and executes the chosen Bailian model with its own reservation and frozen snapshot after disabling it',async()=>{
 const migrations=['127-connection-model-settings','128-connection-model-discovery','129-bailian-video-models'].map(name=>'db/local/'+name+'.sql');
 const f=await narrationFixture(undefined,undefined,true,false,{migrations});
 try{
  await f.authorize();
  const version=randomUUID(),connection=randomUUID(),secret=randomUUID(),model='wan2.2-i2v-plus';
  await f.c.query('BEGIN');
  await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'bailian','wan_video','Controlled Ba',$2,$3,'https://dashscope.aliyuncs.com')",[connection,f.owner,version]);
  await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'bailian','wan_video','https://dashscope.aliyuncs.com',$3)",[version,connection,secret]);
  await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
  await f.c.query('INSERT INTO local_identity.connection_model_settings(connection_id,owner_id,enabled_models,revision,discovered_models,discovery_version_id) VALUES($1,$2,$3,$4,$3,$5)',[connection,f.owner,[model],randomUUID(),version]);
  await f.c.query('COMMIT');
  const first=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(first.status).toBe(200);
  const w=await f.read(),args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'bailian',adapter:'wan_video',model,connectionVersionId:version},firstFrameMaterialRevisionId:first.body.id,prompt:'按所选模型生成',durationSeconds:5,reservationCents:1,videoSettings:defaultWanModelSettings(model),firstFrameFit:'contain'};
  expect((await f.request('requestWorkspaceVisualCandidate',{...args,videoSettings:{...args.videoSettings,resolution:'720P'}})).status).toBe(400);
  const queued=await f.request('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0].taskId;
  const frozen=(await f.c.query('SELECT model,input_snapshot,budget_limit_cents FROM public.tasks WHERE id=$1',[task])).rows[0];expect(frozen.model).toBe(model);expect(frozen.budget_limit_cents).toBe(1);expect(frozen.input_snapshot.executor.model).toBe(model);
  await f.c.query('UPDATE local_identity.connection_model_settings SET enabled_models=$2 WHERE connection_id=$1',[connection,[]]);
  const video=join(f.root,'controlled-five-seconds.mp4');await promisify(execFile)('ffmpeg',['-v','error','-stream_loop','-1','-i',workspaceTestMedia('landscape-red-blue.mp4'),'-t','5','-an','-c:v','libx264','-pix_fmt','yuv420p',video]);
  await writeFile(join(f.root,'controlled-video.mjs'),`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-ba-secret'},fetcher:async(input,init={})=>{if(init.method==='POST'){appendFileSync(${JSON.stringify(f.videoSubmissions)},init.body+'\\n');return Response.json({output:{task_id:'ba-chosen'}});}if(String(input).includes('/api/v1/tasks/'))return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/video.mp4'}});return new Response(readFileSync(${JSON.stringify(video)}),{headers:{'content-type':'video/mp4'}});}};}`);
  const execution=await f.execute(task);expect(execution?.status).toBe('completed');
  const sent=JSON.parse((await readFile(f.videoSubmissions,'utf8')).trim());expect(sent.model).toBe(model);expect(sent.parameters).toMatchObject({resolution:'1080P'});expect(sent.parameters.audio).toBeUndefined();expect(sent.parameters.duration).toBeUndefined();
  expect((await f.c.query('SELECT reserved_cents FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0].reserved_cents).toBe(1);expect((await f.read()).visualCandidates.some((c:any)=>c.taskId===task&&c.status==='available')).toBe(true);
  const after=(await f.c.query("SELECT input_snapshot-'runtime_constraints' snapshot FROM public.tasks WHERE id=$1",[task])).rows[0].snapshot;delete frozen.input_snapshot.runtime_constraints;expect(after).toEqual(frozen.input_snapshot);
 }finally{await f.close();}
},120000);
