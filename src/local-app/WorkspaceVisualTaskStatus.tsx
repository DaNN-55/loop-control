import './workspace-task-status.css';
import {useEffect,useState,useId} from 'react';
import {createPortal} from 'react-dom';
import {useDialogFocus} from '../ui/useDialogFocus';
import {ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useSurfacePresence} from '../ui/SurfacePresence';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
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
 const [open,setOpen]=useState(false);
 const presentation=workspaceTaskPresentation(task),{held,unknown,label:state}=presentation;
 if(presentation.hidden)return null;
 const actions=<>
  {onRetryUnknown&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onRetryUnknown}>重试图片生成</Button>}
  {presentation.canResume&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onResume}>{resumeLabel}</Button>}
  {held&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onReconcile}>核对并恢复产物</Button>}
  {(unknown||held)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={onRefresh}>刷新核对结果</Button>}
 </>;
 return <>
  <div className="workspace-visual-task" inert={open} aria-hidden={open||undefined}>
   <div className="workspace-task-summary">
    <p role={task.error||held?'alert':'status'} aria-label={taskNoun+' '+task.taskId} title={task.error??undefined}>{label}{state}{task.error?' · '+task.error:''}</p>
    <div className="workspace-task-actions">{actions}<Button size="sm" color="tertiary" aria-label={`查看${label}任务详情`} onPress={()=>setOpen(true)}>详情</Button></div>
   </div>
   {presentation.active&&<WorkspaceVisualTaskProgress task={task} label={label}/>}
  </div>
  <ConfirmationModalPresence>{open&&createPortal(<TaskDetails title={`${label}任务详情`} onClose={()=>setOpen(false)}>
   <p className="workspace-task-diagnostic" role="alert">{label}{state}{task.error?' · '+task.error:''}</p>
   {task.submissionOutcome==='not_sent'&&<p>本次请求在本机被拦截，未向供应商发送。请检查设置，重新确认后生成。</p>}
   {task.submissionOutcome==='rejected'&&<p>供应商已明确拒绝本次请求，请根据错误原因检查设置后重新确认。</p>}
   {task.kind==='image'&&presentation.canRetry&&<p>可检查设置后点击「重新生成图片」，核对费用并再次确认。</p>}
   {unknown&&<p>{onRetryUnknown?'上一次可能已产生费用。你可以先核对供应商记录，也可以重新确认后提交新请求。':'请先在原供应商核对本次请求；当前结果未知，不能再次提交生成。'}</p>}
   {task.canResume&&!held&&<p>恢复只查询原供应商任务，沿用原输入，不会重新提交生成。</p>}
   {held&&<p>已有产物等待核对。核对只恢复本次发布，不会重新生成。</p>}
   <dl className="workspace-task-metadata">
    {(task.connectionName||task.provider)&&<><dt>连接与模型</dt><dd>{task.connectionName??task.provider}{task.model?` · ${task.model}`:''}</dd></>}
    {task.createdAt&&<><dt>提交时间</dt><dd>{new Date(task.createdAt).toLocaleString('zh-CN',{hour12:false})}</dd></>}
    {task.reservationCents!=null&&<><dt>费用预留</dt><dd>¥{(task.reservationCents/100).toFixed(2)}<small>实际扣费以供应商账单为准</small></dd></>}
    <dt>原任务</dt><dd>{task.taskId}{held?` · 尝试 ${task.publicationAttempt}`:''}</dd>
    {task.providerTaskId&&<><dt>供应商任务</dt><dd>{task.providerTaskId}</dd></>}
   </dl>
   {unknown&&!task.providerTaskId&&<p>本机未保存供应商任务编号，请按连接、模型和提交时间核对供应商调用记录。</p>}
   <div className="modal-actions">{actions}{(unknown||task.submissionOutcome==='rejected'||task.submissionOutcome==='not_sent')&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setOpen(false);window.dispatchEvent(new Event('open-external-connections'));}}>打开连接配置</Button>}</div>
  </TaskDetails>,document.body)}</ConfirmationModalPresence>
 </>;
}
function TaskDetails({title,onClose,children}:{title:string;onClose:()=>void;children:import('react').ReactNode}){
 const presence=useSurfacePresence(),present=presence?.present??true,id=useId(),ref=useDialogFocus<HTMLDivElement>(present,onClose);
 return <div className="dan-ui product-ui workspace-task-overlay"><div ref={presence?.ref} className="modal-backdrop workspace-task-backdrop" inert={!present} aria-hidden={!present||undefined} onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="modal-card confirmation-modal workspace-task-detail"><header><h2 id={id}>{title}</h2><Button size="sm" color="tertiary" data-dialog-initial-focus onPress={onClose} aria-label={`关闭${title}`}>关闭</Button></header><div className="workspace-task-detail-body">{children}</div></div></div></div>;
}
