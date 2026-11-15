import {productionRenderPreferences} from '../workspaceRenderPreferences.js';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {basename,dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {canonical,canonicalFingerprint,ConfigurationError} from './configurationCommands.js';
import {savedProductionPlanIdentity,type ScriptProductionRecord} from './scriptProductionStore.js';
import {parseProductionScript,validateProductionDefaults} from '../reviews/productionScript.js';
import type {MaterialResolution,ProductionMaterial} from '../reviews/productionPlan.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {snapshotInput} from './localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {verifyProductionPreparationDocument} from './productionPreparationStore.js';
import {defaultShotCaptionContract,normalizeShotCaptionContract,type ShotCaptionAnchor} from '../shotCaptions.js';
import type {ProductionWorkspace} from '../productionWorkspace.js';

/** Original saved roots are declarations, never host filesystem authority. */
export async function prepareSavedPlanAdoption(c:PoolClient,root:string,episode:{id:string;account_id:string;main_script_revision_id:string|null},expected:unknown){
 const record=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1 FOR SHARE',[episode.id])).rows[0] as ScriptProductionRecord|undefined;
 if(!record||typeof expected!=='string'||canonicalFingerprint(savedProductionPlanIdentity(episode.id,record))!==expected)throw new ConfigurationError(409,'原保存计划已变化，请重新读取并确认。');
 const plan=record.plan;
 if(plan?.version!==2||plan.script?.version!==2||!Array.isArray(plan.segments)||!plan.segments.length)throw new ConfigurationError(409,'原计划格式尚未接入，请保留原计划核对。');
 const source=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='script'",[episode.main_script_revision_id,episode.id])).rows[0];
 if(!source||source.sha256!==record.script_sha256)throw new ConfigurationError(409,'当前脚本与原计划正文版本不同，不会覆盖当前脚本。');
 const bytes=await verifyEpisodeFile(c,root,episode.id,source.storage_path,source.sha256,Number(source.file_size));
 const script=parseProductionScript(bytes.toString('utf8'));
 if(!isDeepStrictEqual(script,plan.script)||plan.segments.length!==script!.segments.length||plan.segments.some((s,i)=>s.id!==script!.segments[i].id||s.narration!==script!.segments[i].narration||s.subtitle!==(script!.segments[i].subtitle??s.narration)))throw new ConfigurationError(409,'原计划与已核验脚本段落不一致，未猜测镜头映射。');
 try{validateProductionDefaults(plan.settings);for(const s of plan.segments)validateProductionDefaults(s.settings);}catch{throw new ConfigurationError(409,'原计划包含尚不能接入的设置，请保留原版核对。');}
 const location=await episodeStorageLocationAtRoot(c,root,episode.id);await requireEpisodeStorageDirectory(c,location);
 const materials=new Map<string,ProductionMaterial>();
 const resolutions=[{ref:plan.bgm,kind:'bgm'},{ref:plan.cover,kind:'cover'},...plan.segments.flatMap(s=>[{ref:s.firstFrame,kind:'image'},{ref:s.sfx,kind:'sfx'}])];
 for(const {ref,kind} of resolutions){
  if(!ref||ref.kind!==kind||!['bound','none','missing','ambiguous'].includes(ref.status))throw new ConfigurationError(409,'原计划素材绑定协议尚未支持，未猜测其含义。');
  if(ref.status!=='bound')continue;
  const m=ref.material;if(!m)throw new ConfigurationError(409,'原计划绑定缺少素材身份。');
  const stored=(await c.query('SELECT m.*,e.account_id FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id WHERE m.id=$1',[m.id])).rows[0];
  if(!stored||stored.account_id!==episode.account_id||stored.episode_id!==m.episodeId||stored.sha256!==m.sha256||Number(stored.file_size)!==m.size||stored.storage_path!==m.path||stored.material_type!==m.type||stored.mime_type!==m.mime||stored.material_purpose!==m.purpose||!['image','audio'].includes(m.type))throw new ConfigurationError(409,'原计划素材登记或归属已变化。');
  const image=ref.kind==='image'||ref.kind==='cover';
  if(image&&m.type!=='image'||!image&&(m.type!=='audio'||m.purpose!==(ref.kind==='bgm'?'background_music':'sound_effect')))throw new ConfigurationError(409,'原计划素材用途不一致。');
  if(materials.has(m.id))continue;
  const sourceRoot=(await c.query('SELECT local_identity.storage_physical_root(asset_root) root FROM local_identity.episode_storage_location($1)',[m.episodeId])).rows[0]?.root;
  if(typeof sourceRoot!=='string')throw new ConfigurationError(409,'原素材位置缺少可验证的当前映射。');
  const sourceLocation=await episodeStorageLocationAtRoot(c,sourceRoot,m.episodeId);await requireEpisodeStorageDirectory(c,sourceLocation);
  const content=await verifyEpisodeFile(c,sourceLocation.assetRoot,m.episodeId,m.path,m.sha256,m.size);
  if(m.episodeId===episode.id){materials.set(m.id,m);continue;}
  if(!(await c.query('SELECT local_identity.script_material_is_approved($1) approved',[m.id])).rows[0].approved)throw new ConfigurationError(409,'原系列素材缺少可验证的采用许可。');
  const copy=await snapshotInput(root,episode.id,{sourceKind:'file',sourcePath:basename(stored.source_path),contentBase64:content.toString('base64')},location.relativePath);
  const local=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,false,$9)) result',[episode.id,m.type,'file',copy.sourcePath,copy.storagePath,m.mime,copy.sha256,copy.fileSize,m.purpose])).rows[0].result;
  const provenance=(await c.query('SELECT local_identity.record_material_reuse($1,$2) result',[local.id,m.id])).rows[0].result;
  materials.set(m.id,{...m,id:local.id,episodeId:episode.id,path:copy.storagePath,root,provenance});
 }
 const cover=plan.cover.status==='bound'&&plan.cover.material?materials.get(plan.cover.material.id):undefined;
 const id=randomUUID(),manifest={version:'production-preparation/v1',...(cover?{coverInputs:[{version:'workspace-cover-source/v1',kind:'material',id:cover.id,sha256:cover.sha256}]}:{}),savedPlan:{version:'saved-production-plan/v1',sha256:expected,scriptRevisionId:record.script_revision_id,scriptSha256:record.script_sha256,settings:plan.settings},
  materialBindings:[...materials].map(([sourceId,m])=>({sourceId,materialRevisionId:m.id,sha256:m.sha256})),
  shots:plan.segments.map(s=>{
   const renderPreferences=productionRenderPreferences(validateProductionDefaults(s.settings));
   return{id:s.id,scriptSegment:s.narration,durationSeconds:s.settings.duration??5,targetSpec:plan.settings.aspectRatio??s.settings.aspectRatio??'9:16',visualSource:'unassigned',visualIntent:s.visual||s.videoPrompt,savedSettings:s.settings,...(renderPreferences?{renderPreferences}:{}),...(s.settings.layout?{layout:s.settings.layout}:{}),inputBasis:[{relativePath:source.storage_path,sha256:source.sha256}]};
  })};
 const document=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),reference={relativePath:`${location.relativePath}/preparation/${id}.json`,sha256:createHash('sha256').update(document).digest('hex'),fileSize:document.length},path=await safeAssetOutputPath(root,reference.relativePath);
 await mkdir(dirname(path),{recursive:true});await writeFile(path,document,{flag:'wx'});await verifyProductionPreparationDocument(c,root,episode.id,reference,manifest);
 await c.query('SELECT local_identity.register_saved_plan_preparation($1,$2,$3,$4,$5,$6,$7)',[episode.id,source.id,id,reference,manifest,JSON.stringify(canonical(savedProductionPlanIdentity(episode.id,record))),expected]);
 return{preparation:{id,manifest,relative_path:reference.relativePath,sha256:reference.sha256,file_size:reference.fileSize,legacy_package_id:null},plan,materials};
}

/** Prepare references through current local commands; adoption and generation stay explicit. */
export async function installSavedPlanInputs(c:PoolClient,initial:ProductionWorkspace,adoption:Awaited<ReturnType<typeof prepareSavedPlanAdoption>>,execute:(command:string,data:Record<string,unknown>)=>Promise<ProductionWorkspace>){
 let state=initial;
 const send=async(command:string,data:Record<string,unknown>)=>state=await execute(command,{workspaceId:state.id,expectedRevision:state.revision,...data});
 const material=(ref:MaterialResolution)=>ref.status==='bound'&&ref.material?adoption.materials.get(ref.material.id):undefined;
 for(const segment of adoption.plan.segments){
  const settings=segment.settings,clips=state.clips.filter(b=>b.shotId===segment.id);
  await c.query('SELECT local_identity.save_production_narration_input($1,$2,$3,$4,$5,$6,$7,NULL)',[state.id,segment.id,'none',segment.narration,settings.voice??null,settings.speakingRate??null,settings.language??null]);
  const caption=defaultShotCaptionContract(segment.subtitle,'independent',settings.captionsEnabled!==false);
  caption.spatial={version:'shot-caption-space/v2',aspectRatio:adoption.plan.settings.aspectRatio??'9:16',anchor:(settings.captionAnchor??'bottom-center') as ShotCaptionAnchor,safeArea:settings.captionSafeArea??'title-safe',maxLines:settings.captionMaxLines??2,maxCharactersPerLine:settings.captionMaxCharacters??14};
  await send('saveWorkspaceCaptions',{clipId:clips[0].id,captionContract:normalizeShotCaptionContract(caption,{text:caption.text,enabled:caption.enabled})});
  if(settings.captionMode!=='independent'){
   await send('saveWorkspaceNarrationCaptions',{clipId:clips[0].id,contentMode:'follow_tts',text:segment.subtitle});
   if(settings.captionsEnabled===false)await send('setWorkspaceCaptionsEnabled',{clipId:clips[0].id,enabled:false});
  }
  const image=material(segment.firstFrame);
  if(image)for(const clip of clips)await send('registerWorkspaceVisualCandidate',{targetItemId:clip.itemId,materialRevisionId:image.id,usage:'still',durationSeconds:settings.duration??5});
  const sound=material(segment.sfx);
  if(sound)await send('prepareWorkspaceAudio',{kind:'sfx',shotId:segment.id,materialRevisionId:sound.id,description:'原保存计划音效',durationSeconds:settings.sfxDuration??1,anchor:'shot',offsetSeconds:settings.sfxStart??0});
 }
 const music=material(adoption.plan.bgm);
 if(music)await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:music.id,description:'原保存计划配乐',durationSeconds:adoption.plan.segments.reduce((sum,s)=>sum+(s.settings.duration??5),0),anchor:'absolute',offsetSeconds:0});
 return state;
}
