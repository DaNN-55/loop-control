import {readFile,unlink} from 'node:fs/promises';
import {validateImportedMaterial} from './materialAcceptance.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {withWorkspaceShotMetadata} from '../workspaceShots.js';
import {rebaseCopiedWorkspaceNarrations} from './workspaceNarration.js';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspacePublication} from '../workspacePublication.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {join,extname} from 'node:path';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {productionCopyId,remapProductionCopy} from './productionCopyMapping.js';
import {copyProductionMedia} from './productionCopyMedia.js';
import {createEpisodeDirectory} from './episodeCreation.js';
import {persistWorkspaceProject,workspaceContentSha256,readProductionWorkspace,recordWorkspaceVersion,validateWorkspaceProject} from './productionWorkspaceCommands.js';
import {syncNativeWorkspaceCaptions} from './workspaceCaptionsCommands.js';
import {syncProductionWorkspaceShots} from './workspacePreparation.js';
import {readWorkspacePublication} from './workspacePublicationStore.js';
import {persistPublicationFile} from './workspacePublicationFiles.js';
import {synchronizeWorkspaceBindings} from '../workspaceShots.js';
import type {OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';

type JsonRow=Record<string,unknown>;
interface MediaRow extends JsonRow {id:string;storage_path?:string;relative_path?:string;sha256:string;file_size:number|string}
export interface ProductionCopyDraft {project:OpenChatCutProject;changed:boolean;files:Array<{reference:string;originalReference?:string;path:string;sha256:string;fileSize:number}>}
interface StagedFile {references:string[];path:string;sha256:string;fileSize:number}
interface CopySnapshot {episode:{id:string;account_id:string;title:string;series_version_id:string|null;is_test:boolean};workspace:ProductionWorkspaceRecord&JsonRow;preparation:JsonRow;materials:MediaRow[];artifacts:MediaRow[];audio:MediaRow[];shots:JsonRow[];narrationInputs:JsonRow[];captionInputs:JsonRow[];decisions:JsonRow[];narrations:JsonRow[];audioPreparations:JsonRow[];publication:WorkspacePublication;project:OpenChatCutProject;files:StagedFile[]}
export interface ProductionCopyResult {episodeId:string;workspaceId:string;title:string;unchanged?:false}
export class CompletedProductionCopies {
 constructor(private pool:Pool,private mediaRoot:string,private runtime:()=>Promise<OpenChatCutRuntimeConfig>){}
 async save(session:OwnerSession,episodeId:string,copyId:string,readDraft:()=>Promise<ProductionCopyDraft>):Promise<ProductionCopyResult|{unchanged:true}>{
  // A native process restart can lose temporary sessions; the durable save intent does not.
  const existing=await ownerTransaction(this.pool,session.id,true,async c=>{
   const receipt=(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,copyId])).rows[0];
   const intent=(await c.query('SELECT source_episode_id,snapshot FROM local_identity.production_copy_intents WHERE owner_id=$1 AND copy_id=$2',[session.id,copyId])).rows[0];
   if(intent&&intent.source_episode_id!==episodeId)throw new ConfigurationError(409,'副本标识已属于其他生产单。');return{receipt:receipt?.result,intent:intent?.snapshot as CopySnapshot|undefined};
  });
  if(existing.receipt&&!existing.intent)throw new ConfigurationError(409,'副本操作标识已被其他操作使用。');
  if(existing.receipt)return{episodeId:String(existing.receipt.id),workspaceId:String(existing.receipt.workspaceId),title:String(existing.receipt.title)};
  let snapshot=existing.intent;
  if(!snapshot){const draft=await readDraft();if(!draft.changed)return{unchanged:true};snapshot=await this.freeze(session,episodeId,copyId,draft);}
  const frozen=snapshot,workspaceId=productionCopyId(copyId,frozen.workspace.id),title=frozen.episode.title.slice(0,195)+'（副本）';
  const hash=canonicalFingerprint({version:'completed-production-copy/v1',copyId,episodeId});
  const result=await createEpisodeDirectory(this.pool,session,copyId,hash,{accountId:frozen.episode.account_id,title,seriesVersionId:frozen.episode.series_version_id,isTest:frozen.episode.is_test},this.mediaRoot,async()=>{}, {sourceEpisodeId:episodeId,initialize:async(c,target)=>{
   await this.initialize(c,frozen,String(target.id),workspaceId,copyId);target.workspaceId=workspaceId;
  }});
  return{episodeId:String(result.id),workspaceId:String(result.workspaceId),title:String(result.title)};
 }
 private async freeze(session:OwnerSession,episodeId:string,copyId:string,draft:ProductionCopyDraft):Promise<CopySnapshot>{
  return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':production-copy:'+copyId]);
   const prior=(await c.query('SELECT source_episode_id,snapshot FROM local_identity.production_copy_intents WHERE owner_id=$1 AND copy_id=$2',[session.id,copyId])).rows[0];if(prior){if(prior.source_episode_id!==episodeId)throw new ConfigurationError(409,'副本标识已属于其他生产单。');return prior.snapshot;}
   const episode=(await c.query("SELECT e.* FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND e.stage='production_completed' AND m.user_id=local_identity.owner_id() AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id) ",[episodeId])).rows[0];if(!episode)throw new ConfigurationError(404,'已完成原单不可见。');
   const workspace=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE episode_id=$1 FOR SHARE',[episodeId])).rows[0];if(!workspace)throw new ConfigurationError(409,'原单制作工程不可用。');
   const root=await resolveEpisodeAssetRoot(c,this.mediaRoot,episodeId),io=await episodeFileIO(c,root,episodeId),preparation=(await c.query('SELECT * FROM local_identity.production_preparation_revisions WHERE id=$1',[workspace.preparation_revision_id])).rows[0];
   const materials=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 ORDER BY revision_number',[episodeId])).rows as MediaRow[];
   const artifacts=(await c.query("SELECT * FROM public.artifacts WHERE episode_id=$1 AND (id IN (SELECT source_artifact_id FROM public.audio_tracks WHERE episode_id=$1) OR artifact_type IN ('narration_audio','soundtrack_audio','source_audio','shot_source_audio','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video','generated_image','legacy_recovered_media'))",[episodeId])).rows as MediaRow[];
   const audio=(await c.query('SELECT * FROM public.audio_tracks WHERE episode_id=$1',[episodeId])).rows as MediaRow[];
   const files:StagedFile[]=[],stageRoot=join(this.mediaRoot,'production-copy-staging',session.id,copyId);
   const stage=async(reference:string,path:string,sha256:string,fileSize:number,alias?:string)=>{
    const existing=files.find(file=>file.sha256===sha256&&extname(file.path)===extname(reference));
    if(existing){existing.references.push(reference,...(alias?[alias]:[]));return;}
    const destination=join(stageRoot,'media',sha256+extname(reference));await copyProductionMedia(path,destination,sha256,fileSize);files.push({references:[reference,...(alias?[alias]:[])],path:destination,sha256,fileSize});
   };
   for(const row of [...materials,...artifacts,...audio]){const reference=String(row.storage_path??row.relative_path);await stage(reference,await io.resolveReference(reference),row.sha256,Number(row.file_size));}
   const publication=await readWorkspacePublication(c,root,{id:workspace.id,episode_id:episodeId,content_sha256:workspace.content_sha256,archived_at:null});
   if(publication.cover)await stage(publication.cover.file.relativePath,await io.resolveReference(publication.cover.file.relativePath),publication.cover.file.sha256,publication.cover.file.fileSize);
   for(const file of draft.files)await stage(file.reference,file.path,file.sha256,file.fileSize,file.originalReference);
   const read=async(table:string,where:string,value:string)=>(await c.query(`SELECT * FROM local_identity.${table} WHERE ${where}=$1`,[value])).rows;
   const snapshot:CopySnapshot={episode,workspace,preparation,materials,artifacts,audio,publication,project:draft.project,files,shots:await read('production_shot_versions','preparation_revision_id',workspace.preparation_revision_id),narrationInputs:await read('workspace_narration_inputs','workspace_id',workspace.id),captionInputs:await read('workspace_caption_inputs','workspace_id',workspace.id),decisions:await read('workspace_candidate_decisions','workspace_id',workspace.id),narrations:await read('workspace_narrations','workspace_id',workspace.id),audioPreparations:(await read('workspace_audio_preparations','workspace_id',workspace.id)).filter(row=>row.adopted_item_id)};
   if(Buffer.byteLength(JSON.stringify(snapshot))>16*1024*1024)throw new ConfigurationError(400,'原工程数据超过副本保存上限，请减少未使用素材后重试。');
   await io.assertValid();await c.query('INSERT INTO local_identity.production_copy_intents(owner_id,copy_id,source_episode_id,snapshot) VALUES($1,$2,$3,$4)',[session.id,copyId,episodeId,snapshot]);return snapshot;
  });
 }
 private async initialize(c:PoolClient,s:CopySnapshot,targetId:string,workspaceId:string,copyId:string){
  const root=await resolveEpisodeAssetRoot(c,this.mediaRoot,targetId),io=await episodeFileIO(c,root,targetId,true),mapping:Record<string,string>={[s.episode.id]:targetId,[s.workspace.id]:workspaceId};
  for(const row of [...s.materials,...s.artifacts,...s.audio])mapping[row.id]=productionCopyId(copyId,row.id);
  const prepId=productionCopyId(copyId,String(s.preparation.id));mapping[String(s.preparation.id)]=prepId;
  for(const row of [...s.decisions,...s.audioPreparations]){const id=String(row.candidate_id??row.id);mapping[id]=productionCopyId(copyId,id);}
  for(const binding of s.workspace.bindings)mapping[binding.id]=productionCopyId(copyId,binding.id);
  for(const file of s.files){const relativePath=`${io.relativePath}/materials/${file.sha256}-native-${file.sha256}${extname(file.path)}`;await copyProductionMedia(file.path,join(root,relativePath),file.sha256,file.fileSize);for(const ref of file.references)mapping[ref]=relativePath;}
  let project=remapProductionCopy(s.project,mapping);project.loopControl={version:'four-step-workspace/v1',transitionMode:'studio',...project.loopControl,inputFingerprint:workspaceId,editorAuthority:'native'};
  const bindings=synchronizeWorkspaceBindings(project,remapProductionCopy(s.workspace.bindings,mapping));
  const native=await persistWorkspaceProject(c,root,targetId,project),contentSha=workspaceContentSha256(project);
  const manifest=remapProductionCopy(s.preparation.manifest,mapping),prepFile=await persistPublicationFile(c,root,targetId,`${io.relativePath}/preparation/${prepId}.json`,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  const sourceRow=(row:MediaRow)=>({sourceId:row.id,value:remapProductionCopy(row,mapping)});
  const workspace={...remapProductionCopy(s.workspace,mapping),id:workspaceId,episode_id:targetId,script_revision_id:mapping[s.workspace.script_revision_id],storyboard_package_id:null,preparation_revision_id:prepId,revision:1,native_edit_revision:1,editor_authority:'native',bindings,project_path:native.relativePath,project_sha256:native.sha256,project_size:native.fileSize,content_sha256:contentSha};
  const narrations=remapProductionCopy(s.narrations,mapping).map(row=>({...row,task_id:null,requested_project_sha256:null,requested_native_edit_revision:null,manual_audio_track_id:row.manual_audio_track_id??row.adopted_audio_track_id}));
  const audioPreparations=s.audioPreparations.map(raw=>{
   const row=remapProductionCopy(raw,mapping),track=s.audio.find(track=>track.source_task_id===raw.task_id&&raw.task_id||track.id===(raw.request_snapshot as {audioTrackId?:string})?.audioTrackId);
   if(!track)return{...row,task_id:null,request_snapshot:row.material_revision_id?{}:row.request_snapshot};
   return{...row,task_id:null,request_snapshot:{version:'registered-audio-input/v1',audioTrackId:mapping[track.id],sha256:track.sha256,fileSize:Number(track.file_size),sourceArtifactId:mapping[String(track.source_artifact_id)],sourceTaskId:null}};
  });
  const data={scriptId:mapping[s.workspace.script_revision_id],sourceWorkspaceId:s.workspace.id,narrations,audioPreparations,materials:s.materials.map(sourceRow),artifacts:s.artifacts.map(sourceRow),audio:s.audio.map(sourceRow),workspace,preparation:{...remapProductionCopy(s.preparation,mapping),id:prepId,script_revision_id:mapping[s.workspace.script_revision_id],revision_number:1,source_format:'production-preparation/v1',source_reference_id:null,file_reference:prepFile,manifest,content_sha256:canonicalFingerprint(manifest)},shots:remapProductionCopy(s.shots,mapping),narrationInputs:remapProductionCopy(s.narrationInputs,mapping),captionInputs:remapProductionCopy(s.captionInputs,mapping),decisions:remapProductionCopy(s.decisions,mapping).map(row=>({...row,project_sha256:native.sha256}))};
  await c.query('SELECT local_identity.initialize_production_copy($1,$2,$3)',[s.episode.id,targetId,data]);
  const originalPaths=new Set([...s.materials,...s.artifacts,...s.audio].map(row=>String(row.storage_path??row.relative_path)));
  for(const file of s.files){
   if(file.references.some(reference=>originalPaths.has(reference))||s.publication.cover&&file.references.includes(s.publication.cover.file.relativePath))continue;
   const source=file.references.find(reference=>s.project.assets.some(asset=>asset.src===reference)||s.project.timelines.some(t=>t.items.some(item=>item.src===reference))),asset=s.project.assets.find(asset=>asset.src===source),item=s.project.timelines.flatMap(t=>t.items).find(item=>item.src===source),kind=asset?.kind??item?.kind;
   if(!source||!['video','image','audio'].includes(String(kind))||file.fileSize>100*1024*1024)throw new ConfigurationError(409,'新导入素材无效或超过100 MB，请保留当前修改并调整该素材。');
   const name='native-'+file.sha256+extname(file.path),mime=await validateImportedMaterial(await readFile(file.path),{sourcePath:name,materialType:String(kind),mimeType:'',materialPurpose:'general_reference',isMainScript:false});
   await c.query("SELECT public.import_production_material($1,$2,'file',$3,$4,$5,$6,$7,false,'general_reference')",[targetId,kind,name,mapping[source],mime,file.sha256,file.fileSize]);
  }
  for(const binding of bindings){
   const item=project.timelines.flatMap(t=>t.items).find(item=>item.id===binding.itemId);if(!item||!['video','image'].includes(String(item.kind))||typeof item.src!=='string')continue;
   const source=await resolveWorkspaceSource(c,root,targetId,item.src);binding.source={materialRevisionId:source.id,relativePath:item.src,sha256:source.sha256,fileSize:Number(source.file_size),kind:item.kind as 'video'|'image'};
  }
  project=withWorkspaceShotMetadata(project,bindings);
  let row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[workspaceId])).rows[0] as ProductionWorkspaceRecord;
  const adoptionFingerprints=await rebaseCopiedWorkspaceNarrations(c,row,project);
  const rebased=await persistWorkspaceProject(c,root,targetId,project),rebasedContent=workspaceContentSha256(project);
  await c.query('UPDATE local_identity.production_workspaces SET project_path=$2,project_sha256=$3,project_size=$4,content_sha256=$5,bindings=$6 WHERE id=$1',[workspaceId,rebased.relativePath,rebased.sha256,rebased.fileSize,rebasedContent,JSON.stringify(bindings)]);
  row={...row,bindings,project_path:rebased.relativePath,project_sha256:rebased.sha256,project_size:rebased.fileSize,content_sha256:rebasedContent};
  await c.query('SELECT local_identity.rebase_production_copy_adoptions($1,$2,$3)',[workspaceId,adoptionFingerprints,rebased.sha256]);
  await syncProductionWorkspaceShots(c,row,root);await syncNativeWorkspaceCaptions(c,root,row,project);
  await validateWorkspaceProject(c,root,targetId,project,await this.runtime());await recordWorkspaceVersion(c,row,'从已完成作品保存生产单副本');
  const publication=remapProductionCopy(s.publication,mapping);
  await c.query('INSERT INTO local_identity.workspace_publications(workspace_id,episode_id,content,cover,basis_content_sha256,previous_text) VALUES($1,$2,$3,$4,$5,NULL)',[workspaceId,targetId,publication.content,publication.cover,s.publication.basisContentSha256]);
  if(publication.cover)await c.query('INSERT INTO local_identity.workspace_publication_files(episode_id,relative_path,sha256,file_size) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[targetId,publication.cover.file.relativePath,publication.cover.file.sha256,publication.cover.file.fileSize]);
  const verified=await readProductionWorkspace(c,targetId,root);if(!verified)throw new ConfigurationError(409,'新生产单尚未核实，请保留修改重试。');await io.assertValid();
  if(native.sha256!==rebased.sha256){await verifyEpisodeFile(c,root,targetId,native.relativePath,native.sha256,native.fileSize);await unlink(await io.resolveReference(native.relativePath));}
 }
}
