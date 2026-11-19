import {useEffect,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {PanelRightClose,PanelRightOpen,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {artifactPreviewKind} from '../reviews/localArtifactPreview';
import {useWorkbenchPreview,WorkbenchArtwork} from '../operations/workbenchPreview';
import {EpisodeWorkspace} from './WorkspaceViews';
import {EpisodeStatus,episodeActionState,episodeNextAction,episodeWorkflowLabel} from './episodePresentation';
import '../operations/workbench.css';
import './production-catalog.css';

type Props=ComponentProps<typeof EpisodeWorkspace>;
const previewPreference='loop-control.catalog.preview.v1';

function MobilePreview({children,onClose}:{children:ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 // StrictMode can reopen after cleanup before the queued native close event.
 return <dialog ref={dialog} className="production-preview-dialog dan-ui product-ui" aria-label={uiText('生产单预览')} onCancel={onClose} onClose={()=>{if(!dialog.current?.open)onClose();}}>{children}</dialog>;
}

export function ProductionCatalog({suspended=false,...props}:Props&{suspended?:boolean}){
 const [selectedId,setSelectedId]=useState('');
 const [expanded,setExpanded]=useState(()=>localStorage.getItem(previewPreference)!=='hidden');
 const [small,setSmall]=useState(()=>typeof matchMedia==='function'&&matchMedia('(max-width: 1000px)').matches);
 const [mobileOpen,setMobileOpen]=useState(false);
 const origin=useRef<HTMLElement|null>(null);
 const returnFocus=useRef(false);
 const catalog=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!mobileOpen&&returnFocus.current){
   returnFocus.current=false;
   if(origin.current?.isConnected)origin.current.focus();
  }
 },[mobileOpen]);
 useEffect(()=>{
  if(typeof matchMedia!=='function')return;
  const query=matchMedia('(max-width: 1000px)'),changed=()=>{setSmall(query.matches);setMobileOpen(false);};
  query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);
 },[]);
 const episode=props.episodes.find(item=>item.id===selectedId)??props.episodes[0];
 const visible=!suspended&&!!episode&&!props.isPageLoading&&(small?mobileOpen:expanded);
 const preview=useWorkbenchPreview(episode?.id??'',episode?.updated_at??'',visible);
 const summary=props.operationRows?.find(item=>item.episodeId===episode?.id);
 function select(id:string){
  const row=Array.from(catalog.current?.querySelectorAll<HTMLElement>('[data-preview-id]')??[]).find(item=>item.dataset.previewId===id);
  origin.current=row??(document.activeElement instanceof HTMLElement?document.activeElement:null);
  setSelectedId(id);if(small)setMobileOpen(true);else {setExpanded(true);localStorage.setItem(previewPreference,'shown');}
 }
 function close(){
  if(small){returnFocus.current=true;setMobileOpen(false);}
  else {setExpanded(false);localStorage.setItem(previewPreference,'hidden');}
 }
 const toggle=<Button size="sm" color="tertiary" iconLeading={visible?PanelRightClose:PanelRightOpen} aria-expanded={visible} onPress={()=>{if(visible)close();else if(episode)select(episode.id);}} isDisabled={!episode}>{uiText(visible?'收起预览':'预览')}</Button>;
 let content:ReactNode=null;
 if(episode){
  const state=episodeActionState(episode,summary),next=episodeNextAction(episode,state,summary);
  const account=props.accountsById.get(episode.account_id);
  const collection=props.collections?.[episode.id],baseline=episode.series_version_id?props.seriesVersionsById.get(episode.series_version_id):null;
  const seriesId=collection?collection.seriesId:baseline?.series_id;
  const series=seriesId?props.seriesById.get(seriesId):null;
  const data=preview.data,hasMedia=!!data?.exportedVideo||data?.artifacts?.some(item=>item.artifact_type==='cover'&&artifactPreviewKind(item.relative_path)==='image'||['final_render','render','review_render','review_render_video'].includes(item.artifact_type)&&artifactPreviewKind(item.relative_path)==='video');
  const hasVideo=!!data?.exportedVideo||data?.artifacts?.some(item=>['final_render','render','review_render','review_render_video'].includes(item.artifact_type)&&artifactPreviewKind(item.relative_path)==='video');
  content=<section className="production-preview-content">
   <header><h2>{uiText('生产单预览')}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭生产单预览')} onPress={close}/></header>
   {hasMedia?<><WorkbenchArtwork key={episode.id} episodeId={episode.id} title={episode.title||uiText('未命名生产单')} artifacts={data?.artifacts} exportedVideo={data?.exportedVideo} error={preview.error}/>{hasVideo&&<p className="production-preview-source">{uiText(data?.exportedVideo?'已导出视频':'已保存视频预览')}</p>}</>:<div className="production-script-summary"><h3>{uiText('脚本摘要')}</h3><p>{!data&&!preview.error?uiText('正在读取预览…'):preview.error?uiText('预览暂不可用，仍可进入制作。'):data?.sourceText?data.sourceText.trim().slice(0,320):data?.hasScript?uiText('脚本已添加，进入制作查看。'):uiText('尚未添加脚本')}</p></div>}
   <div className="production-preview-body"><h3>{episode.title||uiText('未命名生产单')}</h3><p className="production-preview-context">{[account?.name,series?.name].filter(Boolean).join(' · ')||uiText('未分系列')}</p><div className="production-preview-state"><span>{episodeWorkflowLabel(summary)??uiText(next.label)}</span><EpisodeStatus state={state}/></div><p>{uiText(summary?.blocker?.detail??next.detail)}</p><Button size="sm" color="primary" onPress={()=>props.onSelectEpisode(episode.id)}>{uiText(state==='done'?'查看成果':'进入制作')}</Button></div>
  </section>;
 }
 return <div ref={catalog} className="production-catalog" data-preview={visible&&!small}>
  <EpisodeWorkspace {...props} previewEpisodeId={episode?.id} onPreviewEpisode={select} tools={<>{props.tools}{toggle}</>}/>
  {visible&&(small?<MobilePreview onClose={close}>{content}</MobilePreview>:<aside className="production-preview" aria-label={uiText('生产单预览')}>{content}</aside>)}
 </div>;
}
