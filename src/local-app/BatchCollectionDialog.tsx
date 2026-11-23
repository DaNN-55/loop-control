import {Layers} from 'lucide-react';
import {useEffect,useId,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchImpact,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext} from '../workspace/EpisodeBatch';
import {localCommand} from './client';
import type {moveEpisodeCollectionCommand} from './episodeCollection';
import './batch-collection.css';

type MoveResult=Awaited<ReturnType<typeof moveEpisodeCollectionCommand>>;
type Target={id:string;account_id:string;name:string};
const reasonFor=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';

function BatchMoveCollectionDialog({selection,onClose,onChanged,series,accountNames}:EpisodeBatchActionContext&{series:readonly Target[];accountNames:ReadonlyMap<string,string>}){
 const selectId=useId(),formId=useId();
 const [targetId,setTargetId]=useState('');
 const [results,setResults]=useState(new Map<string,MoveResult>());
 const [progress,setProgress]=useState<{processed:number;total:number}|null>(null);
 const [refreshFailed,setRefreshFailed]=useState(false);
 const active=useRef(false),running=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const accounts=new Set(selection.map(item=>item.accountId));
 const targets=[
  ...series.filter(item=>accounts.has(item.account_id)).map(item=>({id:item.id,seriesId:item.id,accountId:item.account_id,name:item.name})),
  ...[...accounts].map(accountId=>({id:'unassigned-'+accountId,seriesId:null,accountId,name:uiText('未分系列')})),
 ];
 const target=targets.find(item=>item.id===targetId);
 const affected:EpisodeBatchActionContext['selection'][number][]=[];
 const excluded:Array<{item:EpisodeBatchActionContext['selection'][number];reason:string}>=[];
 if(target&&!results.size)for(const item of selection){
  if(item.accountId!==target.accountId)excluded.push({item,reason:'生产单与目标系列必须属于同一账号。'});
  else if(item.collectionSeriesId===target.seriesId)excluded.push({item,reason:'生产单已在此系列位置。'});
  else affected.push(item);
 }
 const items=results.size?selection.filter(item=>results.get(item.id)?.status==='failed'):selection;

 async function move(){
  if(running.current||!target||!items.length)return;
  running.current=true;
  setProgress({processed:0,total:items.length});
  setRefreshFailed(false);
  const next=new Map(results);
  const destination={seriesId:target.seriesId,...(target.seriesId===null?{targetAccountId:target.accountId}:{})};
  let changed=false;
  try{
   for(const [index,item] of items.entries()){
    if(!active.current)return;
    const previous=next.get(item.id),migrationId=previous&&'migrationId' in previous?previous.migrationId:undefined;
    try{
     const result=await localCommand<MoveResult>('moveEpisodeCollection',{episodeId:item.id,...destination,...(migrationId?{migrationId}:{})},undefined,'account-commands');
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

 return <EpisodeBatchDialog compact title={uiText('批量调整系列')} busy={Boolean(progress)} onClose={onClose} footer={items.length>0&&
  <Button type="submit" form={formId} size="sm" color="primary" isDisabled={Boolean(progress)||!target}>
   {uiText(results.size?'只重试失败项':'确认调整系列')}
  </Button>
 }>
  <form hidden={results.size>0} id={formId} method="post" action="/api/local/account-commands" className="batch-collection-target" onSubmit={event=>{event.preventDefault();void move();}}>
   <label htmlFor={selectId}>{uiText('目标系列')}</label>
   <select id={selectId} name="target" required value={targetId} disabled={Boolean(progress)} onChange={event=>setTargetId(event.target.value)}>
    <option value="">{uiText('请选择目标系列')}</option>
    {targets.map(item=><option key={item.id} value={item.id}>{accounts.size>1?(accountNames.get(item.accountId)??item.accountId)+' · ':''}{item.name}</option>)}
   </select>
  </form>
  {results.size>0&&target&&<p className="episode-batch-meta"><Layers aria-hidden="true"/>{uiText('目标系列')} · {target.name}</p>}
  {!results.size&&target&&<>
   <EpisodeBatchImpact affected={affected} excluded={excluded}/>
   <p>{uiText('复制并校验通过后切换收纳位置，保留原文件和创作规则。')}</p>
  </>}
  {progress&&<p role="status">{uiText('已处理 {count} / {total} 张',{count:progress.processed,total:progress.total})}</p>}
  {refreshFailed&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')}</p>}
  {!!results.size&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={[...results.values()]}/></div>}
 </EpisodeBatchDialog>;
}

export function moveCollectionBatchAction(series:readonly Target[],accountNames:ReadonlyMap<string,string>):EpisodeBatchAction{
 return{id:'move-collection',get label(){return uiText('批量调整系列');},render:context=><BatchMoveCollectionDialog {...context} series={series} accountNames={accountNames}/>};
}
