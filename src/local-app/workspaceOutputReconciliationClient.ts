import {localRequest} from './client';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
export async function reconcileWorkspaceOutput(episodeId:string,task:Pick<WorkspaceVisualTask,'taskId'|'publicationAttempt'>){
 return localRequest('native-output/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({episodeId,taskId:task.taskId,attempt:task.publicationAttempt})});
}
