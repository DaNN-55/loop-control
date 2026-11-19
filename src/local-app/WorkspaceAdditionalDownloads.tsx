import {useState} from 'react';
import {Download,FileJson} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceDelivery} from '../workspaceDelivery';
import type {useWorkspacePublication} from './useWorkspacePublication';
import type {PublicationPackageReference} from './workspacePublicationPackages';
import {localCommand} from './client';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
export function WorkspaceAdditionalDownloads({workspace:w,delivery,publication:p,readOnly=false}:{workspace:ProductionWorkspace;delivery:WorkspaceDelivery;publication:ReturnType<typeof useWorkspacePublication>;readOnly?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pack,setPack]=useState<PublicationPackageReference|null>(null);
 const current=pack?.revision===p.state?.revision&&!p.dirty&&!p.saving;
 async function prepare(){if(busy)return;setBusy(true);setError('');try{const saved=await p.flush();const result=await localCommand<PublicationPackageReference>('create',{expectedRevision:saved.revision},undefined,`episodes/${w.episodeId}/publication-package`);setPack(result);window.location.assign(result.downloadUrl);}catch(cause){setError(cause instanceof Error?cause.message:'最新资料包准备失败。');}finally{setBusy(false);}}
 return <details className="workspace-more-downloads"><summary>{uiText('更多下载')}</summary>
  {!readOnly&&<>{current?<a href={pack!.downloadUrl} download>{uiText('下载交付文件（ZIP）')}</a>:<Button size="sm" color="secondary" isDisabled={busy||!p.state} onPress={()=>void prepare()}>{uiText(busy?'正在准备下载…':'下载交付文件（ZIP）')}</Button>}</>}
  <a href={`/api/local/episodes/${w.episodeId}/delivery-download?delivery=${delivery.id}`} download>{uiText('下载原交付包（ZIP）')}</a>
  {delivery.artifacts.filter(a=>a.artifactType==='editable_project').map(a=><a key={a.relativePath} href={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:a.relativePath,sha256:a.sha256,download:'1'})} download><FileJson size={16} aria-hidden="true"/>{uiText('下载可编辑工程')}</a>)}
  {p.state?.cover&&<a href={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:p.state.cover.file.relativePath,sha256:p.state.cover.file.sha256,download:'1'})} download><Download size={16} aria-hidden="true"/>{uiText('下载封面')}</a>}
  <p>{uiText('工程需保留原素材；交付包不含源素材。')}</p>{error&&<p role="alert">{uiText(error)}</p>}
 </details>;
}
