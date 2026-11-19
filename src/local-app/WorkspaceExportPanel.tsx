import {useMemo,useRef,useState} from 'react';
import {Check,FileVideo,ArrowLeft} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {VideoPreview} from '../ui/media/VideoPreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceExportDeliveryState,type WorkspaceExportAction} from '../workspaceExportDelivery';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import './workspace-compact-panels.css';

interface Props {workspace:ProductionWorkspace;pending:boolean;readOnly?:boolean;completedView?:boolean;publicationReadOnly?:boolean;errorPresented?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;onEdit?:()=>void}
export function WorkspaceExportPanel({workspace:w,pending,command,onChange,readOnly=false,completedView=false,publicationReadOnly=false,errorPresented=false,onEdit}:Props){
 const scope=`${w.episodeId}:${w.id}`,currentScope=useRef(scope);currentScope.current=scope;
 const flight=useMemo(()=>({active:false}),[scope]);
 const [operation,setOperation]=useState<{scope:string;name:WorkspaceExportAction}|null>(null),[error,setError]=useState('');
 const action=operation?.scope===scope?operation.name:null;
 const {review}=workspaceExportDeliveryState(w,{readOnly,pending,action}),{latest,outdated}=review;
 async function run(name:WorkspaceExportAction,extra:Record<string,unknown>={}){
  if(flight.active)return;
  flight.active=true;setOperation({scope,name});setError('');
  try{const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});if(currentScope.current===scope)onChange(result as ProductionWorkspace);}
  catch(cause){if(currentScope.current===scope)setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
  finally{flight.active=false;setOperation(value=>value?.scope===scope?null:value);}
 }
 return <section className="production-workspace-section workspace-export workspace-export-compact workspace-review-flow">
  <header><div className="workspace-compact-heading"><h3>{uiText('检查与交付')}</h3><span role="status" className={review.tone}>{uiText(review.status)}</span></div>{onEdit&&<Button size="sm" color="secondary" iconLeading={ArrowLeft} isDisabled={pending||!!action} onPress={onEdit}>{uiText('返回剪辑')}</Button>}</header>
  <div className="workspace-export-layout">
   <div className="workspace-final-preview">
    <div className="workspace-final-heading"><h4>{uiText('成片预览')}</h4></div>
    {outdated&&<p role="status">{uiText('工程已变化，请重新生成成片。')}</p>}
    {latest?.artifact?<VideoPreview title={uiText('最终导出视频')} aria-label={uiText('最终导出视频')} sourceLabel={uiText(outdated?'上次成片':'成片')} src={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(latest.artifact.relativePath)}&sha256=${latest.artifact.sha256}`}/>:<div className="workspace-final-empty"><FileVideo aria-hidden="true"/><p>{uiText(review.previewMessage)}</p></div>}
    <div className="workspace-final-actions">
     {review.exportAction.visible&&review.exportAction.primary?<Button size="sm" color="primary" isDisabled={review.exportAction.disabledReason!==null} onPress={()=>void run('exportWorkspace')}>{uiText(review.exportAction.label)}</Button>:review.confirmAction.visible?<><span className="workspace-final-next">{uiText(review.nextMessage)}</span><Button size="sm" color="primary" iconLeading={Check} isDisabled={review.confirmAction.disabledReason!==null} onPress={()=>void run('completeWorkspaceExport',{exportId:latest!.id,expectedExportSha256:latest!.artifact?.sha256,expectedContentSha256:w.contentSha256})}>{uiText(review.confirmAction.label)}</Button></>:null}
    </div>
    {latest?.checks.filter(check=>!check.passed).map((check,index)=><p key={index} role="alert" className="form-error">{uiText(check.detail)}</p>)}
    {!errorPresented&&error&&<p role="alert" className="form-error">{uiText(error)}</p>}
   </div>
   <div className="workspace-export-review">
    <WorkspaceDeliveryPanel workspace={w} pending={pending||readOnly||!!action} completedView={completedView} publicationReadOnly={publicationReadOnly} command={command} onChange={onChange}/>
    {latest&&<details className="workspace-export-secondary" aria-label={uiText('查看详情')}><summary>{uiText('查看详情')}</summary>
     <h4>{uiText('技术检查')}</h4><ul>{latest.checks.map((check,index)=><li key={index}><span className={check.passed?'is-confirmed':'is-failed'}>{uiText(check.passed?'通过':'未通过')}</span> {uiText(check.detail)}</li>)}</ul>
     {latest.artifact&&<p>{uiText('文件大小')} · {(latest.artifact.fileSize/1024/1024).toFixed(2)} MB · MP4</p>}
     <h4>{uiText('导出历史')}</h4>{w.exports?.map(entry=><p key={entry.id}>{uiText('工程版本')} {entry.projectContentVersion===undefined?uiText('未记录'):`v${entry.projectContentVersion}`} · {uiText(entry.status==='ready'?'检查通过':'未通过')}{entry.confirmedAt?uiText(' · 曾确认'):''}</p>)}
     {review.exportAction.visible&&!review.exportAction.primary&&<Button size="sm" color="secondary" isDisabled={review.exportAction.disabledReason!==null} onPress={()=>void run('exportWorkspace')}>{uiText('重新生成成片')}</Button>}
    </details>}
   </div>
  </div>
 </section>;
}
