import type {ProductionWorkspace} from '../productionWorkspace';
import {definiteStoryboardFailure,latestStoryboardTask,type StoryboardBatchKind} from '../storyboardBatch';
import type {WorkspaceCandidate} from '../workspaceCandidates';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';

function shotProgress(task:WorkspaceVisualTask|undefined,candidate:WorkspaceCandidate|undefined){
 const presentation=task&&workspaceTaskPresentation(task);
 if(presentation?.held)return {status:'发布待核对',targetItemId:task?.targetItemId} as const;
 if(presentation?.active)return {status:task?.status==='running'?'生成中':task?.waitingForRetry?'等待重试':'待执行',targetItemId:task?.targetItemId} as const;
 if(presentation?.unknown||presentation?.stopped&&task?.submissionOutcome==='started'){
  return {status:'回执未知',error:task?.error,targetItemId:task?.targetItemId} as const;
 }
 if(presentation?.stopped&&(task?.canResume||task?.submissionOutcome==='received')){
  return {status:'结果待核对',error:task?.error,targetItemId:task?.targetItemId} as const;
 }
 if(presentation?.stopped&&task&&!task.invalidated){
  return {status:'失败',error:task.error||'生成未完成，请核对原任务与连接。',failureTaskId:definiteStoryboardFailure(task)?task.taskId:undefined,targetItemId:task.targetItemId} as const;
 }
 if(candidate?.status==='available')return {status:'待采用',targetItemId:candidate.targetItemId} as const;
 if(candidate?.status==='adopted')return {status:'已采用',targetItemId:candidate.targetItemId} as const;
}

export function workspaceStoryboardProgress(workspace:ProductionWorkspace,shotId:string){
 const narration=workspace.narration?.find(n=>n.shotId===shotId);
 const voices=workspace.candidates?.filter(c=>c.shotId===shotId&&c.kind==='audio')??[];
 const speech=voices.find(c=>c.status==='available')??voices.find(c=>c.status==='adopted');
 const videoTasks=workspace.visualTasks?.filter(t=>t.shotId===shotId&&t.kind==='video')??[];
 const pendingVideo=videoTasks.find(t=>{const state=workspaceTaskPresentation(t);return !state.hidden&&(state.active||state.held||state.unknown||state.canResume||state.stopped&&(t.submissionOutcome==='started'||t.submissionOutcome==='received'));});
 const videos=workspace.visualCandidates?.filter(c=>c.shotId===shotId&&c.kind==='video'&&!!c.taskId)??[];
 const video=videos.find(c=>c.status==='available')??videos.find(c=>c.status==='adopted');
 const progress:Record<StoryboardBatchKind,ReturnType<typeof shotProgress>>={
  speech:shotProgress(narration?.generationTask,speech),
  video:shotProgress(pendingVideo??latestStoryboardTask(videoTasks),video),
 };
 return progress;
}
