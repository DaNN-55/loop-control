// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
const exec=promisify(execFile);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner uploads and persists a native still image with duration and composition',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/086-workspace-images.sql']});
 try{
  const path=join(f.root,'input.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=640x360','-frames:v','1',path]);
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'input.png',mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(200);
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status).toBe(200);
  const guarded={workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,materialRevisionId:uploaded.body.id,usage:'still',durationSeconds:1.5,fit:'contain',focusX:0,focusY:0};
  expect((await f.request('matchWorkspaceImage',guarded,{token:f.otherToken})).status).toBe(404);expect((await f.request('matchWorkspaceImage',guarded,{csrf:false})).status).toBe(403);expect((await f.request('matchWorkspaceImage',{...guarded,materialRevisionId:'-'.repeat(36)})).status).toBe(400);expect((await f.request('matchWorkspaceImage',{...guarded,durationSeconds:0})).status).toBe(400);
  const matched=await f.request('matchWorkspaceImage',{workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,materialRevisionId:uploaded.body.id,usage:'still',durationSeconds:1.5,fit:'contain',focusX:0,focusY:0});expect(matched.status,JSON.stringify(matched.body)).toBe(200);
  await f.restart();const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});const w=(await response.json()).workspace;
  expect(w.clips[0].source.kind).toBe('image');expect(w.clips[0].image.usage).toBe('still');
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items[0]).toMatchObject({kind:'image',durationInFrames:45,fit:'contain',sourceContentHash:uploaded.body.sha256});
  expect((await f.c.query('SELECT id FROM public.tasks WHERE episode_id=$1 AND status<>\'completed\'',[f.episode])).rowCount).toBe(0);
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([false,true])('Owner renders static and pan/zoom native images without external generation (landscape=%s)',async landscape=>{
 const f=await productionWorkspaceFixture({landscape,migrations:['db/local/086-workspace-images.sql']});
 try{
  const path=join(f.root,'input.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`testsrc2=size=${landscape?'640x360':'360x640'}`,'-frames:v','1',path]);
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'input.png',mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  for(const [index,usage] of ['still','pan-zoom'].entries()){const result=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[index].id,materialRevisionId:uploaded.body.id,usage,durationSeconds:1,fit:'cover',focusX:0,focusY:0});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;}
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items[1].keyframes.scale).toEqual([{frame:0,value:expect.any(Number),easing:'linear'},{frame:29,value:expect.any(Number),easing:'linear'}]);
  w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:opened.body.productionWorkspace.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:saved.body.productionWorkspace.revision});
  const state={...project.timelines[0],width:landscape?640:360,height:landscape?360:640},spec=join(f.root,'render.json'),output=join(f.root,'native-images.mp4');
  await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state,sources:[{relativePath:w.clips[0].source.relativePath}]}));
  await exec(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:180000,maxBuffer:4*1024*1024});
  const pixels=async(time:string)=>{const out=await exec('ffmpeg',['-v','error','-ss',time,'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:2*1024*1024});return out.stdout;};
  const difference=(a:Buffer,b:Buffer)=>a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0)/a.length;
  const still=difference(await pixels('0.1'),await pixels('0.8')),motion=difference(await pixels('1.1'),await pixels('1.8'));
  expect(still).toBeLessThan(1);expect(motion).toBeGreaterThan(2);
  const evidence=process.env.LOOP_IMAGE_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,landscape?'native-images-landscape.mp4':'native-images-portrait.mp4'),await readFile(output));await writeFile(join(evidence,landscape?'landscape-observation.json':'portrait-observation.json'),JSON.stringify({stillPixelMeanDifference:still,panZoomPixelMeanDifference:motion,width:state.width,height:state.height,sourceSha256:uploaded.body.sha256},null,2));}

 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner sees missing and changed image blockers without a replacement task or source',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/086-workspace-images.sql']});
 try{
  const path=join(f.root,'input.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=360x640','-frames:v','1',path]);
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'input.png',mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  const made=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const payload={workspaceId:made.id,expectedRevision:made.revision,clipId:made.clips[0].id,materialRevisionId:uploaded.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0};
  const source=join(f.assetRoot,uploaded.body.storage_path),original=await readFile(source);await writeFile(source,Buffer.alloc(original.length));
  const changed=await f.request('matchWorkspaceImage',payload);expect(changed.status).toBe(409);expect(changed.body.error).toContain('指纹');
  await writeFile(source,original);const matched=await f.request('matchWorkspaceImage',payload);expect(matched.status).toBe(200);
  await import('node:fs/promises').then(fs=>fs.unlink(source));
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await read.json()).workspace.readiness.missingSources).toEqual([uploaded.body.storage_path]);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:made.id,expectedRevision:matched.body.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(409);
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('AI image generation retains the selected execution path and blocks when no registered connection exists',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/086-workspace-images.sql']});try{
  const selection={capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:randomUUID()};
  const made=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const result=await f.request('generateWorkspaceImage',{selection,workspaceId:made.id,expectedRevision:made.revision,clipId:made.clips[0].id,materialRevisionId:f.material,prompt:'镜头缓慢推进',durationSeconds:4,reservationCents:50});expect(result.status).toBe(409);expect(result.body.error).toContain('图片');
  const path=join(f.root,'first.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=64x64','-frames:v','1',path]);const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  const blocked=await f.request('generateWorkspaceImage',{selection,workspaceId:made.id,expectedRevision:made.revision,clipId:made.clips[0].id,materialRevisionId:uploaded.body.id,prompt:'镜头缓慢推进',durationSeconds:4,reservationCents:50});expect(blocked.status).toBe(409);expect(blocked.body.error).toContain('连接');
  expect((await f.c.query('SELECT id FROM public.tasks WHERE episode_id=$1 AND status<>\'completed\'',[f.episode])).rowCount).toBe(0);

 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([false,true])('Owner first image videos preserve completed outputs and manual edit boundary (edited=%s)',async edited=>{
 let checks=0,wakes=0;
 const f=await productionWorkspaceFixture({migrations:['db/local/086-workspace-images.sql'],runtime:{checkReferences:async()=>{checks++;},mediaReady:async()=>{},wake:()=>{wakes++;}}});const worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  const {randomUUID}=await import('node:crypto'),connection=randomUUID(),version=randomUUID(),secret=randomUUID();
  await f.c.query('BEGIN');
  await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'volcengine','seedance_video','Controlled T04',$2,$3,'https://ark.cn-beijing.volces.com/api/v3')",[connection,f.owner,version]);
  await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'volcengine','seedance_video','https://ark.cn-beijing.volces.com/api/v3',$3)",[version,connection,secret]);
  await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
  await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
  await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
  await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
  await f.c.query("SELECT public.update_current_blueprint(e.account_id,b.policy||$2::jsonb) FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1",[f.episode,JSON.stringify({a_roll:{execution_path:'external',credential_ref:version,executor:{provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128'}}})]);
  await f.c.query('SET SESSION AUTHORIZATION DEFAULT');
  await f.c.query('UPDATE public.episodes e SET blueprint_version_id=a.current_blueprint_version_id FROM public.accounts a WHERE e.id=$1 AND a.id=e.account_id',[f.episode]);
  await f.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Controlled T04',$3)",[f.episode,f.board,f.owner]);
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);await f.c.query('COMMIT');
  const path=join(f.root,'input.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=640x360','-frames:v','1',path]);
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'input.png',mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(uploaded.status).toBe(200);
  expect((await f.request('setWanBudget',{trialCents:200,totalCents:500,full:false})).status).toBe(200);
  const selection={capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:version};
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const authorized=await f.request('authorizeWorkspacePreparation',{workspaceId:w.id,expectedRevision:w.revision,enabled:true});expect(authorized.status,JSON.stringify(authorized.body)).toBe(200);w=authorized.body;
  const requested=await f.request('generateWorkspaceImage',{selection,workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:uploaded.body.id,prompt:'人物缓慢转身',durationSeconds:4,reservationCents:90});expect(requested.status,JSON.stringify(requested.body)).toBe(200);w=requested.body;
  expect(checks).toBe(1);expect(wakes).toBe(1);expect(w.clips[0].image.taskId).toBeTruthy();expect(w.readiness.placeholders).toHaveLength(2);
  const taskId=w.clips[0].image.taskId;
  const second=await f.request('generateWorkspaceImage',{selection,workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,materialRevisionId:uploaded.body.id,prompt:'第二镜缓慢转身',durationSeconds:4,reservationCents:90});expect(second.status,JSON.stringify(second.body)).toBe(200);w=second.body;const secondId=w.clips[1].image.taskId;
  const controlled=join(f.root,'controlled.mp4');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=128x128:rate=24','-t','4','-c:v','libx264','-pix_fmt','yuv420p',controlled]);
  if(edited){
   const saved=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:17}});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
   expect(w.nativeEditRevision).toBe(1);
  }

  const module=join(f.root,'controlled-ports.mjs'),submission=join(f.root,'submissions.txt');
  await writeFile(module,`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-t04-secret'},fetcher:async(input,init={})=>{if(init.method==='POST'){appendFileSync(${JSON.stringify(submission)},'submit\\n');return Response.json({id:'controlled-t04'});}if(new URL(String(input)).hostname==='ark.cn-beijing.volces.com')return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/t04.mp4'}});return new Response(readFileSync(${JSON.stringify(controlled)}),{headers:{'content-type':'video/mp4'}});}};}`);
  const {nativeWorkerPort}=await import('./workerDatabase'),{runCodexWorker}=await import('../worker/codexRunner'),{executeNativeMedia}=await import('./mediaWorker'),{prepareNativeAttemptOutput}=await import('./nativeAttemptOutput');
  const port=nativeWorkerPort(worker);const runTask=async(taskId:string)=>{const claimed=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}))[0] as import('../orchestration/workerDispatch').ClaimedTaskRow;expect(claimed?.provider).toBe('volcengine');
  const fence={p_task_id:claimed.task_id,p_attempt:claimed.attempt,p_lease_token:claimed.lease_token};let staged:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
  const result=await runCodexWorker({actualCostCents:0,claimNextTask:async()=>({taskId:claimed.task_id,taskType:claimed.task_type,attempt:claimed.attempt,budgetLimitCents:claimed.budget_limit_cents,maxAttempts:claimed.max_attempts,provider:claimed.provider,model:claimed.model,promptVersion:claimed.prompt_version,episodeId:claimed.episode_id,accountId:claimed.account_id,blueprintVersionId:claimed.blueprint_version_id,title:claimed.title,allowedAssetRoot:f.assetRoot,inputSnapshot:claimed.input_snapshot} as import('../worker/codexRunner').ClaimedWorkerTask),verifyAssetRoot:async()=>{},verifyArtifacts:async(p,artifacts)=>{if(staged)await staged.verify(artifacts);else await (await import('../worker/mediaLibrary')).verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts});},execute:async p=>{staged=await prepareNativeAttemptOutput(p,fence);return executeNativeMedia(worker,{mode:'controlled',modulePath:module},staged.taskPackage,fence);},reportResult:async(_id,_attempt,result)=>{if(result.status==='completed')await staged!.publish(worker,result);else await port.rpc('report_worker_result',{...fence,p_result:result});}});
  expect(result?.status,JSON.stringify((await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[taskId])).rows)).toBe('completed');};
  await runTask(taskId);await runTask(secondId);expect((await readFile(submission,'utf8')).trim().split('\n')).toHaveLength(2);
  const ledger=(await f.c.query('SELECT request_state,material_revision_id,reserved_cents FROM public.paid_generation_reservations WHERE task_id=$1',[taskId])).rows[0];expect(ledger).toMatchObject({request_state:'succeeded',reserved_cents:90});expect(ledger.material_revision_id).toBeTruthy();
  if(edited){
   const refused=await f.request('fillWorkspaceImageResult',{workspaceId:w.id,expectedRevision:w.revision,taskId});expect(refused.status,JSON.stringify(refused.body)).toBe(409);expect(refused.body.error).toContain('候选');
   const current=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});const read=(await current.json()).workspace;expect(read.project.sha256).toBe(w.project.sha256);expect(read.clips[0].source).toBeNull();
   const doc=JSON.parse(await readFile(join(f.assetRoot,read.project.relativePath),'utf8'));expect(doc.timelines[0].items[0].transform.x).toBe(17);
  }else{
   for(const id of [secondId,taskId]){const filled=await f.request('fillWorkspaceImageResult',{workspaceId:w.id,expectedRevision:w.revision,taskId:id});expect(filled.status,JSON.stringify(filled.body)).toBe(200);w=filled.body;}
   expect(w.clips.map((clip:{source:{kind:string}})=>clip.source.kind)).toEqual(['video','video']);expect(w.readiness.placeholders).toHaveLength(0);
   expect(w.clips[0].image.materialRevisionId).toBe(uploaded.body.id);
   const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);
   const native=JSON.parse(await readFile(join(f.assetRoot,reopened.body.workspace.relativePath),'utf8'));expect(native.timelines[0].items.map((item:{kind:string})=>item.kind)).toEqual(['video','video']);
  }
 }finally{await worker.end();await f.close();}
},180000);
