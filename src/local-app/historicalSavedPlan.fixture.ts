// Test-only reconstruction of a pre-198 saved plan, never a current execution route.
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import type {PoolClient} from 'pg';
import {basename} from 'node:path';
import {parseProductionScript,validateProductionDefaults} from '../reviews/productionScript.js';
import {resolveProductionPlan,type ResolvedProductionPlan,type ProductionMaterial} from '../reviews/productionPlan.js';
import {snapshotInput} from './localFiles.js';
import {ConfigurationError,canonicalFingerprint as productionHash} from './configurationCommands.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';

export interface ScriptEpisode {id:string;account_id:string;series_id?:string;series_version_id:string|null;main_script_revision_id:string|null;stage:string;policy:Record<string,unknown>;tts_voice?:string;tts_language_code?:string;tts_speaking_rate?:number}
export interface ScriptProductionRecord {episode_id:string;owner_id:string;script_sha256:string;script_revision_id:string;authorization_hash:string;enabled:boolean;plan:ResolvedProductionPlan;progress:Record<string,unknown>;last_status:string}
export {productionHash};
export function savedProductionPlanIdentity(episodeId:string,record:Pick<ScriptProductionRecord,'script_revision_id'|'script_sha256'|'plan'>){
 return{version:'legacy-production-plan/v1',episodeId,scriptRevisionId:record.script_revision_id,scriptSha256:record.script_sha256,plan:record.plan};
}
class HistoricalPlanFixtureStore {
 constructor(private mediaRoot:string){}
 async alias(c:PoolClient,ownerId:string,materialId:string,name:string){
  await c.query('INSERT INTO local_identity.material_reference_names(material_id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(material_id) DO NOTHING',[materialId,ownerId,basename(name).replace(/\.(png|jpg|jpeg|webp|mp3|wav|m4a|aac|flac|ogg|mp4|mov|webm)$/i,'').normalize('NFC')]);
 }
 async inspect(c:PoolClient,e:ScriptEpisode,root:string,choices:Record<string,string>={}){
  if(!e.main_script_revision_id)return{plan:null,record:null,script:null};
  const script=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
  if(!script)throw new ConfigurationError(409,'主脚本修订不存在。');
  const bytes=await verifyEpisodeFile(c,root,e.id,script.storage_path,script.sha256,Number(script.file_size)),text=bytes.toString('utf8');
  if(parseProductionScript(text)?.version!==2)return{plan:null,record:null,script:null};
  const rules=e.series_version_id?(await c.query('SELECT rules,series_id FROM public.series_versions WHERE id=$1 AND account_id=$2',[e.series_version_id,e.account_id])).rows[0]:null;
  const defaults=validateProductionDefaults(rules?.rules?.production_defaults??{});
  const raw=(await c.query(`SELECT m.*,sv.series_id,local_identity.episode_asset_root(e.id) asset_root,n.name reference_name,o.provenance
   FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id
   JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id
   LEFT JOIN public.series_versions sv ON sv.id=e.series_version_id
   LEFT JOIN local_identity.material_reference_names n ON n.material_id=m.id
   LEFT JOIN local_identity.material_import_origins o ON o.material_id=m.id
   WHERE e.account_id=$1 AND e.archived_at IS NULL AND NOT local_identity.is_historical_episode(e.id)
   AND local_identity.script_material_is_approved(m.id)
   AND (e.id=$2 OR ($3::uuid IS NOT NULL AND sv.series_id=$3))
   AND m.material_type IN ('image','audio') ORDER BY m.created_at,m.id`,[e.account_id,e.id,rules?.series_id??null])).rows;
  const materials:ProductionMaterial[]=raw.map(m=>({id:m.id,episodeId:m.episode_id,seriesId:m.series_id,name:m.source_path,alias:m.reference_name??undefined,type:m.material_type,purpose:m.material_purpose,mime:m.mime_type,path:m.storage_path,sha256:m.sha256,size:Number(m.file_size),root:m.asset_root,...(m.provenance?{provenance:m.provenance}:{})}));
  const plan=resolveProductionPlan(text,defaults,materials,e.id,rules?.series_id??null,choices);
  plan.executionFingerprint=productionHash(e.policy);
  const record=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1',[e.id])).rows[0] as ScriptProductionRecord|undefined;
  return{plan,record:record??null,script};
 }
 async configure(c:PoolClient,e:ScriptEpisode,root:string,ownerId:string,enabled:boolean,choices:Record<string,string>){
  const location=await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id);await requireEpisodeStorageDirectory(c,location);
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
   const sourceLocation=await resolveEpisodeStorageLocation(c,this.mediaRoot,m.episodeId);await requireEpisodeStorageDirectory(c,sourceLocation);
   const sourceRoot=sourceLocation.assetRoot;
   const bytes=await verifyEpisodeFile(c,sourceRoot,m.episodeId,m.path,m.sha256,m.size);
   if(m.type==='audio'){
    const duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,sourceLocation,m.path));
    for(const segment of plan.segments)if(segment.sfx.material?.id===m.id&&(segment.settings.sfxDuration??1)>duration+0.05)throw new ConfigurationError(409,segment.id+'：上传音效短于指定使用时长。');
   }
   if(m.episodeId===e.id){copied.set(m.id,m);continue;}
   const source=await snapshotInput(root,e.id,{sourceKind:'file',sourcePath:basename(m.name),contentBase64:bytes.toString('base64')},location.relativePath);
   const purpose=ref.kind==='image'?'visual_reference':ref.kind==='cover'?'cover':ref.kind==='bgm'?'background_music':'sound_effect';
   const created=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,false,$9)) result',[e.id,m.type,'file',source.sourcePath,source.storagePath,m.mime,source.sha256,source.fileSize,purpose])).rows[0].result;
   const provenance=(await c.query('SELECT local_identity.record_material_reuse($1,$2) result',[created.id,m.id])).rows[0].result;
   const local={...m,id:created.id,episodeId:e.id,path:source.storagePath,root,provenance};copied.set(m.id,local);ref.material=local;
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

}

/** Seed a pre-retirement saved declaration; current HTTP never exposes this writer. */
export async function saveHistoricalPlanFixture(f:{pool:import('pg').Pool;owner:string;root:string;assetRoot:string;newEpisode?:string;episode:string},options:{episodeId?:string;choices?:Record<string,string>}={}){
 const {ownerTransaction}=await import('./ownerTransaction');
 const body=await ownerTransaction(f.pool,f.owner,false,async c=>{
  const episodeId=options.episodeId??f.newEpisode??f.episode;
  const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[episodeId])).rows[0] as ScriptEpisode;
  const location=await resolveEpisodeStorageLocation(c,f.root,e.id);
  return new HistoricalPlanFixtureStore(f.root).configure(c,e,location.assetRoot,f.owner,false,options.choices??{});
 });
 return{status:200,body};
}
