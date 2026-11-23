import {useEffect,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {ScriptStudioReviewShots} from './ScriptStudioReviewShots';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext,type EpisodeBatchItemResult} from '../workspace/EpisodeBatch';
import {localCommand,localRequest} from './client';
import type {ScriptReview} from './batchScriptReview';

type Result=EpisodeBatchItemResult&{requiresReview?:boolean};
type Item={episodeId:string;review?:ScriptReview;readError?:string;result?:Result;picked?:boolean};
const message=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';

async function reviewFor(item:Item,signal?:AbortSignal):Promise<Item>{
 try{
  const review=await localRequest('episodes/'+encodeURIComponent(item.episodeId)+'/batch-script-review',{signal}) as ScriptReview;
  return {episodeId:item.episodeId,review};
 }catch(error){return {episodeId:item.episodeId,readError:message(error)};}
}

export function BatchScriptReviewDialog({selection,onClose,onChanged}:EpisodeBatchActionContext){
 const [items,setItems]=useState<Item[]>(()=>selection.map(item=>({episodeId:item.id})));
 const [busy,setBusy]=useState<'read'|'submit'|null>('read'),[submitted,setSubmitted]=useState(false),[refreshError,setRefreshError]=useState('');
 const active=useRef(false),locked=useRef(false);
 const titles=new Map(selection.map(item=>[item.id,item.title]));
 const pending=items.filter(item=>!item.result),results=items.flatMap(item=>item.result?[item.result]:[]);
 const picked=pending.filter(item=>item.picked&&item.review?.status==='ready');
 const retryable=items.filter(item=>item.result?.status==='failed'&&!item.result.requiresReview);
 const rereadable=items.filter(item=>item.readError||item.result?.requiresReview);

 useEffect(()=>{
  const controller=new AbortController();
  active.current=true;
  void readItems(selection.map(item=>({episodeId:item.id})),controller.signal);
  return()=>{active.current=false;controller.abort();};
 },[selection]);

 async function readItems(targets:Item[],signal?:AbortSignal){
  setBusy('read');
  const replacements=new Map<string,Item>();
  for(let offset=0;offset<targets.length;offset+=4){
   if(signal?.aborted||!active.current)return;
   for(const item of await Promise.all(targets.slice(offset,offset+4).map(item=>reviewFor(item,signal))))replacements.set(item.episodeId,item);
  }
  if(signal?.aborted||!active.current)return;
  setItems(current=>current.map(item=>replacements.get(item.episodeId)??item));
  setBusy(null);
 }

 async function submit(targets:Item[],retry=false){
  if(locked.current||busy||!targets.length)return;
  locked.current=true;
  setBusy('submit');
  setRefreshError('');
  const outcome=new Map<string,Result>();
  try{
   for(const {episodeId,review} of targets){
    if(!active.current)return;
    if(review?.status!=='ready')continue;
    try{
     const result=await localCommand<Result>('confirmReviewedScript',{episodeId,reviewFingerprint:review.reviewFingerprint},undefined,'episode-commands');
     outcome.set(episodeId,result);
    }catch(error){outcome.set(episodeId,{episodeId,status:'failed',reason:message(error)});}
   }
   if(!active.current)return;
   setSubmitted(true);
   setItems(current=>current.map(item=>{
    const result=outcome.get(item.episodeId);
    if(result)return {...item,result,picked:false};
    if(retry||item.result)return item;
    if(item.readError)return {...item,result:{episodeId:item.episodeId,status:'failed',reason:item.readError,requiresReview:true}};
    return {...item,result:{episodeId:item.episodeId,status:'skipped',reason:item.review?.status==='skipped'?item.review.reason:'本次未勾选通过。'}};
   }));
   if([...outcome.values()].some(item=>item.status==='success')){
    try{await onChanged();}catch(error){if(active.current)setRefreshError(message(error));}
   }
  }finally{
   locked.current=false;
   if(active.current)setBusy(null);
  }
 }

 return <EpisodeBatchDialog title={uiText('批量确认脚本')} busy={busy==='submit'} onClose={onClose} footer={<>
  {rereadable.length>0&&<Button size="sm" color="secondary" isDisabled={!!busy} onPress={()=>void readItems(rereadable)}>{uiText('重新核对失败项')}</Button>}
  {retryable.length>0&&<Button size="sm" color="secondary" isDisabled={!!busy} onPress={()=>void submit(retryable,true)}>{uiText('只重试失败项')}</Button>}
  {!!pending.length&&<Button size="sm" color="primary" isDisabled={!!busy||!picked.length} onPress={()=>void submit(picked)}>{uiText('确认勾选脚本')}</Button>}
 </>}>
  {busy&&<p role="status">{uiText(busy==='read'?'正在读取待确认脚本…':'正在确认勾选脚本…')}</p>}
  {refreshError&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')} {uiText(refreshError)}</p>}
  {!!pending.length&&busy!=='read'&&<p>{uiText('展开核对原文和分镜，勾选通过的生产单后提交。')}</p>}
  {busy!=='read'&&pending.map(item=>{
   const title=titles.get(item.episodeId)??item.episodeId;
   if(item.review?.status!=='ready')return <div key={item.episodeId} className="episode-batch-review-item"><strong>{title}</strong><p>{uiText(item.readError??(item.review?.status==='skipped'?item.review.reason:''))}</p></div>;
   const {sourceText,targetDuration,plan,sourceName}=item.review;
   return <section key={item.episodeId} className="episode-batch-review-item">
    <label className="episode-batch-review-check"><input type="checkbox" name="approved" checked={!!item.picked} disabled={!!busy} onChange={event=>{const picked=event.target.checked;setItems(current=>current.map(value=>value.episodeId===item.episodeId?{...value,picked}:value));}}/>
     <span>{uiText('通过 {title}',{title})}</span>
    </label>
    <details open={pending.length===1||undefined}><summary>{uiText('核对 {title} 的脚本和分镜',{title})}</summary>
     <h3>{uiText('脚本原文')}</h3><pre>{sourceText||'—'}</pre>
     {sourceName&&<p><small>{sourceName}</small></p>}
     {targetDuration!==null&&<p>{uiText('目标时长')} · {uiText('{value0} 秒',{value0:targetDuration})}</p>}
     <h3>{uiText('分镜')} · {uiText('{value0} 秒',{value0:plan.durationSeconds})}</h3>
     {plan.settings.length>0&&<dl>{plan.settings.map(setting=><div key={setting.field}><dt>{uiText(setting.field)}</dt><dd>{uiText(setting.value)}</dd></div>)}</dl>}
     {plan.warnings.length>0&&<ul>{plan.warnings.map(warning=><li key={warning}>{uiText(warning)}</li>)}</ul>}
     <ScriptStudioReviewShots plan={plan}/>
    </details>
   </section>;
  })}
  {submitted&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={results}/></div>}
 </EpisodeBatchDialog>;
}

export const scriptReviewBatchAction:EpisodeBatchAction={
 id:'script-review',get label(){return uiText('批量确认脚本');},
 render:context=><BatchScriptReviewDialog {...context}/>,
};
