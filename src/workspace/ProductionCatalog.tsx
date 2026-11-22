import {useEffect,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {Play,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {artifactPreviewKind} from '../reviews/localArtifactPreview';
import {useWorkbenchPreview,WorkbenchArtwork} from '../operations/workbenchPreview';
import {EpisodeWorkspace} from './WorkspaceViews';
import {EpisodeStatus,episodeActionState,episodeNextAction,episodeWorkflowLabel} from './episodePresentation';
import {productionCatalogParameters,type CatalogVideoMetadata} from './productionCatalogPreview';
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
 const [videoMetadata,setVideoMetadata]=useState<{episodeId:string;revision:string;value:CatalogVideoMetadata}|null>(null);
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
 let content:ReactNode=null;
 if(episode){
  const state=episodeActionState(episode,summary),next=episodeNextAction(episode,state,summary);
  const account=props.accountsById.get(episode.account_id);
  const collection=props.collections?.[episode.id],baseline=episode.series_version_id?props.seriesVersionsById.get(episode.series_version_id):null;
  const seriesId=collection?collection.seriesId:baseline?.series_id;
  const series=seriesId?props.seriesById.get(seriesId):null;
  const data=preview.data;
  const hasMedia=!!data?.exportedVideo||data?.artifacts?.some(item=>item.artifact_type==='cover'&&artifactPreviewKind(item.relative_path)==='image'||['final_render','render','review_render','review_render_video'].includes(item.artifact_type)&&artifactPreviewKind(item.relative_path)==='video');
  const hasVideo=!!data?.exportedVideo||data?.artifacts?.some(item=>['final_render','render','review_render','review_render_video'].includes(item.artifact_type)&&artifactPreviewKind(item.relative_path)==='video');
  const metadata=videoMetadata?.episodeId===episode.id&&videoMetadata.revision===episode.updated_at?videoMetadata.value:undefined;
  const parameters=productionCatalogParameters(data?.sourceText??'',metadata,data?.captions);
  content=<section className="production-preview-content">
   <header><h2>{uiText('生产单预览')}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭生产单预览')} onPress={close}/></header>
   <div className="production-preview-body">
    <div className="production-preview-media">{hasMedia?<WorkbenchArtwork key={episode.id+episode.updated_at} episodeId={episode.id} title={episode.title||uiText('未命名生产单')} artifacts={data?.artifacts} exportedVideo={data?.exportedVideo} error={preview.error} onVideoMetadata={value=>setVideoMetadata({episodeId:episode.id,revision:episode.updated_at,value})}/>:<div className="production-preview-empty">{uiText(preview.error?'预览暂不可用':!data?'正在读取预览…':'尚无预览')}</div>}{hasVideo&&<p className="production-preview-source">{uiText(data?.exportedVideo?'已导出视频':'已保存视频预览')}</p>}</div>
    <h3 className="production-preview-title">{episode.title||uiText('未命名生产单')}</h3>
    <p className="production-preview-context">{[account?.name,series?.name].filter(Boolean).join(' · ')||uiText('未分系列')}</p>
    <div className="production-preview-state"><span className="production-preview-stage-label">{uiText('当前阶段')}</span><span>{episodeWorkflowLabel(summary)??uiText(next.label)}</span><EpisodeStatus state={state}/></div>
    {summary?.blocker&&<p className="production-preview-hint">{uiText(summary.blocker.detail)}</p>}
    <Button className="production-preview-open" size="sm" color="primary" iconLeading={Play} onPress={()=>props.onSelectEpisode(episode.id)}>{uiText(state==='done'?'查看成果':state==='review'?'前往审核':'进入制作')}</Button>
    <section className="production-preview-parameters" aria-label={uiText('主要参数')}><h3>{uiText('主要参数')}</h3><dl>{parameters.map(item=><div key={item.label}><dt>{uiText(item.label)}</dt><dd>{uiText(item.label==='时长'&&!hasVideo?'尚无视频':item.value)}</dd></div>)}</dl></section>
   </div>
  </section>;
 }
 return <div ref={catalog} className="production-catalog" data-preview={visible&&!small}>
  <EpisodeWorkspace {...props} previewEpisodeId={episode?.id} onPreviewEpisode={select} previewControl={{visible,disabled:!episode,onToggle:()=>{if(visible)close();else if(episode)select(episode.id);}}}/>
  {visible&&(small?<MobilePreview onClose={close}>{content}</MobilePreview>:<aside className="production-preview" aria-label={uiText('生产单预览')}>{content}</aside>)}
 </div>;
}
