import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';

/** A local preparation names the original track; it is never a new generation task. */
export async function registeredWorkspaceAudio(c:PoolClient,root:string,episodeId:string,trackId:unknown,kind:'bgm'|'sfx'|'narration'|'source'){
 if(typeof trackId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(trackId))throw new ConfigurationError(400,'音轨标识无效。');
 const track=(await c.query(`SELECT a.* FROM public.audio_tracks a
 JOIN public.artifacts f ON f.id=a.source_artifact_id AND f.episode_id=a.episode_id AND f.relative_path=a.relative_path AND f.sha256=a.sha256 AND f.file_size=a.file_size AND f.producer_task_id IS NOT DISTINCT FROM a.source_task_id
 LEFT JOIN public.tasks t ON t.id=a.source_task_id AND t.episode_id=a.episode_id
 WHERE a.id=$1 AND a.episode_id=$2 AND a.track_kind=$3 AND (a.source_task_id IS NULL OR t.status='completed' AND t.invalidated_at IS NULL)`,[trackId,episodeId,kind])).rows[0];
 if(!track)throw new ConfigurationError(409,'原登记音轨缺失、来源失效或不属于本期。');
 await verifyEpisodeFile(c,root,episodeId,track.relative_path,track.sha256,Number(track.file_size));
 const duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,episodeId),track.relative_path));
 return{track,duration,snapshot:{version:'registered-audio-input/v1',audioTrackId:track.id,sha256:track.sha256,fileSize:Number(track.file_size),sourceTaskId:track.source_task_id,sourceArtifactId:track.source_artifact_id}};
}

/** Preserve generated preparations' join; only local references use the explicit frozen ID. */
export const workspacePreparedAudioJoin=`LEFT JOIN public.audio_tracks a ON a.episode_id=p.episode_id AND (
 p.task_id IS NOT NULL AND a.source_task_id=t.id
 OR p.task_id IS NULL AND p.request_snapshot->>'version'='registered-audio-input/v1'
 AND a.id::text=p.request_snapshot->>'audioTrackId' AND a.track_kind=p.kind
 AND a.sha256=p.request_snapshot->>'sha256' AND a.file_size::text=p.request_snapshot->>'fileSize'
 AND a.source_artifact_id::text=p.request_snapshot->>'sourceArtifactId'
 AND a.source_task_id::text IS NOT DISTINCT FROM (p.request_snapshot->>'sourceTaskId')
 AND EXISTS(SELECT 1 FROM public.artifacts f LEFT JOIN public.tasks original ON original.id=a.source_task_id AND original.episode_id=a.episode_id
 WHERE f.id=a.source_artifact_id AND f.episode_id=a.episode_id AND f.relative_path=a.relative_path AND f.sha256=a.sha256 AND f.file_size=a.file_size AND f.producer_task_id IS NOT DISTINCT FROM a.source_task_id
 AND (a.source_task_id IS NULL OR original.status='completed' AND original.invalidated_at IS NULL))
)`;
