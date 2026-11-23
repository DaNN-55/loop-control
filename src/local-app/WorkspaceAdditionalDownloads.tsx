import {useRef,useState} from 'react';
import {Download,FileJson,ChevronDown,FileText,Film,Clapperboard} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceDelivery} from '../workspaceDelivery';
import type {useWorkspacePublication} from './useWorkspacePublication';
import type {PublicationPackageReference} from './workspacePublicationPackages';
import {localCommand} from './client';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
export type CompletedWorkspaceActions={viewScript:()=>void;viewStoryboard:()=>void;openProject:()=>void};
export function WorkspaceAdditionalDownloads({workspace:w,delivery,publication:p,readOnly=false,editing=false,completedActions}:{workspace:ProductionWorkspace;delivery?:WorkspaceDelivery;publication:ReturnType<typeof useWorkspacePublication>;readOnly?:boolean;editing?:boolean;completedActions?:CompletedWorkspaceActions}){
 const disclosure=useRef<HTMLDetailsElement>(null);
 const trigger=useRef<HTMLElement>(null);
 function closeActions(){
  if(disclosure.current)disclosure.current.open=false;
  trigger.current?.focus();
 }
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pack,setPack]=useState<PublicationPackageReference|null>(null);
 const current=!!pack&&!!p.state&&pack.revision===p.state.revision&&!p.dirty&&!p.saving&&!editing;
 async function prepare(){if(busy||editing)return;setBusy(true);setError('');try{const saved=await p.flush();const result=await localCommand<PublicationPackageReference>('create',{expectedRevision:saved.revision},undefined,`episodes/${w.episodeId}/publication-package`);setPack(result);window.location.assign(result.downloadUrl);}catch(cause){setError(cause instanceof Error?cause.message:'最新资料包准备失败。');}finally{setBusy(false);}}
 const zipLabel=uiText(completedActions?'下载交付包（ZIP）':'下载交付文件（ZIP）');
 const originalZip=delivery?`/api/local/episodes/${w.episodeId}/delivery-download?delivery=${delivery.id}`:undefined;
 const useOriginalZip=readOnly||!!completedActions&&!p.state&&!!p.error;
 const cover=p.state?.cover?.file;
 const fileUrl=(file:{relativePath:string;sha256:string})=>'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:file.relativePath,sha256:file.sha256,download:'1'});
 function select(action:()=>void){closeActions();action();}
 return <details ref={disclosure} className={`workspace-more-downloads${completedActions?' workspace-completed-actions':''}`}
  onKeyDown={event=>{if(event.key==='Escape'&&disclosure.current?.open){event.stopPropagation();closeActions();}}}>
  <summary ref={trigger}>{uiText(completedActions?'更多操作':'更多下载')}<ChevronDown size={13} aria-hidden="true"/></summary>
  <div className="workspace-more-download-options">
   {delivery&&<div className="workspace-download-options-group" role="group" aria-label={uiText('下载')}>
    {completedActions&&<strong className="workspace-action-group-label">{uiText('下载')}</strong>}
    {!useOriginalZip&&(current?<a href={pack!.downloadUrl} download>{zipLabel}</a>:<Button size="sm" color={completedActions?'tertiary':'secondary'} isDisabled={busy||!p.state||editing} onPress={()=>void prepare()}>{busy?uiText('正在准备下载…'):zipLabel}</Button>)}
    {(!completedActions||useOriginalZip)&&<a href={originalZip} download>{uiText('下载原交付包（ZIP）')}</a>}
    {!completedActions&&delivery.artifacts.filter(a=>a.artifactType==='editable_project').map(a=><a key={a.relativePath} href={fileUrl(a)} download><FileJson size={16} aria-hidden="true"/>{uiText('下载可编辑工程')}</a>)}
    {cover&&<a href={fileUrl(cover)} download><Download size={16} aria-hidden="true"/>{uiText('下载封面')}</a>}
    {editing&&<p>{uiText('请先保存或取消文案编辑，再下载最新资料包。')}</p>}
    {completedActions?<p>{uiText('交付包包含可编辑工程，源素材须另行保留。')}</p>:<p>{uiText('工程需保留原素材；交付包不含源素材。')}</p>}
    {error&&<p role="alert">{uiText(error)}</p>}
   </div>}
   {completedActions&&<div className="workspace-record-actions" role="group" aria-label={uiText('查看与编辑')}>
    <strong className="workspace-action-group-label">{uiText('查看与编辑')}</strong>
    <Button size="sm" color="tertiary" iconLeading={FileText} aria-haspopup="dialog" onPress={()=>select(completedActions.viewScript)}>{uiText('查看脚本')}</Button>
    <Button size="sm" color="tertiary" iconLeading={Film} aria-haspopup="dialog" onPress={()=>select(completedActions.viewStoryboard)}>{uiText('查看分镜')}</Button>
    <Button size="sm" color="tertiary" iconLeading={Clapperboard} onPress={()=>select(completedActions.openProject)}>{uiText('打开剪辑工程')}</Button>
   </div>}
  </div>
 </details>;
}
