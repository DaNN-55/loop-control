import {uiText} from '../i18n/ui';
import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {useId,useRef,useState} from 'react';
import {Check,FileVideo,MessageSquarePlus} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceExportDeliveryState,type WorkspaceExportAction} from '../workspaceExportDelivery';
import './workspace-compact-panels.css';
export function WorkspaceExportPanel({workspace:w,pending,command,onChange,readOnly=false}:{workspace:ProductionWorkspace;pending:boolean;readOnly?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [reason,setReason]=useState(''),[recording,setRecording]=useState(false),[issueError,setIssueError]=useState(''),issueErrorId=useId(),recordingRef=useRef(false),issueScope=useRef('');issueScope.current=`${w.episodeId}:${w.id}`;
 const [action,setAction]=useState<WorkspaceExportAction|null>(null),actionRef=useRef(false),[issuesOpen,setIssuesOpen]=useState(false);
 const {review}=workspaceExportDeliveryState(w,{readOnly,pending,action}),{latest,issues,blocked,completed,confirmed,outdated}=review;
 async function run(name:WorkspaceExportAction,extra:Record<string,unknown>={}){if(actionRef.current)return;actionRef.current=true;setAction(name);try{const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});onChange(result as ProductionWorkspace);}finally{actionRef.current=false;setAction(null);}}
 async function recordIssue(){if(recordingRef.current||!reason.trim())return;const submitted=reason,scope=issueScope.current;recordingRef.current=true;setRecording(true);setIssueError('');try{await run('recordWorkspaceExportIssue',{...(latest?{exportId:latest.id}:{}),reason:submitted});if(issueScope.current===scope)setReason(current=>current===submitted?'':current);}catch(cause){if(issueScope.current===scope)setIssueError(cause instanceof Error?cause.message:'问题记录失败，请重试。');}finally{recordingRef.current=false;setRecording(false);}}
 return <section className="production-workspace-section workspace-export workspace-export-compact workspace-review-flow">
  <header><div className="workspace-compact-heading"><h3>{uiText("检查与交付")}</h3><span role="status" className={review.tone}>{uiText(review.status)}</span></div>{review.exportAction.visible&&<Button size="sm" color={latest?'secondary':'primary'} isDisabled={review.exportAction.disabledReason!==null} onPress={()=>void run('exportWorkspace').catch(()=>{})}>
   {uiText(review.exportAction.label)}
  </Button>}</header>
  {w.readiness.placeholders.length>0&&<p className="workspace-export-notice">{uiText("还有 ")}{w.readiness.placeholders.length}{uiText(" 处占位")}</p>}
  {outdated&&<p role="status" className="workspace-export-notice">{uiText("工程已变化，请重新导出当前内容。")}{latest?.projectContentVersion!==undefined&&<span> {uiText("导出 v{exportVersion} → 当前 v{currentVersion}",{exportVersion:String(latest.projectContentVersion),currentVersion:String(w.revision)})}</span>}</p>}
  <div className="workspace-export-layout">
   <div className="workspace-final-preview">
    <div className="workspace-final-heading"><h4>{uiText("成片预览")}</h4></div>
    {latest?.artifact?<VideoPreview title={uiText("最终导出视频")} aria-label={uiText("最终导出视频")} sourceLabel={uiText("成片")} src={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(latest.artifact.relativePath)}&sha256=${latest.artifact.sha256}`}/>:<div className="workspace-final-empty"><FileVideo aria-hidden="true"/><p>{uiText(review.previewMessage)}</p></div>}
    {latest&&<div className="workspace-final-actions">{confirmed?<p role="status" className="workspace-final-confirmed"><Check size={15} aria-hidden="true"/>{uiText("已确认这份最终文件")}</p>:<>
     <span className="workspace-final-next">{uiText(review.nextMessage)}</span>
     <Button size="sm" color="primary" iconLeading={Check} isDisabled={review.confirmAction.disabledReason!==null} onPress={()=>void run('confirmWorkspaceExport',{exportId:latest.id,expectedExportSha256:latest.artifact?.sha256,expectedContentSha256:w.contentSha256}).catch(()=>{})}>{uiText(review.confirmAction.label)}</Button>
    </>}</div>}
   </div>
   <div className="workspace-export-review">
    <details className="workspace-technical-checks" aria-label={uiText("技术检查")} open={latest?.checks.some(c=>!c.passed)||undefined}><summary className="workspace-review-heading"><h4>{uiText("技术检查")}</h4>{latest&&<span className={latest.checks.length&&latest.checks.every(c=>c.passed)?'is-confirmed':'is-failed'}>{latest.checks.length?uiText("{value0} / {value1} 通过",{value0:String(latest.checks.filter(c=>c.passed).length),value1:String(latest.checks.length)}):uiText("尚无检查记录")}</span>}</summary>{latest?<ul>{latest.checks.map((check,i)=><li key={`${check.name}-${i}`} role={!check.passed?'alert':undefined}><span className={check.passed?'is-confirmed':'is-failed'}>{check.passed?uiText("通过"):uiText("未通过")}</span><span>{uiText(check.detail)}</span></li>)}</ul>:<p>{uiText("导出后显示检查结果。")}</p>}</details>
    {(!(readOnly||completed)||issues.length>0)&&<details className="workspace-export-issues" aria-label={uiText("导出问题")} open={issuesOpen||blocked||!!issueError} onToggle={event=>setIssuesOpen(event.currentTarget.open)}><summary className="workspace-review-heading"><h4>{uiText("问题记录")}</h4>{blocked&&<span>{issues.filter(issue=>!issue.resolved).length}{uiText(" 项待处理")}</span>}</summary>{!readOnly&&!completed&&<div className="workspace-export-issue-entry"><label>{uiText("问题记录")}<textarea aria-invalid={!!issueError} aria-describedby={issueError?issueErrorId:undefined} disabled={readOnly||completed} value={reason} onChange={e=>setReason(e.target.value)} maxLength={4000} rows={2}/></label><Tooltip title={uiText("记录问题")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={MessageSquarePlus} aria-label={uiText("记录问题")} title={uiText("记录问题")} isDisabled={readOnly||pending||recording||completed||!reason.trim()} isLoading={recording} onPress={()=>void recordIssue()}/></Tooltip>{recording&&<span role="status">{uiText("正在记录问题…")}</span>}{issueError&&<p id={issueErrorId} role="alert" className="form-error">{uiText(issueError||'')}</p>}</div>}{issues.map(issue=><div className="workspace-export-issue" key={issue.id}><span>{issue.reason}</span>{issue.resolved?<small className="is-confirmed">{uiText("已解决")}</small>:<Tooltip title={uiText("标为已解决")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Check} aria-label={uiText("标为已解决")} title={uiText("标为已解决")} isDisabled={readOnly||pending||completed} onPress={()=>void run('resolveWorkspaceExportIssue',{issueId:issue.id}).catch(()=>{})}/></Tooltip>}</div>)}</details>}
    <WorkspaceDeliveryPanel workspace={w} pending={pending||readOnly} command={command} onChange={onChange}/>
    {latest&&<div className="workspace-final-details workspace-export-secondary">
     <details aria-label={uiText("文件信息与导出历史")}><summary>{uiText("文件信息与导出历史")}</summary>
      <div className="workspace-export-secondary-grid">
       <div><h5>{uiText("文件信息")}</h5>{latest.artifact?<dl><div><dt>{uiText("工程版本")}</dt><dd>{latest.projectContentVersion===undefined?uiText("未记录"):`v${latest.projectContentVersion}`}</dd></div><div><dt>{uiText("文件大小")}</dt><dd>{(latest.artifact.fileSize/1024/1024).toFixed(2)} MB</dd></div><div><dt>{uiText("格式")}</dt><dd>MP4</dd></div></dl>:<p>{uiText("尚无输出文件。")}</p>}</div>
       <div><h5>{uiText("导出历史")}</h5>{(w.exports?.length??0)>1?w.exports!.slice(1).map(e=><p key={e.id}>{uiText("工程版本 ")}{e.projectContentVersion} · {e.status==='ready'?uiText("检查通过"):uiText("未通过")}{e.confirmedAt?uiText(" · 曾确认"):''}{!e.artifact?uiText(" · 无输出文件"):''}</p>):<p>{uiText("暂无历史导出。")}</p>}</div>
      </div>
     </details>
    </div>}

   </div>
  </div>
 </section>;
}
