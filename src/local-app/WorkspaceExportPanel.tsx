import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {useId,useRef,useState} from 'react';
import {Check,FileVideo,MessageSquarePlus} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {ProductionWorkspace} from '../productionWorkspace';
import './workspace-compact-panels.css';
export function WorkspaceExportPanel({workspace:w,pending,command,onChange,readOnly=false}:{workspace:ProductionWorkspace;pending:boolean;readOnly?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [reason,setReason]=useState(''),[recording,setRecording]=useState(false),[issueError,setIssueError]=useState(''),issueErrorId=useId(),recordingRef=useRef(false),issueScope=useRef('');issueScope.current=`${w.episodeId}:${w.id}`;const completed=w.deliveries?.some(d=>d.status==='completed'),delivered=w.deliveries?.some(d=>d.verified);const latest=w.exports?.[0],issues=w.exportIssues??[],blocked=issues.some(x=>!x.resolved);
 const [action,setAction]=useState<string|null>(null),actionRef=useRef(false),[issuesOpen,setIssuesOpen]=useState(false);
 const deliveryPending=!!w.deliveries?.[0]&&['ready','running'].includes(w.deliveries[0].status);
 const confirmed=!!latest?.confirmed&&latest.current&&!w.stale,failed=!!latest&&(latest.status!=='ready'||latest.checks.some(c=>!c.passed)),outdated=!!latest&&(!latest.current||w.stale);
 const status=action==='exportWorkspace'?'正在导出与检查…':delivered?'交付已完成':completed?'交付文件需核验':deliveryPending?'正在准备交付':!latest?'尚未导出':outdated?'需重新导出':failed?'检查未通过':confirmed?'成片已确认':blocked?'有待处理问题':'待确认成片与字幕';
 async function run(name:string,extra:Record<string,unknown>={}){if(actionRef.current)return;actionRef.current=true;setAction(name);try{const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});onChange(result as ProductionWorkspace);}finally{actionRef.current=false;setAction(null);}}
 async function recordIssue(){if(recordingRef.current||!reason.trim())return;const submitted=reason,scope=issueScope.current;recordingRef.current=true;setRecording(true);setIssueError('');try{await run('recordWorkspaceExportIssue',{...(latest?{exportId:latest.id}:{}),reason:submitted});if(issueScope.current===scope)setReason(current=>current===submitted?'':current);}catch(cause){if(issueScope.current===scope)setIssueError(cause instanceof Error?cause.message:'问题记录失败，请重试。');}finally{recordingRef.current=false;setRecording(false);}}
 return <section className="production-workspace-section workspace-export workspace-export-compact workspace-review-flow">
  <header><div className="workspace-compact-heading"><h3>检查与交付</h3><span role="status" className={confirmed||delivered?'is-confirmed':outdated||failed?'is-failed':''}>{status}</span></div>{!completed&&<Button size="sm" color={latest?'secondary':'primary'} isDisabled={readOnly||pending||!!action||w.stale} onPress={()=>void run('exportWorkspace').catch(()=>{})}>
   {action==='exportWorkspace'?'正在导出与检查…':latest?'重新导出视频':'导出视频'}
  </Button>}</header>
  {w.readiness.placeholders.length>0&&<p className="workspace-export-notice">还有 {w.readiness.placeholders.length} 处占位</p>}
  {outdated&&<p role="status" className="workspace-export-notice">工程已变化，请重新导出当前内容。</p>}
  <div className="workspace-export-layout">
   <div className="workspace-final-preview">
    <div className="workspace-final-heading"><h4>成片预览</h4></div>
    {latest?.artifact?<VideoPreview title="最终导出视频" aria-label="最终导出视频" sourceLabel="成片" src={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(latest.artifact.relativePath)}&sha256=${latest.artifact.sha256}`}/>:<div className="workspace-final-empty"><FileVideo aria-hidden="true"/><p>{latest?'最终文件尚未就绪。':'先导出最终视频，检查后确认这份文件。'}</p></div>}
    {latest&&<div className="workspace-final-actions">{confirmed?<p role="status" className="workspace-final-confirmed"><Check size={15} aria-hidden="true"/>已确认这份最终文件</p>:<>
     <span className="workspace-final-next">{outdated?'这是旧导出，请先重新导出。':failed?'先处理未通过的检查。':blocked?'先处理已记录的问题。':'检查画面与字幕后，确认这份文件。'}</span>
     <Button size="sm" color="primary" iconLeading={Check} isDisabled={readOnly||pending||!!action||outdated||failed||!latest.artifact||blocked} onPress={()=>void run('confirmWorkspaceExport',{exportId:latest.id,expectedExportSha256:latest.artifact?.sha256,expectedContentSha256:w.contentSha256}).catch(()=>{})}>{action==='confirmWorkspaceExport'?'正在确认…':'确认成片与字幕'}</Button>
    </>}</div>}
   </div>
   <div className="workspace-export-review">
    <details className="workspace-technical-checks" aria-label="技术检查" open={latest?.checks.some(c=>!c.passed)||undefined}><summary className="workspace-review-heading"><h4>技术检查</h4>{latest&&<span className={latest.checks.length&&latest.checks.every(c=>c.passed)?'is-confirmed':'is-failed'}>{latest.checks.length?`${latest.checks.filter(c=>c.passed).length} / ${latest.checks.length} 通过`:'尚无检查记录'}</span>}</summary>{latest?<ul>{latest.checks.map((check,i)=><li key={`${check.name}-${i}`} role={!check.passed?'alert':undefined}><span className={check.passed?'is-confirmed':'is-failed'}>{check.passed?'通过':'未通过'}</span><span>{check.detail}</span></li>)}</ul>:<p>导出后显示检查结果。</p>}</details>
    {(!(readOnly||completed)||issues.length>0)&&<details className="workspace-export-issues" aria-label="导出问题" open={issuesOpen||blocked||!!issueError} onToggle={event=>setIssuesOpen(event.currentTarget.open)}><summary className="workspace-review-heading"><h4>问题记录</h4>{blocked&&<span>{issues.filter(issue=>!issue.resolved).length} 项待处理</span>}</summary>{!readOnly&&!completed&&<div className="workspace-export-issue-entry"><label>问题记录<textarea aria-invalid={!!issueError} aria-describedby={issueError?issueErrorId:undefined} disabled={readOnly||completed} value={reason} onChange={e=>setReason(e.target.value)} maxLength={4000} rows={2}/></label><Tooltip title="记录问题" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={MessageSquarePlus} aria-label="记录问题" title="记录问题" isDisabled={readOnly||pending||recording||completed||!reason.trim()} isLoading={recording} onPress={()=>void recordIssue()}/></Tooltip>{recording&&<span role="status">正在记录问题…</span>}{issueError&&<p id={issueErrorId} role="alert" className="form-error">{issueError}</p>}</div>}{issues.map(issue=><div className="workspace-export-issue" key={issue.id}><span>{issue.reason}</span>{issue.resolved?<small className="is-confirmed">已解决</small>:<Tooltip title="标为已解决" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Check} aria-label="标为已解决" title="标为已解决" isDisabled={readOnly||pending||completed} onPress={()=>void run('resolveWorkspaceExportIssue',{issueId:issue.id}).catch(()=>{})}/></Tooltip>}</div>)}</details>}
    <WorkspaceDeliveryPanel workspace={w} pending={pending||readOnly} command={command} onChange={onChange}/>
    {latest&&<div className="workspace-final-details workspace-export-secondary">
     <details aria-label="文件信息与导出历史"><summary>文件信息与导出历史</summary>
      <div className="workspace-export-secondary-grid">
       <div><h5>文件信息</h5>{latest.artifact?<dl><div><dt>工程版本</dt><dd>{latest.projectContentVersion===undefined?'未记录':`v${latest.projectContentVersion}`}</dd></div><div><dt>文件大小</dt><dd>{(latest.artifact.fileSize/1024/1024).toFixed(2)} MB</dd></div><div><dt>格式</dt><dd>MP4</dd></div></dl>:<p>尚无输出文件。</p>}</div>
       <div><h5>导出历史</h5>{(w.exports?.length??0)>1?w.exports!.slice(1).map(e=><p key={e.id}>工程版本 {e.projectContentVersion} · {e.status==='ready'?'检查通过':'未通过'}{e.confirmedAt?' · 曾确认':''}{!e.artifact?' · 无输出文件':''}</p>):<p>暂无历史导出。</p>}</div>
      </div>
     </details>
    </div>}

   </div>
  </div>
 </section>;
}
