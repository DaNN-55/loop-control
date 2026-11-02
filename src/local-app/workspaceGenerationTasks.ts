import type {PoolClient} from 'pg';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates.js';
/** Projection of existing task/submission/publication authorities; never creates or retries work. */
export async function readWorkspaceNarrationTasks(c:PoolClient,row:ProductionWorkspaceRecord):Promise<WorkspaceVisualTask[]>{
 return(await c.query(`SELECT r.task_id id,r.shot_id "shotId",t.id "taskId",t.status,t.provider,t.model,t.created_at "createdAt",r.request_snapshot#>>'{connection,name}' "connectionName",s.outcome "submissionOutcome",h.attempt "publicationAttempt",
 coalesce(t.last_result#>>'{blockers,0,detail}',t.last_result#>>'{retry,reason}') error,
 (t.status IN ('failed','blocked') AND s.outcome IN ('started','received')) "submissionUnknown"
 FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id
 LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=t.id LEFT JOIN local_identity.workspace_publication_holds($2) h ON h.task_id=t.id
 WHERE r.workspace_id=$1 AND t.status IN ('ready','running','failed','blocked','completed')
 ORDER BY coalesce(t.status<>'completed' AND (h.task_id IS NOT NULL OR t.status IN ('ready','running') OR s.outcome IN ('started','received')),false) DESC,t.created_at DESC`,[row.id,row.episode_id])).rows;
}
