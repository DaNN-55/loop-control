import {createPortal} from 'react-dom';
import {useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {ArtifactManifest} from '../worker/contracts';
import {workspaceExportDeliveryState} from '../workspaceExportDelivery';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {WorkspaceAdditionalDownloads} from './WorkspaceAdditionalDownloads';
import {WorkspacePublicationPanel} from './WorkspacePublicationPanel';
import './workspace-compact-panels.css';

interface Props {workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;completedView?:boolean;publicationReadOnly?:boolean;actionsContainer?:HTMLElement|null;currentFileProblem?:string;onRecheck?:()=>void}
export function WorkspaceDeliveryPanel({workspace:w,pending,command,onChange,completedView=false,publicationReadOnly=false,actionsContainer,currentFileProblem,onRecheck}:Props){
 const {review,delivery}=workspaceExportDeliveryState(w),{latest,running,retryTarget,unavailable}=delivery;
 const [error,setError]=useState(''),[retrying,setRetrying]=useState(false),[rechecking,setRechecking]=useState(false);
 const reading=useWorkspaceReading(w,onChange,JSON.stringify([latest?.id,!!running]),'交付状态暂不可用，请刷新重试。');
 const pollingError=useWorkspacePolling(reading,{enabled:!!running,interval:2500});
 const url=(a:ArtifactManifest)=>'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:a.relativePath,sha256:a.sha256,download:'1'});
 async function retry(){
  if(!retryTarget||retrying)return;
  setError('');setRetrying(true);
  try{reading.publish(await command('retryWorkspaceDelivery',{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,deliveryId:retryTarget.id}) as ProductionWorkspace);}
  catch(cause){setError(cause instanceof Error?cause.message:'完成未成功，请重试。');}
  finally{setRetrying(false);}
 }
 const verified=latest?.verified&&(!completedView||review.delivered&&!currentFileProblem)?latest:undefined;
 const finalFiles=verified?.artifacts.filter(a=>a.artifactType==='final_render'&&(!completedView||(a.sha256===review.latest?.artifact?.sha256&&a.relativePath===review.latest.artifact.relativePath)));
 const problem=currentFileProblem||(unavailable?(latest?.error||'交付文件不可用，请恢复原文件后重新检查，或返回剪辑另存生产单副本。'):'');
 async function recheck(){
  if(rechecking)return;
  setError('');setRechecking(true);
  try{await reading.read();onRecheck?.();}
  catch(cause){setError(cause instanceof Error?cause.message:'交付状态暂不可用，请刷新重试。');}
  finally{setRechecking(false);}
 }
 const downloads=!!finalFiles?.length&&<div className="workspace-delivery-downloads">{finalFiles.map(a=><a className={review.delivered?'workspace-download-primary':'workspace-download-secondary'} key={a.relativePath} href={url(a)} download><Download size={16} aria-hidden="true"/>{uiText(review.delivered?'下载视频':'下载已完成视频')}</a>)}</div>;
 const fileNotice=problem&&<div className={completedView?'workspace-completed-file-problem':undefined}><p role="alert">{uiText(problem)}</p><Button size="sm" color="secondary" isDisabled={rechecking} onPress={()=>void recheck()}>{uiText(rechecking?'读取中…':'重新检查文件')}</Button></div>;
 return <section className={`workspace-delivery workspace-delivery-compact${completedView?' completed-delivery':''}`} aria-label={uiText('成片下载与发布资料')}>
  {actionsContainer?createPortal(downloads,actionsContainer):downloads}
  {retryTarget&&<div className="workspace-completion-retry"><p role="alert">{uiText(retryTarget.error||'交付文件校验未完成，请重试。')}</p><Button size="sm" color="primary" iconLeading={RefreshCw} isDisabled={pending||retrying} onPress={()=>void retry()}>{uiText(retrying?'正在完成…':'重试完成')}</Button></div>}
  {completedView&&actionsContainer?createPortal(fileNotice,actionsContainer):fileNotice}
  {(error||pollingError)&&<p role="alert">{uiText(error||pollingError?.message||'')}</p>}
  <WorkspacePublicationPanel key={w.episodeId+':'+w.id} workspace={w} readOnly={publicationReadOnly} completedView={completedView}>{(p,editing)=>verified?(actionsContainer?createPortal(<WorkspaceAdditionalDownloads workspace={w} delivery={verified} publication={p} readOnly={publicationReadOnly} editing={editing}/>,actionsContainer):<WorkspaceAdditionalDownloads workspace={w} delivery={verified} publication={p} readOnly={publicationReadOnly} editing={editing}/>):null}</WorkspacePublicationPanel>
 </section>;
}
