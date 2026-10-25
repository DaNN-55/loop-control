import type {Pool} from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {executeControlledMediaTask} from '../worker/controlledMediaExecutor.js';
import {executeOpenChatCutRender} from '../worker/openchatcutRenderer.js';
import {generateVisualAssets} from '../worker/visualAssetExecutor.js';
import {runtimeCommandInvocation} from '../worker/runtimeEvidence.js';
import {extractMp3Artifact,trimMp3Artifact,trimMp4Artifact,trimMp4SegmentsArtifact,probeMp3Artifact,validateMp4Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';
import {narrationPorts,type NativeNarrationConfiguration} from './narrationWorker.js';
import {SecretStoreError} from './connectionPorts.js';
export type NativeMediaConfiguration=NativeNarrationConfiguration|{mode:'local'};
export async function assertMediaReady(config:NativeMediaConfiguration|undefined,policy:Record<string,unknown>={},environment:NodeJS.ProcessEnv=process.env,requiresExternal=false){
 if(!config)throw Error('本地媒体执行尚未配置。');
 const external=requiresExternal||['static_visual','a_roll','b_roll','soundtrack'].some(k=>(policy[k] as {execution_path?:string}|undefined)?.execution_path==='external');
 if(external&&config.mode==='local')throw Error('在线媒体执行尚未配置；当前部署仅允许本机媒体。');
 await promisify(execFile)('ffmpeg',['-version'],{env:environment,timeout:3000,maxBuffer:65536});
 await promisify(execFile)('ffprobe',['-version'],{env:environment,timeout:3000,maxBuffer:65536});
 for(const c of Object.values(policy) as Array<{execution_path?:string;executor?:{provider?:string}}>)if(c?.execution_path==='local'&&c.executor?.provider==='openchatcut'){const i=runtimeCommandInvocation('openchatcut',['--version']);await promisify(execFile)(i.command,i.argumentsList,{env:environment,timeout:5000,maxBuffer:65536});}
 if(external){const ports=await narrationPorts(config.mode==='local'?undefined:config);if(ports.store.mode!=='keychain')throw Error('在线媒体秘密存储尚未配置。');}
}
export function nativeMediaTask(type:string,provider:string){return (['generate_shot_sync_preview','generate_review_render','generate_final_render'].includes(type)&&provider==='openchatcut')||(['generate_a_roll','generate_b_roll'].includes(type)&&['openchatcut','ffmpeg','pexels'].includes(provider))||(type==='generate_soundtrack'&&provider==='freesound')||(type==='extract_embedded_audio'&&provider==='ffmpeg');}
export async function executeNativeMedia(pool:Pool,config:NativeMediaConfiguration|undefined,p:WorkerTaskPackage,fence:{p_task_id:string;p_attempt:number;p_lease_token:string},visualOutput?:string){
 const external=Boolean(p.credentialRef||p.visualAssetPreparation?.imageGeneration);
 await assertMediaReady(config,{},process.env,external);
 const ports=external?await narrationPorts(config?.mode==='local'?undefined:config):undefined;
 const resolve=async(ref:string|undefined,provider:string,adapter:string)=>{
  if(!ports||!ref)throw new SecretStoreError('unavailable');
  try{const r=(await pool.query('SELECT * FROM local_identity.input_media_connection($1,$2,$3,$4)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,ref])).rows[0];if(!r||r.provider!==provider||r.adapter!==adapter)throw Error();return await ports.store.get(r.secret_ref);}catch{throw new SecretStoreError('unavailable');}
 };
 try{
  let output:string;
  if(visualOutput!==undefined){if(!ports)throw new SecretStoreError('unavailable');output=await generateVisualAssets(p,visualOutput,resolve,ports.fetcher);}
  else if(p.provider==='openchatcut'){
   if(!['generate_shot_sync_preview','generate_review_render','generate_final_render'].includes(p.task.type)&&p.aRoll?.adapter!=='openchatcut_card_video'&&p.media?.adapter!=='openchatcut_card_video')throw Error();
   output=await executeOpenChatCutRender({taskPackage:p,...(p.finalRender?{getApprovedReuseSource:async()=>{const result=(await pool.query('SELECT local_identity.input_final_reuse_source($1,$2,$3) result',[fence.p_task_id,fence.p_attempt,fence.p_lease_token])).rows[0]?.result;if(!result)throw Error('Final approval or lease unavailable');return result;}}:{}),validateMp4:validateMp4Artifact,inspectMp4:inspectMp4Artifact,async run(command,args){const invocation=runtimeCommandInvocation(command,args);await promisify(execFile)(invocation.command,invocation.argumentsList,{timeout:300000,maxBuffer:4*1024*1024});}});
  }else{
   const secret=external?await resolve(p.credentialRef,p.provider,p.media!.adapter):undefined;
   const denied=async():Promise<never>=>{throw Error('External media not configured');};
   output=await executeControlledMediaTask({taskPackage:p,fetcher:ports?.fetcher??denied,pexelsApiKey:p.provider==='pexels'?secret:undefined,googleTtsApiKey:undefined,freesoundApiKey:p.provider==='freesound'?secret:undefined,validateMp4:validateMp4Artifact,probeMp3:probeMp3Artifact,extractMp3:extractMp3Artifact,trimMp3:trimMp3Artifact,trimMp4:trimMp4Artifact,trimMp4Segments:trimMp4SegmentsArtifact});
  }
  const result=JSON.parse(output);result.validation.checks.push({name:'native_media_mode',passed:true,detail:ports?.mode==='controlled'?'受控Provider响应和SecretStore替身；没有在线资格或在线生成证明。':external?'在线执行路径。':'本机媒体执行。'});return JSON.stringify(result);
 }catch{throw Error('媒体执行或产物验证失败，请检查冻结输入和本机执行状态。');}
}
