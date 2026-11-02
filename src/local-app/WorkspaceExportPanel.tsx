import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {useId,useRef,useState,type ReactNode} from 'react';
import {Check,FileVideo,History,RefreshCw,MessageSquarePlus} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {ProductionWorkspace} from '../productionWorkspace';
import './workspace-compact-panels.css';
export function WorkspaceExportPanel({workspace:w,pending,command,onChange,readOnly=false,history}:{workspace:ProductionWorkspace;pending:boolean;readOnly?:boolean;history?:ReactNode;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [reason,setReason]=useState(''),[recording,setRecording]=useState(false),[issueError,setIssueError]=useState(''),issueErrorId=useId(),recordingRef=useRef(false),issueScope=useRef('');issueScope.current=`${w.episodeId}:${w.id}`;const completed=w.deliveries?.some(d=>d.status==='completed');const latest=w.exports?.[0],issues=w.exportIssues??[],blocked=issues.some(x=>!x.resolved);
 async function run(name:string,extra:Record<string,unknown>={}){const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});onChange(result as ProductionWorkspace);}
 async function recordIssue(){if(recordingRef.current||!reason.trim())return;const submitted=reason,scope=issueScope.current;recordingRef.current=true;setRecording(true);setIssueError('');try{await run('recordWorkspaceExportIssue',{...(latest?{exportId:latest.id}:{}),reason:submitted});if(issueScope.current===scope)setReason(current=>current===submitted?'':current);}catch(cause){if(issueScope.current===scope)setIssueError(cause instanceof Error?cause.message:'问题记录失败，请重试。');}finally{recordingRef.current=false;setRecording(false);}}
 return <section className="production-workspace-section workspace-export workspace-export-compact">
  <header><div className="workspace-compact-heading"><h3>检查与交付</h3><span role="status" className={latest?.confirmed?'is-confirmed':''}>{completed?'交付已完成':latest?.confirmed?'最终文件已确认':latest?.current?'待确认最终文件':latest?'需重新导出':'尚未导出'}</span></div><Tooltip title={latest?'重新导出并检查':'导出最终视频并检查'} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label={pending?'正在导出与检查…':latest?'重新导出并检查':'导出最终视频并检查'} title={latest?'重新导出并检查':'导出最终视频并检查'} isDisabled={readOnly||pending||w.stale||completed} onPress={()=>void run('exportWorkspace').catch(()=>{})}/></Tooltip></header>
  {w.readiness.placeholders.length>0&&<p className="workspace-export-notice">还有 {w.readiness.placeholders.length} 处占位</p>}
  {latest&&!latest.current&&<p role="status" className="workspace-export-notice">工程已变化，请重新导出当前内容。</p>}
  <div className="workspace-export-layout">
   <div className="workspace-final-preview">
    <div className="workspace-final-heading"><h4>成片预览</h4></div>
    {latest?.artifact?<VideoPreview title="最终导出视频" aria-label="最终导出视频" sourceLabel="成片" src={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(latest.artifact.relativePath)}&sha256=${latest.artifact.sha256}`}/>:<div className="workspace-final-empty"><FileVideo aria-hidden="true"/><p>{latest?'最终文件尚未就绪。':'先导出最终视频，检查后确认这份文件。'}</p></div>}
    {latest&&(latest.confirmed?<p role="status" className="workspace-final-confirmed"><Check size={15} aria-hidden="true"/>已确认这份最终文件</p>:<Button size="sm" color="primary" iconLeading={Check} isDisabled={readOnly||pending||!latest.current||latest.status!=='ready'||latest.checks.some(c=>!c.passed)||blocked} onPress={()=>void run('confirmWorkspaceExport',{exportId:latest.id,expectedExportSha256:latest.artifact?.sha256,expectedContentSha256:w.contentSha256}).catch(()=>{})}>确认成片与字幕</Button>)}
   </div>
   <div className="workspace-export-review">
    <details className="workspace-technical-checks" aria-label="技术检查" open={latest?.checks.some(c=>!c.passed)||undefined}><summary className="workspace-review-heading"><h4>技术检查</h4>{latest&&<span className={latest.checks.every(c=>c.passed)?'is-confirmed':'is-failed'}>{latest.checks.filter(c=>c.passed).length} / {latest.checks.length} 通过</span>}</summary>{latest?<ul>{latest.checks.map((check,i)=><li key={`${check.name}-${i}`} role={!check.passed?'alert':undefined}><span className={check.passed?'is-confirmed':'is-failed'}>{check.passed?'通过':'未通过'}</span><span>{check.detail}</span></li>)}</ul>:<p>导出后显示检查结果。</p>}</details>
    <WorkspaceDeliveryPanel workspace={w} pending={pending||readOnly} command={command} onChange={onChange}/>
    <div className="workspace-final-details">
     {latest?.artifact&&<details><summary>文件信息</summary><dl><div><dt>工程版本</dt><dd>{latest.projectContentVersion===undefined?'未记录':`v${latest.projectContentVersion}`}</dd></div><div><dt>文件大小</dt><dd>{(latest.artifact.fileSize/1024/1024).toFixed(2)} MB</dd></div><div><dt>格式</dt><dd>MP4</dd></div></dl></details>}
     {(w.exports?.length??0)>1&&<details><summary><History size={13} aria-hidden="true"/>导出历史</summary>{w.exports!.slice(1).map(e=><p key={e.id}>工程版本 {e.projectContentVersion} · {e.status==='ready'?'检查通过':'未通过'}{e.confirmedAt?' · 曾确认':''}{!e.artifact?' · 无输出文件':''}</p>)}</details>}
    </div>
    {(!(readOnly||completed)||issues.length>0)&&<section className="workspace-export-issues" aria-label="导出问题"><div className="workspace-review-heading"><h4>问题记录</h4><span>{issues.filter(issue=>!issue.resolved).length} 项待处理</span></div>{!readOnly&&!completed&&<div className="workspace-export-issue-entry"><label>问题记录<textarea aria-invalid={!!issueError} aria-describedby={issueError?issueErrorId:undefined} disabled={readOnly||completed} value={reason} onChange={e=>setReason(e.target.value)} maxLength={4000} rows={2}/></label><Tooltip title="记录问题" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={MessageSquarePlus} aria-label="记录问题" title="记录问题" isDisabled={readOnly||pending||recording||completed||!reason.trim()} isLoading={recording} onPress={()=>void recordIssue()}/></Tooltip>{recording&&<span role="status">正在记录问题…</span>}{issueError&&<p id={issueErrorId} role="alert" className="form-error">{issueError}</p>}</div>}{issues.map(issue=><div className="workspace-export-issue" key={issue.id}><span>{issue.reason}</span>{issue.resolved?<small className="is-confirmed">已解决</small>:<Tooltip title="标为已解决" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Check} aria-label="标为已解决" title="标为已解决" isDisabled={readOnly||pending||completed} onPress={()=>void run('resolveWorkspaceExportIssue',{issueId:issue.id}).catch(()=>{})}/></Tooltip>}</div>)}</section>}
    {history}
   </div>
  </div>
 </section>;
}
