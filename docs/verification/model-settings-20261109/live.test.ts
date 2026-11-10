// @vitest-environment node
// Explicit opt-in only. Existing Keychain connection, synthetic inputs, one POST per model, no retry.
import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {runtimeContext,readSettings} from '../../../scripts/runtime/environment.mjs';
import {keychainState} from '../../../scripts/runtime/keychain.mjs';
import {configuredKeychainStore} from '../../../src/local-app/keychainStore';
import {createWorkspaceGenerationFetcher,createWorkspaceSearchFetcher} from '../../../src/local-app/providerNetwork';
import {generateOpenAiImages,searchFreesoundPreview,searchPexelsVideo} from '../../../src/worker/mediaProviders';
import {generateOfficialVideo} from '../../../src/worker/officialVideoProvider';
import {generateWanVideo} from '../../../src/worker/wanVideoProvider';
import {openAiImageModels} from '../../../src/imageGeneration';
import {wanVideoModels,defaultWanModelSettings} from '../../../src/wanVideoModels';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
const enabled=process.env.LOOP_MODEL_MATRIX_LIVE==='1';
it.skipIf(!enabled)('minimum real call for each registered model, capped at 3000 reserved cents',async()=>{
 const context=runtimeContext(),deployment=readSettings(),store=configuredKeychainStore(deployment.connections.keychain,()=>keychainState('unlock'));
 const rows=JSON.parse(context.sql("select jsonb_agg(jsonb_build_object('provider',cn.provider,'secretRef',b.secret_ref,'versionId',v.id)) from public.external_connections cn join public.external_connection_versions v on v.id=cn.current_version_id join local_identity.connection_bindings b on b.version_id=v.id join local_identity.input_episodes i on i.owner_id=cn.created_by where i.episode_id='a5c27db4-3c4c-434d-b43a-402e13016fbe'"));
 const dir=join(context.projectRoot,'docs/verification/model-settings-20261109'),artifactDir=process.env.LOOP_MODEL_MATRIX_ARTIFACTS!;expect(artifactDir).toBeTruthy();await mkdir(artifactDir,{recursive:true});
 try{await access(join(dir,'live-results.json'));throw Error('Existing live ledger: refuse to repeat paid model calls. Use original task recovery.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const results:any[]=[],ledger={capCents:3000,reservedCents:0,billingVerified:false,results};
 const save=()=>writeFile(join(dir,'live-results.json'),JSON.stringify(ledger,null,2));
 const image=new Uint8Array(await readFile(workspaceTestMedia('still-striped.png')));
 const prompt='A small red toy cube on a plain gray table. The camera stays still. The cube slowly rotates. No text.';
 const definitions=[...openAiImageModels.map(model=>({provider:'openai',model,ceiling:50})),
 {provider:'bailian',model:'wan2.6-i2v',ceiling:144},{provider:'bailian',model:'wan2.6-r2v',ceiling:144},
 {provider:'volcengine',model:'doubao-seedance-2-0-260128',ceiling:200},{provider:'kling',model:'kling-v3',ceiling:220},{provider:'kling',model:'kling-v3-omni',ceiling:400},
 ...Object.keys(wanVideoModels).filter(model=>!['wan2.6-i2v','wan2.6-r2v'].includes(model)).map(model=>({provider:'bailian',model,ceiling:Math.ceil(({ 'wan2.6-i2v-flash':30,'wan2.5-i2v-preview':300,'wan2.2-i2v-flash':100,'wan2.2-i2v-plus':350,'wanx2.1-i2v-plus':350,'wanx2.1-i2v-turbo':72} as any)[model]*1.2)})),
 {provider:'volcengine',model:'doubao-seedance-2-5-260628',ceiling:250},
 {provider:'freesound',model:'freesound-preview',ceiling:0},{provider:'pexels',model:'pexels-video',ceiling:0}];
 const queues=new Map<string,any[]>();for(const d of definitions){const q=queues.get(d.provider)??[];q.push(d);queues.set(d.provider,q);}
 async function run(d:any){
  const row:any={...d,startedAt:new Date().toISOString(),status:'preparing',events:[]};results.push(row);await save();
  let id:string|undefined,reserved=false;const start=performance.now();
  const reserve=async()=>{if(reserved)return;if(ledger.reservedCents+d.ceiling>ledger.capCents)throw Error('BUDGET_CAP: no paid POST sent');reserved=true;ledger.reservedCents+=d.ceiling;row.reservedCents=d.ceiling;await save();};
  const transport=async(url:string|URL,init:RequestInit={})=>{
   const parsed=new URL(url),post=init.method==='POST',event:any={operation:post?'submit':parsed.pathname.includes('/tasks/')||parsed.hostname.includes('klingai')||parsed.hostname.includes('volces')?'poll':'read',at:new Date().toISOString()};row.events.push(event);await save();
   const response=await fetch(url,{...init,signal:init.signal??AbortSignal.timeout(d.provider==='openai'?180000:60000)});event.http=response.status;event.durationMs=Math.round(performance.now()-start);
   if(response.headers.get('content-type')?.includes('json')){const v=await response.clone().json();event.usage=v.usage;event.code=v.code??v.base_resp?.status_code;event.supplierError=v.error?.message??v.message??v.base_resp?.status_msg??v.output?.message;event.taskStatus=v.output?.task_status??v.task?.status??v.data?.task_status??v.status;if(!response.ok&&response.status>=400&&response.status<500&&response.status!==408&&response.status!==429&&reserved){row.definiteRejection=true;}}
   await save();return response;
  };
  try{
   const credential=await store.get(rows.find((r:any)=>r.provider===d.provider).secretRef);
   const fetcher=['freesound','pexels'].includes(d.provider)?createWorkspaceSearchFetcher(d.provider,['search','download'],transport):createWorkspaceGenerationFetcher(d.provider,{reserve,videoTaskId:()=>id},transport);
   let output:Uint8Array|undefined;
   if(d.provider==='openai'){row.settings={size:'1024x1024',quality:'low',count:1};output=(await generateOpenAiImages({apiKey:credential,fetcher,model:d.model,prompt,settings:row.settings}))[0];}
   else if(d.provider==='freesound'){const result=await searchFreesoundPreview({apiKey:credential,fetcher,query:'calm piano',targetDurationSeconds:5,candidateIndex:0});row.search={id:result.id,title:result.title,license:result.license};}
   else if(d.provider==='pexels'){const result=await searchPexelsVideo({apiKey:credential,fetcher,query:'mountain',targetDurationSeconds:3});row.search={id:result.id,durationSeconds:result.durationSeconds};}
   else{
    const ports={credentials:credential,fetcher,prompt,reserve:async()=>({new:true}),recordSubmission:async(value:string)=>{id=value;row.providerTaskId=value;await save();},onProgress:async(phase:string)=>{row.phase=phase;await save();},maxPolls:120};
    if(d.provider==='bailian'){const profile=wanVideoModels[d.model],settings=defaultWanModelSettings(d.model);if(d.model==='wan2.6-r2v')settings.promptExtend=false;row.settings={...settings,durationSeconds:profile.durations[0]};output=await generateWanVideo({...ports,model:d.model,settings,durationSeconds:profile.durations[0],...(d.model==='wan2.6-r2v'?{visualInputs:[{role:'referenceImages',materialRevisionId:'official-demo',source:'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260129/qpzxps/wan-r2v-object4.png'}],referenceRatio:'16:9'}:{image,imageMime:'image/png'})});}
    else{const durationSeconds=d.provider==='kling'?3:4;row.settings={durationSeconds,resolution:d.provider==='kling'?'720P':'720p',mode:d.model==='kling-v3-omni'?'references':'first-frame'};output=await generateOfficialVideo({...ports,provider:d.provider,model:d.model,durationSeconds,...(d.model==='kling-v3-omni'?{visualMode:'references',referenceRatio:'16:9',visualInputs:[{role:'referenceImages',materialRevisionId:'synthetic',image,mimeType:'image/png'}]}:{image,imageMime:'image/png'})});}
   }
   if(output){row.bytes=output.length;const file=join(artifactDir,d.model.replace(/[^a-z0-9_.-]/gi,'_')+(d.provider==='openai'?'.png':'.mp4'));await writeFile(file,output);row.artifact=file;}
   row.status='completed';
  }catch(error){row.status=id?'accepted_result_pending':reserved?'failed_after_dispatch':'not_sent';row.error=error instanceof Error?error.message:String(error);}
  row.endedAt=new Date().toISOString();row.durationMs=Math.round(performance.now()-start);await save();console.log(JSON.stringify({model:d.model,status:row.status,seconds:Math.round(row.durationMs/1000),error:row.error}));
 }
 // One call at a time per vendor; independent vendors can process in parallel.
 await Promise.all([...queues.values()].map(async q=>{for(const d of q)await run(d);}));
 results.push({provider:'minimax',model:'MiniMax-H3',status:'completed_existing_user_task',taskId:'09a8a32a-b74f-4c24-9eae-a32d1436e93e',durationMs:107751,newCostCents:0});await save();
 expect(ledger.reservedCents).toBeLessThanOrEqual(3000);
},3600000);
