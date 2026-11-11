import type {PoolClient} from 'pg';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates.js';
import {workspaceUnknownRetryAllowed,workspaceTaskRetryColumns,projectWorkspaceTaskRetry} from './workspaceTaskRetry.js';
/** Projection of existing task/submission/publication authorities; never creates or retries work. */
export async function readWorkspaceNarrationTasks(c:PoolClient,row:ProductionWorkspaceRecord):Promise<WorkspaceVisualTask[]>{
 return(await c.query(`SELECT ${workspaceTaskRetryColumns},r.task_id id,r.shot_id "shotId",t.id "taskId",t.status,t.provider,t.model,t.created_at "createdAt",r.request_snapshot#>>'{connection,name}' "connectionName",CASE WHEN t.last_result#>>'{blockers,0,code}'='PROVIDER_REQUEST_NOT_SENT' OR local_identity.provider_dispatch_observation(t.id)->>'phase' IN ('preparing','reserved') THEN 'not_sent' ELSE s.outcome END "submissionOutcome",local_identity.provider_dispatch_observation(t.id) "dispatchObservation",
 (SELECT child.task_id FROM local_identity.workspace_narration_requests child WHERE child.workspace_id=r.workspace_id AND child.shot_id=r.shot_id AND child.request_snapshot->>'retryOfTaskId'=t.id::text LIMIT 1) "retryTaskId",coalesce((r.request_snapshot->>'reservationCents')::integer,t.budget_limit_cents) "reservationCents",h.attempt "publicationAttempt",
 coalesce(t.last_result#>>'{blockers,0,detail}',t.last_result#>>'{retry,reason}') error,
 (t.status IN ('failed','blocked') AND coalesce(local_identity.provider_dispatch_observation(t.id)->>'phase','dispatching') NOT IN ('preparing','reserved','rejected') AND (s.outcome IN ('started','received') OR coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb)) "submissionUnknown"
 FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id
 LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=t.id LEFT JOIN local_identity.workspace_publication_holds($2) h ON h.task_id=t.id
 WHERE r.workspace_id=$1 AND t.status IN ('ready','running','failed','blocked','completed','superseded')
 ORDER BY coalesce(t.status<>'completed' AND (h.task_id IS NOT NULL OR t.status IN ('ready','running') OR s.outcome IN ('started','received') OR coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb),false) DESC,t.created_at DESC`,[row.id,row.episode_id])).rows.map(task=>{const result=projectWorkspaceTaskRetry(task);return{...result,unknownRetryAllowed:workspaceUnknownRetryAllowed(result)};});
}
