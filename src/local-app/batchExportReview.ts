import type {Pool,PoolClient} from 'pg';
import type {WorkspaceExportArtifact} from '../workspaceExport.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {readWorkspaceExports} from './workspaceExportCommands.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {ownerTransaction} from './ownerTransaction.js';

export type BatchExportReview=
 |{status:'ready';artifact:WorkspaceExportArtifact;reviewFingerprint:string}
 |{status:'skipped'|'unavailable';reason:string};

export async function resolveExportReview(c:PoolClient,root:string,workspace:ProductionWorkspaceRecord|undefined){
 if(!workspace)return {review:{status:'skipped',reason:'这张生产单还没有导出成片。'} as const};
 const {exports:[latest]}=await readWorkspaceExports(c,root,workspace,true);
 if(!latest)return {review:{status:'skipped',reason:'这张生产单还没有导出成片。'} as const};
 const basis=await c.query(`SELECT w.editor_authority='native' OR
    (e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(w.preparation_revision_id)) current
    FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id WHERE w.id=$1`,[workspace.id]);
 if(!latest.current||!basis.rows[0]?.current)return {review:{status:'unavailable',reason:'成片对应的工程已变化，请在生产单中重新导出。'} as const};
 if(latest.confirmedAt)return {review:{status:'skipped',reason:'当前成片已确认。'} as const};
 const failedCheck=latest.checks.find(check=>!check.passed);
 if(latest.status!=='ready'||failedCheck||!latest.artifact||!latest.artifact.relativePath.endsWith('.mp4')){
  const reason=failedCheck?.name==='native_export'?'本机导出失败，可重试。':failedCheck?.detail||'当前成片文件不可用或检查未通过。';
  return {review:{status:'unavailable',reason} as const};
 }
 const confirmation={workspaceId:workspace.id,expectedRevision:Number(workspace.revision),exportId:latest.id,expectedExportSha256:latest.artifact.sha256,expectedContentSha256:latest.contentSha256};
 const review:BatchExportReview={status:'ready',artifact:latest.artifact,reviewFingerprint:canonicalFingerprint({episodeId:workspace.episode_id,confirmation,artifact:latest.artifact,project:latest.project})};
 return {review,confirmation};
}

export async function readBatchExportReview(pool:Pool,mediaRoot:string,ownerId:string,episodeId:string):Promise<BatchExportReview>{
 return ownerTransaction(pool,ownerId,true,async c=>{
  const episode=(await c.query(`SELECT e.archived_at,e.stage,local_identity.is_historical_episode(e.id) historical
    FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
    WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'`,[episodeId,ownerId])).rows[0];
  if(!episode)throw new ConfigurationError(404,'生产单不可见。');
  if(episode.archived_at||episode.stage==='production_completed'||episode.historical)return {status:'skipped',reason:'历史或已完成生产单只读。'};
  const workspace=(await c.query(`SELECT w.* FROM local_identity.production_workspaces w
    JOIN local_identity.input_episodes i ON i.episode_id=w.episode_id
    WHERE w.episode_id=$1 AND i.owner_id=$2`,[episodeId,ownerId])).rows[0] as ProductionWorkspaceRecord|undefined;
  if(!workspace)return {status:'skipped',reason:'这张生产单还没有导出成片。'};
  const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId);
  return (await resolveExportReview(c,root,workspace)).review;
 });
}
