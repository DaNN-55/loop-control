// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {chmod,mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {Pool} from 'pg';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {ownerTransaction} from './ownerTransaction';
import {startOwnerProductionMetricsSampler} from './productionMetricsSampler';
import {productionScaleCases,productionScaleMedia} from './productionScaleMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {loadavg,freemem,totalmem} from 'node:os';

const renderedHashes=new Set<string>();

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE||process.env.LOOP_C2_SCALE_ACCEPTANCE!=='1').each(productionScaleCases)('preserves exact native edits, sound facts and output at $name scale',async(scale)=>{
 const evidenceRoot=process.env.LOOP_STORY_EVIDENCE;if(!evidenceRoot)throw Error('Scale acceptance requires a private evidence directory');
 const evidence=join(evidenceRoot,scale.name);await mkdir(evidence,{recursive:true});
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5',`镜头时长（秒）：${scale.outputSeconds}`)}),originalPath=process.env.PATH,metrics=new Pool({...f.pool.options,max:1}),worker=f.workerPool();
 let sampler:ReturnType<typeof startOwnerProductionMetricsSampler>|undefined;
 const times:Record<string,number>={},snapshots:Record<string,unknown>={};
 const measured=async<T>(name:string,run:()=>Promise<T>)=>{const start=performance.now();try{return await run();}finally{times[name]=performance.now()-start;}};
 try{
  snapshots.hostBefore={loadavg:loadavg(),freeBytes:freemem(),totalBytes:totalmem(),selfMemory:process.memoryUsage()};
  const inputs=await measured('generateInputs',()=>productionScaleMedia(join(evidence,'inputs'),scale));
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(path:string,materialType:string,mimeType:string,materialPurpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:basename(path),materialType,mimeType,materialPurpose,isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const image=await upload(workspaceTestMedia('still-striped.png'),'image','image/png','visual_reference'),clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.id,usage:'still',durationSeconds:scale.outputSeconds,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const materials:any[]=[];await measured('ownerImports',async()=>{for(const input of inputs){const material=await upload(input.path,'audio','audio/wav','sound_effect');expect(material.sha256).toBe(input.sha256);expect(Number(material.file_size)).toBe(input.fileSize);materials.push(material);}});
  for(const material of materials){await send('prepareWorkspaceAudio',{kind:'sfx',materialRevisionId:material.id,description:'受控剪辑规模',durationSeconds:1,anchor:'absolute',offsetSeconds:0});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});}
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  const save=async(name:string)=>measured(name,async()=>{w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;return w;});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{
   const root=doc.timelines[0],sound=root.items.find((i:any)=>i.kind==='audio');expect(sound).toBeTruthy();root.items=root.items.filter((i:any)=>i.kind!=='audio');
   for(let n=0;n<scale.sources;n++){
    const material=materials[n],child=structuredClone(root),runtimeSource=doc.assets.find((a:any)=>a.id==='material-'+material.id)?.src;expect(runtimeSource).toBeTruthy();child.id=`scale-child-${n}`;child.items=[];
    for(let alias=0;alias<2;alias++){const id=alias===0?'material-'+material.id:'scale-alias-'+material.id;if(!doc.assets.some((a:any)=>a.id===id))doc.assets.push({id,name:'受控来源',kind:'audio',src:runtimeSource,durationInFrames:scale.sourceSeconds*30});}
    for(let cut=0;cut<scale.cutsPerSource;cut++){
     const item={...structuredClone(sound),id:`scale-sound-${n}-${cut}`,startFrame:cut*scale.outputSeconds*30/scale.cutsPerSource,durationInFrames:scale.outputSeconds*30/scale.cutsPerSource,srcInFrame:cut*30,src:runtimeSource,sourceAssetId:cut%2===0?'material-'+material.id:'scale-alias-'+material.id,sourceContentHash:material.sha256,volume:.03,fadeInFrames:3,fadeOutFrames:3,keyframes:{volume:[{frame:0,value:.03},{frame:12,value:.04}]}};
     delete item.loopControlAudio;child.items.push(item);
    }
    // Native sequence layers are rendered on video tracks; descendants retain audio tracks.
    doc.timelines.push(child);root.items.push({id:`scale-sequence-${n}`,name:'声音剪辑',kind:'sequence',track:root.items[0].track,timelineId:child.id,startFrame:0,durationInFrames:scale.outputSeconds*30,srcInFrame:0});
   }
  });await save('initialNativeSave');
  const bin=join(f.root,'scale-probe-bin'),log=join(evidence,'ffprobe-argv.jsonl'),real=execFileSync('which',['ffprobe'],{encoding:'utf8'}).trim(),quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";await mkdir(bin);await writeFile(log,'');
  const script=join(bin,'probe.mjs');await writeFile(script,`import{appendFileSync}from'node:fs';import{spawn}from'node:child_process';const args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify({args})+'\\n');const child=spawn(${JSON.stringify(real)},args,{stdio:'inherit'});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));process.exitCode=await new Promise(r=>child.once('close',code=>r(code??1)));`);await writeFile(join(bin,'ffprobe'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(script)+' "$@"\n');await chmod(join(bin,'ffprobe'),0o700);process.env.PATH=bin+':'+originalPath;
  const probes=async()=>{const calls=(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return{all:calls.length,observation:calls.filter(call=>call.args.includes('stream=start_time,duration:format=start_time,duration,nb_streams')).length};};
  const gain=(value:number)=>editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{for(const child of doc.timelines.filter((t:any)=>t.id.startsWith('scale-child-')))for(const item of child.items){item.volume=value;item.keyframes.volume[0].value=value;item.keyframes.volume[1].value=value+.01;}});
  await gain(.04);await save('disabledChangedSave');snapshots.disabledProbes=await probes();expect(await probes()).toMatchObject({observation:0});
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));await gain(.05);await save('enabledChangedSave');snapshots.changedProbes=await probes();
  const soundEvents=async()=>(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%' ORDER BY id",[f.newEpisode])).rows;
  const sound=await soundEvents();expect(sound).toHaveLength(scale.sources*scale.cutsPerSource);expect(sound.every(e=>e.event_type==='sound_changed')).toBe(true);expect(new Set(sound.map(e=>e.payload.instance_sha256)).size).toBe(sound.length);expect(new Set(sound.map(e=>e.payload.source_id)).size).toBe(scale.sources);
  await save('unchangedSave');snapshots.unchangedProbes=await probes();expect(await probes()).toEqual(snapshots.changedProbes);expect(await soundEvents()).toEqual(sound);
  const project=await readFile(join(f.assetRoot,w.project.relativePath));expect(createHash('sha256').update(project).digest('hex')).toBe(w.project.sha256);snapshots.savedProjectSha256=w.project.sha256;await writeFile(join(evidence,'saved-project.json'),project);
  await send('closeWorkspaceStudio');
  const pending=measured('actualExport',()=>send('exportWorkspace'));let sawExport=false;for(let n=0;n<1000;n++){if(f.activeLocalExports(f.owner)>0){sawExport=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  snapshots.sawActiveExport=sawExport;if(sawExport){sampler=startOwnerProductionMetricsSampler({pool:metrics,ownerId:f.owner,enabled:true,localExports:f.activeLocalExports});await sampler.wake();}await pending;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect(f.activeLocalExports(f.owner)).toBe(0);snapshots.samplerStatus=sampler?.status()??null;await sampler?.stop();sampler=undefined;
  const artifact=w.exports[0].artifact,download=await fetch(f.origin+'/_local-artifact?episode='+f.newEpisode+'&path='+encodeURIComponent(artifact.relativePath)+'&sha256='+artifact.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);const bytes=Buffer.from(await download.arrayBuffer());expect(bytes.length).toBe(artifact.fileSize);expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  expect(renderedHashes.has(artifact.sha256),'Different sound mixtures must not produce identical output bytes').toBe(false);renderedHashes.add(artifact.sha256);
  const outputPath=join(evidence,'final.mp4');await writeFile(outputPath,bytes);const decoded=await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',outputPath,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:4*1024*1024,timeout:30000}),samples=new Float32Array(decoded.stdout.buffer,decoded.stdout.byteOffset,decoded.stdout.byteLength/4);
  const amplitudes=inputs.map(input=>{let re=0,im=0;const first=24000,last=48000;for(let i=first;i<last;i++){re+=samples[i]*Math.cos(2*Math.PI*input.frequency*i/48000);im+=samples[i]*Math.sin(2*Math.PI*input.frequency*i/48000);}return{frequency:input.frequency,amplitude:2*Math.hypot(re,im)/(last-first)};});snapshots.outputAudio={sampleCount:samples.length,amplitudes};expect(samples.length).toBeGreaterThanOrEqual(48000*scale.outputSeconds);for(const tone of amplitudes)expect(tone.amplitude,JSON.stringify(tone)).toBeGreaterThan(.001);
  snapshots.exportArtifact={sha256:artifact.sha256,fileSize:artifact.fileSize};snapshots.soundEvents=sound;snapshots.exportEvents=(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'local_export_%' ORDER BY id",[f.newEpisode])).rows;expect((snapshots.exportEvents as any[]).map(e=>e.event_type)).toEqual(['local_export_started','local_export_finished']);
  snapshots.resourceRows=(await f.c.query('SELECT * FROM local_identity.production_metric_resources WHERE owner_id=$1 ORDER BY sampled_at',[f.owner])).rows;snapshots.exportResourceRows=(await f.c.query('SELECT * FROM local_identity.production_metric_export_resources WHERE owner_id=$1 ORDER BY sampled_at',[f.owner])).rows;
  if(sawExport){expect((snapshots.samplerStatus as any).lastError).toBeNull();expect((snapshots.resourceRows as any[]).length).toBeGreaterThan(0);expect((snapshots.exportResourceRows as any[]).some(sample=>sample.active_exports===1)).toBe(true);}expect((snapshots.resourceRows as any[]).every(sample=>sample.gpu_percent===null)).toBe(true);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:artifact.sha256,expectedContentSha256:w.contentSha256});await send('prepareWorkspaceDelivery',{exportId:w.exports[0].id,expectedExportSha256:artifact.sha256,expectedContentSha256:w.contentSha256,title:'规模受控交付',description:'真实保存与确切导出',tags:['controlled'],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const delivery=w.deliveries[0],task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:delivery.taskId,p_worker_capacity:2}) as any[])[0];expect(task.task_id).toBe(delivery.taskId);const delivered=await measured('workerDelivery',()=>runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath}));expect(delivered.status,JSON.stringify(delivered)).toBe('completed');snapshots.delivery={taskId:delivery.taskId,status:delivered.status};
  await f.restart();expect(await soundEvents()).toEqual(sound);const reloaded=await fetch(f.origin+'/api/local/episodes/'+f.newEpisode+'/workspace',{headers:{Cookie:'loop_owner_session='+f.token}});expect(reloaded.status).toBe(200);expect((await reloaded.json()).workspace.deliveries[0].verified).toBe(true);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);snapshots.hostAfter={loadavg:loadavg(),freeBytes:freemem(),totalBytes:totalmem(),selfMemory:process.memoryUsage()};
  snapshots.inputs=inputs.map(({path,...input})=>input);snapshots.finalProbes=await probes();snapshots.scale=scale;snapshots.sourceBytes=inputs.reduce((sum,input)=>sum+input.fileSize,0);snapshots.outcome='passed';
 }finally{
  await sampler?.stop();process.env.PATH=originalPath;await worker.end();await metrics.end();await f.close();await writeFile(join(evidence,'observation.json'),JSON.stringify({times,snapshots,measurement:'single sequential observation; warm/cold cache unknown; host resources include other processes; no capacity or SLA claim'},null,2));
 }
},300000);
