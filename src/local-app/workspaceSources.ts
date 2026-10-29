import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
/** One trust boundary for native document paths: never promote a task artifact to a fake material. */
export async function resolveWorkspaceSource(c:PoolClient,root:string,episodeId:string,path:string){
 const material=(await c.query('SELECT id,storage_path relative_path,sha256,file_size,material_type kind FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2',[episodeId,path])).rows[0];
 if(material){await verifyNativeFile(root,path,material.sha256,Number(material.file_size));return{...material,registration:'material' as const};}
 const audio=(await c.query(`SELECT a.id,a.relative_path,a.sha256,a.file_size,a.duration_seconds,a.source_artifact_id artifact_id,a.source_task_id task_id
 FROM public.audio_tracks a JOIN public.artifacts f ON f.id=a.source_artifact_id AND f.episode_id=a.episode_id AND f.relative_path=a.relative_path AND f.sha256=a.sha256 AND f.file_size=a.file_size
 LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND (a.source_task_id IS NULL OR t.status='completed')`,[episodeId,path])).rows[0];
 if(audio){await verifyNativeFile(root,path,audio.sha256,Number(audio.file_size));return{...audio,kind:'audio',registration:'audio_track' as const};}
 const artifact=(await c.query(`SELECT a.id,a.relative_path,a.sha256,a.file_size,a.producer_task_id task_id,a.artifact_type
 FROM public.artifacts a JOIN public.tasks t ON t.id=a.producer_task_id AND t.episode_id=a.episode_id AND t.status='completed'
 WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.artifact_type IN ('narration_audio','soundtrack_audio','source_audio','render','shot_clip','generated_video','generated_image')`,[episodeId,path])).rows[0];
 if(!artifact)throw new ConfigurationError(409,'工程引用了未注册的本期素材或已完成任务产物。');
 await verifyNativeFile(root,path,artifact.sha256,Number(artifact.file_size));return{...artifact,registration:'task_artifact' as const};
}
