import {useRef,useState} from 'react';
import {Download,FileJson,ChevronDown} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceDelivery} from '../workspaceDelivery';
import type {useWorkspacePublication} from './useWorkspacePublication';
import type {PublicationPackageReference} from './workspacePublicationPackages';
import {localCommand} from './client';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {uiText} from '../i18n/ui';
export type CompletedWorkspaceActions={viewScript:()=>void;viewStoryboard:()=>void;openProject:()=>void};
export function WorkspaceAdditionalDownloads({workspace:w,delivery,publication:p,readOnly=false,editing=false,completedActions}:{workspace:ProductionWorkspace;delivery?:WorkspaceDelivery;publication:ReturnType<typeof useWorkspacePublication>;readOnly?:boolean;editing?:boolean;completedActions?:CompletedWorkspaceActions}){
 const moreActionsTrigger=useRef<HTMLButtonElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pack,setPack]=useState<PublicationPackageReference|null>(null);
 const current=!!pack&&!!p.state&&pack.revision===p.state.revision&&!p.dirty&&!p.saving&&!editing;
 async function prepare(){if(busy||editing)return;setBusy(true);setError('');try{const saved=await p.flush();const result=await localCommand<PublicationPackageReference>('create',{expectedRevision:saved.revision},undefined,`episodes/${w.episodeId}/publication-package`);setPack(result);window.location.assign(result.downloadUrl);}catch(cause){setError(cause instanceof Error?cause.message:'最新资料包准备失败。');}finally{setBusy(false);}}
 const zipLabel=uiText('下载交付包（ZIP）');
 const originalZip=delivery?`/api/local/episodes/${w.episodeId}/delivery-download?delivery=${delivery.id}`:undefined;
 const useOriginalZip=readOnly||!!completedActions&&!p.state&&!!p.error;
 const cover=p.state?.cover?.file;
 const fileUrl=(file:{relativePath:string;sha256:string})=>'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:file.relativePath,sha256:file.sha256,download:'1'});
 function openRecord(action:()=>void){
  // Close the menu before the native dialog captures its return focus.
  requestAnimationFrame(()=>{
   moreActionsTrigger.current?.focus();
   action();
  });
 }
 if(completedActions)return <>
  <Dropdown.Root>
   <Button size="sm" color="secondary" iconTrailing={ChevronDown} ref={moreActionsTrigger} className="workspace-more-actions-trigger">{uiText('更多操作')}</Button>
   <Dropdown.Popover className="dan-ui product-ui workspace-completed-actions-menu">
    <Dropdown.Menu aria-label={uiText('更多操作')}>
     {delivery&&<>
      <Dropdown.Section>
       <Dropdown.SectionHeader className="workspace-action-group-label">{uiText('下载')}</Dropdown.SectionHeader>
       {useOriginalZip?<Dropdown.Item href={originalZip} download>{uiText('下载原交付包（ZIP）')}</Dropdown.Item>
        :current?<Dropdown.Item href={pack!.downloadUrl} download>{zipLabel}</Dropdown.Item>
        :<Dropdown.Item isDisabled={busy||!p.state||editing} onAction={()=>void prepare()}>{busy?uiText('正在准备下载…'):zipLabel}</Dropdown.Item>}
       {cover&&<Dropdown.Item href={fileUrl(cover)} download>{uiText('下载封面')}</Dropdown.Item>}
      </Dropdown.Section>
      <Dropdown.Separator/>
     </>}
     <Dropdown.Section>
      <Dropdown.SectionHeader className="workspace-action-group-label">{uiText('查看与编辑')}</Dropdown.SectionHeader>
      <Dropdown.Item onAction={()=>openRecord(completedActions.viewScript)}>{uiText('查看脚本')}</Dropdown.Item>
      <Dropdown.Item onAction={()=>openRecord(completedActions.viewStoryboard)}>{uiText('查看分镜')}</Dropdown.Item>
      <Dropdown.Item onAction={completedActions.openProject}>{uiText('打开剪辑工程')}</Dropdown.Item>
     </Dropdown.Section>
    </Dropdown.Menu>
    {delivery&&<p className="workspace-completed-actions-note">{uiText(editing?'请先保存或取消文案编辑，再下载最新资料包。':'交付包包含可编辑工程，源素材须另行保留。')}</p>}
   </Dropdown.Popover>
  </Dropdown.Root>
  <FeedbackNotice message={error} tone="error" onDismiss={()=>setError('')}/>
 </>;

 return <details className="workspace-more-downloads">
  <summary>{uiText('更多下载')}<ChevronDown size={13} aria-hidden="true"/></summary>
  <div className="workspace-more-download-options">
   {delivery&&<div className="workspace-download-options-group" role="group" aria-label={uiText('下载')}>
    {!readOnly&&(current?<a href={pack!.downloadUrl} download>{uiText('下载交付文件（ZIP）')}</a>:<Button size="sm" color="secondary" isDisabled={busy||!p.state||editing} onPress={()=>void prepare()}>{uiText(busy?'正在准备下载…':'下载交付文件（ZIP）')}</Button>)}
    <a href={originalZip} download>{uiText('下载原交付包（ZIP）')}</a>
    {delivery.artifacts.filter(a=>a.artifactType==='editable_project').map(a=><a key={a.relativePath} href={fileUrl(a)} download><FileJson size={16} aria-hidden="true"/>{uiText('下载可编辑工程')}</a>)}
    {cover&&<a href={fileUrl(cover)} download><Download size={16} aria-hidden="true"/>{uiText('下载封面')}</a>}
    {editing&&<p>{uiText('请先保存或取消文案编辑，再下载最新资料包。')}</p>}
    <p>{uiText('工程需保留原素材；交付包不含源素材。')}</p>
    {error&&<p role="alert">{uiText(error)}</p>}
   </div>}
  </div>
 </details>;
}
