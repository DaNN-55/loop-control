import {WorkspaceGenerationComposer,WorkspaceComposerSetting} from './WorkspaceGenerationComposer';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {WorkspacePromptField} from './WorkspacePromptField';
import {ImagePreview} from '../ui/media/ImagePreview';
import {VideoPreview} from '../ui/media/VideoPreview';
import {useWorkspacePolling,type WorkspaceReading} from './useWorkspaceReading';
import {useEffect,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {ProductionSelection} from '../productionSelection';
import type {ProductionService,ProductionServiceCatalog} from '../connections/serviceCatalog';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import './workspace-pexels.css';
function PexelsThumbnail({id,url}:{id:number;url?:string}){
 const [state,setState]=useState<'loading'|'ready'|'failed'>('loading');
 return <div className="workspace-pexels-thumbnail" aria-busy={!!url&&state==='loading'}>
  {url&&state!=='failed'&&<ImagePreview alt={`Pexels ${id} 缩略图`} src={url} loading="lazy" referrerPolicy="no-referrer" onLoad={()=>setState('ready')} onError={()=>setState('failed')}/>}
  {(!url||state!=='ready')&&<span role="status">{!url?'暂无缩略图':state==='failed'?'缩略图加载失败':'缩略图加载中…'}</span>}
 </div>;
}
export function WorkspacePexelsSearch({workspace,targetItemId,command,onChange,prepare,reader,disabled=false,composer}:{workspace:ProductionWorkspace;targetItemId:string;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;prepare:()=>Promise<ProductionWorkspace>;reader:WorkspaceReading;disabled?:boolean;composer?:{services:ProductionService[];selection?:ProductionSelection|null;onModelChange:(value:string)=>void;catalogError?:string}}){
 const key=`loop-pexels-draft:${workspace.id}:${targetItemId}`;
 const [draft,setDraft]=useState<{query:string;orientation:string;size:string;page:string;selection?:ProductionSelection|null}>(()=>{try{return JSON.parse(sessionStorage.getItem(key)??'null')??{query:'',orientation:'portrait',size:'medium',page:'1'};}catch{return{query:'',orientation:'portrait',size:'medium',page:'1'};}}),[services,setServices]=useState<ProductionService[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[connectionLoading,setConnectionLoading]=useState(true),[connectionAttempt,setConnectionAttempt]=useState(0),[resultsError,setResultsError]=useState(''),[resultsLoading,setResultsLoading]=useState(false);
 const [settingsPanel,setSettingsPanel]=useState('');
 const selection=composer?composer.selection:draft.selection;
 const working=useRef(false),reading=useRef(false),latest=useRef(onChange);latest.current=onChange;
 useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{/* Draft storage is optional. */}},[key,draft]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setConnectionLoading(true);
  void fetch('/api/local/connections',{signal:controller.signal}).then(async r=>{
   if(!r.ok)throw Error();const catalog=(await r.json()).serviceCatalog as ProductionServiceCatalog;
   const available=catalog.groups.find(g=>g.capability==='video')?.services.filter(s=>s.mode==='search'&&s.provider==='pexels'&&s.adapter==='pexels_video')??[];
   if(active){setServices(available);setConnectionError('');}
  }).catch(()=>{if(active)setConnectionError('无法读取 Pexels 连接。');}).finally(()=>{if(active)setConnectionLoading(false);});
  return()=>{active=false;controller.abort();};
 },[workspace.id,connectionAttempt]);
 const requests=(workspace.pexels?.requests??[]).filter(r=>r.targetItemId===targetItemId),pending=requests.filter(r=>['ready','running'].includes(r.status)),taskKey=pending.map(r=>r.taskId).join(':'),search=requests.find(r=>r.operation==='search'),previews=requests.filter(r=>r.operation==='preview'&&r.source?.searchId===search?.id),service=services.find(s=>s.connectionVersionId===selection?.connectionVersionId);
 useEffect(()=>setResultsError(''),[workspace]);
 useWorkspacePolling(reader,!!taskKey,1500,()=>setResultsError('无法读取 Pexels 结果。'));
 async function retryResults(){
  if(reading.current)return;reading.current=true;setResultsLoading(true);
  try{await reader.read();setResultsError('');}
  catch(cause){if(!(cause instanceof Error&&cause.name==='AbortError'))setResultsError(cause instanceof Error?cause.message:'无法读取 Pexels 结果。');}
  finally{reading.current=false;setResultsLoading(false);}
 }
 async function run(name:string,data:Record<string,unknown>){if(working.current)return;working.current=true;setBusy(true);setError('');try{const w=await prepare();latest.current(await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...data}) as ProductionWorkspace);}catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setError(e instanceof Error?e.message:'Pexels 操作未完成，请重试。');}finally{working.current=false;setBusy(false);}}
 const locked=disabled||busy;
 function artifact(path:string,sha:string){return '/_local-artifact?episode='+encodeURIComponent(workspace.episodeId)+'&path='+encodeURIComponent(path)+'&sha256='+sha;}
 const orientationField=<label>方向<NativeSelect size="sm" aria-label="Pexels 方向" value={draft.orientation} disabled={locked} onChange={e=>setDraft(d=>({...d,orientation:e.target.value}))}><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></NativeSelect></label>;
 const sizeField=<label>尺寸<NativeSelect size="sm" aria-label="Pexels 尺寸" value={draft.size} disabled={locked} onChange={e=>setDraft(d=>({...d,size:e.target.value}))}><option value="large">大</option><option value="medium">中</option><option value="small">小</option></NativeSelect></label>;
 const pageField=<label>页码<input aria-label="Pexels 页码" type="number" min="1" max="100" step="1" value={draft.page} disabled={locked} onChange={e=>setDraft(d=>({...d,page:e.target.value}))}/></label>;
 const submit=<Button size="sm" color="primary" isDisabled={locked||!service?.executable||!draft.query.trim()||draft.query.length>100||!Number.isInteger(Number(draft.page))||Number(draft.page)<1||Number(draft.page)>100||pending.some(r=>r.operation==='search')} onPress={()=>void run('searchWorkspacePexelsVideos',{targetItemId,selection,query:draft.query,orientation:draft.orientation,size:draft.size,page:Number(draft.page)})}>{composer?'检索视频':'检索 Pexels'}</Button>;
 return <div className="workspace-pexels">
  {composer?<WorkspaceGenerationComposer kind="video" operation="search" disabled={locked} reference={null}
   prompt={<WorkspacePromptField label="检索词" ariaLabel="检索词" value={draft.query} limit={100} disabled={locked} onChange={query=>setDraft(d=>({...d,query}))} placeholder="例如：山间云海、城市夜景，或 mountain clouds"/>}
   model={<WorkspaceGenerationModel compact kind="视频" services={composer.services} selection={selection} disabled={locked} onChange={composer.onModelChange}/>}
   settings={<><WorkspaceComposerSetting label="Pexels 方向" summary={{portrait:'竖屏',landscape:'横屏',square:'方形'}[draft.orientation]??draft.orientation} open={settingsPanel==='orientation'} onOpenChange={open=>setSettingsPanel(open?'orientation':'')} disabled={locked} compact>{orientationField}</WorkspaceComposerSetting><WorkspaceComposerSetting label="Pexels 尺寸" summary={{large:'大',medium:'中',small:'小'}[draft.size]??draft.size} open={settingsPanel==='size'} onOpenChange={open=>setSettingsPanel(open?'size':'')} disabled={locked} compact>{sizeField}</WorkspaceComposerSetting><WorkspaceComposerSetting label="Pexels 页码" summary={`第 ${draft.page} 页`} open={settingsPanel==='page'} onOpenChange={open=>setSettingsPanel(open?'page':'')} disabled={locked} compact>{pageField}</WorkspaceComposerSetting></>}
   submit={submit} onMaterial={()=>{}} onFiles={()=>{}}>
   {composer.catalogError&&<p role="alert">{composer.catalogError}</p>}
  </WorkspaceGenerationComposer>:<>
  <label>连接<NativeSelect aria-label="Pexels 连接" size="sm" value={service?.id??''} disabled={locked} onChange={e=>{const s=services.find(s=>s.id===e.target.value);setDraft(d=>({...d,selection:s?{capability:'video',provider:s.provider,adapter:s.adapter,connectionVersionId:s.connectionVersionId??undefined}:null}));}}><option value="">选择 Pexels 连接</option>{services.map(s=><option key={s.id} value={s.id} disabled={!s.executable}>{s.connectionName??s.label} · v{s.connectionVersion??'—'}{!s.executable?` · ${s.unavailableReason}`:''}</option>)}</NativeSelect></label>
  <label>检索词<input aria-label="检索词" value={draft.query} maxLength={100} disabled={locked} onChange={e=>setDraft(d=>({...d,query:e.target.value}))}/></label>
  <div className="workspace-visual-fields">{orientationField}{sizeField}{pageField}</div>
  {submit}</>}
  {connectionError&&<div className="workspace-pexels-retry"><p role="alert">{connectionError}</p><Button size="sm" color="secondary" isDisabled={connectionLoading} onPress={()=>setConnectionAttempt(n=>n+1)}>{connectionLoading?'正在读取连接…':'重试读取连接'}</Button></div>}
  {selection&&!service&&!connectionLoading&&!connectionError&&<p role="alert">原 Pexels 连接不可用，请重新选择。</p>}
  <a href="https://www.pexels.com" target="_blank" rel="noreferrer">视频来源 Pexels</a>
  {resultsError&&<div className="workspace-pexels-retry"><p role="alert">{resultsError}</p><Button size="sm" color="secondary" isDisabled={resultsLoading} onPress={()=>void retryResults()}>{resultsLoading?'正在读取结果…':'重试读取结果'}</Button></div>}
  {pending.length>0&&<p role="status">{pending.some(r=>r.operation==='search')?'正在检索…':'正在下载所选预览…'}</p>}
  {search&&<p>{search.connectionName} · {search.query} · 第 {search.parameters.page} 页</p>}
  {search?.results?.length===0&&<p role="status">没有找到视频，请修改检索词、方向或页码后重试。</p>}
  {search?.results&&search.results.length>0&&<ol className="workspace-pexels-results" aria-label="Pexels 检索结果">{search.results.map(result=>{const preview=previews.find(r=>r.source?.id===result.id);return <li key={result.id}>
   {!preview?.preview&&<PexelsThumbnail key={result.thumbnailUrl??'missing'} id={result.id} url={result.thumbnailUrl}/>} <div className="workspace-pexels-result-source"><a href={result.sourceUrl} target="_blank" rel="noreferrer">Pexels #{result.id}</a><a href={result.creatorUrl} target="_blank" rel="noreferrer">{result.creator}</a><span>{result.durationSeconds} 秒 · {result.width}×{result.height}</span></div>
   {preview?.preview?<><VideoPreview title={`Pexels ${result.id} 预览`} aria-label={`Pexels ${result.id} 预览`} src={artifact(preview.preview.relativePath,preview.preview.sha256)}/><Button size="sm" color="secondary" isDisabled={locked||!!preview.candidateId} onPress={()=>void run('importWorkspacePexelsVideo',{previewId:preview.id})}>{preview.candidateId?'已导入候选':'导入为画面候选'}</Button></>:<Button size="sm" color="secondary" isDisabled={locked||pending.some(r=>r.operation==='preview')} onPress={()=>void run('previewWorkspacePexelsVideo',{searchId:search.id,resultId:result.id})}>下载预览 #{result.id}</Button>}
   {preview?.error&&<p role="alert">预览下载失败，请重试。{preview.error}</p>}
  </li>;})}</ol>}
  {search?.error&&<p role="alert">检索未完成，请检查连接或修改检索条件后重试。{search.error}</p>}{error&&<p role="alert">{error}</p>}
 </div>;
}
