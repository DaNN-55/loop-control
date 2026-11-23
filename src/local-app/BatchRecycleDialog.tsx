import {useEffect,useRef,useState} from 'react';
import {getUiLocale,uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext} from '../workspace/EpisodeBatch';
import {localCommand,localRequest} from './client';
import type {RecycleBatchItemResult,RecycleBatchPreview,RecycleBatchResult,RecycleBinItem,RecycleBinSummary} from './recycleBatchTypes';

const titleFor=(title:string)=>title||uiText('未命名生产单');
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';
const recycleSize=(bytes:number)=>new Intl.NumberFormat(getUiLocale(),{maximumFractionDigits:3}).format(bytes/1e9)+' GB';

function replaceResults<T extends RecycleBatchItemResult>(current:T[],next:T[]){
 const updated=new Map(current.map(item=>[item.episodeId,item]));
 for(const item of next)updated.set(item.episodeId,item);
 return [...updated.values()];
}

function RecycleProjection({preview,selection}:{preview:RecycleBatchPreview;selection:EpisodeBatchActionContext['selection']}){
 const titles=new Map(selection.map(item=>[item.id,item.title]));
 return <>
  <p>{uiText('当前 {current}，移入后 {added}，预计清理后 {projected}，上限 {limit}。',{
   current:recycleSize(preview.currentBytes),added:recycleSize(preview.afterMoveBytes),projected:recycleSize(preview.projectedBytes),limit:recycleSize(preview.limitBytes),
  })}</p>
  {preview.pendingBytes>0&&<p>{uiText('含待释放容量 {size}。',{size:recycleSize(preview.pendingBytes)})}</p>}
  <h3>{uiText('本次选择')}</h3>
  <ul role="list" className="episode-batch-items">{preview.items.map(item=><li key={item.episodeId}>
   <strong>{titleFor(titles.get(item.episodeId)??'')}</strong>
   <span>{item.status==='ready'?uiText('可移入 · {size}',{size:recycleSize(item.sizeBytes)}):uiText(item.status==='skipped'?'跳过':'失败')+' · '+uiText(item.reason)}</span>
  </li>)}</ul>
  <h3>{uiText('预计永久清理')}</h3>
  {preview.candidates.length?<ul role="list" className="episode-batch-items">{preview.candidates.map(item=><li key={item.episodeId}><strong>{titleFor(item.title)}</strong><span>{recycleSize(item.sizeBytes)}</span></li>)}</ul>:<p>{uiText('预计无需永久清理。')}</p>}
  {!!preview.retained.length&&<><h3>{uiText('因保护规则保留')}</h3><ul role="list" className="episode-batch-items">{preview.retained.map(item=><li key={item.episodeId}><strong>{titleFor(item.title)}</strong><span>{uiText(item.reason)}</span></li>)}</ul></>}
  {preview.projectedBytes>preview.limitBytes&&<p role="status">{uiText('预计清理后仍超出上限。')}</p>}
  {!!preview.candidates.length&&<p>{uiText('确认后，预计清理的旧生产单可能永久删除。刚移入的本批生产单受保护。')}</p>}
 </>;
}

function BatchRecycleDialog({selection,onClose,onChanged}:EpisodeBatchActionContext){
 const [preview,setPreview]=useState<RecycleBatchPreview|null>(null);
 const [results,setResults]=useState<RecycleBatchItemResult[]>([]);
 const [cleanups,setCleanups]=useState<NonNullable<RecycleBatchResult['cleanup']>['items']>([]);
 const [capacity,setCapacity]=useState<RecycleBatchResult['cleanup']>();
 const [busy,setBusy]=useState<'preview'|'submit'|null>('preview'),[error,setError]=useState('');
 const active=useRef(false),running=useRef(false),lastPreviewIds=useRef<string[]>([]);
 const ready=preview?.items.filter(item=>item.status==='ready')??[];
 const failedIds=(preview?.items??results).filter(item=>item.status==='failed').map(item=>item.episodeId);

 async function load(episodeIds:string[],retainEpisodeIds:string[],signal?:AbortSignal){
  lastPreviewIds.current=episodeIds;
  setBusy('preview');
  setPreview(null);
  setError('');
  try{
   const report:RecycleBatchPreview=await localRequest('recycle-bin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'previewBatchRecycle',data:{episodeIds,retainEpisodeIds}}),signal});
   if(active.current&&!signal?.aborted)setPreview(report);
  }catch(error){
   if(active.current&&!signal?.aborted)setError(errorMessage(error));
  }finally{
   if(active.current&&!signal?.aborted)setBusy(null);
  }
 }

 useEffect(()=>{
  const controller=new AbortController();
  active.current=true;
  void load(selection.map(item=>item.id),[],controller.signal);
  return()=>{active.current=false;controller.abort();};
 },[selection]);

 async function confirm(){
  if(running.current||!preview||!ready.length)return;
  running.current=true;
  setBusy('submit');
  setError('');
  const cleanup=preview.candidates.map(({episodeId,revision})=>({episodeId,revision}));
  try{
   const result=await localCommand<RecycleBatchResult>('batchRecycleEpisodes',{episodeIds:ready.map(item=>item.episodeId),cleanup,previewKey:preview.previewKey},undefined,'recycle-bin');
   if(!active.current)return;
   const ineligible=preview.items.filter(item=>item.status!=='ready');
   setResults(current=>replaceResults(current,[...ineligible,...result.items]));
   setPreview(null);
   lastPreviewIds.current=[];
   const actualCleanup=result.cleanup;
   if(actualCleanup){
    setCleanups(current=>replaceResults(current,actualCleanup.items));
    setCapacity(actualCleanup);
   }
   if(result.items.some(item=>item.status==='success'))await onChanged();
  }catch(error){
   if(active.current){
    setError(errorMessage(error));
    if((error as {status?:number})?.status===409)setPreview(null);
   }
  }finally{running.current=false;if(active.current)setBusy(null);}
 }

 const retainedIds=results.filter(item=>item.status==='success').map(item=>item.episodeId);
 function retryFailed(){
  if(preview)setResults(current=>replaceResults(current,preview.items.filter(item=>item.status!=='ready')));
  void load(failedIds,retainedIds);
 }
 return <EpisodeBatchDialog title={uiText('批量移入回收站')} busy={busy==='submit'} onClose={onClose} footer={<>
  {!busy&&!preview&&!!error&&!!lastPreviewIds.current.length&&!failedIds.length&&<Button size="sm" color="secondary" onPress={()=>void load(lastPreviewIds.current,retainedIds)}>{uiText('重新预览')}</Button>}
  {!busy&&!!failedIds.length&&(!preview||!ready.length)&&<Button size="sm" color="secondary" onPress={retryFailed}>{uiText('只重试失败项')}</Button>}
  {preview&&<Button size="sm" color="primary" isDisabled={!!busy||!ready.length} onPress={()=>void confirm()}>{uiText('确认移入 {count} 张',{count:ready.length})}</Button>}
 </>}>
  {busy&&<p role="status">{uiText(busy==='preview'?'正在核对回收站容量…':'正在移入回收站…')}</p>}
  {error&&<p role="alert">{uiText(error)}</p>}
  {preview&&<RecycleProjection preview={preview} selection={selection}/>}
  {!!results.length&&<div className="episode-batch-results" aria-live="polite">
   <EpisodeBatchResults selection={selection} results={results}/>
   {!!cleanups.length&&<EpisodeBatchResults title={uiText('容量清理结果')} selection={cleanups.map(item=>({id:item.episodeId,title:item.title}))} results={cleanups}/>}
   {capacity&&<p>{uiText('当前占用 {used}，上限 {limit}。',{used:recycleSize(capacity.usedBytes),limit:recycleSize(capacity.limitBytes)})}</p>}
   {capacity&&capacity.usedBytes>capacity.limitBytes&&<p>{uiText('当前仍超出回收站上限。')}</p>}
   {capacity&&capacity.pendingBytes>0&&<p>{uiText('待释放 {size}，请继续文件清理。',{size:recycleSize(capacity.pendingBytes)})}</p>}
  </div>}
 </EpisodeBatchDialog>;
}

export const recycleBatchAction:EpisodeBatchAction={
 id:'recycle',get label(){return uiText('批量移入回收站');},
 render:context=><BatchRecycleDialog {...context}/>,
};

export function BatchRestoreDialog({selection,onClose,onChanged}:{selection:readonly RecycleBinItem[];onClose:()=>void;onChanged:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[results,setResults]=useState<RecycleBatchItemResult[]>([]);
 const running=useRef(false);
 const attempt=useRef<{items:{episodeId:string;revision:string}[];missing:RecycleBatchItemResult[]}|null>(null);
 const failed=new Set(results.filter(item=>item.status==='failed').map(item=>item.episodeId));
 const targets=results.length?selection.filter(item=>failed.has(item.episodeId)):selection;

 async function restore(){
  if(running.current||!targets.length)return;
  running.current=true;
  setBusy(true);
  setError('');
  try{
   if(!attempt.current){
    const latest:RecycleBinSummary|undefined=results.length?await localRequest('recycle-bin'):undefined;
    const current=latest?new Map(latest.items.map(item=>[item.episodeId,item.revision])):undefined;
    const items=[],missing:RecycleBatchItemResult[]=[];
    for(const item of targets){
     const episodeId=item.episodeId,revision=current?current.get(episodeId):item.revision;
     if(revision)items.push({episodeId,revision});
     else missing.push({episodeId,status:'skipped',reason:'回收站记录不存在或无管理权限。'});
    }
    attempt.current={items,missing};
   }
   const {items,missing}=attempt.current;
   const result=items.length?await localCommand<RecycleBatchResult>('batchRestoreRecycledEpisodes',{items},undefined,'recycle-bin'):{items:[]};
   setResults(previous=>replaceResults(previous,[...result.items,...missing]));
   attempt.current=null;
   if(result.items.some(item=>item.status==='success'))await onChanged();
  }catch(error){setError(errorMessage(error));}
  finally{running.current=false;setBusy(false);}
 }

 return <EpisodeBatchDialog title={uiText('批量恢复')} busy={busy} onClose={onClose} footer={!!targets.length&&
  <Button size="sm" color="primary" isDisabled={busy} onPress={()=>void restore()}>{uiText(results.length?'只重试失败项':'确认恢复 {count} 张',{count:targets.length})}</Button>
 }>
  {busy&&<p role="status">{uiText('正在恢复生产单…')}</p>}
  {error&&<p role="alert">{uiText(error)}</p>}
  {results.length?<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection.map(item=>({id:item.episodeId,title:titleFor(item.title)}))} results={results}/></div>:<>
   <p>{uiText('生产单将恢复到原账号、系列和归档状态。')}</p>
   <ul role="list" className="episode-batch-items">{selection.map(item=><li key={item.episodeId}><strong>{titleFor(item.title)}</strong><span>{item.accountName}{item.archivedBefore?uiText(' · 原已归档'):''}</span></li>)}</ul>
  </>}
 </EpisodeBatchDialog>;
}
