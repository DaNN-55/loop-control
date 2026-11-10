import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runtimeContext,readSettings} from '../../../scripts/runtime/environment.mjs';
import {keychainState} from '../../../scripts/runtime/keychain.mjs';
import {configuredKeychainStore} from '../../../dist/local-app/local-app/keychainStore.js';
import {generateWanVideo} from '../../../dist/local-app/worker/wanVideoProvider.js';
import {defaultWanModelSettings,wanVideoModels} from '../../../dist/local-app/wanVideoModels.js';
import {createWorkspaceGenerationFetcher} from '../../../dist/local-app/local-app/providerNetwork.js';
if(process.env.LOOP_MODEL_MATRIX_FINISH!=='1')throw Error('Explicit live opt-in required');
const path=new URL('./live-results.json',import.meta.url),ledger=JSON.parse(await readFile(path,'utf8'));
if(!ledger.results.some(r=>r.status==='completed_existing_user_task')||ledger.results.some(r=>r.status==='preparing'))throw Error('Original runner must finish first');
const c=runtimeContext(),d=readSettings(),store=configuredKeychainStore(d.connections.keychain,()=>keychainState('unlock'));
const ref=c.sql("select b.secret_ref from local_identity.connection_bindings b join public.external_connections cn on cn.current_version_id=b.version_id join local_identity.input_episodes i on i.owner_id=cn.created_by where i.episode_id='a5c27db4-3c4c-434d-b43a-402e13016fbe' and cn.provider='bailian'");
const credential=await store.get(ref),save=()=>writeFile(path,JSON.stringify(ledger,null,2));
// Unactivated-model 404 responses contain no task ID and did not create generation jobs.
ledger.nonBillableRejectionCents=ledger.results.filter(r=>r.provider==='volcengine'&&r.definiteRejection&&!r.providerTaskId).reduce((sum,r)=>sum+r.reservedCents,0);
const sourceImage=new Uint8Array(await readFile('src/local-app/fixtures/workspace-media/still-striped.png'));
for(const row of ledger.results.filter(r=>['wan2.2-i2v-flash','wan2.2-i2v-plus','wanx2.1-i2v-plus'].includes(r.model))){
 if(row.status==='completed')continue;
 if(row.status==='submission_unknown'&&!row.providerTaskId)throw Error('Unknown submission: never submit again');
 const resume=!!row.providerTaskId,start=performance.now();if(row.recovery)(row.recoveryAttempts??=[]).push(row.recovery);row.recovery={startedAt:new Date().toISOString(),mode:resume?'query_and_download_original':'first_submission_after_budget_reconciliation',events:[]};await save();
 let id=row.providerTaskId;
 const reserve=async()=>{
  if(resume)throw Error('Recovery may never submit a new request');
  if(ledger.reservedCents+row.ceiling-ledger.nonBillableRejectionCents>3000)throw Error('BUDGET_CAP');
  ledger.reservedCents+=row.ceiling;row.reservedCents=row.ceiling;ledger.budgetCommittedCents=ledger.reservedCents-ledger.nonBillableRejectionCents;await save();
 };
 const fetcher=createWorkspaceGenerationFetcher('bailian',{reserve,videoTaskId:()=>id},async(url,init={})=>{
  if(resume&&init.method==='POST')throw Error('Recovery POST prohibited');
  const event={operation:init.method==='POST'?'submit':'read',at:new Date().toISOString()};row.recovery.events.push(event);await save();
  if(init.method==='POST'){row.recovery.submitted=true;await save();}
  const response=await fetch(url,init);event.http=response.status;
  if(response.headers.get('content-type')?.includes('json')){const v=await response.clone().json();event.taskStatus=v.output?.task_status;event.usage=v.usage;event.supplierError=v.output?.message??v.message;event.resultHost=v.output?.video_url?new URL(v.output.video_url).hostname:undefined;}
  await save();return response;
 });
 try{
  const bytes=await generateWanVideo({model:row.model,settings:defaultWanModelSettings(row.model),credentials:credential,image:sourceImage,imageMime:'image/png',prompt:'A small red toy cube on a plain gray table. The camera stays still. The cube slowly rotates. No text.',durationSeconds:wanVideoModels[row.model].durations[0],fetcher,reserve:async()=>resume?{new:false,provider_task_id:id}:{new:true},recordSubmission:async value=>{id=value;row.providerTaskId=value;await save();},maxPolls:120});
  const file=join(process.env.LOOP_MODEL_MATRIX_ARTIFACTS,row.model+'.mp4');await writeFile(file,bytes);row.status='completed';row.artifact=file;row.bytes=bytes.length;row.recovery.endedAt=new Date().toISOString();row.recovery.durationMs=Math.round(performance.now()-start);
 }catch(error){row.recovery.error=error.message;row.status=id?'accepted_result_pending':row.recovery.submitted?'submission_unknown':'not_sent';}
 await save();console.log(JSON.stringify({model:row.model,status:row.status,recovery:row.recovery.mode,error:row.recovery.error}));
}
