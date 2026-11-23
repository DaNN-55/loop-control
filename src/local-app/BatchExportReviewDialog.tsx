import {Fragment,useEffect,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {localArtifactUrl} from '../reviews/localArtifactPreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext,type EpisodeBatchItemResult} from '../workspace/EpisodeBatch';
import {localCommand,localRequest} from './client';
import type {BatchExportReview} from './batchExportReview';

type ReadyReview=Extract<BatchExportReview,{status:'ready'}>;
type Result=EpisodeBatchItemResult&{requiresReview?:boolean};
type Decision='approve'|'change';
type Item={episodeId:string;review?:ReadyReview;result?:Result;playable?:boolean;decision?:Decision};

function readFailure(episodeId:string,reason:string):Result{
 return {episodeId,status:'failed',reason,requiresReview:true};
}

const errorMessage=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';

async function readReview(episodeId:string,signal:AbortSignal):Promise<Item>{
 try{
  const review:BatchExportReview=await localRequest('episodes/'+encodeURIComponent(episodeId)+'/batch-export-review',{signal});
  if(review.status==='ready')return {episodeId,review};
  return {episodeId,result:review.status==='skipped'?{episodeId,status:'skipped',reason:review.reason}:readFailure(episodeId,review.reason)};
 }catch(error){return {episodeId,result:readFailure(episodeId,errorMessage(error))};}
}

export function BatchExportReviewDialog({selection,onClose,onChanged}:EpisodeBatchActionContext){
 const [items,setItems]=useState<Item[]>([]);
 const [busy,setBusy]=useState<'read'|'submit'|null>('read');
 const [previewId,setPreviewId]=useState('');
 const [refreshError,setRefreshError]=useState('');
 const lifetime=useRef<AbortController>(null),locked=useRef(false);
 const titles=new Map(selection.map(item=>[item.id,item.title]));
 const pending=items.filter((item):item is Item&{review:ReadyReview}=>!!item.review&&!item.result);
 const approved=pending.filter(item=>item.decision==='approve');
 const rereadable=items.filter(item=>item.result?.requiresReview);
 const retryable=items.filter(item=>item.result?.status==='failed'&&!item.result.requiresReview);
 const results=items.flatMap(item=>item.result?[item.result]:[]);

 useEffect(()=>{
  const controller=new AbortController();
  lifetime.current=controller;
  setItems(selection.map(item=>({episodeId:item.id})));
  void readItems(selection.map(item=>item.id),controller.signal);
  return()=>controller.abort();
 },[selection]);

 async function readItems(ids:string[],signal:AbortSignal){
  if(locked.current)return;
  setBusy('read');
  setPreviewId('');
  const replacements=new Map<string,Item>();
  for(let offset=0;offset<ids.length&&!signal.aborted;offset+=4){
   for(const item of await Promise.all(ids.slice(offset,offset+4).map(id=>readReview(id,signal))))replacements.set(item.episodeId,item);
  }
  if(!signal.aborted){
   setItems(current=>current.map(item=>replacements.get(item.episodeId)??item));
   setBusy(null);
  }
 }

 function updateItem(episodeId:string,change:Partial<Item>){
  setItems(current=>current.map(item=>item.episodeId===episodeId?{...item,...change}:item));
 }

 async function submit(targets:Item[],retry=false){
  if(locked.current||busy||!targets.length)return;
  const signal=lifetime.current!.signal;
  locked.current=true;
  setBusy('submit');
  setPreviewId('');
  setRefreshError('');
  const outcome=new Map<string,Result>();
  try{
   for(const {episodeId,review} of targets){
    if(signal.aborted)return;
    if(!review)continue;
    try{
     const result=await localCommand<Result>('confirmReviewedExport',{episodeId,reviewFingerprint:review.reviewFingerprint},undefined,'episode-commands');
     outcome.set(episodeId,result);
    }catch(error){outcome.set(episodeId,{episodeId,status:'failed',reason:errorMessage(error)});}
   }
   if(signal.aborted)return;
   setItems(current=>current.map(item=>{
    const result=outcome.get(item.episodeId);
    if(result)return {...item,result,decision:undefined};
    if(retry||item.result)return item;
    const reason=item.decision==='change'?'已标记待修改。':'本次未勾选通过。';
    return {...item,result:{episodeId:item.episodeId,status:'skipped',reason}};
   }));
   if([...outcome.values()].some(item=>item.status==='success')){
    try{await onChanged();}catch(error){if(!signal.aborted)setRefreshError(errorMessage(error));}
   }
  }finally{
   locked.current=false;
   if(!signal.aborted)setBusy(null);
  }
 }

 return <EpisodeBatchDialog title={uiText('批量确认成片')} busy={busy==='submit'} onClose={onClose} footer={<>
  {!!rereadable.length&&<Button size="sm" color="secondary" isDisabled={!!busy} onPress={()=>void readItems(rereadable.map(item=>item.episodeId),lifetime.current!.signal)}>{uiText('重新核对失败项')}</Button>}
  {!!retryable.length&&<Button size="sm" color="secondary" isDisabled={!!busy} onPress={()=>void submit(retryable,true)}>{uiText('只重试失败项')}</Button>}
  {!!pending.length&&<Button size="sm" color="primary" isDisabled={!!busy||!approved.length} onPress={()=>void submit(approved)}>{uiText('提交通过项')}</Button>}
 </>}>
  {busy&&<p role="status">{uiText(busy==='read'?'正在读取待确认成片…':'正在提交通过项…')}</p>}
  {refreshError&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')} {uiText(refreshError)}</p>}
  {!!pending.length&&<p>{uiText('逐张预览成片，再标记通过或待修改。')}</p>}
  {pending.map(item=>{
   const episodeId=item.episodeId,title=titles.get(episodeId)??episodeId;
   const review=item.review,previewing=previewId===episodeId;
   return <Fragment key={episodeId}><fieldset className="episode-batch-export-item" disabled={!!busy}>
    <legend>{title}</legend>
    <Button size="sm" color={previewing?'secondary':'tertiary'} aria-pressed={previewing} aria-label={uiText('预览 {title}',{title})} onPress={()=>setPreviewId(episodeId)}>{uiText('预览')}</Button>
    <label><input type="radio" name={'decision-'+episodeId} disabled={!item.playable} aria-label={uiText('通过 {title}',{title})} checked={item.decision==='approve'} onChange={()=>updateItem(episodeId,{decision:'approve'})}/>{uiText('通过')}</label>
    <label><input type="radio" name={'decision-'+episodeId} aria-label={uiText('待修改 {title}',{title})} checked={item.decision==='change'} onChange={()=>updateItem(episodeId,{decision:'change'})}/>{uiText('待修改')}</label>
   </fieldset>
   {previewing&&<div className="episode-batch-export-player">
    <video key={review.reviewFingerprint} aria-label={uiText('预览 {title}',{title})} controls playsInline preload="auto"
     src={localArtifactUrl(episodeId,review.artifact.relativePath,review.artifact.sha256)??undefined}
     onLoadedData={()=>updateItem(episodeId,{playable:true})}
     onError={()=>updateItem(episodeId,{decision:undefined,result:readFailure(episodeId,'当前成片无法播放，请重新核对。')})}/>
   </div>}
   </Fragment>;
  })}
  {!!results.length&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={results} collapseSkipped/></div>}
 </EpisodeBatchDialog>;
}

export const exportReviewBatchAction:EpisodeBatchAction={
 id:'export-review',get label(){return uiText('批量确认成片');},
 render:context=><BatchExportReviewDialog {...context}/>,
};
