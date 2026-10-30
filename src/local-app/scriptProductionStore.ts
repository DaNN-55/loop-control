import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {basename,join} from 'node:path';
import {parseProductionScript,validateProductionDefaults} from '../reviews/productionScript.js';
import {resolveProductionPlan,type ResolvedProductionPlan,type ProductionMaterial} from '../reviews/productionPlan.js';
import {defaultShotCaptionContract,shotCaptionContractToDatabase,type ShotCaptionAnchor} from '../shotCaptions.js';
import {verifyNativeFile,snapshotInput} from './localFiles.js';
import {resolveLocalAssetRoot} from './mediaDeployment.js';
import {ConfigurationError,canonical} from './configurationCommands.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';

export interface ScriptEpisode {id:string;account_id:string;series_id?:string;series_version_id:string|null;main_script_revision_id:string|null;stage:string;policy:Record<string,unknown>;tts_voice?:string;tts_language_code?:string;tts_speaking_rate?:number}
export interface ScriptProductionRecord {episode_id:string;owner_id:string;script_sha256:string;script_revision_id:string;authorization_hash:string;enabled:boolean;plan:ResolvedProductionPlan;progress:Record<string,unknown>;last_status:string}
export const productionHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export class ScriptProductionStore {
 constructor(private mediaRoot:string){}
 async read(c:PoolClient,episodeId:string){
  const e=(await c.query("SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE e.id=$1",[episodeId])).rows[0] as ScriptEpisode|undefined;
  if(!e)throw new ConfigurationError(404,'本地生产单不可见。');
  const root=await resolveLocalAssetRoot(c,this.mediaRoot,e.policy.asset_root),result=await this.inspect(c,e,root);
  return{v2:!!result.plan,inspection:result.plan,plan:result.record?.plan??result.plan,enabled:result.record?.enabled??false,authorizationHash:result.record?.authorization_hash,status:result.record?.last_status??'请核对素材与设置后保存制作计划'};
 }
 async alias(c:PoolClient,ownerId:string,materialId:string,name:string){
  await c.query('INSERT INTO local_identity.material_reference_names(material_id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(material_id) DO NOTHING',[materialId,ownerId,basename(name).replace(/\.(png|jpg|jpeg|webp|mp3|wav|m4a|aac|flac|ogg|mp4|mov|webm)$/i,'').normalize('NFC')]);
 }
 async inspect(c:PoolClient,e:ScriptEpisode,root:string,choices:Record<string,string>={}){
  if(!e.main_script_revision_id)return{plan:null,record:null,script:null};
  const script=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
  if(!script)throw new ConfigurationError(409,'主脚本修订不存在。');
  const bytes=await verifyNativeFile(root,script.storage_path,script.sha256,Number(script.file_size)),text=bytes.toString('utf8');
  if(!parseProductionScript(text))return{plan:null,record:null,script:null};
  const rules=e.series_version_id?(await c.query('SELECT rules,series_id FROM public.series_versions WHERE id=$1 AND account_id=$2',[e.series_version_id,e.account_id])).rows[0]:null;
  const defaults=validateProductionDefaults(rules?.rules?.production_defaults??{});
  const raw=(await c.query(`SELECT m.*,sv.series_id,b.policy->>'asset_root' asset_root,n.name reference_name
   FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id
   JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id
   LEFT JOIN public.series_versions sv ON sv.id=e.series_version_id
   LEFT JOIN local_identity.material_reference_names n ON n.material_id=m.id
   WHERE e.account_id=$1 AND e.archived_at IS NULL AND NOT local_identity.is_historical_episode(e.id)
   AND local_identity.script_material_is_approved(m.id)
   AND (e.id=$2 OR ($3::uuid IS NOT NULL AND sv.series_id=$3))
   AND m.material_type IN ('image','audio') ORDER BY m.created_at,m.id`,[e.account_id,e.id,rules?.series_id??null])).rows;
  const materials:ProductionMaterial[]=raw.map(m=>({id:m.id,episodeId:m.episode_id,seriesId:m.series_id,name:m.source_path,alias:m.reference_name??undefined,type:m.material_type,purpose:m.material_purpose,mime:m.mime_type,path:m.storage_path,sha256:m.sha256,size:Number(m.file_size),root:m.asset_root}));
  const plan=resolveProductionPlan(text,defaults,materials,e.id,rules?.series_id??null,choices);
  plan.executionFingerprint=productionHash(e.policy);
  const record=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1',[e.id])).rows[0] as ScriptProductionRecord|undefined;
  return{plan,record:record??null,script};
 }
 async configure(c:PoolClient,e:ScriptEpisode,root:string,ownerId:string,enabled:boolean,choices:Record<string,string>){
  const inspected=await this.inspect(c,e,root,choices),plan=inspected.plan;
  if(!plan||!inspected.script)throw new ConfigurationError(400,'请导入 v2 主脚本。');
  if(enabled&&plan.issues.length)throw new ConfigurationError(409,plan.issues.join('；'));
  // Reuse is a verified immutable import, never a path handed to another episode.
  const resolutions=[plan.bgm,plan.cover,...plan.segments.flatMap(s=>[s.firstFrame,s.sfx])];
  const copied=new Map<string,ProductionMaterial>();
  for(const ref of resolutions){
   if(ref.status!=='bound'||!ref.material)continue;
   const m=ref.material;
   if(copied.has(m.id)){ref.material=copied.get(m.id);continue;}
   const sourceRoot=await resolveLocalAssetRoot(c,this.mediaRoot,m.root);
   const bytes=await verifyNativeFile(sourceRoot,m.path,m.sha256,m.size);
   if(m.type==='audio'){
    const duration=await probeMp3Artifact(join(sourceRoot,m.path));
    for(const segment of plan.segments)if(segment.sfx.material?.id===m.id&&(segment.settings.sfxDuration??1)>duration+0.05)throw new ConfigurationError(409,segment.id+'：上传音效短于指定使用时长。');
   }
   if(m.episodeId===e.id){copied.set(m.id,m);continue;}
   const source=await snapshotInput(root,e.id,{sourceKind:'file',sourcePath:basename(m.name),contentBase64:bytes.toString('base64')});
   const purpose=ref.kind==='image'?'visual_reference':ref.kind==='cover'?'cover':ref.kind==='bgm'?'background_music':'sound_effect';
   const created=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,false,$9)) result',[e.id,m.type,'file',source.sourcePath,source.storagePath,m.mime,source.sha256,source.fileSize,purpose])).rows[0].result;
   const local={...m,id:created.id,episodeId:e.id,path:source.storagePath,root};copied.set(m.id,local);ref.material=local;
   await this.alias(c,ownerId,created.id,m.alias??m.name);
  }
  const hash=productionHash({script:inspected.script.sha256,execution:plan.executionFingerprint,settings:plan.settings,segments:plan.segments.map(s=>({...s,firstFrame:{...s.firstFrame,candidates:[]},sfx:{...s.sfx,candidates:[]}})),bgm:{...plan.bgm,candidates:[]},cover:{...plan.cover,candidates:[]}});
  const previous=inspected.record;
  if(previous?.enabled&&previous.authorization_hash!==hash)throw new ConfigurationError(409,'请先暂停自动继续，再确认修改后的制作计划。');
  const progress=previous?.authorization_hash===hash?previous.progress:{};
  if(previous?.authorization_hash!==hash){
   const drafts=(await c.query('SELECT review_package_id,shot_id FROM public.shot_preparation_drafts WHERE episode_id=$1',[e.id])).rows;
   for(const draft of drafts)progress['manual:'+draft.review_package_id+':'+draft.shot_id]=true;
  }
  await c.query(`INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at,progress,last_status)
   VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6 THEN clock_timestamp() ELSE NULL END,$8,$9)
   ON CONFLICT(episode_id) DO UPDATE SET script_revision_id=excluded.script_revision_id,script_sha256=excluded.script_sha256,plan=excluded.plan,enabled=excluded.enabled,authorization_hash=excluded.authorization_hash,
   authorized_at=excluded.authorized_at,progress=excluded.progress,last_status=excluded.last_status,updated_at=clock_timestamp()`,[e.id,ownerId,e.main_script_revision_id,inspected.script.sha256,plan,enabled,hash,progress,enabled?'已启用，等待当前审核或执行条件':'已保存，自动继续已暂停']);
  await c.query('SELECT local_identity.record_script_production_configuration($1,$2)',[e.id,hash]);
  return{plan,enabled,authorizationHash:hash};
 }
 async appliedSettings(c:PoolClient,e:ScriptEpisode,root:string,record:ScriptProductionRecord,reviewId:string){
  const p=(await c.query("SELECT * FROM public.review_packages WHERE id=$1 AND episode_id=$2 AND stage='storyboard_review' AND invalidated_at IS NULL",[reviewId,e.id])).rows[0];
  if(!p||e.stage!=='storyboard_approved')throw new ConfigurationError(409,'请先审核当前分镜。');
  const board=p.context_snapshot?.worker_result?.storyboard;
  if(!board||record.plan.segments.some(s=>!board.shots.some((shot:{id:string;scriptSegment:string})=>shot.id===s.id&&shot.scriptSegment===s.narration)))throw new ConfigurationError(409,'分镜与 v2 脚本不一致，请确认段落映射后继续。');
  if(record.progress['settings:'+reviewId])return{applied:true,preserved:true};
  const settings=record.plan.settings;
  const voice=e.tts_voice||settings.voice,rate=Number(e.tts_speaking_rate||settings.speakingRate||1),language=e.tts_language_code||settings.language||'zh-CN';
  if(!voice)throw new ConfigurationError(409,'请先配置本期或系列默认旁白音色。');
  if(!e.tts_voice)await c.query('SELECT public.save_episode_tts_settings($1,$2,$3,$4)',[e.id,language,voice,rate]);
  if(!record.progress['bgm:'+reviewId]){
   const old=(await c.query("SELECT 1 FROM public.storyboard_audio_selections WHERE episode_id=$1 AND review_package_id=$2 AND target_kind='episode'",[e.id,reviewId])).rowCount;
   if(!old)await c.query('SELECT public.save_storyboard_audio_selection($1,$2,$3,$4,$5,NULL,$6)',[e.id,reviewId,'episode',e.id,'bgm',record.plan.bgm.material?.id??null]);
  }
  for(const segment of record.plan.segments){
   // Existing/manual revisions win; automatically seeded rows receive settings once.
   if(record.progress['manual:'+reviewId+':'+segment.id])continue;
   const s=segment.settings;
   await c.query('SELECT public.save_shot_preparation_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',[e.id,reviewId,segment.id,'tts',segment.subtitle,s.captionsEnabled!==false,segment.narration,s.voice??voice,s.speakingRate??rate]);
   const captions=defaultShotCaptionContract(segment.subtitle,s.captionMode??'follow_tts',s.captionsEnabled!==false);
   captions.spatial.aspectRatio=settings.aspectRatio??'9:16';captions.spatial.anchor=(s.captionAnchor??'bottom-center') as ShotCaptionAnchor;
   captions.spatial.safeArea=s.captionSafeArea??'title-safe';captions.spatial.maxLines=s.captionMaxLines??2;captions.spatial.maxCharactersPerLine=s.captionMaxCharacters??14;
   await c.query('SELECT public.save_shot_caption_contract($1,$2,$3,$4)',[e.id,reviewId,segment.id,shotCaptionContractToDatabase(captions)]);
   await c.query('SELECT public.save_shot_transition_mode($1,$2,$3,$4)',[e.id,reviewId,segment.id,s.transition??'cut']);
   await c.query('SELECT local_identity.save_script_shot_gains($1,$2,$3,$4,$5,$6)',[e.id,reviewId,segment.id,s.narrationGainDb??0,s.bgmGainDb??-12,s.sfxGainDb??-6]);
   if(record.plan.bgm.status==='bound')await c.query('SELECT public.save_shot_audio_mix($1,$2,$3,$4)',[e.id,reviewId,segment.id,s.bgmDucking??'medium']);
   if(segment.sfx.status==='bound'&&segment.sfx.material){
    const m=segment.sfx.material;await verifyNativeFile(root,m.path,m.sha256,m.size);
    await c.query('SELECT public.register_manual_audio($1,$2,$3,$4)',[e.id,m.id,'sfx-'+segment.id,reviewId]);
    await c.query('SELECT public.save_storyboard_audio_selection($1,$2,$3,$4,$5,$6,NULL)',[e.id,reviewId,'shot',segment.id,'sfx','sfx-'+segment.id]);
   }
  }
  await c.query("UPDATE local_identity.script_productions SET progress=progress||jsonb_build_object($2::text,true),updated_at=clock_timestamp() WHERE episode_id=$1",[e.id,'settings:'+reviewId]);
  return{applied:true};
 }
}
