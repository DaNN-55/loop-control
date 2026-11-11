// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Pool} from 'pg';
import {executeNativeNarration} from './narrationWorker';
import {createWorkerTaskPackage} from '../worker/contracts';

it.each(['legacy-reserve-false','confirmed-route-null','transport-disconnected','received-invalid-body'] as const)('distinguishes actual narration dispatch evidence: %s',async failure=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'narration-receipt-'))),module=join(root,'ports.mjs'),calls=join(root,'outbound.txt');
 try{
  await writeFile(module,`import{appendFileSync}from'node:fs';export function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=>'synthetic-only-key'},fetcher:async()=>{appendFileSync(${JSON.stringify(calls)},'sent\\n');${failure==='transport-disconnected'?"throw Error('controlled transport break');":"return new Response('malformed audio response',{status:200});"}}};}`);
  const queries:string[]=[];
  const pool={query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('input_task_connection'))return{rows:[{provider:'volcengine_tts',adapter:'volcengine_tts',endpoint:'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',version_id:'11111111-1111-4111-8111-111111111111',secret_ref:'synthetic-ref'}]};
   if(sql.includes('reserve_workspace_narration_route'))return{rows:[{route:failure==='confirmed-route-null'?null:'confirmed'}]};
   if(sql.includes('reserve_workspace_narration_submission'))return{rows:[{reserved:false}]};
   if(sql.includes('record_workspace_narration_submission'))throw Object.assign(Error('controlled database receipt write failed'),{code:'ECONNRESET'});
   if(sql.includes('prepare_provider_dispatch'))return{rows:[{decision:failure==='legacy-reserve-false'||failure==='confirmed-route-null'?{phase:'not_sent',reason:'input_changed'}:{phase:'reserved',route:'confirmed'}}]};
   if(sql.includes('mark_provider_dispatching'))return{rows:[{started:true}]};
   throw Error('Unexpected query');
  }} as unknown as Pool;
  const task=createWorkerTaskPackage({task:{id:'task-1',type:'generate_narration',attempt:0,budgetLimitCents:1,maxAttempts:1,provider:'volcengine_tts',model:'seed-tts-2.0',promptVersion:'production-request-v1'},episode:{id:'episode-1',accountId:'account-1',blueprintVersionId:'blueprint-1',title:'Synthetic'},capability:'narration_generation',credentialRef:'11111111-1111-4111-8111-111111111111',allowedTools:['network','write'],allowedAssetRoot:root,output:{requiredArtifactTypes:['narration_audio'],contentType:'audio/mpeg',relativePath:'episodes/episode-1/audio/narration.mp3',reviewStage:'production_ready'},inputArtifacts:[],media:{adapter:'volcengine_tts',narration:{text:'Synthetic narration',voice:{name:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}}}});
  const outcome=await executeNativeNarration(pool,{mode:'controlled',modulePath:module,workspaceSpeechFromConnections:failure!=='legacy-reserve-false'},task,{p_task_id:'task-1',p_attempt:0,p_lease_token:'synthetic-lease'}).then(()=>null,error=>error);
  const dispatched=await readFile(calls,'utf8').catch(()=> '');
  const notSent=failure==='legacy-reserve-false'||failure==='confirmed-route-null';
  expect(outcome.name).toBe(notSent?'ProviderRequestNotSentError':'ProviderOutcomeUnknownError');
  expect(dispatched).toBe(notSent?'':'sent\n');
  // An unvalidated HTTP body is not a durable, usable audio result.
  expect(queries.some(q=>q.includes('record_workspace_narration_submission'))).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
