// Real prepared Worker child, isolated PostgreSQL/volume; controlled Provider transport.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from '../../../src/local-app/workspaceNarration.fixture';
import {workspaceAudioVolume} from '../../../src/local-app/workspaceAudioVolume.fixture';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
import {nativeWorkerPort} from '../../../src/local-app/workerDatabase';
import {runWorkspaceDeliveryProcess} from '../../../src/local-app/workspaceDelivery.fixture';
const volume=await workspaceAudioVolume();let f:Awaited<ReturnType<typeof narrationFixture>>|undefined;
try{
 f=await narrationFixture(undefined,undefined,true,false,{voice:workspaceTestMedia('controlled-narration-tone.mp3'),video:workspaceTestMedia('landscape-red-blue.mp4'),testRootParent:volume.mountPath});await f.authorize();assert.equal((await f.request('setWanBudget',{trialCents:300,totalCents:1000,full:false})).status,200);let w=f.made;
 const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'cli-first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});assert.equal(image.status,200);
 const requested=await f.request('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'Prepared CLI controlled visual',durationSeconds:4,reservationCents:90});assert.equal(requested.status,200,JSON.stringify(requested.body));w=requested.body;const id=w.visualTasks[0].taskId,worker=f.workerPool();try{
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1}) as any[])[0];assert.ok(task);const result=await runWorkspaceDeliveryProcess(f,task,{media:{mode:'controlled',modulePath:join(f.root,'controlled-video.mjs')},mountPath:volume.mountPath,visualCommand:[process.execPath,'--version']});assert.equal(result.status,'completed',JSON.stringify(result));
 const current=await f.read();assert.equal(current.project.sha256,f.made.project.sha256);assert.equal(current.visualCandidates[0].status,'available');const posts=(await readFile(f.videoSubmissions,'utf8')).trim().split('\n').map(v=>JSON.parse(v));assert.equal(posts.length,1);assert.equal(posts[0].duration,4);
 const evidence={result,submissionCount:posts.length,submittedDuration:posts[0].duration,task:(await f.c.query('SELECT id,task_type,status,input_snapshot,last_result FROM public.tasks WHERE id=$1',[id])).rows[0],runs:(await f.c.query('SELECT * FROM public.task_runs WHERE task_id=$1',[id])).rows,candidate:current.visualCandidates[0],unchangedProjectSha256:current.project.sha256};await mkdir('docs/verification/issue-161-workspace-visuals/evidence',{recursive:true});await writeFile('docs/verification/issue-161-workspace-visuals/evidence/worker-cli.json',JSON.stringify(evidence,(key,value)=>key.includes('lease_token')?'[isolated lease omitted]':value,2));console.log(JSON.stringify({passed:true,taskId:id,submissions:posts.length,status:result.status}));
 }finally{await worker.end();}
}finally{try{await f?.close();}finally{await volume.close();}}
