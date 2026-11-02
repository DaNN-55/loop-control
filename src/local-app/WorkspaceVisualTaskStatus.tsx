import './workspace-task-status.css';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
export function WorkspaceVisualTaskStatus({task,label,disabled,onResume,onRefresh,onReconcile,taskNoun='视觉任务',resumeLabel='恢复画面任务'}:{task:WorkspaceVisualTask;label:string;taskNoun?:string;resumeLabel?:string;disabled?:boolean;onResume:()=>void;onRefresh:()=>void;onReconcile:()=>void}){
 const held=task.publicationAttempt!=null,unknown=task.submissionUnknown;
 const state=held?'发布结果待核对':unknown?(task.submissionOutcome==='received'?'供应商结果待核对':'提交结果未知'):task.status==='running'?'生成中':task.status==='ready'?'等待生成':task.status==='failed'?'生成失败':task.status==='blocked'?'生成受阻':task.status==='completed'?'生成完成':task.status==='superseded'?'已失效':'状态待核对';
 return <div className="workspace-visual-task"><p role={task.error||held?'alert':'status'} aria-label={taskNoun+' '+task.taskId}>{label}{state}{task.error?' · '+task.error:''}</p>
 {task.submissionOutcome==='rejected'&&<p>供应商已明确拒绝本次请求。</p>}
 {unknown&&<p>请先在原供应商核对本次请求；当前结果未知，不能再次提交生成。</p>}
 {task.canResume&&!held&&['failed','blocked'].includes(task.status)&&<><p>恢复只查询原供应商任务，沿用已冻结的输入，不会重新提交生成。</p><Button size="sm" color="secondary" isDisabled={disabled} onPress={onResume}>{resumeLabel}</Button></>}
 {held&&<><p>已有产物等待核对。核对只恢复本次发布，不会重新生成。</p><Button size="sm" color="secondary" isDisabled={disabled} onPress={onReconcile}>核对并恢复产物</Button></>}
 {(unknown||held)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onRefresh}>刷新核对结果</Button>}
 {(unknown||held||task.canResume)&&<details><summary>任务信息</summary>{(task.connectionName||task.provider)&&<p>{task.connectionName??task.provider}{task.model?` · ${task.model}`:''}</p>}{task.createdAt&&<p>提交时间 {new Date(task.createdAt).toLocaleString('zh-CN',{hour12:false})}</p>}<p>原任务 {task.taskId}{held?` · 尝试 ${task.publicationAttempt}`:''}</p>{task.providerTaskId&&<p>供应商任务 {task.providerTaskId}</p>}</details>}
 </div>;
}
