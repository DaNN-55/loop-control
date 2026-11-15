import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {ConfigurationError} from './configurationCommands.js';

type ProjectItem=OpenChatCutProject['timelines'][number]['items'][number];
interface NarrationTrack {
 id:string;relative_path:string;sha256:string;source_task_id:string|null;duration_seconds:number|string;
 input_snapshot:{media?:{narration?:{text?:string}}}|null;
}
interface Adoption {
 text_version:string;main_script_text:string;input_fingerprint:string;
}

/** Validate serialized native identities before they reach PostgreSQL UUID parameters. */
export function workspaceNarrationTrackId(item:ProjectItem|undefined){
 const identity=item?.sourceAssetId;
 if(typeof identity!=='string'||!identity.startsWith('audio-track-'))return null;
 const id=identity.match(/^audio-track-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i)?.[1];
 if(!id)throw new ConfigurationError(409,'工程口播音轨身份无效，请明确选择已登记的来源后重新保存。');
 return id;
}

/** Resolve the confirmed native source, including distinct tracks backed by the same file. */
export async function readWorkspaceNarrationSource(c:PoolClient,row:{id:string;episode_id:string},item:ProjectItem){
 if(typeof item.src!=='string')return null;
 const trackId=workspaceNarrationTrackId(item);
 if(item.sourceAssetId!=null&&!trackId)throw new ConfigurationError(409,'工程口播音轨身份无效，请明确选择已登记的来源后重新保存。');
 const tracks=(await c.query<NarrationTrack>(`SELECT a.*,t.input_snapshot FROM public.audio_tracks a LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.track_kind='narration' AND ($3::uuid IS NULL OR a.id=$3)`,[row.episode_id,item.src,trackId])).rows;
 if(tracks.length>1)throw new ConfigurationError(409,'口播文件对应多条音轨，请在原生工程中明确选择来源后重新保存。');
 const track=tracks[0];
 if(!track){
  if(trackId)throw new ConfigurationError(409,'工程引用的口播音轨与已登记来源不一致，请重新核对。');
  return null;
 }
 if(item.sourceContentHash&&item.sourceContentHash!==track.sha256)throw new ConfigurationError(409,'工程口播内容指纹与已登记音轨不一致，请重新核对。');
 const hasDecisions=!!(await c.query("SELECT to_regclass('local_identity.workspace_candidate_decisions') present")).rows[0].present;
 const marker=(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint;
 const adoption=hasDecisions?(await c.query<Adoption>(`SELECT text_version,main_script_text,input_fingerprint FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3 AND ($4::text IS NULL OR input_fingerprint=$4)`,[row.id,track.id,track.sha256,marker??null])).rows[0]:undefined;
 return{track,adoption,text:adoption?.text_version??track.input_snapshot?.media?.narration?.text??null};
}
