import {LocalEpisodeBatchImport} from './episodeBatchImport.js';
import {CompletedProductionCopies} from './completedProductionCopies.js';
import {confirmScriptStudio} from './scriptStudioConfirmation.js';
import {resolveScriptReview,saveScriptReviewDraft} from './batchScriptReview.js';
import {CompletedStudioCopies,completedProjectSources} from './completedStudioCopies.js';
import {readProductionWorkspace,readWorkspaceVersion} from './productionWorkspaceCommands.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {episodeFileIO} from './episodeFiles.js';
import {ownerTransaction} from './ownerTransaction.js';
import {localExportActivity,type LocalExportActivity} from './productionLocalExport.js';
import {recordValidatedRequestLogContext} from './runtimeRequestLog.js';
import {validateScriptStudioAttachmentUpload} from './scriptStudioDocuments.js';
import {validateImportedMaterial} from './materialAcceptance.js';
import {createEpisodeDirectory} from './episodeCreation.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {requireAccountAssetRoot,resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {productionWorkspaceFields} from '../productionWorkspace.js';
import {ProductionWorkspaceCommands} from './productionWorkspaceCommands.js';
import {confirmRecognizedScript} from './scriptRecognitionConfirmation.js';
import {reconfirmScript} from './scriptRevisionCommands.js';
import {parseStoryboardScript} from '../reviews/productionScript.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import{resolveLocalAssetRoot}from'./mediaDeployment.js';
import {openStandaloneOpenChatCutStudio,closeStandaloneOpenChatCutStudio,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {snapshotInput} from './localFiles.js';
import {verifyMediaLibrary} from '../worker/mediaLibrary.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname} from 'node:path';
import {workerPreflightVersion,type WorkerPreflightCheck} from '../worker/contracts.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const retiredPlanningCommands=new Set(['review','annotateStoryboard','planStoryboard','requestStructureRevision','requestStudioStoryboardRevision','saveWorkspacePlanningSelection','retryWorkspacePlanning']);
const retiredManualCommands=new Set(['recordWorkspaceExportIssue','resolveWorkspaceExportIssue','generateOfficialVideo','generateWan','resumeWan','annotateAudio','requestQcMemberRevision','saveTtsSettings','saveTtsDraft','registerManualMedia','saveAudioSelection','planMedia','retryMedia','saveMediaDraft','generateClip','setAudioSourceMode','generateSourceAudio','requestAlignment','saveManualAlignment','confirmCaptionText','generateSyncPreview','confirmSyncPreview','openStudio','saveStudio','generateReviewVideo','submitStudioRevision','requestStudioCompositionRevision','createQcIssue','resolveQcIssue','approveQc','retryFinalRender','preparePublishPackage']);
export interface InputRuntime {studioAgentEnvironment?(client:PoolClient,episodeId:string):Promise<NodeJS.ProcessEnv>;revokeStudioAgent?(episodeId:string):void;localExportActivity?:LocalExportActivity;openDirectory?(path:string):Promise<void>;deliveryReady?():Promise<void>;studioRuntime?():Promise<OpenChatCutRuntimeConfig>;ready():Promise<void>;narrationReady?():Promise<void>;mediaReady?(policy:Record<string,unknown>):Promise<void>;postReady?(kind:'alignment'):Promise<void>;wake(episodeId:string):void;mountPath:string;minimumFreeBytes:number;checkReferences(client:PoolClient,refs:string[],options?:{purpose?:'workspace-generation'}):Promise<void>}
export class LocalEpisodeCommands {
 private exports=localExportActivity();
 activeLocalExports(ownerId:string){return this.exports.count(ownerId);}
 private workspace=new ProductionWorkspaceCommands();
 private standaloneStudios=new Set<string>();
 private completedCopies:CompletedStudioCopies;
 private productionCopies:CompletedProductionCopies;
 private scriptStore:ScriptProductionStore;
 readonly batchImport:LocalEpisodeBatchImport;
 closeStudio(episodeId:string){return this.workspace.closeEpisode(episodeId);}
 async close(){await Promise.all([this.workspace.close(),this.completedCopies.close(),...[...this.standaloneStudios].map(root=>closeStandaloneOpenChatCutStudio(root))]);this.standaloneStudios.clear();}
 constructor(private pool:Pool,private mediaRoot:string,private runtime:InputRuntime){this.runtime={...runtime,localExportActivity:this.exports};this.scriptStore=new ScriptProductionStore();
  this.batchImport=new LocalEpisodeBatchImport(pool,mediaRoot,(c,_account,policy)=>this.preflight(c,policy));
  this.productionCopies=new CompletedProductionCopies(pool,mediaRoot,async()=>{if(!this.runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 尚未配置。');return this.runtime.studioRuntime();});
  this.completedCopies=new CompletedStudioCopies(mediaRoot,async()=>{if(!this.runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 尚未配置。');return this.runtime.studioRuntime();},(ownerId,episodeId)=>ownerTransaction(pool,ownerId,true,async c=>{
   const episode=(await c.query("SELECT e.id,e.title,e.stage FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[episodeId,ownerId])).rows[0];
   if(!episode)throw new ConfigurationError(404,'生产单不可见。');if(episode.stage!=='production_completed')throw new ConfigurationError(409,'仅已完成生产单可以打开查看副本。');
   const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),workspace=await readProductionWorkspace(c,episodeId,root),delivery=workspace?.deliveries?.find(value=>value.status==='completed');
   const exported=workspace?.exports?.find(value=>value.id===delivery?.exportId&&value.confirmedAt&&value.artifact&&delivery.artifacts.some(artifact=>artifact.artifactType==='final_render'&&artifact.sha256===value.artifact!.sha256));
   if(!exported)throw new ConfigurationError(409,'未找到交付对应的已确认工程，不能用最近工程替代。');
   const project=await readWorkspaceVersion(c,root,episodeId,exported.project.sha256),io=await episodeFileIO(c,root,episodeId);
   const sources=[];
   for(const reference of completedProjectSources(project)){const source=await resolveWorkspaceSource(c,root,episodeId,reference);sources.push({reference,path:await io.resolveReference(reference),sha256:source.sha256,fileSize:Number(source.file_size)});}
   await io.assertValid();return{project,sha256:exported.project.sha256,title:episode.title,sources};
  }));
 }
 async completedStudioCopy(session:OwnerSession,episodeId:string,body:Record<string,unknown>){
  if(Object.keys(body).some(key=>!['action','copyId'].includes(key))||typeof body.copyId!=='string'||!uuid.test(body.copyId)||!['open','heartbeat','keep','discard'].includes(String(body.action)))throw new ConfigurationError(400,'查看副本请求无效。');
  const ownerId=session.id;
  if(body.action==='open')return this.completedCopies.open(ownerId,episodeId,body.copyId);
  if(body.action==='keep')return this.productionCopies.save(session,episodeId,body.copyId,()=>this.completedCopies.productionDraft(ownerId,episodeId,body.copyId as string));
  if(body.action==='heartbeat')return this.completedCopies.heartbeat(ownerId,episodeId,body.copyId);
  return this.completedCopies.discard(ownerId,episodeId,body.copyId);
 }
 async execute(session:OwnerSession,body:Record<string,unknown>){return this.executeCommand(session,body,run=>sessionTransaction(this.pool,session,run));}
 private async executeCommand(session:{id:string},body:Record<string,unknown>,transaction:<T>(run:(c:PoolClient)=>Promise<T>)=>Promise<T>){
  if(typeof body.command!=='string'||!retiredPlanningCommands.has(body.command)&&!retiredManualCommands.has(body.command)&&!['generateTts','repairConnection','repairConfiguration'].includes(body.command)&&!Object.hasOwn(productionWorkspaceFields,body.command)&&!['create','start','reconfirmScript','confirmRecognizedScript','confirmScriptStudio','saveScriptReviewDraft','confirmReviewedScript','importMaterial','openDirectory','openStandaloneStudio'].includes(body.command)||typeof body.idempotencyKey!=='string'||!/^[0-9a-f-]{36}$/.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k)))throw new ConfigurationError(400,'Episode命令无效。');
  const data=body.data as Record<string,unknown>,hash=canonicalFingerprint(body);
  const retiredNarration=body.command==='generateTts';
  const retiredManual=retiredManualCommands.has(body.command);
  const retiredExecution=['repairConfiguration','repairConnection'].includes(body.command);
  const retiredPlanning=retiredPlanningCommands.has(body.command)||body.command==='replanWorkspace'&&Object.hasOwn(data,'planningTaskId');
  const allowed:Record<string,string[]>={create:['accountId','title','seriesVersionId','isTest'],importMaterial:['episodeId','sourceKind','sourcePath','logicalName','materialType','materialPurpose','mimeType','isMainScript','contentBase64','deferRefresh','scriptStudioAttachment'],openDirectory:['episodeId']};
  allowed.start=['episodeId'];
  allowed.reconfirmScript=['episodeId','expectedScriptRevisionId','text','reason'];
  allowed.confirmRecognizedScript=['episodeId','expectedScriptRevisionId','text','reason','recognitionRequestId'];
  allowed.confirmScriptStudio=['episodeId','expectedScriptRevisionId','text','targetDuration','reason','requestId'];
  allowed.saveScriptReviewDraft=['episodeId','text','targetDuration','reason','requestId'];
  allowed.confirmReviewedScript=['episodeId','reviewFingerprint'];
  allowed.openStandaloneStudio=[];
  Object.assign(allowed,productionWorkspaceFields);
  if(!retiredManual&&!retiredPlanning&&!retiredNarration&&!retiredExecution&&Object.keys(data).some(k=>!allowed[body.command as string].includes(k)))throw new ConfigurationError(400,'Episode字段无效。');
  if(['saveScriptReviewDraft','confirmReviewedScript'].includes(body.command)&&!uuid.test(String(data.episodeId)))throw new ConfigurationError(400,'生产单标识无效。');
  if(body.command==='confirmReviewedScript'&&!/^[a-f0-9]{64}$/.test(String(data.reviewFingerprint)))throw new ConfigurationError(400,'脚本核对版本无效。');
  if(body.command==='importMaterial'&&Object.hasOwn(data,'scriptStudioAttachment')&&data.scriptStudioAttachment!==true)throw new ConfigurationError(400,'附件校验标记无效。');
  recordValidatedRequestLogContext({operation:'episode.'+body.command});
  if(body.command==='create'){
   const created=await createEpisodeDirectory(this.pool,session as OwnerSession,body.idempotencyKey,hash,data,this.mediaRoot,(c,_account,policy)=>this.preflight(c,policy));
   recordValidatedRequestLogContext({episodeId:String(created.id)});return created;
  }
  const result=await transaction(async c=>{
   if(retiredManual||retiredPlanning||retiredNarration||retiredExecution){
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    if(!(await c.query("SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[data.episodeId,session.id])).rowCount)throw new ConfigurationError(404,'本地生产单不可见。');
    recordValidatedRequestLogContext({episodeId:data.episodeId});
    throw new ConfigurationError(410,retiredManual?'旧制作执行入口已退役，请通过当前工作区接入原工程。':retiredExecution?'旧任务修复与自动续跑已退役，请使用当前制作工作区。':retiredNarration?'旧口播生成入口已退役，请在分镜台选择本次制作服务。':'旧视觉与分镜规划已退役，请使用当前制作流程。');
   }
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+body.idempotencyKey]);
   const old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,body.idempotencyKey])).rows[0];
   if(old){
    if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');
    if(!['openDirectory','openStandaloneStudio','openWorkspaceStudio'].includes(body.command as string)){
     // The matching Owner receipt proves the original result, without re-running
     // its command or attributing an unverified identity from the new request.
     if(old.result?.episodeId===data.episodeId)recordValidatedRequestLogContext({episodeId:old.result.episodeId,workspaceId:old.result.id});
     else if(old.result?.id===data.episodeId)recordValidatedRequestLogContext({episodeId:old.result.id});
     return old.result;
    }
   }
   let value;
   if(body.command==='openStandaloneStudio'){
    if(!this.runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 尚未配置。');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':standalone-studio']);
    const config=await this.runtime.studioRuntime();
    const root=dirname(await safeAssetOutputPath(this.mediaRoot,`openchatcut/standalone/${session.id}/.probe`));
    this.standaloneStudios.add(root);
    try{value=await openStandaloneOpenChatCutStudio(root,config);}
    catch{throw new ConfigurationError(503,'OpenChatCut 启动失败，请检查本机编辑器运行环境后重试。');}
   }else if(body.command==='openDirectory'){
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    if(!(await c.query('SELECT local_identity.lock_owned_episode_cleanup($1) owned',[data.episodeId])).rows[0]?.owned)throw new ConfigurationError(404,'生产单不可见。');
    recordValidatedRequestLogContext({episodeId:data.episodeId});
    const location=await resolveEpisodeStorageLocation(c,this.mediaRoot,data.episodeId);
    const path=await requireEpisodeStorageDirectory(c,location);
    try{if(this.runtime.openDirectory)await this.runtime.openDirectory(path);else await promisify(execFile)('/usr/bin/open',[path],{env:{PATH:'/usr/bin:/bin'},timeout:5000});}
    catch{throw new ConfigurationError(503,'系统未能打开文件夹，请复制路径后在访达中打开，或恢复桌面会话后重试。');}
    value={opened:true,path};
   }else{
    // Older owned orders predate native execution registration. Enrol only at
    // an explicit four-step entry; failed commands roll this back with the rest.
    if(['importLegacyDraftInputs','adoptLegacyWorkspace','adoptLegacyPlan','prepareWorkspace','reconfirmScript','confirmRecognizedScript','confirmScriptStudio','saveScriptReviewDraft','confirmReviewedScript','importMaterial'].includes(String(body.command))&&!(await c.query('SELECT 1 FROM local_identity.input_episodes WHERE episode_id=$1',[data.episodeId])).rowCount){
     if(!(await c.query('SELECT local_identity.lock_owned_episode_cleanup($1) owned',[data.episodeId])).rows[0].owned)throw new ConfigurationError(404,'本地生产单不可见。');
     const legacy=(await c.query('SELECT stage,archived_at FROM public.episodes WHERE id=$1',[data.episodeId])).rows[0];
     if(legacy.archived_at||legacy.stage==='production_completed')throw new ConfigurationError(409,'历史或已完成生产单只读。');
     await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[data.episodeId,session.id]);
    }
    if(!(await c.query('SELECT local_identity.lock_owned_input_episode($1) owned',[data.episodeId])).rows[0].owned)throw new ConfigurationError(404,'本地生产单不可见。');
    const e=(await c.query('SELECT e.*,b.policy,i.storyboard_enabled,i.script_template_version FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE e.id=$1 AND m.user_id=$2 AND m.role=\'owner\' AND i.owner_id=$2',[data.episodeId,session.id])).rows[0];
    if(!e)throw new ConfigurationError(404,'本地生产单不可见。');
    recordValidatedRequestLogContext({accountId:e.account_id,episodeId:e.id});
    const inputIo=['importMaterial','reconfirmScript','confirmRecognizedScript','confirmScriptStudio','confirmReviewedScript','prepareWorkspace','adoptLegacyPlan','importLegacyDraftInputs'].includes(String(body.command)),location=inputIo?await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id):null;
    if(location)await requireEpisodeStorageDirectory(c,location);
    const root=location?.assetRoot??await resolveEpisodeAssetRoot(c,this.mediaRoot,e.id);
    if(body.command!=='openDirectory'){
     if((await c.query('SELECT 1 FROM local_identity.account_asset_directories WHERE account_id=$1',[e.account_id])).rowCount)await requireAccountAssetRoot(c,this.mediaRoot,e.account_id);
     else{const legacy=location??await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id);if(legacy.layoutVersion!==1)throw new ConfigurationError(409,'账号目录未登记，请先恢复存储位置。');await requireEpisodeStorageDirectory(c,legacy);if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying'",[e.account_id])).rowCount)throw new ConfigurationError(409,'账号正在纳管，请先恢复或回滚原操作。');}
    }
    const inputPolicy=[2,3].includes(e.script_template_version)?{...e.policy,asset_root:root,static_visual:{execution_path:'manual'},soundtrack:{execution_path:'manual'}}:{...e.policy,asset_root:root};
    if(['reconfirmScript','confirmRecognizedScript','confirmScriptStudio','confirmReviewedScript'].includes(String(body.command))&&this.workspace.isOpen(e.id))throw new ConfigurationError(409,'请先保存并返回，再修订脚本或分镜。');
    if(Object.hasOwn(productionWorkspaceFields,String(body.command))){value=await this.workspace.execute(c,e,root,this.runtime,String(body.command),data);
    }else if(body.command==='confirmScriptStudio'){
     value=await confirmScriptStudio(c,root,session.id,e,data,location!.relativePath);
    }else if(body.command==='saveScriptReviewDraft'){
     value=await saveScriptReviewDraft(c,session.id,e,data);
    }else if(body.command==='confirmReviewedScript'){
     const {review,draft}=await resolveScriptReview(c,this.mediaRoot,session.id,e);
     if(review.status==='skipped'&&(e.archived_at||e.stage!=='waiting_input')){
      value={episodeId:e.id,status:'skipped',reason:review.reason};
     }else if(review.status!=='ready'||review.reviewFingerprint!==data.reviewFingerprint){
      value={episodeId:e.id,status:'failed',reason:'待确认脚本已变化，请重新核对。',requiresReview:true};
     }else{
      const scriptId=draft?(await confirmScriptStudio(c,root,session.id,e,{expectedScriptRevisionId:null,text:draft.sourceText,targetDuration:draft.targetDuration,reason:draft.reason,requestId:draft.requestId},location!.relativePath)).id:e.main_script_revision_id;
      const policy=draft?{...inputPolicy,static_visual:{execution_path:'manual'},soundtrack:{execution_path:'manual'}}:inputPolicy;
      await this.start(c,e.id,scriptId,root,policy);
      value={episodeId:e.id,status:'success'};
     }
    }else if(body.command==='confirmRecognizedScript'){
     value=await confirmRecognizedScript(c,root,session.id,e,data,location!.relativePath);
    }else if(body.command==='reconfirmScript'){
     value=await reconfirmScript(c,root,e,data,location!.relativePath);
    }else if(body.command==='importMaterial'){
     if(data.isMainScript&&(e.stage!=='waiting_input'||e.main_script_revision_id))throw new ConfigurationError(409,'主脚本已确认或制作已开始，不能替换。');
     const purposes=['main_script','supplemental_script','general_reference','visual_reference','a_roll','b_roll','narration','background_music','sound_effect','cover'];
     if(!purposes.includes(String(data.materialPurpose))||typeof data.materialType!=='string'||typeof data.mimeType!=='string'||typeof data.isMainScript!=='boolean')throw new ConfigurationError(400,'材料类型无效。');
     if(typeof data.sourceKind!=='string'||typeof data.sourcePath!=='string'||data.logicalName!==undefined&&typeof data.logicalName!=='string')throw new ConfigurationError(400,'材料路径无效。');
     let mimeType=data.mimeType;
     const snapshot=await snapshotInput(root,e.id,data as never,location!.relativePath,async bytes=>{if(data.scriptStudioAttachment===true){try{mimeType=validateScriptStudioAttachmentUpload(bytes,data as never);}catch(error){throw new ConfigurationError(400,(error as Error).message);}}const accepted=await validateImportedMaterial(bytes,data as never);if(data.scriptStudioAttachment!==true)mimeType=accepted;});
     const previous=!data.isMainScript?(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND material_type=$2 AND source_path=$3 ORDER BY revision_number DESC LIMIT 1',[e.id,data.materialType.trim(),snapshot.sourcePath.trim()])).rows[0]:undefined;
     // Reusing the same validated bytes is not a source revision. In particular,
     // another shot uploading the same reference must not invalidate paid work.
     const unchanged=previous&&!previous.is_main_script&&previous.source_kind===data.sourceKind&&previous.material_purpose===data.materialPurpose&&previous.mime_type===mimeType&&previous.sha256===snapshot.sha256&&Number(previous.file_size)===snapshot.fileSize&&previous.storage_path===snapshot.storagePath;
     value=unchanged?previous:(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) result',[e.id,data.materialType,data.sourceKind,snapshot.sourcePath,snapshot.storagePath,mimeType,snapshot.sha256,snapshot.fileSize,data.isMainScript,data.materialPurpose])).rows[0].result;
     if(data.isMainScript)await c.query('UPDATE local_identity.input_episodes SET script_template_version=$2 WHERE episode_id=$1',[e.id,parseStoryboardScript((await verifyEpisodeFile(c,root,e.id,snapshot.storagePath,snapshot.sha256,snapshot.fileSize)).toString('utf8'))?.version??null]);
     if(!data.isMainScript)await this.scriptStore.alias(c,session.id,value.id,String(data.sourcePath));
    }else if(body.command==='start'){
     value=await this.start(c,e.id,e.main_script_revision_id,root,inputPolicy);
    }else throw new ConfigurationError(400,'不支持的制作操作。');
   }
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) DO NOTHING',[session.id,body.idempotencyKey,hash,value]);return value;
  });
  if(['requestWorkspaceVisualCandidate','requestWorkspaceImageCandidates','retryWorkspaceVisualCandidate','prepareWorkspaceAudio','prepareWorkspaceDelivery','completeWorkspaceExport','retryWorkspaceDelivery','requestWorkspaceCaptionAlignment','generateWorkspaceNarration','generateWorkspaceImage'].includes(body.command))this.runtime.wake(String(data.episodeId??result.id));return result;
 }
 private async start(c:PoolClient,episodeId:string,scriptId:string|null,root:string,policy:Record<string,unknown>&{static_visual?:{executor?:unknown}}){
  await this.preflight(c,policy);
  if(!scriptId)throw new ConfigurationError(409,'请先上传并确认主脚本。');
  const materials=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1',[episodeId])).rows;
  for(const m of materials)await verifyEpisodeFile(c,root,episodeId,m.storage_path,m.sha256,Number(m.file_size));
  const episode=(await c.query('SELECT to_jsonb(public.start_episode_production($1)) result',[episodeId])).rows[0].result;
  await c.query('UPDATE local_identity.input_episodes SET enabled=false,visual_media_enabled=$2 WHERE episode_id=$1',[episodeId,Boolean(policy.static_visual?.executor)]);
  return episode;
 }
 private async preflight(c:PoolClient,policy:Record<string,unknown>){
  const failure=(reason:string,check:string,scope:WorkerPreflightCheck['scope'],action:WorkerPreflightCheck['action'],status=409)=>new ConfigurationError(status,reason,{version:workerPreflightVersion,checks:[{capability:'worker_runtime',check,phase:'preflight',status:scope==='worker'?'unavailable':'blocked',reason,action,scope}]});
  let root:string;
  try{root=await resolveLocalAssetRoot(c,this.mediaRoot,policy.asset_root);await verifyMediaLibrary({mediaRootBinding:(await c.query("SELECT local_identity.media_deployment()->'binding' binding")).rows[0].binding,assetRoot:root,mountPath:this.runtime.mountPath,minimumFreeBytes:this.runtime.minimumFreeBytes,requireEpisodesDirectory:false});}catch(e){throw failure(e instanceof Error?e.message:'素材目录不可用。','asset_root','episode','manage_account_directory');}
 }
}
