// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;
const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');

it.skipIf(!contextPath)('freezes objective retry attribution at the real SQL request boundary without inventing rework or comparing image authorization hashes',async()=>{
 const {runtimeContext}=await import(contextPath!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an explicitly isolated metrics fixture');
 const f=await productionWorkspaceFixture({testContextModule:contextPath});
 try{
  const unconfirmed=await f.request('prepareWorkspace',{expectedScriptRevisionId:f.script});expect(unconfirmed.status,JSON.stringify(unconfirmed.body)).toBe(403);
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body,clip=w.clips[0];
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const result={blockers:[{code:'provider_result_unknown',detail:'SENSITIVE_DETAIL_NEVER_COPY'}],preflight:{checks:[{check:'provider_result_unknown'}]},retry:{reason:'SENSITIVE_REASON_NEVER_COPY'}};
  async function task(status:string,lastResult:unknown=null){const id=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,input_snapshot,last_result) VALUES($1,$2,'generate_narration',$3,'volcengine_tts','seed-tts-2.0',$5,$4)",[id,f.episode,status,lastResult,{output:{relative_path:`episodes/${f.episode}/audio/retry-${id}.mp3`}}]);return id;}
  async function confirmation(command:string,retryOf?:string){
   const id=randomUUID(),authorization=hash(id);
   await f.c.query("INSERT INTO local_identity.workspace_call_confirmations(id,owner_id,workspace_id,episode_id,script_revision_id,project_sha256,workspace_revision,command,payload,context_hash,authorization_hash,summary,consumed_at,consumed_transaction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp(),txid_current())",[id,f.owner,w.id,f.episode,f.script,w.project.sha256,w.revision,command,retryOf?{retryOfTaskId:retryOf}:{},hash('context'),authorization,{estimate:{version:'isolated-rate/v1',estimatedCents:1,pricing:{currency:'CNY',sourceCurrency:'CNY',conversionRate:1,rateVersion:'isolated-rate/v1',rateSource:'local_assumption',units:{perCharacter:1}}}}]);
   return authorization;
  }
  const events=async(taskId:string)=>(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE event_type='retry_relation' AND payload->>'task_id'=$1",[taskId])).rows.map(row=>row.payload);
  async function speech(status:string,oldFingerprint:string,newFingerprint:string,withRelation=true,oldResult:unknown=result){
   const old=await task(status,oldResult),fresh=await task('ready');
   const insert=async(id:string,fingerprint:string,authorization:string,snapshot:Record<string,unknown>)=>f.c.query('INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(task_id) DO NOTHING',[id,w.id,f.episode,clip.id,clip.shotId,fingerprint,authorization,snapshot]);
   await insert(old,oldFingerprint,hash(old),{selectionVersion:1,inputFingerprint:oldFingerprint});
   const auth=await confirmation('generateWorkspaceNarration',withRelation?old:undefined),snapshot={selectionVersion:1,inputFingerprint:newFingerprint,...(withRelation?{retryOfTaskId:old}:{}),authorizationHash:auth};
   await insert(fresh,newFingerprint,auth,snapshot);
   return{old,fresh,replay:()=>insert(fresh,newFingerprint,auth,snapshot)};
  }
  const same=await speech('failed',hash('same speech input'),hash('same speech input'));
  const sameEvent=(await events(same.fresh))[0];
  expect(sameEvent).toMatchObject({reason_code:'previous_task_failed',previous_status:'failed',previous_blocker_code:'provider_result_unknown',prior_provider_result_unknown_marked:true,input_changed:false,input_comparison:'narration_input_fingerprint',input_comparison_unavailable_reason:null});
  await same.replay();expect(await events(same.fresh)).toEqual([sameEvent]);
  await f.c.query("UPDATE public.tasks SET status='blocked',last_result=$2 WHERE id=$1",[same.old,{blockers:[{code:'new_failure_code',detail:'SENSITIVE_LATER_DETAIL'}]}]);
  expect(await events(same.fresh)).toEqual([sameEvent]);
  const changed=await speech('blocked',hash('old speech input'),hash('new speech input'));
  expect((await events(changed.fresh))[0]).toMatchObject({reason_code:'previous_task_blocked',previous_status:'blocked',input_changed:true,input_comparison:'narration_input_fingerprint'});
  const noRelation=await speech('failed',hash('same shot'),hash('same shot'),false);
  expect(await events(noRelation.fresh)).toEqual([]);
  const missing=await speech('failed','legacy-fingerprint',hash('current'),true,{blockers:[{code:'SENSITIVE detail is not a machine code'}]});
  expect((await events(missing.fresh))[0]).toMatchObject({previous_blocker_code:null,prior_provider_result_unknown_marked:false,input_changed:null,input_comparison:'unavailable',input_comparison_unavailable_reason:'missing_or_unmatched_narration_fingerprint'});

  // Seed legitimate image request/task rows through their actual constraints.
  // No Worker or Provider is called: this isolates the collection trigger.
  async function image(retryOf?:string){
   const id=randomUUID(),taskId=randomUUID(),authorization=retryOf?await confirmation('requestWorkspaceImageCandidates',retryOf):hash(id),execution={executor:{provider:'openai',adapter:'openai_images',model:'gpt-image-2'}};
   const snapshot={kind:'image',execution,prompt:'Same isolated prompt',imageSettings:{size:'1024x1024',quality:'low',count:1},authorizationHash:authorization,...(retryOf?{retryOfTaskId:retryOf}:{})},fingerprint=hash({expected:{},snapshot});
   await f.c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,w.id,f.episode,clip.id,clip.shotId,clip.itemId,fingerprint,{},snapshot]);
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,input_snapshot) VALUES($1,$2,'generate_static_visual','ready','openai','gpt-image-2',$3)",[taskId,f.episode,{capability:'static_visual_generation',workspace_image_request_id:id,executor:execution.executor,output:{relative_path:`episodes/${f.episode}/images/isolated-image.png`}}]);
   await f.c.query('UPDATE local_identity.workspace_visual_candidates SET task_id=$2 WHERE id=$1',[id,taskId]);
   return{id,taskId,fingerprint};
  }
  const oldImage=await image();await f.c.query("UPDATE public.tasks SET status='blocked',last_result=$2 WHERE id=$1",[oldImage.taskId,result]);
  const newImage=await image(oldImage.taskId);expect(newImage.fingerprint).not.toBe(oldImage.fingerprint);
  const imageEvent=(await events(newImage.taskId))[0];expect(imageEvent).toMatchObject({reason_code:'previous_task_blocked',input_changed:null,input_comparison:'unavailable',input_comparison_unavailable_reason:'visual_authorization_fingerprint'});
  await f.c.query("UPDATE public.tasks SET last_result=$2 WHERE id=$1",[oldImage.taskId,{blockers:[{code:'later_image_failure'}]}]);
  await f.c.query('UPDATE local_identity.workspace_visual_candidates SET task_id=task_id WHERE id=$1',[newImage.id]);
  expect(await events(newImage.taskId)).toEqual([imageEvent]);
  const payloads=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE event_type='retry_relation'")).rows;
  expect(JSON.stringify(payloads)).not.toMatch(/SENSITIVE_|Same isolated prompt|authorizationHash/);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE event_type='rework' OR payload ? 'rework_reason'")).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
