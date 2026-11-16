import {localExportActivity,type LocalExportActivity} from './productionLocalExport.js';
import {recordValidatedRequestLogContext} from './runtimeRequestLog.js';
import {validateImportedMaterial} from './materialAcceptance.js';
import{RuntimePreparationError}from'../orchestration/runtimeBuild.js';
import {setProductionQuality} from './productionQuality.js';
import {createEpisodeDirectory} from './episodeCreation.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {episodeStorageLocationAtRoot,requireWritableEpisodeStorage,resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {requireAccountAssetRoot,resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {productionWorkspaceFields} from '../productionWorkspace.js';
import {ProductionWorkspaceCommands} from './productionWorkspaceCommands.js';
import {reconfirmScript} from './scriptRevisionCommands.js';
import {parseStoryboardScript} from '../reviews/productionScript.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import{executeWanCommand}from'./wanCommands.js';
import{resolveLocalAssetRoot}from'./mediaDeployment.js';
import{NativeDeliveryCommands}from'./deliveryCommands.js';
import {NativeStudioCommands} from './studioCommands.js';
import {openStandaloneOpenChatCutStudio,closeStandaloneOpenChatCutStudio,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,validateConfigurationPolicy,canonicalFingerprint} from './configurationCommands.js';
import {snapshotInput} from './localFiles.js';
import {verifyMediaLibrary} from '../worker/mediaLibrary.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname} from 'node:path';
import {blueprintSelectionErrors} from '../worker/runtimePreflight.js';
import {mediaCapabilityKeys} from '../worker/productionCapabilities.js';
import {workerPreflightVersion,type WorkerPreflightCheck} from '../worker/contracts.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const retiredPlanningCommands=new Set(['review','annotateStoryboard','planStoryboard','requestStructureRevision','requestStudioStoryboardRevision','saveWorkspacePlanningSelection','retryWorkspacePlanning']);
export interface InputRuntime {localExportActivity?:LocalExportActivity;openDirectory?(path:string):Promise<void>;deliveryReady?():Promise<void>;studioRuntime?():Promise<OpenChatCutRuntimeConfig>;ready():Promise<void>;narrationReady?():Promise<void>;mediaReady?(policy:Record<string,unknown>):Promise<void>;localClipReady?():Promise<void>;postReady?(kind:'source'|'alignment'|'preview'):Promise<void>;wake(episodeId:string):void;mountPath:string;minimumFreeBytes:number;checkReferences(client:PoolClient,refs:string[],options?:{purpose?:'workspace-generation'}):Promise<void>}
export class LocalEpisodeCommands {
 private exports=localExportActivity();
 activeLocalExports(ownerId:string){return this.exports.count(ownerId);}
 private workspace=new ProductionWorkspaceCommands();
 private studios=new NativeStudioCommands();
 private delivery=new NativeDeliveryCommands();
 private standaloneStudios=new Set<string>();
 private scriptStore:ScriptProductionStore;
 closeStudio(episodeId:string){return Promise.all([this.studios.closeEpisode(episodeId),this.workspace.closeEpisode(episodeId)]).then(()=>{});}
 async close(){await Promise.all([this.studios.close(),this.workspace.close(),...[...this.standaloneStudios].map(root=>closeStandaloneOpenChatCutStudio(root))]);this.standaloneStudios.clear();}
 constructor(private pool:Pool,private mediaRoot:string,private runtime:InputRuntime){this.runtime={...runtime,localExportActivity:this.exports};this.scriptStore=new ScriptProductionStore();}
 async execute(session:OwnerSession,body:Record<string,unknown>){return this.executeCommand(session,body,run=>sessionTransaction(this.pool,session,run));}
 private async executeCommand(session:{id:string},body:Record<string,unknown>,transaction:<T>(run:(c:PoolClient)=>Promise<T>)=>Promise<T>){
  if(typeof body.command!=='string'||!retiredPlanningCommands.has(body.command)&&!Object.hasOwn(productionWorkspaceFields,body.command)&&!['generateOfficialVideo','generateWan','resumeWan','annotateAudio','requestQcMemberRevision','repairConnection','repairConfiguration','create','setProductionQuality','start','reconfirmScript','importMaterial','openDirectory','openStandaloneStudio','saveTtsSettings','saveTtsDraft','generateTts','registerManualMedia','saveAudioSelection','planMedia','retryMedia','saveMediaDraft','generateClip','setAudioSourceMode','generateSourceAudio','requestAlignment','saveManualAlignment','confirmCaptionText','generateSyncPreview','confirmSyncPreview','openStudio','saveStudio','generateReviewVideo','submitStudioRevision','requestStudioCompositionRevision','createQcIssue','resolveQcIssue','approveQc','retryFinalRender','preparePublishPackage'].includes(body.command)||typeof body.idempotencyKey!=='string'||!/^[0-9a-f-]{36}$/.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k)))throw new ConfigurationError(400,'Episode命令无效。');
  const data=body.data as Record<string,unknown>,hash=canonicalFingerprint(body);
  const retiredNarration=body.command==='generateTts';
  const retiredExecution=['repairConfiguration','repairConnection'].includes(body.command);
  const retiredPlanning=retiredPlanningCommands.has(body.command)||body.command==='replanWorkspace'&&Object.hasOwn(data,'planningTaskId');
  const allowed:Record<string,string[]>={create:['accountId','title','seriesVersionId','isTest','businessQualityTier'],importMaterial:['episodeId','sourceKind','sourcePath','logicalName','materialType','materialPurpose','mimeType','isMainScript','contentBase64','deferRefresh'],openDirectory:['episodeId']};
  allowed.setProductionQuality=['episodeId','tier','expectedRevision'];
  allowed.start=['episodeId'];
  allowed.reconfirmScript=['episodeId','expectedScriptRevisionId','text','reason'];
  allowed.saveTtsSettings=['episodeId','languageCode','voice','speakingRate'];allowed.saveTtsDraft=['episodeId','reviewPackageId','shotId','audioMode','subtitleText','subtitlesEnabled','ttsText','ttsVoice','ttsSpeakingRate','ttsOverride','captionContract','bgmDuckingLevel','transitionMode'];allowed.generateTts=['episodeId','reviewPackageId','shotId','retry'];
  allowed.setAudioSourceMode=['episodeId','audioSourceMode'];allowed.registerManualMedia=['episodeId','materialRevisionId','targetId','storyboardReviewPackageId','kind','clipStartSeconds','clipEndSeconds','replace'];allowed.saveAudioSelection=['episodeId','reviewPackageId','targetKind','targetId','audioKind','cueId','materialRevisionId'];allowed.planMedia=['episodeId','reviewPackageId'];allowed.retryMedia=['episodeId','reviewPackageId','taskId'];allowed.generateClip=['episodeId','reviewPackageId','shotId','retry'];allowed.saveMediaDraft=['episodeId','reviewPackageId','shotId','materialRevisionId','clipSegments','composition','sourceVideoDurationSeconds','audioMode','subtitleText','subtitlesEnabled','ttsText','ttsVoice','ttsSpeakingRate','ttsOverride','captionContract','bgmDuckingLevel','transitionMode'];
  allowed.generateSourceAudio=['episodeId','reviewPackageId','shotId','retry'];allowed.requestAlignment=['episodeId','reviewPackageId','shotId','localOnly'];allowed.saveManualAlignment=['episodeId','reviewPackageId','shotId','cues'];allowed.confirmCaptionText=['episodeId','reviewPackageId','shotId','audioTrackId','audioSha256','textFingerprint','alignmentInputVersion'];allowed.generateSyncPreview=['episodeId','reviewPackageId','shotId'];allowed.confirmSyncPreview=['episodeId','reviewPackageId','shotId','deviationResolution'];
  allowed.saveStudio=['episodeId','sourceProjectRelativePath','workspaceRelativePath','projectId','expectedWorkspaceSha256'];allowed.openStandaloneStudio=[];allowed.openStudio=['episodeId','projectRelativePath','replaceWorkspace'];allowed.generateReviewVideo=['episodeId','reviewPackageId','sourceProjectRelativePath','workspaceRelativePath','acceptDurationRisk','riskReason'];allowed.submitStudioRevision=['episodeId','reviewPackageId','sourceProjectRelativePath','workspaceRelativePath','reason'];allowed.requestStudioCompositionRevision=['episodeId','reviewPackageId','reason'];
  allowed.createQcIssue=['episodeId','reviewPackageId','memberKey','atSeconds','severity','reason'];allowed.resolveQcIssue=['episodeId','reviewPackageId','issueId','status'];allowed.approveQc=['episodeId','reviewPackageId','reason'];allowed.retryFinalRender=['episodeId','reviewPackageId','reason'];allowed.preparePublishPackage=['episodeId','title','description','tags','coverBase64'];
  allowed.generateOfficialVideo=['episodeId','reviewPackageId','shotId','firstFrameId','prompt','durationSeconds','reservationCents'];allowed.generateWan=['episodeId','reviewPackageId','shotId','firstFrameId','prompt','durationSeconds'];allowed.resumeWan=['episodeId','taskId'];
  allowed.annotateAudio=['episodeId','audioTrackId','atSeconds','reason'];allowed.requestQcMemberRevision=['episodeId','issueId'];
  
  Object.assign(allowed,productionWorkspaceFields);
  if(!retiredPlanning&&!retiredNarration&&!retiredExecution&&Object.keys(data).some(k=>!allowed[body.command as string].includes(k)))throw new ConfigurationError(400,'Episode字段无效。');
  recordValidatedRequestLogContext({operation:'episode.'+body.command});
  if(body.command==='create'){
   const created=await createEpisodeDirectory(this.pool,session as OwnerSession,body.idempotencyKey,hash,data,this.mediaRoot,(c,account,policy)=>this.preflight(c,account,policy,false,'input'));
   recordValidatedRequestLogContext({episodeId:String(created.id)});return created;
  }
  const result=await transaction(async c=>{
   if(retiredPlanning||retiredNarration||retiredExecution){
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    if(!(await c.query("SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[data.episodeId,session.id])).rowCount)throw new ConfigurationError(404,'本地生产单不可见。');
    recordValidatedRequestLogContext({episodeId:data.episodeId});
    throw new ConfigurationError(410,retiredExecution?'旧任务修复与自动续跑已退役，请使用当前制作工作区。':retiredNarration?'旧口播生成入口已退役，请在分镜台选择本次制作服务。':'旧视觉与分镜规划已退役，请使用当前制作流程。');
   }
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+body.idempotencyKey]);
   const old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,body.idempotencyKey])).rows[0];
   if(old){
    if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');
    if(!['openDirectory','openStudio','openStandaloneStudio','openWorkspaceStudio'].includes(body.command as string)){
     // The matching Owner receipt proves the original result, without re-running
     // its command or attributing an unverified identity from the new request.
     if(old.result?.episodeId===data.episodeId)recordValidatedRequestLogContext({episodeId:old.result.episodeId,workspaceId:old.result.id});
     else if(old.result?.id===data.episodeId)recordValidatedRequestLogContext({episodeId:old.result.id});
     return old.result;
    }
   }
   let value;
   if(body.command==='setProductionQuality'){
    value=await setProductionQuality(c,data.episodeId,data.tier,data.expectedRevision);
    recordValidatedRequestLogContext({episodeId:String(data.episodeId)});
   }else if(body.command==='openStandaloneStudio'){
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
    if(['importLegacyDraftInputs','adoptLegacyWorkspace','adoptLegacyPlan','prepareWorkspace','reconfirmScript','importMaterial'].includes(String(body.command))&&!(await c.query('SELECT 1 FROM local_identity.input_episodes WHERE episode_id=$1',[data.episodeId])).rowCount){
     if(!(await c.query('SELECT local_identity.lock_owned_episode_cleanup($1) owned',[data.episodeId])).rows[0].owned)throw new ConfigurationError(404,'本地生产单不可见。');
     const legacy=(await c.query('SELECT stage,archived_at FROM public.episodes WHERE id=$1',[data.episodeId])).rows[0];
     if(legacy.archived_at||legacy.stage==='production_completed')throw new ConfigurationError(409,'历史或已完成生产单只读。');
     await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[data.episodeId,session.id]);
    }
    if(!(await c.query('SELECT local_identity.lock_owned_input_episode($1) owned',[data.episodeId])).rows[0].owned)throw new ConfigurationError(404,'本地生产单不可见。');
    const e=(await c.query('SELECT e.*,b.policy,i.storyboard_enabled,i.script_template_version FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE e.id=$1 AND m.user_id=$2 AND m.role=\'owner\' AND i.owner_id=$2',[data.episodeId,session.id])).rows[0];
    if(!e)throw new ConfigurationError(404,'本地生产单不可见。');
    recordValidatedRequestLogContext({accountId:e.account_id,episodeId:e.id});
    const inputIo=['importMaterial','reconfirmScript','prepareWorkspace','adoptLegacyPlan','importLegacyDraftInputs'].includes(String(body.command)),location=inputIo?await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id):null;
    if(location)await requireEpisodeStorageDirectory(c,location);
    const root=location?.assetRoot??await resolveEpisodeAssetRoot(c,this.mediaRoot,e.id);
    if(body.command!=='openDirectory'){
     if((await c.query('SELECT 1 FROM local_identity.account_asset_directories WHERE account_id=$1',[e.account_id])).rowCount)await requireAccountAssetRoot(c,this.mediaRoot,e.account_id);
     else{const legacy=location??await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id);if(legacy.layoutVersion!==1)throw new ConfigurationError(409,'账号目录未登记，请先恢复存储位置。');await requireEpisodeStorageDirectory(c,legacy);if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying'",[e.account_id])).rowCount)throw new ConfigurationError(409,'账号正在纳管，请先恢复或回滚原操作。');}
    }
    const inputPolicy=[2,3].includes(e.script_template_version)?{...e.policy,asset_root:root,static_visual:{execution_path:'manual'},soundtrack:{execution_path:'manual'}}:{...e.policy,asset_root:root};
    if(body.command==='reconfirmScript'&&this.workspace.isOpen(e.id))throw new ConfigurationError(409,'请先保存并返回，再修订脚本或分镜。');
    if(['approveQc','retryFinalRender','preparePublishPackage','generateReviewVideo','submitStudioRevision','confirmSyncPreview'].includes(String(body.command))&&(await c.query('SELECT 1 FROM local_identity.production_workspaces WHERE episode_id=$1',[e.id])).rowCount)throw new ConfigurationError(409,'此生产单使用四步制作，请在当前工程检查与交付。');
    if(Object.hasOwn(productionWorkspaceFields,String(body.command))){value=await this.workspace.execute(c,e,root,this.runtime,String(body.command),data);
    }else if(['generateOfficialVideo','generateWan','resumeWan'].includes(String(body.command))){value=await executeWanCommand(c,e,root,this.runtime,String(body.command),data,body.idempotencyKey as string);
    }else if(['createQcIssue','resolveQcIssue','approveQc','retryFinalRender','preparePublishPackage'].includes(String(body.command))){value=await this.delivery.execute(c,e,root,this.runtime,String(body.command),data);
    }else if(['openStudio','saveStudio','generateReviewVideo','submitStudioRevision','requestStudioCompositionRevision'].includes(String(body.command))){
     if(['openStudio','generateReviewVideo'].includes(String(body.command))){const drafts=(await c.query("SELECT d.* FROM public.shot_preparation_drafts d WHERE d.episode_id=$1 AND d.review_package_id=(SELECT id FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1)",[e.id])).rows;for(const draft of drafts)await this.requireCaptionTextReview(c,draft);}
     try{value=await this.studios.execute(c,e,root,this.runtime,String(body.command),data);}catch(error){if(error instanceof ConfigurationError||error&&typeof error==='object'&&'code'in error)throw error;throw new ConfigurationError(409,'Studio 工作版本或编辑器会话不可用，请重新打开当前工程后重试。');}
    }else if(['annotateAudio','requestQcMemberRevision'].includes(String(body.command))){
     const visible=async(table:'audio_tracks'|'review_packages'|'qc_review_issues',id:unknown)=>{if(typeof id!=='string'||!uuid.test(id))throw new ConfigurationError(400,'审核对象标识无效。');if(!(await c.query(table==='qc_review_issues'?'SELECT 1 FROM public.qc_review_issues q JOIN public.review_packages p ON p.id=q.review_package_id WHERE q.id=$1 AND p.episode_id=$2':`SELECT 1 FROM public.${table} WHERE id=$1 AND episode_id=$2`,[id,e.id])).rowCount)throw new ConfigurationError(404,'审核对象不属于当前生产单。');};
     if(body.command==='annotateAudio'){
      if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000||typeof data.atSeconds!=='number'||!Number.isFinite(data.atSeconds)||data.atSeconds<0)throw new ConfigurationError(400,'音轨批注无效。');await visible('audio_tracks',data.audioTrackId);value=(await c.query('SELECT to_jsonb(public.create_audio_track_annotation($1,$2,$3)) result',[data.audioTrackId,data.atSeconds,data.reason])).rows[0].result;
     }else if(body.command==='requestQcMemberRevision'){
      await visible('qc_review_issues',data.issueId);await this.preflight(c,e.account_id,inputPolicy,true);value=(await c.query('SELECT to_jsonb(public.request_qc_member_revision($1)) result',[data.issueId])).rows[0].result;
     }
    }else if(body.command==='reconfirmScript'){
     value=await reconfirmScript(c,root,e,data,location!.relativePath);
    }else if(body.command==='importMaterial'){
     if(data.isMainScript&&(e.stage!=='waiting_input'||e.main_script_revision_id))throw new ConfigurationError(409,'主脚本已确认或制作已开始，不能替换。');
     const purposes=['main_script','supplemental_script','general_reference','visual_reference','a_roll','b_roll','narration','background_music','sound_effect','cover'];
     if(!purposes.includes(String(data.materialPurpose))||typeof data.materialType!=='string'||typeof data.mimeType!=='string'||typeof data.isMainScript!=='boolean')throw new ConfigurationError(400,'材料类型无效。');
     if(typeof data.sourceKind!=='string'||typeof data.sourcePath!=='string'||data.logicalName!==undefined&&typeof data.logicalName!=='string')throw new ConfigurationError(400,'材料路径无效。');
     let mimeType=data.mimeType;
     const snapshot=await snapshotInput(root,e.id,data as never,location!.relativePath,async bytes=>{mimeType=await validateImportedMaterial(bytes,data as never);});
     const previous=!data.isMainScript?(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND material_type=$2 AND source_path=$3 ORDER BY revision_number DESC LIMIT 1',[e.id,data.materialType.trim(),snapshot.sourcePath.trim()])).rows[0]:undefined;
     // Reusing the same validated bytes is not a source revision. In particular,
     // another shot uploading the same reference must not invalidate paid work.
     const unchanged=previous&&!previous.is_main_script&&previous.source_kind===data.sourceKind&&previous.material_purpose===data.materialPurpose&&previous.mime_type===mimeType&&previous.sha256===snapshot.sha256&&Number(previous.file_size)===snapshot.fileSize&&previous.storage_path===snapshot.storagePath;
     value=unchanged?previous:(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) result',[e.id,data.materialType,data.sourceKind,snapshot.sourcePath,snapshot.storagePath,mimeType,snapshot.sha256,snapshot.fileSize,data.isMainScript,data.materialPurpose])).rows[0].result;
     if(data.isMainScript)await c.query('UPDATE local_identity.input_episodes SET script_template_version=$2 WHERE episode_id=$1',[e.id,parseStoryboardScript((await verifyEpisodeFile(c,root,e.id,snapshot.storagePath,snapshot.sha256,snapshot.fileSize)).toString('utf8'))?.version??null]);
     if(!data.isMainScript)await this.scriptStore.alias(c,session.id,value.id,String(data.sourcePath));
    }else if(body.command==='setAudioSourceMode'){
     if(!['source','tts'].includes(String(data.audioSourceMode)))throw new ConfigurationError(400,'声音来源无效。');value=(await c.query('SELECT to_jsonb(public.set_episode_audio_source_mode($1,$2)) result',[e.id,data.audioSourceMode])).rows[0].result;
    }else if(body.command==='start'){
     await this.preflight(c,e.account_id,inputPolicy,true,'input');
     const materials=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1',[e.id])).rows;
     if(!e.main_script_revision_id)throw new ConfigurationError(409,'请先上传并确认主脚本。');
     for(const m of materials)await verifyEpisodeFile(c,root,e.id,m.storage_path,m.sha256,Number(m.file_size));
     value=(await c.query('SELECT to_jsonb(public.start_episode_production($1)) result',[e.id])).rows[0].result;
     await c.query('UPDATE local_identity.input_episodes SET enabled=false,visual_media_enabled=$2 WHERE episode_id=$1',[e.id,Boolean(inputPolicy.static_visual?.executor)]);
    }else if(['generateSourceAudio','requestAlignment','saveManualAlignment','confirmCaptionText','generateSyncPreview','confirmSyncPreview'].includes(String(body.command))){
     await requireEpisodeStorageDirectory(c,await episodeStorageLocationAtRoot(c,root,e.id));
     if(!['storyboard_approved','production_ready','render_ready','qc_review'].includes(e.stage)||!e.storyboard_enabled)throw new ConfigurationError(409,'请先批准当前分镜。');
     const p=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
     if(!p||p.id!==data.reviewPackageId)throw new ConfigurationError(409,'审核包已变化，请刷新。');
     const verify=async(path:string,hash:string,size:number)=>{try{await verifyEpisodeFile(c,root,e.id,path,hash,size);}catch{throw new ConfigurationError(409,'当前文件缺失或指纹不一致，请检查隔离媒体目录。');}};
     const file=async(id:unknown)=>{const f=(await c.query('SELECT * FROM public.artifacts WHERE id=$1 AND episode_id=$2',[id,e.id])).rows[0];if(!f)throw new ConfigurationError(409,'当前产物缺失。');await verify(f.relative_path,f.sha256,Number(f.file_size));return f;};
     await file(p.artifact_id);
     if(typeof data.shotId!=='string'||!data.shotId.trim())throw new ConfigurationError(400,'镜头标识无效。');
     const d=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[e.id,p.id,data.shotId])).rows[0];if(!d)throw new ConfigurationError(409,'请先保存镜头草稿。');
     const verifyTask=async(t:{id:string;input_snapshot:Record<string,unknown>;status:string})=>{const inputs=(t.input_snapshot.input_artifacts??[]) as Array<{relativePath:string;sha256:string;fileSize:number}>;for(const f of inputs)await verify(f.relativePath,f.sha256,Number(f.fileSize));if(t.status==='completed'){const outputs=(await c.query('SELECT * FROM public.artifacts WHERE producer_task_id=$1 AND episode_id=$2',[t.id,e.id])).rows;if(!outputs.length)throw new ConfigurationError(409,'复用产物缺失。');for(const f of outputs)await file(f.id);}};
     const track=async()=>{const t=(await c.query('SELECT * FROM public.audio_tracks WHERE id=$1 AND episode_id=$2',[d.current_audio_track_id,e.id])).rows[0];if(!t)throw new ConfigurationError(409,'请先提取原声或选择当前成功音轨。');await verify(t.relative_path,t.sha256,Number(t.file_size));return t;};
     if(['generateSourceAudio','requestAlignment','generateSyncPreview'].includes(String(body.command)))await requireWritableEpisodeStorage(c,root,e.id,this.runtime.minimumFreeBytes??0);
     if(body.command==='generateSourceAudio'){
      if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new ConfigurationError(400,'重试参数无效。');if(d.video_status!=='ready')throw new ConfigurationError(409,'请先生成当前镜头片段，再提取原声。');await this.requirePost('source');await file(d.current_video_artifact_id);
      await c.query('UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=$1',[e.id]);
      value=(await c.query('SELECT to_jsonb(public.generate_shot_source_audio($1,$2,$3,false)) result',[e.id,p.id,data.shotId])).rows[0].result;
      if(data.retry===true&&['failed','blocked'].includes(value.status))value=(await c.query('SELECT to_jsonb(local_identity.retry_input_media($1,$2)) result',[e.id,value.id])).rows[0].result;
     }else if(body.command==='requestAlignment'){
      if(data.localOnly!==undefined&&typeof data.localOnly!=='boolean')throw new ConfigurationError(400,'对齐策略无效。');await track();await this.requirePost('alignment');await c.query('UPDATE local_identity.input_episodes SET alignment_enabled=true WHERE episode_id=$1',[e.id]);
      value=(await c.query('SELECT to_jsonb(public.request_shot_acoustic_alignment($1,$2,$3,$4)) result',[e.id,p.id,data.shotId,data.localOnly??false])).rows[0].result;
     }else if(body.command==='saveManualAlignment'){
      const t=await track(),duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,e.id),t.relative_path));
      if(!Array.isArray(data.cues)||!data.cues.length||data.cues.length>1000||data.cues.some(x=>!x||typeof x!=='object'||Object.keys(x).some(k=>!['id','text','start_ms','end_ms'].includes(k))||typeof x.end_ms!=='number'||x.end_ms>Math.round(duration*1000)+1))throw new ConfigurationError(400,'人工字幕时序无效或超出实际音频。');
      await c.query('SELECT public.save_shot_manual_alignment($1,$2,$3,$4)',[e.id,p.id,data.shotId,JSON.stringify(data.cues)]);value={saved:true};
     }else if(body.command==='confirmCaptionText'){
      if(typeof data.audioTrackId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.audioTrackId)||['audioSha256','textFingerprint','alignmentInputVersion'].some(k=>typeof data[k]!=='string'||!/^[0-9a-f]{64}$/.test(data[k] as string)))throw new ConfigurationError(400,'正文核对身份无效。');
      const t=await track(),alignment=d.acoustic_alignment;
      if(d.audio_mode==='none'||!d.subtitles_enabled||!d.subtitle_text?.trim()||d.current_audio_track_id!==data.audioTrackId||t.sha256!==data.audioSha256||createHash('sha256').update(d.subtitle_text).digest('hex')!==data.textFingerprint||alignment?.inputVersion!==data.alignmentInputVersion||alignment?.textFingerprint!==data.textFingerprint||alignment?.audioSha256!==data.audioSha256)throw new ConfigurationError(409,'音频、正文或对齐输入已变化，请刷新后重新核对。');
      try{value=(await c.query('SELECT local_identity.confirm_caption_text($1,$2,$3,$4,$5,$6,$7) result',[e.id,p.id,data.shotId,data.audioTrackId,data.audioSha256,data.textFingerprint,data.alignmentInputVersion])).rows[0].result;}
      catch(error){if((error as {code?:string}).code==='40001')throw new ConfigurationError(409,'音频、正文或对齐输入已变化，请刷新后重新核对。');throw error;}
     }else if(body.command==='generateSyncPreview'){
      await this.requireCaptionTextReview(c,d);
      await this.requirePost('preview');await c.query('UPDATE local_identity.input_episodes SET preview_enabled=true WHERE episode_id=$1',[e.id]);
      value=(await c.query('SELECT to_jsonb(t) result FROM public.generate_shot_sync_preview($1,$2,$3) t',[e.id,p.id,data.shotId])).rows[0]?.result;if(!value)throw new ConfigurationError(409,'没有可生成的同步预览。');
     }else{
      await this.requireCaptionTextReview(c,d);
      if(!['none','confirmation_reason','episode_exception'].includes(String(data.deviationResolution??'none')))throw new ConfigurationError(400,'偏离处理方式无效。');
      const t=(await c.query('SELECT * FROM public.tasks WHERE id=$1 AND episode_id=$2',[d.current_preview_task_id,e.id])).rows[0];if(!t||t.status!=='completed')throw new ConfigurationError(409,'请先完成当前同步预览。');await verifyTask(t);await file(d.current_preview_artifact_id);await file(d.current_preview_project_artifact_id);
      value=(await c.query("SELECT to_jsonb(public.confirm_shot_sync_preview($1,$2,$3,'',$4)) result",[e.id,p.id,data.shotId,data.deviationResolution??'none'])).rows[0].result;
     }
     if(['generateSourceAudio','requestAlignment','generateSyncPreview'].includes(String(body.command))){value=(await c.query('SELECT to_jsonb(local_identity.scope_input_post_task($1)) result',[value.id])).rows[0].result;await verifyTask(value);}
    }else if(['registerManualMedia','saveAudioSelection','planMedia','retryMedia','saveMediaDraft','generateClip'].includes(String(body.command))){
     if(!['storyboard_approved','production_ready','render_ready','qc_review'].includes(e.stage)||!e.storyboard_enabled)throw new ConfigurationError(409,'请先批准当前分镜。');
     const p=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
     if(!p||p.id!==(data.reviewPackageId??data.storyboardReviewPackageId))throw new ConfigurationError(409,'审核包已变化，请刷新。');
     const artifact=(await c.query('SELECT * FROM public.artifacts WHERE id=$1 AND episode_id=$2',[p.artifact_id,e.id])).rows[0];if(!artifact)throw new ConfigurationError(409,'分镜产物缺失。');await verifyEpisodeFile(c,root,e.id,artifact.relative_path,artifact.sha256,Number(artifact.file_size));
     const material=async(id:unknown)=>{const m=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[id,e.id])).rows[0];if(!m)throw new ConfigurationError(404,'材料不可见。');await verifyEpisodeFile(c,root,e.id,m.storage_path,m.sha256,Number(m.file_size));return m;};
     if(body.command==='registerManualMedia'){
      if(!['a_roll','b_roll','narration','bgm','sfx'].includes(String(data.kind)))throw new ConfigurationError(400,'人工素材类型无效。');
      const m=await material(data.materialRevisionId),purpose={a_roll:'a_roll',b_roll:'b_roll',narration:'narration',bgm:'background_music',sfx:'sound_effect'}[String(data.kind)];
      if(m.material_purpose!==purpose)throw new ConfigurationError(400,'材料用途与绑定类型不一致。');
      if(['a_roll','b_roll'].includes(String(data.kind))){
       if(typeof data.clipStartSeconds!=='number'||typeof data.clipEndSeconds!=='number'||!Number.isFinite(data.clipStartSeconds)||!Number.isFinite(data.clipEndSeconds))throw new ConfigurationError(400,'片段区间无效。');
       const video=await inspectMp4Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,e.id),m.storage_path));if(data.clipEndSeconds>video.durationSeconds+0.05)throw new ConfigurationError(409,'片段超出实际视频时长。');
       value=(await c.query('SELECT to_jsonb(public.save_manual_shot_clip($1,$2,$3,$4,$5,$6,$7)) result',[e.id,m.id,data.targetId,p.id,data.kind,data.clipStartSeconds,data.clipEndSeconds])).rows[0].result;
      }else{
       const duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,e.id),m.storage_path));const board=p.context_snapshot.worker_result.storyboard;const target=data.kind==='narration'?board.shots.find((x:{id:string})=>x.id===data.targetId):board.audioCues.find((x:{id:string;kind:string})=>x.id===data.targetId&&x.kind===data.kind);
       const required=data.targetId===e.id&&data.kind==='narration'?board.shots.reduce((sum:number,x:{durationSeconds:number})=>sum+x.durationSeconds,0):target?.durationSeconds;
       if(!required||duration+0.05<required)throw new ConfigurationError(409,'人工音频时长不足或目标无效。');
       value=(await c.query(data.kind==='narration'&&data.targetId===e.id?'SELECT to_jsonb(public.register_manual_episode_narration($1,$2,$3)) result':'SELECT to_jsonb(public.register_manual_audio($1,$2,$4,$3)) result',data.kind==='narration'&&data.targetId===e.id?[e.id,m.id,p.id]:[e.id,m.id,p.id,data.targetId])).rows[0].result;
      }
     }else if(body.command==='saveAudioSelection'){
      if(data.materialRevisionId){const m=await material(data.materialRevisionId);await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,e.id),m.storage_path));}
      value=(await c.query('SELECT to_jsonb(public.save_storyboard_audio_selection($1,$2,$3,$4,$5,$6,$7)) result',[e.id,p.id,data.targetKind,data.targetId,data.audioKind,data.cueId??null,data.materialRevisionId??null])).rows[0].result;
     }else if(body.command==='saveMediaDraft'){
      if(!['source','tts','none'].includes(String(data.audioMode))||typeof data.subtitleText!=='string'||typeof data.subtitlesEnabled!=='boolean')throw new ConfigurationError(400,'镜头草稿无效。');
      const m=await material(data.materialRevisionId),video=await inspectMp4Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,e.id),m.storage_path));if(typeof data.sourceVideoDurationSeconds!=='number'||Math.abs(video.durationSeconds-data.sourceVideoDurationSeconds)>0.1)throw new ConfigurationError(409,'源视频时长与文件不一致。');
      value=(await c.query('SELECT to_jsonb(public.save_shot_workbench_composition_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)) result',[e.id,p.id,data.shotId,m.id,JSON.stringify(data.clipSegments),data.composition,data.sourceVideoDurationSeconds,data.audioMode,data.subtitleText,data.subtitlesEnabled,data.ttsText??null,data.ttsVoice??null,data.ttsSpeakingRate??null])).rows[0].result;
      if(data.captionContract!==undefined)await c.query('SELECT public.save_shot_caption_contract($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.captionContract]);
      if(data.ttsOverride!==undefined){const o=data.ttsOverride as {voice?:unknown;speakingRate?:unknown};if(!o||typeof o!=='object'||Object.keys(o).some(k=>!['voice','speakingRate'].includes(k)))throw new ConfigurationError(400,'镜头声音覆盖无效。');await c.query('SELECT public.save_shot_tts_override($1,$2,$3,$4,$5)',[e.id,p.id,data.shotId,o.voice??null,o.speakingRate??null]);}
      if(data.bgmDuckingLevel!==undefined)await c.query('SELECT public.save_shot_audio_mix($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.bgmDuckingLevel]);
      if(data.transitionMode!==undefined)await c.query('SELECT public.save_shot_transition_mode($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.transitionMode]);
     }else{
      const localClip=body.command==='generateClip'&&(await c.query('SELECT media_enabled FROM local_identity.input_episodes WHERE episode_id=$1 FOR UPDATE',[e.id])).rows[0]?.media_enabled===true;
      if(localClip){await this.preflight(c,e.account_id,inputPolicy,true,'local_clip');try{if(!this.runtime.localClipReady)throw Error();await this.runtime.localClipReady();}catch(error){if(error instanceof RuntimePreparationError)throw error;throw new ConfigurationError(503,'本地剪辑执行器尚未就绪。');}}
      else{await this.preflight(c,e.account_id,inputPolicy,true);await this.requireMedia(inputPolicy);}
      if(!localClip)await c.query('UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=$1',[e.id]);
      if(body.command==='retryMedia')value=(await c.query('SELECT to_jsonb(local_identity.retry_input_media($1,$2)) result',[e.id,data.taskId])).rows[0].result;
      else if(body.command==='generateClip'){
       if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new ConfigurationError(400,'重试参数无效。');
       const draft=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[e.id,p.id,data.shotId])).rows[0];if(!draft)throw new ConfigurationError(409,'请先保存镜头草稿。');await material(draft.selected_material_revision_id);
       value=(await c.query('SELECT to_jsonb(public.generate_shot_clip($1,$2,$3,$4)) result',[e.id,p.id,data.shotId,false])).rows[0].result;if(data.retry===true&&['failed','blocked'].includes(value.status))value=(await c.query('SELECT to_jsonb(local_identity.retry_input_media($1,$2)) result',[e.id,value.id])).rows[0].result;
       if(value.status==='completed'){const files=(await c.query('SELECT * FROM public.artifacts WHERE episode_id=$1 AND producer_task_id=$2',[e.id,value.id])).rows;try{if(!files.length)throw Error();for(const f of files)await verifyEpisodeFile(c,root,e.id,f.relative_path,f.sha256,Number(f.file_size));}catch{throw new ConfigurationError(409,'复用片段缺失或指纹不一致。');}}
      }else value={id:e.id,queued:true};
     }
    }else if(['saveTtsSettings','saveTtsDraft'].includes(String(body.command))){
     if(body.command!=='saveTtsSettings'&&(!['storyboard_approved','production_ready','render_ready','qc_review'].includes(e.stage)||!e.storyboard_enabled))throw new ConfigurationError(409,'请先批准当前分镜。');
     if(body.command==='saveTtsSettings'){
      if(typeof data.languageCode!=='string'||typeof data.voice!=='string'||typeof data.speakingRate!=='number'||!Number.isFinite(data.speakingRate)||data.voice.length>200)throw new ConfigurationError(400,'本期TTS设置无效。');
      value=(await c.query('SELECT to_jsonb(public.save_episode_tts_settings($1,$2,$3,$4)) result',[e.id,data.languageCode,data.voice,data.speakingRate])).rows[0].result;
     }else{
      const p=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
      if(!p||p.id!==data.reviewPackageId)throw new ConfigurationError(409,'审核包已变化，请刷新。');
      const a=(await c.query('SELECT * FROM public.artifacts WHERE id=$1 AND episode_id=$2',[p.artifact_id,e.id])).rows[0];if(!a)throw new ConfigurationError(409,'分镜产物缺失。');await verifyEpisodeFile(c,root,e.id,a.relative_path,a.sha256,Number(a.file_size));
      if(!['tts','source','none'].includes(String(data.audioMode))||typeof data.subtitleText!=='string'||data.subtitleText.length>100000||typeof data.subtitlesEnabled!=='boolean'||data.ttsText!==null&&typeof data.ttsText!=='string')throw new ConfigurationError(400,'口播文本草稿无效。');
      value=(await c.query('SELECT to_jsonb(public.save_shot_preparation_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)) result',[e.id,p.id,data.shotId,data.audioMode,data.subtitleText,data.subtitlesEnabled,data.ttsText,data.ttsVoice??null,data.ttsSpeakingRate??null])).rows[0].result;
      if(data.ttsOverride!==undefined){const o=data.ttsOverride as {voice?:unknown;speakingRate?:unknown};if(!o||typeof o!=='object'||Object.keys(o).some(k=>!['voice','speakingRate'].includes(k)))throw new ConfigurationError(400,'镜头声音覆盖无效。');await c.query('SELECT public.save_shot_tts_override($1,$2,$3,$4,$5)',[e.id,p.id,data.shotId,o.voice??null,o.speakingRate??null]);}
      if(data.captionContract!==undefined)await c.query('SELECT public.save_shot_caption_contract($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.captionContract]);
      if(data.bgmDuckingLevel!==undefined)await c.query('SELECT public.save_shot_audio_mix($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.bgmDuckingLevel]);
      if(data.transitionMode!==undefined)await c.query('SELECT public.save_shot_transition_mode($1,$2,$3,$4)',[e.id,p.id,data.shotId,data.transitionMode]);
     }
    }else throw new ConfigurationError(400,'不支持的制作操作。');
   }
   if(['saveMediaDraft','saveTtsDraft'].includes(String(body.command)))await c.query("UPDATE local_identity.script_productions SET progress=progress||jsonb_build_object($2::text,true) WHERE episode_id=$1",[data.episodeId,'manual:'+data.reviewPackageId+':'+data.shotId]);
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) DO NOTHING',[session.id,body.idempotencyKey,hash,value]);return value;
  });
  if(['requestWorkspaceVisualCandidate','requestWorkspaceImageCandidates','retryWorkspaceVisualCandidate','prepareWorkspaceAudio','prepareWorkspaceDelivery','retryWorkspaceDelivery','requestWorkspaceCaptionAlignment','generateWorkspaceNarration','generateWorkspaceImage','generateOfficialVideo','generateWan','resumeWan','requestQcMemberRevision','approveQc','retryFinalRender','generateReviewVideo','submitStudioRevision','requestStudioCompositionRevision','generateSourceAudio','requestAlignment','generateSyncPreview','registerManualMedia','saveAudioSelection','planMedia','retryMedia','saveMediaDraft','generateClip'].includes(body.command))this.runtime.wake(String(data.episodeId??result.id));return result;
 }
 private async requireCaptionTextReview(c:PoolClient,draft:{id:string;subtitles_enabled:boolean;audio_mode:string}){
  if(draft.subtitles_enabled&&draft.audio_mode!=='none'&&!(await c.query('SELECT local_identity.caption_text_is_confirmed($1) confirmed',[draft.id])).rows[0]?.confirmed)throw new ConfigurationError(409,'请先核对当前音频正文并保存确认。');
 }
 private async requirePost(kind:'source'|'alignment'|'preview'){try{if(!this.runtime.postReady)throw Error();await this.runtime.postReady(kind);}catch(error){if(error instanceof RuntimePreparationError)throw error;throw new ConfigurationError(503,'本地音频、对齐或同步预览执行环境尚未就绪。',{version:workerPreflightVersion,checks:[{capability:kind==='alignment'?'acoustic_alignment':kind==='preview'?'review_rendering':'embedded_audio_extraction',check:'command_availability',phase:'preflight',status:'unavailable',reason:'请检查本机执行配置、工具与缓存；不会下载模型或调用在线 Provider。',scope:'worker',action:'contact_environment_admin'}]});}}
 private async requireMedia(policy:Record<string,unknown>){try{if(!this.runtime.mediaReady)throw Error();await this.runtime.mediaReady(policy);}catch(error){if(error instanceof RuntimePreparationError)throw error;throw new ConfigurationError(503,'本地媒体执行器尚未就绪。',{version:workerPreflightVersion,checks:[{capability:'worker_runtime',check:'local_adapter_readiness',phase:'preflight',status:'unavailable',reason:'媒体工具、连接密钥存储或本地Adapter未准备。',scope:'worker',action:'contact_environment_admin'}]});}}
 private async requireNarration(){try{if(!this.runtime.narrationReady)throw Error();await this.runtime.narrationReady();}catch(error){if(error instanceof RuntimePreparationError)throw error;throw new ConfigurationError(503,'本地口播执行器、密钥存储或音频探测工具尚未就绪。',{version:workerPreflightVersion,checks:[{capability:'narration_generation',check:'command_availability',phase:'preflight',status:'unavailable',reason:'口播执行环境未准备。',scope:'worker',action:'contact_environment_admin'}]});}}
 private async preflight(c:PoolClient,_accountId:string,policy:Record<string,unknown>,existing:boolean,scope:'blueprint'|'local_clip'|'input'='blueprint'){
  const failure=(reason:string,check:string,scope:WorkerPreflightCheck['scope'],action:WorkerPreflightCheck['action'],status=409)=>new ConfigurationError(status,reason,{version:workerPreflightVersion,checks:[{capability:'worker_runtime',check,phase:'preflight',status:scope==='worker'?'unavailable':'blocked',reason,action,scope}]});
  try{if(scope!=='input')await this.runtime.ready();}catch(e){if(e instanceof RuntimePreparationError)throw e;throw failure(e instanceof Error?e.message:'本地Worker未准备。','command_availability','worker','contact_environment_admin',503);}
  let root:string;
  try{root=await resolveLocalAssetRoot(c,this.mediaRoot,policy.asset_root);await verifyMediaLibrary({mediaRootBinding:(await c.query("SELECT local_identity.media_deployment()->'binding' binding")).rows[0].binding,assetRoot:root,mountPath:this.runtime.mountPath,minimumFreeBytes:this.runtime.minimumFreeBytes,requireEpisodesDirectory:existing&&scope!=='input'});}catch(e){throw failure(e instanceof Error?e.message:'素材目录不可用。','asset_root','episode','manage_account_directory');}
  if(scope==='input')return;
  const refs=validateConfigurationPolicy(policy,true);
  if(scope==='blueprint'&&refs.length)try{await this.runtime.checkReferences(c,refs);}catch(error){if(error instanceof ConfigurationError&&error.preflight)throw error;throw failure('连接版本未就绪，请检查本机绑定与验证资格。','credential_presence','connection','manage_connection');}
  const errors=blueprintSelectionErrors(policy);if(errors.length)throw failure(errors.join(' '),'blueprint_configuration','blueprint','edit_blueprint');
  // Later production abilities are never declared ready by this input-only runtime.
  if(scope==='blueprint')for(const key of mediaCapabilityKeys){const config=policy[key] as {execution_path?:string;executor?:unknown;credential_ref?:unknown}|null|undefined;if(config&&Object.keys(config).length){if(key==='narration'&&config.execution_path==='external'){await this.requireNarration();continue;}if(key!=='narration'&&['external','local'].includes(String(config.execution_path))){await this.requireMedia(policy);continue;}if(config.execution_path!=='manual')throw failure(`${key}执行路径尚未由本地Worker接管验收。`,'local_adapter_readiness','worker','contact_environment_admin');if(config.executor||config.credential_ref)throw failure('人工素材路径不能同时声明生成执行器或连接。','blueprint_configuration','blueprint','edit_blueprint');}}
 }
}
