import {CircleAlert,CircleCheck,Minus,X} from 'lucide-react';
import {useLayoutEffect,useId,useRef,type ReactNode} from 'react';
import {uiText} from '../i18n/ui';
import type {EpisodeBatchHints} from '../episodes/episodeCatalogTypes';
import type {EpisodeStage} from '../platform/types';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import './episode-batch.css';

export interface EpisodeBatchSelectionItem {
 id:string;
 title:string;
 accountId:string;
 collectionSeriesId?:string|null;
 archived:boolean;
 stage:EpisodeStage;
 hints?:EpisodeBatchHints;
}

export interface EpisodeBatchActionContext {
 selection:readonly EpisodeBatchSelectionItem[];
 onClose:()=>void;
 onChanged:()=>Promise<void>;
}

export interface EpisodeBatchAction {
 id:string;
 label:string;
 render:(context:EpisodeBatchActionContext)=>ReactNode;
}

export interface EpisodeBatchItemResult {
 episodeId:string;
 status:'success'|'skipped'|'failed';
 reason?:string;
}

export function EpisodeBatchDialog({title,busy,compact,onClose,children,footer}:{title:string;busy?:boolean;compact?:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode}){
 const titleId=useId(),dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const element=dialog.current;
  element?.showModal();
  return()=>element?.close();
 },[]);
 return <dialog ref={dialog} className="episode-batch-dialog dan-ui product-ui" data-compact={compact||undefined} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header><h2 id={titleId}>{title}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭')} title={uiText('关闭')} isDisabled={busy} onPress={onClose}/></header>
  <div className="episode-batch-body">{children}</div>
  {footer&&<footer>{footer}</footer>}
 </dialog>;
}

const resultDisplay={
 success:{label:'成功',icon:CircleCheck},
 skipped:{label:'跳过',icon:Minus},
 failed:{label:'失败',icon:CircleAlert},
} as const;
export function EpisodeBatchImpact({affected,excluded}:{affected:readonly EpisodeBatchSelectionItem[];excluded:readonly {item:EpisodeBatchSelectionItem;reason:string}[]}){
 return <>
  <p className="episode-batch-summary"><strong>{uiText('预计影响 {count} 张',{count:affected.length})}</strong></p>
  {affected.length>0&&<ul role="list" className="episode-batch-items">{affected.map(item=><li key={item.id}><strong>{item.title}</strong></li>)}</ul>}
  {excluded.length>0&&<details className="episode-batch-disclosure">
   <summary>{uiText('预计不变 {count} 张',{count:excluded.length})}</summary>
   <ul role="list" className="episode-batch-items">{excluded.map(({item,reason})=><li key={item.id}><strong>{item.title}</strong><span>{uiText(reason)}</span></li>)}</ul>
  </details>}
 </>;
}

export function EpisodeBatchResults({selection,results,title=uiText('逐单结果'),collapseSkipped=false}:{selection:readonly Pick<EpisodeBatchSelectionItem,'id'|'title'>[];results:readonly EpisodeBatchItemResult[];title?:string;collapseSkipped?:boolean}){
 const labels=new Map(selection.map(item=>[item.id,item.title]));
 const skipped=collapseSkipped?results.filter(item=>item.status==='skipped'):[];
 const visible=skipped.length?results.filter(item=>item.status!=='skipped'):results;
 function rows(items:readonly EpisodeBatchItemResult[]){
  return <ul role="list" className="episode-batch-items">{items.map(result=>{
   const {label,icon:StatusIcon}=resultDisplay[result.status];
   return <li key={result.episodeId} data-status={result.status}>
    <strong>{labels.get(result.episodeId)??result.episodeId}</strong>
    <span className="episode-batch-result-state"><StatusIcon aria-hidden="true"/>{uiText(label)}{result.reason?' · '+uiText(result.reason):''}</span>
   </li>;
  })}</ul>;
 }
 return <section aria-label={title}>
  {visible.length>0&&<><h3>{title}</h3>{rows(visible)}</>}
  {skipped.length>0&&<details className="episode-batch-disclosure">
   <summary>{uiText('跳过 {count} 张',{count:skipped.length})}</summary>
   {rows(skipped)}
  </details>}
 </section>;
}
