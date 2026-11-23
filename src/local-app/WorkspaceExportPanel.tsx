import {useMemo,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight,FileVideo,ArrowLeft,X} from 'lucide-react';
import {uiText,getUiLocale} from '../i18n/ui';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {VideoPreview} from '../ui/media/VideoPreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localArtifactUrl} from '../reviews/localArtifactPreview';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceExportDeliveryState,type WorkspaceExportAction} from '../workspaceExportDelivery';
import {CompletedDeliveryMedia} from './CompletedDeliveryMedia';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import './workspace-compact-panels.css';

import type {CompletedWorkspaceActions} from './WorkspaceAdditionalDownloads';
interface Props {workspace:ProductionWorkspace;pending:boolean;readOnly?:boolean;completedView?:boolean;publicationReadOnly?:boolean;errorPresented?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;onEdit?:()=>void;completedActions?:CompletedWorkspaceActions}
export function WorkspaceExportPanel({workspace:w,pending,command,onChange,readOnly=false,completedView=false,publicationReadOnly=false,errorPresented=false,onEdit,completedActions}:Props){
 const scope=`${w.episodeId}:${w.id}`,currentScope=useRef(scope);currentScope.current=scope;
 const flight=useMemo(()=>({active:false}),[scope]);
 const [operation,setOperation]=useState<{scope:string;name:WorkspaceExportAction}|null>(null),[error,setError]=useState('');
 const [downloadTarget,setDownloadTarget]=useState<HTMLDivElement|null>(null),[mediaInfo,setMediaInfo]=useState({sha:'',width:0,height:0,duration:0});
 const [previewTarget,setPreviewTarget]=useState<HTMLDivElement|null>(null);
 const [failedSource,setFailedSource]=useState<string|null>(null),[previewAttempt,setPreviewAttempt]=useState(0);
 const player=useRef<HTMLVideoElement>(null),[historyId,setHistoryId]=useState<string|null>(null);
 const historyPreview=w.exports?.find(entry=>entry.id===historyId&&entry.status==='ready'&&entry.artifact);
 const passedChecks=w.exports?.[0]?.checks.filter(check=>check.passed).length??0,totalChecks=w.exports?.[0]?.checks.length??0;
 const versionLabel=(version:number|undefined)=>version===undefined?uiText('未记录'):`v${version}`;
 function exportTime(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(getUiLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):uiText('未记录');}
 const action=operation?.scope===scope?operation.name:null;
 const {review}=workspaceExportDeliveryState(w,{readOnly,pending,action}),{latest,outdated}=review;
 const source=latest?.artifact?localArtifactUrl(w.episodeId,latest.artifact.relativePath,latest.artifact.sha256):null;
 const currentFileProblem=completedView?(
  latest?.checks.find(check=>check.name==='export_file'&&!check.passed)?.detail
  ??(!source||!latest?.current||source===failedSource?'当前成片文件无法读取。':undefined)
 ):undefined;
 const downloadToolbar=<div ref={setDownloadTarget} className="workspace-download-toolbar" aria-label={uiText(completedActions?'交付操作':'成片下载')}/>;
 const checkSummary=totalChecks?uiText('{passed}/{total} 项检查通过',{passed:String(passedChecks),total:String(totalChecks)}):uiText('未记录检查项');
 const info=mediaInfo.sha===latest?.artifact?.sha256?mediaInfo:null,ratio=info&&info.height>0?info.width/info.height:9/16;
 const mediaStyle={'--final-preview-ratio':ratio,'--final-preview-max':ratio<1?'280px':'100%'} as CSSProperties;
 function measureMedia(){const video=player.current;if(video&&video.videoWidth>0&&video.videoHeight>0)setMediaInfo({sha:latest!.artifact!.sha256,width:video.videoWidth,height:video.videoHeight,duration:video.duration});}
 async function run(name:WorkspaceExportAction,extra:Record<string,unknown>={}){
  if(flight.active)return;
  flight.active=true;setOperation({scope,name});setError('');
  try{const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});if(currentScope.current===scope)onChange(result as ProductionWorkspace);}
  catch(cause){if(currentScope.current===scope)setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
  finally{flight.active=false;setOperation(value=>value?.scope===scope?null:value);}
 }
 const finalPreview=source&&!currentFileProblem?<div className="workspace-final-media" style={mediaStyle}><VideoPreview key={previewAttempt} mediaRef={player} onDuration={measureMedia} onError={completedView?()=>setFailedSource(source):undefined} title={uiText('最终导出视频')} aria-label={uiText('最终导出视频')} sourceLabel={uiText(outdated?'上次成片':'成片')} src={source}/></div>:<div className="workspace-final-empty"><FileVideo aria-hidden="true"/><p>{uiText(currentFileProblem?'当前成片不可用':review.previewMessage)}</p></div>;
 const exportHistory=(latest||completedView&&!!w.deliveries?.slice(1).length)&&<details className="workspace-export-secondary" aria-label={uiText(completedView?'检查与导出记录':'查看详情')}><summary><ChevronRight size={13} aria-hidden="true"/><span>{uiText(completedView?'检查与导出记录':'查看详情')}</span><small>{!completedView&&`${checkSummary} · `}{uiText('{count} 个导出版本',{count:String(w.exports?.length??0)})}</small></summary>
     <div className="workspace-delivery-details-grid">
      <section aria-label={uiText('技术检查')}><header><h4>{uiText('技术检查')}</h4>{totalChecks>0&&<span className={passedChecks===totalChecks?'is-confirmed':'is-failed'}>{uiText(passedChecks===totalChecks?'全部通过':'存在未通过项')}</span>}</header>
       {totalChecks?<ul className="workspace-delivery-check-list">{latest?.checks.map((check,index)=><li key={index}><span className={check.passed?'is-confirmed':'is-failed'}>{check.passed?<Check size={14} aria-hidden="true"/>:<X size={14} aria-hidden="true"/>}<span className="sr-only">{uiText(check.passed?'通过':'未通过')}</span></span><span>{uiText(check.detail)}</span></li>)}</ul>:<p className="workspace-delivery-details-empty">{uiText('未记录技术检查项。')}</p>}
      </section>
      <section className="workspace-delivery-export-history" aria-label={uiText('导出历史')}><header><h4>{uiText('导出历史')}</h4></header>
       <table className="workspace-delivery-history-table"><caption className="sr-only">{uiText('成片导出版本')}</caption><thead><tr><th scope="col">{uiText('工程版本')}</th><th scope="col">{uiText('生成时间')}</th><th scope="col">{uiText('状态')}</th><th scope="col">{uiText('操作')}</th></tr></thead><tbody>{w.exports?.map(entry=>{
        const isLatest=entry.id===latest?.id;
        const unusable=completedView&&isLatest&&!!currentFileProblem;
        const ready=entry.status==='ready'&&!unusable;
        const oldFile=completedView&&!isLatest&&ready&&entry.checks.every(check=>check.passed)&&entry.artifact;
        const download=oldFile&&localArtifactUrl(w.episodeId,oldFile.relativePath,oldFile.sha256);
        const version=versionLabel(entry.projectContentVersion);
        return <tr key={entry.id}><th scope="row">{version}{entry.current&&<small>{uiText('当前成片')}</small>}</th><td>{entry.createdAt?<time dateTime={entry.createdAt}>{exportTime(entry.createdAt)}</time>:uiText('未记录')}</td>
         <td><span className={!ready?'is-failed':entry.confirmedAt||entry.confirmed?'is-confirmed':''}>{uiText(unusable?'当前成片不可用':!ready?'未通过':entry.confirmedAt||entry.confirmed?'已确认':'检查通过')}</span></td>
         <td><Button size="xs" color="tertiary" aria-label={uiText('预览工程版本 {version}',{version})} isDisabled={!ready||!entry.artifact} onPress={()=>setHistoryId(entry.id)}>{uiText('预览')}</Button>
          {download&&<a className="workspace-history-download" href={download+'&download=1'} download aria-label={uiText('下载工程版本 {version}',{version})}>{uiText('下载')}</a>}</td></tr>;
       })}</tbody></table>
      </section>
     </div>
     {!!w.deliveries?.slice(1).length&&<section aria-label={uiText('历史交付')}><h4>{uiText('历史交付')}</h4>{w.deliveries.slice(1).map((entry,index)=><div key={entry.id}><p>{uiText('历史交付')} {index+1} · {uiText(entry.status==='completed'?'已完成':'未完成')}{entry.error?` · ${entry.error}`:''}</p>{entry.status==='completed'&&entry.artifacts.filter(a=>a.artifactType==='final_render').map(a=><a key={a.relativePath} href={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:a.relativePath,sha256:a.sha256,download:'1'})} download>{uiText('下载历史视频')}</a>)}{entry.status==='completed'&&<a href={`/api/local/episodes/${w.episodeId}/delivery-download?delivery=${entry.id}`} download>{uiText('下载历史交付包（ZIP）')}</a>}</div>)}</section>}
     {review.exportAction.visible&&!review.exportAction.primary&&<Button size="sm" color="secondary" isDisabled={review.exportAction.disabledReason!==null} onPress={()=>void run('exportWorkspace')}>{uiText('重新生成成片')}</Button>}
    </details>;
 return <section className={`production-workspace-section workspace-export workspace-export-compact workspace-review-flow${completedView?' workspace-export-completed':''}`} aria-label={uiText('检查与交付')}>
  <header><div className="workspace-compact-heading">{completedView?<h3>{uiText('检查与交付')}</h3>:null}{!completedView&&onEdit&&<Button size="sm" color="secondary" iconLeading={ArrowLeft} isDisabled={pending||!!action} onPress={onEdit}>{uiText('返回剪辑')}</Button>}{!completedView&&review.status!=='已完成'&&<span role="status" className={review.tone}>{uiText(review.status)}</span>}</div><div className="workspace-final-header-actions">{downloadToolbar}</div></header>
  <div className="workspace-export-layout">
   <div className="workspace-final-preview">
    <div className="workspace-final-heading"><h4>{uiText('成片预览')}</h4></div>
    {outdated&&!completedView&&<p role="status">{uiText('工程已变化，请重新生成成片。')}</p>}
    {completedView?<div ref={setPreviewTarget} className="completed-delivery-preview"/>:finalPreview}
    {(latest?.artifact&&!currentFileProblem||completedView&&totalChecks>0)&&<p className="workspace-final-media-meta">
     {completedView&&totalChecks>0&&<span className={passedChecks===totalChecks?'is-confirmed':'is-failed'}>{passedChecks===totalChecks&&<Check size={14} aria-hidden="true"/>}{checkSummary}</span>}
     {latest?.artifact&&!currentFileProblem&&<>{info&&<><span>{info.duration.toFixed(2)} {uiText('秒')}</span><span>{info.width} × {info.height}</span></>}<span>MP4 · {(latest.artifact.fileSize/1024/1024).toFixed(2)} MB</span></>}
    </p>}
    {(review.exportAction.visible&&review.exportAction.primary||review.confirmAction.visible)&&<div className="workspace-final-actions">
     {review.exportAction.visible&&review.exportAction.primary?<Button size="sm" color="primary" isDisabled={review.exportAction.disabledReason!==null} onPress={()=>void run('exportWorkspace')}>{uiText(review.exportAction.label)}</Button>:review.confirmAction.visible?<><span className="workspace-final-next">{uiText(review.nextMessage)}</span><Button size="sm" color="primary" iconLeading={Check} isDisabled={review.confirmAction.disabledReason!==null} onPress={()=>void run('completeWorkspaceExport',{exportId:latest!.id,expectedExportSha256:latest!.artifact?.sha256,expectedContentSha256:w.contentSha256})}>{uiText(review.confirmAction.label)}</Button></>:null}
    </div>}
    {!completedView&&latest?.checks.filter(check=>!check.passed).map((check,index)=><p key={index} role="alert" className="form-error">{uiText(check.detail)}</p>)}
    {!errorPresented&&error&&<p role="alert" className="form-error">{uiText(error)}</p>}
   </div>
   <div className="workspace-export-review">
    <WorkspaceDeliveryPanel completedActions={completedActions} actionsContainer={downloadTarget} workspace={w} pending={pending||readOnly||!!action} completedView={completedView} publicationReadOnly={publicationReadOnly} currentFileProblem={currentFileProblem} command={command} onChange={onChange} onRecheck={()=>{setFailedSource(null);setPreviewAttempt(count=>count+1);}}
     renderCompletedPreview={completedView&&previewTarget?cover=>createPortal(<CompletedDeliveryMedia
      coverUrl={cover?localArtifactUrl(w.episodeId,cover.file.relativePath,cover.file.sha256):null} video={finalPreview}
      player={player} canPlay={!!source&&!currentFileProblem} mediaStyle={mediaStyle}/>,previewTarget):undefined}/>
    {completedView&&exportHistory}
   </div>
  </div>
  {!completedView&&exportHistory}
 {historyPreview?.artifact&&<ModalOverlay className="workspace-history-preview-overlay" isOpen isDismissable onOpenChange={open=>{if(!open)setHistoryId(null);}}><Modal className="workspace-history-preview-modal"><Dialog aria-label={uiText('历史成片预览')}><header><h4>{uiText('工程版本 {version}',{version:versionLabel(historyPreview.projectContentVersion)})}</h4><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭历史成片预览')} onPress={()=>setHistoryId(null)}/></header><VideoPreview title={uiText('历史成片')} src={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:historyPreview.artifact.relativePath,sha256:historyPreview.artifact.sha256})}/></Dialog></Modal></ModalOverlay>}
 </section>;
}
