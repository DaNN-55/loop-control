import './workspace-task-status.css';
import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
export function WorkspaceVisualTaskProgress({task,label,thumbnail=false}:{task:WorkspaceVisualTask;label:string;thumbnail?:boolean}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[]);
 const seconds=Math.floor(Math.max(0,now-Date.parse(task.createdAt??''))/1000);
 const elapsed=Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:null;
 const stage=task.status==='ready'||task.videoPhase==='queued'?0:task.videoPhase==='saving'||task.kind==='image'&&task.submissionOutcome==='received'?2:1;
 const detail=task.status==='ready'?'等待后台开始任务':task.videoPhase==='queued'?'供应商排队中'
  :task.videoPhase==='saving'?'正在下载并保存视频':task.videoPhase==='processing'?'供应商正在生成视频'
  :stage===2?'已收到图片，正在验证并保存':task.kind==='image'
  ?task.submissionOutcome==='started'?'等待供应商返回图片':'正在准备生成请求'
  :task.providerTaskId?'正在查询供应商任务':'正在提交视频任务';
 return <div className={`workspace-visual-progress${thumbnail?' is-thumbnail':''}`} role="progressbar" aria-label={label+'生成进度'} aria-valuetext={detail} title={detail}>
  <span className="workspace-task-ring" aria-hidden="true"/>
  <div className="workspace-visual-progress-heading"><span>{thumbnail?(stage===0?'排队中':stage===2?'保存中':'生成中'):detail}</span>{elapsed&&<span>{thumbnail?elapsed:`已等待 ${elapsed}`}</span>}</div>
 </div>;
}
export function WorkspaceVisualTaskStatus({task,label,disabled,onResume,onRefresh,onReconcile,onRetryUnknown,taskNoun='视觉任务',resumeLabel='恢复画面任务'}:{task:WorkspaceVisualTask;label:string;taskNoun?:string;resumeLabel?:string;disabled?:boolean;onResume:()=>void;onRefresh:()=>void;onReconcile:()=>void;onRetryUnknown?:()=>void}){
 if(task.retryTaskId)return null;
 const held=task.publicationAttempt!=null,unknown=task.submissionUnknown;
 const state=held?'发布结果待核对':unknown?(task.submissionOutcome==='received'?'供应商结果待核对':'提交结果未知'):task.status==='running'?'生成中':task.status==='ready'?'等待生成':task.status==='failed'?'生成失败':task.status==='blocked'?'生成受阻':task.status==='completed'?'生成完成':task.status==='superseded'?'已失效':'状态待核对';
 return <div className="workspace-visual-task"><p role={task.error||held?'alert':'status'} aria-label={taskNoun+' '+task.taskId}>{label}{state}{task.error?' · '+task.error:''}</p>
 {!held&&!unknown&&(task.status==='running'||task.status==='ready')&&<WorkspaceVisualTaskProgress task={task} label={label}/>}
 {task.submissionOutcome==='rejected'&&<p>供应商已明确拒绝本次请求。</p>}
 {task.kind==='image'&&!unknown&&!held&&['failed','blocked'].includes(task.status)&&<p>可检查设置后点击「重新生成图片」，核对费用并再次确认。</p>}
 {unknown&&<p>{onRetryUnknown?'上一次可能已产生费用。你可以先核对供应商记录，也可以重新确认后提交新请求。':'请先在原供应商核对本次请求；当前结果未知，不能再次提交生成。'}</p>}
 {onRetryUnknown&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onRetryUnknown}>重试图片生成</Button>}
 {task.canResume&&!held&&['failed','blocked'].includes(task.status)&&<><p>恢复只查询原供应商任务，沿用已冻结的输入，不会重新提交生成。</p><Button size="sm" color="secondary" isDisabled={disabled} onPress={onResume}>{resumeLabel}</Button></>}
 {held&&<><p>已有产物等待核对。核对只恢复本次发布，不会重新生成。</p><Button size="sm" color="secondary" isDisabled={disabled} onPress={onReconcile}>核对并恢复产物</Button></>}
 {(unknown||held)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onRefresh}>刷新核对结果</Button>}
 {(unknown||held||task.canResume)&&<details><summary>任务信息</summary>{(task.connectionName||task.provider)&&<p>{task.connectionName??task.provider}{task.model?` · ${task.model}`:''}</p>}{task.createdAt&&<p>提交时间 {new Date(task.createdAt).toLocaleString('zh-CN',{hour12:false})}</p>}<p>原任务 {task.taskId}{held?` · 尝试 ${task.publicationAttempt}`:''}</p>{task.providerTaskId&&<p>供应商任务 {task.providerTaskId}</p>}</details>}
 </div>;
}
