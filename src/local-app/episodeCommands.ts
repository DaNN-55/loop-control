import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,validateConfigurationPolicy,canonical} from './configurationCommands.js';
import {ensureInputDirectories,nativeAssetRoot,snapshotInput,verifyNativeFile} from './localFiles.js';
import {verifyMediaLibrary} from '../worker/mediaLibrary.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {blueprintSelectionErrors} from '../worker/runtimePreflight.js';
import {mediaCapabilityKeys} from '../worker/productionCapabilities.js';
import {workerPreflightVersion,type WorkerPreflightCheck} from '../worker/contracts.js';
export interface InputRuntime {ready():Promise<void>;wake(episodeId:string):void;mountPath:string;minimumFreeBytes:number;checkReferences(client:PoolClient,refs:string[]):Promise<void>}
export class LocalEpisodeCommands {
 constructor(private pool:Pool,private mediaRoot:string,private runtime:InputRuntime){}
 async execute(session:OwnerSession,body:Record<string,unknown>){
  if(typeof body.command!=='string'||!['create','importMaterial','start','review','openDirectory'].includes(body.command)||typeof body.idempotencyKey!=='string'||!/^[0-9a-f-]{36}$/.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k)))throw new ConfigurationError(400,'Episode命令无效。');
  const data=body.data as Record<string,unknown>,hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  const allowed:Record<string,string[]>={create:['accountId','title','seriesVersionId','isTest'],importMaterial:['episodeId','sourceKind','sourcePath','logicalName','materialType','materialPurpose','mimeType','isMainScript','contentBase64','deferRefresh'],start:['episodeId'],review:['episodeId','toStage','reason','reviewPackageId'],openDirectory:['episodeId']};
  if(Object.keys(data).some(k=>!allowed[body.command as string].includes(k)))throw new ConfigurationError(400,'Episode字段无效。');
  const result=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+body.idempotencyKey]);
   const old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,body.idempotencyKey])).rows[0];
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return old.result;}
   let value;
   if(body.command==='create'){
    if(!(await c.query('SELECT local_identity.lock_owned_account_row($1) owned',[data.accountId])).rows[0].owned)throw new ConfigurationError(404,'账号不可见。');
    const a=(await c.query('SELECT a.*,b.policy FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1 AND m.user_id=$2 AND m.role=\'owner\' AND a.archived_at IS NULL',[data.accountId,session.id])).rows[0];
    if(!a)throw new ConfigurationError(404,'账号不可见。');if(typeof data.title!=='string'||data.title.length>200)throw new ConfigurationError(400,'标题无效。');
    await this.preflight(c,a.id,a.policy,false);
    value=(await c.query('SELECT to_jsonb(public.create_episode($1,$2,$3,$4,$5)) result',[a.id,a.current_blueprint_version_id,data.seriesVersionId??null,data.title.trim(),data.isTest===true])).rows[0].result;
    await ensureInputDirectories(a.policy.asset_root,value.id);
    await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[value.id,session.id]);
   }else{
    if(!(await c.query('SELECT local_identity.lock_owned_input_episode($1) owned',[data.episodeId])).rows[0].owned)throw new ConfigurationError(404,'本地生产单不可见。');
    const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE e.id=$1 AND m.user_id=$2 AND m.role=\'owner\' AND i.owner_id=$2',[data.episodeId,session.id])).rows[0];
    if(!e)throw new ConfigurationError(404,'本地生产单不可见。');const root=await nativeAssetRoot(this.mediaRoot,e.policy.asset_root);
    if(body.command==='importMaterial'){
     if(data.isMainScript&&(e.stage!=='waiting_input'||e.main_script_revision_id))throw new ConfigurationError(409,'主脚本已确认或制作已开始，不能替换。');
     const purposes=['main_script','supplemental_script','general_reference','visual_reference','a_roll','b_roll','narration','background_music','sound_effect','cover'];
     if(!purposes.includes(String(data.materialPurpose))||typeof data.materialType!=='string'||typeof data.mimeType!=='string'||typeof data.isMainScript!=='boolean')throw new ConfigurationError(400,'材料类型无效。');
     if(typeof data.sourceKind!=='string'||typeof data.sourcePath!=='string'||data.logicalName!==undefined&&typeof data.logicalName!=='string')throw new ConfigurationError(400,'材料路径无效。');
     const snapshot=await snapshotInput(root,e.id,data as never);
     value=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) result',[e.id,data.materialType,data.sourceKind,snapshot.sourcePath,snapshot.storagePath,data.mimeType,snapshot.sha256,snapshot.fileSize,data.isMainScript,data.materialPurpose])).rows[0].result;
    }else if(body.command==='start'){
     await this.preflight(c,e.account_id,e.policy,true);
     const materials=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1',[e.id])).rows;
     if(!e.main_script_revision_id)throw new ConfigurationError(409,'请先上传并确认主脚本。');
     for(const m of materials)await verifyNativeFile(root,m.storage_path,m.sha256,Number(m.file_size));
     if(!materials.some(m=>['visual_reference','a_roll','b_roll'].includes(m.material_purpose)&&['image','video','reference'].includes(m.material_type)))throw new ConfigurationError(409,'请先导入视觉参考；当前没有已验收的图片生成路径。');
     await c.query('SELECT public.record_episode_worker_preflight($1,$2)',[e.id,session.id]);
     value=(await c.query('SELECT to_jsonb(public.start_episode_production($1)) result',[e.id])).rows[0].result;
     await c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[e.id]);
    }else if(body.command==='openDirectory'){
     await ensureInputDirectories(root,e.id);await promisify(execFile)('/usr/bin/open',[join(root,'episodes',e.id,'input')],{env:{PATH:'/usr/bin:/bin'},timeout:5000});value={opened:true};
    }else{
     if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>5000||!['visual_approved','visual_draft'].includes(String(data.toStage)))throw new ConfigurationError(400,'视觉审批内容无效。');
     const p=(await c.query("SELECT id,artifact_id FROM public.review_packages WHERE episode_id=$1 AND stage='visual_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
     if(e.stage!=='visual_review'||!p||p.id!==data.reviewPackageId)throw new ConfigurationError(409,'审核包已变化，请刷新后重新审核。');
     const files=(await c.query('SELECT * FROM public.artifacts WHERE episode_id=$1 AND id=$2',[e.id,p.artifact_id])).rows;
     if(!files.length)throw new ConfigurationError(409,'审核产物缺失。');for(const f of files)await verifyNativeFile(root,f.relative_path,f.sha256,Number(f.file_size));
     value=(await c.query('SELECT to_jsonb(public.transition_episode($1,$2,$3)) result',[e.id,data.toStage,data.reason.trim()])).rows[0].result;
    }
   }
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,body.idempotencyKey,hash,value]);return value;
  });
  if(body.command==='start')this.runtime.wake(result.id);return result;
 }
 private async preflight(c:PoolClient,accountId:string,policy:Record<string,unknown>,existing:boolean){
  const failure=(reason:string,check:string,scope:WorkerPreflightCheck['scope'],action:WorkerPreflightCheck['action'],status=409)=>new ConfigurationError(status,reason,{version:workerPreflightVersion,checks:[{capability:'worker_runtime',check,phase:'preflight',status:scope==='worker'?'unavailable':'blocked',reason,action,scope}]});
  try{await this.runtime.ready();}catch(e){throw failure(e instanceof Error?e.message:'本地Worker未准备。','command_availability','worker','contact_environment_admin',503);}
  let root:string;
  try{root=await nativeAssetRoot(this.mediaRoot,policy.asset_root);await verifyMediaLibrary({assetRoot:root,mountPath:this.runtime.mountPath,minimumFreeBytes:this.runtime.minimumFreeBytes,requireEpisodesDirectory:existing});}catch(e){throw failure(e instanceof Error?e.message:'素材目录不可用。','asset_root','blueprint','edit_blueprint');}
  const refs=validateConfigurationPolicy(policy,true);if(refs.length)try{await this.runtime.checkReferences(c,refs);}catch{throw failure('连接版本未就绪，请检查本机绑定与验证资格。','credential_presence','connection','manage_connection');}
  const errors=blueprintSelectionErrors(policy);if(errors.length)throw failure(errors.join(' '),'blueprint_configuration','blueprint','edit_blueprint');
  const planner=(policy.executors as {storyboard_planning:{harness_id:string}}).storyboard_planning;
  if(!(await c.query("SELECT 1 FROM public.prompt_versions WHERE id=$1 AND account_id=$2 AND capability='storyboard_planning' AND is_active",[planner.harness_id,accountId])).rowCount)throw failure('分镜Prompt Harness未登记或不可用。','blueprint_configuration','blueprint','edit_blueprint');
  // Later production abilities are never declared ready by this input-only runtime.
  for(const key of mediaCapabilityKeys){const config=policy[key] as {execution_path?:string;executor?:unknown;credential_ref?:unknown}|null|undefined;if(config&&Object.keys(config).length){if(config.execution_path!=='manual')throw failure(`${key}执行路径尚未由本地Worker接管验收。`,'local_adapter_readiness','worker','contact_environment_admin');if(config.executor||config.credential_ref)throw failure('人工素材路径不能同时声明生成执行器或连接。','blueprint_configuration','blueprint','edit_blueprint');}}
 }
}
