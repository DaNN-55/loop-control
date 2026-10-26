import{access,readFile}from'node:fs/promises';
import{constants}from'node:fs';
import{createHash}from'node:crypto';
import{join,relative,isAbsolute}from'node:path';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{safeAssetOutputPath,writeSafeAssetFile}from'../worker/controlledMediaExecutor.js';
import{runLocalWhisperXAlignment,executeWhisperX}from'../worker/whisperxAlignment.js';
import type{WorkerTaskPackage}from'../worker/contracts.js';
export const localAlignmentModel='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn';
export interface NativeAlignmentConfiguration{python:string;cacheDirectory:string;runnerSha256:string}
export function alignmentEnvironment(cache:string):NodeJS.ProcessEnv{return{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1',MPLCONFIGDIR:join(cache,'.matplotlib')};}
export async function assertAlignmentConfigured(projectRoot:string,mediaRoot:string,c?:NativeAlignmentConfiguration){
 if(!c||!isAbsolute(c.python)||!isAbsolute(c.cacheDirectory)||!c.runnerSha256)throw Error('本地 WhisperX 执行配置尚未准备；不会下载依赖或模型。');
 const rel=relative(mediaRoot,c.cacheDirectory);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('WhisperX 缓存超出隔离媒体目录。');
 await safeAssetOutputPath(mediaRoot,rel+'/.probe');await access(c.python,constants.X_OK);
 const runner=join(projectRoot,'scripts/whisperx-align.py');if(createHash('sha256').update(await readFile(runner)).digest('hex')!==c.runnerSha256)throw Error('WhisperX runner 已变化，请重新准备并重启本地 Worker。');return runner;
}
export async function assertAlignmentReady(projectRoot:string,mediaRoot:string,c?:NativeAlignmentConfiguration,model=localAlignmentModel){
 if(model!==localAlignmentModel)throw Error('冻结模型与本地强制对齐模型不一致，请重新创建任务。');
 const runner=await assertAlignmentConfigured(projectRoot,mediaRoot,c);
 try{await promisify(execFile)(c!.python,[runner,'--probe','--cache-dir',c!.cacheDirectory,'--model',model],{env:alignmentEnvironment(c!.cacheDirectory),timeout:30000,maxBuffer:65536});}catch{throw Error('本地 WhisperX/torch 依赖或缓存模型不可用，请由环境管理员准备后重试；本任务不会下载或伪造对齐结果。');}
}
export async function executeNativeAlignment(projectRoot:string,mediaRoot:string,c:NativeAlignmentConfiguration|undefined,p:WorkerTaskPackage){
 const runner=await assertAlignmentConfigured(projectRoot,mediaRoot,c),a=p.acousticAlignment;
 if(p.model!==localAlignmentModel)throw Error('冻结对齐模型不匹配。');
 if(p.capability!=='acoustic_alignment'||!a?.audioRelativePath||!a.audioSha256||!a.inputVersion)throw Error('字幕对齐任务缺少冻结音频与输入版本。');
 const local=await runLocalWhisperXAlignment({audioPath:join(p.assets.allowedRoot,a.audioRelativePath),audioSha256:a.audioSha256,cacheDirectory:c!.cacheDirectory,confirmedText:a.confirmedText,model:p.model,speakingRate:a.speakingRate??1,voice:a.voice??'',execute:input=>executeWhisperX(input,{python:c!.python,runnerPath:runner,environment:alignmentEnvironment(c!.cacheDirectory)})});
 // The native queue freezes its input-version using PostgreSQL's canonical JSONB.
 // Retain that identity; text/audio identities are independently checked below.
 if(local.model!==p.model||local.audioSha256!==a.audioSha256||local.textFingerprint!==createHash('sha256').update(a.confirmedText).digest('hex'))throw Error('对齐结果与冻结输入不一致。');
 const result={...local,inputVersion:a.inputVersion},bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');await writeSafeAssetFile(p.assets.allowedRoot,p.output.relativePath,bytes);
 return JSON.stringify({version:'worker-result/v1',taskId:p.task.id,status:'completed',artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:p.output.relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],acousticAlignment:result,validation:{passed:true,checks:[{name:'local_whisperx',passed:true,detail:result.status==='completed'?'真实本地模型返回与冻结正文对应的时序。':'模型返回待人工检查区间，不作为已确认时序。'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Local alignment completed.'},nextStep:'Owner reviews the current shot timing.'});
}
