// @vitest-environment node
// Explicit opt-in: two 4s / 480P reference requests, ¥3 total conservative cap, no retry.
import {it,expect,vi} from 'vitest';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {narrationFixture} from './workspaceNarration.fixture';
import {configuredKeychainStore} from './keychainStore';
import {createWorkspaceGenerationFetcher} from './providerNetwork';
const seam=vi.hoisted(()=>({ports:undefined as any}));
vi.mock('./narrationWorker',async original=>{const actual=await original<typeof import('./narrationWorker')>();return{...actual,narrationPorts:async(...args:Parameters<typeof actual.narrationPorts>)=>seam.ports??actual.narrationPorts(...args)};});
it.skipIf(process.env.LOOP_MINIMAX_VARIANTS_LIVE!=='1')('two new MiniMax models: isolated Owner confirmation → queue → actual Worker → existing live API',async()=>{
 const dir=join(process.cwd(),'docs/verification/minimax-h3-models-20261109'),path=join(dir,'live-results.json');
 let previous:any;try{previous=JSON.parse(await readFile(path,'utf8'));if(previous.results.some((r:any)=>r.status==='submission_started'&&!r.providerTaskId))throw Error('Unknown submission: refuse retry');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const runtime=await import(/* @vite-ignore */pathToFileURL(join(process.cwd(),'scripts/runtime/environment.mjs')).href),keys=await import(/* @vite-ignore */pathToFileURL(join(process.cwd(),'scripts/runtime/keychain.mjs')).href),c=runtime.runtimeContext(),d=runtime.readSettings();
 const row=JSON.parse(c.sql("select jsonb_build_object('secretRef',b.secret_ref,'connectionId',cn.id,'versionId',cn.current_version_id) from public.external_connections cn join local_identity.connection_bindings b on b.version_id=cn.current_version_id where cn.id='d96ed2fa-06ff-4b51-bebe-54a05d9b04cc' and cn.provider='minimax'"));
 const store=configuredKeychainStore(d.connections.keychain,()=>keys.keychainState('unlock')),ledger:any=previous??{capCents:300,reservedCents:0,existingConnectionId:row.connectionId,results:[]},save=()=>writeFile(path,JSON.stringify(ledger,null,2));
 const artifactDir=process.env.LOOP_MINIMAX_VARIANTS_ARTIFACTS!;expect(artifactDir).toBeTruthy();await mkdir(artifactDir,{recursive:true});await save();
 try{for(const model of ['MiniMax-H3-Highspeed','MiniMax-H3-Lite']){
  const existing=ledger.results.find((r:any)=>r.model===model);if(existing?.status==='completed')continue;
  const originalId=existing?.providerTaskId;
  const f=await narrationFixture(undefined,undefined,{provider:'minimax',model});const entry:any={model,resolution:'480P',durationSeconds:4,mode:'references',status:'preparing',events:[]};if(existing){(ledger.replayedResults??=[]).push(existing);ledger.results=ledger.results.filter((r:any)=>r.model!==model);}ledger.results.push(entry);if(originalId){entry.providerTaskId=originalId;entry.recoveryOnly=true;entry.reservationCents=0;}await save();
  try{
   await f.authorize();const imagePath=join(f.root,'live-reference.png');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=gray:s=512x768','-frames:v','1',imagePath]);
   const imported=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'synthetic-reference.png',mimeType:'image/png',contentBase64:(await readFile(imagePath)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(imported.status).toBe(200);
   let id:string|undefined;const start=performance.now();entry.startedAt=new Date().toISOString();
   const fetcher=createWorkspaceGenerationFetcher('minimax',{reserve:async()=>{if(originalId)return;if(ledger.reservedCents+150>300)throw Error('BUDGET_CAP');ledger.reservedCents+=150;entry.reservationCents=150;entry.status='submission_started';await save();},videoTaskId:()=>id},async(url,init={})=>{
    const event:any={operation:init.method==='POST'?'submit':new URL(url).hostname.includes('minimax.')?'poll':'download',at:new Date().toISOString()};entry.events.push(event);await save();
    if(init.method==='POST'){const body=JSON.parse(String(init.body));expect(body).toMatchObject({model,resolution:'480P',duration:4});expect(body.content[1].role).toBe('reference_image');if(model.endsWith('Lite'))expect(body.ratio).toBe('9:16');}
    // A replay feeds the durable original ID into the isolated queue; it never POSTs to MiniMax again.
    if(init.method==='POST'&&originalId){id=originalId;event.operation='local_original_id_replay';await save();return Response.json({task_id:originalId});}
    const response=await fetch(url,init);event.http=response.status;
    if(response.headers.get('content-type')?.includes('json')){const value=await response.clone().json();if(value.task_id){id=value.task_id;entry.providerTaskId=id;}event.status=value.task?.status;event.usage=value.task?.usage;event.error=value.error?.message;}
    await save();return response;
   });
   seam.ports={mode:'controlled',store:{mode:'keychain',get:()=>store.get(row.secretRef)},fetcher};
   const w=await f.read(),queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,prompt:'A red cube appears on a plain gray table, slowly rotating. Static camera. No text.',videoMode:'references',visualInputs:[{role:'referenceImages',materialRevisionId:imported.body.id}],videoResolution:'480P',durationSeconds:4,reservationCents:150});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
   const task=queued.body.visualTasks[0];entry.isolatedTaskId=task.taskId;await save();await f.execute(task.taskId,false);const result=await f.read(),actual=result.visualTasks.find((t:any)=>t.taskId===task.taskId);entry.status=actual.status;entry.error=actual.error;entry.elapsedMs=Math.round(performance.now()-start);
   const candidate=result.visualCandidates.find((v:any)=>v.taskId===task.taskId);if(candidate){const output=join(artifactDir,model+'.mp4');await copyFile(join(f.assetRoot,candidate.relativePath),output);entry.artifact=output;entry.bytes=(await readFile(output)).length;}
   await save();expect(actual.status,actual.error).toBe('completed');
  }finally{seam.ports=undefined;await f.close();}
 }}finally{await save();}
},600000);
