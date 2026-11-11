import type {WorkspaceVisualTask} from './workspaceVisualCandidates';

type TaskEvidence=Pick<WorkspaceVisualTask,'status'|'publicationAttempt'|'submissionUnknown'|'submissionOutcome'|'canResume'|'retryTaskId'|'invalidated'|'waitingForRetry'|'retryAllowed'>;
const presentations={
 'publication-held':{label:'发布结果待核对',summary:'发布待核对'},
 'not-sent':{label:'未提交',summary:'未提交'},
 'provider-result-unknown':{label:'供应商结果待核对',summary:'结果待核对'},
 'submission-unknown':{label:'提交结果未知',summary:'结果待核对'},
 ready:{label:'等待生成',summary:'准备中'},
 running:{label:'生成中',summary:'准备中'},
 'retry-wait':{label:'等待重试',summary:'等待重试'},
 failed:{label:'生成失败',summary:'失败'},
 blocked:{label:'生成受阻',summary:'待核对'},
 completed:{label:'生成完成',summary:'可用'},
 superseded:{label:'已失效',summary:'已失效'},
 unknown:{label:'状态待核对',summary:'状态待核对'},
} as const;

/** Read-only projection of existing authorities, never permission to submit work. See ADR-0034. */
export function workspaceTaskPresentation(task:TaskEvidence){
 const held=task.publicationAttempt!=null,unknown=!!task.submissionUnknown;
 const stopped=task.status==='failed'||task.status==='blocked';
 const state=held?'publication-held':unknown?(task.submissionOutcome==='received'?'provider-result-unknown':'submission-unknown'):task.invalidated?'superseded':task.waitingForRetry?'retry-wait':task.submissionOutcome==='not_sent'?'not-sent'
  :task.status==='ready'||task.status==='running'||task.status==='failed'||task.status==='blocked'||task.status==='completed'||task.status==='superseded'?task.status:'unknown';
 return{state,...presentations[state],held,unknown,stopped,hidden:!!task.retryTaskId,
  active:!held&&!unknown&&!task.invalidated&&(task.status==='ready'||task.status==='running'),
  canResume:!!task.canResume&&!held&&!task.invalidated&&!task.waitingForRetry&&stopped,
  canRetry:stopped&&!held&&!unknown&&!task.invalidated&&!task.waitingForRetry&&task.retryAllowed!==false,
 };
}
