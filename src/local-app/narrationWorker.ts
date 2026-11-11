import {isRetiredProvider} from '../worker/providerLifecycle.js';
import {videoProviders,minimaxEndpoints} from "../worker/videoProviderCatalog.js";
import {officialVideoDownloadUrl} from "../worker/officialVideoProvider.js";
import{ProviderRequestRejectedError,ProviderOutcomeUnknownError,ProviderRequestNotSentError}from'../worker/providerOutcome.js';
import{prepareProviderDispatch,markProviderDispatching}from'./providerDispatch.js';
import type{Pool}from'pg';
import{pathToFileURL}from'node:url';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{configuredKeychainStore}from'./keychainStore.js';
import{SecretStoreError,type SecretStore}from'./connectionPorts.js';
import{createProviderFetcher,createWorkspaceGenerationFetcher,type ProviderNetworkConfiguration,type OnlineProvider}from'./providerNetwork.js';
import{executeControlledMediaTask}from'../worker/controlledMediaExecutor.js';
import type{WorkerTaskPackage}from'../worker/contracts.js';
import type{MediaFetcher}from'../worker/mediaProviders.js';
export type NativeNarrationConfiguration=({mode:'live';keychain:{approved:boolean;runtimeRoot:string;helperSha256:string};network:ProviderNetworkConfiguration}|{mode:'controlled';modulePath:string})&{workspaceSpeechFromConnections?:boolean};
interface Ports{mode:'controlled'|'live';store:SecretStore;fetcher:MediaFetcher}
export async function narrationPorts(config?:NativeNarrationConfiguration,allowMissingNetwork=false):Promise<Ports>{
 if(!config)throw new SecretStoreError('disabled');
 if(config.mode==='live'){
  if(!config.network&&!allowMissingNetwork)throw new SecretStoreError('unavailable');
  const providerFor=(url:string|URL):OnlineProvider=>{const h=new URL(url).hostname;for(const [provider,p] of Object.entries(videoProviders)){if(h===new URL(p.endpoint).hostname||provider==='minimax'&&h===new URL(minimaxEndpoints.cn).hostname)return provider as OnlineProvider;try{officialVideoDownloadUrl(provider as keyof typeof videoProviders,String(url));return provider as OnlineProvider;}catch{/* Try other official result hosts. */}}if(h==='dashscope.aliyuncs.com'||/^ws-[a-z0-9]{8,64}\.cn-beijing\.maas\.aliyuncs\.com$/.test(h)||['dashscope-a717.oss-accelerate.aliyuncs.com','dashscope-f4de.oss-accelerate.aliyuncs.com','dashscope-7c2c.oss-cn-shanghai.aliyuncs.com'].includes(h)||/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(h))return'bailian';if(h==='api.openai.com')return'openai';if(h==='api.cloudflare.com')return'cloudflare';if(h==='texttospeech.googleapis.com')return'google_tts';if(h==='openspeech.bytedance.com')return'volcengine_tts';if(['api.pexels.com','videos.pexels.com','images.pexels.com'].includes(h))return'pexels';if(['freesound.org','cdn.freesound.org'].includes(h))return'freesound';throw new SecretStoreError('unavailable');};
  return{mode:'live',store:configuredKeychainStore(config.keychain),fetcher:(url,init)=>{
   if(!config.network)throw new SecretStoreError('unavailable');
   return createProviderFetcher(config.network,providerFor(url),'execute')(url,init);
  }};
 }
 if(config.mode!=='controlled'||!config.modulePath.startsWith('/'))throw new SecretStoreError('unavailable');
 // Deployment-only test substitute; no browser command can choose this module.
 const p=await(await import(pathToFileURL(config.modulePath).href)).createNarrationPorts() as Ports;
 if(p.mode!=='controlled'||p.store?.mode!=='keychain'||typeof p.fetcher!=='function')throw new SecretStoreError('unavailable');return p;
}
export async function assertNarrationReady(config?:NativeNarrationConfiguration){
 const p=await narrationPorts(config,config?.workspaceSpeechFromConnections);if(p.store.mode!=='keychain')throw new SecretStoreError('disabled');
 await promisify(execFile)('ffprobe',['-version'],{env:{PATH:process.env.PATH},timeout:3000,maxBuffer:65536});
}
export async function executeNativeNarration(pool:Pool,config:NativeNarrationConfiguration|undefined,p:WorkerTaskPackage,fence:{p_task_id:string;p_attempt:number;p_lease_token:string}){
 if(isRetiredProvider(p.provider))throw new SecretStoreError('disabled');
 const speech=config?.workspaceSpeechFromConnections&&p.provider==='volcengine_tts'&&p.media?.adapter==='volcengine_tts'&&p.promptVersion==='production-request-v1'?p.media.narration:undefined;
 const ports=await narrationPorts(config,!!speech);
 let secret:string;
 try{const row=(await pool.query('SELECT * FROM local_identity.input_task_connection($1,$2,$3)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token])).rows[0];
  const endpoint='https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
  if(!row||row.provider!==p.provider||row.adapter!==p.media?.adapter||row.endpoint!==endpoint||row.version_id!==p.credentialRef)throw Error();
  secret=await ports.store.get(row.secret_ref);
 }catch{throw new SecretStoreError('unavailable');}
 const unavailable=async():Promise<never>=>{throw Error('Task outside native narration scope');};
 const fenceArgs=[fence.p_task_id,fence.p_attempt,fence.p_lease_token];
 let route:string|undefined,dispatched=false,rejected=false,rejectionStatus=0;
 const fetchConfirmedSpeech=speech?createWorkspaceGenerationFetcher('volcengine_tts',{
  speech:{text:speech.text,voice:speech.voice.name,model:p.model},
  reserve:async()=>{
   route=await prepareProviderDispatch(pool,fence,'speech');
  },
 },async(url,init)=>{await markProviderDispatching(pool,fence);dispatched=true;return route==='confirmed'&&ports.mode==='live'?fetch(url,init):ports.fetcher(url,init);}):undefined;
 let output:string;
 try{output=await executeControlledMediaTask({taskPackage:p,fetcher:async(url,init)=>{
   if(!fetchConfirmedSpeech){
    await prepareProviderDispatch(pool,fence,'speech');
    await markProviderDispatching(pool,fence);dispatched=true;
   }
   let response:Response;try{response=await (fetchConfirmedSpeech??ports.fetcher)(url,init);}catch(error){if(error instanceof ProviderRequestNotSentError)throw error;throw new ProviderOutcomeUnknownError();}
   // A transport break or accepted-but-malformed response must never resend a paid request.
   // Only a definite client rejection permits Owner's explicit retry.
   rejectionStatus=response.status;rejected=response.status>=400&&response.status<500&&response.status!==408;
   if(rejected)await pool.query('SELECT local_identity.record_workspace_narration_submission($1,$2,$3,$4)',[...fenceArgs,'rejected']);
   return response;
  },pexelsApiKey:undefined,googleTtsApiKey:undefined,volcengineTtsApiKey:p.provider==='volcengine_tts'?secret:undefined,validateMp4:unavailable,extractMp3:unavailable,trimMp3:unavailable,
  async probeMp3(path){const{stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path],{env:{PATH:process.env.PATH},timeout:5000,maxBuffer:65536});const duration=Number(stdout.trim());if(!Number.isFinite(duration)||duration<=0)throw Error('音频不可播放或时长无效。');return duration;}});}catch(error){if(error instanceof ProviderRequestRejectedError){try{await pool.query('SELECT local_identity.record_workspace_narration_submission($1,$2,$3,$4)',[...fenceArgs,'rejected']);}catch{throw new ProviderOutcomeUnknownError(undefined,'拒绝回执尚未登记');}throw error;}if(error instanceof ProviderOutcomeUnknownError||error instanceof ProviderRequestNotSentError)throw error;if(rejected)throw new ProviderRequestRejectedError(rejectionStatus);if(dispatched&&!rejected)throw new ProviderOutcomeUnknownError(undefined,'返回内容尚未通过音频校验');throw Error(rejected?'供应商已明确拒绝本次口播请求，请检查连接或参数后重试。':'口播生成或音频验证失败，请检查连接和本机执行状态。');}
 const result=JSON.parse(output);result.validation.checks.push({name:'native_narration_mode',passed:true,detail:ports.mode==='controlled'?'受控响应及密钥存储替身；没有在线Provider请求或真实语音生成证明。':'实际在线Provider执行。'});return JSON.stringify(result);
}
