import {useLayoutEffect,useId,useRef,type ReactNode} from 'react';
import {uiText} from '../i18n/ui';
import type {EpisodeStage} from '../platform/types';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import './episode-batch.css';

export type EpisodeBatchHints={script:boolean;export:boolean;zip:boolean};

export interface EpisodeBatchSelectionItem {
 id:string;
 title:string;
 sourceTitle:string;
 accountId:string;
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

export function EpisodeBatchDialog({title,busy,onClose,children,footer}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode}){
 const titleId=useId(),dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const element=dialog.current;
  element?.showModal();
  return()=>element?.close();
 },[]);
 return <dialog ref={dialog} className="episode-batch-dialog dan-ui product-ui" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header><h2 id={titleId}>{title}</h2><Button size="sm" color="tertiary" isDisabled={busy} onPress={onClose}>{uiText('关闭')}</Button></header>
  <div className="episode-batch-body">{children}</div>
  {footer&&<footer>{footer}</footer>}
 </dialog>;
}

const resultsLabels={success:'成功',skipped:'跳过',failed:'失败'} as const;
export function EpisodeBatchResults({selection,results,title=uiText('逐单结果')}:{selection:readonly Pick<EpisodeBatchSelectionItem,'id'|'title'>[];results:readonly EpisodeBatchItemResult[];title?:string}){
 const labels=new Map(selection.map(item=>[item.id,item.title]));
 return <section aria-label={title}>
  <h3>{title}</h3>
  <ul role="list" className="episode-batch-items">{results.map(result=><li key={result.episodeId} data-status={result.status}>
   <strong>{labels.get(result.episodeId)??result.episodeId}</strong>
   <span>{uiText(resultsLabels[result.status])}{result.reason?' · '+uiText(result.reason):''}</span>
  </li>)}</ul>
 </section>;
}
