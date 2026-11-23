import {useEffect,useId,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext,type EpisodeBatchItemResult} from '../workspace/EpisodeBatch';
import {localCommand} from './client';
import type {moveEpisodeCollectionCommand,readEpisodeDirectory} from './episodeCollection';
import './batch-collection.css';

type MoveResult=Awaited<ReturnType<typeof moveEpisodeCollectionCommand>>;
type FolderPreview={path?:string;reason?:string};
type Target={id:string;account_id:string;name:string};
const reasonFor=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';
const orderTitle=(title:string)=>title||uiText('未命名生产单');

function BatchMoveCollectionDialog({selection,onClose,onChanged,series,accountNames}:EpisodeBatchActionContext&{series:readonly Target[];accountNames:ReadonlyMap<string,string>}){
 const selectId=useId(),formId=useId();
 const [seriesId,setSeriesId]=useState('');
 const [results,setResults]=useState(new Map<string,MoveResult>());
 const [progress,setProgress]=useState<{processed:number;total:number}|null>(null);
 const [refreshFailed,setRefreshFailed]=useState(false);
 const active=useRef(false),running=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const accounts=new Set(selection.map(item=>item.accountId));
 const targets=series.filter(item=>accounts.has(item.account_id));
 const items=results.size?selection.filter(item=>results.get(item.id)?.status==='failed'):selection;

 async function move(){
  if(running.current||!seriesId||!items.length)return;
  running.current=true;
  setProgress({processed:0,total:items.length});
  setRefreshFailed(false);
  const next=new Map(results);
  let changed=false;
  try{
   for(const [index,item] of items.entries()){
    if(!active.current)return;
    const previous=next.get(item.id),migrationId=previous&&'migrationId' in previous?previous.migrationId:undefined;
    try{
     const result=await localCommand<MoveResult>('moveEpisodeCollection',{episodeId:item.id,seriesId,...(migrationId?{migrationId}:{})},undefined,'account-commands');
     next.set(item.id,result);
     changed ||= result.status==='success'||result.status==='skipped';
    }catch(error){
     next.set(item.id,{episodeId:item.id,status:'failed',reason:reasonFor(error),...(migrationId?{migrationId}:{})});
    }
    if(active.current)setProgress({processed:index+1,total:items.length});
   }
   if(!active.current)return;
   setResults(next);
   if(changed)try{await onChanged();}catch{if(active.current)setRefreshFailed(true);}
  }finally{
   running.current=false;
   if(active.current)setProgress(null);
  }
 }

 return <EpisodeBatchDialog title={uiText('批量调整系列')} busy={Boolean(progress)} onClose={onClose} footer={items.length>0&&
  <Button type="submit" form={formId} size="sm" color="primary" isDisabled={Boolean(progress)||!seriesId}>
   {uiText(results.size?'只重试失败项':'确认调整系列')}
  </Button>
 }>
  <form id={formId} method="post" action="/api/local/account-commands" className="batch-collection-target" onSubmit={event=>{event.preventDefault();void move();}}>
   <label htmlFor={selectId}>{uiText('目标系列')}</label>
   <select id={selectId} name="seriesId" required value={seriesId} disabled={Boolean(progress)||Boolean(results.size)} onChange={event=>setSeriesId(event.target.value)}>
    <option value="">{uiText('请选择目标系列')}</option>
    {targets.map(item=><option key={item.id} value={item.id}>{accounts.size>1?(accountNames.get(item.account_id)??item.account_id)+' · ':''}{item.name}</option>)}
   </select>
  </form>
  {!results.size&&<>
   <p>{uiText('复制并校验通过后切换收纳位置，保留原文件和创作规则。')}</p>
   {!targets.length&&<p role="status">{uiText('所选生产单的账号暂无可选系列。')}</p>}
   <ul role="list" className="episode-batch-items">{selection.map(item=><li key={item.id}><strong>{orderTitle(item.title)}</strong><span>{accountNames.get(item.accountId)}</span></li>)}</ul>
  </>}
  {progress&&<p role="status">{uiText('已处理 {count} / {total} 张',{count:progress.processed,total:progress.total})}</p>}
  {refreshFailed&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')}</p>}
  {!!results.size&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={[...results.values()]}/></div>}
 </EpisodeBatchDialog>;
}

async function previewFolder(episodeId:string):Promise<FolderPreview>{
 try{
  return await localCommand<Awaited<ReturnType<typeof readEpisodeDirectory>>>('readEpisodeDirectory',{episodeId},undefined,'account-commands');
 }catch(error){return{reason:reasonFor(error)};}
}

function BatchFoldersDialog({selection,onClose}:EpisodeBatchActionContext){
 const [folders,setFolders]=useState(new Map<string,FolderPreview>());
 const [results,setResults]=useState(new Map<string,EpisodeBatchItemResult>());
 const [busy,setBusy]=useState<'read'|'open'|null>('read');
 const active=useRef(false),running=useRef(false);
 useEffect(()=>{
  let current=true;
  active.current=true;
  async function load(){
   const next=new Map<string,FolderPreview>();
   for(const {id} of selection){
    if(!current)return;
    next.set(id,await previewFolder(id));
   }
   if(current){setFolders(next);setBusy(null);}
  }
  void load();
  return()=>{current=false;active.current=false;};
 },[selection]);
 const failed=selection.filter(item=>folders.get(item.id)?.reason||results.get(item.id)?.status==='failed');
 const unopened=selection.filter(item=>{
  const folder=folders.get(item.id);
  return folder?.path&&!folder.reason&&!results.has(item.id);
 });

 async function openOrRetry(targets:readonly {id:string}[],retry=false){
  if(running.current||busy)return;
  running.current=true;
  setBusy('open');
  const nextFolders=new Map(folders),nextResults=new Map(results);
  try{
   for(const {id} of targets){
    if(!active.current)return;
    const previous=nextFolders.get(id);
    if(retry&&previous?.reason){
     nextFolders.set(id,await previewFolder(id));
     continue;
    }
    try{
     const {path}=await localCommand<{opened:true;path:string}>('openDirectory',{episodeId:id},undefined,'episode-commands');
     nextFolders.set(id,{path});
     nextResults.set(id,{episodeId:id,status:'success'});
    }catch(error){
     nextResults.set(id,{episodeId:id,status:'failed',reason:reasonFor(error)});
    }
   }
   if(active.current){setFolders(nextFolders);setResults(nextResults);}
  }finally{
   running.current=false;
   if(active.current)setBusy(null);
  }
 }

 return <EpisodeBatchDialog title={uiText('查看文件夹')} busy={Boolean(busy)} onClose={onClose} footer={(unopened.length>0||failed.length>0)&&<>
  {failed.length>0&&<Button type="button" size="sm" color="secondary" isDisabled={Boolean(busy)} onPress={()=>void openOrRetry(failed,true)}>{uiText('只重试失败项')}</Button>}
  {unopened.length>0&&<Button type="button" size="sm" color="primary" isDisabled={Boolean(busy)} onPress={()=>void openOrRetry(unopened)}>{uiText('打开可用文件夹')}</Button>}
 </>}>
  {busy&&<p role="status">{uiText(busy==='read'?'正在核对登记目录…':'正在处理文件夹…')}</p>}
  <ul role="list" className="episode-batch-items">{selection.map(item=>{
   const folder=folders.get(item.id),title=orderTitle(item.title);
   return <li className="batch-collection-folder" key={item.id}>
    <strong>{title}</strong>
    {folder?.path&&<code>{folder.path}</code>}
    {folder?.reason&&<span>{uiText(folder.reason)}</span>}
    {folder?.path&&!folder.reason&&<Button type="button" size="sm" color="secondary" isDisabled={Boolean(busy)} aria-label={uiText('打开文件夹 · {title}',{title})} onPress={()=>void openOrRetry([item])}>{uiText('打开文件夹')}</Button>}
   </li>;
  })}</ul>
  {!!results.size&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={[...results.values()]}/></div>}
 </EpisodeBatchDialog>;
}

export function moveCollectionBatchAction(series:readonly Target[],accountNames:ReadonlyMap<string,string>):EpisodeBatchAction{
 return{id:'move-collection',get label(){return uiText('批量调整系列');},render:context=><BatchMoveCollectionDialog {...context} series={series} accountNames={accountNames}/>};
}

export const foldersBatchAction:EpisodeBatchAction={
 id:'folders',get label(){return uiText('查看文件夹');},render:context=><BatchFoldersDialog {...context}/>,
};
