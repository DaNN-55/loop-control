import type {OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import {openChatCutBundledSounds,openChatCutBundledSoundVersion,bundledSoundMaterialName} from '../openchatcutBundledSounds.js';
import {readTrustedBundledSound} from '../worker/openchatcutBundledSounds.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {snapshotInput} from './localFiles.js';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
/** One trust boundary for native document paths: never promote a task artifact to a fake material. */
export async function resolveWorkspaceSource(c:PoolClient,root:string,episodeId:string,path:string){
 try{
 const material=(await c.query('SELECT id,storage_path relative_path,sha256,file_size,material_type kind FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2',[episodeId,path])).rows[0];
 if(material){await verifyEpisodeFile(c,root,episodeId,path,material.sha256,Number(material.file_size));return{...material,registration:'material' as const};}
 const audio=(await c.query(`SELECT a.id,a.relative_path,a.sha256,a.file_size,a.duration_seconds,a.source_artifact_id artifact_id,a.source_task_id task_id
 FROM public.audio_tracks a JOIN public.artifacts f ON f.id=a.source_artifact_id AND f.episode_id=a.episode_id AND f.relative_path=a.relative_path AND f.sha256=a.sha256 AND f.file_size=a.file_size
 LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND (a.source_task_id IS NULL OR t.status='completed')`,[episodeId,path])).rows[0];
 if(audio){await verifyEpisodeFile(c,root,episodeId,path,audio.sha256,Number(audio.file_size));return{...audio,kind:'audio',registration:'audio_track' as const};}
 const artifact=(await c.query(`SELECT a.id,a.relative_path,a.sha256,a.file_size,a.producer_task_id task_id,a.artifact_type
 FROM public.artifacts a JOIN public.tasks t ON t.id=a.producer_task_id AND t.episode_id=a.episode_id AND t.status='completed'
 WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.artifact_type IN ('narration_audio','soundtrack_audio','source_audio','shot_source_audio','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video','generated_image','legacy_recovered_media')`,[episodeId,path])).rows[0];
 if(!artifact)throw new ConfigurationError(409,'工程引用了未注册的本期素材或已完成任务产物。');
 await verifyEpisodeFile(c,root,episodeId,path,artifact.sha256,Number(artifact.file_size));return{...artifact,registration:'task_artifact' as const};
 }catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'已用素材缺失或指纹已变化，请检查原文件。');}
}

/** Accept only a pinned bundled sound at this episode's exact material coordinate. */
export async function registerWorkspaceBundledSound(c:PoolClient,root:string,episodeId:string,path:string,config:OpenChatCutRuntimeConfig){
 const entry=Object.entries(openChatCutBundledSounds).find(([id,sound])=>path.endsWith(`/materials/${sound.sha256}-${bundledSoundMaterialName(id)}`));
 if(!entry)return;
 const io=await episodeFileIO(c,root,episodeId,true);
 if(path!==`${io.relativePath}/materials/${entry[1].sha256}-${bundledSoundMaterialName(entry[0])}`)return;
 const[id,sound]=entry,origin=`openchatcut-bundled/${openChatCutBundledSoundVersion}/${sound.sha256}/${bundledSoundMaterialName(id)}`;
 const registered=(await c.query('SELECT id,storage_path,sha256,file_size,source_path FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2',[episodeId,path])).rows[0];
 if(registered){
  if(registered.sha256!==sound.sha256||Number(registered.file_size)!==sound.fileSize)throw new ConfigurationError(409,'内置音效来源证据已变化。');
  await verifyEpisodeFile(c,root,episodeId,path,sound.sha256,sound.fileSize);return;
 }
 const sdkRoot=config.root?.trim()||process.env.OPENCHATCUT_ROOT?.trim();if(!sdkRoot)throw new ConfigurationError(409,'内置音效库不可用，请恢复当前 Studio 安装后重试。');
 let bytes:Buffer;try{bytes=await readTrustedBundledSound(sdkRoot,id);}catch{throw new ConfigurationError(409,'内置音效文件不可用或指纹已变化，请恢复当前 Studio 安装后重试。');}
 await io.assertValid();const file=await snapshotInput(root,episodeId,{sourceKind:'file',sourcePath:bundledSoundMaterialName(id),contentBase64:bytes.toString('base64')},io.relativePath);await io.assertValid();
 await c.query("SELECT public.import_production_material($1,'audio','file',$2,$3,'audio/mpeg',$4,$5,false,'sound_effect')",[episodeId,origin,file.storagePath,sound.sha256,sound.fileSize]);
}
