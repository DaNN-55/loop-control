import type{Pool}from'pg';
import{pathToFileURL}from'node:url';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{configuredKeychainStore}from'./keychainStore.js';
import{SecretStoreError,type SecretStore}from'./connectionPorts.js';
import{executeControlledMediaTask}from'../worker/controlledMediaExecutor.js';
import type{WorkerTaskPackage}from'../worker/contracts.js';
import type{MediaFetcher}from'../worker/mediaProviders.js';
export type NativeNarrationConfiguration={mode:'live';keychain:{approved:boolean;runtimeRoot:string;helperSha256:string}}|{mode:'controlled';modulePath:string};
interface Ports{mode:'controlled'|'live';store:SecretStore;fetcher:MediaFetcher}
export async function narrationPorts(config?:NativeNarrationConfiguration):Promise<Ports>{
 if(!config)throw new SecretStoreError('disabled');
 if(config.mode==='live')return{mode:'live',store:configuredKeychainStore(config.keychain),fetcher:fetch};
 if(config.mode!=='controlled'||!config.modulePath.startsWith('/'))throw new SecretStoreError('unavailable');
 // Deployment-only test substitute; no browser command can choose this module.
 const p=await(await import(pathToFileURL(config.modulePath).href)).createNarrationPorts() as Ports;
 if(p.mode!=='controlled'||p.store?.mode!=='keychain'||typeof p.fetcher!=='function')throw new SecretStoreError('unavailable');return p;
}
export async function assertNarrationReady(config?:NativeNarrationConfiguration){
 const p=await narrationPorts(config);if(p.store.mode!=='keychain')throw new SecretStoreError('disabled');
 await promisify(execFile)('ffprobe',['-version'],{env:{PATH:process.env.PATH},timeout:3000,maxBuffer:65536});
}
export async function executeNativeNarration(pool:Pool,config:NativeNarrationConfiguration|undefined,p:WorkerTaskPackage,fence:{p_task_id:string;p_attempt:number;p_lease_token:string}){
 const ports=await narrationPorts(config);
 let secret:string;
 try{const row=(await pool.query('SELECT * FROM local_identity.input_task_connection($1,$2,$3)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token])).rows[0];
  const endpoint=p.provider==='google_tts'?'https://texttospeech.googleapis.com/v1':'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
  if(!row||row.provider!==p.provider||row.adapter!==p.media?.adapter||row.endpoint!==endpoint||row.version_id!==p.credentialRef)throw Error();
  secret=await ports.store.get(row.secret_ref);
 }catch{throw new SecretStoreError('unavailable');}
 const unavailable=async():Promise<never>=>{throw Error('Task outside native narration scope');};
 let output:string;
 try{output=await executeControlledMediaTask({taskPackage:p,fetcher:ports.fetcher,pexelsApiKey:undefined,googleTtsApiKey:p.provider==='google_tts'?secret:undefined,volcengineTtsApiKey:p.provider==='volcengine_tts'?secret:undefined,validateMp4:unavailable,extractMp3:unavailable,trimMp3:unavailable,
  async probeMp3(path){const{stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path],{env:{PATH:process.env.PATH},timeout:5000,maxBuffer:65536});const duration=Number(stdout.trim());if(!Number.isFinite(duration)||duration<=0)throw Error('音频不可播放或时长无效。');return duration;}});}catch{throw Error('口播生成或音频验证失败，请检查连接和本机执行状态。');}
 const result=JSON.parse(output);result.validation.checks.push({name:'native_narration_mode',passed:true,detail:ports.mode==='controlled'?'受控响应及秘密存储替身；没有在线Provider请求或真实语音生成证明。':'实际在线Provider执行。'});return JSON.stringify(result);
}
