import {saveHistoricalPlanFixture} from './historicalSavedPlan.fixture';
// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {csrfFor} from './sessions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {historicalProductionScriptV2} from '../reviews/productionScript.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {storyBrowser} from './storyBrowser.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['material','artifact'] as const)('explicitly imports the saved plan as current preparation without treating planned references or old authorization as adopted media (%s cover)',async(coverKind)=>{
 const script=historicalProductionScriptV2.replace('填写已上传图片的素材名称','原图').replace('旁白音色：默认','旁白音色：归档音色').replace('生成时长（秒）：默认','生成时长（秒）：2').replace('字幕：开启','字幕：关闭').replace('背景音乐素材：默认','背景音乐素材：配乐').replace('- 转场：cut','- 转场：cut\n- 封面素材：原封面');
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script}),worker=f.workerPool();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const upload=async(name:string,type:string,path:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const image=await upload('原图.png','image',workspaceTestMedia('still-striped.png'),'visual_reference');
  const cover=await upload('原封面.png','image',workspaceTestMedia('still-striped.png'),'cover');const coverSource={version:'workspace-cover-source/v1',kind:'material',id:cover.id,sha256:cover.sha256};
  const music=await upload('配乐.mp3','audio',workspaceTestMedia('controlled-narration-tone.mp3'),'background_music');
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.plan.segments[0].firstFrame.material?.id).toBe(image.id);expect(saved.body.plan.bgm.material?.id).toBe(music.id);
  expect((await f.send('start')).status).toBe(200);
  await f.c.query("UPDATE public.episodes SET tts_voice='今天的默认音色' WHERE id=$1",[f.newEpisode]);
  await f.c.query('UPDATE local_identity.script_productions SET enabled=true,authorized_at=clock_timestamp() WHERE episode_id=$1',[f.newEpisode]);
  const get=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return r.json();};
  const snapshot=await get(),record=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  const imported=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:snapshot.planSha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;
  expect(w.storyboardPackageId).toBeNull();expect(w.preparation).toMatchObject({origin:'saved-plan',authorized:false,planSha256:snapshot.planSha256});
  expect(w.coverInputs).toEqual([expect.objectContaining({source:coverSource,name:'原封面.png'})]);expect(w.deliveries).toHaveLength(0);
  expect(w.narration[0]).toMatchObject({mode:'none',voice:'归档音色',text:saved.body.plan.segments[0].narration,selection:null});
  expect(w.captions[0].contract.enabled).toBe(false);expect(w.readiness.placeholders).toHaveLength(1);
  const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===image.id);expect(candidate).toMatchObject({status:'available',kind:'image'});
  const bgm=w.audio.preparations.find((p:any)=>p.kind==='bgm');expect(bgm).toMatchObject({status:'ready',taskId:null,adoptedItemId:null,source:{provider:'manual',materialRevisionId:music.id}});expect(w.audio.mix.sounds).toHaveLength(0);
  const baseline=(await f.c.query('SELECT origin,manifest,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[w.preparationRevisionId])).rows[0];expect(baseline.origin).toBe('plan-import');expect(baseline.source_evidence.record).toEqual(record);expect(baseline.manifest.shots[0]).toMatchObject({durationSeconds:2,savedSettings:saved.body.plan.segments[0].settings});
  for(const table of ['review_packages','shot_preparation_drafts','approvals','tasks'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n,table).toBe(0);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const ready=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:ready.adoptionId});await send('adoptWorkspaceAudio',{preparationId:bgm.id});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await send('closeWorkspaceStudio');await f.restart();const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  const output=w.exports[0];await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  const coverArtifact=async(episodeId:string,materialId:string)=>{
   const task=randomUUID(),artifact=randomUUID(),file=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[materialId,episodeId])).rows[0];expect(file).toBeTruthy();
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,input_snapshot) VALUES($1,$2,'generate_narration','completed','ffmpeg',$3)",[task,episodeId,{historicalCover:true}]);
   await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'cover',$4,$5,$6)",[artifact,episodeId,task,file.storage_path,file.sha256,file.file_size]);
   return{...coverSource,kind:'artifact',id:artifact,sha256:file.sha256};
  };
  const deliveryCoverSource=coverKind==='artifact'?await coverArtifact(f.newEpisode,cover.id):coverSource;
  if(coverKind==='artifact'){
   const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;expect(w.coverInputs).toContainEqual(expect.objectContaining({source:deliveryCoverSource}));
  }
  const otherCover=await f.request('importMaterial',{episodeId:f.episode,sourceKind:'file',sourcePath:'另一单封面.png',materialType:'image',materialPurpose:'cover',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(otherCover.status).toBe(200);
  const otherCoverSource=coverKind==='artifact'?await coverArtifact(f.episode,otherCover.body.id):{...coverSource,id:otherCover.body.id,sha256:otherCover.body.sha256};
  const delivery={workspaceId:w.id,expectedRevision:w.revision,exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'原保存计划接入后的当前交付',description:'只有明确采用内容进入交付',tags:[],coverSource:deliveryCoverSource};
  for(const [coverData,status] of [
   [{coverSource:{...deliveryCoverSource,sha256:'0'.repeat(64)}},409],
   [{coverSource:{...deliveryCoverSource,id:randomUUID()}},409],
   [{coverSource:otherCoverSource},409],
   [{coverSource:{...deliveryCoverSource,id:'not-a-uuid'}},400],
   [{coverSource:{...deliveryCoverSource,kind:['material']}},400],
   [{coverSource:{...deliveryCoverSource,root:'/untrusted/host/cover'}},400],
   [{coverSource:deliveryCoverSource,coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')},400],
  ] as const){const rejected=await f.send('prepareWorkspaceDelivery',{...delivery,...coverData});expect(rejected.status,JSON.stringify(rejected.body)).toBe(status);}
  expect((await f.request('prepareWorkspaceDelivery',{episodeId:f.newEpisode,...delivery},{token:f.otherToken})).status).toBe(404);
  const coverRecord=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[cover.id])).rows[0],coverPath=join(f.assetRoot,coverRecord.storage_path),originalCover=await readFile(coverPath);
  try{const tampered=Buffer.from(originalCover);tampered[tampered.length-1]^=1;await writeFile(coverPath,tampered);const changed=await f.send('prepareWorkspaceDelivery',delivery);expect(changed.status,JSON.stringify(changed.body)).toBe(409);}finally{await writeFile(coverPath,originalCover);}
  try{await rename(coverPath,coverPath+'.offline');const missing=await f.send('prepareWorkspaceDelivery',delivery);expect(missing.status,JSON.stringify(missing.body)).toBe(409);}finally{await rename(coverPath+'.offline',coverPath);}
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_deliveries WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[cover.id])).rows[0]).toEqual(coverRecord);
  if(process.env.LOOP_STORY_E2E==='1'&&process.env.LOOP_STORY_EVIDENCE){
   browser=await storyBrowser({...f,episode:f.newEpisode},'saved-plan-cover','正式新单');await browser.wait("!!document.querySelector('select')&&Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('已有封面'))");
   await browser.fill('标题',delivery.title);await browser.fill('简介',delivery.description);
   await browser.cli('select','select[name=workspaceCoverSource]',`${deliveryCoverSource.kind}:${deliveryCoverSource.id}:${deliveryCoverSource.sha256}`);expect(browser.traffic.filter(t=>t.command==='prepareWorkspaceDelivery')).toHaveLength(0);
   await browser.click('使用已选封面');await browser.wait("!!document.querySelector('img[alt=交付封面预览]')");expect(await browser.evaluate("document.querySelectorAll('button button').length")).toBe(0);
   await browser.click('放大交付封面预览');await browser.click('关闭放大预览');
   await browser.evaluate("document.querySelector('.workspace-delivery-cover').scrollIntoView({block:'start'})");await browser.capture('desktop-cover');await browser.cli('set','viewport','390','844');await browser.evaluate("document.querySelector('.workspace-delivery-cover').scrollIntoView({block:'start'})");expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow-cover');
   await browser.doubleClick('生成并验证交付包');await browser.cli('wait','--text','交付已排队');
   const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;expect(w.deliveries).toHaveLength(1);
  }else await send('prepareWorkspaceDelivery',delivery);
  const claim=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2}) as any[])[0];expect(claim).toBeTruthy();const delivered=await runWorkspaceDeliveryProcess(f,claim,{mountPath:f.mountPath});expect(delivered.status,JSON.stringify(delivered)).toBe('completed');
  let metadata:any;for(const artifact of delivered.artifacts){const r=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);const bytes=Buffer.from(await r.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);if(artifact.artifactType==='metadata')metadata=JSON.parse(bytes.toString());}
  expect(metadata.coverSource).toEqual(deliveryCoverSource);
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,coverKind+'-cover-receipt.json'),JSON.stringify({coverKind,source:deliveryCoverSource,metadataCoverSource:metadata.coverSource,exactExportSha256:output.artifact.sha256,negativeCases:['wrong_sha','unknown_id','other_episode','invalid_uuid','array_kind','host_root','mixed_bytes_and_source','wrong_owner','same_length_file_tamper','missing_file'],noQueuedDeliveryAfterRejection:true,originalMaterialRecordUnchanged:true,originalPlanSha256:snapshot.planSha256,workerStatus:delivered.status},null,2));
  expect(metadata.narration[0]).toMatchObject({baselineText:saved.body.plan.segments[0].narration,sourceText:null,adoptedText:null,textSource:'not_recorded'});
  expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value).toEqual(record);expect((await get()).planSha256).toBe(snapshot.planSha256);
  expect(JSON.parse(await readFile(join(f.assetRoot,w.exports[0].project.relativePath),'utf8')).timelines[0].items.some((i:any)=>i.kind==='image')).toBe(true);
 }finally{await browser?.close();await worker.end();await f.close();}
},180000);

async function savedPlanFixture(){
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:historicalProductionScriptV2});
 try{
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.send('start')).status).toBe(200);
  const snapshot=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return r.json();};
  return{...f,snapshot};
 }catch(error){await f.close();throw error;}
}

it.skipIf(process.env.LOOP_STORY_E2E!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE||!process.env.LOOP_STORY_EVIDENCE)('browser: chooses the saved plan explicitly and reopens its unadopted inputs without starting generation',async()=>{
 const f=await savedPlanFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const original=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  browser=await storyBrowser({...f,episode:f.newEpisode},'saved-plan-source','正式新单');await browser.cli('open',browser.url+'&step=preparation');await browser.wait("!!document.querySelector('select[name=workspaceSource]')");
  await browser.cli('set','viewport','390','844');await browser.cli('select','select[name=workspaceSource]','saved-plan');
  expect(await browser.evaluate("document.querySelector('select[name=workspaceSource]').labels[0].getBoundingClientRect().height>=12")).toBe(true);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow-choice');
  await browser.click('接入当前制作');await browser.wait("!!document.querySelector('[aria-label=素材镜头列表]')");
  const read=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return r.json();};
  const current=await read();expect(current.sourceOptions).toBeUndefined();expect(current.workspace.preparation).toMatchObject({origin:'saved-plan',authorized:false});expect(current.workspace.readiness.placeholders.length).toBeGreaterThan(0);expect(current.workspace.audio.mix.sounds).toHaveLength(0);
  await browser.cli('reload');await browser.wait("!!document.querySelector('[aria-label=素材镜头列表]')");expect((await read()).workspace.id).toBe(current.workspace.id);await browser.cli('set','viewport','1440','960');await browser.capture('reopened');
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value).toEqual(original);
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['html','json'])('keeps a registered original %s project as a blocked source instead of rebuilding it from the saved plan',async(extension)=>{
 const f=await savedPlanFixture();
 try{
  const snapshot=await f.snapshot(),task=randomUUID(),artifact=randomUUID(),prefix=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0].directory_relative_path;
  const path=prefix+'/original.'+extension,bytes=Buffer.from(extension==='html'?'<html><body>原剪辑，需要核对来源</body></html>':'{"version":3,"assets":[],"timelines":[]}'),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed','{}')",[task,f.newEpisode]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[artifact,f.newEpisode,task,path,sha,bytes.length]);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const read=await response.json();
  const rejected=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:snapshot.planSha256});expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);
  expect(read.sourceOptions.options).toEqual([expect.objectContaining({id:artifact,source:null,unavailableReason:expect.any(String)})]);
  expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect((await f.snapshot()).planSha256).toBe(snapshot.planSha256);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('lists an immutable saved plan with the absent current workspace in one Owner read without preparing or consuming old authorization',async()=>{
 const f=await savedPlanFixture();
 try{
  const saved=await f.snapshot(),before=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  const read=async(token=f.token)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const result=await read();expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.workspace).toBeNull();
  expect(result.body.sourceOptions).toMatchObject({version:'workspace-source-options/v1',scriptRevisionId:f.main,options:[{id:'saved-plan',label:'原保存计划',source:{kind:'saved-plan',expectedPlanSha256:saved.planSha256}}]});
  expect((await read(f.otherToken)).status).toBe(404);expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value).toEqual(before);
  for(const table of ['production_workspaces','workspace_candidate_adoptions'])expect((await f.c.query(`SELECT count(*)::int n FROM local_identity.${table}`)).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('rejects stale identity and other Owners, replays the exact receipt and preserves existing edits and an unknown old request',async()=>{
 const f=await savedPlanFixture();
 try{
  const snapshot=await f.snapshot(),data={expectedScriptRevisionId:f.main,expectedPlanSha256:snapshot.planSha256};
  expect((await f.request('adoptLegacyPlan',{episodeId:f.newEpisode,...data},{token:f.otherToken})).status).toBe(404);
  expect((await f.send('adoptLegacyPlan',{...data,expectedPlanSha256:'0'.repeat(64)})).status).toBe(409);
  expect((await f.send('adoptLegacyPlan',{...data,enabled:true})).status).toBe(400);
  const oldTask=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,input_snapshot,last_result) VALUES($1,$2,'generate_narration','blocked','volcengine_tts',$3,$4)",[oldTask,f.newEpisode,{capability:'narration',frozen:'original unknown request'},{blockers:[{code:'provider_outcome_unknown'}],retry:{shouldRetry:false}}]);
  const old=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[oldTask])).rows[0].value;
  const key=randomUUID(),post=async()=>{const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'adoptLegacyPlan',idempotencyKey:key,data:{episodeId:f.newEpisode,...data}})});return{status:r.status,body:await r.json()};};
  const first=await post();expect(first.status,JSON.stringify(first.body)).toBe(200);expect(await post()).toEqual(first);let w=first.body;
  const edited=await f.send('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'Owner当前编辑必须保留'}});expect(edited.status).toBe(200);w=edited.body;
  const bytes=await readFile(join(f.assetRoot,w.project.relativePath));expect((await f.send('adoptLegacyPlan',data)).status).toBe(409);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(bytes);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[oldTask])).rows[0].value).toEqual(old);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('preserves a native project even when its current SQL workspace registration is missing',async()=>{
 const f=await savedPlanFixture();
 try{
  const snapshot=await f.snapshot(),prefix=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0].directory_relative_path;
  const projectId=`loop-control-${f.newEpisode}`,work=join(f.assetRoot,prefix,'openchatcut-work/current');await mkdir(join(work,'runtime'),{recursive:true});
  const project={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:'original-editor-version'},assets:[],mediaFolders:[],activeTimelineId:projectId,timelines:[{id:projectId,name:'原编辑需要恢复，不能由计划替换',fps:30,width:1080,height:1920,fit:'contain',items:[],tracks:{},trackOrder:[],transitions:[],selectedId:null}]};
  const store=Buffer.from(JSON.stringify({version:1,entries:{projects:[{id:projectId,name:'原剪辑'}],[`project:${projectId}`]:project}})),metadata=Buffer.from(JSON.stringify({projectId,reverseSources:{},inputFingerprint:'original-editor-version'}));
  await writeFile(join(work,'runtime/project-store-v1.json'),store,{flag:'wx'});await writeFile(join(work,'workspace.json'),metadata,{flag:'wx'});
  const r=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:snapshot.planSha256});expect(r.status,JSON.stringify(r.body)).toBe(409);
  expect(await readFile(join(work,'runtime/project-store-v1.json'))).toEqual(store);expect(await readFile(join(work,'workspace.json'))).toEqual(metadata);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['same-account','foreign-account'] as const)('verifies %s original bindings through registered roots and never trusts a saved host root',async(scope)=>{
 const f=await savedPlanFixture();
 try{
  let sourceEpisode=f.episode;
  if(scope==='same-account'){
   const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].account_id;
   const created=await f.request('create',{episodeId:undefined,accountId:account,title:'原计划跨单素材来源'});expect(created.status,JSON.stringify(created.body)).toBe(200);sourceEpisode=created.body.id;
  }
  const uploaded=await f.request('importMaterial',{episodeId:sourceEpisode,sourceKind:'file',sourcePath:'填写已上传图片的素材名称.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(200);
  const m=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[uploaded.body.id])).rows[0],before=await f.snapshot();
  const reference={...before.plan.segments[0].firstFrame,status:'bound',material:{id:m.id,episodeId:m.episode_id,seriesId:null,name:m.source_path,type:m.material_type,purpose:m.material_purpose,mime:m.mime_type,path:m.storage_path,sha256:m.sha256,size:Number(m.file_size),root:'/untrusted/old-plan-root'},candidates:[]};
  await f.c.query("UPDATE local_identity.script_productions SET plan=jsonb_set(plan,'{segments,0,firstFrame}',$2) WHERE episode_id=$1",[f.newEpisode,reference]);const snapshot=await f.snapshot();
  const imported=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:snapshot.planSha256});
  if(scope==='foreign-account'){
   expect(imported.status,JSON.stringify(imported.body)).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);return;
  }
  expect(imported.status,JSON.stringify(imported.body)).toBe(200);const w=imported.body,candidate=w.visualCandidates[0];expect(candidate.materialRevisionId).not.toBe(m.id);
  const copied=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[candidate.materialRevisionId])).rows[0];expect(copied).toMatchObject({episode_id:f.newEpisode,sha256:m.sha256,file_size:m.file_size});
  const provenance=(await f.c.query('SELECT provenance FROM local_identity.material_import_origins WHERE material_id=$1',[copied.id])).rows[0].provenance;expect(provenance).toMatchObject({source:{id:m.id,episode_id:sourceEpisode,sha256:m.sha256},approvals:[expect.objectContaining({approved_by:f.owner})]});
  const prefix=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[sourceEpisode])).rows[0].directory_relative_path;await rename(join(f.assetRoot,prefix),join(f.root,'original-source-offline'));await f.restart();
  const response=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(copied.storage_path)}&sha256=${m.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(workspaceTestMedia('still-striped.png')));
  expect((await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[m.id])).rows[0]).toEqual(m);expect((await f.snapshot()).plan).toEqual(snapshot.plan);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retains a recorded planner origin instead of relabelling an unrelated historical preparation as a saved plan',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  await f.c.query("INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES($1,$2,$3,'planner',$4)",[f.board,f.episode,f.script,f.owner]);
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const stored=(await f.c.query('SELECT origin,source_format,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[prepared.body.preparationRevisionId])).rows[0];expect(stored).toMatchObject({origin:'plan-import',source_format:'storyboard/v1'});expect(stored.source_evidence.version).toBeUndefined();
  expect(prepared.body.preparation.origin).toBe('planner');expect(prepared.body.preparation.planSha256).toBeUndefined();expect(prepared.body.preparation.shots.every((s:any)=>s.origin==='planner')).toBe(true);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect((await response.json()).workspace.preparation.origin).toBe('planner');
  expect((await f.c.query('SELECT source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1',[prepared.body.preparationRevisionId])).rows[0].source_evidence).toEqual(stored.source_evidence);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('rejects unsupported saved binding protocols rather than guessing a current interpretation',async()=>{
 const f=await savedPlanFixture();
 try{
  await f.c.query("UPDATE local_identity.script_productions SET plan=jsonb_set(plan,'{segments,0,firstFrame,status}','\"future-binding\"') WHERE episode_id=$1",[f.newEpisode]);
  const source=await f.snapshot();const r=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:source.planSha256});expect(r.status,JSON.stringify(r.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect((await f.snapshot()).plan).toEqual(source.plan);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('does not trust a source declaration after file bytes change and leaves the saved record intact',async()=>{
 const f=await savedPlanFixture();let file:string|undefined,original:Buffer|undefined;
 try{
  const source=await f.snapshot(),record=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  file=join(f.assetRoot,(await f.c.query('SELECT storage_path FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0].storage_path);original=await readFile(file);await writeFile(file,'changed bytes');
  const r=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:source.planSha256});expect(r.status,JSON.stringify(r.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value).toEqual(record);
 }finally{if(file&&original)await writeFile(file,original);await f.close();}
},120000);
